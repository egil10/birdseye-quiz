// birdseye-quiz — main app logic
// Static, no framework. Loads ./data/cities.json and runs an endless 4-option quiz.

// ---------- constants ----------
const STORAGE_KEY = "birdseye:v1";
const RING_SIZE = 30;             // anti-repeat ring buffer
const REVEAL_MS = 1300;           // auto-advance delay after answer
const K = 24;                     // ELO K-factor
const CITY_RATING_BY_TIER = { 1: 880, 2: 1080, 3: 1380, 4: 1680 };

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
  reset: $("#reset"),
  source: $("#source"),
  srcTag: $("#srcTag"),
  hint: $("#hint"),
  modeBtns: Array.from(document.querySelectorAll(".mode-btn")),
  splash: $("#splash"),
  splashFill: $("#splashFill"),
  cursorGlow: $("#cursorGlow"),
  cursorDot: $("#cursorDot"),
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { elo: 1000, correct: 0, total: 0, streak: 0, best: 0, ...s };
    }
  } catch {}
  return { elo: 1000, correct: 0, total: 0, streak: 0, best: 0 };
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
  saveStats();
  renderStats();
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
  // ensure pool has enough variety
  if (state.pool.length < 4) state.pool = all;
}

// ---------- question generation ----------
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function pickCity() {
  const candidates = state.pool.filter(c => !state.recent.includes(c.id));
  const src = candidates.length >= 4 ? candidates : state.pool;
  return pickRandom(src);
}

function pickOptions(correct) {
  // distractors come from the active pool when it has enough cities,
  // so e.g. "Europe" mode stays all-European.
  const pool = state.pool.length >= 6 ? state.pool : state.manifest.cities;
  const sameContinent = pool
    .filter(c => c.continent === correct.continent && c.id !== correct.id);
  const others = pool.filter(c => c.id !== correct.id);

  const distractors = [];
  // up to 2 distractors from the same continent
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
  const correctIdx = options.indexOf(correct);
  return { options, correctIdx };
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
    console.warn("question build failed, retrying soon:", err);
    state.busy = false;
    setTimeout(showNext, 1500);
    return;
  }

  state.current = q.city;
  state.currentImage = q.image;
  state.options = q.options;
  state.correctIdx = q.correctIdx;

  // bump anti-repeat ring
  state.recent.push(q.city.id);
  if (state.recent.length > RING_SIZE) state.recent.shift();

  // paint
  els.hero.src = q.image.thumb;
  els.hero.alt = `aerial view`; // we don't spoil the answer in alt
  // wait for image to be visible
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

  // start preloading the *next* question in the background
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
  els.revealCountry.textContent = state.current.country;
  els.reveal.hidden = false;

  // source attribution
  els.source.href = state.currentImage.filePageUrl || state.currentImage.full;
  els.srcTag.textContent = (state.currentImage.source || "wikimedia").replace(/^commons-/, "");
  els.source.hidden = false;

  applyResult(state.current, correct);

  setTimeout(() => { if (state.answered) showNext(); }, REVEAL_MS);
}

// ---------- category ----------
function setCategory(cat) {
  if (state.category === cat) return;
  state.category = cat;
  els.modeBtns.forEach(b => b.classList.toggle("is-active", b.dataset.cat === cat));
  state.next = null;
  rebuildPool();
  showNext();
}

// ---------- reset ----------
function resetStats() {
  state.stats = { elo: 1000, correct: 0, total: 0, streak: 0, best: 0 };
  saveStats();
  renderStats();
}

// ---------- cursor glow ----------
function initCursor() {
  let tx = innerWidth / 2, ty = innerHeight / 2;
  let cx = tx, cy = ty;
  let active = false;

  function setRaw(x, y) {
    document.documentElement.style.setProperty("--cur-x-raw", x + "px");
    document.documentElement.style.setProperty("--cur-y-raw", y + "px");
    els.cursorDot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
  }

  addEventListener("pointermove", e => {
    if (e.pointerType === "touch") return;
    tx = e.clientX; ty = e.clientY;
    setRaw(tx, ty);
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

// ---------- input ----------
function initKeys() {
  addEventListener("keydown", e => {
    if (e.repeat) return;
    if (["1","2","3","4"].includes(e.key)) {
      const idx = Number(e.key) - 1;
      if (idx < els.options.length) answer(idx);
    } else if (e.key === " " || e.key === "Enter") {
      if (state.answered) { e.preventDefault(); showNext(); }
    } else if (e.key.toLowerCase() === "r") {
      // dev/debug — quick re-roll without scoring (only if not answered)
      if (!state.answered) showNext();
    }
  });
}

function haptic(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch {} }

function initClicks() {
  els.options.forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      answer(idx);
    });
  });
  els.modeBtns.forEach(btn => {
    btn.addEventListener("click", () => setCategory(btn.dataset.cat));
  });
  els.reset.addEventListener("click", () => {
    if (confirm("reset stats?")) resetStats();
  });
  els.frame.addEventListener("click", () => {
    if (state.answered) showNext();
  });
}

// ---------- splash ----------
function setSplashProgress(p) {
  els.splashFill.style.width = Math.max(0, Math.min(1, p)) * 100 + "%";
}
function hideSplash() {
  els.splash.classList.add("is-gone");
}

// ---------- boot ----------
async function boot() {
  setSplashProgress(0.1);
  initCursor();
  try {
    const res = await fetch("./data/cities.json", { cache: "force-cache" });
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
  } catch (err) {
    console.error(err);
    els.splash.querySelector(".splash-sub").textContent =
      "couldn't load cities. run `npm run build:cities` to build the manifest.";
  }
}

boot();
