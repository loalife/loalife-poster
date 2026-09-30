"use strict";
/* 定数・ユーティリティ・データ保存・予定の展開 */

/* ---------- 定数 ---------- */
const EVENT_TYPES = [
  { id: "live", label: "ライブ・公演" },
  { id: "release", label: "発売日" },
  { id: "stream", label: "配信・放送" },
  { id: "birthday", label: "誕生日", yearly: true },
  { id: "anniv", label: "記念日", yearly: true },
  { id: "other", label: "その他" },
  // リマインダー（チケットまわりの「やること」）。締切として扱い、完了チェックができる
  // tone：締切の色分け（apply＝申込系は黄、pay＝入金系は赤、なし＝黒）
  { id: "lottery", label: "チケット抽選", task: true, tone: "apply" },
  { id: "payment", label: "入金", task: true, tone: "pay" },
  { id: "ticket", label: "発券", task: true },
  // チケットの申し込みから自動で作られる締切（予定のフォームでは選ばない）
  { id: "apply", label: "申込締切", task: true, tone: "apply", app: true },
  { id: "result", label: "当落発表", task: true, app: true },
  { id: "pay", label: "入金期限", task: true, tone: "pay", app: true },
];
const EXPENSE_CATS = [
  { id: "goods", label: "グッズ" },
  { id: "ticket", label: "チケット" },
  { id: "travel", label: "遠征（交通・宿泊）" },
  { id: "cafe", label: "カフェ・お出かけ" },
  { id: "media", label: "CD・円盤・本" },
  { id: "stream", label: "配信・サブスク" },
  { id: "other", label: "その他" },
];
// チケットの申し込みの状態（申込前 → 申込中 → 当選／落選 → 入金済み）
const APP_STATUS = [
  { id: "planned", label: "申込前" },
  { id: "applied", label: "申込中" },
  { id: "won", label: "当選" },
  { id: "lost", label: "落選" },
  { id: "paid", label: "入金済み" },
];
const PLACE_CATS = [
  { id: "cafe", label: "カフェ" },
  { id: "dogrun", label: "ドッグラン" },
  { id: "venue", label: "イベント会場" },
  { id: "seichi", label: "聖地巡礼" },
  { id: "shop", label: "ショップ" },
  { id: "other", label: "その他" },
];
const MEMBER_COLORS = [
  "#d64545", "#e0729a", "#e38a4f", "#e5c24a", "#4f9d6f", "#56b3aa",
  "#5a97d0", "#3b5aa6", "#8a64b6", "#b6a5d8", "#e9e9e9", "#2b2b2e",
];
// 色の丸を読み上げるときの名前
const COLOR_NAMES = {
  "#d64545": "赤", "#e0729a": "ピンク", "#e38a4f": "オレンジ", "#e5c24a": "黄色", "#4f9d6f": "緑", "#56b3aa": "ミント",
  "#5a97d0": "水色", "#3b5aa6": "青", "#8a64b6": "紫", "#b6a5d8": "ラベンダー", "#e9e9e9": "白", "#2b2b2e": "黒",
};
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
const WEEK_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const KEY = "oshical.v1";
const DEFAULT_DATA = {
  oshis: [], events: [], expenses: [], reports: [], places: [], savings: [], apps: [],
  settings: { v: 3, scrim: 0.5, blur: 0, bgPos: "center", mainOshiId: "", budgets: {} },
};

/* ---------- ユーティリティ ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
const yenNum = (n) => Math.round(n || 0).toLocaleString("ja-JP");
const yenHtml = (n) => `<span class="cur">¥</span>${yenNum(n)}`;
const md = (s, sep = "/") => `${s.slice(5, 7)}${sep}${s.slice(8, 10)}`;
const dowEn = (s) => WEEK_EN[parseDate(s).getDay()];
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const typeOf = (id) => EVENT_TYPES.find((t) => t.id === id) || EVENT_TYPES.find((t) => t.id === "other");
const isTask = (e) => !!typeOf(e.type).task;
const toneOf = (e) => typeOf(e.type).tone || "";
const appStatusOf = (id) => APP_STATUS.find((s) => s.id === id) || APP_STATUS[0];
const isAnniv = (e) => e.type === "birthday" || e.type === "anniv";
const catOf = (id) => EXPENSE_CATS.find((c) => c.id === id) || EXPENSE_CATS[EXPENSE_CATS.length - 1];
const placeCatOf = (id) => PLACE_CATS.find((c) => c.id === id) || PLACE_CATS[PLACE_CATS.length - 1];
const fmtDot = (s) => s.replaceAll("-", ".");
const oshiOf = (id) => data.oshis.find((o) => o.id === id);
const mainOshi = () => oshiOf(data.settings.mainOshiId) || data.oshis[0];

/* ---------- 推しカラー ----------
   推しカラーはそのまま「点」に使い、文字に使うときは背景とのコントラストが
   3:1 以上になるまで黒（ダーク時は白）に寄せる。黄色や白でも読めるように。 */
