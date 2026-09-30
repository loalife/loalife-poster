"use strict";
/* 描画・背景写真・バックアップ・操作・起動 */

/* ---------- 描画 ---------- */
const TABS = [["home", "ホーム", "home"], ["cal", "カレンダー", "cal"], ["money", "推し活費", "money"], ["notes", "ノート", "note"], ["settings", "推し・設定", "user"]];
function render() {
  applyAccent();
  $("#app").innerHTML = { home: renderHome, cal: renderCal, money: renderMoney, notes: renderNotes, settings: renderSettings }[ui.tab]();
  $("#tabs").innerHTML = TABS.map(([id, label, ic]) =>
    `<button class="tab" data-tab="${id}"${ui.tab === id ? ' aria-current="page"' : ""}>${icon(ic, ui.tab === id ? 1.9 : 1.5)}${label}</button>`).join("");
  if (ui.tab === "settings") bindSettings();
}

/* ---------- 背景写真 ---------- */
let hasPhoto = false;
let photoUrl = null;
function applyBgVars() {
  const s = data.settings;
  const root = document.documentElement.style;
  const pos = s.bgPos === "top" ? "center top" : s.bgPos === "bottom" ? "center bottom" : "center";
  root.setProperty("--scrim", s.scrim);
  root.setProperty("--blur", s.blur + "px");
  root.setProperty("--bg-pos", pos);
  const img = $("#pvImg"), sc = $("#pvScrim");
  if (img) {
    img.style.backgroundImage = photoUrl ? `url("${photoUrl}")` : "none";
    img.style.backgroundPosition = pos;
    img.style.filter = `blur(${s.blur / 3}px) saturate(0.85)`;
    sc.style.background = photoUrl ? `rgba(var(--scrim-rgb), ${s.scrim})` : "transparent";
  }
}
function setPhoto(blob) {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = blob ? URL.createObjectURL(blob) : null;
  hasPhoto = !!blob;
  document.body.classList.toggle("has-photo", hasPhoto);
  document.documentElement.style.setProperty("--photo", photoUrl ? `url("${photoUrl}")` : "none");
  applyBgVars();
}
// 画像を読み込み、縮小（square なら正方形に切り抜き）して JPEG の Blob にする
async function processImage(file, { max, square = false }) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight;
    // 正方形のときは中央で切り抜く。縦長は顔が入りやすいよう少し上寄りに
    const side = Math.min(w, h);
    const [sx, sy, sw, sh] = square ? [(w - side) / 2, (h - side) * (h > w ? 0.3 : 0.5), side, side] : [0, 0, w, h];
    const k = Math.min(1, max / Math.max(sw, sh));
    const c = document.createElement("canvas");
    c.width = Math.round(sw * k);
    c.height = Math.round(sh * k);
    c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
    if (!blob) throw new Error("encode");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function importPhoto(file) {
  let blob;
  try { blob = await processImage(file, { max: 2000 }); } catch { return toast("この画像は読み込めませんでした"); }
  try { await idbSet("bg", blob); } catch { toast("写真を保存できませんでした。今回だけ表示します"); }
  setPhoto(blob);
  render();
  toast("背景写真を設定しました");
}
function bindSettings() {
  applyBgVars();
  const sr = $("#scrimRange"), br = $("#blurRange");
  if (sr) {
    sr.oninput = () => { data.settings.scrim = sr.value / 100; $("#scrimOut").textContent = sr.value + "%"; applyBgVars(); };
    sr.onchange = save;
  }
  if (br) {
    br.oninput = () => { data.settings.blur = +br.value; $("#blurOut").textContent = br.value + "px"; applyBgVars(); };
    br.onchange = save;
  }
}


