// birdseye-quiz — main app logic
// Static, no framework. Loads ./data/cities.json and runs an endless 4-option quiz.

import { flagHtml } from "./country-flags.mjs";

// ---------- constants ----------
const STORAGE_KEY = "birdseye:v1";
const RING_SIZE = 30;
const REVEAL_MS = 1300;
const K = 24;
const CITY_RATING_BY_TIER = { 1: 880, 2: 1080, 3: 1380, 4: 1680 };
const MAX_ELO_HISTORY = 800;

// ---------- DOM ----------
const $ = sel => document.querySelector(sel);
const els = {
  hero: $("#hero"),
  frame: $("#frame"),
  loader: $("#loader"),
  reveal: $("#reveal"),
  revealName: $("#revealName"),
  revealCountry: $("#revealCountry"),
  options: Array.from(document.querySelectorAll(".pill-opt")),
  streak: $("#streak"),
  accuracy: $("#accuracy"),
  elo: $("#elo"),
  best: $("#best"),
  total: $("#total"),
  pool: $("#pool"),
  reset: $("#reset"),
  source: $("#source"),
  srcTag: $("#srcTag"),
  modeBtns: Array.from(document.querySelectorAll(".mode-btn")),
  splash: $("#splash"),
  splashFill: $("#splashFill"),
  cursorHalo: $("#cursorHalo"),
  eloStat: $("#eloStat"),
  eloModal: $("#eloModal"),
  eloClose: $("#eloClose"),
  eloPlot: $("#eloPlot"),
  eloFoot: $("#eloFoot"),
};

// ---------- state ----------
const state = {
  manifest: null,
  pool: [],
  category: "all",
  current: null,
  currentImage: null,
  options: [],
  correctIdx: -1,
  answered: false,
  busy: false,
  recent: [],
  next: null,
  stats: loadStats(),
};

// ---------- persistence ----------
function loadStats() {
  let s = { elo: 1000, correct: 0, total: 0, streak: 0, best: 0, eloHistory: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) s = { ...s, ...JSON.parse(raw) };
  } catch {}
  if (!Array.isArray(s.eloHistory)) s.eloHistory = [];
  if (s.eloHistory.length === 0) s.eloHistory = [{ n: s.total, e: s.elo }];  // seed a starting point
  return s;
}
function saveStats() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.stats)); } catch {}
}

// ---------- elo ----------
function cityRating(city) { return CITY_RATING_BY_TIER[city.tier] || 1200; }
function expected(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }
function applyResult(city, correct) {
  const cr = cityRating(city);
  const exp = expected(state.stats.elo, cr);
  const score = correct ? 1 : 0;
  state.stats.elo = Math.round(state.stats.elo + K * (score - exp));
  state.stats.total += 1;
  if (correct) {
    state.stats.correct += 1;
    state.stats.streak += 1;
    if (state.stats.streak > state.stats.best) state.stats.best = state.stats.streak;
  } else {
    state.stats.streak = 0;
  }
  state.stats.eloHistory.push({ n: state.stats.total, e: state.stats.elo });
  if (state.stats.eloHistory.length > MAX_ELO_HISTORY) state.stats.eloHistory.shift();
  saveStats();
  renderStats();
  if (els.eloModal && !els.eloModal.hidden) renderEloChart();   // live-update if open
}

// ---------- render ----------
function renderStats() {
  els.streak.textContent = String(state.stats.streak);
  els.best.textContent = String(state.stats.best);
  els.total.textContent = String(state.stats.total);
  els.elo.textContent = String(state.stats.elo);
  els.accuracy.textContent = state.stats.total
    ? Math.round((state.stats.correct / state.stats.total) * 100) + "%"
    : "—";
}