const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const hexRgb = (h) => { const m = /^#([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function readable(hex) {
  let c = hexRgb(hex);
  if (!c) return null;
  const dark = isDark(), bg = dark ? [14, 14, 16] : [246, 245, 242], t = dark ? 255 : 0;
  for (let i = 0; i < 14 && contrast(c, bg) < 3.2; i++) c = c.map((v) => Math.round(v + (t - v) * 0.18));
  return `rgb(${c.join(",")})`;
}
const colorVars = (hex) => (hexRgb(hex) ? `--oc:${hex};--ot:${readable(hex)};--oi:${lum(hexRgb(hex)) > 0.4 ? "#1c1c1e" : "#ffffff"}` : "--oc:var(--text3);--ot:var(--text2);--oi:#fff");

/* ---------- 推しの写真 ----------
   IndexedDB に「oshi:<id>」で保存し、表示用の URL をここに持つ */
const oshiPhotos = new Map();
const initial = (name) => esc(Array.from(String(name || "").trim())[0] || "");
function oshiAvatar(o, size, url = oshiPhotos.get(o.id)) {
  return `<span class="av${url ? " img" : ""}" style="--s:${size}px;${colorVars(o.color)}" aria-hidden="true">${url ? `<img src="${url}" alt="">` : initial(o.name)}</span>`;
}
function setOshiPhoto(id, blob) {
  if (oshiPhotos.has(id)) URL.revokeObjectURL(oshiPhotos.get(id));
  if (blob) oshiPhotos.set(id, URL.createObjectURL(blob)); else oshiPhotos.delete(id);
}
async function loadOshiPhotos() {
  for (const url of oshiPhotos.values()) URL.revokeObjectURL(url);
  oshiPhotos.clear();
  for (const o of data.oshis) {
    try { const b = await idbGet("oshi:" + o.id); if (b) setOshiPhoto(o.id, b); } catch {}
  }
}
const tag = (o) => (o ? `<span class="tag" style="${colorVars(o.color)}">${esc(o.name)}</span>` : "");
function applyAccent() {
  const root = document.documentElement.style, o = mainOshi(), c = o && readable(o.color);
  if (c) {
    root.setProperty("--accent", c);
    root.setProperty("--accent-ink", lum(c.match(/\d+/g).map(Number)) > 0.4 ? "#1c1c1e" : "#ffffff");
  } else {
    root.removeProperty("--accent");
    root.removeProperty("--accent-ink");
  }
}

