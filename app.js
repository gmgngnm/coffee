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

const APP_VERSION = "2.13.0";

/* ホームのロゴの下に #002 の形で出す、mainへマージした回数。
   マージのたびに1つ増やす（この見た目になるまでに何回積んだか） */
const MERGE_COUNT = 37;

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


function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/* ------------------------------------------------------------------ *
 * 1.5 ことば
 *    英語の文そのものが鍵になっている。辞書に無ければ英語がそのまま
 *    出るので、訳し忘れても画面は壊れない。data-i18n を付けた札は
 *    最初に読んだ英語を覚えておき、切り替えのたびにそこから引き直す。
 * ------------------------------------------------------------------ */
const LANGS = [
  { id: "en", name: "English", locale: "en-GB", weekStart: 0 },
  { id: "ja", name: "日本語",  locale: "ja-JP", weekStart: 0 },
  { id: "de", name: "Deutsch", locale: "de-DE", weekStart: 1 },
];

const DICT = {
  ja: {
    /* ホーム */
    "Choose a recipe": "レシピを選ぶ",
    "See all": "すべて見る",
    "Time it without a recipe": "レシピなしで計る",
    "Just log a brew": "記録だけつける",
    "Latest cups": "最近の一杯",
    "Open the log": "ログを開く",
    "No recipes yet.": "レシピがまだありません。",
    "brewed today": "今日淹れた数",
    "last 30 days": "この30日",
    "See the calendar": "カレンダーを見る",
    /* 画面の名前 */
    "Log": "ログ",
    "Recipes": "レシピ",
    "Recipe": "レシピ",
    "Settings": "設定",
    "Calendar": "カレンダー",
    "Brew": "一杯",
    "Log a brew": "一杯を記録",
    "Edit this brew": "記録を直す",
    "Edit recipe": "レシピを直す",
    "New recipe": "新しいレシピ",
    "Back": "戻る",
    "Close": "閉じる",
    "Save": "保存",
    "Add": "足す",
    "Cancel": "やめる",
    "Delete": "消す",
    "Got it": "わかった",
    "Edit": "直す",
    /* タイマー */
    "Start": "はじめる",
    "Stop": "やめる",
    "Pause": "一時停止",
    "Resume": "つづける",
    "Reset": "やり直す",
    "Finish": "おわる",
    "Poured": "注いだ量",
    "now": "いま",
    "next": "つぎ",
    "Sound on": "音あり",
    "Sound off": "音なし",
    "Sound on or off": "音の入切",
    "Counted as one brew": "一杯として数えました",
    "Free timer": "レシピなし",
    /* ログ画面 */
    "All": "すべて",
    "4★ and up": "4★以上",
    "This month": "今月",
    "Search beans, brewers, notes": "豆・器具・メモを探す",
    "Nothing logged yet.": "まだ何もありません。",
    "Brew something and it will live here.": "淹れたら、ここに残ります。",
    "Nothing matches that.": "見つかりませんでした。",
    "Nothing logged yet. Brew something and it will live here.": "まだ何もありません。淹れたら、ここに残ります。",
    "last 7 days": "この7日",
    "average rating": "星の平均",
    "most used": "よく使う器具",
    "Add a brew": "記録を足す",
    /* 記録フォーム */
    "Brewed at": "淹れた日時",
    "Beans": "豆",
    "Coffee": "珈琲",
    "Roaster": "焙煎所",
    "Roast": "焙煎度",
    "Not set": "未設定",
    "Light": "浅煎り",
    "Medium-light": "中浅煎り",
    "Medium": "中煎り",
    "Medium-dark": "中深煎り",
    "Dark": "深煎り",
    "Brewing": "淹れかた",
    "Brewer": "器具",
    "Grind": "挽き目",
    "Extra fine": "極細",
    "Fine": "細",
    "Medium-fine": "中細",
    "Medium-coarse": "中粗",
    "Coarse": "粗",
    "Grinder setting": "ミルの目盛り",
    "Dose (g)": "粉 (g)",
    "Water (g)": "湯 (g)",
    "Temp (°C)": "湯温 (°C)",
    "Brew time": "抽出時間",
    "Ratio": "比率",
    "Taste": "味",
    "Overall": "総合",
    "Overall rating": "総合の星",
    "Acidity": "酸味",
    "Sweetness": "甘み",
    "Bitterness": "苦味",
    "Body": "コク",
    "Aroma": "香り",
    "Flavour notes": "風味の言葉",
    "How was it?": "どうだった？",
    "Next time": "次はこうする",
    "Delete this brew": "この記録を消す",
    "e.g. Ethiopia Yirgacheffe": "例：エチオピア イルガチェフェ",
    "e.g. the shop down the road": "例：近所の店",
    "e.g. V60": "例：V60",
    "e.g. Comandante, 22 clicks": "例：コマンダンテ 22クリック",
    "Add your own word": "自分の言葉を足す",
    "What did it taste like?": "どんな味だった？",
    "e.g. 2°C cooler, grind a touch coarser": "例：湯温を2℃下げる、少し粗く挽く",
    "Filled in from “%s”": "「%s」から埋めました",
    "＋ New recipe…": "＋ 新しいレシピ…",
    /* レシピ */
    "Name": "名前",
    "Steps and timing": "手順と時間",
    "Each step chimes at that time from the start. Write the water as the total you should have poured by then.":
      "手順は、開始からその時刻にチーンと鳴ります。湯量は、そこまでに注ぎ終えているべき累計で書きます。",
    "Add a step": "手順を足す",
    "Finished at (total time)": "全体の時間",
    "Notes": "メモ",
    "Delete this recipe": "このレシピを消す",
    "At": "時点",
    "Kind": "種類",
    "Total g": "累計 g",
    "Remove this step": "この手順を消す",
    "Add a recipe": "レシピを足す",
    "No recipes. Add one with the + above.": "レシピがありません。上の＋から足してください。",
    "e.g. Morning V60": "例：朝のV60",
    "Where it came from, what to watch for": "出どころ、気をつけること",
    "e.g. Second pour": "例：二投目",
    "e.g. Break the crust": "例：泡を崩す",
    "Untitled recipe": "名前のないレシピ",
    "Untitled cup": "名前のない一杯",
    /* 手順の種類 */
    "Pour": "注ぐ",
    "Wait": "待つ",
    "Stir": "混ぜる",
    "Swirl": "回す",
    "Press": "押す",
    "Ready": "完成",
    /* 記録の詳細 */
    "Dose": "粉",
    "Water": "湯",
    "Temp": "湯温",
    "Time": "時間",
    "How it went": "どうだったか",
    "Taste balance": "味の輪郭",
    "Recipe: %s": "レシピ：%s",
    /* 設定 */
    "Sound": "音",
    "Chime": "チーン",
    "Rings once per pour number": "何投目かの数だけ鳴らす",
    "Pre-cue": "予告",
    "A soft tick 3 seconds before": "3秒前に小さく",
    "Volume": "音量",
    "Hear it": "聴いてみる",
    "While brewing": "淹れているあいだ",
    "Countdown before start": "はじめるまでの秒読み",
    "off": "なし",
    "Haptics": "振動",
    "Where the device supports it": "対応している端末で",
    "Keep awake": "画面を消さない",
    "Screen stays on while brewing": "淹れているあいだ点けておく",
    "Dripping": "滴下",
    "Coffee drips and fills the screen behind the timer": "タイマーの後ろで珈琲が落ち、溜まっていく",
    "Look": "見た目",
    "Roast colour": "焙煎の色",
    "Language": "言語",
    "Your data": "あなたのデータ",
    "Everything you log stays on this device. No account, no server behind it. CSV opens in a spreadsheet — one row per brew, one row per recipe.":
      "記録はこの端末の中だけにあります。アカウントも、後ろのサーバーもありません。CSVは表計算で開けます。1杯1行、1レシピ1行。",
    "Brews as CSV": "記録をCSVで",
    "Recipes as CSV": "レシピをCSVで",
    "Put the starter recipes back": "最初のレシピを戻す",
    "%s roast it is": "%sにしました",
    "%s right now. The darker the bean, the deeper the accent.": "いまは%s。深いほど差し色が濃くなります。",
    /* 知らせ */
    "Logged": "記録しました",
    "Saved": "保存しました",
    "Deleted": "消しました",
    "Recipe created": "レシピを作りました",
    "Delete this brew? This cannot be undone.": "この記録を消しますか？元に戻せません。",
    "Delete this recipe? This cannot be undone.": "このレシピを消しますか？元に戻せません。",
    "Nothing to export yet": "まだ出すものがありません",
    "No recipes to export": "出せるレシピがありません",
    "They are all here already": "もう全部あります",
    "Steps rescaled to %s g": "手順を%s gに合わせました",
    "%s put back": "%sを戻しました",
    "Could not open the app.<br>Try reloading the page.": "アプリを開けませんでした。<br>ページを読み込み直してください。",
    /* カレンダー */
    "Previous month": "前の月",
    "Next month": "次の月",
    "less": "少",
    "more": "多",
    "Nothing brewed that day.": "その日は淹れていません。",
    "Nothing brewed this month yet.": "今月はまだ淹れていません。",
    "%s on %s": "%s・%s",
    "Best day %s": "いちばん多い日 %s",
    /* はてなの中身 */
    "The log": "ログ画面",
    "Logging a brew": "記録のつけかた",
    "Writing a recipe": "レシピの書きかた",
    "What each field means": "各項目の意味",
    "The coffee calendar": "珈琲カレンダー",
    "On this device: %s, %s": "この端末には %s と %s",
    "%s exported": "%sを書き出しました",
    "Looks through beans, roasters, brewers, flavour words and everything you typed in the notes.":
      "豆・焙煎所・器具・風味の言葉、それにメモに書いたことすべてを見て回ります。",
    "All / 4★ and up / This month":
      "すべて／4★以上／今月",
    "Narrows the list below. 4★ and up is the shortcut back to the cups worth repeating.":
      "下の一覧を絞ります。4★以上は、また淹れたい一杯への近道です。",
    "How many brews you logged in the past seven days, today included.":
      "今日を含めた7日間に記録した数です。",
    "The mean of the overall stars. Brews you left unrated are not counted.":
      "総合の星の平均です。星をつけなかった一杯は数えません。",
    "The brewer that turns up most often across everything below.":
      "下に並ぶ記録のなかで、いちばん多く出てくる器具です。",
    "The list":
      "一覧",
    "Newest first, grouped by month. Tap a row to see the whole brew — the taste shape, the numbers, what you wrote.":
      "新しい順、月ごとの区切りつき。行を押すと、味の輪郭も数字も書いたことも、まとめて出ます。",
    "+ at the top":
      "右上の＋",
    "Logs a brew by hand, for a cup you made without the timer.":
      "タイマーを使わずに淹れた一杯を、手で記録します。",
    "When you brewed it. Set to now when the form opens; change it if you are writing a cup up later.":
      "淹れた日時です。開いた時点の時刻が入ります。あとから書くときは直してください。",
    "The beans. What you type here comes back as a suggestion next time.":
      "豆です。ここに書いたものは、次から候補に出ます。",
    "Who roasted them. Handy when the same origin tastes different from two shops.":
      "焙煎した店です。同じ産地でも店で味が変わるので、効いてきます。",
    "How dark the roast is, Light through Dark. It also picks the colour the app uses for that brew.":
      "浅煎りから深煎りまで。この一杯にアプリが使う色も、ここで決まります。",
    "The gear the water went through — V60, Aeropress, french press, whatever it was.":
      "湯が通った器具です。V60でもエアロプレスでもフレンチプレスでも。",
    "How coarse you ground, in words. Fine for espresso, coarse for a french press.":
      "挽き目を言葉で。エスプレッソなら細、フレンチプレスなら粗。",
    "The actual number on your grinder, e.g. Comandante, 22 clicks. This is the one that lets you repeat a cup exactly.":
      "ミルの実際の目盛りです（例：コマンダンテ 22クリック）。同じ一杯をもう一度出すなら、ここが要です。",
    "Dry coffee in grams, weighed before grinding.":
      "挽く前に量った、粉になる前の豆の重さ（g）。",
    "All the water you poured in, in grams. 1 g is 1 ml.":
      "注いだ湯の合計（g）。1 g は 1 ml です。",
    "Water temperature at the moment you poured. Lower is gentler on a dark roast.":
      "注いだときの湯温です。深煎りには低めがやさしい。",
    "How long from the first drop of water to the last, as m:ss.":
      "最初の一滴から最後までの時間を m:ss で。",
    "Worked out for you from dose and water. 1:16 means 16 g of water per gram of coffee — around there is the usual place to start.":
      "粉と湯から自動で出ます。1:16 は粉1 gに湯16 g。まずはそのあたりから。",
    "One to five stars, your own verdict. Nothing else in the app is calculated from it except the average.":
      "自分の判定を星5つで。平均を出す以外に、この数字は何にも使われません。",
    "The bright, fruity edge — lemon, berry. 1 is flat, 5 is sharp.":
      "レモンやベリーのような明るさ。1で平ら、5で鋭い。",
    "Sugar, caramel, ripe fruit. Usually what comes back when the grind is right.":
      "砂糖、カラメル、熟した果実。挽き目が合うと戻ってくる味です。",
    "The dry, dark side. A high one often means too fine, too hot or too long.":
      "乾いた暗い側。高いときは、細すぎ・熱すぎ・長すぎのことが多い。",
    "How heavy it feels in the mouth, from tea-like to syrupy.":
      "口のなかの重さ。お茶のようか、蜜のようか。",
    "How much it gives off before you drink it.":
      "飲む前に立ちのぼる量です。",
    "Tap the words that fit, or add your own. They come back in search.":
      "合う言葉を押すか、自分で足してください。あとで検索に出ます。",
    "Free writing about the cup you actually drank.":
      "実際に飲んだ一杯について、自由に。",
    "The one change you want to make on the next go. Read it before you brew these beans again.":
      "次に変えたいことをひとつ。この豆をまた淹れる前に読み返してください。",
    "What you will pick it by on the home screen, e.g. Morning V60.":
      "ホーム画面で選ぶときの名前です（例：朝のV60）。",
    "The dripper or press this recipe is written for.":
      "このレシピが想定している器具です。",
    "How coarse to grind for it.":
      "このレシピの挽き目です。",
    "Dry coffee in grams.":
      "粉の量（g）。",
    "The total water the recipe pours. Change this and every step below moves by the same proportion, so the shape of the recipe survives.":
      "レシピ全体で注ぐ湯の量です。ここを変えると下の手順も同じ割合で動くので、レシピの形は崩れません。",
    "Water temperature to brew at.":
      "淹れる湯温です。",
    "When the step happens, counted from the start, as m:ss. The first one is usually 0:00.":
      "開始からその手順までの時刻を m:ss で。ふつう最初は 0:00 です。",
    "What you do: Pour, Wait, Stir, Swirl, Press or Ready. Only Pour takes an amount of water.":
      "することを選びます：注ぐ・待つ・混ぜる・回す・押す・できあがり。湯量を持つのは「注ぐ」だけです。",
    "The water you should have poured by the end of that step — cumulative, not the amount for that pour alone. So 60 then 150 means pour 60 g, then another 90 g.":
      "その手順を終えた時点までに注ぎ終えているべき合計です。その回だけの量ではありません。60のあと150なら、60 g注いでから、さらに90 g。",
    "A short label the timer shows while that step is running, e.g. Bloom or Circles from the middle out.":
      "その手順のあいだタイマーに出る短い言葉です（例：蒸らし、中心から外へ円を描く）。",
    "When the whole brew is done. The timer rings its last chime here.":
      "全体が終わる時刻です。最後のチーンはここで鳴ります。",
    "Anything about the recipe itself — where it came from, what to watch for.":
      "レシピそのものについて。出どころや、気をつけることなど。",
    "Each square is a day. The darker it is, the more you brewed.":
      "四角ひとつが1日です。濃いほど、たくさん淹れた日。",
    "Tap a day to see what you brewed then.":
      "日を押すと、その日に淹れたものが出ます。",
    "‹ and ›":
      "‹ と ›",
    "Move a month back or forward. It stops at this month — the future has no coffee in it yet.":
      "月を前後に動かします。今月で止まります。先の月には、まだ珈琲がありません。",
    "The line under the grid":
      "枡の下の行",
    "How many cups this month, over how many days, and the busiest single day.":
      "その月の杯数、淹れた日数、いちばん多かった日です。",
    "Gear": "道具",
    "Brew this recipe again": "このレシピでまた淹れる",
    "Start a new log from this": "これをもとに新しく記録する",
    "Each square is a day": "枡ひとつが1日",
    "Tapping a day": "日を押す",
    "Floral": "花",
    "Berry": "ベリー",
    "Citrus": "柑橘",
    "Apple": "りんご",
    "Grape": "ぶどう",
    "Honey": "蜂蜜",
    "Chocolate": "チョコレート",
    "Nutty": "ナッツ",
    "Caramel": "カラメル",
    "Spice": "スパイス",
    "Tea-like": "お茶のよう",
    "Grassy": "青草",
    "Ashy": "灰っぽい",
    "4:6 Method": "4:6メソッド",
    "V60 Everyday Cup": "V60 ふだんの一杯",
    "French Press": "フレンチプレス",
    "AeroPress (standard)": "エアロプレス（標準）",
    "Iced (flash chilled)": "アイス（急冷）",
    "French press": "フレンチプレス",
    "AeroPress": "エアロプレス",
    "First pour": "一投目",
    "Second pour": "二投目",
    "Third pour": "三投目",
    "Fourth pour": "四投目",
    "Fifth pour": "五投目",
    "Drawdown": "落ちきり",
    "Bloom": "蒸らし",
    "Pour it all": "一気に注ぐ",
    "Break the crust": "泡を崩す",
    "Press the plunger": "プランジャーを押す",
    "Pour it out": "注ぎ切る",
    "Stir ten times": "10回混ぜる",
    "100 g ice in the carafe": "サーバーに氷100 g",
    "Swirl to chill": "回して冷やす",
    "The first half sets the sweetness": "前半で甘みが決まる",
    "The second half sets the strength": "後半で濃さが決まる",
    "Wet all the grounds and wait 30 s": "粉全体を濡らして30秒待つ",
    "Circles from the middle out": "中心から外へ円を描く",
    "Reach every bit of the grounds": "粉のすみずみまで",
    "Nudge the surface with a spoon": "スプーンで表面をつつく",
    "Slowly, all the way down": "ゆっくり、最後まで",
    "Do not leave it sitting": "置きっぱなしにしない",
    "Take a slow 30 s": "30秒かけてゆっくり",
    "Ice goes in first": "氷が先",
    "Two pours for sweetness and acidity, three more for strength.": "前2投で甘みと酸味、後3投で濃さ。",
    "The one to fall back on. A plain 1:16.": "迷ったらこれ。素直な1:16。",
    "Steep and wait. Coarse grind, four minutes.": "浸けて待つ。粗挽きで4分。",
    "Cooler water. How fast you press changes everything.": "低めの湯温。押す速さで変わる。",
    "200 g water over 100 g ice. Brew it strong, chill it fast.": "氷100 gに湯200 g。濃く淹れて、一気に冷やす。",
    "Search": "さがす",
  },
  de: {
    "Choose a recipe": "Rezept wählen",
    "See all": "Alle ansehen",
    "Time it without a recipe": "Ohne Rezept messen",
    "Just log a brew": "Nur eintragen",
    "Latest cups": "Zuletzt gebrüht",
    "Open the log": "Log öffnen",
    "No recipes yet.": "Noch keine Rezepte.",
    "brewed today": "heute gebrüht",
    "last 30 days": "letzte 30 Tage",
    "See the calendar": "Zum Kalender",
    "Log": "Log",
    "Recipes": "Rezepte",
    "Recipe": "Rezept",
    "Settings": "Einstellungen",
    "Calendar": "Kalender",
    "Brew": "Tasse",
    "Log a brew": "Tasse eintragen",
    "Edit this brew": "Tasse bearbeiten",
    "Edit recipe": "Rezept bearbeiten",
    "New recipe": "Neues Rezept",
    "Back": "Zurück",
    "Close": "Schließen",
    "Save": "Sichern",
    "Add": "Hinzu",
    "Cancel": "Abbrechen",
    "Delete": "Löschen",
    "Got it": "Verstanden",
    "Edit": "Bearbeiten",
    "Start": "Start",
    "Stop": "Stopp",
    "Pause": "Pause",
    "Resume": "Weiter",
    "Reset": "Zurücksetzen",
    "Finish": "Beenden",
    "Poured": "Gegossen",
    "now": "jetzt",
    "next": "gleich",
    "Sound on": "Ton an",
    "Sound off": "Ton aus",
    "Sound on or off": "Ton an oder aus",
    "Counted as one brew": "Als eine Tasse gezählt",
    "Free timer": "Freier Timer",
    "All": "Alle",
    "4★ and up": "Ab 4★",
    "This month": "Dieser Monat",
    "Search beans, brewers, notes": "Bohnen, Brüher, Notizen suchen",
    "Nothing logged yet.": "Noch nichts eingetragen.",
    "Brew something and it will live here.": "Brüh etwas, dann steht es hier.",
    "Nothing matches that.": "Dazu passt nichts.",
    "Nothing logged yet. Brew something and it will live here.": "Noch nichts eingetragen. Brüh etwas, dann steht es hier.",
    "last 7 days": "letzte 7 Tage",
    "average rating": "Durchschnitt",
    "most used": "am häufigsten",
    "Add a brew": "Tasse hinzufügen",
    "Brewed at": "Gebrüht am",
    "Beans": "Bohnen",
    "Coffee": "Kaffee",
    "Roaster": "Rösterei",
    "Roast": "Röstgrad",
    "Not set": "Nicht gesetzt",
    "Light": "Hell",
    "Medium-light": "Mittelhell",
    "Medium": "Mittel",
    "Medium-dark": "Mitteldunkel",
    "Dark": "Dunkel",
    "Brewing": "Zubereitung",
    "Brewer": "Brüher",
    "Grind": "Mahlgrad",
    "Extra fine": "Sehr fein",
    "Fine": "Fein",
    "Medium-fine": "Mittelfein",
    "Medium-coarse": "Mittelgrob",
    "Coarse": "Grob",
    "Grinder setting": "Mühleneinstellung",
    "Dose (g)": "Kaffee (g)",
    "Water (g)": "Wasser (g)",
    "Temp (°C)": "Temp. (°C)",
    "Brew time": "Brühzeit",
    "Ratio": "Verhältnis",
    "Taste": "Geschmack",
    "Overall": "Gesamt",
    "Overall rating": "Gesamtnote",
    "Acidity": "Säure",
    "Sweetness": "Süße",
    "Bitterness": "Bitterkeit",
    "Body": "Körper",
    "Aroma": "Aroma",
    "Flavour notes": "Aromen",
    "How was it?": "Wie war sie?",
    "Next time": "Nächstes Mal",
    "Delete this brew": "Diese Tasse löschen",
    "e.g. Ethiopia Yirgacheffe": "z. B. Äthiopien Yirgacheffe",
    "e.g. the shop down the road": "z. B. der Laden um die Ecke",
    "e.g. V60": "z. B. V60",
    "e.g. Comandante, 22 clicks": "z. B. Comandante, 22 Klicks",
    "Add your own word": "Eigenes Wort hinzufügen",
    "What did it taste like?": "Wonach hat sie geschmeckt?",
    "e.g. 2°C cooler, grind a touch coarser": "z. B. 2 °C kühler, etwas gröber mahlen",
    "Filled in from “%s”": "Aus „%s“ übernommen",
    "＋ New recipe…": "＋ Neues Rezept …",
    "Name": "Name",
    "Steps and timing": "Schritte und Zeiten",
    "Each step chimes at that time from the start. Write the water as the total you should have poured by then.":
      "Jeder Schritt läutet zu dieser Zeit ab Beginn. Trag das Wasser als Gesamtmenge ein, die bis dahin gegossen sein soll.",
    "Add a step": "Schritt hinzufügen",
    "Finished at (total time)": "Fertig um (Gesamtzeit)",
    "Notes": "Notizen",
    "Delete this recipe": "Dieses Rezept löschen",
    "At": "Zeit",
    "Kind": "Art",
    "Total g": "Gesamt g",
    "Remove this step": "Diesen Schritt entfernen",
    "Add a recipe": "Rezept hinzufügen",
    "No recipes. Add one with the + above.": "Keine Rezepte. Leg oben mit + eines an.",
    "e.g. Morning V60": "z. B. Morgen-V60",
    "Where it came from, what to watch for": "Woher es kommt, worauf zu achten ist",
    "e.g. Second pour": "z. B. Zweiter Guss",
    "e.g. Break the crust": "z. B. Kruste brechen",
    "Untitled recipe": "Rezept ohne Namen",
    "Untitled cup": "Tasse ohne Namen",
    "Pour": "Gießen",
    "Wait": "Warten",
    "Stir": "Rühren",
    "Swirl": "Schwenken",
    "Press": "Drücken",
    "Ready": "Fertig",
    "Dose": "Kaffee",
    "Water": "Wasser",
    "Temp": "Temp.",
    "Time": "Zeit",
    "How it went": "Wie es lief",
    "Taste balance": "Geschmacksbild",
    "Recipe: %s": "Rezept: %s",
    "Sound": "Ton",
    "Chime": "Glocke",
    "Rings once per pour number": "Läutet so oft wie der Guss zählt",
    "Pre-cue": "Vorwarnung",
    "A soft tick 3 seconds before": "Ein leises Ticken 3 Sekunden vorher",
    "Volume": "Lautstärke",
    "Hear it": "Anhören",
    "While brewing": "Beim Brühen",
    "Countdown before start": "Countdown vor dem Start",
    "off": "aus",
    "Haptics": "Vibration",
    "Where the device supports it": "Wo das Gerät es kann",
    "Keep awake": "Bildschirm anlassen",
    "Screen stays on while brewing": "Bleibt beim Brühen an",
    "Dripping": "Tropfen",
    "Coffee drips and fills the screen behind the timer": "Kaffee tropft und füllt den Grund hinter dem Timer",
    "Look": "Aussehen",
    "Roast colour": "Röstfarbe",
    "Language": "Sprache",
    "Your data": "Deine Daten",
    "Everything you log stays on this device. No account, no server behind it. CSV opens in a spreadsheet — one row per brew, one row per recipe.":
      "Alles Eingetragene bleibt auf diesem Gerät. Kein Konto, kein Server dahinter. CSV öffnet sich in der Tabelle — eine Zeile je Tasse, eine je Rezept.",
    "Brews as CSV": "Tassen als CSV",
    "Recipes as CSV": "Rezepte als CSV",
    "Put the starter recipes back": "Startrezepte zurückholen",
    "%s roast it is": "Also %s",
    "%s right now. The darker the bean, the deeper the accent.": "Gerade %s. Je dunkler die Bohne, desto tiefer der Akzent.",
    "Logged": "Eingetragen",
    "Saved": "Gesichert",
    "Deleted": "Gelöscht",
    "Recipe created": "Rezept angelegt",
    "Delete this brew? This cannot be undone.": "Diese Tasse löschen? Das lässt sich nicht rückgängig machen.",
    "Delete this recipe? This cannot be undone.": "Dieses Rezept löschen? Das lässt sich nicht rückgängig machen.",
    "Nothing to export yet": "Noch nichts auszugeben",
    "No recipes to export": "Keine Rezepte auszugeben",
    "They are all here already": "Sind schon alle da",
    "Steps rescaled to %s g": "Schritte auf %s g umgerechnet",
    "%s put back": "%s zurückgeholt",
    "Could not open the app.<br>Try reloading the page.": "Die App ließ sich nicht öffnen.<br>Lade die Seite neu.",
    "Previous month": "Voriger Monat",
    "Next month": "Nächster Monat",
    "less": "wenig",
    "more": "viel",
    "Nothing brewed that day.": "An dem Tag nichts gebrüht.",
    "Nothing brewed this month yet.": "Diesen Monat noch nichts gebrüht.",
    "%s on %s": "%s an %s",
    "Best day %s": "Bester Tag %s",
    "The log": "Das Log",
    "Logging a brew": "Eine Tasse eintragen",
    "Writing a recipe": "Ein Rezept schreiben",
    "What each field means": "Was jedes Feld bedeutet",
    "The coffee calendar": "Der Kaffeekalender",
    "On this device: %s, %s": "Auf diesem Gerät: %s, %s",
    "%s exported": "%s ausgegeben",
    "Looks through beans, roasters, brewers, flavour words and everything you typed in the notes.":
      "Durchsucht Bohnen, Röstereien, Brüher, Aromenwörter und alles, was du in die Notizen geschrieben hast.",
    "All / 4★ and up / This month":
      "Alle / Ab 4★ / Dieser Monat",
    "Narrows the list below. 4★ and up is the shortcut back to the cups worth repeating.":
      "Grenzt die Liste ein. Ab 4★ ist die Abkürzung zu den Tassen, die eine Wiederholung wert sind.",
    "How many brews you logged in the past seven days, today included.":
      "Wie viele Tassen du in den letzten sieben Tagen eingetragen hast, heute mitgezählt.",
    "The mean of the overall stars. Brews you left unrated are not counted.":
      "Der Mittelwert der Gesamtsterne. Unbewertete Tassen zählen nicht mit.",
    "The brewer that turns up most often across everything below.":
      "Der Brüher, der unten am häufigsten vorkommt.",
    "The list":
      "Die Liste",
    "Newest first, grouped by month. Tap a row to see the whole brew — the taste shape, the numbers, what you wrote.":
      "Neueste zuerst, nach Monat gruppiert. Tippe eine Zeile an für die ganze Tasse — Geschmacksbild, Zahlen, deine Worte.",
    "+ at the top":
      "+ oben",
    "Logs a brew by hand, for a cup you made without the timer.":
      "Trägt eine Tasse von Hand ein, für einen Aufguss ohne Timer.",
    "When you brewed it. Set to now when the form opens; change it if you are writing a cup up later.":
      "Wann du gebrüht hast. Steht beim Öffnen auf jetzt; ändere es, wenn du später nachträgst.",
    "The beans. What you type here comes back as a suggestion next time.":
      "Die Bohnen. Was du hier tippst, kommt beim nächsten Mal als Vorschlag zurück.",
    "Who roasted them. Handy when the same origin tastes different from two shops.":
      "Wer sie geröstet hat. Nützlich, wenn derselbe Ursprung aus zwei Läden anders schmeckt.",
    "How dark the roast is, Light through Dark. It also picks the colour the app uses for that brew.":
      "Wie dunkel geröstet, von Hell bis Dunkel. Das wählt auch die Farbe, die die App für diese Tasse nimmt.",
    "The gear the water went through — V60, Aeropress, french press, whatever it was.":
      "Das Gerät, durch das das Wasser lief — V60, AeroPress, French Press, was auch immer.",
    "How coarse you ground, in words. Fine for espresso, coarse for a french press.":
      "Wie grob du gemahlen hast, in Worten. Fein für Espresso, grob für die French Press.",
    "The actual number on your grinder, e.g. Comandante, 22 clicks. This is the one that lets you repeat a cup exactly.":
      "Die tatsächliche Zahl an deiner Mühle, z. B. Comandante, 22 Klicks. Damit lässt sich eine Tasse genau wiederholen.",
    "Dry coffee in grams, weighed before grinding.":
      "Trockener Kaffee in Gramm, vor dem Mahlen gewogen.",
    "All the water you poured in, in grams. 1 g is 1 ml.":
      "Alles Wasser, das du gegossen hast, in Gramm. 1 g ist 1 ml.",
    "Water temperature at the moment you poured. Lower is gentler on a dark roast.":
      "Wassertemperatur beim Gießen. Kühler ist sanfter zu einer dunklen Röstung.",
    "How long from the first drop of water to the last, as m:ss.":
      "Vom ersten bis zum letzten Tropfen, als m:ss.",
    "Worked out for you from dose and water. 1:16 means 16 g of water per gram of coffee — around there is the usual place to start.":
      "Wird aus Kaffee und Wasser errechnet. 1:16 heißt 16 g Wasser je Gramm Kaffee — da fängt man üblicherweise an.",
    "One to five stars, your own verdict. Nothing else in the app is calculated from it except the average.":
      "Ein bis fünf Sterne, dein eigenes Urteil. Außer dem Durchschnitt rechnet die App nichts damit.",
    "The bright, fruity edge — lemon, berry. 1 is flat, 5 is sharp.":
      "Die helle, fruchtige Kante — Zitrone, Beere. 1 ist flach, 5 ist scharf.",
    "Sugar, caramel, ripe fruit. Usually what comes back when the grind is right.":
      "Zucker, Karamell, reife Frucht. Kommt meist zurück, wenn der Mahlgrad stimmt.",
    "The dry, dark side. A high one often means too fine, too hot or too long.":
      "Die trockene, dunkle Seite. Ein hoher Wert heißt oft zu fein, zu heiß oder zu lang.",
    "How heavy it feels in the mouth, from tea-like to syrupy.":
      "Wie schwer sie im Mund liegt, von teeartig bis sirupartig.",
    "How much it gives off before you drink it.":
      "Wie viel sie abgibt, bevor du trinkst.",
    "Tap the words that fit, or add your own. They come back in search.":
      "Tippe die passenden Wörter an oder füg eigene hinzu. Sie kommen in der Suche zurück.",
    "Free writing about the cup you actually drank.":
      "Freier Text über die Tasse, die du wirklich getrunken hast.",
    "The one change you want to make on the next go. Read it before you brew these beans again.":
      "Die eine Änderung fürs nächste Mal. Lies sie, bevor du diese Bohnen wieder brühst.",
    "What you will pick it by on the home screen, e.g. Morning V60.":
      "Der Name, unter dem du es auf der Startseite wählst, z. B. Morgen-V60.",
    "The dripper or press this recipe is written for.":
      "Der Dripper oder die Presse, für die dieses Rezept geschrieben ist.",
    "How coarse to grind for it.":
      "Wie grob dafür zu mahlen ist.",
    "Dry coffee in grams.":
      "Trockener Kaffee in Gramm.",
    "The total water the recipe pours. Change this and every step below moves by the same proportion, so the shape of the recipe survives.":
      "Das gesamte Wasser des Rezepts. Änderst du das, wandern alle Schritte im gleichen Verhältnis mit — die Form des Rezepts bleibt.",
    "Water temperature to brew at.":
      "Die Wassertemperatur zum Brühen.",
    "When the step happens, counted from the start, as m:ss. The first one is usually 0:00.":
      "Wann der Schritt kommt, ab Beginn gezählt, als m:ss. Der erste steht meist auf 0:00.",
    "What you do: Pour, Wait, Stir, Swirl, Press or Ready. Only Pour takes an amount of water.":
      "Was du tust: Gießen, Warten, Rühren, Schwenken, Drücken oder Fertig. Nur Gießen nimmt eine Wassermenge.",
    "The water you should have poured by the end of that step — cumulative, not the amount for that pour alone. So 60 then 150 means pour 60 g, then another 90 g.":
      "Das Wasser, das bis zum Ende dieses Schritts gegossen sein soll — kumulativ, nicht die Menge dieses einen Gusses. 60, dann 150 heißt also: 60 g gießen, dann weitere 90 g.",
    "A short label the timer shows while that step is running, e.g. Bloom or Circles from the middle out.":
      "Ein kurzes Wort, das der Timer während des Schritts zeigt, z. B. Blooming oder Kreise von innen nach außen.",
    "When the whole brew is done. The timer rings its last chime here.":
      "Wann der ganze Aufguss fertig ist. Hier läutet der Timer zum letzten Mal.",
    "Anything about the recipe itself — where it came from, what to watch for.":
      "Alles zum Rezept selbst — woher es kommt, worauf zu achten ist.",
    "Each square is a day. The darker it is, the more you brewed.":
      "Jedes Feld ist ein Tag. Je dunkler, desto mehr gebrüht.",
    "Tap a day to see what you brewed then.":
      "Tippe einen Tag an, um zu sehen, was du gebrüht hast.",
    "‹ and ›":
      "‹ und ›",
    "Move a month back or forward. It stops at this month — the future has no coffee in it yet.":
      "Einen Monat zurück oder vor. Bei diesem Monat ist Schluss — in der Zukunft ist noch kein Kaffee.",
    "The line under the grid":
      "Die Zeile unter dem Raster",
    "How many cups this month, over how many days, and the busiest single day.":
      "Wie viele Tassen in diesem Monat, an wie vielen Tagen, und der dichteste Tag.",
    "Gear": "Gerät",
    "Brew this recipe again": "Dieses Rezept nochmal brühen",
    "Start a new log from this": "Neuen Eintrag daraus beginnen",
    "Each square is a day": "Jedes Feld ein Tag",
    "Tapping a day": "Einen Tag antippen",
    "Floral": "Blumig",
    "Berry": "Beere",
    "Citrus": "Zitrus",
    "Apple": "Apfel",
    "Grape": "Traube",
    "Honey": "Honig",
    "Chocolate": "Schokolade",
    "Nutty": "Nussig",
    "Caramel": "Karamell",
    "Spice": "Gewürz",
    "Tea-like": "Teeartig",
    "Grassy": "Grasig",
    "Ashy": "Aschig",
    "4:6 Method": "4:6-Methode",
    "V60 Everyday Cup": "V60 für jeden Tag",
    "French Press": "French Press",
    "AeroPress (standard)": "AeroPress (Standard)",
    "Iced (flash chilled)": "Eiskaffee (schnell gekühlt)",
    "French press": "French Press",
    "AeroPress": "AeroPress",
    "First pour": "Erster Guss",
    "Second pour": "Zweiter Guss",
    "Third pour": "Dritter Guss",
    "Fourth pour": "Vierter Guss",
    "Fifth pour": "Fünfter Guss",
    "Drawdown": "Durchlauf",
    "Bloom": "Blooming",
    "Pour it all": "Alles auf einmal",
    "Break the crust": "Kruste brechen",
    "Press the plunger": "Stempel drücken",
    "Pour it out": "Ausgießen",
    "Stir ten times": "Zehnmal rühren",
    "100 g ice in the carafe": "100 g Eis in die Kanne",
    "Swirl to chill": "Zum Kühlen schwenken",
    "The first half sets the sweetness": "Die erste Hälfte macht die Süße",
    "The second half sets the strength": "Die zweite Hälfte macht die Stärke",
    "Wet all the grounds and wait 30 s": "Alles Mehl benetzen und 30 s warten",
    "Circles from the middle out": "Kreise von innen nach außen",
    "Reach every bit of the grounds": "Jedes Krümelchen erreichen",
    "Nudge the surface with a spoon": "Die Oberfläche mit dem Löffel anstupsen",
    "Slowly, all the way down": "Langsam, ganz nach unten",
    "Do not leave it sitting": "Nicht stehen lassen",
    "Take a slow 30 s": "Nimm dir 30 langsame Sekunden",
    "Ice goes in first": "Das Eis kommt zuerst",
    "Two pours for sweetness and acidity, three more for strength.": "Zwei Güsse für Süße und Säure, drei weitere für Stärke.",
    "The one to fall back on. A plain 1:16.": "Das Rezept für alle Fälle. Schlicht 1:16.",
    "Steep and wait. Coarse grind, four minutes.": "Ziehen lassen. Grob gemahlen, vier Minuten.",
    "Cooler water. How fast you press changes everything.": "Kühleres Wasser. Wie schnell du drückst, ändert alles.",
    "200 g water over 100 g ice. Brew it strong, chill it fast.": "200 g Wasser auf 100 g Eis. Stark brühen, schnell kühlen.",
    "Search": "Suche",
  },
};

