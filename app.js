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

const APP_VERSION = "2.4.1";

/* ホームのロゴの下に #002 の形で出す、mainへマージした回数。
   マージのたびに1つ増やす（この見た目になるまでに何回積んだか） */
const MERGE_COUNT = 16;

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
  countdown: 3,      // 開始を押してから走り出すまでの秒数（0〜10）
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
  alive: false,      // タイマー画面を開いているあいだ true
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
  timer.countUntil = 0;
  timer.baseMs = 0;
  timer.firedIdx = -1;
  timer.laps = [];
  timer.startedAt = 0;
  resetBrewBackground();
  $("timer-title").textContent = recipe ? recipe.name : "Free timer";
  renderTimerStatic();
  renderTimerLive();
  showScreen("timer");
  startTimerLoop();
}

function startTimer() {
  ensureAudio();                       // 最初の指で音を解禁しておく
  if (timer.state === "done") resetTimer();
  /* 押してすぐ始まると、ケトルを構える間がない。既定で3秒だけ数える */
  const wait = timer.state === "idle" ? Math.max(0, Math.min(10, settings.countdown ?? 3)) : 0;
  if (wait > 0) {
    timer.state = "count";
    timer.countUntil = Date.now() + wait * 1000;
    if (settings.chime && ensureAudio()) {
      for (let i = 0; i < wait; i++) scheduleSound("cue", audioCtx.currentTime + i);
    }
    acquireWakeLock();
    startTimerLoop();
    renderTimerStatic();
    return;
  }
  beginRun();
}

/* 数え下げを終えて、実際に走り出す */
function beginRun() {
  if (!timer.startedAt) timer.startedAt = Date.now();
  timer.state = "running";
  timer.startedWall = Date.now();
  cancelScheduledSounds();
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
  renderTimerStatic();
  renderTimerLive();
}

function resetTimer() {
  timer.state = "idle";
  timer.countUntil = 0;
  timer.baseMs = 0;
  timer.firedIdx = -1;
  timer.laps = [];
  timer.startedAt = 0;
  resetBrewBackground();
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
  buzz([120, 80, 120, 80, 220]);
  renderTimerStatic();
  renderTimerLive();
}

/* 背景の液面と湯気は、止めているあいだも揺れていてほしい。走っているか
   どうかではなく、タイマー画面を開いているあいだ回す */