// ---------- pool ----------
function rebuildPool() {
  const all = state.manifest.cities;
  if (state.category === "all") state.pool = all;
  else if (state.category === "famous") state.pool = all.filter(c => c.tier <= 2);
  else state.pool = all.filter(c => c.continent === state.category);
  if (state.pool.length < 4) state.pool = all;
  if (els.pool) els.pool.textContent = String(state.pool.length);
}

// ---------- question generation ----------
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickCity() {
  const candidates = state.pool.filter(c => !state.recent.includes(c.id));
  const src = candidates.length >= 4 ? candidates : state.pool;
  return pickRandom(src);
}
function pickOptions(correct) {
  const pool = state.pool.length >= 6 ? state.pool : state.manifest.cities;
  const sameContinent = pool.filter(c => c.continent === correct.continent && c.id !== correct.id);
  const others = pool.filter(c => c.id !== correct.id);

  const distractors = [];
  const continentPool = sameContinent.slice();
  while (distractors.length < 2 && continentPool.length) {
    const i = Math.floor(Math.random() * continentPool.length);
    distractors.push(continentPool.splice(i, 1)[0]);
  }
  const remainingPool = others.filter(c => !distractors.includes(c));
  while (distractors.length < 3 && remainingPool.length) {
    const i = Math.floor(Math.random() * remainingPool.length);
    distractors.push(remainingPool.splice(i, 1)[0]);
  }
  const options = shuffle([correct, ...distractors]);
  return { options, correctIdx: options.indexOf(correct) };
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- image preload ----------
function preload(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img load fail"));
    img.src = url;
  });
}

async function buildQuestion() {
  const city = pickCity();
  const image = pickRandom(city.images);
  const { options, correctIdx } = pickOptions(city);
  return { city, image, options, correctIdx };
}

async function buildAndPreloadQuestion(maxRetries = 4) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    const q = await buildQuestion();
    try {
      await preload(q.image.thumb);
      return q;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("could not build a question");
}

// ---------- flow ----------
async function showNext() {
  if (state.busy) return;
  state.busy = true;
  state.answered = false;
  els.frame.classList.remove("is-correct", "is-wrong", "is-loaded");
  els.reveal.hidden = true;
  els.options.forEach(b => {
    b.classList.remove("is-correct", "is-wrong", "is-dim");
    b.disabled = false;
  });
  els.source.hidden = true;

  let q;
  try {
    if (state.next) {
      q = state.next;
      state.next = null;
    } else {
      q = await buildAndPreloadQuestion();
    }
  } catch (err) {
    console.warn("question build failed, retrying:", err);
    state.busy = false;
    setTimeout(showNext, 1500);
    return;
  }

  state.current = q.city;
  state.currentImage = q.image;
  state.options = q.options;
  state.correctIdx = q.correctIdx;

  state.recent.push(q.city.id);
  if (state.recent.length > RING_SIZE) state.recent.shift();

  els.hero.src = q.image.thumb;
  els.hero.alt = "aerial view";
  await new Promise(r => {
    if (els.hero.complete && els.hero.naturalWidth) return r();
    els.hero.onload = () => r();
    els.hero.onerror = () => r();
  });
  els.hero.classList.add("is-loaded");
  els.frame.classList.add("is-loaded");

  els.options.forEach((b, i) => {
    b.querySelector(".opt-label").textContent = q.options[i].name;
    b.dataset.city = q.options[i].id;
  });

  state.busy = false;
  buildAndPreloadQuestion().then(n => { state.next = n; }).catch(() => {});
}