const langId = () => (typeof settings !== "undefined" && settings.lang) || "en";
const langDef = () => LANGS.find((l) => l.id === langId()) || LANGS[0];

/* 英語そのものが鍵。%s は順に埋める */
function t(en, ...vars) {
  const d = DICT[langId()];
  let out = (d && d[en]) || en;
  for (const v of vars) out = out.replace("%s", String(v));
  return out;
}

/* 数と語をまとめて組む。日本語は助数詞で、単複の区別が要らない */
const COUNTED = {
  en: {
    cup: (n) => `${n} cup${n === 1 ? "" : "s"}`,
    day: (n) => `${n} day${n === 1 ? "" : "s"}`,
    brew: (n) => `${n} brew${n === 1 ? "" : "s"}`,
    recipe: (n) => `${n} recipe${n === 1 ? "" : "s"}`,
  },
  ja: {
    cup: (n) => `${n}杯`,
    day: (n) => `${n}日`,
    brew: (n) => `${n}件の記録`,
    recipe: (n) => `${n}件のレシピ`,
  },
  de: {
    cup: (n) => `${n} ${n === 1 ? "Tasse" : "Tassen"}`,
    day: (n) => `${n} ${n === 1 ? "Tag" : "Tagen"}`,
    brew: (n) => `${n} ${n === 1 ? "Eintrag" : "Einträge"}`,
    recipe: (n) => `${n} ${n === 1 ? "Rezept" : "Rezepte"}`,
  },
};
function counted(n, word) {
  const set = COUNTED[langId()] || COUNTED.en;
  return (set[word] || COUNTED.en[word])(n);
}
/* 大きな数字のすぐ下に添える短い単位。日本語は語そのものが単位になる */
function unitWord(n, word) {
  const s = counted(n, word);
  return s.replace(/^\d+\s?/, "") || word;
}

