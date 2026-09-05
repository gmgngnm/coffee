/* ==================================================================== *
 *  Coffeerence — coffee と coherence。淹れ方と味を記録し、注ぐ
 *  タイミングを知らせるタイマーを持つ、コーヒーの記録帳。
 *
 *  作りは意図的に素朴に保っている。ビルド工程を持たず、index.html から
 *  この1ファイルを読むだけで動く。
 *
 *  記録はこの端末の IndexedDB にだけ置く。アカウントも、送信先の
 *  サーバも持たない。淹れた記録がどこかへ流れていくことはない。
 *  持ち出すときは、設定からCSVで書き出す。
 *
 *   1. 下ごしらえ（定数・小道具）
 *   2. IndexedDB
 *   3. 設定
 *   4. レシピと記録（読み書き）
 *   5. 音（チャイム・読み上げ）
 *   6. タイマー
 *   7. 画面 — 淹れる／タイマー／記録／詳細／記録の編集／レシピ／設定
 *   8. 起動
 * ==================================================================== */

const APP_VERSION = "1.8.0";

/* ホームのロゴの下に #002 の形で出す、mainへマージした回数。
   マージのたびに1つ増やす（この見た目になるまでに何回積んだか） */
const MERGE_COUNT = 10;

/* ------------------------------------------------------------------ *
 * 1. 下ごしらえ
 * ------------------------------------------------------------------ */
