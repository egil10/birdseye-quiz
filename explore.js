// birdseye-quiz — explore page
// Browse every city + image. Filter by continent/tier/source. Click a card
// to open a lightbox with one large image and a thumb strip for the rest.

import { flagHtml } from "./country-flags.mjs";

const $ = sel => document.querySelector(sel);
const els = {
  grid: $("#grid"),
  meta: $("#exploreMeta"),
  empty: $("#empty"),
  search: $("#search"),
  searchClear: $("#searchClear"),
  contPill: $("#contPill"),
  tierPill: $("#tierPill"),
  sourceSelect: $("#sourceSelect"),
  modal: $("#modal"),
  modalTitle: $("#modalTitle"),
  modalSub: $("#modalSub"),
  modalMain: $("#modalMain"),
  modalInfo: $("#modalInfo"),
  modalThumbs: $("#modalThumbs"),
  modalClose: $("#modalClose"),
  cursorHalo: $("#cursorHalo"),
};

const state = {
  manifest: null,
  filter: { search: "", continent: "all", tier: "all", source: "all" },
  modalCity: null,
  modalImgIdx: 0,
};

// ---------- helpers ----------
function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }

// Wikimedia rejects arbitrary thumbnail widths for direct CDN access — only
// the sizes their API has pre-generated for a given file are valid. The
// manifest already stores a 1280px-wide thumb, which is small enough for the
// grid (the browser downscales it to ~200-300px on display) and large enough
// to look sharp in the lightbox. So no client-side resizing for now.
function gridThumb(img) { return img.thumb; }
function bigThumb(img)  { return img.thumb; }

function pickPrimaryImage(city) {
  const order = [
    "commons-category-aerial",
    "commons-category-aerial-alt",
    "commons-search-aerial",
    "commons-search-skyline",
    "commons-search-fromabove",
    "commons-category-city",
    "wikipedia-summary",
  ];
  const rank = i => {
    const r = order.indexOf(i.source);
    return r < 0 ? 99 : r;
  };
  return city.images.slice().sort((a, b) => rank(a) - rank(b))[0];
}

function uniqSources(cities) {
  const s = new Set();
  for (const c of cities) for (const i of c.images) s.add(i.source);
  return Array.from(s).sort();
}

