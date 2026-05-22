// Build data/cities.json by fetching aerial-view images for each curated city.
//
// Sources tried, in order, until enough images are collected:
//   1. commons-category-aerial   -- Wikimedia Commons category "Aerial photographs of <X>"
//   2. commons-search-aerial     -- Commons search: "aerial view of <X>"
//   3. commons-search-skyline    -- Commons search: "<X> skyline aerial"
//   4. commons-search-fromabove  -- Commons search: "<X> from above"
//   5. commons-category-city     -- Commons category "<X>" (last-resort, may include ground-level)
//   6. wikipedia-summary         -- Wikipedia REST page summary (lead image, may not be aerial)
//
// Each image keeps its `source` tag and `sourceQuery` so you can later filter
// or blacklist whole sources from the frontend.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cities } from "./cities.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "data", "cities.json");

const UA = "birdseye-quiz/0.1 (https://github.com/egil10/birdseye-quiz; quiz app)";
const THUMB_WIDTH = 1280;
const IMAGES_PER_CITY = 4;          // collected per city before we stop
const MIN_WIDTH = 700;               // skip tiny images
const MIN_ASPECT = 0.9;              // skip portrait images (aerials are landscape-ish)
const ALLOWED_EXT = /\.(jpe?g|png|webp)$/i;
const SLEEP_MS = 250;                // be polite to Wikimedia

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

function pickThumb(imageinfo) {
  if (!imageinfo || !imageinfo[0]) return null;
  const ii = imageinfo[0];
  const url = ii.thumburl || ii.url;
  if (!url || !ALLOWED_EXT.test(url)) return null;
  const w = ii.thumbwidth || ii.width || 0;
  const h = ii.thumbheight || ii.height || 0;
  if (w && w < MIN_WIDTH) return null;
  if (w && h && (w / h) < MIN_ASPECT) return null;
  return {
    thumb: url,
    full: ii.descriptionurl ? ii.url : ii.url,
    width: w,
    height: h,
    mime: ii.mime || "",
  };
}

function metaText(extmeta, key) {
  const m = extmeta && extmeta[key];
  if (!m || !m.value) return "";
  return String(m.value).replace(/<[^>]*>/g, "").trim();
}

function buildImageRecord(page, source, sourceQuery) {
  const picked = pickThumb(page.imageinfo);
  if (!picked) return null;
  const ext = page.imageinfo[0].extmetadata || {};
  return {
    thumb: picked.thumb,
    full: page.imageinfo[0].url,
    width: picked.width,
    height: picked.height,
    fileTitle: page.title,
    filePageUrl: page.imageinfo[0].descriptionurl ||
      `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    license: metaText(ext, "LicenseShortName") || metaText(ext, "License"),
    author: metaText(ext, "Artist"),
    credit: metaText(ext, "Credit"),
    source,
    sourceQuery,
  };
}

async function commonsCategory(catTitle, source, max = IMAGES_PER_CITY) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "categorymembers",
    gcmtitle: catTitle,
    gcmtype: "file",
    gcmlimit: "30",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
    format: "json",
    origin: "*",
  }).toString();
  try {
    const data = await api(url);
    const pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
    const records = [];
    for (const p of pages) {
      const rec = buildImageRecord(p, source, catTitle);
      if (rec) records.push(rec);
      if (records.length >= max) break;
    }
    return records;
  } catch {
    return [];
  }
}

async function commonsSearch(query, source, max = IMAGES_PER_CITY) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "20",
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
    const records = [];
    for (const p of pages) {
      const rec = buildImageRecord(p, source, query);
      if (rec) records.push(rec);
      if (records.length >= max) break;
    }
    return records;
  } catch {
    return [];
  }
}

async function wikipediaSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const data = await api(url);
    const thumb = data.thumbnail;
    const orig = data.originalimage;
    if (!thumb || !thumb.source) return [];
    return [{
      thumb: thumb.source.replace(/\/\d+px-/, `/${THUMB_WIDTH}px-`),
      full: orig ? orig.source : thumb.source,
      width: thumb.width,
      height: thumb.height,
      fileTitle: data.titles && data.titles.canonical || title,
      filePageUrl: data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      license: "see Wikipedia article",
      author: "",
      credit: "",
      source: "wikipedia-summary",
      sourceQuery: title,
    }];
  } catch {
    return [];
  }
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
  const wikiTitle = city.wikipediaTitle || city.name;
  const baseCat = city.commonsCategory || `Aerial photographs of ${city.name}`;
  const altCat = city.commonsCategory ? null : `Aerial views of ${city.name}`;

  const steps = [
    () => commonsCategory(`Category:${baseCat}`, "commons-category-aerial"),
    altCat ? () => commonsCategory(`Category:${altCat}`, "commons-category-aerial-alt") : null,
    () => commonsSearch(`aerial view of ${city.name}`, "commons-search-aerial"),
    () => commonsSearch(`${city.name} skyline aerial`, "commons-search-skyline"),
    () => commonsSearch(`${city.name} from above`, "commons-search-fromabove"),
    () => commonsCategory(`Category:${city.name}`, "commons-category-city"),
    () => wikipediaSummary(wikiTitle),
  ].filter(Boolean);

  const collected = [];
  for (const step of steps) {
    if (collected.length >= IMAGES_PER_CITY) break;
    const results = await step();
    await sleep(SLEEP_MS);
    if (results && results.length) {
      for (const r of results) {
        collected.push(r);
        if (collected.length >= IMAGES_PER_CITY) break;
      }
    }
  }
  return dedupe(collected).slice(0, IMAGES_PER_CITY);
}

async function main() {
  await mkdir(dirname(OUT_PATH), { recursive: true });
  const out = [];
  let i = 0;
  for (const city of cities) {
    i++;
    process.stdout.write(`[${i}/${cities.length}] ${city.name}, ${city.country} ... `);
    const images = await fetchCity(city);
    if (images.length === 0) {
      console.log("MISS");
      continue;
    }
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

  const manifest = {
    generatedAt: new Date().toISOString(),
    count: out.length,
    cities: out,
  };
  await writeFile(OUT_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${out.length} cities to ${OUT_PATH}`);

  // Summary
  const bySource = {};
  let imgTotal = 0;
  for (const c of out) {
    for (const im of c.images) {
      bySource[im.source] = (bySource[im.source] || 0) + 1;
      imgTotal++;
    }
  }
  console.log(`\nTotal images: ${imgTotal}`);
  for (const [src, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${n}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