const $  = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function newId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* 秒 → 3:05 の形。タイマーの表示にも記録の表示にも使う */
function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* "3:05" も "185" も秒として読む。空欄は null（未入力と0を区別する） */
function parseClock(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const mm = Number(m) || 0;
    const ss = Number(s) || 0;
    return mm * 60 + ss;
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* 英語は1つのときだけ語尾が変わる。数と語をまとめて組む */
function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function fmtDate(ms) {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function fmtDateTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/* <input type="datetime-local"> は端末のローカル時刻の文字列を欲しがる */
function toLocalInput(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(text) {
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

function ratioText(doseG, waterG) {
  const d = num(doseG), w = num(waterG);
  if (!d || !w) return "—";
  return `1:${(w / d).toFixed(1).replace(/\.0$/, "")}`;
}

function starsHtml(n) {
  const filled = Math.round(num(n, 0) || 0);
  let out = "";
  for (let i = 1; i <= 5; i++) out += i <= filled ? "★" : '<span class="off">★</span>';
  return out;
}

let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* 消す操作の前に一度だけ訊く。confirm() はPWAだと素っ気ないので自前 */
function confirmAsk(text) {
  return new Promise((resolve) => {
    const backdrop = $("confirm-backdrop");
    $("confirm-text").textContent = text;
    backdrop.hidden = false;
    const close = (answer) => {
      backdrop.hidden = true;
      $("confirm-yes").onclick = null;
      $("confirm-no").onclick = null;
      backdrop.onclick = null;
      resolve(answer);
    };
    $("confirm-yes").onclick = () => close(true);
    $("confirm-no").onclick = () => close(false);
    backdrop.onclick = (e) => { if (e.target === backdrop) close(false); };
  });
}

/* ------------------------------------------------------------------ *
 * 2. IndexedDB
 *    レシピ・記録・設定を置く。全部合わせても小さいので、起動時に
 *    まとめてメモリへ読み込み、以降は同期的に扱う。
 * ------------------------------------------------------------------ */
/* 名前は BrewNote 時代のまま。ここを変えると、すでに端末に入っている
   記録が別の入れ物に取り残されてしまう。外から見える名前ではない */
const DB_NAME = "brewnote";
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("recipes")) db.createObjectStore("recipes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("brews"))   db.createObjectStore("brews",   { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv"))      db.createObjectStore("kv",      { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbAll(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(store, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbPutMany(store, values) {
  if (!values.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    values.forEach((v) => os.put(v));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function kvGet(k, fallback = null) {
  const db = await openDb();
  return new Promise((resolve) => {
    const req = db.transaction("kv", "readonly").objectStore("kv").get(k);
    req.onsuccess = () => resolve(req.result ? req.result.v : fallback);
    req.onerror = () => resolve(fallback);
  });
}
const kvSet = (k, v) => idbPut("kv", { k, v });

/* ------------------------------------------------------------------ *
 * 3. 設定
 * ------------------------------------------------------------------ */
/* アクセントはコーヒーの色だけで作る。浅煎りから深煎りへ、豆の色が
   深くなる順に並べている。明るい面では白文字を載せるので濃いめの側を、
   暗い面では暗い文字を載せるので明るめの側を使う。どの段も、それぞれの
   面に対して4.5:1以上の明暗差がある */
const ROASTS = [
  { id: "light",       name: "Light",       light: "#956026", dark: "#EAB77C" },
  { id: "medium-light", name: "Medium-light", light: "#8A5324", dark: "#DFA666" },
  { id: "medium",      name: "Medium",      light: "#7C4522", dark: "#D39455" },
  { id: "medium-dark", name: "Medium-dark", light: "#65351E", dark: "#C7864B" },
  { id: "dark",        name: "Dark",        light: "#4B2517", dark: "#BA7A45" },
];
const findRoast = (id) => ROASTS.find((r) => r.id === id) || ROASTS[2];

const DEFAULT_SETTINGS = {
  chime: true,       // 手順の時刻にチーンと鳴らす
  precue: true,      // 3秒前に小さく予告する
  vibe: true,        // 対応端末でバイブ
  wakelock: true,    // タイマー中は画面を消さない
  volume: 70,
  theme: "auto",
  roast: "medium",   // アクセントの焙煎度
};
let settings = { ...DEFAULT_SETTINGS };

/* いま実際に暗い面かどうか。設定が「端末に合わせる」のときだけ端末に訊く */
function isDarkNow() {
  if (settings.theme === "dark") return true;
  if (settings.theme === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", settings.theme);
  const dark = isDarkNow();
  const roast = findRoast(settings.roast);
  root.style.setProperty("--accent", dark ? roast.dark : roast.light);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#101711" : roast.light);
}

async function saveSettings() {
  await kvSet("settings", settings);
}

/* ------------------------------------------------------------------ *
 * 4. レシピと記録
 *    どちらも「消したこと」自体を updatedAt 付きで残す（deleted）。
 *    そうしないと、別の端末から消した記録が同期のたびに蘇ってしまう。
 * ------------------------------------------------------------------ */
let recipes = [];   // 削除済みも含む生の配列
let brews = [];

const liveRecipes = () => recipes.filter((r) => !r.deleted).sort((a, b) => (b.usedAt || b.createdAt) - (a.usedAt || a.createdAt));
const liveBrews   = () => brews.filter((b) => !b.deleted).sort((a, b) => b.brewedAt - a.brewedAt);
const findRecipe  = (id) => recipes.find((r) => r.id === id && !r.deleted) || null;
const findBrew    = (id) => brews.find((b) => b.id === id && !b.deleted) || null;

function emptyRecipe() {
  const now = Date.now();
  return {
    id: newId(), name: "", method: "V60", grind: "Medium-fine",
    doseG: 15, waterG: 240, tempC: 92,
    steps: [{ at: 0, kind: "pour", water: 45, label: "Bloom", note: "" }],
    totalSec: 180, memo: "",
    createdAt: now, updatedAt: now, usedAt: 0, deleted: false,
  };
}

function emptyBrew() {
  const now = Date.now();
  return {
    id: newId(), brewedAt: now,
    bean: "", roaster: "", roast: "",
    method: "", grind: "", grinder: "",
    doseG: null, waterG: null, tempC: null, timeSec: null,
    recipeId: "", recipeName: "",
    taste: { acidity: 3, sweetness: 3, bitterness: 3, body: 3, aroma: 3 },
    rating: 0, flavors: [], notes: "", next: "",
    createdAt: now, updatedAt: now, deleted: false,
  };
}

async function saveRecipe(recipe) {
  recipe.updatedAt = Date.now();
  const i = recipes.findIndex((r) => r.id === recipe.id);
  if (i >= 0) recipes[i] = recipe; else recipes.push(recipe);
  await idbPut("recipes", recipe);
}

async function saveBrew(brew) {
  brew.updatedAt = Date.now();
  const i = brews.findIndex((b) => b.id === brew.id);
  if (i >= 0) brews[i] = brew; else brews.push(brew);
  await idbPut("brews", brew);
}

/* 削除は「墓標」を残す。中身は捨ててよいが、idと時刻は同期のために要る */
async function removeRecord(store, id) {
  const list = store === "recipes" ? recipes : brews;
  const rec = list.find((r) => r.id === id);
  if (!rec) return;
  rec.deleted = true;
  rec.updatedAt = Date.now();
  await idbPut(store, rec);
}

/* 最初に開いたときだけ入れる、よく知られたレシピ。
   使いながら自分の一杯へ寄せていくための出発点 */
function starterRecipes() {
  const now = Date.now();
  const mk = (name, method, grind, doseG, waterG, tempC, totalSec, steps, memo) => ({
    id: newId(), name, method, grind, doseG, waterG, tempC, totalSec, steps, memo,
    createdAt: now, updatedAt: now, usedAt: 0, deleted: false, starter: true,
  });
  return [
    mk("4:6 Method", "V60", "Medium-coarse", 20, 300, 93, 210, [
      { at: 0,   kind: "pour", water: 60,  label: "First pour", note: "The first half sets the sweetness" },
      { at: 45,  kind: "pour", water: 120, label: "Second pour", note: "" },
      { at: 90,  kind: "pour", water: 180, label: "Third pour", note: "The second half sets the strength" },
      { at: 135, kind: "pour", water: 240, label: "Fourth pour", note: "" },
      { at: 165, kind: "pour", water: 300, label: "Fifth pour", note: "" },
      { at: 210, kind: "finish", water: 0, label: "Drawdown", note: "" },
    ], "Two pours for sweetness and acidity, three more for strength."),
    mk("V60 Everyday Cup", "V60", "Medium-fine", 15, 240, 92, 165, [
      { at: 0,   kind: "pour", water: 45,  label: "Bloom", note: "Wet all the grounds and wait 30 s" },
      { at: 30,  kind: "pour", water: 150, label: "Second pour", note: "Circles from the middle out" },
      { at: 75,  kind: "pour", water: 240, label: "Third pour", note: "" },
      { at: 165, kind: "finish", water: 0, label: "Drawdown", note: "" },
    ], "The one to fall back on. A plain 1:16."),
    mk("French Press", "French press", "Coarse", 16, 260, 94, 270, [
      { at: 0,   kind: "pour",   water: 260, label: "Pour it all", note: "Reach every bit of the grounds" },
      { at: 60,  kind: "stir",   water: 0,   label: "Break the crust", note: "Nudge the surface with a spoon" },
      { at: 240, kind: "plunge", water: 0,   label: "Press the plunger", note: "Slowly, all the way down" },
      { at: 270, kind: "finish", water: 0,   label: "Pour it out", note: "Do not leave it sitting" },
    ], "Steep and wait. Coarse grind, four minutes."),
    mk("AeroPress (standard)", "AeroPress", "Medium-fine", 16, 220, 85, 150, [
      { at: 0,   kind: "pour",   water: 220, label: "Pour", note: "" },
      { at: 15,  kind: "stir",   water: 0,   label: "Stir ten times", note: "" },
      { at: 90,  kind: "plunge", water: 0,   label: "Press", note: "Take a slow 30 s" },
      { at: 150, kind: "finish", water: 0,   label: "Ready", note: "" },
    ], "Cooler water. How fast you press changes everything."),
    mk("Iced (flash chilled)", "V60", "Medium-fine", 20, 200, 93, 165, [
      { at: 0,   kind: "wait",   water: 0,   label: "100 g ice in the carafe", note: "Ice goes in first" },
      { at: 10,  kind: "pour",   water: 60,  label: "Bloom", note: "" },
      { at: 45,  kind: "pour",   water: 130, label: "Second pour", note: "" },
      { at: 90,  kind: "pour",   water: 200, label: "Third pour", note: "" },
      { at: 150, kind: "swirl",  water: 0,   label: "Swirl to chill", note: "" },
      { at: 165, kind: "finish", water: 0,   label: "Ready", note: "" },
    ], "200 g water over 100 g ice. Brew it strong, chill it fast."),
  ];
}

/* ------------------------------------------------------------------ *
 * 5. 音
 *    チャイムは音声ファイルを持たず、その場で合成する。オフラインでも
 *    鳴り、読み込み待ちで遅れることもない。
 *
 *    大事なのは「鳴る時刻の正確さ」。画面の更新は端末が背面に回ると
 *    止められてしまうので、音だけは先に Web Audio の時計へ予約して
 *    おく。予約済みの音は、こちらが眠っていても鳴る。
 * ------------------------------------------------------------------ */
let audioCtx = null;
let scheduledNodes = [];   // 予約済みの発振器（中断したら止める）

function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

const volumeGain = () => Math.max(0, Math.min(1, (settings.volume ?? 70) / 100));

/* 金属が鳴るときの倍音は整数倍からずれている。そのずれを真似ると
   ピーではなく「チーン」に近づく */
function bellAt(when, base, dur, gain) {
  const ctx = audioCtx;
  const partials = [[1, 1], [2.01, 0.46], [2.98, 0.26], [4.17, 0.13], [5.43, 0.07]];
  for (const [mult, amp] of partials) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(base * mult, when);
    /* 高い倍音ほど早く消える。これも本物の鐘のふるまい */
    const life = dur * (mult > 3 ? 0.45 : mult > 2 ? 0.7 : 1);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * amp), when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + life);
    osc.connect(g).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + life + 0.05);
    scheduledNodes.push(osc);
  }
}

/* 知らせるのは鐘だけ。ことばは使わない。
   代わりに「鳴らす回数」で何投目かを伝える。
     1投目 … チン
     2投目 … チンチン
     3投目 … チンチンチン
     終わり … チーーン（低く、長く伸ばす）
   注ぐ以外の手順（混ぜる・押すなど）は1回。
   kind: "step" / "finish" / "cue"（予告） */
function scheduleSound(kind, when, count = 1) {
  if (!ensureAudio()) return;
  const v = volumeGain();
  if (v <= 0) return;
  if (kind === "cue") { bellAt(when, 1568, 0.4, 0.09 * v); return; }
  if (kind === "finish") { bellAt(when, 880, 4.4, 0.34 * v); return; }
  /* 数えられる速さで、かつ間延びしない間隔 */
  for (let i = 0; i < Math.max(1, count); i++) {
    bellAt(when + i * 0.26, 1318.5, 0.8, 0.30 * v);
  }
}

function playSoundNow(kind, count = 1) {
  if (!ensureAudio()) return;
  scheduleSound(kind, audioCtx.currentTime + 0.02, count);
}

function cancelScheduledSounds() {
  for (const osc of scheduledNodes) {
    try { osc.stop(0); } catch (err) { /* すでに鳴り終わっている */ }
  }
  scheduledNodes = [];
}

function buzz(pattern) {
  if (!settings.vibe || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch (err) { /* 非対応 */ }
}

/* ------------------------------------------------------------------ *
 * 6. タイマー
 * ------------------------------------------------------------------ */
const KIND_LABEL = {
  pour: "Pour", wait: "Wait", stir: "Stir",
  swirl: "Swirl", plunge: "Press", finish: "Ready",
};

const timer = {
  recipe: null,      // null ならレシピなしの計測
  state: "idle",     // idle | running | paused | done
  baseMs: 0,         // 一時停止までに積んだ経過
  startedWall: 0,    // 走り出した時刻（Date.now）
  firedIdx: -1,      // ここまでの手順は画面・声で知らせ済み
  laps: [],
  ringTotal: 1,      // 表示中の残量（滑らかに追いつかせる）
  ringStep: 1,
  ringAt: 0,
  rafId: 0,
  wakeLock: null,
  startedAt: 0,      // 記録に残すための「淹れ始めた時刻」
};

const timerElapsedMs = () =>
  timer.state === "running" ? timer.baseMs + (Date.now() - timer.startedWall) : timer.baseMs;

/* 分量はレシピ側で決まっている。ここでは手順を時刻順に並べ直すだけ */
function scaledSteps() {
  const r = timer.recipe;
  if (!r) return [];
  const steps = (r.steps || []).map((s) => ({ ...s })).sort((a, b) => a.at - b.at);
  if (!steps.some((s) => s.kind === "finish")) {
    const last = steps.length ? steps[steps.length - 1].at : 0;
    steps.push({ at: Math.max(r.totalSec || 0, last + 30), kind: "finish", water: 0, label: "Ready", note: "" });
  }
  return steps;
}

function timerTotalSec() {
  const steps = scaledSteps();
  if (!steps.length) return 0;
  return Math.max(timer.recipe?.totalSec || 0, steps[steps.length - 1].at);
}

const recipeDose  = () => timer.recipe?.doseG || 0;
const recipeWater = () => timer.recipe?.waterG || 0;

/* 手順の水量は「合計で何gまで」で持っている。その回に注ぐぶんは、
   1つ前の注ぎとの差。画面の主役はこちらの数字 */
function pourAmount(steps, idx) {
  const step = steps[idx];
  if (!step?.water) return 0;
  let prev = 0;
  for (let i = idx - 1; i >= 0; i--) {
    if (steps[i].water) { prev = steps[i].water; break; }
  }
  return step.water - prev;
}

/* 注ぐ手順だけを数えて「何投目か」を出す。回数を知らせるための土台 */
function pourIndex(steps, idx) {
  let n = 0;
  for (let i = 0; i <= idx; i++) if (steps[i].kind === "pour") n++;
  return n;
}
const pourTotal = (steps) => steps.filter((s) => s.kind === "pour").length;

/* 走り出す／再開するたびに、これから来る音を全部予約し直す */
function scheduleUpcomingSounds() {
  cancelScheduledSounds();
  if (!settings.chime || !timer.recipe) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const elapsed = timerElapsedMs() / 1000;
  const now = ctx.currentTime;
  const steps = scaledSteps();
  steps.forEach((step, i) => {
    const delay = step.at - elapsed;
    if (delay < 0) return;
    if (step.kind === "finish") {
      scheduleSound("finish", now + delay);
    } else {
      scheduleSound("step", now + delay, step.kind === "pour" ? pourIndex(steps, i) : 1);
    }
    if (settings.precue && delay > 3.2 && step.kind !== "finish") {
      scheduleSound("cue", now + delay - 3);
    }
  });
}

async function acquireWakeLock() {
  if (!settings.wakelock || !("wakeLock" in navigator)) return;
  try {
    timer.wakeLock = await navigator.wakeLock.request("screen");
    timer.wakeLock.addEventListener("release", () => { timer.wakeLock = null; });
  } catch (err) {
    /* 電池が少ないなど、端末の都合で断られることがある。止める理由ではない */
    console.warn("画面の点灯を維持できませんでした:", err);
  }
}
function releaseWakeLock() {
  try { timer.wakeLock?.release(); } catch (err) { /* すでに解放済み */ }
  timer.wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && timer.state === "running") acquireWakeLock();
});

function openTimer(recipe) {
  stopTimerLoop();
  cancelScheduledSounds();
  releaseWakeLock();
  timer.recipe = recipe ? JSON.parse(JSON.stringify(recipe)) : null;
  timer.state = "idle";
  timer.baseMs = 0;
  timer.firedIdx = -1;
  timer.laps = [];
  timer.startedAt = 0;
  timer.ringTotal = 1;
  timer.ringStep = 1;
  timer.ringAt = 0;
  $("timer-title").textContent = recipe ? recipe.name : "Free timer";
  renderTimerStatic();
  renderTimerLive();
  showScreen("timer");
}

function startTimer() {
  ensureAudio();                       // 最初の指で音を解禁しておく
  if (timer.state === "done") resetTimer();
  if (!timer.startedAt) timer.startedAt = Date.now();
  timer.state = "running";
  timer.startedWall = Date.now();
  scheduleUpcomingSounds();
  acquireWakeLock();
  startTimerLoop();
  renderTimerStatic();
}

function pauseTimer() {
  if (timer.state !== "running") return;
  timer.baseMs = timerElapsedMs();
  timer.state = "paused";
  cancelScheduledSounds();
  releaseWakeLock();
  stopTimerLoop();
  renderTimerStatic();
  renderTimerLive();
}

function resetTimer() {
  timer.state = "idle";
  timer.baseMs = 0;
  timer.firedIdx = -1;
  timer.laps = [];
  timer.startedAt = 0;
  timer.ringTotal = 1;
  timer.ringStep = 1;
  timer.ringAt = 0;
  cancelScheduledSounds();
  releaseWakeLock();
  stopTimerLoop();
  renderTimerStatic();
  renderTimerLive();
}

function finishTimer() {
  /* 画面が背面に回っていると、気づくのが数分後になることがある。
     記録に残す抽出時間は、レシピの合計時間で止めておく */
  const total = timerTotalSec() * 1000;
  timer.baseMs = timer.recipe ? Math.min(timerElapsedMs(), total) : timerElapsedMs();
  timer.state = "done";
  cancelScheduledSounds();
  releaseWakeLock();
  stopTimerLoop();
  buzz([120, 80, 120, 80, 220]);
  renderTimerStatic();
  renderTimerLive();
}

function startTimerLoop() {
  stopTimerLoop();
  const loop = () => {
    renderTimerLive();
    if (timer.state === "running") timer.rafId = requestAnimationFrame(loop);
  };
  timer.rafId = requestAnimationFrame(loop);
}
function stopTimerLoop() {
  if (timer.rafId) cancelAnimationFrame(timer.rafId);
  timer.rafId = 0;
}

/* 手順の時刻をまたいだ瞬間に、振動で知らせる。
   （音そのものは先に予約済みなので、ここでは鳴らさない）
   背面に回っていた間に複数をまたいだときは、最後の1つだけ知らせる。
   3つ前の指示を今さら読み上げても混乱するだけなので */
function announceCrossedSteps(steps, elapsedSec) {
  let last = -1;
  for (let i = timer.firedIdx + 1; i < steps.length; i++) {
    if (steps[i].at <= elapsedSec) last = i; else break;
  }
  if (last < 0) return;
  timer.firedIdx = last;
  const step = steps[last];
  buzz(step.kind === "finish" ? [120, 80, 120, 80, 220] : [90]);
}

/* ------------------------------------------------------------------ *
 * 7. 画面
 * ------------------------------------------------------------------ */
const SCREEN_IDS = {
  brew: "screen-brew",
  timer: "screen-timer",
  log: "screen-log",
  "brew-detail": "screen-brew-detail",
  "brew-edit": "screen-brew-edit",
  recipes: "screen-recipes",
  "recipe-edit": "screen-recipe-edit",
  settings: "screen-settings",
};
const TAB_SCREENS = ["brew", "log", "recipes", "settings"];
const FULL_SCREENS = ["timer"];      // タブバーを隠す画面
let navStack = ["brew"];
let navSuppressHistory = false;

function showScreen(name, { replace = false } = {}) {
  const id = SCREEN_IDS[name];
  if (!id) return;
  for (const key of Object.keys(SCREEN_IDS)) {
    $(SCREEN_IDS[key]).classList.toggle("active", key === name);
  }
  if (TAB_SCREENS.includes(name)) navStack = [name];
  else if (replace) navStack[navStack.length - 1] = name;
  else if (navStack[navStack.length - 1] !== name) navStack.push(name);

  $("tabbar").classList.toggle("hidden", FULL_SCREENS.includes(name));
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("active", tab.dataset.nav === name);
  }
  window.scrollTo(0, 0);
  if (!navSuppressHistory) history.pushState({ screen: name }, "");
}

function goBack() {
  if (navStack.length > 1) {
    navStack.pop();
    showScreen(navStack[navStack.length - 1], { replace: true });
  } else {
    showScreen("brew");
  }
}

/* ---------- 淹れる（ホーム） ---------- */
function renderHome() {
  const hour = new Date().getHours();
  $("greeting").textContent =
    hour < 5  ? "Noch ein Aufguss zu später Stunde?" :
    hour < 11 ? "Guten Morgen. Der erste Aufguss." :
    hour < 17 ? "Zeit für eine Pause." :
                "Wie brühst du heute?";

  renderStats($("home-stats"), liveBrews());

  const list = liveRecipes();
  const box = $("home-recipes");
  box.innerHTML = "";
  if (!list.length) {
    const empty = el("p", "empty-note", "No recipes yet.");
    box.appendChild(empty);
  }
  for (const r of list.slice(0, 4)) box.appendChild(recipeCard(r, false));

  const recent = liveBrews().slice(0, 3);
  $("home-recent-head").hidden = !recent.length;
  const rbox = $("home-recent");
  rbox.innerHTML = "";
  for (const b of recent) rbox.appendChild(brewItem(b));
}

function recipeCard(recipe, withEdit) {
  const card = el("button", "recipe-card");
  card.type = "button";
  const body = el("div", "rc-body");
  body.appendChild(el("div", "rc-name", recipe.name || "(untitled)"));
  const meta = el("div", "rc-meta");
  const bits = [
    recipe.method || "",
    `${recipe.doseG}g / ${recipe.waterG}g`,
    ratioText(recipe.doseG, recipe.waterG),
    fmtClock(recipe.totalSec || 0),
  ].filter(Boolean);
  bits.forEach((t, i) => {
    if (i) meta.appendChild(el("span", "dot", "·"));
    meta.appendChild(el("span", null, t));
  });
  body.appendChild(meta);
  card.appendChild(body);

  if (withEdit) {
    const edit = el("span", "rc-edit");
    edit.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
    edit.addEventListener("click", (e) => { e.stopPropagation(); openRecipeEditor(recipe.id); });
    card.appendChild(edit);
  }
  const go = el("span", "rc-go");
  go.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  card.appendChild(go);
  card.addEventListener("click", () => openTimer(recipe));
  return card;
}

function renderStats(box, list) {
  const now = new Date();
  const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000;
  const week = list.filter((b) => b.brewedAt >= weekAgo);
  const rated = list.filter((b) => b.rating > 0);
  const avg = rated.length ? rated.reduce((s, b) => s + b.rating, 0) / rated.length : 0;
  const methods = {};
  for (const b of list) if (b.method) methods[b.method] = (methods[b.method] || 0) + 1;
  const topMethod = Object.entries(methods).sort((a, b) => b[1] - a[1])[0];

  box.innerHTML = "";
  const cell = (num, unit, label) => {
    const s = el("div", "stat");
    const n = el("div", "stat-num");
    n.textContent = num;
    if (unit) n.appendChild(el("span", "small", unit));
    s.appendChild(n);
    s.appendChild(el("div", "stat-label", label));
    return s;
  };
  box.appendChild(cell(String(week.length), "cups", "last 7 days"));
  box.appendChild(cell(avg ? avg.toFixed(1) : "—", avg ? "★" : "", "average rating"));
  box.appendChild(cell(topMethod ? topMethod[0] : "—", "", "most used"));
}

/* ------------------------------------------------------------------ *
 *  ダイヤル
 *
 *  2本の輪を、縦軸まわりに回しながら描く。回る量は進み具合そのもので、
 *  1周ぶん進むと輪もちょうど1回転する。外側（抽出の全体）と内側
 *  （その回）は逆向きに回す。
 *
 *  輪は板ではなく円筒として扱う。板だと真横を向いた瞬間に線が消えて
 *  しまうが、円筒なら太さのぶんの帯として見え続ける。そのために、
 *  輪を細かい区間に割って奥から順に描き、奥ほど背景に沈ませている。
 *  SVGでは奥行きを持てないので、ここだけcanvasで描く。
 * ------------------------------------------------------------------ */
const TAU = Math.PI * 2;
const RING_SEGMENTS = 90;      // 輪を割る数。多いほど滑らかで、その分重い
const RING_FOCAL = 560;        // 焦点距離（200単位系）。小さいほど遠近が強い
const RINGS = {
  /* 手前に来た区間は遠近で太くなるので、半径は canvas の縁から少し引く。
     向きは、色の残っている側が手前を向くほうを選ぶ。
     fade は色の抜き加減。外側は中央の文字に重なるので少しだけ抜き、
     内側は添えるだけなので前は薄くしすぎていた。いまは抜かない */
  total: { radius: 85, tube: 12, dir: -1, fade: 0.1 },
  step:  { radius: 66, tube: 9,  dir:  1, fade: 0 },
};

function hexToRgb(hex) {
  const h = String(hex).trim().replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

/* 2色を混ぜる。t=0 で a、t=1 で b */
function mixRgb(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
const cssRgb = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;

/* 輪1本を、ひと続きに引ける折れ線の集まりにして返す。
   区間を1本ずつ引くと、線端の処理でどうしても粗が出る。丸めれば色の
   変わり目で3層の端がずれて毛羽立ち、切り落とせば継ぎ目に刻みが残る。
   同じ色で塗れるところをつないでしまえば、どちらも起きない。
   色が残っているのは「まだ来ていない側」。始まった時点で満ちていて、
   進むにつれて減っていく */
const RING_BANDS = 28;         // 奥行きの段数。同じ段はひと続きに塗る

/* 中央の文字がだいたい占める楕円。輪が真横を向くと、この上を横切る。
   そのとき色が濃いままだと数字が読みにくいので、重なる部分だけ抜く */
const TEXT_RX = 58, TEXT_RY = 32;
const overText = (pt) =>
  Math.max(0, 1 - Math.hypot((pt.x - 100) / TEXT_RX, (pt.y - 100) / TEXT_RY));

function ringRuns(spec, remaining, elapsedFrac) {
  const p = Math.max(0, Math.min(1, elapsedFrac || 0));
  const left = Math.max(0, Math.min(1, remaining));
  const theta = spec.dir * p * TAU;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const at = (a) => {
    const x = spec.radius * Math.cos(a);
    const y = spec.radius * Math.sin(a);
    const z = -x * sin;                       // 回した後の奥行き
    const k = RING_FOCAL / (RING_FOCAL - z);  // 手前ほど大きく
    return { x: 100 + x * cos * k, y: 100 + y * k, z, k };
  };

  const pts = [];
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    pts.push(at((i / RING_SEGMENTS) * TAU - Math.PI / 2));
  }

  const runs = [];
  let cur = null;
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const mid = (pts[i].z + pts[i + 1].z) / 2;
    const depth = (mid / spec.radius + 1) / 2;             // 0=奥 1=手前
    const band = Math.round(depth * (RING_BANDS - 1));
    const lit = (i + 0.5) / RING_SEGMENTS < left;
    if (cur && cur.lit === lit && cur.band === band) {
      cur.pts.push(pts[i + 1]);
      cur.zSum += mid; cur.kSum += (pts[i].k + pts[i + 1].k) / 2; cur.n++;
      continue;
    }
    if (cur) runs.push(cur);
    cur = { kind: "run", spec, lit, band, depth,
            pts: [pts[i], pts[i + 1]],
            zSum: mid, kSum: (pts[i].k + pts[i + 1].k) / 2, n: 1 };
  }
  if (cur) runs.push(cur);

  /* 12時のところで輪は閉じている。前後が同じ色・同じ段なら、つないで
     しまわないとそこだけ継ぎ目が見える */
  if (runs.length > 1) {
    const first = runs[0], last = runs[runs.length - 1];
    if (first.lit === last.lit && first.band === last.band) {
      last.pts = last.pts.concat(first.pts.slice(1));
      last.zSum += first.zSum; last.kSum += first.kSum; last.n += first.n;
      runs.shift();
    }
  }
  for (const run of runs) {
    run.z = run.zSum / run.n;
    run.k = run.kSum / run.n;
    run.overText = run.pts.reduce((m, pt) => m + overText(pt), 0) / run.pts.length;
  }
  return runs;
}

/* 何投目がどこに来るかを、輪の上に打つ */
function ringMarks(spec, elapsedFrac, marks) {
  const p = Math.max(0, Math.min(1, elapsedFrac || 0));
  const theta = spec.dir * p * TAU;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  return marks.map((frac) => {
    const a = frac * TAU - Math.PI / 2;
    const x = spec.radius * Math.cos(a), y = spec.radius * Math.sin(a);
    const z = -x * sin;
    const k = RING_FOCAL / (RING_FOCAL - z);
    return {
      kind: "mark", spec, z, k,
      x: 100 + x * cos * k, y: 100 + y * k,
      depth: (z / spec.radius + 1) / 2,
    };
  });
}

/* 管は、同じ道筋を細くしながら3度なぞって丸みを出す。ただし区間ごとに
   3度ずつ塗ると、隣の区間の太い縁塗りが直前の照りを上書きして、縄目の
   ような模様が出る。層ごとにまとめて塗ること */
const RING_PASSES = [
  { w: 1.00, toward: "bg",   amount: 0.34 },   // 縁
  { w: 0.66, toward: null,   amount: 0 },      // 本体
  { w: 0.26, toward: "lite", amount: 0.22 },   // 中ほどの照り
];

function strokeGroup(ctx, runs, bg) {
  for (const pass of RING_PASSES) {
    for (const run of runs) {
      const c = pass.toward === "bg" ? mixRgb(run.base, bg, pass.amount)
        : pass.toward === "lite" ? mixRgb(run.base, [255, 255, 255], pass.amount)
        : run.base;
      ctx.strokeStyle = cssRgb(c);
      ctx.lineWidth = run.width * pass.w;
      ctx.beginPath();
      ctx.moveTo(run.pts[0].x, run.pts[0].y);
      for (let i = 1; i < run.pts.length; i++) ctx.lineTo(run.pts[i].x, run.pts[i].y);
      ctx.stroke();
    }
  }
}

function drawMarks(ctx, list, bg) {
  for (const it of list) {
    ctx.fillStyle = cssRgb(bg);
    ctx.strokeStyle = cssRgb(it.base);
    ctx.lineWidth = 1.7 * it.k;
    ctx.beginPath();
    ctx.arc(it.x, it.y, it.spec.tube * 0.34 * it.k, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
}

function drawDial(totalLeft, totalFrac, stepLeft, stepFrac, showStep, marks) {
  const canvas = $("dial-canvas");
  const size = canvas.clientWidth;
  if (!size) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(size * dpr);
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }

  const ctx = canvas.getContext("2d");
  const k = px / 200;                          // 200単位系で描いて、最後に実寸へ
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, 200, 200);

  const css = getComputedStyle(document.documentElement);
  const on = hexToRgb(css.getPropertyValue("--accent"));
  const off = hexToRgb(css.getPropertyValue("--line"));
  const bg = hexToRgb(css.getPropertyValue("--bg"));
  const faint = hexToRgb(css.getPropertyValue("--ink-faint"));

  /* 奥行きは、透かさずに背景の色へ寄せて出す。半透明で重ねると区間
     どうしの端が二重に乗って粒立つ。不透明なら手前が奥を素直に隠す */
  const paint = (it) => {
    const sink = 0.44 * (1 - it.depth) + it.spec.fade + 0.42 * (it.overText || 0);
    it.base = mixRgb(it.kind === "mark" ? faint : (it.lit ? on : off), bg, sink);
    if (it.kind === "run") it.width = it.spec.tube * it.k;
    return it;
  };
  /* 輪1本はひと続きに塗ってよい。円を回しただけの形は自分自身を隠さない
     ので、奥と手前に割る必要がない（割ると境目に塗り重ねの跡が残る）。
     ただし色は塗り分ける。減った側と残っている側を混ぜて塗ると、境目で
     3層の順序が入れ替わり、弧の先端が縞になる。色ごとに塗り切ること */
  const byZ = (a, b) => a.z - b.z;
  const strokeRing = (runs) => {
    strokeGroup(ctx, runs.filter((r) => !r.lit).sort(byZ), bg);
    strokeGroup(ctx, runs.filter((r) => r.lit).sort(byZ), bg);
  };

  const outer = ringRuns(RINGS.total, totalLeft, totalFrac).map(paint);
  const inner = showStep ? ringRuns(RINGS.step, stepLeft, stepFrac).map(paint) : [];
  const pins = ringMarks(RINGS.total, totalFrac, marks || []).map(paint);

  /* 外側のほうが半径が大きいぶん、奥にも手前にも深く出る。奥半分は外→内、
     手前半分は内→外の順に塗ると、2本の前後が破綻しない */
  /* 線端は丸める。段の変わり目で切り落とすと、曲がりの外側に細い刻みが
     残るため。色の変わり目だけは、残っている側をあとから重ねて、丸い端
     がそのまま弧の先端になるようにする（下の並べ替え） */
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  /* 外側のほうが半径が大きいぶん、手前にも奥にも深く出る。内→外の順に
     塗れば、いちばん手前に来るのは外側の手前半分になり、前後が合う */
  drawMarks(ctx, pins.filter((m) => m.depth < 0.5), bg);
  strokeRing(inner);
  strokeRing(outer);
  drawMarks(ctx, pins.filter((m) => m.depth >= 0.5), bg);
}

/* 値が飛んだときだけ滑らかに追いつく。手順が変わった瞬間、内側の輪は
   空から満杯へ跳ぶので、そのままだとカクッとして安っぽく見える */
function easeToward(current, target, dtMs, tauMs) {
  if (!Number.isFinite(current)) return target;
  return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}

/* ---------- タイマーの見た目 ---------- */
function renderTimerStatic() {
  const free = !timer.recipe;

  const toggle = $("timer-toggle");
  toggle.textContent = timer.state === "running" ? "Pause"
    : timer.state === "paused" ? "Resume"
    : timer.state === "done" ? "Again" : "Start";
  toggle.classList.toggle("running", timer.state === "running");
  $("timer-lap").hidden = !free || timer.state === "idle";
  $("timer-to-log").hidden = !(timer.state === "done" || (free && timer.state !== "idle"));
  $("timer-total").textContent = free ? "" : `/ ${fmtClock(timerTotalSec())}`;
  renderPourDots();
  renderTimerTrack();
}

function renderPourDots() {
  const box = $("pour-dots");
  box.innerHTML = "";
  if (!timer.recipe) return;
  const steps = scaledSteps();
  const total = pourTotal(steps);
  if (total < 2) return;
  for (let i = 0; i < total; i++) box.appendChild(el("span", "pd"));
}

function renderTimerTrack() {
  const box = $("timer-steps");
  box.innerHTML = "";
  if (!timer.recipe) {
    if (!timer.laps.length) return;
    timer.laps.forEach((lap, i) => {
      const row = el("div", "track-step done");
      row.appendChild(el("span", "ts-time mono", fmtClock(lap / 1000)));
      row.appendChild(el("span", "ts-label", `Pour ${i + 1}`));
      box.appendChild(row);
    });
    return;
  }
  const steps = scaledSteps();
  steps.forEach((s, i) => {
    const row = el("div", "track-step");
    row.dataset.idx = String(i);
    row.appendChild(el("span", "ts-time mono", fmtClock(s.at)));
    /* 注ぐ手順は数字だけで足りる。ことばを出すのは、混ぜる・押すなど
       数字にならない手順のときだけにする */
    row.appendChild(el("span", "ts-label", s.kind === "pour" ? "" : (s.label || KIND_LABEL[s.kind] || "")));
    const amount = pourAmount(steps, i);
    if (amount) row.appendChild(el("span", "ts-water mono", `${amount} g`));
    box.appendChild(row);
  });
}

function renderTimerLive() {
  const elapsedSec = timerElapsedMs() / 1000;
  $("timer-elapsed").textContent = fmtClock(elapsedSec);
  const main = $("dial-main");
  const sub = $("dial-sub");

  if (!timer.recipe) {
    /* レシピなしのときは経過そのものが主役。外側を1分で一周させる */
    const sweep = (elapsedSec % 60) / 60;
    drawDial(1 - sweep, sweep, 0, 0, false, []);
    main.textContent = fmtClock(elapsedSec);
    main.classList.remove("with-unit");
    sub.textContent = timer.laps.length ? `${timer.laps.length}` : "";
    $("timer-elapsed").textContent = "";
    $("timer-next").textContent = "";
    return;
  }

  const steps = scaledSteps();
  const total = timerTotalSec();
  if (timer.state === "running") announceCrossedSteps(steps, elapsedSec);

  let curIdx = -1;
  for (let i = 0; i < steps.length; i++) if (steps[i].at <= elapsedSec) curIdx = i; else break;
  const next = steps[curIdx + 1] || null;

  /* 内側は、いまの手順が始まってから次の合図までの進み具合。
     まだ1つ目が来ていない間は、開始から1つ目までを刻む */
  const stepFrom = curIdx >= 0 ? steps[curIdx].at : 0;
  const stepTo = next ? next.at : total;
  const span = stepTo - stepFrom;
  const stepFrac = timer.state === "idle" ? 0
    : (span > 0 ? Math.min(1, (elapsedSec - stepFrom) / span) : 1);
  const totalFrac = Math.min(1, elapsedSec / (total || 1));

  /* 輪は、その進みが始まった時点で満ちていて、進むにつれて減っていく。
     手順が変わると内側は空から満杯へ跳ぶので、そこだけ滑らかに追いつく */
  const now = performance.now();
  const dt = Math.min(120, now - (timer.ringAt || now - 16));
  timer.ringAt = now;
  if (timer.state === "running") {
    timer.ringTotal = easeToward(timer.ringTotal, 1 - totalFrac, dt, 70);
    timer.ringStep = easeToward(timer.ringStep, 1 - stepFrac, dt, 110);
  } else {
    /* 止まっている間は描き直しが来ないので、追いつくのを待てない。
       止めた時点の値をそのまま置く */
    timer.ringTotal = 1 - totalFrac;
    timer.ringStep = 1 - stepFrac;
  }

  /* 注ぎの位置を、外側の輪の上に目印として置く */
  const marks = steps
    .filter((st) => st.kind === "pour")
    .map((st) => st.at / (total || 1));

  drawDial(timer.ringTotal, totalFrac, timer.ringStep, stepFrac, true, marks);

  /* 主役は「この回に注ぐ量」。始める前は、これから注ぐ1投目を見せておく。
     数字にならない手順（混ぜる・押す）のときだけ、ことばに入れ替える */
  const showIdx = timer.state === "idle"
    ? steps.findIndex((st) => st.kind === "pour")
    : curIdx;
  const shown = showIdx >= 0 ? steps[showIdx] : null;
  const amount = shown ? pourAmount(steps, showIdx) : 0;

  if (timer.state === "done") {
    main.textContent = "Fertig";
    main.lang = "de";
    main.classList.remove("with-unit");
    sub.textContent = "Extraktion beendet";
    sub.lang = "de";
  } else if (amount) {
    main.innerHTML = `${amount}<span class="unit">g</span>`;
    main.lang = "";
    sub.lang = "";
    main.classList.add("with-unit");
    sub.textContent = shown.kind === "pour" ? "" : (shown.label || "");
  } else {
    main.textContent = shown ? (shown.label || KIND_LABEL[shown.kind] || "—") : "—";
    main.classList.remove("with-unit");
    sub.textContent = "";
  }
  main.classList.toggle("waiting", timer.state === "idle");

  /* 次の合図までの秒数。数字だけ出す */
  $("timer-next").textContent =
    next && timer.state === "running" ? String(Math.max(0, Math.ceil(next.at - elapsedSec))) : "";

  /* 何投目かは点で示す。今の1つだけ大きくする */
  const dots = $("pour-dots").children;
  const poured = timer.state === "idle" ? 0 : pourIndex(steps, curIdx);
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle("on", i < poured);
    dots[i].classList.toggle("now", i === poured - 1);
  }

  const rows = $("timer-steps").children;
  for (let i = 0; i < rows.length; i++) {
    rows[i].classList.toggle("done", timer.state !== "idle" && i < curIdx);
    rows[i].classList.toggle("current", timer.state !== "idle" && i === curIdx);
  }

  if (timer.state === "running" && elapsedSec >= total) finishTimer();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* タイマーの操作 */
$("timer-toggle").addEventListener("click", () => {
  if (timer.state === "running") pauseTimer();
  else startTimer();
});
$("timer-reset").addEventListener("click", resetTimer);
$("timer-close").addEventListener("click", () => {
  if (timer.state === "running") pauseTimer();
  showScreen("brew");
  renderHome();
});
$("timer-lap").addEventListener("click", () => {
  if (timer.state !== "running") return;
  timer.laps.push(timerElapsedMs());
  playSoundNow("cue");
  buzz([60]);
  renderTimerTrack();
  renderTimerLive();
});
$("timer-mute").addEventListener("click", async () => {
  settings.chime = !settings.chime;
  await saveSettings();
  syncMuteIcon();
  if (timer.state === "running") scheduleUpcomingSounds(); else cancelScheduledSounds();
  toast(settings.chime ? "Sound on" : "Sound off");
});
function syncMuteIcon() {
  const svg = $("timer-mute").querySelector("svg");
  const on = settings.chime;
  svg.querySelector(".wave-1").style.display = on ? "" : "none";
  svg.querySelector(".wave-2").style.display = on ? "" : "none";
  svg.querySelector(".mute-x").style.display = on ? "none" : "";
  const box = $("s-chime");
  if (box) box.checked = on;
}

/* 淹れ終わったら、そのまま味の記録へ。器具や分量は書き写さなくていい */
$("timer-to-log").addEventListener("click", async () => {
  const draft = emptyBrew();
  draft.brewedAt = timer.startedAt || Date.now();
  draft.timeSec = Math.round(timerElapsedMs() / 1000);
  if (timer.recipe) {
    const r = timer.recipe;
    draft.recipeId = r.id;
    draft.recipeName = r.name;
    draft.method = r.method || "";
    draft.grind = r.grind || "";
    draft.doseG = recipeDose();
    draft.waterG = recipeWater();
    draft.tempC = r.tempC ?? null;
    const stored = findRecipe(r.id);
    if (stored) { stored.usedAt = Date.now(); await saveRecipe(stored); }
  }
  /* 前回と同じ豆を使うことが多いので、直近の記録から引き継ぐ */
  const last = liveBrews()[0];
  if (last) {
    draft.bean = last.bean;
    draft.roaster = last.roaster;
    draft.roast = last.roast;
    draft.grinder = last.grinder;
    if (!draft.method) draft.method = last.method;
  }
  openBrewEditor(draft, { isNew: true });
});

/* ---------- 記録の一覧 ---------- */
let logFilter = "all";
let logQuery = "";

function brewItem(brew) {
  const item = el("button", "brew-item");
  item.type = "button";
  const body = el("div", "bi-body");
  body.appendChild(el("div", "bi-title", brew.bean || brew.recipeName || brew.method || "Untitled cup"));
  const bits = [];
  if (brew.method) bits.push(brew.method);
  if (brew.doseG && brew.waterG) bits.push(`${brew.doseG}g/${brew.waterG}g`);
  if (brew.doseG && brew.waterG) bits.push(ratioText(brew.doseG, brew.waterG));
  if (brew.tempC) bits.push(`${brew.tempC}°C`);
  if (brew.timeSec) bits.push(fmtClock(brew.timeSec));
  body.appendChild(el("div", "bi-sub", bits.join(" · ") || "—"));
  item.appendChild(body);

  const right = el("div", "bi-right");
  const stars = el("div", "stars-inline");
  stars.innerHTML = brew.rating ? starsHtml(brew.rating) : "";
  right.appendChild(stars);
  right.appendChild(el("div", "bi-date", fmtDate(brew.brewedAt)));
  item.appendChild(right);

  item.addEventListener("click", () => openBrewDetail(brew.id));
  return item;
}

function renderLog() {
  const all = liveBrews();
  let list = all;
  if (logFilter === "fav") list = list.filter((b) => (b.rating || 0) >= 4);
  if (logFilter === "month") {
    const d = new Date();
    const from = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    list = list.filter((b) => b.brewedAt >= from);
  }
  const q = logQuery.trim().toLowerCase();
  if (q) {
    list = list.filter((b) =>
      [b.bean, b.roaster, b.method, b.grinder, b.notes, b.next, b.recipeName, (b.flavors || []).join(" ")]
        .join(" ").toLowerCase().includes(q));
  }

  renderStats($("log-stats"), all);
  const box = $("log-list");
  box.innerHTML = "";
  $("log-empty").hidden = list.length > 0;
  if (!list.length) {
    $("log-empty").textContent = all.length
      ? "Nothing matches that."
      : "Nothing logged yet. Brew something and it will live here.";
    return;
  }
  let lastKey = "";
  for (const b of list) {
    const d = new Date(b.brewedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== lastKey) {
      box.appendChild(el("div", "month-head", `${MONTHS_FULL[d.getMonth()]} ${d.getFullYear()}`));
      lastKey = key;
    }
    box.appendChild(brewItem(b));
  }
}

$("log-search").addEventListener("input", (e) => { logQuery = e.target.value; renderLog(); });
$("log-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  logFilter = chip.dataset.filter;
  for (const c of $("log-filters").children) c.classList.toggle("active", c === chip);
  renderLog();
});
$("log-add-btn").addEventListener("click", () => {
  const draft = emptyBrew();
  const last = liveBrews()[0];
  if (last) {
    draft.bean = last.bean; draft.roaster = last.roaster; draft.roast = last.roast;
    draft.method = last.method; draft.grind = last.grind; draft.grinder = last.grinder;
    draft.doseG = last.doseG; draft.waterG = last.waterG; draft.tempC = last.tempC;
  }
  openBrewEditor(draft, { isNew: true });
});
$("home-manual-log-btn").addEventListener("click", () => $("log-add-btn").click());

/* ---------- 記録の詳細 ---------- */
const TASTE_AXES = [
  ["acidity", "Acidity"], ["sweetness", "Sweetness"], ["bitterness", "Bitterness"],
  ["body", "Body"], ["aroma", "Aroma"],
];

/* 5つの軸をレーダーで描く。数字の羅列より、輪郭のほうが一杯ごとの
   違いを思い出しやすい */
function tasteRadar(taste) {
  const size = 220, cx = size / 2, cy = size / 2 + 6, R = 72;
  const n = TASTE_AXES.length;
  const point = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (R * Math.max(0, Math.min(5, v))) / 5;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  let svg = `<svg class="radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="Taste balance">`;
  for (let ring = 1; ring <= 5; ring++) {
    const pts = TASTE_AXES.map((_, i) => point(i, ring).map((v) => v.toFixed(1)).join(",")).join(" ");
    svg += `<polygon class="grid" points="${pts}"/>`;
  }
  TASTE_AXES.forEach((_, i) => {
    const [x, y] = point(i, 5);
    svg += `<line class="axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  });
  const shape = TASTE_AXES.map(([key], i) => point(i, taste?.[key] ?? 0).map((v) => v.toFixed(1)).join(",")).join(" ");
  svg += `<polygon class="shape" points="${shape}"/>`;
  TASTE_AXES.forEach(([, label], i) => {
    const [x, y] = point(i, 6.3);
    svg += `<text class="label" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">${label}</text>`;
  });
  return svg + "</svg>";
}

let detailId = "";

function openBrewDetail(id) {
  const b = findBrew(id);
  if (!b) return;
  detailId = id;
  $("detail-title").textContent = fmtDate(b.brewedAt);

  const kv = (label, value, unit) =>
    `<div class="kv"><div class="kv-label">${label}</div><div class="kv-value">${value ?? "—"}${
      value != null && unit ? `<span class="unit">${unit}</span>` : ""}</div></div>`;

  const tags = (b.flavors || []).map((f) => `<span class="tag">${escapeHtml(f)}</span>`).join("");
  const note = (head, body) => body
    ? `<div class="note-block"><div class="note-head">${head}</div><div class="note-body">${escapeHtml(body)}</div></div>`
    : "";

  const sub = [b.roaster, b.roast, b.recipeName ? `Recipe: ${b.recipeName}` : "", fmtDateTime(b.brewedAt)]
    .filter(Boolean).join(" · ");

  $("detail-body").innerHTML = `
    <div class="detail-hero">
      <div class="dh-bean">${escapeHtml(b.bean || b.method || "Untitled cup")}</div>
      <div class="dh-sub">${escapeHtml(sub)}</div>
      <div class="dh-stars">${b.rating ? starsHtml(b.rating) : '<span class="off">★★★★★</span>'}</div>
    </div>
    <div class="kv-grid">
      ${kv("Dose", b.doseG, "g")}
      ${kv("Water", b.waterG, "g")}
      ${kv("Ratio", b.doseG && b.waterG ? ratioText(b.doseG, b.waterG) : null, "")}
      ${kv("Temp", b.tempC, "°C")}
      ${kv("Time", b.timeSec ? fmtClock(b.timeSec) : null, "")}
      ${kv("Grind", b.grind || null, "")}
    </div>
    ${b.method || b.grinder ? `<div class="note-block"><div class="note-head">Gear</div><div class="note-body">${
      escapeHtml([b.method, b.grinder].filter(Boolean).join(" / "))}</div></div>` : ""}
    <div class="radar-box">${tasteRadar(b.taste)}</div>
    ${tags ? `<div class="tag-row">${tags}</div>` : ""}
    ${note("How it went", b.notes)}
    ${note("Next time", b.next)}
    <button class="wide-btn primary" id="detail-rebrew" type="button">Brew this recipe again</button>
    <button class="wide-btn ghost" id="detail-copy" type="button">Start a new log from this</button>
  `;

  const rebrew = $("detail-rebrew");
  const recipe = b.recipeId ? findRecipe(b.recipeId) : null;
  if (recipe) {
    rebrew.addEventListener("click", () => openTimer(recipe));
  } else {
    rebrew.textContent = "Time it without a recipe";
    rebrew.addEventListener("click", () => openTimer(null));
  }
  $("detail-copy").addEventListener("click", () => {
    const copy = { ...JSON.parse(JSON.stringify(b)), id: newId(), brewedAt: Date.now(),
      rating: 0, notes: "", next: "", createdAt: Date.now() };
    openBrewEditor(copy, { isNew: true });
  });

  showScreen("brew-detail");
}

$("detail-edit").addEventListener("click", () => {
  const b = findBrew(detailId);
  if (b) openBrewEditor(JSON.parse(JSON.stringify(b)), { isNew: false });
});

/* ---------- 記録の編集 ---------- */
const FLAVOR_PRESETS = [
  "Floral", "Berry", "Citrus", "Apple", "Grape", "Honey",
  "Chocolate", "Nutty", "Caramel", "Spice", "Tea-like", "Grassy", "Ashy",
];
let editingBrew = null;
let editingIsNew = false;

function refreshSuggestLists() {
  const fill = (id, values) => {
    const dl = $(id);
    if (!dl) return;
    dl.innerHTML = "";
    for (const v of [...new Set(values.filter(Boolean))].slice(0, 40)) {
      const opt = document.createElement("option");
      opt.value = v;
      dl.appendChild(opt);
    }
  };
  const all = liveBrews();
  fill("bean-suggest", all.map((b) => b.bean));
  fill("roaster-suggest", all.map((b) => b.roaster));
  fill("grinder-suggest", all.map((b) => b.grinder));
}

function openBrewEditor(brew, { isNew }) {
  editingBrew = brew;
  editingIsNew = isNew;
  refreshSuggestLists();
  $("brew-edit-title").textContent = isNew ? "Log a brew" : "Edit this brew";
  $("brew-delete").hidden = isNew;

  $("f-brewed-at").value = toLocalInput(brew.brewedAt);
  $("f-bean").value = brew.bean || "";
  $("f-roaster").value = brew.roaster || "";
  $("f-roast").value = brew.roast || "";
  $("f-method").value = brew.method || "";
  $("f-grind").value = brew.grind || "";
  $("f-grinder").value = brew.grinder || "";
  $("f-dose").value = brew.doseG ?? "";
  $("f-water").value = brew.waterG ?? "";
  $("f-temp").value = brew.tempC ?? "";
  $("f-time").value = brew.timeSec ? fmtClock(brew.timeSec) : "";
  $("f-notes").value = brew.notes || "";
  $("f-next").value = brew.next || "";
  updateRatioReadout();
  renderStarPicker();
  renderTasteSliders();
  renderFlavorChips();
  showScreen("brew-edit");
}

function updateRatioReadout() {
  $("f-ratio").textContent = ratioText(num($("f-dose").value), num($("f-water").value));
}
$("f-dose").addEventListener("input", updateRatioReadout);
$("f-water").addEventListener("input", updateRatioReadout);

function renderStarPicker() {
  const box = $("f-rating");
  box.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const b = el("button", `star${i <= (editingBrew.rating || 0) ? " on" : ""}`, "★");
    b.type = "button";
    b.setAttribute("aria-label", `${i} out of 5`);
    b.addEventListener("click", () => {
      /* 同じ星をもう一度押したら取り消し。付け間違いを直せるように */
      editingBrew.rating = editingBrew.rating === i ? 0 : i;
      renderStarPicker();
    });
    box.appendChild(b);
  }
}

function renderTasteSliders() {
  const box = $("f-taste");
  box.innerHTML = "";
  for (const [key, label] of TASTE_AXES) {
    const row = el("div", "taste-row");
    row.appendChild(el("span", "taste-name", label));
    const input = document.createElement("input");
    input.type = "range";
    input.min = "1"; input.max = "5"; input.step = "1";
    input.value = String(editingBrew.taste?.[key] ?? 3);
    const out = el("span", "taste-val mono", input.value);
    input.addEventListener("input", () => {
      editingBrew.taste = editingBrew.taste || {};
      editingBrew.taste[key] = Number(input.value);
      out.textContent = input.value;
    });
    row.appendChild(input);
    row.appendChild(out);
    box.appendChild(row);
  }
}

function renderFlavorChips() {
  const box = $("f-flavors");
  box.innerHTML = "";
  const chosen = editingBrew.flavors || [];
  const all = [...new Set([...FLAVOR_PRESETS, ...chosen])];
  for (const name of all) {
    const chip = el("button", `chip${chosen.includes(name) ? " active" : ""}`, name);
    chip.type = "button";
    chip.addEventListener("click", () => {
      const list = editingBrew.flavors || (editingBrew.flavors = []);
      const i = list.indexOf(name);
      if (i >= 0) list.splice(i, 1); else list.push(name);
      renderFlavorChips();
    });
    box.appendChild(chip);
  }
}

$("f-flavor-add").addEventListener("click", () => {
  const input = $("f-flavor-input");
  const value = input.value.trim();
  if (!value) return;
  editingBrew.flavors = editingBrew.flavors || [];
  if (!editingBrew.flavors.includes(value)) editingBrew.flavors.push(value);
  input.value = "";
  renderFlavorChips();
});
$("f-flavor-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("f-flavor-add").click(); }
});