/* 札に書いてある英語を鍵として覚え、切り替えのたびにそこから引き直す */
function applyLang() {
  const l = langDef();
  document.documentElement.lang = l.id;
  const grab = (node, attr, store) => {
    if (node.dataset[store] === undefined) {
      node.dataset[store] = attr === "text" ? node.textContent.trim() : (node.getAttribute(attr) || "");
    }
    return node.dataset[store];
  };
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(grab(node, "text", "i18nKey"));
  }
  for (const node of document.querySelectorAll("[data-i18n-ph]")) {
    node.setAttribute("placeholder", t(grab(node, "placeholder", "i18nPhKey")));
  }
  for (const node of document.querySelectorAll("[data-i18n-label]")) {
    const key = grab(node, "aria-label", "i18nLabelKey");
    node.setAttribute("aria-label", t(key));
    if (node.hasAttribute("title")) node.setAttribute("title", t(key));
  }
}

/* 日付は Intl に任せる。3言語ぶんの月名と曜日名を自分で抱えずに済み、
   その言語の並び（日本語なら「9月10日」）にもそのまま乗る */
const dateFmt = (opts) => new Intl.DateTimeFormat(langDef().locale, opts);

function fmtDate(ms) {
  return dateFmt({ weekday: "short", day: "numeric", month: "short" }).format(new Date(ms));
}
function fmtDateTime(ms) {
  return dateFmt({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}
function fmtMonthYear(d) {
  return dateFmt({ year: "numeric", month: "long" }).format(d);
}
function fmtDayLong(ms) {
  return dateFmt({ weekday: "long", day: "numeric", month: "long" }).format(new Date(ms));
}
/* 表計算に渡す欄だけは、言語に関わらず読み方の変わらない形にしておく */
function fmtStamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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

/* はてなボタンの中身。画面ごとに、並んでいる順のまま項目を並べる。
   専門語をいちいち外で調べさせないための、その場の脚注 */
const HELP = {
  log: {
    title: "The log",
    items: [
      ["Search", "Looks through beans, roasters, brewers, flavour words and everything you typed in the notes."],
      ["All / 4★ and up / This month", "Narrows the list below. 4★ and up is the shortcut back to the cups worth repeating."],
      ["last 7 days", "How many brews you logged in the past seven days, today included."],
      ["average rating", "The mean of the overall stars. Brews you left unrated are not counted."],
      ["most used", "The brewer that turns up most often across everything below."],
      ["The list", "Newest first, grouped by month. Tap a row to see the whole brew — the taste shape, the numbers, what you wrote."],
      ["+ at the top", "Logs a brew by hand, for a cup you made without the timer."],
    ],
  },
  brew: {
    title: "Logging a brew",
    items: [
      ["Brewed at", "When you brewed it. Set to now when the form opens; change it if you are writing a cup up later."],
      ["Coffee", "The beans. What you type here comes back as a suggestion next time."],
      ["Roaster", "Who roasted them. Handy when the same origin tastes different from two shops."],
      ["Roast", "How dark the roast is, Light through Dark. It also picks the colour the app uses for that brew."],
      ["Brewer", "The gear the water went through — V60, Aeropress, french press, whatever it was."],
      ["Grind", "How coarse you ground, in words. Fine for espresso, coarse for a french press."],
      ["Grinder setting", "The actual number on your grinder, e.g. Comandante, 22 clicks. This is the one that lets you repeat a cup exactly."],
      ["Dose (g)", "Dry coffee in grams, weighed before grinding."],
      ["Water (g)", "All the water you poured in, in grams. 1 g is 1 ml."],
      ["Temp (°C)", "Water temperature at the moment you poured. Lower is gentler on a dark roast."],
      ["Brew time", "How long from the first drop of water to the last, as m:ss."],
      ["Ratio", "Worked out for you from dose and water. 1:16 means 16 g of water per gram of coffee — around there is the usual place to start."],
      ["Overall", "One to five stars, your own verdict. Nothing else in the app is calculated from it except the average."],
      ["Acidity", "The bright, fruity edge — lemon, berry. 1 is flat, 5 is sharp."],
      ["Sweetness", "Sugar, caramel, ripe fruit. Usually what comes back when the grind is right."],
      ["Bitterness", "The dry, dark side. A high one often means too fine, too hot or too long."],
      ["Body", "How heavy it feels in the mouth, from tea-like to syrupy."],
      ["Aroma", "How much it gives off before you drink it."],
      ["Flavour notes", "Tap the words that fit, or add your own. They come back in search."],
      ["How was it?", "Free writing about the cup you actually drank."],
      ["Next time", "The one change you want to make on the next go. Read it before you brew these beans again."],
    ],
  },
  calendar: {
    title: "The coffee calendar",
    items: [
      ["Each square is a day", "Each square is a day. The darker it is, the more you brewed."],
      ["Tapping a day", "Tap a day to see what you brewed then."],
      ["‹ and ›", "Move a month back or forward. It stops at this month — the future has no coffee in it yet."],
      ["The line under the grid", "How many cups this month, over how many days, and the busiest single day."],
    ],
  },
  recipe: {
    title: "Writing a recipe",
    items: [
      ["Name", "What you will pick it by on the home screen, e.g. Morning V60."],
      ["Brewer", "The dripper or press this recipe is written for."],
      ["Grind", "How coarse to grind for it."],
      ["Dose (g)", "Dry coffee in grams."],
      ["Water (g)", "The total water the recipe pours. Change this and every step below moves by the same proportion, so the shape of the recipe survives."],
      ["Temp (°C)", "Water temperature to brew at."],
      ["At", "When the step happens, counted from the start, as m:ss. The first one is usually 0:00."],
      ["Kind", "What you do: Pour, Wait, Stir, Swirl, Press or Ready. Only Pour takes an amount of water."],
      ["Total g", "The water you should have poured by the end of that step — cumulative, not the amount for that pour alone. So 60 then 150 means pour 60 g, then another 90 g."],
      ["The line under each step", "A short label the timer shows while that step is running, e.g. Bloom or Circles from the middle out."],
      ["Finished at (total time)", "When the whole brew is done. The timer rings its last chime here."],
      ["Notes", "Anything about the recipe itself — where it came from, what to watch for."],
    ],
  },
};

/* 説明の紙。confirmAsk と同じ下から出る紙を使い回す */
function openHelp(which) {
  const help = HELP[which];
  if (!help) return;
  const backdrop = $("help-backdrop");
  $("help-title").textContent = t(help.title);
  const list = $("help-list");
  list.innerHTML = "";
  for (const [term, desc] of help.items) {
    list.appendChild(el("dt", "help-term", t(term)));
    list.appendChild(el("dd", "help-desc", t(desc)));
  }
  list.scrollTop = 0;
  backdrop.hidden = false;
  const close = () => {
    backdrop.hidden = true;
    $("help-close").onclick = null;
    backdrop.onclick = null;
  };
  $("help-close").onclick = close;
  backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-help]");
  if (btn) openHelp(btn.dataset.help);
});

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
/* 焙煎の色。どれも明るい下地の上で 4.5:1 を超える濃さにしてある */
const ROASTS = [
  { id: "light",        name: "Light",        hex: "#956026" },
  { id: "medium-light", name: "Medium-light", hex: "#8A5324" },
  { id: "medium",       name: "Medium",       hex: "#7C4522" },
  { id: "medium-dark",  name: "Medium-dark",  hex: "#65351E" },
  { id: "dark",         name: "Dark",         hex: "#4B2517" },
];
const findRoast = (id) => ROASTS.find((r) => r.id === id) || ROASTS[2];

