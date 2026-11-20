// ============================================================
// OGP（URL共有プレビュー）用の共通ロジック
//   - middleware.js（Edge Middleware）: プレビューボット向けに名刺OGPを返す
//   - api/card-img.js（Serverless Function）: 名刺写真を実画像として返す
// このファイルは Vercel のルートにはならない（api/ 配下で "_" 始まりは対象外）。
// ロジックは単体テスト可能にするため、副作用のない純関数＋fetch注入可能な形に分離している。
// ============================================================

const FIREBASE_PROJECT_ID = "loalife-51e0a";
// Firebase Web APIキー（build-src/firebase.js の既存configと同じ公開キー。
// クライアントバンドルに含まれて公開配信される前提のキーであり、秘密情報ではない）
const FIREBASE_API_KEY = "AIzaSyAzfQpakeONe6Lngn-OyeegAj69dIMcy40";

const SITE_ORIGIN = "https://loalife-poster.vercel.app";
const SITE_NAME = "LOALIFE";
const GENERIC_OG_IMAGE = SITE_ORIGIN + "/icon-any-512.png";
// サイト共通の説明文（Kao決定文。index.html の meta description と同一文）
const SITE_DESCRIPTION = "大切な家族の毎日を、ひとつの場所で。ペットと子どもの食事・散歩・健康・予定、そしてもしもの時の備えまで記録できます。";

// プレビューボットの User-Agent トークン（小文字・部分一致）。
// 必ず「ボット専用トークン」に限定すること。特に LINE は:
//   - プレビュー取得ボット: "facebookexternalhit/1.1;line-poker/1.0" → "line-poker" で判定
//   - アプリ内ブラウザ(実ユーザー): "... Mobile/15E248 Safari Line/14.21.2"
// 素の "line" で判定すると実ユーザーがプレビュー用HTMLに閉じ込められるため絶対に使わない。
const BOT_UA_PATTERNS = [
  "line-poker",          // LINE プレビュー取得 (PagePoker)
  "facebookexternalhit", // Facebook / LINE(複合UAの先頭トークン)
  "facebot",             // Facebook
  "twitterbot",          // X (Twitter)
  "slackbot",            // Slack (Slackbot-LinkExpanding)
  "discordbot",          // Discord
  "whatsapp",            // WhatsApp（リンクは外部ブラウザで開くためアプリ内ループの心配なし）
  "telegrambot",         // Telegram
  "linkedinbot",         // LinkedIn
  "pinterestbot",        // Pinterest
  "kakaotalk-scrap",     // KakaoTalk プレビュー取得
  "redditbot",           // Reddit
  "skypeuripreview",     // Skype
  "embedly",             // Embedly
  "vkshare"              // VK
];

function isBotUA(ua) {
  if (!ua || typeof ua !== "string") return false;
  const s = ua.toLowerCase();
  return BOT_UA_PATTERNS.some((p) => s.indexOf(p) !== -1);
}

// 名刺IDは genCardId() が生成する英数字20文字
const CARD_ID_RE = /^[A-Za-z0-9]{20}$/;
function isValidCardId(id) {
  return typeof id === "string" && CARD_ID_RE.test(id);
}

// HTML属性・本文へ埋め込む前のエスケープ（カード名等はユーザー入力のため必須）
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s, max) {
  const str = String(s || "");
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

// ─── Firestore REST ──────────────────────────────────────────
function firestoreDocUrl(cardId) {
  return "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID +
    "/databases/(default)/documents/publicCards/" + encodeURIComponent(cardId) +
    "?key=" + FIREBASE_API_KEY;
}

// Firestore REST の型付き値をプレーンな JS 値へ変換する
function parseFirestoreValue(v) {
  if (!v || typeof v !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(v, "stringValue")) return v.stringValue;
  if (Object.prototype.hasOwnProperty.call(v, "booleanValue")) return v.booleanValue;
  if (Object.prototype.hasOwnProperty.call(v, "integerValue")) return Number(v.integerValue);
  if (Object.prototype.hasOwnProperty.call(v, "doubleValue")) return v.doubleValue;
  if (Object.prototype.hasOwnProperty.call(v, "timestampValue")) return v.timestampValue;
  if (Object.prototype.hasOwnProperty.call(v, "nullValue")) return null;
  if (v.arrayValue && Array.isArray(v.arrayValue.values)) return v.arrayValue.values.map(parseFirestoreValue);
  if (v.mapValue && v.mapValue.fields) {
    const out = {};
    for (const k of Object.keys(v.mapValue.fields)) out[k] = parseFirestoreValue(v.mapValue.fields[k]);
    return out;
  }
  return null;
}

// Firestore REST のドキュメントJSON → プレーンオブジェクト。エラー/不存在は null
function parseFirestoreDoc(json) {
  if (!json || typeof json !== "object" || json.error || !json.fields) return null;
  const out = {};
  for (const k of Object.keys(json.fields)) out[k] = parseFirestoreValue(json.fields[k]);
  return out;
}

// publicCards/{cardId} を取得する。いかなる失敗でも throw せず null を返す
// （プレビュー生成の失敗で実ユーザーの表示を壊さないため）
async function fetchPublicCard(cardId, fetchImpl, timeoutMs) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f || !isValidCardId(cardId)) return null;
  let timer = null;
  let ctrl = null;
  try {
    if (typeof AbortController !== "undefined") {
      ctrl = new AbortController();
      timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, timeoutMs || 2500);
    }
    const res = await f(firestoreDocUrl(cardId), ctrl ? { signal: ctrl.signal } : {});
    if (!res || !res.ok) return null;
    const json = await res.json();
    return parseFirestoreDoc(json);
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── 名刺OGPの組み立て ───────────────────────────────────────
// buildCardDoc（build-src/app.jsx）が publicCards に書くフィールドのみを参照する:
//   常時: name / breed / birthday / gender / species / emoji / theme / show*
//   条件付き（値があり表示ONのときだけドキュメントに存在）:
//     personality / skills / favSnack / caution / instagram / tiktok / youtube / photo(data URI)
// og:description には breed / personality / skills / favSnack を使う。
// caution（気をつけてほしいこと）はプレビュー文には含めない（ページ本体で見せる情報のため）。
function buildCardTitle(card) {
  const name = card && typeof card.name === "string" ? card.name.trim() : "";
  return name ? name + "の名刺 | " + SITE_NAME : SITE_NAME;
}