$("brew-save").addEventListener("click", async () => {
  const b = editingBrew;
  b.brewedAt = fromLocalInput($("f-brewed-at").value);
  b.bean = $("f-bean").value.trim();
  b.roaster = $("f-roaster").value.trim();
  b.roast = $("f-roast").value;
  b.method = $("f-method").value.trim();
  b.grind = $("f-grind").value;
  b.grinder = $("f-grinder").value.trim();
  b.doseG = num($("f-dose").value);
  b.waterG = num($("f-water").value);
  b.tempC = num($("f-temp").value);
  b.timeSec = parseClock($("f-time").value);
  b.notes = $("f-notes").value.trim();
  b.next = $("f-next").value.trim();
  await saveBrew(b);
  toast(editingIsNew ? "Logged" : "Saved");
  renderHome();
  renderLog();
  openBrewDetail(b.id);
});

$("brew-delete").addEventListener("click", async () => {
  if (!(await confirmAsk("Delete this brew? This cannot be undone."))) return;
  await removeRecord("brews", editingBrew.id);
  toast("Deleted");
  renderHome();
  renderLog();
  showScreen("log");
});

/* ---------- レシピの一覧 ---------- */
function renderRecipes() {
  const box = $("recipe-list");
  box.innerHTML = "";
  const list = liveRecipes();
  if (!list.length) {
    box.appendChild(el("p", "empty-note", "No recipes. Add one with the + above."));
    return;
  }
  for (const r of list) box.appendChild(recipeCard(r, true));
}
$("recipe-add-btn").addEventListener("click", () => openRecipeEditor(null));

