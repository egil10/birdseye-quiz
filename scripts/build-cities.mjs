// Build data/cities.json by fetching aerial-view images for each curated city.
//
// Strategy:
//   1. For each city, collect candidate images from up to 5 Wikimedia sources
//      until we have ~TARGET_CANDIDATES (or all sources exhausted).
//   2. Apply hard quality filters: real image file, landscape orientation,
//      wide enough, and not an obvious non-photo (maps/diagrams/art) per the
//      title blocklist.
//   3. Score every survivor and keep the top IMAGES_PER_CITY.
//
// The build is INCREMENTAL: cities already present in data/cities.json are
// reused (their images are re-pruned through the current filters, so bad
// shots get dropped without refetching). Only new cities — or ones left with
// too few images after pruning — hit the network. Pass `--rebuild` to refetch
// everything from scratch.
//
// Sources tried (in order):
//   commons-category-aerial      Commons "Aerial photographs of <X>"
//   commons-category-aerial-alt  Commons "Aerial views of <X>"
//   commons-search-aerial        Commons search "aerial view of <X>"
//   commons-search-fromabove     Commons search "<X> from above"
//   commons-search-skyline       Commons search "<X> skyline aerial"

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cities } from "./cities.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "data", "cities.json");
const REBUILD = process.argv.includes("--rebuild");

const UA = "birdseye-quiz/0.3 (https://github.com/egil10/birdseye-quiz; quiz app)";
const THUMB_WIDTH = 1280;             // requested thumb width (matches lightbox)
const IMAGES_PER_CITY = 5;            // top survivors kept
const MIN_KEEP = 2;                   // refetch an existing city if pruning drops it below this
const MIN_WIDTH = 1000;               // hard floor (zoomed-out aerials are large)
const MIN_ASPECT = 1.2;               // landscape only
const MAX_ASPECT = 3.2;               // not a crazy panorama strip
const TARGET_CANDIDATES = 12;         // stop pulling sources once we have this many
const CONCURRENCY = 4;                // cities fetched in parallel
const SLEEP_MS = 180;                 // pause between a city's own sequential requests
const ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;

// Drop files whose title screams "not a zoomed-out aerial photo" — maps,
// diagrams, drawings, coats of arms, logos, etc. Word-boundaried to avoid
// nuking legitimate names.
const BLOCK_TITLE = /\b(map|maps|mapa|carte|karte|mappa|diagram|schematic|plan|sketch|drawing|engraving|lithograph|etching|painting|illustration|chart|graph|coat[ _]of[ _]arms|seal|flag|logo|emblem|banner|poster|infographic|topographic|elevation|cross[ _]section|blueprint|render|rendering|render(ed)?)\b/i;

const SOURCE_BONUS = {
  "commons-category-aerial":     1.35,
  "commons-category-aerial-alt": 1.22,
  "commons-search-aerial":       1.00,
  "commons-search-fromabove":    0.90,
  "commons-search-skyline":      0.82,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } catch (e) {
    if (attempt < 2) { await sleep(600 * (attempt + 1)); return api(url, attempt + 1); }
    throw e;
  }
}

// --- quality gates ----------------------------------------------------------
function passesDims(w, h) {
  if (!w || !h) return false;
  if (w < MIN_WIDTH) return false;
  const aspect = w / h;
  return aspect >= MIN_ASPECT && aspect <= MAX_ASPECT;
}
function passesTitle(title) {
  if (!title) return true;
  return !BLOCK_TITLE.test(title);
}
function passesUrl(url) {
  return !!url && ALLOWED_EXT.test(url);
}

function scoreImage(rec) {
  const w = rec.width || 0;
  const h = rec.height || 1;
  const aspect = w / h;
  let s = Math.min(w, 2400);                 // bigger is better, capped
  if (aspect < 1.35) s *= 0.85;              // too square
  else if (aspect > 2.4) s *= 0.85;          // too letterboxed
  s *= (SOURCE_BONUS[rec.source] || 0.7);    // trust aerial categories most
  return s;
}

// Re-prune an existing city's image records through the current gates.
function pruneRecords(images) {
  const kept = images.filter(rec =>
    passesUrl(rec.full || rec.thumb) &&
    passesTitle(rec.fileTitle) &&
    passesDims(rec.width, rec.height)
  );
  kept.sort((a, b) => scoreImage(b) - scoreImage(a));
  return kept.slice(0, IMAGES_PER_CITY);
}

function metaText(extmeta, key) {
  const m = extmeta && extmeta[key];
  if (!m || !m.value) return "";
  return String(m.value).replace(/<[^>]*>/g, "").trim();
}

