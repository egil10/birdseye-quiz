# birdseye-quiz

Endless birds-eye-view city quiz. You see an aerial photo, you pick one of four
cities. ELO, streaks, accuracy, and an ELO-over-time graph. No accounts, no
clutter — just the world from above.

Live: https://birdseye-quiz.vercel.app

**~950 cities · ~3,700 aerial photos**, sourced from Wikimedia Commons and
quality-filtered so every image is an actual aerial of that city.

## Stack

Pure static site — `index.html`, `explore.html`, `styles.css`, `app.js`,
`explore.js`, and generated data manifests. No framework, no runtime build. The
whole thing deploys to Vercel as static files.

Two manifests are generated (both minified):

| file                  | used by      | per-image fields |
|-----------------------|--------------|------------------|
| `data/cities.min.json`| quiz (hot path) | `thumb`, `filePageUrl`, `source` only |
| `data/cities.json`    | explore page | full metadata (size, license, author, `thumbSmall`, …) |

The quiz loads the lean file (~1.2 MB vs ~3.2 MB) — roughly a third of the
bytes — and falls back to the full one if it's missing.

## Build the data

```bash
npm run build         # build:cities → build:prune → build:thumbs → build:slim
npm run dev           # serves on http://localhost:5173
```

Individual steps:

- `npm run build:cities` — fetch aerial images for every city in
  `scripts/cities.mjs` and write `data/cities.json`. **Incremental**: cities
  already in the manifest are reused (and re-pruned through the current
  quality filters), so a rerun only hits the network for *new* cities. Pass
  `--rebuild` to refetch everything. Runs 4 cities in parallel with retry/backoff.
- `npm run build:prune` — the quality gate (see below). Drops low-confidence
  images and any city left with none.
- `npm run build:thumbs` — add a ~500 px `thumbSmall` to each image for the
  explore grid.
- `npm run build:slim` — derive `data/cities.min.json` from `cities.json`.

### Sources (tried in order, until ~12 candidates collected)

| source tag                    | query |
|-------------------------------|-------|
| `commons-category-aerial`     | `Category:Aerial photographs of <City>` |
| `commons-category-aerial-alt` | `Category:Aerial views of <City>` |
| `commons-search-aerial`       | search: `aerial view of <City>` |
| `commons-search-fromabove`    | search: `<City> from above` |
| `commons-search-skyline`      | search: `<City> skyline aerial` |

### Quality filters

Every candidate must be a real raster image, **≥ 1000 px wide**, landscape
(aspect 1.2–3.2), and survive a **title blocklist** that drops maps, diagrams,
drawings, coats of arms, logos, renders, etc. Survivors are scored (width +
aspect sweet-spot + a bonus that trusts the aerial *categories* over free-text
search) and the top 5 per city are kept. Extension-twins (the same shot as both
`.tif` and `.jpg`) are de-duplicated.

Then the **quality gate** (`build:prune`) keeps only *high-confidence* images:
either the image lives in a Wikimedia "Aerial photographs/views of &lt;City&gt;"
category, or its title explicitly says aerial / skyline / drone / from-above
(in any of several languages). This throws out the ground-level landmark
photos, Panoramio tourist snapshots, and wrong-city matches that free-text
search drags in. Cities left with zero qualifying images are dropped — so the
city count (~950) is lower than the raw candidate list (~1,200), but every
photo shown is genuinely an aerial of that city.

## Deploy

1. Push to GitHub.
2. Import the repo in Vercel — framework **Other**, output dir root.
3. `vercel.json` sets cache headers on `data/` and static assets.

## Repo layout

```
index.html                 quiz entry (+ ELO-over-time graph modal)
explore.html               /explore — browse every city + image
styles.css                 light glass UI (shared)
app.js                     quiz logic, ELO, cursor glow, graph
explore.js                 minimal grid, filters, sort, lightbox modal
scripts/cities.mjs         curated city candidate list (~1,200 entries)
scripts/build-cities.mjs   Wikimedia fetch + quality filters (incremental)
scripts/prune-quality.mjs  high-confidence aerial gate
scripts/add-small-thumbs.mjs  adds 500px thumbs for the explore grid
scripts/slim-manifest.mjs  derives the lean quiz manifest
data/cities.json           full manifest (committed; explore page)
data/cities.min.json       lean manifest (committed; quiz page)
vercel.json                cache headers
```

## Quiz page

Aerial photo + four city options. `1·2·3·4` to answer, space for next, `r` to
skip. Category tabs (top-left) filter the pool: **all / famous / europe / asia /
americas / africa / oceania**. Click the **elo** stat to see your rating over
time on a minimal line graph.

## Explore page

`/explore.html` shows every city as a card — city name above its photo, in a
clean 3-column grid. Click a card for a lightbox with every image side-by-side,
plus source tag, license, author, dimensions, and a link to the Commons file
page. Controls:

- **search** by city or country
- **continent** and **tier** filters
- **sort**: name a–z / z–a, country, tier, most images
- **source** dropdown — every distinct `source` tag in the manifest

## Attribution

All images link back to their Wikimedia Commons source page from the in-app
pill / lightbox. Licenses (mostly CC BY-SA, public domain, etc.) are captured in
the full manifest under each image's `license` field.