/* ---------- レシピの編集 ---------- */
let editingRecipe = null;
let editingRecipeIsNew = false;

function openRecipeEditor(id) {
  const found = id ? findRecipe(id) : null;
  editingRecipe = found ? JSON.parse(JSON.stringify(found)) : emptyRecipe();
  editingRecipeIsNew = !found;
  $("recipe-edit-title").textContent = found ? "Edit recipe" : "New recipe";
  $("recipe-delete").hidden = !found;
  $("r-name").value = editingRecipe.name || "";
  $("r-method").value = editingRecipe.method || "";
  $("r-grind").value = editingRecipe.grind || "";
  $("r-dose").value = editingRecipe.doseG ?? "";
  $("r-water").value = editingRecipe.waterG ?? "";
  $("r-temp").value = editingRecipe.tempC ?? "";
  $("r-total").value = fmtClock(editingRecipe.totalSec || 0);
  $("r-memo").value = editingRecipe.memo || "";
  renderStepEditor();
  showScreen("recipe-edit");
}

function renderStepEditor() {
  const box = $("r-steps");
  box.innerHTML = "";
  editingRecipe.steps.forEach((step, i) => {
    const row = el("div", "step-row");

    const grid = el("div", "step-grid");
    const timeField = el("div", "field mini w-time");
    timeField.innerHTML = '<label>At</label>';
    const timeInput = document.createElement("input");
    timeInput.type = "text";
    timeInput.inputMode = "numeric";
    timeInput.value = fmtClock(step.at);
    timeInput.addEventListener("change", () => {
      step.at = parseClock(timeInput.value) ?? 0;
      editingRecipe.steps.sort((a, b) => a.at - b.at);
      renderStepEditor();
    });
    timeField.appendChild(timeInput);
    grid.appendChild(timeField);

    const kindField = el("div", "field mini w-kind");
    kindField.innerHTML = '<label>Kind</label>';
    const kindSelect = document.createElement("select");
    for (const [value, label] of Object.entries(KIND_LABEL)) {
      const opt = document.createElement("option");
      opt.value = value; opt.textContent = label;
      if (step.kind === value) opt.selected = true;
      kindSelect.appendChild(opt);
    }
    kindSelect.addEventListener("change", () => {
      step.kind = kindSelect.value;
      if (step.kind !== "pour") step.water = 0;
      renderStepEditor();
    });
    kindField.appendChild(kindSelect);
    grid.appendChild(kindField);

    const waterField = el("div", "field mini w-water");
    waterField.innerHTML = '<label>Total g</label>';
    const waterInput = document.createElement("input");
    waterInput.type = "number";
    waterInput.inputMode = "decimal";
    waterInput.min = "0";
    waterInput.value = step.water || "";
    waterInput.disabled = step.kind !== "pour";
    waterInput.addEventListener("input", () => { step.water = num(waterInput.value, 0) || 0; });
    waterField.appendChild(waterInput);
    grid.appendChild(waterField);

    const del = el("button", "step-del");
    del.type = "button";
    del.setAttribute("aria-label", "Remove this step");
    del.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    del.addEventListener("click", () => {
      editingRecipe.steps.splice(i, 1);
      renderStepEditor();
    });
    grid.appendChild(del);
    row.appendChild(grid);

    const labelField = el("div", "field mini");
    labelField.style.marginBottom = "0";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = step.kind === "pour" ? "e.g. Second pour" : "e.g. Break the crust";
    labelInput.value = step.label || "";
    labelInput.addEventListener("input", () => { step.label = labelInput.value; });
    labelField.appendChild(labelInput);
    row.appendChild(labelField);

    box.appendChild(row);
  });
}