const DEFAULT_SETTINGS = {
  chime: true,       // 手順の時刻にチーンと鳴らす
  precue: true,      // 3秒前に小さく予告する
  vibe: true,        // 対応端末でバイブ
  wakelock: true,    // タイマー中は画面を消さない
  volume: 70,
  countdown: 3,      // 開始を押してから走り出すまでの秒数（0〜10）
  drips: true,       // 背景に、注いだぶんの雫と液面を出すか
  roast: "medium",   // アクセントの焙煎度
  lang: "en",        // 画面のことば（en / ja / de）
};
let settings = { ...DEFAULT_SETTINGS };

/* 見た目は明るい面ひとつ。変わるのは焙煎度で選ぶ差し色だけ */
function applyTheme() {
  const roast = findRoast(settings.roast);
  document.documentElement.style.setProperty("--accent", roast.hex);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", roast.hex);
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
  /* 名前も手順の言葉も、置いたときのことばで焼き付ける。ここから先は
     ただのデータで、あとから自由に直せる */
  const mk = (name, method, grind, doseG, waterG, tempC, totalSec, steps, memo) => ({
    id: newId(), name: t(name), method, grind, doseG, waterG, tempC, totalSec,
    steps: steps.map((st) => ({ ...st, label: st.label ? t(st.label) : "", note: st.note ? t(st.note) : "" })),
    memo: t(memo),
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
/* チーンの高さ。合図は A6、淹れ終わりはその1オクターブ上の A7。
   予告はそのあいだの C7 を、ごく小さく */
const TONE_STEP = 1760;
const TONE_FINISH = TONE_STEP * 2;
const TONE_CUE = 2093;

function scheduleSound(kind, when, count = 1) {
  if (!ensureAudio()) return;
  const v = volumeGain();
  if (v <= 0) return;
  if (kind === "cue") { bellAt(when, TONE_CUE, 0.4, 0.08 * v); return; }
  /* 高い音は耳に刺さりやすいので、長く伸ばすぶん少し弱める */
  if (kind === "finish") { bellAt(when, TONE_FINISH, 3.6, 0.24 * v); return; }
  /* 数えられる速さで、かつ間延びしない間隔 */
  for (let i = 0; i < Math.max(1, count); i++) {
    bellAt(when + i * 0.26, TONE_STEP, 0.8, 0.26 * v);
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
const KIND_LABEL_EN = {
  pour: "Pour", wait: "Wait", stir: "Stir",
  swirl: "Swirl", plunge: "Press", finish: "Ready",
};
/* 使う側はいつも今の言葉で受け取る。保存されるのは英語の鍵のほう */
const KIND_LABEL = new Proxy(KIND_LABEL_EN, {
  get: (o, k) => (typeof k === "string" && o[k] ? t(o[k]) : o[k]),
});

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
  stripShown = null;
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
  $("timer-title").textContent = recipe ? recipe.name : t("Free timer");
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
  calendar: "screen-calendar",
  settings: "screen-settings",
};
/* 出発点はいつもホーム。ほかの画面はそこから行って、戻ってくる */
const ROOT_SCREEN = "brew";
let navStack = [ROOT_SCREEN];
let navSuppressHistory = false;

function showScreen(name, { replace = false } = {}) {
  const id = SCREEN_IDS[name];
  if (!id) return;
  for (const key of Object.keys(SCREEN_IDS)) {
    $(SCREEN_IDS[key]).classList.toggle("active", key === name);
  }
  if (name === ROOT_SCREEN) navStack = [name];
  else if (replace) navStack[navStack.length - 1] = name;
  else if (navStack[navStack.length - 1] !== name) navStack.push(name);
  /* 同じ画面が2つ続くと、戻っても何も起きないように見える */
  if (navStack.length > 1 && navStack[navStack.length - 1] === navStack[navStack.length - 2]) {
    navStack.pop();
  }

  /* 文書そのものが動くので、戻すのは窓のスクロール位置 */
  window.scrollTo(0, 0);
  if (!navSuppressHistory) history.pushState({ screen: name }, "");
}

function goBack() {
  if (navStack.length > 1) {
    navStack.pop();
    showScreen(navStack[navStack.length - 1], { replace: true });
  } else {
    showScreen(ROOT_SCREEN);
  }
}

/* ---------- 淹れる（ホーム） ---------- */
/* ---------- ホームのあいさつ ---------- *
 *  時間帯ごとの束から1つ引く。ときどき、銀河英雄伝説の号令を混ぜる。
 *  どれも1行に収まる長さ（いちばん長いもので34字）にしてある
 * ------------------------------------------------------------------ */
const GREETINGS = {
  night: [                                   // 〜5時
    "Noch ein Aufguss zu später Stunde?",
    "Die Nacht ist lang. Noch eine?",
    "Der Mond mahlt mit.",
    "Wach bleiben. Wasser aufsetzen.",
  ],
  morning: [                                 // 〜11時
    "Guten Morgen. Der erste Aufguss.",
    "Frisch gemahlen schmeckt am besten.",
    "Das Wasser ist heiß. Beginnen wir.",
    "Der Duft weckt das Haus.",
    "Heute ein guter Tag zum Brühen.",
  ],
  day: [                                     // 〜17時
    "Zeit für eine Pause.",
    "Ein Schluck Ruhe, bitte.",
    "Langsam gießen, ruhig atmen.",
    "Nach dem Kaffee die Arbeit.",
  ],
  evening: [                                 // それ以降
    "Wie brühst du heute?",
    "Der Abend gehört der Kanne.",
    "Noch eine Tasse, dann Feierabend.",
    "Gutes Wasser, gute Bohnen.",
  ],
};
/* 銀英伝の号令。淹れる前の号令として、たまに出る */
const GREETINGS_FLOURISH = [
  "Feuer!",
  "Alle Geschütze, bereit!",
  "Gefechtsbereitschaft!",
  "Vorwärts, ins Meer der Sterne!",
  "Der Sieg ist unser.",
  "Kaffee ist die halbe Schlacht.",
];
const pick = (list) => list[(Math.random() * list.length) | 0];

function greetingFor(hour) {
  /* 6回に1回ほど、号令が飛ぶ */
  if (Math.random() < 0.17) return pick(GREETINGS_FLOURISH);
  if (hour < 5) return pick(GREETINGS.night);
  if (hour < 11) return pick(GREETINGS.morning);
  if (hour < 17) return pick(GREETINGS.day);
  return pick(GREETINGS.evening);
}

function renderHome() {
  $("greeting").textContent = greetingFor(new Date().getHours());

  renderHomeStats($("home-stats"), liveBrews());

  const list = liveRecipes();
  const box = $("home-recipes");
  box.innerHTML = "";
  if (!list.length) {
    const empty = el("p", "empty-note", t("No recipes yet."));
    box.appendChild(empty);
  }
  for (const r of list.slice(0, 6)) box.appendChild(recipeCard(r, false));

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
  n.appendChild(el("span", "small", unitWord(today, "cup")));
  left.appendChild(n);
  left.appendChild(el("div", "stat-label", t("brewed today")));
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
  n.appendChild(el("span", "small", unitWord(total, "cup")));
  head.appendChild(n);
  const label = el("div", "stat-label", t("last 30 days"));
  head.appendChild(label);
  card.appendChild(head);

  const yOf = (c) => SPARK_VB - SPARK_PAD - (c / peak) * (SPARK_VB - SPARK_PAD * 2);
  const zero = yOf(0);
  const pts = counts.map((c, i) => `${i} ${yOf(c).toFixed(2)}`);
  const line = "M" + pts.join(" L");

  /* 1杯も無いうちは、線を引いても「満ちている」ように見える。
     そのときは目盛りの色まで沈めて、空だと分かるようにする */
  const spark = el("div", total ? "spark" : "spark empty");
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
    label.textContent = `${fmtDate(dateAt(i).getTime())} · ${counted(counts[i], "cup")}`;
    label.classList.add("live");
    place(i);
    cross.hidden = false;
    cross.style.left = `calc(${xPct(i).toFixed(2)}% - 0.5px)`;
  };
  const off = () => {
    label.textContent = t("last 30 days");
    label.classList.remove("live");
    place(TREND_DAYS - 1);
    cross.hidden = true;
  };
  /* なぞればその日の数、ちょんと押せばカレンダーへ。指がほとんど動かず、
     すぐ離れたときだけ「押した」とみなす */
  let down = null;
  spark.addEventListener("pointerdown", (e) => {
    spark.setPointerCapture(e.pointerId);
    down = { x: e.clientX, at: performance.now(), moved: 0 };
    at(e.clientX);
  });
  spark.addEventListener("pointermove", (e) => {
    if (down) down.moved = Math.max(down.moved, Math.abs(e.clientX - down.x));
    if (e.pressure > 0 || e.pointerType === "mouse") at(e.clientX);
  });
  spark.addEventListener("pointerup", () => {
    const tap = down && down.moved < 8 && performance.now() - down.at < 400;
    down = null;
    off();
    if (tap) openCalendar();
  });
  spark.addEventListener("pointercancel", () => { down = null; off(); });
  spark.addEventListener("pointerleave", () => { down = null; off(); });

  /* 指のない相手にも道を残す */
  const more = el("button", "stat-more");
  more.type = "button";
  more.setAttribute("aria-label", t("See the calendar"));
  more.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';
  more.addEventListener("click", openCalendar);
  card.appendChild(more);
  card.classList.add("tappable");
  return card;
}

/* ------------------------------------------------------------------ *
 *  珈琲カレンダー
 *    ひと月を枡で並べ、その日に淹れた数だけ色を濃くする。折れ線が
 *    「どれだけ」を言うのに対して、こちらは「いつ」を言う。飛んだ日も
 *    続いた週も、形として一目で残る。
 *    日を押すと、その日に淹れたものが下に出る。
 * ------------------------------------------------------------------ */
const CAL_STEPS = [0, 0.16, 0.34, 0.56, 0.78, 0.94];   // 杯数ごとの濃さ

let calMonth = null;      // 表示している月の1日
let calPicked = null;     // 選んだ日（0時のミリ秒）

const midnightOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

function calShade(n) {
  const i = Math.min(n, CAL_STEPS.length - 1);
  return CAL_STEPS[i];
}

function openCalendar() {
  if (!calMonth) calMonth = monthStart(new Date());
  calPicked = null;
  renderCalendar();
  showScreen("calendar");
}

function calShift(months) {
  const next = new Date(calMonth.getFullYear(), calMonth.getMonth() + months, 1);
  const cap = monthStart(new Date());
  if (next > cap) return;
  calMonth = next;
  calPicked = null;
  renderCalendar();
}

function renderCalendar() {
  if (!calMonth) calMonth = monthStart(new Date());
  const start = calMonth;
  const year = start.getFullYear(), month = start.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const today = midnightOf(new Date()).getTime();
  const weekStart = langDef().weekStart;

  $("cal-title").textContent = fmtMonthYear(start);
  $("cal-next").disabled = monthStart(new Date()) <= start;

  /* その月の1日ごとの杯数 */
  const counts = new Array(days).fill(0);
  for (const b of liveBrews()) {
    const d = new Date(b.brewedAt);
    if (d.getFullYear() === year && d.getMonth() === month) counts[d.getDate() - 1]++;
  }

  /* 曜日の頭文字は Intl から。日本語なら日月火、ドイツ語なら So Mo Di */
  const dowFmt = dateFmt({ weekday: "short" });
  const dow = $("cal-dow");
  dow.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const day = (weekStart + i) % 7;
    /* 2024-01-07 は日曜。そこから数えれば曜日名が揃う */
    dow.appendChild(el("span", "cal-dow-cell", dowFmt.format(new Date(2024, 0, 7 + day))));
  }

  const grid = $("cal-grid");
  grid.innerHTML = "";
  const lead = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
  for (let i = 0; i < lead; i++) grid.appendChild(el("span", "cal-cell blank"));

  for (let d = 1; d <= days; d++) {
    const ms = new Date(year, month, d).getTime();
    const n = counts[d - 1];
    const cell = el("button", "cal-cell");
    cell.type = "button";
    const a = calShade(n);
    if (a) cell.style.background = `color-mix(in srgb, var(--accent) ${Math.round(a * 100)}%, var(--surface))`;
    if (a >= 0.56) cell.classList.add("deep");
    if (ms === today) cell.classList.add("today");
    if (ms > today) cell.classList.add("ahead");
    if (n) cell.classList.add("has");
    cell.appendChild(el("span", "cal-num", String(d)));
    cell.setAttribute("aria-label", `${fmtDayLong(ms)} · ${counted(n, "cup")}`);
    cell.addEventListener("click", () => {
      calPicked = calPicked === ms ? null : ms;
      renderCalendar();
    });
    if (calPicked === ms) cell.classList.add("picked");
    grid.appendChild(cell);
  }

  /* 濃さの目安 */
  const key = $("cal-key");
  key.innerHTML = "";
  key.appendChild(el("span", "cal-key-word", t("less")));
  for (const a of CAL_STEPS) {
    const chip = el("span", "cal-key-chip");
    chip.style.background = a
      ? `color-mix(in srgb, var(--accent) ${Math.round(a * 100)}%, var(--surface))`
      : "var(--surface)";
    key.appendChild(chip);
  }
  key.appendChild(el("span", "cal-key-word", t("more")));

  /* その月のまとめ */
  const total = counts.reduce((a, c) => a + c, 0);
  const onDays = counts.filter((c) => c > 0).length;
  const peak = Math.max(0, ...counts);
  $("cal-sum").textContent = total
    ? `${t("%s on %s", counted(total, "cup"), counted(onDays, "day"))} · ${t("Best day %s", counted(peak, "cup"))}`
    : t("Nothing brewed this month yet.");

  /* 選んだ日の中身 */
  const box = $("cal-day");
  box.innerHTML = "";
  if (calPicked === null) return;
  const from = calPicked, to = calPicked + 86400000;
  const of = liveBrews().filter((b) => b.brewedAt >= from && b.brewedAt < to);
  box.appendChild(el("div", "month-head", fmtDayLong(calPicked)));
  if (!of.length) {
    box.appendChild(el("p", "empty-note", t("Nothing brewed that day.")));
    return;
  }
  for (const b of of) box.appendChild(brewItem(b));
}

$("cal-prev").addEventListener("click", () => calShift(-1));
$("cal-next").addEventListener("click", () => calShift(1));

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
  box.appendChild(cell(String(week.length), unitWord(week.length, "cup"), t("last 7 days")));
  box.appendChild(cell(avg ? avg.toFixed(1) : "—", avg ? "★" : "", t("average rating")));
  box.appendChild(cell(topMethod ? topMethod[0] : "—", "", t("most used")));
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
  splash: [],      // 着水で跳ねた粒
  holdUntil: 0,    // ここまでは落ちてこない（蒸らし）
  firstPour: true,
  ripples: [],     // 水面を伝わる波
  stir: 0,         // 水面の立ち具合。落ちてこなくなると凪ぐ
  w: 0,            // 画面の幅。壁の位置を surfaceAt に伝える
  screenH: 0,      // 実測した画面の高さ
  puffs: [],       // 湯気
  puffAt: 0,
  marks: [],       // 目盛り（各投の合計量 ml）
  total: 0,        // 湯の合計量
};
const LEVEL_MAX = 0.92;        // 最後は画面の上のほうまで満ちる
const DRIP_TAU = 13;           // 溜めた湯が落ちきるまでの目安（秒）。投の
                               //   頭はよく落ち、次の投までにはほぼ止まる
const DROP_Q = 0.00083;        // 雫1つが上げる高さ。小さくするほど、同じ
                               //   湯量でも落ちる回数が増える。1粒ぶんの
                               //   上がり幅は0.6pxほどで、水面のうねりより
                               //   ずっと小さいので、跳ねては見えない
const DROP_G = 1500;           // 雫の落下（px/s²）
const DROP_VMAX = 780;         // 終端速度。空気の抵抗と釣り合って、
                               //   ほんとうの雫はこれ以上は速くならない
const DROP_R = 6.8;            // 雫の半径。粒はどれも同じ大きさ
const DROP_MAX = 40;           // 同時に落ちる雫の数
const BLOOM_HOLD = 4200;       // 1投目は粉が吸うぶん、落ち始めるまで間がある
const CALM_TAU = 2.4;          // 落ちてこなくなってから、水面が凪ぐまで
const BG_BLEED = 320;          // 画面の底より下へ、これだけ余分に塗る。
                               //   板は 1200px あるので、はみ出しても
                               //   画面の外に出るだけ
const LIQ_DEEP = 170;          // 水面からここまでで、いちばん深い色になる。
                               //   浅いままで箱の底に届くと、そこから下の
                               //   受け持ちとのあいだに段が見える

function splashPour() { /* 雫は溜まったぶんから自然に落ちる。合図は要らない */ }

function resetBrewBackground() {
  Object.assign(brew, {
    level: 0, target: 0, counted: 0, pending: 0, acc: 0, at: 0,
    drops: [], ripples: [], puffs: [], puffAt: 0, splash: [],
    holdUntil: 0, firstPour: true, stir: 0, w: 0,
  });
}

/* 水面の高さ。
   ・うねりは、雫が落ちているあいだは立ち、落ちてこなくなると凪いでいく
   ・落ちた点から広がる波は、器のふちで跳ね返って戻ってくる
   ・器のふちでは、水がわずかに壁を這い上がる（メニスカス） */
function surfaceAt(x, base, t, now) {
  const sway = 0.34 + 0.66 * brew.stir;
  let y = base
    + Math.sin(x / 88 + t * 0.8) * 2.2 * sway
    + Math.sin(x / 43 - t * 1.35) * 1.2 * sway
    + Math.sin(x / 210 + t * 0.35) * 2.8 * sway;
  const w = brew.w || 0;
  for (const r of brew.ripples) {
    const age = (now - r.t0) / 1000;
    if (age < 0 || age > 2.6) continue;
    const front = age * 170;
    const env = r.power * Math.exp(-age / 0.95);
    /* もとの波と、左右の壁で折り返してきた波 */
    const arms = [[Math.abs(x - r.x), 1], [x + r.x, 0.5], [Math.abs(2 * w - r.x - x), 0.5]];
    for (const [d, k] of arms) {
      if (d > front + 90) continue;
      y += Math.sin((d - front) / 22) * 7 * env * k * Math.exp(-Math.abs(d - front) / 70);
    }
  }
  /* 壁ぎわの這い上がり。ここがあると、器に入っているように見える */
  if (w) y -= 7 * (Math.exp(-x / 24) + Math.exp(-(w - x) / 24));
  return y;
}

/* 1粒の雫。下がふくらみ、上へ細く尾を引く本物の形をなぞる。
   単色で塗ると染みになるので、下ほど濃い縦のグラデーションにし、
   左上に小さな照りを置いて、水の玉らしく見せる */
function drawDroplet(ctx, x, y, rx, ry, tail, accent) {
  const top = y - ry * tail;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.bezierCurveTo(x - rx * 0.26, top + ry * tail * 0.5, x - rx, y - ry * 0.8, x - rx, y);
  ctx.ellipse(x, y, rx, ry, 0, Math.PI, 0, true);   // ふくらんだ下半分
  ctx.bezierCurveTo(x + rx, y - ry * 0.8, x + rx * 0.26, top + ry * tail * 0.5, x, top);
  ctx.closePath();

  const g = ctx.createLinearGradient(0, top, 0, y + ry);
  g.addColorStop(0, cssRgba(accent, 0.045));
  g.addColorStop(0.5, cssRgba(accent, 0.15));
  g.addColorStop(1, cssRgba(accent, 0.3));
  ctx.fillStyle = g;
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.33, y - ry * 0.28, rx * 0.19, ry * 0.28, -0.5, 0, TAU);
  ctx.fill();
}