/* ---------- アイコン（細線・統一） ---------- */
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  home: '<path d="M12 20s-7-4.3-8.6-8.6A4.6 4.6 0 0 1 12 7.2a4.6 4.6 0 0 1 8.6 4.2C19 15.7 12 20 12 20z"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  money: '<rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M3.5 10.5h17M15.5 15h2"/>',
  all: '<circle cx="8" cy="8" r="2.4"/><circle cx="16" cy="8" r="2.4"/><circle cx="8" cy="16" r="2.4"/><circle cx="16" cy="16" r="2.4"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  note: '<path d="M6 3.5h10.5a2 2 0 0 1 2 2V20.5H8a2 2 0 0 1-2-2z"/><path d="M6 18.5a2 2 0 0 1 2-2h10.5M9.5 8h5.5M9.5 11.5h4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  gift: '<rect x="4" y="9" width="16" height="11.5" rx="1.5"/><path d="M3 9h18M12 9v11.5M12 9c-1.5-3.5-5.5-4-5.5-1.5S10 9 12 9zm0 0c1.5-3.5 5.5-4 5.5-1.5S14 9 12 9z"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  bed: '<path d="M3 18.5V7M21 18.5v-5a3 3 0 0 0-3-3h-8v5.5M3 15h18"/><circle cx="6.5" cy="11.5" r="1.8"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  light: '<path d="M10 3.5h4l-.8 11h-2.4z"/><path d="M9.5 14.5h5v3a2.5 2.5 0 0 1-5 0z"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11"/><path d="M4 6.5l1 1 2-2M4 11.5l1 1 2-2M4 16.5l1 1 2-2"/>',
  piggy: '<path d="M5 11.5a6.5 5.5 0 0 1 11.8-2.6H19v3.3l1.5.8v2.2l-2 .6a6.4 6.4 0 0 1-2.3 2.2V20h-2.5v-1.2a8 8 0 0 1-3.4 0V20H8v-2.1A5.3 5.3 0 0 1 5 11.5z"/><path d="M10 7.5h3"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.3-3.6 4.1-5.4 7.5-5.4s6.2 1.8 7.5 5.4"/>',
};
const icon = (n, w = 1.6) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

/* ---------- 保存 ---------- */
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.oshis)) {
      return migrate(d);
    }
  } catch {}
  return structuredClone(DEFAULT_DATA);
}
// 古い形式のデータを今の形にそろえる（バックアップの読み込みでも使う）
function migrate(d) {
  const settings = { ...DEFAULT_DATA.settings, ...d.settings };
  const v = d.settings?.v || 1;
  // v1 はフィルターが弱めだったので、読みやすさ優先の値に引き上げる
  if (v < 2) settings.scrim = Math.max(0.5, +settings.scrim || 0);
  settings.v = 3;
  settings.budgets = { ...(settings.budgets || {}) };
  const out = { ...structuredClone(DEFAULT_DATA), ...d, settings };
  for (const k of ["oshis", "events", "expenses", "reports", "places", "savings", "apps"]) if (!Array.isArray(out[k])) out[k] = [];
  // v3：「宿泊」は「遠征（交通・宿泊）」にまとめた
  for (const x of out.expenses) if (x.category === "hotel") x.category = "travel";
  return out;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { toast("保存できませんでした（端末の容量を確認してください）"); }
}
let data = load();