/* 湯量を変えたら、手順の目標量も同じ割合で動かす。分量を決める場所が
   レシピ画面に移ったぶん、ここで辻褄を合わせないと手順だけ取り残される */
$("r-water").addEventListener("change", () => {
  const next = num($("r-water").value);
  const before = editingRecipe.waterG;
  if (!next || !before || next === before) return;
  const k = next / before;
  let moved = 0;
  for (const step of editingRecipe.steps) {
    if (!step.water) continue;
    step.water = Math.round(step.water * k);
    moved++;
  }
  editingRecipe.waterG = next;
  if (moved) {
    renderStepEditor();
    toast(`Steps rescaled to ${next} g`);
  }
});

$("r-add-step").addEventListener("click", () => {
  const steps = editingRecipe.steps;
  const last = steps[steps.length - 1];
  steps.push({
    at: last ? last.at + 30 : 0,
    kind: "pour",
    water: last?.water ? last.water + 60 : 60,
    label: "", note: "",
  });
  renderStepEditor();
});

$("recipe-save").addEventListener("click", async () => {
  const r = editingRecipe;
  r.name = $("r-name").value.trim() || "Untitled recipe";
  r.method = $("r-method").value.trim();
  r.grind = $("r-grind").value;
  r.doseG = num($("r-dose").value, 15);
  r.waterG = num($("r-water").value, 240);
  r.tempC = num($("r-temp").value);
  r.memo = $("r-memo").value.trim();
  r.steps = r.steps
    .filter((s) => s.kind && Number.isFinite(s.at))
    .sort((a, b) => a.at - b.at);
  const lastAt = r.steps.length ? r.steps[r.steps.length - 1].at : 0;
  /* 合計時間が手順より短いと、最後の手順が鳴る前に終わってしまう */
  r.totalSec = Math.max(parseClock($("r-total").value) ?? 0, lastAt);
  await saveRecipe(r);
  toast(editingRecipeIsNew ? "Recipe created" : "Saved");
  renderRecipes();
  renderHome();
  showScreen("recipes");
});