/* 画面の底がどこかを、ブラウザ自身に答えさせる。
   タイマーのボタンは position:fixed;bottom:0 で置いてあるので、その下端が
   そのまま「見えている画面の底」になる。innerHeight も svh も dvh も端末に
   よって実際の見え方とずれるが、ブラウザが bottom:0 を置いた位置はずれない */
function screenBottom() {
  const r = $("timer-foot").getBoundingClientRect();
  return r.height ? Math.round(r.bottom) : Math.round(window.innerHeight || 0);
}

function drawBrewBackground(now) {
  const canvas = $("brew-bg");
  /* 板はどの画面より高い。絵の位置は実測した画面の高さ h で決め、
     液はそこから BG_BLEED ぶん下まで塗って、底で切れないようにする */
  const w = canvas.clientWidth, hBox = canvas.clientHeight;
  if (!w || !hBox) return;
  const h = Math.max(1, Math.min(hBox - 20, screenBottom()));
  const hFill = Math.min(hBox, h + BG_BLEED);
  /* 設定で切ってあるとき、タイマー画面を離れたときは何も描かない */
  if (!settings.drips || !$("screen-timer").classList.contains("active")) {
    brew.at = now;
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  /* 高さも見ること。端末のバーが出入りすると幅は変わらず高さだけ変わる。
     そこで作り直しそこねると、描いた絵が縦に潰れる */
  const pw = Math.round(w * dpr), ph = Math.round(hBox * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hFill);

  const dtMs = Math.min(120, now - (brew.at || now - 16));
  const dt = dtMs / 1000;
  brew.at = now;
  brew.w = w;
  /* 円を真ん中に置くための丈も、同じ実測値から */
  if (brew.screenH !== h) {
    brew.screenH = h;
    document.documentElement.style.setProperty("--screen-h", `${h}px`);
  }
  const t = now / 1000;
  /* 雫が落ちてこなくなると、水面はだんだん凪ぐ */
  brew.stir *= Math.exp(-dt / CALM_TAU);

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
    /* 粒はどれも同じ大きさ、同じ間合いで落ちる。溜まりが減るにつれて
       間合いが空いていくのは、そのまま（pending が減るから） */
    while (brew.acc >= DROP_Q && brew.drops.length < DROP_MAX && brew.pending > 0) {
      const q = Math.min(DROP_Q, brew.pending);
      brew.acc -= DROP_Q;
      brew.pending -= q;
      brew.drops.push({
        /* 注ぎ口は1点。ばらけさせると、垂れるというより降ってくる */
        x: w * 0.5 + (Math.random() - 0.5) * 9,
        y: -14 - DROP_R - Math.random() * 26,
        v: 30 + Math.random() * 40,
        r: DROP_R,
        /* ちぎれた直後の雫は、平たくなったり細長くなったりを繰り返す */
        osc: Math.random() * TAU, oscA: 0.2 + Math.random() * 0.1,
        q,
      });
    }
    /* 数が頭打ちのあいだに溜め込んで、あとで束になって落ちないように */
    brew.acc = Math.min(brew.acc, DROP_Q * 3.5);
    /* 最後のひとしずくが残り続けないよう、細くなったら畳む */
    if (brew.pending < DROP_Q * 0.4 && !brew.drops.length) {
      brew.level += brew.pending;
      brew.pending = 0;
    }
  }

  const { accent } = themeColors();
  const base = h - brew.level * LEVEL_MAX * h;
  const yAt = (x) => surfaceAt(x, base, t, now);
  brew.ripples = brew.ripples.filter((r) => now - r.t0 < 2600);

  /* --- 液 --- *
   *  水面から板の底まで、ひと続きに塗る。板は画面より BG_BLEED ぶん
   *  背が高く、器のどこにも overflow:hidden が無いので切られない
   * ------------------------------------------------------------------ */
  if (brew.level > 0.001) {
    const grad = ctx.createLinearGradient(0, base - 6, 0, base + LIQ_DEEP);
    grad.addColorStop(0, cssRgba(accent, 0.03));
    grad.addColorStop(0.35, cssRgba(accent, 0.13));
    grad.addColorStop(1, cssRgba(accent, 0.2));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, yAt(x));
    ctx.lineTo(w, hFill);
    ctx.lineTo(0, hFill);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = cssRgba(accent, 0.22);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0));
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, yAt(x));
    ctx.stroke();
    ctx.strokeStyle = cssRgba(accent, 0.045);
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(0, yAt(0) + 4);
    for (let x = 0; x <= w; x += 6) ctx.lineTo(x, yAt(x) + 4);
    ctx.stroke();
  }

  /* --- 落ちる雫 --- */
  /* 雫は画面のいちばん上から入り、円や文字の裏を素通りして水面へ落ちる */
  for (const d of brew.drops) {
    d.v = Math.min(DROP_VMAX, d.v + DROP_G * dt);
    d.y += d.v * dt;
    d.oscA *= Math.exp(-dt / 0.8);
    const surface = yAt(d.x);
    if (d.y >= surface) {
      brew.level += d.q;
      const power = 0.35 + d.r / 14;
      brew.ripples.push({ t0: now, x: d.x, power });
      brew.stir = Math.min(1, brew.stir + power * 0.7);
      /* 着水で跳ねる小さな粒。数が多いので、たまに跳ねるくらいで足りる */
      const n = Math.random() < 0.3 ? 1 + ((Math.random() * 2) | 0) : 0;
      for (let k = 0; k < n; k++) {
        brew.splash.push({
          x: d.x + (Math.random() - 0.5) * d.r * 2.6, y: surface - 2,
          vx: (Math.random() - 0.5) * 110, vy: -(70 + Math.random() * 110),
          r: 1 + Math.random() * 1.6,
        });
      }
      d.done = true;
      continue;
    }
    /* 速いほど尾が伸びる。形は落ちながら平たく／細長くと揺れる */
    const wob = 1 + Math.sin(t * 13 + d.osc) * d.oscA;
    drawDroplet(ctx, d.x, d.y, d.r * wob, d.r / wob,
      Math.min(2.5, 1.15 + d.v / 900), accent);
  }
  brew.drops = brew.drops.filter((d) => !d.done);

  /* --- 跳ねた粒 --- */
  ctx.fillStyle = cssRgba(accent, 0.3);
  for (const p of brew.splash) {
    p.vy += DROP_G * 0.55 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.vy > 0 && p.y >= yAt(p.x)) { p.done = true; continue; }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, TAU);
    ctx.fill();
  }
  brew.splash = brew.splash.filter((p) => !p.done);

  /* --- 湯気 --- */
  /* 白く。背景と同じ白ではなく、少し明るい白で浮かせる */
  if (brew.level > 0.006 && now - brew.puffAt > 330) {
    brew.puffAt = now;
    const px = w * (0.34 + Math.random() * 0.32);
    brew.puffs.push({
      x: px, y: yAt(px) - 4, born: now,
      life: 2400 + Math.random() * 1100,
      r: 7 + Math.random() * 5,
      vy: 50 + Math.random() * 28,
      drift: (Math.random() - 0.5) * 30,
      seed: Math.random() * 10,
    });
  }
  brew.puffs = brew.puffs.filter((p) => now - p.born < p.life);
  const steamPeak = 0.78;
  for (const p of brew.puffs) {
    const age = (now - p.born) / p.life;
    const y = p.y - p.vy * ((now - p.born) / 1000) * (1 + age * 1.4);
    const x = p.x + Math.sin(age * 3.1 + p.seed) * 16 + p.drift * age;
    /* 立ちのぼるにつれて縦に伸びる。太いままだと湯気ではなく泡に見える */
    const rx = p.r * (1 + age * 1.2);
    const ry = rx * (2.1 + age * 1.2);
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

/* いまと次の手順を、手を動かすのに要る形だけで出す。
   注ぐ手順なら「60 g を 45 秒」、それ以外なら「氷 を 10 秒」。
   走り出す前と数え下げのあいだは、1つ目と2つ目を出しておく */
function stripCell(steps, total, i, what, forSec) {
  /* 無いものは空のまま。記号を置くと、そこに何かあるように見える */
  if (i < 0 || i >= steps.length) { what.textContent = ""; forSec.textContent = ""; return; }
  const st = steps[i];
  const to = i + 1 < steps.length ? steps[i + 1].at : total;
  const span = Math.max(0, Math.round(to - st.at));
  if (st.kind === "finish") {
    what.textContent = "Ende";
    forSec.textContent = "";
    return;
  }
  const g = pourAmount(steps, i);
  what.textContent = g ? `${g} g` : (st.label || KIND_LABEL[st.kind] || "—");
  forSec.textContent = span ? `${span} s` : "";
}

let stripShown = null;          // いま出している手順の番号

function renderStrip(steps, total, curIdx) {
  const strip = $("timer-strip");
  if (!steps.length || timer.state === "done") {
    strip.hidden = true;
    stripShown = null;
    return;
  }
  strip.hidden = false;
  if (curIdx === stripShown) return;

  /* 真ん中はいまの回。左は前の回、右は次の回。走り出す前は、1つ目を
     真ん中に置いて左を空にする */
  const i = Math.max(0, curIdx);
  stripCell(steps, total, i - 1, $("strip-l-what"), $("strip-l-for"));
  stripCell(steps, total, i, $("strip-c-what"), $("strip-c-for"));
  stripCell(steps, total, i + 1, $("strip-r-what"), $("strip-r-for"));

  /* 回が移ったら、1つぶん送ってカシャッと収まる。開いた直後は動かさない */
  if (stripShown !== null && curIdx > stripShown) {
    strip.classList.remove("shift");
    void strip.offsetWidth;            // 巻き戻して、もう一度かける
    strip.classList.add("shift");
  }
  stripShown = curIdx;
}

/* ---------- タイマーの見た目 ---------- */
/* ボタンは常に1行に収める。淹れ終わりで行が増えると、上の表示がずれる */
function renderTimerStatic() {
  const free = !timer.recipe;
  const st = timer.state;
  const show = (id, on) => { $(id).hidden = !on; };

  const toggle = $("timer-toggle");
  toggle.textContent = t(st === "count" ? "Stop"
    : st === "running" ? "Pause"
    : st === "paused" ? "Resume" : "Start");
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
    if (timer.recipe) renderStrip(scaledSteps(), timerTotalSec(), -1);
    else $("timer-strip").hidden = true;
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
    $("timer-strip").hidden = true;
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
    main.textContent = "Ende";
    main.lang = "de";
    main.classList.remove("with-unit", "waiting", "count");
    sub.textContent = "";
    sub.lang = "";
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

  renderStrip(steps, total, idle ? -1 : curIdx);

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
/* 記録を書かなくても、最後まで淹れて Finish を押したなら1杯は淹れている。
   豆やメモの無い、淹れ方だけの記録を残しておく。あとから書き足せる */
$("timer-finish").addEventListener("click", async () => {
  stopTimerLoop();
  await logFinishedBrew();
  showScreen("brew");
  renderHome();
  renderLog();
});

async function logFinishedBrew() {
  const b = emptyBrew();
  b.brewedAt = timer.startedAt || Date.now();
  b.timeSec = Math.round(timerElapsedMs() / 1000);
  const r = timer.recipe;
  if (r) {
    b.recipeId = r.id;
    b.recipeName = r.name;
    b.method = r.method || "";
    b.grind = r.grind || "";
    b.doseG = recipeDose();
    b.waterG = recipeWater();
    b.tempC = r.tempC ?? null;
    const stored = findRecipe(r.id);
    if (stored) { stored.usedAt = Date.now(); await saveRecipe(stored); }
  }
  /* 同じ豆を続けて使うことが多いので、直近の記録から引き継ぐ */
  const last = liveBrews()[0];
  if (last) {
    b.bean = last.bean;
    b.roaster = last.roaster;
    b.roast = last.roast;
    b.grinder = last.grinder;
    if (!b.method) b.method = last.method;
  }
  await saveBrew(b);
  toast(t("Counted as one brew"));
}
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
  toast(settings.chime ? t("Sound on") : t("Sound off"));
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
  body.appendChild(el("div", "bi-title", brew.bean || brew.recipeName || brew.method || t("Untitled cup")));
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
      ? t("Nothing matches that.")
      : t("Nothing logged yet. Brew something and it will live here.");
    return;
  }
  let lastKey = "";
  for (const b of list) {
    const d = new Date(b.brewedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== lastKey) {
      box.appendChild(el("div", "month-head", fmtMonthYear(d)));
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
  let svg = `<svg class="radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="${t("Taste balance")}">`;
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
    svg += `<text class="label" x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">${t(label)}</text>`;
  });
  return svg + "</svg>";
}