function startTimerLoop() {
  stopTimerLoop();
  timer.alive = true;
  const loop = (now) => {
    renderTimerLive();
    drawBrewBackground(now);
    if (timer.alive) timer.rafId = requestAnimationFrame(loop);
  };
  timer.rafId = requestAnimationFrame(loop);
}
function stopTimerLoop() {
  timer.alive = false;
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
  if (step.kind === "pour") splashPour();
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

  renderHomeStats($("home-stats"), liveBrews());

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

/* ---------- ホームの帯 ---------- *
 *  左は今日の杯数。右は枠2つぶんを使って、ひと月ぶんの1日あたりの
 *  杯数を折れ線で出す。線は1本きりなので凡例は要らない（何の線かは
 *  カードの見出しが言っている）。点ごとに数を書くと読まれないので、
 *  数字は見出しの合計ひとつだけにして、日ごとの数は指でなぞったとき
 *  に出す。目盛りは0の一本だけ、細く、背景に沈めておく
 * ------------------------------------------------------------------ */
const TREND_DAYS = 30;
const SPARK_H = 34;              // 折れ線の高さ（px）
const SPARK_VB = 10;             // 折れ線のviewBoxの高さ
const SPARK_PAD = 0.7;           // 上下の余白（viewBox単位）

function renderHomeStats(box, list) {
  box.innerHTML = "";
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  const today = list.filter((b) => b.brewedAt >= midnight.getTime()).length;
  const left = el("div", "stat");
  const n = el("div", "stat-num");
  n.textContent = String(today);
  n.appendChild(el("span", "small", today === 1 ? "cup" : "cups"));
  left.appendChild(n);
  left.appendChild(el("div", "stat-label", "brewed today"));
  box.appendChild(left);

  box.appendChild(monthTrend(list, midnight));
}

function monthTrend(list, midnight) {
  const DAY = 86400000;
  const counts = new Array(TREND_DAYS).fill(0);
  const dayOf = (ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    /* 夏時間で1日が23時間や25時間になる国があるので、丸めて日数にする */
    return Math.round((d.getTime() - midnight.getTime()) / DAY);
  };
  for (const b of list) {
    const i = TREND_DAYS - 1 + dayOf(b.brewedAt);
    if (i >= 0 && i < TREND_DAYS) counts[i]++;
  }
  const total = counts.reduce((a, c) => a + c, 0);
  const peak = Math.max(1, ...counts);
  const dateAt = (i) => new Date(midnight.getTime() - (TREND_DAYS - 1 - i) * DAY);

  const card = el("div", "stat wide");
  const head = el("div", "stat-head");
  const n = el("div", "stat-num");
  n.textContent = String(total);
  n.appendChild(el("span", "small", total === 1 ? "cup" : "cups"));
  head.appendChild(n);
  const label = el("div", "stat-label", "last 30 days");
  head.appendChild(label);
  card.appendChild(head);

  const yOf = (c) => SPARK_VB - SPARK_PAD - (c / peak) * (SPARK_VB - SPARK_PAD * 2);
  const zero = yOf(0);
  const pts = counts.map((c, i) => `${i} ${yOf(c).toFixed(2)}`);
  const line = "M" + pts.join(" L");

  const spark = el("div", "spark");
  spark.innerHTML =
    `<svg viewBox="0 0 ${TREND_DAYS - 1} ${SPARK_VB}" preserveAspectRatio="none" role="img"` +
    ` aria-label="Cups brewed per day over the last 30 days. ${total} in total,` +
    ` at most ${peak} in a day.">` +
    `<path class="spark-area" d="${line} L${TREND_DAYS - 1} ${zero} L0 ${zero} Z"/>` +
    `<line class="spark-zero" x1="0" y1="${zero}" x2="${TREND_DAYS - 1}" y2="${zero}"/>` +
    `<path class="spark-line" d="${line}"/>` +
    `</svg><span class="spark-dot"></span><span class="spark-cross" hidden></span>`;
  const dot = spark.querySelector(".spark-dot");
  const cross = spark.querySelector(".spark-cross");
  const yPx = (i) => SPARK_H - yOf(counts[i]) * (SPARK_H / SPARK_VB);
  const xPct = (i) => (i / (TREND_DAYS - 1)) * 100;
  const place = (i) => {
    dot.style.left = `calc(${xPct(i).toFixed(2)}% - 4px)`;
    dot.style.bottom = `${yPx(i).toFixed(1)}px`;
  };
  place(TREND_DAYS - 1);
  card.appendChild(spark);

  /* なぞっているあいだ、その日の数を見出しの側に出す */
  const at = (clientX) => {
    const r = spark.getBoundingClientRect();
    if (!r.width) return;
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const i = Math.round(t * (TREND_DAYS - 1));
    label.textContent = `${fmtDate(dateAt(i).getTime())} · ${plural(counts[i], "cup")}`;
    label.classList.add("live");
    place(i);
    cross.hidden = false;
    cross.style.left = `calc(${xPct(i).toFixed(2)}% - 0.5px)`;
  };
  const off = () => {
    label.textContent = "last 30 days";
    label.classList.remove("live");
    place(TREND_DAYS - 1);
    cross.hidden = true;
  };
  spark.addEventListener("pointerdown", (e) => {
    spark.setPointerCapture(e.pointerId);
    at(e.clientX);
  });
  spark.addEventListener("pointermove", (e) => {
    if (e.pressure > 0 || e.pointerType === "mouse") at(e.clientX);
  });
  spark.addEventListener("pointerup", off);
  spark.addEventListener("pointercancel", off);
  spark.addEventListener("pointerleave", off);
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
 *  ダイヤルと背景
 *
 *  円は1周をレシピの手順ごとの区画に割る。区画の幅がその手順の長さ、
 *  過ぎた区画は色が付き、いまの区画だけが少しずつ満ちていく。これで
 *  「レシピの形」と「全体の進み」と「次の合図まで」が1つの絵に収まる。
 *
 *  背景では、注ぐたびに液面が下から迫り上がる。ここは飾りなので、
 *  文字の邪魔をしないよう薄く、下ほど濃く出す。
 * ------------------------------------------------------------------ */
const TAU = Math.PI * 2;

function hexToRgb(hex) {
  const h = String(hex).trim().replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}
function mixRgb(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
const cssRgb = (c) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const cssRgba = (c, a) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

const themeColors = () => {
  const css = getComputedStyle(document.documentElement);
  return {
    accent: hexToRgb(css.getPropertyValue("--accent")),
    line: hexToRgb(css.getPropertyValue("--line")),
    bg: hexToRgb(css.getPropertyValue("--bg")),
  };
};

/* canvas を実寸に合わせ、200単位系で描けるようにして返す */
function prepDial(canvas) {
  const size = canvas.clientWidth;
  if (!size) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.round(size * dpr);
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  const ctx = canvas.getContext("2d");
  const k = px / 200;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, 200, 200);
  return ctx;
}

const DIAL_R = 78;
const DIAL_W = 15;
const SECTOR_GAP = 0.008;      // 区画のあいだの隙間（周に対する割合）

function arcPath(ctx, from, to) {
  const a = (t) => t * TAU - Math.PI / 2;
  ctx.beginPath();
  ctx.arc(100, 100, DIAL_R, a(from), a(to));
}

/* sectors: [{from, to, state}]  state: "past" | "now" | "next"、nowだけ fill を持つ */
function drawSectorDial(sectors) {
  const ctx = prepDial($("dial-canvas"));
  if (!ctx) return;
  const { accent, line, bg } = themeColors();
  const past = mixRgb(accent, bg, 0.55);

  ctx.lineCap = "butt";
  for (const sec of sectors) {
    const from = sec.from + SECTOR_GAP / 2;
    const to = Math.max(from + 0.001, sec.to - SECTOR_GAP / 2);
    ctx.lineWidth = DIAL_W;
    ctx.strokeStyle = cssRgb(sec.state === "past" ? past : line);
    arcPath(ctx, from, to);
    ctx.stroke();
    if (sec.state === "now" && sec.fill > 0) {
      ctx.strokeStyle = cssRgb(accent);
      arcPath(ctx, from, from + (to - from) * Math.min(1, sec.fill));
      ctx.stroke();
    }
  }
}

/* ---------- 背景（滴下・液面・湯気・目盛り） ---------- *
 *  画面をビーカーに見立てる。上のドリッパーから雫が落ち、落ちたぶんだけ
 *  液面が上がる。注いだ直後はポタポタと速く、その回の終わりに近づくほど
 *  間が空いて、ほぼ止まる（溜めた湯が減るほど落ちにくくなる）。
 *  右端には、投ごとの合計量の位置に目盛りを引く。
 * ------------------------------------------------------------------ */
const brew = {
  level: 0,        // 落ちきったぶんの高さ（0〜1）
  target: 0,       // レシピ上、いままでに注いだ量
  counted: 0,      // そのうち、もう雫に割り当てたぶん
  pending: 0,      // ドリッパーに残っていて、これから落ちるぶん
  acc: 0,          // 雫1つぶんに満たない端数
  at: 0,
  drops: [],       // 落ちている雫
  holdUntil: 0,    // ここまでは落ちてこない（蒸らし）
  firstPour: true,
  ripples: [],     // 水面を伝わる波
  puffs: [],       // 湯気
  puffAt: 0,
  marks: [],       // 目盛り（各投の合計量 ml）
  total: 0,        // 湯の合計量
};
const LEVEL_MAX = 0.92;        // 最後は画面の上のほうまで満ちる
const DRIP_TAU = 13;           // 溜めた湯が落ちきるまでの目安（秒）。投の
                               //   頭はよく落ち、次の投までにはほぼ止まる
const DROP_Q = 0.0025;         // 雫1つが上げる高さ。1粒ぶんの上がり幅は
                               //   2px ほどで、水面のうねりより小さい。
                               //   ここを詰めすぎると数が増えて汚くなる
const DROP_G = 1500;           // 雫の落下（px/s²）
const DROP_MAX = 14;           // 同時に落ちる雫の数
const BLOOM_HOLD = 4200;       // 1投目は粉が吸うぶん、落ち始めるまで間がある

function splashPour() { /* 雫は溜まったぶんから自然に落ちる。合図は要らない */ }

function resetBrewBackground() {
  Object.assign(brew, {
    level: 0, target: 0, counted: 0, pending: 0, acc: 0, at: 0,
    drops: [], ripples: [], puffs: [], puffAt: 0,
    holdUntil: 0, firstPour: true,
  });
}

/* 水面の高さ。うねりに、落ちた点から広がる波を重ねる */
function surfaceAt(x, base, t, now) {
  let y = base
    + Math.sin(x / 88 + t * 0.8) * 2.2
    + Math.sin(x / 43 - t * 1.35) * 1.2
    + Math.sin(x / 210 + t * 0.35) * 2.8;
  for (const r of brew.ripples) {
    const age = (now - r.t0) / 1000;
    if (age < 0 || age > 2.2) continue;
    const d = Math.abs(x - r.x);
    const front = age * 170;
    const env = r.power * Math.exp(-age / 0.85) * Math.exp(-Math.abs(d - front) / 70);
    y += Math.sin((d - front) / 22) * 7 * env;
  }
  return y;
}

/* 1粒の雫。下がふくらみ、上へ細く尾を引く本物の形をなぞる。
   単色で塗ると染みになるので、下ほど濃い縦のグラデーションにし、
   左上に小さな照りを置いて、水の玉らしく見せる */
function drawDroplet(ctx, x, y, r, tail, accent) {
  const top = y - r * tail;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.bezierCurveTo(x - r * 0.26, top + r * tail * 0.5, x - r, y - r * 0.8, x - r, y);
  ctx.arc(x, y, r, Math.PI, 0, true);          // ふくらんだ下半分
  ctx.bezierCurveTo(x + r, y - r * 0.8, x + r * 0.26, top + r * tail * 0.5, x, top);
  ctx.closePath();

  const g = ctx.createLinearGradient(0, top, 0, y + r);
  g.addColorStop(0, cssRgba(accent, 0.045));
  g.addColorStop(0.5, cssRgba(accent, 0.15));
  g.addColorStop(1, cssRgba(accent, 0.3));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.ellipse(x - r * 0.33, y - r * 0.28, r * 0.19, r * 0.28, -0.5, 0, TAU);
  ctx.fill();
}

function drawBrewBackground(now) {
  const canvas = $("brew-bg");
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const dtMs = Math.min(120, now - (brew.at || now - 16));
  const dt = dtMs / 1000;
  brew.at = now;
  const t = now / 1000;

  /* 注がれたぶんを、ドリッパーの溜まりに移す */
  if (brew.target > brew.counted) {
    brew.pending += brew.target - brew.counted;
    brew.counted = brew.target;
    /* 1投目は粉が水を含むので、しばらく下へ落ちてこない */
    if (brew.firstPour) { brew.holdUntil = now + BLOOM_HOLD; brew.firstPour = false; }
  }
  if (brew.target < brew.counted) {         // リセットされた
    brew.counted = brew.target;
    brew.pending = 0;
  }

  /* 溜まりが多いほど速く落ちる。減るほど間が空き、やがて止まる。
     淹れ終わったあとまでポタポタ続くのは間延びするので、そこは注がず満たす */
  if (timer.state === "done") {
    if (brew.pending > 0) {
      const q = Math.min(brew.pending, (brew.pending / 1.4 + 0.02) * dt);
      brew.pending -= q;
      brew.level += q;
      if (brew.pending < 0.0008) { brew.level += brew.pending; brew.pending = 0; }
    }
  } else if (brew.pending > 0 && now >= brew.holdUntil) {
    brew.acc += Math.min(brew.pending, (brew.pending / DRIP_TAU) * dt);
    while (brew.acc >= DROP_Q && brew.drops.length < DROP_MAX && brew.pending > 0) {
      const q = Math.min(DROP_Q, brew.pending);
      brew.acc -= DROP_Q;
      brew.pending -= q;
      brew.drops.push({
        /* 注ぎ口は1点。ばらけさせると、垂れるというより降ってくる */
        x: w * 0.5 + (Math.random() - 0.5) * 9,
        y: -18 - Math.random() * 30,
        v: 30 + Math.random() * 40,
        r: 7.5 + Math.random() * 2,
        q,
      });
    }
    /* 数が頭打ちのあいだに溜め込んで、あとで束になって落ちないように */
    brew.acc = Math.min(brew.acc, DROP_Q * 3);
    /* 最後のひとしずくが残り続けないよう、細くなったら畳む */
    if (brew.pending < DROP_Q * 0.4 && !brew.drops.length) {
      brew.level += brew.pending;
      brew.pending = 0;
    }
  }

  const { accent } = themeColors();
  const base = h - brew.level * LEVEL_MAX * h;
  const yAt = (x) => surfaceAt(x, base, t, now);
  brew.ripples = brew.ripples.filter((r) => now - r.t0 < 2200);

  /* --- 液 --- */
  if (brew.level > 0.001) {
    const grad = ctx.createLinearGradient(0, base - 6, 0, Math.min(h, base + 320));
    grad.addColorStop(0, cssRgba(accent, 0.03));
    grad.addColorStop(0.35, cssRgba(accent, 0.13));
    grad.addColorStop(1, cssRgba(accent, 0.2));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = cssRgba(accent, 0.22);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, yAt(x));
    ctx.stroke();
    ctx.strokeStyle = cssRgba(accent, 0.07);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0) + 6);
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, yAt(x) + 6);
    ctx.stroke();
  }

  /* --- 落ちる雫 --- */
  /* 雫は画面のいちばん上から入り、円や文字の裏を素通りして水面へ落ちる */
  for (const d of brew.drops) {
    d.v += DROP_G * dt;
    d.y += d.v * dt;
    const surface = yAt(d.x);
    if (d.y >= surface) {
      brew.level += d.q;
      brew.ripples.push({ t0: now, x: d.x, power: 0.5 + Math.random() * 0.3 });
      d.done = true;
      continue;
    }
    /* 速いほど尾が伸びる */
    drawDroplet(ctx, d.x, d.y, d.r, Math.min(2.5, 1.15 + d.v / 900), accent);
  }
  brew.drops = brew.drops.filter((d) => !d.done);

  /* --- 湯気 --- */
  /* 白く。背景と同じ白ではなく、少し明るい白で浮かせる */
  if (brew.level > 0.006 && now - brew.puffAt > 230) {
    brew.puffAt = now;
    const px = w * (0.34 + Math.random() * 0.32);
    brew.puffs.push({
      x: px, y: yAt(px) - 4, born: now,
      life: 2600 + Math.random() * 1300,
      r: 9 + Math.random() * 7,
      vy: 46 + Math.random() * 26,
      drift: (Math.random() - 0.5) * 30,
      seed: Math.random() * 10,
    });
  }
  brew.puffs = brew.puffs.filter((p) => now - p.born < p.life);
  const steamPeak = isDarkNow() ? 0.34 : 0.9;
  for (const p of brew.puffs) {
    const age = (now - p.born) / p.life;
    const y = p.y - p.vy * ((now - p.born) / 1000) * (1 + age * 1.4);
    const x = p.x + Math.sin(age * 3.1 + p.seed) * 16 + p.drift * age;
    /* 立ちのぼるにつれて縦に伸びる。丸いままだと湯気ではなく泡に見える */
    const rx = p.r * (1 + age * 1.9);
    const ry = rx * (1.5 + age * 0.9);
    /* 湯気は湯が溜まる前から立つ。量で濃さが決まりきると、序盤が消える */
    const a = steamPeak * Math.sin(Math.min(1, age * 1.12) * Math.PI)
      * Math.min(1, 0.5 + brew.level * 4);
    if (a <= 0.004) continue;
    if (y > yAt(x) - 4) continue;          // 水中に湯気は立たない
    /* 白い湯気は白い背景では見えない。ごく淡い影を広めに敷いて、
       白がその中に浮くようにする。輪郭は作らず、あくまで滲みで */
    const halo = ctx.createRadialGradient(x, y, 0, x, y, rx * 1.7);
    halo.addColorStop(0, cssRgba(accent, a * 0.1));
    halo.addColorStop(0.6, cssRgba(accent, a * 0.05));
    halo.addColorStop(1, cssRgba(accent, 0));
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, (ry * 1.7) / (rx * 1.7));
    ctx.translate(-x, -y);
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, rx * 1.7, 0, TAU);
    ctx.fill();
    ctx.restore();

    const g2 = ctx.createRadialGradient(x, y, 0, x, y, rx);
    g2.addColorStop(0, `rgba(255,255,255,${a})`);
    g2.addColorStop(0.5, `rgba(255,255,255,${a * 0.62})`);
    g2.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fill();
  }

  /* --- 目盛り --- */
  /* ビーカーの目盛りは器の側にあるので、液より手前に引く */
  if (brew.total > 0 && brew.marks.length) {
    ctx.font = '11px ' + (getComputedStyle(document.documentElement)
      .getPropertyValue("--font-mono") || "monospace");
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const ml of brew.marks) {
      const y = h - (ml / brew.total) * LEVEL_MAX * h;
      if (y < 26 || y > h - 6) continue;
      ctx.strokeStyle = cssRgba(accent, 0.4);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(w - 14, y);
      ctx.lineTo(w - 34, y);
      ctx.stroke();
      ctx.fillStyle = cssRgba(accent, 0.55);
      ctx.fillText(String(ml), w - 40, y);
    }
    /* いちばん上の目盛りにだけ単位を添える。上に出すとアップバーに
       隠れるので、目盛りの下に置く */
    const topMl = Math.max(...brew.marks);
    const topY = h - (topMl / brew.total) * LEVEL_MAX * h;
    if (topY > 20) {
      ctx.fillStyle = cssRgba(accent, 0.4);
      ctx.fillText("ml", w - 40, topY + 15);
    }
  }
}