$("recipe-delete").addEventListener("click", async () => {
  if (!(await confirmAsk("Delete this recipe? This cannot be undone."))) return;
  await removeRecord("recipes", editingRecipe.id);
  toast("Deleted");
  renderRecipes();
  renderHome();
  showScreen("recipes");
});

$("free-timer-btn").addEventListener("click", () => openTimer(null));

/* ---------- 設定 ---------- */
function bindSwitch(id, key, after) {
  const box = $(id);
  box.addEventListener("change", async () => {
    settings[key] = box.checked;
    await saveSettings();
    if (after) after();
  });
}

function renderSettings() {
  $("s-chime").checked = settings.chime;
  $("s-precue").checked = settings.precue;
  $("s-vibe").checked = settings.vibe;
  $("s-wakelock").checked = settings.wakelock;
  $("s-volume").value = String(settings.volume);
  $("s-volume-out").textContent = `${settings.volume}%`;
  $("s-theme").value = settings.theme;
  renderRoastPicker();
  $("app-version").textContent = `v${APP_VERSION}`;
  $("s-data-note").textContent =
    `On this device: ${plural(liveRecipes().length, "recipe")}, ${plural(liveBrews().length, "brew")}`;
}

bindSwitch("s-chime", "chime", () => { syncMuteIcon(); if (timer.state === "running") scheduleUpcomingSounds(); });
bindSwitch("s-precue", "precue", () => { if (timer.state === "running") scheduleUpcomingSounds(); });
bindSwitch("s-vibe", "vibe");
bindSwitch("s-wakelock", "wakelock", () => {
  if (settings.wakelock && timer.state === "running") acquireWakeLock(); else releaseWakeLock();
});
$("s-volume").addEventListener("input", (e) => {
  settings.volume = Number(e.target.value);
  $("s-volume-out").textContent = `${settings.volume}%`;
});
$("s-volume").addEventListener("change", saveSettings);
$("s-test-chime").addEventListener("click", () => playSoundNow("step", 2));
/* 見本の丸は、いま見えている面での色をそのまま塗る。選んだ結果が
   そのとおりに出るほうが、選びやすい */
