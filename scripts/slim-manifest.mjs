// Derive data/cities.min.json — the lean manifest the QUIZ page loads.
//
// The quiz only needs, per image: the thumb URL, the Commons file-page URL
// (for the "view source" link) and the source tag. Everything else
// (width/height/license/author/credit/fileTitle/sourceQuery/thumbSmall) is
// only used by the explore page, which keeps loading the full cities.json.
// Stripping those fields ~halves the bytes on the hot path, and the file is
// written minified.

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "data", "cities.json");
const OUT = resolve(__dirname, "..", "data", "cities.min.json");

async function main() {
  const manifest = JSON.parse(await readFile(SRC, "utf8"));
  const cities = manifest.cities.map(c => ({
    id: c.id,
    name: c.name,
    country: c.country,
    continent: c.continent,
    tier: c.tier,
    images: c.images.map(im => {
      const slim = { thumb: im.thumb, source: im.source };
      if (im.filePageUrl) slim.filePageUrl = im.filePageUrl;
      else if (im.full) slim.full = im.full;
      return slim;
    }),
  }));
  const slim = { generatedAt: manifest.generatedAt, count: cities.length, cities };
  await writeFile(OUT, JSON.stringify(slim));

  const [{ size: full }, { size: lean }] = await Promise.all([
    import("node:fs/promises").then(fs => fs.stat(SRC)),
    import("node:fs/promises").then(fs => fs.stat(OUT)),
  ]);
  const kb = n => (n / 1024).toFixed(0) + " KB";
  console.log(`cities.min.json: ${cities.length} cities · ${kb(lean)} (full: ${kb(full)})`);
}

main().catch(e => { console.error(e); process.exit(1); });