function answer(idx) {
  if (state.answered || state.busy) return;
  state.answered = true;
  const correct = idx === state.correctIdx;
  const correctBtn = els.options[state.correctIdx];
  const chosenBtn = els.options[idx];

  correctBtn.classList.add("is-correct");
  if (!correct) chosenBtn.classList.add("is-wrong");
  els.options.forEach((b, i) => {
    b.disabled = true;
    if (i !== state.correctIdx && i !== idx) b.classList.add("is-dim");
  });

  els.frame.classList.add(correct ? "is-correct" : "is-wrong");
  haptic(correct ? 8 : 24);
  els.revealName.textContent = state.current.name;
  els.revealCountry.innerHTML = flagHtml(state.current.country) + `<span>${state.current.country}</span>`;
  els.reveal.hidden = false;

  els.source.href = state.currentImage.filePageUrl || state.currentImage.full;
  els.srcTag.textContent = (state.currentImage.source || "wikimedia").replace(/^commons-/, "");
  els.source.hidden = false;

  applyResult(state.current, correct);
  setTimeout(() => { if (state.answered) showNext(); }, REVEAL_MS);
}

function haptic(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }

function setCategory(cat) {
  if (state.category === cat) return;
  state.category = cat;
  els.modeBtns.forEach(b => b.classList.toggle("is-active", b.dataset.cat === cat));
  state.next = null;
  rebuildPool();
  showNext();
}

function resetStats() {
  state.stats = { elo: 1000, correct: 0, total: 0, streak: 0, best: 0, eloHistory: [{ n: 0, e: 1000 }] };
  saveStats();
  renderStats();
}

// ---------- elo-over-time graph ----------
// "Nice" tick step: 1/2/5 × 10^k, floored at 10 so ticks land on round
// multiples of 10 / 100 / 1000.
function niceStep(span, maxTicks) {
  const raw = Math.max(span, 1) / maxTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = 10 * pow;
  for (const m of [1, 2, 5, 10]) { if (m * pow >= raw) { step = m * pow; break; } }
  return Math.max(step, 10);
}