/* ---------- タイマーの見た目 ---------- */
/* ボタンは常に1行に収める。淹れ終わりで行が増えると、上の表示がずれる */
function renderTimerStatic() {
  const free = !timer.recipe;
  const st = timer.state;
  const show = (id, on) => { $(id).hidden = !on; };

  const toggle = $("timer-toggle");
  toggle.textContent = st === "count" ? "Stop"
    : st === "running" ? "Pause"
    : st === "paused" ? "Resume" : "Start";
  toggle.classList.toggle("running", st === "running" || st === "count");

  show("timer-reset", st !== "done");
  show("timer-finish", st === "done");
  show("timer-lap", free && st === "running");
  show("timer-toggle", st !== "done");
  show("timer-to-log", st === "done" || (free && st === "paused"));
}

/* 1周を手順ごとの区画に割る。区画の幅がその手順の長さ */
function dialSectors(steps, total, elapsedSec, curIdx) {
  return steps.map((st, i) => {
    const from = st.at / (total || 1);
    const to = (steps[i + 1] ? steps[i + 1].at : total) / (total || 1);
    const span = (to - from) || 1;
    return {
      from, to,
      state: i < curIdx ? "past" : i === curIdx ? "now" : "next",
      fill: i === curIdx ? (elapsedSec - st.at) / (span * (total || 1)) : 0,
    };
  });
}