// ---------- filter ----------
function applyFilter() {
  const f = state.filter;
  const term = f.search.trim().toLowerCase();
  const filtered = state.manifest.cities.filter(c => {
    if (f.continent !== "all" && c.continent !== f.continent) return false;
    if (f.tier !== "all" && String(c.tier) !== f.tier) return false;
    if (f.source !== "all" && !c.images.some(i => i.source === f.source)) return false;
    if (term) {
      const hay = (c.name + " " + c.country).toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });
  render(filtered);
}

// ---------- render ----------
function render(cities) {
  let imgCount = 0;
  for (const c of cities) imgCount += c.images.length;
  els.meta.innerHTML = `showing <b>${cities.length}</b> of ${state.manifest.cities.length} cities · <b>${imgCount}</b> images`;

  els.empty.hidden = cities.length !== 0;
  els.grid.innerHTML = "";
  if (!cities.length) return;

  const frag = document.createDocumentFragment();
  for (const c of cities) {
    const card = document.createElement("article");
    card.className = "card";
    const img = pickPrimaryImage(c);
    card.innerHTML = `
      <img loading="lazy" decoding="async" alt="${escapeAttr(c.name + ', ' + c.country)}" src="${escapeAttr(gridThumb(img))}" />
      <span class="card-cap">
        <b>${escapeHtml(c.name)}</b>
        <span class="card-meta">${flagHtml(c.country)} ${escapeHtml(c.country)}</span>
      </span>
    `;
    const imgEl = card.querySelector("img");
    imgEl.addEventListener("load", () => imgEl.classList.add("is-loaded"), { once: true });
    imgEl.addEventListener("error", () => { card.style.opacity = "0.4"; }, { once: true });
    if (imgEl.complete && imgEl.naturalWidth) imgEl.classList.add("is-loaded");
    card.addEventListener("click", () => openModal(c));
    frag.appendChild(card);
  }
  els.grid.appendChild(frag);
}

// ---------- modal (lightbox) ----------
function openModal(city) {
  state.modalCity = city;
  state.modalImgIdx = 0;
  els.modalTitle.innerHTML = `${escapeHtml(city.name)} ${flagHtml(city.country, { cls: "flag flag-lg" })}`;
  els.modalSub.textContent = `${city.country} · ${city.continent} · tier ${city.tier} · ${city.images.length} images`;
  renderModalThumbs();
  swapModalImage(0);
  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");
}

function renderModalThumbs() {
  els.modalThumbs.innerHTML = "";
  const frag = document.createDocumentFragment();
  state.modalCity.images.forEach((img, idx) => {
    const b = document.createElement("button");
    b.className = "modal-thumb";
    b.type = "button";
    b.innerHTML = `<img loading="lazy" decoding="async" src="${escapeAttr(img.thumb)}" alt="thumb ${idx + 1}" />`;
    b.addEventListener("click", () => swapModalImage(idx));
    frag.appendChild(b);
  });
  els.modalThumbs.appendChild(frag);
}

function swapModalImage(idx) {
  state.modalImgIdx = idx;
  const img = state.modalCity.images[idx];
  els.modalMain.src = bigThumb(img);
  els.modalMain.alt = `${state.modalCity.name} aerial`;
  els.modalInfo.innerHTML = `
    <span><span class="modal-source-tag">${escapeHtml(img.source)}</span> · <b>${img.width || "?"}×${img.height || "?"}</b> · ${escapeHtml(img.license || "—")}${img.author ? ` · ${escapeHtml(img.author)}` : ""}</span>
    <a class="modal-link" href="${escapeAttr(img.filePageUrl)}" target="_blank" rel="noreferrer noopener">commons ↗</a>
  `;
  Array.from(els.modalThumbs.children).forEach((t, i) => t.classList.toggle("is-active", i === idx));
}

function closeModal() {
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  state.modalCity = null;
}

// ---------- filter UI ----------
function initSourceSelect() {
  const sources = uniqSources(state.manifest.cities);
  for (const s of sources) {
    const o = document.createElement("option");
    o.value = s;
    o.textContent = s.replace(/^commons-/, "").replace(/-/g, " ");
    els.sourceSelect.appendChild(o);
  }
  els.sourceSelect.addEventListener("change", () => {
    state.filter.source = els.sourceSelect.value;
    applyFilter();
  });
}

function initFilters() {
  let searchTimer = 0;
  els.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filter.search = els.search.value;
      els.searchClear.style.opacity = els.search.value ? "1" : "0";
      applyFilter();
    }, 80);
  });
  els.searchClear.addEventListener("click", () => {
    els.search.value = "";
    state.filter.search = "";
    els.searchClear.style.opacity = "0";
    applyFilter();
    els.search.focus();
  });
  els.searchClear.style.opacity = "0";

  els.contPill.addEventListener("click", e => {
    const b = e.target.closest("[data-cont]");
    if (!b) return;
    els.contPill.querySelectorAll(".mode-btn").forEach(x => x.classList.toggle("is-active", x === b));
    state.filter.continent = b.dataset.cont;
    applyFilter();
  });
  els.tierPill.addEventListener("click", e => {
    const b = e.target.closest("[data-tier]");
    if (!b) return;
    els.tierPill.querySelectorAll(".mode-btn").forEach(x => x.classList.toggle("is-active", x === b));
    state.filter.tier = b.dataset.tier;
    applyFilter();
  });

  els.modal.addEventListener("click", e => { if (e.target === els.modal) closeModal(); });
  els.modalClose.addEventListener("click", closeModal);
  document.addEventListener("keydown", e => {
    if (!state.modalCity) return;
    if (e.key === "Escape") closeModal();
    else if (e.key === "ArrowRight") swapModalImage((state.modalImgIdx + 1) % state.modalCity.images.length);
    else if (e.key === "ArrowLeft") swapModalImage((state.modalImgIdx - 1 + state.modalCity.images.length) % state.modalCity.images.length);
  });
}

// ---------- cursor halo (no visible dot) ----------
function initCursor() {
  if (!els.cursorHalo) return;
  let tx = innerWidth / 2, ty = innerHeight / 2;
  let cx = tx, cy = ty;
  let active = false;
  let raf = 0;

  const onMove = e => {
    if (e.pointerType === "touch") return;
    tx = e.clientX; ty = e.clientY;
    if (!active) { active = true; document.body.classList.add("has-cursor"); }
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const onLeave = () => { document.body.classList.remove("has-cursor"); active = false; };
  addEventListener("pointermove", onMove, { passive: true });
  addEventListener("pointerleave", onLeave);
  addEventListener("blur", onLeave);

  function tick() {
    raf = 0;
    cx += (tx - cx) * 0.22;
    cy += (ty - cy) * 0.22;
    els.cursorHalo.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%)`;
    if (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5) {
      raf = requestAnimationFrame(tick);
    }
  }
}

// ---------- boot ----------
async function boot() {
  initCursor();
  try {
    const res = await fetch("./data/cities.json", { cache: "force-cache" });
    if (!res.ok) throw new Error("manifest fetch failed: " + res.status);
    const manifest = await res.json();
    state.manifest = manifest;
    initSourceSelect();
    initFilters();
    applyFilter();
  } catch (err) {
    console.error(err);
    els.meta.textContent = "couldn't load cities.json. run `npm run build:cities`.";
  }
}

boot();
