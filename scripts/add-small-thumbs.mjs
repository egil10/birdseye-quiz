// Add a `thumbSmall` (500px-ish) URL to every image in data/cities.json.
//
// Wikimedia's static CDN rejects direct requests for arbitrary thumbnail
// widths -- only the sizes its API has pre-generated for a given file are
// valid. So for the explore grid (which displays cards at ~200-300px) we
// can't just rewrite the existing 1280px URL to "/500px-..." and call it a
// day. We have to ask the API for a 500px-wide thumb and store whatever URL
// it returns (which Wikimedia will normalise to whichever cached size is
// closest above 500).

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(__dirname, "..", "data", "cities.json");

const UA = "birdseye-quiz/0.1 (https://github.com/egil10/birdseye-quiz; quiz app)";
const SMALL_W = 500;
const BATCH = 30;          // titles per API request
const SLEEP_MS = 200;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchSmallBatch(titles) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    titles: titles.join("|"),
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: String(SMALL_W),
    format: "json",
    origin: "*",
  }).toString();
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const out = new Map();
  const pages = (data.query && data.query.pages) ? Object.values(data.query.pages) : [];
  const normMap = new Map();
  if (data.query && data.query.normalized) {
    for (const n of data.query.normalized) normMap.set(n.to, n.from);
  }
  for (const p of pages) {
    if (!p.imageinfo || !p.imageinfo[0]) continue;
    const small = p.imageinfo[0].thumburl;
    if (!small) continue;
    const title = p.title;
    out.set(title, small);
    if (normMap.has(title)) out.set(normMap.get(title), small);
  }
  return out;
}

async function main() {
  const raw = await readFile(PATH, "utf8");
  const manifest = JSON.parse(raw);

  // Collect every distinct fileTitle to fetch.
  const titles = [];
  for (const c of manifest.cities) {
    for (const img of c.images) {
      if (img.thumbSmall) continue;       // already done
      if (!img.fileTitle) continue;
      if (!img.fileTitle.startsWith("File:")) continue;  // wikipedia-summary entries
      titles.push(img.fileTitle);
    }
  }
  console.log(`fetching small thumbs for ${titles.length} files...`);

  const got = new Map();
  for (let i = 0; i < titles.length; i += BATCH) {
    const slice = titles.slice(i, i + BATCH);
    try {
      const batch = await fetchSmallBatch(slice);
      for (const [k, v] of batch) got.set(k, v);
    } catch (err) {
      console.warn(`batch ${i}/${titles.length} failed:`, err.message);
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH, titles.length)}/${titles.length}`);
    await sleep(SLEEP_MS);
  }
  console.log();

  // Attach to manifest
  let attached = 0;
  for (const c of manifest.cities) {
    for (const img of c.images) {
      if (!img.fileTitle) continue;
      const small = got.get(img.fileTitle);
      if (small) { img.thumbSmall = small; attached++; }
    }
  }
  manifest.generatedAt = new Date().toISOString();
  await writeFile(PATH, JSON.stringify(manifest));   // minified for delivery
  console.log(`attached thumbSmall to ${attached} images, wrote ${PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