function renderTimerLive() {
  const main = $("dial-main");
  const sub = $("dial-sub");
  const note = $("timer-note");

  /* 開始前の数え下げ */
  if (timer.state === "count") {
    const left = Math.max(0, timer.countUntil - Date.now());
    if (left <= 0) { beginRun(); return; }
    drawSectorDial(timer.recipe
      ? dialSectors(scaledSteps(), timerTotalSec(), 0, -1)
      : [{ from: 0, to: 1, state: "next", fill: 0 }]);
    main.textContent = String(Math.ceil(left / 1000));
    main.lang = ""; sub.lang = "";
    main.classList.remove("with-unit");
    main.classList.add("waiting", "count");
    sub.textContent = "";
    note.textContent = "";
    $("timer-elapsed").textContent = "0:00";
    return;
  }

  const elapsedSec = timerElapsedMs() / 1000;
  $("timer-elapsed").textContent = fmtClock(elapsedSec);

  if (!timer.recipe) {
    drawSectorDial([{ from: 0, to: 1, state: "now", fill: (elapsedSec % 60) / 60 }]);
    main.textContent = fmtClock(elapsedSec);
    main.lang = ""; sub.lang = "";
    main.classList.remove("with-unit", "count");
    sub.textContent = timer.laps.length ? `${timer.laps.length}` : "";
    note.textContent = "";
    $("timer-elapsed").textContent = "";
    brew.total = 0; brew.marks = [];
    return;
  }

  const steps = scaledSteps();
  const total = timerTotalSec();
  if (timer.state === "running") announceCrossedSteps(steps, elapsedSec);

  let curIdx = -1;
  for (let i = 0; i < steps.length; i++) if (steps[i].at <= elapsedSec) curIdx = i; else break;
  const idle = timer.state === "idle";

  drawSectorDial(dialSectors(steps, total, elapsedSec, idle ? -1 : curIdx));

  /* 円の中はいつも「注ぐ量」。注ぐ以外の手順のあいだは、次に注ぐ量を
     薄く出して備えられるようにする。指示のことばは時間の下へ回す */
  const shownIdx = idle ? steps.findIndex((st) => st.kind === "pour") : curIdx;
  const shown = shownIdx >= 0 ? steps[shownIdx] : null;
  const isPour = shown && shown.kind === "pour";
  let amountIdx = shownIdx;
  if (!isPour) {
    const nextPour = steps.findIndex((st, i) => i > curIdx && st.kind === "pour");
    amountIdx = nextPour;
  }
  const amount = amountIdx >= 0 ? pourAmount(steps, amountIdx) : 0;
  const pours = pourTotal(steps);

  if (timer.state === "done") {
    main.textContent = "Fertig";
    main.lang = "de";
    main.classList.remove("with-unit", "waiting", "count");
    sub.textContent = "Extraktion beendet";
    sub.lang = "de";
    note.textContent = "";
  } else {
    main.lang = ""; sub.lang = "";
    main.classList.remove("count");
    if (amount) {
      main.innerHTML = `${amount}<span class="unit">g</span>`;
      main.classList.add("with-unit");
    } else {
      main.textContent = recipeWater() ? `${recipeWater()}` : "—";
      main.classList.remove("with-unit");
    }
    main.classList.toggle("waiting", idle || !isPour);
    sub.textContent = amountIdx >= 0 && pours > 1
      ? `${pourIndex(steps, amountIdx)} / ${pours}` : "";
    /* 「氷を入れてください」のような指示は、時間の下に */
    const first = steps[0];
    const instruction = idle
      ? (first && first.kind !== "pour" ? first : null)
      : (shown && !isPour ? shown : null);
    note.textContent = instruction ? (instruction.label || KIND_LABEL[instruction.kind] || "") : "";
  }

  /* 背景。注いだ量と、投ごとの目盛り */
  const goal = recipeWater();
  let poured = 0;
  for (let i = 0; i <= curIdx; i++) if (steps[i].water) poured = steps[i].water;
  brew.target = idle || !goal ? 0 : Math.min(1, poured / goal);
  brew.total = goal;
  brew.marks = steps.filter((st) => st.water).map((st) => st.water);

  if (timer.state === "running" && elapsedSec >= total) finishTimer();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* タイマーの操作 */
$("timer-toggle").addEventListener("click", () => {
  if (timer.state === "count") { resetTimer(); return; }   // 数え下げの取り消し
  if (timer.state === "running") pauseTimer();
  else startTimer();
});
$("timer-finish").addEventListener("click", () => {
  stopTimerLoop();
  showScreen("brew");
  renderHome();
});
$("timer-reset").addEventListener("click", resetTimer);
$("timer-close").addEventListener("click", () => {
  if (timer.state === "running") pauseTimer();
  stopTimerLoop();
  showScreen("brew");
  renderHome();
});
$("timer-lap").addEventListener("click", () => {
  if (timer.state !== "running") return;
  timer.laps.push(timerElapsedMs());
  playSoundNow("cue");
  buzz([60]);
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
  $("s-countdown").value = String(settings.countdown);
  $("s-countdown-out").textContent = settings.countdown ? `${settings.countdown} s` : "off";
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
$("s-countdown").addEventListener("input", (e) => {
  settings.countdown = Number(e.target.value);
  $("s-countdown-out").textContent = settings.countdown ? `${settings.countdown} s` : "off";
});
$("s-countdown").addEventListener("change", saveSettings);
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