function renderRoastPicker() {
  const box = $("s-roast");
  if (!box) return;
  const dark = isDarkNow();
  box.innerHTML = "";
  for (const roast of ROASTS) {
    const btn = el("button", `roast-swatch${roast.id === settings.roast ? " on" : ""}`);
    btn.type = "button";
    btn.setAttribute("aria-label", roast.name);
    const dot = el("span", "roast-dot");
    dot.style.background = dark ? roast.dark : roast.light;
    btn.appendChild(dot);
    btn.appendChild(el("span", "roast-name", roast.name));
    btn.addEventListener("click", async () => {
      settings.roast = roast.id;
      applyTheme();
      await saveSettings();
      renderRoastPicker();
      toast(`${roast.name} roast it is`);
    });
    box.appendChild(btn);
  }
  const note = $("s-roast-note");
  if (note) note.textContent = `${findRoast(settings.roast).name} right now. The darker the bean, the deeper the accent.`;
}

$("s-theme").addEventListener("change", async (e) => {
  settings.theme = e.target.value;
  applyTheme();
  await saveSettings();
  renderRoastPicker();
});

/* ---------- CSVで持ち出す ---------- *
 *  記録はこの端末の中にしかないので、持ち出す道を用意する。1杯が1行、
 *  1レシピが1行の表にして、表計算ソフトへ渡す。
 * ------------------------------------------------------------------ */