let detailId = "";

function openBrewDetail(id, { replace = false } = {}) {
  const b = findBrew(id);
  if (!b) return;
  detailId = id;
  $("detail-title").textContent = fmtDate(b.brewedAt);

  const kv = (label, value, unit) =>
    `<div class="kv"><div class="kv-label">${label}</div><div class="kv-value">${value ?? "—"}${
      value != null && unit ? `<span class="unit">${unit}</span>` : ""}</div></div>`;

  const tags = (b.flavors || []).map((f) => `<span class="tag">${escapeHtml(t(f))}</span>`).join("");
  const note = (head, body) => body
    ? `<div class="note-block"><div class="note-head">${head}</div><div class="note-body">${escapeHtml(body)}</div></div>`
    : "";

  const sub = [b.roaster, b.roast ? t(b.roast) : "", b.recipeName ? t("Recipe: %s", b.recipeName) : "", fmtDateTime(b.brewedAt)]
    .filter(Boolean).join(" · ");

  $("detail-body").innerHTML = `
    <div class="detail-hero">
      <div class="dh-bean">${escapeHtml(b.bean || b.method || t("Untitled cup"))}</div>
      <div class="dh-sub">${escapeHtml(sub)}</div>
      <div class="dh-stars">${b.rating ? starsHtml(b.rating) : '<span class="off">★★★★★</span>'}</div>
    </div>
    <div class="kv-grid">
      ${kv(t("Dose"), b.doseG, "g")}
      ${kv(t("Water"), b.waterG, "g")}
      ${kv(t("Ratio"), b.doseG && b.waterG ? ratioText(b.doseG, b.waterG) : null, "")}
      ${kv(t("Temp"), b.tempC, "°C")}
      ${kv(t("Time"), b.timeSec ? fmtClock(b.timeSec) : null, "")}
      ${kv(t("Grind"), b.grind ? t(b.grind) : null, "")}
    </div>
    ${b.method || b.grinder ? `<div class="note-block"><div class="note-head">${t("Gear")}</div><div class="note-body">${
      escapeHtml([b.method, b.grinder].filter(Boolean).join(" / "))}</div></div>` : ""}
    <div class="radar-box">${tasteRadar(b.taste)}</div>
    ${tags ? `<div class="tag-row">${tags}</div>` : ""}
    ${note(t("How it went"), b.notes)}
    ${note(t("Next time"), b.next)}
    <button class="wide-btn primary" id="detail-rebrew" type="button">${t("Brew this recipe again")}</button>
    <button class="wide-btn ghost" id="detail-copy" type="button">${t("Start a new log from this")}</button>
  `;

  const rebrew = $("detail-rebrew");
  const recipe = b.recipeId ? findRecipe(b.recipeId) : null;
  if (recipe) {
    rebrew.addEventListener("click", () => openTimer(recipe));
  } else {
    rebrew.textContent = t("Time it without a recipe");
    rebrew.addEventListener("click", () => openTimer(null));
  }
  $("detail-copy").addEventListener("click", () => {
    const copy = { ...JSON.parse(JSON.stringify(b)), id: newId(), brewedAt: Date.now(),
      rating: 0, notes: "", next: "", createdAt: Date.now() };
    openBrewEditor(copy, { isNew: true });
  });

  showScreen("brew-detail", { replace });
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

/* ---------- 記録につけるレシピ ---------- *
 *  何で淹れたのかは、あとから思い出せないことのほうが多い。すでに書いた
 *  レシピから選べるようにして、器具や分量が空いていればそこから埋める。
 *  一覧に無ければ、その場で新しいレシピを書きに行ける。
 * ------------------------------------------------------------------ */
const NEW_RECIPE_OPT = "__new";
let recipeReturn = null;      // レシピを書き終えたら、この記録へ戻る

function renderRecipeSelect() {
  const sel = $("f-recipe");
  const b = editingBrew || {};
  sel.innerHTML = "";
  const add = (value, label) => {
    const o = document.createElement("option");
    o.value = value; o.textContent = label;
    sel.appendChild(o);
    return o;
  };
  add("", t("Not set"));
  const list = liveRecipes();
  for (const r of list) add(r.id, r.name);
  /* 消されたレシピで淹れた記録も、名前だけは残しておく */
  if (b.recipeName && !list.some((r) => r.id === b.recipeId)) add(b.recipeId || b.recipeName, b.recipeName);
  add(NEW_RECIPE_OPT, t("＋ New recipe…"));
  sel.value = b.recipeId || (b.recipeName ? b.recipeName : "");
  if (!sel.value) sel.value = "";
}

/* 空いている欄だけ埋める。打ち込んだものを黙って上書きしない */
function fillFromRecipe(r) {
  const put = (id, value) => {
    const node = $(id);
    if (node.value === "" && value !== "" && value != null) node.value = value;
  };
  put("f-method", r.method || "");
  put("f-grind", r.grind || "");
  put("f-dose", r.doseG ?? "");
  put("f-water", r.waterG ?? "");
  put("f-temp", r.tempC ?? "");
  put("f-time", r.totalSec ? fmtClock(r.totalSec) : "");
  updateRatioReadout();
}

$("f-recipe").addEventListener("change", () => {
  const sel = $("f-recipe");
  const b = editingBrew;
  if (!b) return;
  if (sel.value === NEW_RECIPE_OPT) {
    /* いま書いてあるものを持ったまま、レシピを書きに行く */
    stashBrewForm();
    sel.value = b.recipeId || "";
    openRecipeEditor(null);
    recipeReturn = true;
    return;
  }
  if (!sel.value) { b.recipeId = ""; b.recipeName = ""; return; }
  const r = findRecipe(sel.value);
  if (!r) { b.recipeName = sel.options[sel.selectedIndex].textContent; return; }
  b.recipeId = r.id;
  b.recipeName = r.name;
  fillFromRecipe(r);
  toast(t("Filled in from “%s”", r.name));
});

/* 画面を離れるあいだ、打ちかけを editingBrew に預けておく */
function stashBrewForm() {
  const b = editingBrew;
  if (!b) return;
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
}

function openBrewEditor(brew, { isNew }) {
  editingBrew = brew;
  editingIsNew = isNew;
  refreshSuggestLists();
  $("brew-edit-title").textContent = t(isNew ? "Log a brew" : "Edit this brew");
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
  renderRecipeSelect();
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
    row.appendChild(el("span", "taste-name", t(label)));
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
    const chip = el("button", `chip${chosen.includes(name) ? " active" : ""}`, t(name));
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
  const picked = $("f-recipe").value;
  if (!picked) { b.recipeId = ""; b.recipeName = ""; }
  else {
    const r = findRecipe(picked);
    if (r) { b.recipeId = r.id; b.recipeName = r.name; }
  }
  await saveBrew(b);
  toast(t(editingIsNew ? "Logged" : "Saved"));
  renderHome();
  renderLog();
  /* 書き終えた記入欄は道に残さない。詳細から戻ると、元いた画面へ */
  openBrewDetail(b.id, { replace: true });
});

