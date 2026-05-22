# birdseye-quiz

Endless birds-eye-view city quiz. You see an aerial photo, you pick one of four
cities. ELO, streaks, accuracy. No accounts, no clutter — just the world from
above.

Live: https://birdseye-quiz.vercel.app (once deployed)

## Stack

Pure static site — `index.html`, `styles.css`, `app.js`, and a generated
`data/cities.json` manifest. No framework, no build step at runtime. The whole
thing deploys to Vercel as a static site.

The images are sourced from **Wikimedia Commons** and **Wikipedia** at build
time. Each image keeps a `source` provenance tag so you can later tell which
queries produced good photos and which to drop.

## Run locally

```bash
npm run build:cities   # one-time: fetches images, writes data/cities.json
npm run dev            # serves on http://localhost:5173
```

`build:cities` walks the curated list in `scripts/cities.mjs` (~310 cities) and
for each tries, in order:

| step | source tag                  | what it queries |
|------|-----------------------------|-----------------|
| 1    | `commons-category-aerial`   | `Category:Aerial photographs of <City>` on Wikimedia Commons |
| 2    | `commons-category-aerial-alt` | `Category:Aerial views of <City>` |
| 3    | `commons-search-aerial`     | Commons search: `aerial view of <City>` |
| 4    | `commons-search-skyline`    | Commons search: `<City> skyline aerial` |
| 5    | `commons-search-fromabove`  | Commons search: `<City> from above` |
| 6    | `commons-category-city`     | `Category:<City>` (any photo) — last resort |
| 7    | `wikipedia-summary`         | Wikipedia REST `page/summary` lead image |

It stops once it has 4 images per city. The frontend shows each image's source
tag in the bottom-right pill — handy for spotting bad sources to ban.

## Deploy

1. Push to GitHub.
2. Import the repo in Vercel — framework: **Other**, output dir: root.
3. That's it. `vercel.json` sets cache headers on `data/` and static assets.

## Repo layout

```
index.html            quiz entry
explore.html          /explore — browse every city + image
styles.css            light glass / antigravity UI (shared)
app.js                quiz logic + cursor glow + dust
explore.js            grid, filters, modal of all 4 images per city
scripts/cities.mjs    curated city list
scripts/build-cities.mjs  Wikimedia/Wikipedia fetch
data/cities.json      generated manifest (committed so Vercel doesn't need Node)
vercel.json           cache headers
```

## Explore page

`/explore.html` shows every city in the database as a grid card. Click a card
to see all four images side-by-side with their source provenance tag, license,
author, dimensions, and a link to the original Commons file page. Filters:

- **search** by city or country name
- **continent** (EU / AS / AM / AF / OC)
- **tier** (1 = iconic … 4 = niche)
- **source** — every distinct `source` tag from the manifest is a chip; click
  it to see exactly which cities have images from that source. Use this to
  decide which sources to ban before rebuilding.

## Curating sources

Open the app, hover the bottom-right pill while you play — it shows the source
tag of each image (e.g. `category-aerial`, `search-fromabove`, `wikipedia-summary`).
If a source consistently produces bad photos, blacklist it in
`scripts/build-cities.mjs` and rerun `npm run build:cities`. You can also
override a city's category by setting `commonsCategory` on its entry in
`scripts/cities.mjs`.

## Attribution

All images are linked back to their Wikimedia Commons / Wikipedia source page
from the in-app pill. Licenses (mostly CC BY-SA, public domain, etc.) are
captured in the manifest under each image's `license` field.