/* ---------- バックアップ ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify({ app: "oshi-calendar", version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `oshi-calendar-backup-${today().replaceAll("-", "")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importData(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.oshis) || !Array.isArray(d.events) || !Array.isArray(d.expenses)) throw new Error("format");
    const extra = [d.reports?.length && `レポート${d.reports.length}件`, d.places?.length && `行きたい場所${d.places.length}件`].filter(Boolean).join("・");
    if (!(await ask("バックアップを読み込みますか？", { sub: `推し${d.oshis.length}人・予定${d.events.length}件・推し活費${d.expenses.length}件${extra ? "・" + extra : ""}。今のデータは置き換わります。`, ok: "読み込む", danger: true }))) return;
    const { oshis, events, expenses, reports, places, settings } = d;
    data = migrate({ oshis, events, expenses, reports, places, settings });
    save();
    applyBgVars();
    await loadOshiPhotos();
    render();
    toast("読み込みました");
  } catch {
    toast("バックアップファイルを読み込めませんでした");
  }
}


/* ---------- 操作 ---------- */
function addForTab() {
  if (ui.tab === "money") return openExpenseForm();
  if (ui.tab === "settings") return openOshiForm();
  if (ui.tab === "notes") return ui.noteTab === "places" ? openPlaceForm() : openReportForm();
  return openEventForm(null, ui.tab === "cal" ? ui.selDate : today());
}
document.addEventListener("click", (ev) => {
  // いちばん内側の操作を優先（パネル全体のタップと、中の＋ボタンを区別する）
  const el = ev.target.closest("[data-act],[data-tab]");
  if (!el || el.closest("dialog")) return;
  if (el.dataset.tab && !el.dataset.act) { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case "add": return addForTab();
    case "add-event": return openEventForm(null, el.dataset.date);
    case "edit-event": return openEventForm(data.events.find((x) => x.id === id), null, el.dataset.date);
    case "toggle-done": {
      const e = data.events.find((x) => x.id === id);
      if (!e) return;
      e.done = !e.done;
      save(); render();
      return toast(e.done ? "完了にしました" : "未完了に戻しました");
    }
    case "add-expense": return openExpenseForm();
    case "edit-expense": return openExpenseForm(data.expenses.find((x) => x.id === id));
    case "add-oshi": return openOshiForm();
    case "edit-oshi": return openOshiForm(oshiOf(id));
    case "sel-date": ui.selDate = el.dataset.date; ui.calMonth = ui.selDate.slice(0, 7); return render();
    case "cal-prev": ui.calMonth = shiftMonth(ui.calMonth, -1); return render();
    case "cal-next": ui.calMonth = shiftMonth(ui.calMonth, 1); return render();
    case "cal-today": ui.calMonth = today().slice(0, 7); ui.selDate = today(); return render();
    case "money-prev": ui.moneyMonth = shiftMonth(ui.moneyMonth, -1); return render();
    case "money-next": ui.moneyMonth = shiftMonth(ui.moneyMonth, 1); return render();
    case "edit-budget": return openBudgetForm(el.dataset.year);
    case "note-tab": ui.noteTab = el.dataset.v; return render();
    case "oshi-filter": {
      // 選択中の推しをもう一度押したら「すべて」に戻す
      ui.oshiFilter = ui.oshiFilter === id ? "" : id;
      return render();
    }
    case "add-report": return openReportForm();
    case "view-report": { const r = data.reports.find((x) => x.id === id); return r && openReportView(r); }
    case "write-report": {
      const e = data.events.find((x) => x.id === id);
      return e && openReportForm(null, { eventId: e.id, date: el.dataset.date, oshiId: e.oshiId });
    }
    case "add-place": return openPlaceForm();
    case "edit-place": return openPlaceForm(data.places.find((x) => x.id === id));
    case "place-filter": ui.placeFilter = el.dataset.v; return render();
    case "toggle-visited": {
      const p = data.places.find((x) => x.id === id);
      if (!p) return;
      p.visited = !p.visited;
      p.visitedAt = p.visited ? new Date().toISOString() : "";
      save(); render();
      return toast(p.visited ? "「行った」に移しました" : "「行きたい」に戻しました");
    }
    case "pick-photo": return $("#photoInput").click();
    case "clear-photo":
      return ask("背景写真を削除しますか？", { ok: "削除", danger: true }).then((yes) => {
        if (!yes) return;
        idbDel("bg").catch(() => {});
        setPhoto(null); render(); toast("背景写真を削除しました");
      });
    case "bg-pos": data.settings.bgPos = el.dataset.pos; save(); applyBgVars(); return render();
    case "export": return exportData();
    case "import": return $("#importInput").click();
  }
});
document.addEventListener("keydown", (ev) => {
  if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("section[role=button]")) { ev.preventDefault(); ev.target.click(); }
});
$("#photoInput").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importPhoto(f); };
$("#importInput").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importData(f); };
// 日付が変わったら（翌朝アプリを開いたときなど）表示を更新
let lastDay = today();
document.addEventListener("visibilitychange", () => { if (!document.hidden && today() !== lastDay) { lastDay = today(); render(); } });
// ライト／ダークが切り替わったら推しカラーの読みやすさを計算し直す
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", render);

/* ---------- 起動 ---------- */
applyBgVars();
render();
idbGet("bg").then((b) => { if (b) { setPhoto(b); if (ui.tab === "settings") render(); } }).catch(() => {});
loadOshiPhotos().then(() => { if (oshiPhotos.size) render(); });
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
