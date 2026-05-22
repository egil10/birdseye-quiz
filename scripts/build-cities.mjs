// Build data/cities.json by fetching aerial-view images for each curated city.
//
// Strategy:
//   1. For each city, collect candidate images from up to 5 Wikimedia sources
//      until we have ~15 candidates (or all sources exhausted).
//   2. Apply hard quality filters: must be a real image file, landscape
//      orientation, at least MIN_WIDTH pixels wide.
//   3. Score every survivor and keep the top IMAGES_PER_CITY.
//
// Sources tried (in order):
//   commons-category-aerial      Wikimedia Commons "Aerial photographs of <X>"
//   commons-category-aerial-alt  ".. Aerial views of <X>"
//   commons-search-aerial        Commons search "aerial view of <X>"
//   commons-search-fromabove     Commons search "<X> from above"
//   commons-search-skyline       Commons search "<X> skyline aerial"
//
// We deliberately dropped two earlier sources -- `commons-category-city`
// (just "Category:<X>", almost always ground-level photos) and
// `wikipedia-summary` (lead images that are often skylines, monuments, or
// even ground-level shots, not aerial views). They were the worst quality
// offenders in the previous pass.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cities } from "./cities.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "data", "cities.json");

const UA = "birdseye-quiz/0.2 (https://github.com/egil10/birdseye-quiz; quiz app)";
const THUMB_WIDTH = 1600;            // requested thumb width
const IMAGES_PER_CITY = 5;            // top survivors kept
const MIN_WIDTH = 900;                // hard floor
const MIN_ASPECT = 1.15;              // landscape only
const MAX_ASPECT = 3.5;               // not crazy-panorama
const TARGET_CANDIDATES = 15;         // stop pulling sources once we have this many
const SLEEP_MS = 220;
const ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;

const SOURCE_BONUS = {
  "commons-category-aerial":     1.30,
  "commons-category-aerial-alt": 1.20,
  "commons-search-aerial":       1.00,
  "commons-search-fromabove":    0.92,
  "commons-search-skyline":      0.85,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function passesFilter(ii) {
  const url = ii.thumburl || ii.url;
  if (!url || !ALLOWED_EXT.test(url)) return false;
  const w = ii.thumbwidth || ii.width || 0;
  const h = ii.thumbheight || ii.height || 0;
  if (w < MIN_WIDTH) return false;
  if (!h) return false;
  const aspect = w / h;
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return false;
  return true;
}

function scoreImage(rec) {
  const w = rec.width || 0;
  const h = rec.height || 1;
  const aspect = w / h;
  // 1) width, capped so panoramas don't dominate purely on pixel count
  let s = Math.min(w, 2400);
  // 2) landscape sweet spot ~1.5; mild penalty as we drift away
  if (aspect < 1.3) s *= 0.85;
  else if (aspect > 2.4) s *= 0.85;
  // 3) source priority bonus
  s *= (SOURCE_BONUS[rec.source] || 0.7);
  return s;
}

function metaText(extmeta, key) {
  const m = extmeta && extmeta[key];
  if (!m || !m.value) return "";
  return String(m.value).replace(/<[^>]*>/g, "").trim();
}

function buildImageRecord(page, source, sourceQuery) {
  const ii = page.imageinfo && page.imageinfo[0];
  if (!ii) return null;
  if (!passesFilter(ii)) return null;
  const ext = ii.extmetadata || {};
  return {
    thumb: ii.thumburl || ii.url,
    full: ii.url,
    width: ii.thumbwidth || ii.width || 0,
    height: ii.thumbheight || ii.height || 0,
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

function dedupe(records) {
  const seen = new Set();
  const out = [];
  for (const r of records) {
    const key = r.fileTitle || r.full;
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
    () => commonsCategory(`Category:${baseCat}`,    "commons-category-aerial"),
    () => commonsCategory(`Category:${altCat}`,     "commons-category-aerial-alt"),
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

async function main() {
  await mkdir(dirname(OUT_PATH), { recursive: true });
  const out = [];
  let i = 0;
  for (const city of cities) {
    i++;
    process.stdout.write(`[${i}/${cities.length}] ${city.name}, ${city.country} ... `);
    const images = await fetchCity(city);
    if (images.length === 0) { console.log("MISS"); continue; }
    out.push({
      id: city.id,
      name: city.name,
      country: city.country,
      continent: city.continent,
      tier: city.tier,
      images,
    });
    const srcs = [...new Set(images.map(im => im.source))].join(", ");
    console.log(`${images.length} (${srcs})`);
  }

  const manifest = { generatedAt: new Date().toISOString(), count: out.length, cities: out };
  await writeFile(OUT_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${out.length} cities to ${OUT_PATH}`);

  const bySource = {};
  let imgTotal = 0;
  for (const c of out) {
    for (const im of c.images) {
      bySource[im.source] = (bySource[im.source] || 0) + 1;
      imgTotal++;
    }
  }
  console.log(`Total images: ${imgTotal}`);
  for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${n}`);
  }
  const missing = cities.length - out.length;
  if (missing > 0) console.log(`(${missing} cities produced zero qualifying images)`);
}

main().catch(err => { console.error(err); process.exit(1); });