// 背景写真は大きいので IndexedDB に Blob で保存する
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open("oshical", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const req = fn(db.transaction("kv", mode).objectStore("kv"));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
const idbGet = (k) => idbDo("readonly", (s) => s.get(k));
const idbSet = (k, v) => idbDo("readwrite", (s) => s.put(v, k));
const idbDel = (k) => idbDo("readwrite", (s) => s.delete(k));

/* ---------- 予定の展開（毎年くり返しを含む） ---------- */
// 推しに登録した誕生日・記念日を、毎年くり返す予定として扱う（virtual：予定一覧には保存しない）
function oshiAnnivs() {
  const out = [];
  for (const o of data.oshis) {
    if (o.birthday) out.push({ id: `bd:${o.id}`, virtual: true, type: "birthday", title: `${o.name}の誕生日`, oshiId: o.id, date: `0000-${o.birthday}`, yearly: true, noYears: true });
    (o.annivs || []).forEach((a, i) => a.date && out.push({ id: `an:${o.id}:${i}`, virtual: true, type: "anniv", title: a.label || "記念日", oshiId: o.id, date: a.date, yearly: true }));
  }
  return out;
}
// チケットの申し込みの締切。状態に合わせて、もう動く必要のない締切は出さない
//   申込締切：申込前のときだけ ／ 当落発表：申込前・申込中 ／ 入金期限：当選したときだけ
function appDeadlines() {
  const out = [];
  for (const a of data.apps) {
    const ev = data.events.find((e) => e.id === a.eventId);
    if (!ev) continue;
    const evTitle = ev.title || typeOf(ev.type).label;
    const base = { virtual: "app", appId: a.id, appName: a.name || "", evTitle, oshiId: ev.oshiId, venue: "", yearly: false, title: `${evTitle} ${a.name || ""}`.trim() };
    const add = (type, date, time, active) => { if (date && active) out.push({ ...base, id: `ap:${a.id}:${type}`, type, date, time: time || "" }); };
    add("apply", a.applyBy, a.applyTime, a.status === "planned");
    add("result", a.resultAt, a.resultTime, a.status === "planned" || a.status === "applied");
    add("pay", a.payBy, a.payTime, a.status === "won");
  }
  return out;
}
function occurrences(from, to) {
  const out = [];
  const y0 = +from.slice(0, 4), y1 = +to.slice(0, 4);
  for (const e of [...data.events, ...oshiAnnivs(), ...appDeadlines()]) {
    if (!e.yearly) {
      if (e.date >= from && e.date <= to) out.push({ ...e, occDate: e.date, years: 0 });
      continue;
    }
    const [oy, om, od] = e.date.split("-").map(Number);
    for (let y = y0; y <= y1; y++) {
      const day = om === 2 && od === 29 && !isLeap(y) ? 28 : od;
      const s = `${y}-${pad(om)}-${pad(day)}`;
      if (s >= e.date && s >= from && s <= to) out.push({ ...e, occDate: s, years: y - oy });
    }
  }
  return out.sort((a, b) => (a.occDate + (a.time || "99")).localeCompare(b.occDate + (b.time || "99")));
}
function displayTitle(o) {
  const t = typeOf(o.type), osh = oshiOf(o.oshiId);
  let title = o.title || (o.type === "birthday" && osh ? `${osh.name}の誕生日` : t.label);
  if (o.type === "anniv" && o.years > 0 && !o.noYears) title += `（${o.years}周年）`;
  return title;
}
const joinMeta = (parts) => parts.filter(Boolean).join('<span class="sep">·</span>');
function countLabel(t, d) {
  const n = daysBetween(t, d);
  return n === 0 ? "今日" : n === 1 ? "明日" : `あと${n}日`;
}

/* ---------- 画面の状態 ---------- */
const ui = {
  tab: "home",
  calMonth: today().slice(0, 7),
  selDate: today(),
  moneyMonth: today().slice(0, 7),
  noteTab: "reports",
  // ホームの推しフィルター。"" はすべての推し、推しの ID ならその推しだけ（保存はせず、起動時は「すべて」）
  oshiFilter: "",
  placeFilter: "want",
  // 年表の推しフィルター（"" はすべて）
  timelineOshi: "",
};
const shiftMonth = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthItems = (ym) => data.expenses.filter((x) => x.date.startsWith(ym));
const sum = (xs) => xs.reduce((s, x) => s + (+x.amount || 0), 0);

/* ---------- レポート・行きたい場所の写真 ----------
   IndexedDB に「ph:<id>」で保存。一覧で必要になったものから順に読み込み、URL をキャッシュする */
const mediaUrls = new Map();
const mediaLoading = new Set();
let mediaRenderTimer;
function mediaUrl(pid) {
  if (!pid) return null;
  if (mediaUrls.has(pid)) return mediaUrls.get(pid);
  if (!mediaLoading.has(pid)) {
    mediaLoading.add(pid);
    idbGet("ph:" + pid).then((b) => {
      if (!b) return;
      mediaUrls.set(pid, URL.createObjectURL(b));
      clearTimeout(mediaRenderTimer);
      mediaRenderTimer = setTimeout(() => { if (!$("#sheet").open) render(); }, 30);
    }).catch(() => {}).finally(() => mediaLoading.delete(pid));
  }
  return null;
}
// すぐに URL が必要なとき（レポートを開くときなど）は読み込み終わるまで待つ
async function ensureMedia(pid) {
  if (mediaUrls.has(pid)) return mediaUrls.get(pid);
  try {
    const b = await idbGet("ph:" + pid);
    if (!b) return null;
    const url = URL.createObjectURL(b);
    mediaUrls.set(pid, url);
    return url;
  } catch { return null; }
}
async function saveMedia(blob) {
  const pid = uid();
  await idbSet("ph:" + pid, blob);
  mediaUrls.set(pid, URL.createObjectURL(blob));
  return pid;
}
function deleteMedia(pid) {
  if (mediaUrls.has(pid)) { URL.revokeObjectURL(mediaUrls.get(pid)); mediaUrls.delete(pid); }
  return idbDel("ph:" + pid).catch(() => {});
}

/* ---------- 予算 ---------- */
const yearTotal = (y) => sum(data.expenses.filter((x) => x.date.startsWith(String(y))));
const budgetOf = (y) => +data.settings.budgets?.[String(y)] || 0;
const reportFor = (eventId, date) => data.reports.find((r) => r.eventId === eventId && r.date === date);

/* ---------- iPhone などのカレンダーに追加する（.ics） ----------
   アプリを閉じていても、カレンダーの通知で締切や予定を知らせられるように */
const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
const icsDay = (d) => d.replaceAll("-", "");
function icsStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
// 1件分の VEVENT。時間があれば前日と1時間前、なければ前日と当日の朝9時に通知
function icsEvent(e, occ) {
  const osh = oshiOf(e.oshiId), task = isTask(e), ty = typeOf(e.type);
  const title = (task ? `【${ty.label}】` : "") + (task && !e.title ? (osh ? osh.name : "チケット") : displayTitle({ ...e, occDate: occ, years: +occ.slice(0, 4) - +e.date.slice(0, 4) }));
  const alarm = (trigger, text) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(text)}`, `TRIGGER:${trigger}`, "END:VALARM"];
  const L = ["BEGIN:VEVENT", `UID:${e.id}@oshi-calendar`, `DTSTAMP:${icsStamp()}`];
  if (e.time) {
    const [h, mi] = e.time.split(":").map(Number);
    const start = new Date(+occ.slice(0, 4), +occ.slice(5, 7) - 1, +occ.slice(8, 10), h, mi);
    const end = new Date(start.getTime() + (task ? 15 : 60) * 60000);
    L.push(`DTSTART:${icsDay(occ)}T${pad(h)}${pad(mi)}00`, `DTEND:${ymd(end).replaceAll("-", "")}T${pad(end.getHours())}${pad(end.getMinutes())}00`);
    if (e.yearly) {
      L.push(...alarm("-P1D", `明日：${title}`), ...alarm("-PT3H", `3時間後：${title}`));
    } else {
      // 前日の朝9時・当日の朝9時（予定がそれより後なら）・3時間前
      const at9 = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 9, 0);
      const abs = (d) => `;VALUE=DATE-TIME:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
      L.push(...alarm(abs(at9(addDays(occ, -1))), `明日 ${e.time}：${title}`).map((l) => l.replace("TRIGGER:;", "TRIGGER;")));
      if (start - at9(occ) > 3 * 3600000) L.push(...alarm(abs(at9(occ)), `今日 ${e.time}：${title}`).map((l) => l.replace("TRIGGER:;", "TRIGGER;")));
      L.push(...alarm("-PT3H", `3時間後（${e.time}）：${title}`));
    }
  } else {
    L.push(`DTSTART;VALUE=DATE:${icsDay(occ)}`, `DTEND;VALUE=DATE:${icsDay(addDays(occ, 1))}`);
    L.push(...alarm("-PT15H", `明日：${title}`), ...alarm("PT9H", `今日：${title}`));
  }
  if (e.yearly) L.push("RRULE:FREQ=YEARLY");
  L.push(`SUMMARY:${icsText(title)}`);
  if (e.venue) L.push(`LOCATION:${icsText(e.venue)}`);
  const desc = [osh && `推し：${osh.name}`, e.memo].filter(Boolean).join("\n");
  if (desc) L.push(`DESCRIPTION:${icsText(desc)}`);
  L.push("END:VEVENT");
  return L;
}
// 75文字を超える行は折り返す（カレンダーの決まり）
function icsCalendar(list) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//oshi-calendar//JA", "CALSCALE:GREGORIAN", "X-WR-CALNAME:推し活カレンダー",
    ...list.flatMap(([e, occ]) => icsEvent(e, occ)), "END:VCALENDAR"];
  return lines.map((l) => { const out = []; for (let i = 0; i < l.length; i += 60) out.push((i ? " " : "") + l.slice(i, i + 60)); return out.join("\r\n"); }).join("\r\n") + "\r\n";
}
function downloadIcs(name, list) {
  const blob = new Blob([icsCalendar(list)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- 推し活貯金 ---------- */
const savedOf = (g) => (g.deposits || []).reduce((s, d) => s + (+d.amount || 0), 0);
const monthsUntil = (from, to) => { const a = parseDate(from), b = parseDate(to); return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + (b.getDate() >= a.getDate() ? 1 : 0); };