function buildCardDescription(card) {
  if (!card) return SITE_DESCRIPTION;
  const parts = [];
  const push = (label, val) => {
    const v = typeof val === "string" ? val.trim() : "";
    if (v) parts.push(label ? label + "：" + v : v);
  };
  push("", card.breed);
  push("性格", card.personality);
  push("できること", card.skills);
  push("好きなおやつ", card.favSnack);
  if (!parts.length) return SITE_DESCRIPTION;
  return truncate(parts.join("｜") + "｜" + SITE_NAME + "の名刺ページです", 160);
}

// ─── レガシー ?pet= リンク ───────────────────────────────────
// ペイロードは app.jsx の petPageLink が作る base64url(JSON) で、短縮キー:
//   n=name, b=breed, bd=birthday, g=gender, s=species, e=emoji（写真は含まれない）
function decodePetParam(raw) {
  try {
    if (!raw || typeof raw !== "string") return null;
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const d = JSON.parse(new TextDecoder("utf-8").decode(bytes));
    if (!d || !d.n) return null;
    return d;
  } catch (e) {
    return null;
  }
}

function buildPetTitle(pet) {
  const name = pet && typeof pet.n === "string" ? pet.n.trim() : "";
  return name ? name + "の名刺 | " + SITE_NAME : SITE_NAME;
}

function buildPetDescription(pet) {
  const breed = pet && typeof pet.b === "string" ? pet.b.trim() : "";
  const name = pet && typeof pet.n === "string" ? pet.n.trim() : "";
  if (!breed && !name) return SITE_DESCRIPTION;
  return truncate((breed ? breed + "｜" : "") + (name ? name + "の" : "") + SITE_NAME + "の名刺ページです", 160);
}

// ─── OGP用HTML ───────────────────────────────────────────────
function buildOgHtml(opts) {
  const title = escapeHtml(opts.title || SITE_NAME);
  const desc = escapeHtml(opts.description || SITE_DESCRIPTION);
  const image = escapeHtml(opts.image || GENERIC_OG_IMAGE);
  const url = escapeHtml(opts.url || SITE_ORIGIN + "/");
  const cardType = opts.largeImage ? "summary_large_image" : "summary";
  return "<!DOCTYPE html>\n" +
    "<html lang=\"ja\">\n<head>\n" +
    "<meta charset=\"utf-8\">\n" +
    "<title>" + title + "</title>\n" +
    "<meta name=\"description\" content=\"" + desc + "\">\n" +
    "<meta property=\"og:title\" content=\"" + title + "\">\n" +
    "<meta property=\"og:description\" content=\"" + desc + "\">\n" +
    "<meta property=\"og:type\" content=\"website\">\n" +
    "<meta property=\"og:site_name\" content=\"" + SITE_NAME + "\">\n" +
    "<meta property=\"og:url\" content=\"" + url + "\">\n" +
    "<meta property=\"og:image\" content=\"" + image + "\">\n" +
    "<meta name=\"twitter:card\" content=\"" + cardType + "\">\n" +
    "<meta name=\"twitter:title\" content=\"" + title + "\">\n" +
    "<meta name=\"twitter:description\" content=\"" + desc + "\">\n" +
    "<meta name=\"twitter:image\" content=\"" + image + "\">\n" +
    "<link rel=\"canonical\" href=\"" + url + "\">\n" +
    "</head>\n<body>\n" +
    "<p><a href=\"" + url + "\">" + title + "</a></p>\n" +
    "</body>\n</html>\n";
}

// ─── data URI デコード（card-img 用） ────────────────────────
// 画像の base64 data URI のみを受け付ける。それ以外は null
function decodeDataUri(dataUri) {
  if (typeof dataUri !== "string") return null;
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUri);
  if (!m || !m[2]) return null; // base64 形式のみ対応
  const mime = m[1] || "";
  if (!/^image\//.test(mime)) return null;
  const base64 = m[3].replace(/\s/g, "");
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) return null;
  return { mime: mime, base64: base64 };
}

module.exports = {
  FIREBASE_PROJECT_ID,
  SITE_ORIGIN,
  SITE_NAME,
  GENERIC_OG_IMAGE,
  SITE_DESCRIPTION,
  BOT_UA_PATTERNS,
  isBotUA,
  isValidCardId,
  escapeHtml,
  truncate,
  firestoreDocUrl,
  parseFirestoreValue,
  parseFirestoreDoc,
  fetchPublicCard,
  buildCardTitle,
  buildCardDescription,
  decodePetParam,
  buildPetTitle,
  buildPetDescription,
  buildOgHtml,
  decodeDataUri
};
