// birdseye-quiz — explore page
// Browse every city + image. Filter by continent/tier/source. Click a card
// to see all 4 images with their source provenance.

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const els = {
  grid: $("#grid"),
  meta: $("#exploreMeta"),
  empty: $("#empty"),
  search: $("#search"),
  searchClear: $("#searchClear"),
  contPill: $("#contPill"),
  tierPill: $("#tierPill"),
  sourcePill: $("#sourcePill"),
  modal: $("#modal"),
  modalTitle: $("#modalTitle"),
  modalSub: $("#modalSub"),
  modalGrid: $("#modalGrid"),
  modalClose: $("#modalClose"),
  dust: $("#dust"),
  cursorGlow: $("#cursorGlow"),
  cursorDot: $("#cursorDot"),
};

const state = {
  manifest: null,
  filter: { search: "", continent: "all", tier: "all", source: "all" },
};

// ---------- helpers ----------
function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }

function pickPrimaryImage(city) {
  // Prefer images from category-aerial sources — they're the curated ones.
  const order = [
    "commons-category-aerial",
    "commons-category-aerial-alt",
    "commons-search-aerial",
    "commons-search-skyline",
    "commons-search-fromabove",
    "commons-category-city",
    "wikipedia-summary",
  ];
  const byRank = i => {
    const r = order.indexOf(i.source);
    return r < 0 ? 99 : r;
  };
  return city.images.slice().sort((a, b) => byRank(a) - byRank(b))[0];
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
    card.dataset.id = c.id;
    const img = pickPrimaryImage(c);
    card.innerHTML = `
      <img loading="lazy" decoding="async" alt="${escapeAttr(c.name + ', ' + c.country)}" />
      <span class="card-badge">${escapeHtml(c.continent)} · t${c.tier}</span>
      <span class="card-cap">
        <b>${escapeHtml(c.name)}</b>
        <span class="card-meta">${escapeHtml(c.country)}</span>
      </span>
    `;
    const imgEl = card.querySelector("img");
    imgEl.src = img.thumb;
    imgEl.onload = () => imgEl.classList.add("is-loaded");
    imgEl.onerror = () => { card.style.opacity = "0.5"; };
    card.addEventListener("click", () => openModal(c));
    frag.appendChild(card);
  }
  els.grid.appendChild(frag);
}

// ---------- modal ----------
function openModal(city) {
  els.modalTitle.textContent = city.name;
  els.modalSub.textContent = `${city.country} · ${city.continent} · tier ${city.tier} · ${city.images.length} images`;
  els.modalGrid.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const img of city.images) {
    const item = document.createElement("div");
    item.className = "modal-item";
    item.innerHTML = `
      <img loading="lazy" decoding="async" alt="${escapeAttr(city.name)} aerial" src="${escapeAttr(img.thumb)}" />
      <div class="modal-item-meta">
        <div class="modal-item-row">
          <span class="modal-source-tag">${escapeHtml(img.source)}</span>
          <a class="modal-link" href="${escapeAttr(img.filePageUrl)}" target="_blank" rel="noreferrer noopener">commons ↗</a>
        </div>
        <div class="modal-item-row">
          <span>${escapeHtml(img.width)} × ${escapeHtml(img.height)} · ${escapeHtml(img.license || "—")}</span>
          ${img.author ? `<span>${escapeHtml(img.author)}</span>` : ""}
        </div>
        ${img.sourceQuery ? `<div class="modal-item-row"><span style="font-size:11px;color:var(--dim)">query: ${escapeHtml(img.sourceQuery)}</span></div>` : ""}
      </div>
    `;
    frag.appendChild(item);
  }
  els.modalGrid.appendChild(frag);
  els.modal.classList.add("is-open");
  els.modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  els.modal.classList.remove("is-open");
  els.modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

// ---------- inputs ----------
function initSourcePill() {
  const sources = uniqSources(state.manifest.cities);
  const frag = document.createDocumentFragment();
  for (const s of sources) {
    const b = document.createElement("button");
    b.className = "mode-btn";
    b.dataset.src = s;
    // shorten the label
    b.textContent = s.replace(/^commons-/, "").replace(/-/g, " ");
    frag.appendChild(b);
  }
  els.sourcePill.appendChild(frag);
}

function initFilters() {
  els.search.addEventListener("input", () => {
    state.filter.search = els.search.value;
    els.searchClear.style.opacity = els.search.value ? "1" : "0";
    applyFilter();
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
  els.sourcePill.addEventListener("click", e => {
    const b = e.target.closest("[data-src]");
    if (!b) return;
    els.sourcePill.querySelectorAll(".mode-btn").forEach(x => x.classList.toggle("is-active", x === b));
    state.filter.source = b.dataset.src;
    applyFilter();
  });

  els.modal.addEventListener("click", e => { if (e.target === els.modal) closeModal(); });
  els.modalClose.addEventListener("click", closeModal);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
}

// ---------- cursor + dust (shared with quiz) ----------
function initDust(count = 14) {
  if (!els.dust) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const s = document.createElement("span");
    const x = Math.random() * 100;
    const dur = 18 + Math.random() * 22;
    const delay = -Math.random() * dur;
    const size = 2 + Math.random() * 4;
    const drift = (Math.random() * 80 - 40) + "px";
    s.style.cssText = `left:${x}vw;width:${size}px;height:${size}px;` +
      `animation-duration:${dur}s;animation-delay:${delay}s;--drift:${drift};`;
    frag.appendChild(s);
  }
  els.dust.appendChild(frag);
}

function initCursor() {
  let tx = innerWidth / 2, ty = innerHeight / 2;
  let cx = tx, cy = ty;
  let active = false;

  addEventListener("pointermove", e => {
    if (e.pointerType === "touch") return;
    tx = e.clientX; ty = e.clientY;
    els.cursorDot.style.transform = `translate3d(${tx}px, ${ty}px, 0) translate(-50%, -50%)`;
    if (!active) { active = true; document.body.classList.add("has-cursor"); }
  });
  addEventListener("pointerleave", () => { document.body.classList.remove("has-cursor"); active = false; });
  addEventListener("blur", () => { document.body.classList.remove("has-cursor"); active = false; });

  function loop() {
    cx += (tx - cx) * 0.12;
    cy += (ty - cy) * 0.12;
    els.cursorGlow.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%)`;
    requestAnimationFrame(loop);
  }
  loop();
}

// ---------- boot ----------
async function boot() {
  initCursor();
  initDust();
  try {
    const res = await fetch("./data/cities.json", { cache: "force-cache" });
    if (!res.ok) throw new Error("manifest fetch failed: " + res.status);
    const manifest = await res.json();
    state.manifest = manifest;
    initSourcePill();
    initFilters();
    applyFilter();
  } catch (err) {
    console.error(err);
    els.meta.textContent = "couldn't load cities.json. run `npm run build:cities`.";
  }
}

boot();