$("brew-delete").addEventListener("click", async () => {
  if (!(await confirmAsk(t("Delete this brew? This cannot be undone.")))) return;
  await removeRecord("brews", editingBrew.id);
  toast(t("Deleted"));
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
    box.appendChild(el("p", "empty-note", t("No recipes. Add one with the + above.")));
    return;
  }
  for (const r of list) box.appendChild(recipeCard(r, true));
}
$("recipe-add-btn").addEventListener("click", () => openRecipeEditor(null));

/* ---------- レシピの編集 ---------- */
let editingRecipe = null;
let editingRecipeIsNew = false;

function openRecipeEditor(id) {
  recipeReturn = null;
  const found = id ? findRecipe(id) : null;
  editingRecipe = found ? JSON.parse(JSON.stringify(found)) : emptyRecipe();
  editingRecipeIsNew = !found;
  $("recipe-edit-title").textContent = t(found ? "Edit recipe" : "New recipe");
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
    timeField.innerHTML = `<label>${t("At")}</label>`;
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
    kindField.innerHTML = `<label>${t("Kind")}</label>`;
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
    waterField.innerHTML = `<label>${t("Total g")}</label>`;
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
    del.setAttribute("aria-label", t("Remove this step"));
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
    labelInput.placeholder = t(step.kind === "pour" ? "e.g. Second pour" : "e.g. Break the crust");
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
  r.name = $("r-name").value.trim() || t("Untitled recipe");
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
  toast(t(editingRecipeIsNew ? "Recipe created" : "Saved"));
  renderRecipes();
  renderHome();
  if (recipeReturn && editingBrew) {
    recipeReturn = null;
    editingBrew.recipeId = r.id;
    editingBrew.recipeName = r.name;
    openBrewEditor(editingBrew, { isNew: editingIsNew });
    fillFromRecipe(r);
    return;
  }
  showScreen("recipes");
});