function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

/* RFC 4180 に沿って組む。区切り・引用符・改行を含む値だけを引用符でくくり、
   中の引用符は2つ重ねて逃がす。
   先頭のBOMは Excel のため。これが無いと、日本語がそのまま化ける */
function toCsv(headers, rows) {
  const cell = (v) => {
    const t = v == null ? "" : String(v);
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return "\uFEFF" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/* 時間は「3:00」と「180」の両方を出す。読むためと、並べ替え・計算のため */
function brewsCsv() {
  const headers = [
    "Brewed at", "Coffee", "Roaster", "Roast", "Brewer", "Grind", "Grinder setting",
    "Dose (g)", "Water (g)", "Ratio", "Temp (C)", "Brew time", "Brew seconds", "Recipe",
    "Rating", "Acidity", "Sweetness", "Bitterness", "Body", "Aroma", "Flavours", "How it went", "Next time",
  ];
  const rows = liveBrews().slice().reverse().map((b) => [
    fmtDateTime(b.brewedAt),
    b.bean, b.roaster, b.roast, b.method, b.grind, b.grinder,
    b.doseG ?? "", b.waterG ?? "",
    b.doseG && b.waterG ? ratioText(b.doseG, b.waterG) : "",
    b.tempC ?? "",
    b.timeSec ? fmtClock(b.timeSec) : "", b.timeSec ?? "",
    b.recipeName,
    b.rating || "",
    ...TASTE_AXES.map(([key]) => b.taste?.[key] ?? ""),
    (b.flavors || []).join(" / "),
    b.notes, b.next,
  ]);
  return toCsv(headers, rows);
}

/* 手順は行を分けず、1つの欄にまとめる。1レシピ=1行のほうが表として扱いやすい */
function recipesCsv() {
  const headers = [
    "Recipe", "Brewer", "Grind", "Dose (g)", "Water (g)", "Ratio", "Temp (C)",
    "Total time", "Steps", "Sequence", "Notes",
  ];
  const rows = liveRecipes().map((r) => {
    const steps = (r.steps || []).slice().sort((a, b) => a.at - b.at);
    const text = steps.map((st) =>
      [fmtClock(st.at), st.label || KIND_LABEL[st.kind] || "", st.water ? `${st.water}g` : ""]
        .filter(Boolean).join(" ")).join(" / ");
    return [
      r.name, r.method, r.grind, r.doseG ?? "", r.waterG ?? "",
      ratioText(r.doseG, r.waterG), r.tempC ?? "",
      fmtClock(r.totalSec || 0), steps.length, text, r.memo,
    ];
  });
  return toCsv(headers, rows);
}

$("s-export-csv").addEventListener("click", () => {
  const n = liveBrews().length;
  if (!n) { toast("Nothing to export yet"); return; }
  downloadFile(`coffeerence-records-${today()}.csv`, brewsCsv(), "text/csv;charset=utf-8");
  toast(`${plural(n, "brew")} exported`);
});

$("s-export-recipes-csv").addEventListener("click", () => {
  const n = liveRecipes().length;
  if (!n) { toast("No recipes to export"); return; }
  downloadFile(`coffeerence-recipes-${today()}.csv`, recipesCsv(), "text/csv;charset=utf-8");
  toast(`${plural(n, "recipe")} exported`);
});

$("s-restore-recipes").addEventListener("click", async () => {
  const existing = new Set(liveRecipes().map((r) => r.name));
  const add = starterRecipes().filter((r) => !existing.has(r.name));
  if (!add.length) { toast("They are all here already"); return; }
  recipes.push(...add);
  await idbPutMany("recipes", add);
  renderRecipes(); renderHome(); renderSettings();
  toast(`${plural(add.length, "recipe")} put back`);
});

/* ------------------------------------------------------------------ *
 * 8. 起動
 * ------------------------------------------------------------------ */
for (const btn of document.querySelectorAll("[data-nav]")) {
  btn.addEventListener("click", () => {
    const name = btn.dataset.nav;
    if (name === "brew") renderHome();
    if (name === "log") renderLog();
    if (name === "recipes") renderRecipes();
    if (name === "settings") renderSettings();
    showScreen(name);
  });
}
for (const btn of document.querySelectorAll("[data-back]")) {
  btn.addEventListener("click", goBack);
}
window.addEventListener("popstate", () => {
  navSuppressHistory = true;
  goBack();
  navSuppressHistory = false;
});

/* タイマーを動かしたまま離れようとしたら、一度だけ引き止める */
window.addEventListener("beforeunload", (e) => {
  if (timer.state !== "running") return;
  e.preventDefault();
  e.returnValue = "";
});

async function boot() {
  settings = { ...DEFAULT_SETTINGS, ...(await kvGet("settings", {})) };
  applyTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    applyTheme();
    renderRoastPicker();
  });

  recipes = await idbAll("recipes");
  brews = await idbAll("brews");

  /* 空っぽの画面から始めさせない。最初の一度だけ、よく知られた
     レシピを置いておく（消したあとに勝手に戻ってこないよう印を残す） */
  if (!recipes.length && !(await kvGet("seeded", false))) {
    const starters = starterRecipes();
    recipes = starters;
    await idbPutMany("recipes", starters);
    await kvSet("seeded", true);
  }

  $("build-tag").textContent = `#${String(MERGE_COUNT).padStart(3, "0")}`;
  syncMuteIcon();
  renderHome();
  renderLog();
  renderRecipes();
  renderSettings();
  showScreen("brew");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js", { scope: "./" })
      .catch((err) => console.warn("Service Workerを登録できませんでした:", err));
  }
}

boot().catch((err) => {
  console.error("起動に失敗しました:", err);
  document.body.innerHTML =
    '<p style="padding:40px;text-align:center;line-height:2;">'
    + "Could not open the app.<br>Try reloading the page.</p>";
});