function buildImageRecord(page, source, sourceQuery) {
  const ii = page.imageinfo && page.imageinfo[0];
  if (!ii) return null;
  if (!passesTitle(page.title)) return null;
  const url = ii.thumburl || ii.url;
  if (!passesUrl(url)) return null;
  const w = ii.thumbwidth || ii.width || 0;
  const h = ii.thumbheight || ii.height || 0;
  if (!passesDims(w, h)) return null;
  const ext = ii.extmetadata || {};
  return {
    thumb: url,
    full: ii.url,
    width: w,
    height: h,
    fileTitle: page.title,
    filePageUrl: ii.descriptionurl ||
      `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    license: metaText(ext, "LicenseShortName") || metaText(ext, "License"),
    author: metaText(ext, "Artist"),
    credit: metaText(ext, "Credit"),
    source,
    sourceQuery,
  };
}

async function commonsCategory(catTitle, source, max = 50) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "categorymembers",
    gcmtitle: catTitle,
    gcmtype: "file",
    gcmlimit: String(max),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
    format: "json",
    origin: "*",
  }).toString();
  try {
    const data = await api(url);
    const pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
    const out = [];
    for (const p of pages) {
      const rec = buildImageRecord(p, source, catTitle);
      if (rec) out.push(rec);
    }
    return out;
  } catch { return []; }
}

async function commonsSearch(query, source, max = 30) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(max),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
    format: "json",
    origin: "*",
  }).toString();
  try {
    const data = await api(url);
    const pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
    pages.sort((a, b) => (a.index || 0) - (b.index || 0));
    const out = [];
    for (const p of pages) {
      const rec = buildImageRecord(p, source, query);
      if (rec) out.push(rec);
    }
    return out;
  } catch { return []; }
}

// Normalised key collapses extension-twins (the same shot uploaded as both
// File:X.tif and File:X.jpg, which Commons serves as separate pages).
function dedupeKey(r) {
  return (r.fileTitle || r.full || r.thumb || "")
    .replace(/^File:/, "")
    .replace(/\.(jpe?g|png|webp|tiff?)$/i, "")
    .trim()
    .toLowerCase();
}
function dedupe(records) {
  const seen = new Set();
  const out = [];
  for (const r of records) {
    const key = dedupeKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function fetchCity(city) {
  const baseCat = city.commonsCategory || `Aerial photographs of ${city.name}`;
  const altCat = `Aerial views of ${city.name}`;
  const steps = [
    () => commonsCategory(`Category:${baseCat}`,       "commons-category-aerial"),
    () => commonsCategory(`Category:${altCat}`,        "commons-category-aerial-alt"),
    () => commonsSearch(`aerial view of ${city.name}`, "commons-search-aerial"),
    () => commonsSearch(`${city.name} from above`,     "commons-search-fromabove"),
    () => commonsSearch(`${city.name} skyline aerial`, "commons-search-skyline"),
  ];
  const candidates = [];
  for (const step of steps) {
    if (candidates.length >= TARGET_CANDIDATES) break;
    const r = await step();
    await sleep(SLEEP_MS);
    if (r && r.length) candidates.push(...r);
  }
  const deduped = dedupe(candidates);
  deduped.sort((a, b) => scoreImage(b) - scoreImage(a));
  return deduped.slice(0, IMAGES_PER_CITY);
}

// Run an async worker over items with bounded concurrency.
async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function loadExisting() {
  if (REBUILD) return new Map();
  try {
    const raw = await readFile(OUT_PATH, "utf8");
    const manifest = JSON.parse(raw);
    const byId = new Map();
    for (const c of manifest.cities) byId.set(c.id, c);
    return byId;
  } catch { return new Map(); }
}

async function main() {
  await mkdir(dirname(OUT_PATH), { recursive: true });
  const existing = await loadExisting();
  console.log(`${cities.length} cities queued · ${existing.size} already in manifest${REBUILD ? " (ignored: --rebuild)" : ""}\n`);

  let done = 0, reused = 0, fetched = 0, miss = 0;
  const out = await mapPool(cities, CONCURRENCY, async city => {
    let images = null;
    const prior = existing.get(city.id);
    if (prior && prior.images) {
      const pruned = pruneRecords(prior.images);
      if (pruned.length >= MIN_KEEP) { images = pruned; reused++; }
    }
    if (!images) {
      images = await fetchCity(city);
      fetched++;
    }
    done++;
    if (done % 25 === 0 || done === cities.length) {
      process.stdout.write(`\r  ${done}/${cities.length}  reused:${reused} fetched:${fetched} miss:${miss}   `);
    }
    if (!images.length) { miss++; return null; }
    return { id: city.id, name: city.name, country: city.country, continent: city.continent, tier: city.tier, images };
  });
  console.log();

  const kept = out.filter(Boolean);
  const manifest = { generatedAt: new Date().toISOString(), count: kept.length, cities: kept };
  await writeFile(OUT_PATH, JSON.stringify(manifest));   // minified for delivery
  console.log(`\nWrote ${kept.length} cities to ${OUT_PATH}`);

  const bySource = {}, byCont = {};
  let imgTotal = 0;
  for (const c of kept) {
    byCont[c.continent] = (byCont[c.continent] || 0) + 1;
    for (const im of c.images) { bySource[im.source] = (bySource[im.source] || 0) + 1; imgTotal++; }
  }
  console.log(`Total images: ${imgTotal} (avg ${(imgTotal / kept.length).toFixed(2)}/city)`);
  console.log("By continent:", byCont);
  console.log("By source:");
  for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) console.log(`  ${src}: ${n}`);
  if (miss > 0) console.log(`(${miss} cities produced zero qualifying images and were dropped)`);
}

main().catch(err => { console.error(err); process.exit(1); });