$("recipe-delete").addEventListener("click", async () => {
  if (!(await confirmAsk(t("Delete this recipe? This cannot be undone.")))) return;
  await removeRecord("recipes", editingRecipe.id);
  toast(t("Deleted"));
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

/* 言語は3つきり。開いて選ぶより、並べて押すほうが早い */
function renderLangPicker() {
  const box = $("s-lang");
  box.innerHTML = "";
  for (const l of LANGS) {
    const b = el("button", "lang-chip" + (settings.lang === l.id ? " on" : ""), l.name);
    b.type = "button";
    b.lang = l.id;
    b.setAttribute("aria-pressed", String(settings.lang === l.id));
    b.addEventListener("click", async () => {
      if (settings.lang === l.id) return;
      settings.lang = l.id;
      await saveSettings();
      relang();
    });
    box.appendChild(b);
  }
}

/* ことばを入れ替えたら、いま出ている札も、次に開く画面も、まとめて描き直す */
function relang() {
  applyLang();
  renderLangPicker();
  renderSettings();
  renderHome();
  renderLog();
  renderRecipes();
  if (editingBrew && $("screen-brew-edit").classList.contains("active")) renderRecipeSelect();
  if (calMonth) renderCalendar();
  /* 詳細は「いま出ているとき」だけ描き直す。開いてもいない画面へ
     連れて行かれては、ことばを選んだだけのつもりが旅になる */
  if (detailId && findBrew(detailId) && $("screen-brew-detail").classList.contains("active")) {
    openBrewDetail(detailId, { replace: true });
  }
  renderTimerStatic();
  renderTimerLive();
}

function renderSettings() {
  $("s-chime").checked = settings.chime;
  $("s-precue").checked = settings.precue;
  $("s-vibe").checked = settings.vibe;
  $("s-wakelock").checked = settings.wakelock;
  $("s-drips").checked = settings.drips;
  $("s-volume").value = String(settings.volume);
  $("s-volume-out").textContent = `${settings.volume}%`;
  $("s-countdown").value = String(settings.countdown);
  $("s-countdown-out").textContent = settings.countdown ? `${settings.countdown} s` : t("off");
  renderRoastPicker();
  renderLangPicker();
  $("app-version").textContent = `v${APP_VERSION}`;
  $("s-data-note").textContent =
    t("On this device: %s, %s", counted(liveRecipes().length, "recipe"), counted(liveBrews().length, "brew"));
}

bindSwitch("s-chime", "chime", () => { syncMuteIcon(); if (timer.state === "running") scheduleUpcomingSounds(); });
bindSwitch("s-precue", "precue", () => { if (timer.state === "running") scheduleUpcomingSounds(); });
bindSwitch("s-vibe", "vibe");
bindSwitch("s-drips", "drips", () => {
  /* 切ったら、残っている絵をその場で消す */
  const c = $("brew-bg");
  if (!settings.drips && c.width) c.getContext("2d").clearRect(0, 0, c.width, c.height);
});
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
  $("s-countdown-out").textContent = settings.countdown ? `${settings.countdown} s` : t("off");
});
$("s-countdown").addEventListener("change", saveSettings);
$("s-test-chime").addEventListener("click", () => playSoundNow("step", 2));
/* 見本の丸は、いま見えている面での色をそのまま塗る。選んだ結果が
   そのとおりに出るほうが、選びやすい */
function renderRoastPicker() {
  const box = $("s-roast");
  if (!box) return;
  box.innerHTML = "";
  for (const roast of ROASTS) {
    const btn = el("button", `roast-swatch${roast.id === settings.roast ? " on" : ""}`);
    btn.type = "button";
    btn.setAttribute("aria-label", t(roast.name));
    const dot = el("span", "roast-dot");
    dot.style.background = roast.hex;
    btn.appendChild(dot);
    btn.appendChild(el("span", "roast-name", t(roast.name)));
    btn.addEventListener("click", async () => {
      settings.roast = roast.id;
      applyTheme();
      await saveSettings();
      renderRoastPicker();
      toast(t("%s roast it is", t(roast.name)));
    });
    box.appendChild(btn);
  }
  const note = $("s-roast-note");
  if (note) note.textContent = t("%s right now. The darker the bean, the deeper the accent.", t(findRoast(settings.roast).name));
}

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
    fmtStamp(b.brewedAt),
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
  if (!n) { toast(t("Nothing to export yet")); return; }
  downloadFile(`coffeerence-records-${today()}.csv`, brewsCsv(), "text/csv;charset=utf-8");
  toast(t("%s exported", counted(n, "brew")));
});

$("s-export-recipes-csv").addEventListener("click", () => {
  const n = liveRecipes().length;
  if (!n) { toast(t("No recipes to export")); return; }
  downloadFile(`coffeerence-recipes-${today()}.csv`, recipesCsv(), "text/csv;charset=utf-8");
  toast(t("%s exported", counted(n, "recipe")));
});

$("s-restore-recipes").addEventListener("click", async () => {
  const existing = new Set(liveRecipes().map((r) => r.name));
  const add = starterRecipes().filter((r) => !existing.has(r.name));
  if (!add.length) { toast(t("They are all here already")); return; }
  recipes.push(...add);
  await idbPutMany("recipes", add);
  renderRecipes(); renderHome(); renderSettings();
  toast(t("%s put back", counted(add.length, "recipe")));
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
  /* 初めての人には、端末のことばに合わせて出しておく。合わなければ英語 */
  if (!(await kvGet("settings", null))) {
    const want = (navigator.language || "en").slice(0, 2);
    if (LANGS.some((l) => l.id === want)) settings.lang = want;
  }
  applyLang();
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
    + t("Could not open the app.<br>Try reloading the page.") + "</p>";
});