function renderEloChart() {
  const hist = state.stats.eloHistory || [];
  if (hist.length < 2) {
    els.eloPlot.innerHTML = `<div class="graph-empty">play a few rounds — your elo curve shows up here.</div>`;
    els.eloFoot.textContent = "";
    return;
  }
  const W = 560, H = 320, PAD = { l: 52, r: 16, t: 16, b: 38 };
  const xs = hist.map(p => p.n), ys = hist.map(p => p.e);
  let xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (xMax === xMin) xMax = xMin + 1;
  if (yMax === yMin) { yMin -= 50; yMax += 50; }
  const xStep = niceStep(xMax - xMin, 6);
  const yStep = niceStep(yMax - yMin, 4);
  const x0 = Math.floor(xMin / xStep) * xStep, x1 = Math.ceil(xMax / xStep) * xStep;
  const y0 = Math.floor(yMin / yStep) * yStep, y1 = Math.ceil(yMax / yStep) * yStep;
  const sx = n => PAD.l + (n - x0) / (x1 - x0) * (W - PAD.l - PAD.r);
  const sy = e => H - PAD.b - (e - y0) / (y1 - y0) * (H - PAD.t - PAD.b);

  let g = "";
  for (let x = x0; x <= x1 + 1e-6; x += xStep) {
    const px = sx(x).toFixed(1);
    g += `<line class="ax-grid" x1="${px}" y1="${PAD.t}" x2="${px}" y2="${H - PAD.b}"/>`;
    g += `<text class="ax-lbl" x="${px}" y="${H - PAD.b + 18}" text-anchor="middle">${Math.round(x)}</text>`;
  }
  for (let y = y0; y <= y1 + 1e-6; y += yStep) {
    const py = sy(y).toFixed(1);
    g += `<line class="ax-grid" x1="${PAD.l}" y1="${py}" x2="${W - PAD.r}" y2="${py}"/>`;
    g += `<text class="ax-lbl" x="${PAD.l - 8}" y="${(sy(y) + 3.5).toFixed(1)}" text-anchor="end">${Math.round(y)}</text>`;
  }
  g += `<line class="ax" x1="${PAD.l}" y1="${PAD.t}" x2="${PAD.l}" y2="${H - PAD.b}"/>`;
  g += `<line class="ax" x1="${PAD.l}" y1="${H - PAD.b}" x2="${W - PAD.r}" y2="${H - PAD.b}"/>`;
  const pts = hist.map(p => `${sx(p.n).toFixed(1)},${sy(p.e).toFixed(1)}`).join(" ");
  g += `<polyline class="ax-line" points="${pts}"/>`;
  const last = hist[hist.length - 1];
  g += `<circle class="ax-dot" cx="${sx(last.n).toFixed(1)}" cy="${sy(last.e).toFixed(1)}" r="3.5"/>`;
  g += `<text class="ax-title" x="${(PAD.l + (W - PAD.r)) / 2}" y="${H - 4}" text-anchor="middle">games played</text>`;

  els.eloPlot.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="elo over time">${g}</svg>`;
  els.eloFoot.textContent = `now ${last.e} · peak ${Math.max(...ys)} · low ${Math.min(...ys)} · ${last.n} games`;
}

function openEloChart() { els.eloModal.hidden = false; renderEloChart(); }
function closeEloChart() { els.eloModal.hidden = true; }

// ---------- cursor halo (lightweight, no visible dot) ----------
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

function initKeys() {
  addEventListener("keydown", e => {
    if (e.repeat) return;
    if (!els.eloModal.hidden) {        // graph open: Esc closes, swallow game keys
      if (e.key === "Escape") closeEloChart();
      return;
    }
    if (["1","2","3","4"].includes(e.key)) {
      const idx = Number(e.key) - 1;
      if (idx < els.options.length) answer(idx);
    } else if (e.key === " " || e.key === "Enter") {
      if (state.answered) { e.preventDefault(); showNext(); }
    } else if (e.key.toLowerCase() === "r") {
      if (!state.answered) showNext();
    }
  });
}

function initClicks() {
  els.options.forEach(btn => {
    btn.addEventListener("click", () => answer(Number(btn.dataset.idx)));
  });
  els.modeBtns.forEach(btn => {
    btn.addEventListener("click", () => setCategory(btn.dataset.cat));
  });
  els.reset.addEventListener("click", () => {
    if (confirm("reset stats?")) { resetStats(); if (!els.eloModal.hidden) renderEloChart(); }
  });
  els.frame.addEventListener("click", () => {
    if (state.answered) showNext();
  });
  els.eloStat.addEventListener("click", openEloChart);
  els.eloClose.addEventListener("click", closeEloChart);
  els.eloModal.addEventListener("click", e => { if (e.target === els.eloModal) closeEloChart(); });
}

function setSplashProgress(p) { els.splashFill.style.width = Math.max(0, Math.min(1, p)) * 100 + "%"; }
function hideSplash() { els.splash.classList.add("is-gone"); }

async function boot() {
  setSplashProgress(0.1);
  initCursor();
  try {
    // Lean manifest for the quiz; fall back to the full one if it's missing.
    // Options match the <link rel="preload" as="fetch" crossorigin> in the
    // HTML head so the browser reuses that early request instead of issuing a
    // second one.
    const opts = { cache: "force-cache", mode: "cors", credentials: "omit" };
    let res = await fetch("./data/cities.min.json", opts);
    if (!res.ok) res = await fetch("./data/cities.json", { cache: "force-cache" });
    if (!res.ok) throw new Error("manifest fetch failed: " + res.status);
    const manifest = await res.json();
    setSplashProgress(0.6);
    if (!manifest.cities || !manifest.cities.length) throw new Error("empty manifest");
    state.manifest = manifest;
    rebuildPool();
    renderStats();
    initKeys();
    initClicks();
    await showNext();
    setSplashProgress(1);
    setTimeout(hideSplash, 250);
    if (location.hash === "#elo") openEloChart();
  } catch (err) {
    console.error(err);
    els.splash.querySelector(".splash-sub").textContent =
      "couldn't load cities. run `npm run build:cities` to build the manifest.";
  }
}

boot();
