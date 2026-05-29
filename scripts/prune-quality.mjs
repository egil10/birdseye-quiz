// Quality gate for data/cities.json.
//
// Wikimedia's free-text search ("aerial view of X", "X from above") is noisy:
// it returns ground-level landmark photos, panoramio tourist snapshots, and
// even wrong-city matches (e.g. "Fontana Pretoria" in Palermo for Pretoria).
// We can't verify a photo is a zoomed-out aerial from its pixels here, but we
// CAN trust two signals:
//
//   1. the image lives in a Wikimedia "Aerial photographs/views of <City>"
//      category (our commons-category-* sources), or
//   2. its file title explicitly says it's an aerial / skyline / drone / from-
//      above shot (in any of several languages).
//
// Everything else is dropped. Cities left with zero qualifying images are
// removed from the manifest. This trades raw city count for the promise that
// every image you're shown is actually an aerial of that city.

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(__dirname, "..", "data", "cities.json");

// Real aerial-ness hints. Deliberately NOT matching the bare stem "panoram"
// because that hits the "- panoramio.jpg" suffix on (mostly ground-level)
// Panoramio uploads; we match "panoramic/panorámica" with the -ic ending only.
const HINT = /(aerial|a[eé]ri|a[eé]rea|a[eé]reo|panoramic|panorámic|luftbild|luftaufnahme|luchtfoto|flyfoto|flygfoto|ilmakuva|havadan|vue du ciel|veduta aerea|dall.alto|desde el aire|from the air|from the sky|from above|overhead|bird.?s?[ -]?eye|birdseye|drone|skyline|cityscape|aerofoto|z lotu|空撮|航拍|鳥瞰|鸟瞰)/i;

const isCategory = im => /^commons-category/.test(im.source || "");
const isHighConfidence = im => isCategory(im) || HINT.test(im.fileTitle || "");

async function main() {
  const manifest = JSON.parse(await readFile(PATH, "utf8"));
  const before = manifest.cities.length;
  let beforeImgs = 0, afterImgs = 0, droppedCities = 0;

  const kept = [];
  for (const c of manifest.cities) {
    beforeImgs += c.images.length;
    const good = c.images.filter(isHighConfidence);
    if (!good.length) { droppedCities++; continue; }
    c.images = good;
    afterImgs += good.length;
    kept.push(c);
  }

  manifest.cities = kept;
  manifest.count = kept.length;
  manifest.generatedAt = new Date().toISOString();
  await writeFile(PATH, JSON.stringify(manifest));

  const byCont = {};
  for (const c of kept) byCont[c.continent] = (byCont[c.continent] || 0) + 1;
  console.log(`quality prune: ${before} -> ${kept.length} cities (dropped ${droppedCities})`);
  console.log(`images: ${beforeImgs} -> ${afterImgs} (avg ${(afterImgs / kept.length).toFixed(2)}/city)`);
  console.log("by continent:", byCont);
}

main().catch(e => { console.error(e); process.exit(1); });
