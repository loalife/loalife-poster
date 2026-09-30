"use strict";
/* 共通の部品：ヘッダー・行・シート・確認ダイアログ・トースト */

/* ---------- 部品 ---------- */
function topbar(title, sub, right) {
  return `<header class="top"><div class="top-text"><div class="sub num">${sub}</div><h1>${title}</h1></div>${right}</header>`;
}
const addBtn = (label) => `<button class="ghost" data-act="add" aria-label="${label}">${icon("plus", 1.8)}</button>`;
function avatarBtn() {
  const o = mainOshi();
  const url = o && oshiPhotos.get(o.id);
  const inner = url ? `<img src="${url}" alt="">` : o ? initial(o.name) : icon("user");
  return `<button class="ghost avatar${url ? " has-img" : ""}" data-tab="settings" aria-label="推し・設定" style="${o ? colorVars(o.color) : ""}">${inner}</button>`;
}
// 予定の1行。リマインダー（抽選・入金・発券）はバッジと完了チェックつき
function eventRow(o, t) {
  const osh = oshiOf(o.oshiId);
  const n = daysBetween(t, o.occDate);
  const task = isTask(o);
  let end = "";
  if (task) end = o.done ? `<span class="row-e">完了</span>` : n < 0 ? `<span class="row-e late">期限切れ</span>` : n === 0 ? `<span class="row-e hot">今日</span>` : `<span class="row-e">あと${n}日</span>`;
  else if (n === 0) end = `<span class="row-e hot">今日</span>`;
  else if (isAnniv(o) && n > 0) end = `<span class="row-e">あと${n}日</span>`;
  else if (n === 1) end = `<span class="row-e">明日</span>`;
  else if (n < 0 && reportFor(o.id, o.occDate)) end = `<span class="row-e ic" title="レポートあり">${icon("note")}</span>`;
  // 推しに登録した誕生日・記念日は、推しの編集画面で直す
  const act = o.virtual ? `data-act="edit-oshi" data-id="${o.oshiId}"` : `data-act="edit-event" data-id="${o.id}" data-date="${o.occDate}"`;
  const title = task && !o.title ? (osh ? osh.name : "チケット") : displayTitle(o);
  const badge = task ? `<span class="badge${o.done ? " done" : ""}">${typeOf(o.type).label}</span>` : "";
  const row = `<button class="row${task && o.done ? " done" : ""}" ${act}>
    <span class="row-d">${md(o.occDate)}<small>${dowEn(o.occDate)}</small></span>
    <span><span class="row-t">${esc(title)}</span>
      <span class="row-m">${badge}${joinMeta([o.time && `<span class="num">${esc(o.time)}</span>`, o.venue && esc(o.venue), tag(osh)]) || (task ? "" : esc(typeOf(o.type).label))}</span></span>
    ${end}
  </button>`;
  if (!task) return row;
  return `<div class="row-wrap">${row}<button class="check" data-act="toggle-done" data-id="${o.id}" aria-pressed="${!!o.done}" aria-label="${o.done ? "未完了に戻す" : "完了にする"}">${icon("check", 2.2)}</button></div>`;
}
// 写真の小さなサムネイル（写真がなければアイコン）
function thumb(pid, fallback = "image", size = 56) {
  const url = mediaUrl(pid);
  return `<span class="thumb" style="--s:${size}px">${url ? `<img src="${url}" alt="">` : icon(fallback)}</span>`;
}


/* ---------- シート（入力フォーム） ---------- */
function openSheet(title, body, { onSubmit, onDelete, onOpen, deleteLabel = "削除", deleteAsk = "削除しますか？", deleteSub = "" } = {}) {
  const d = $("#sheet");
  if (d.open) d.close();
  d.onclose = null;
  d.innerHTML = `<form novalidate>
    <div class="sheet-head"><button type="button" class="txt-btn" data-close>キャンセル</button><h2 tabindex="-1" autofocus>${esc(title)}</h2><button type="submit" class="txt-btn strong">保存</button></div>
    <div class="sheet-body">${body}${onDelete ? `<button type="button" class="danger-btn" data-del>${esc(deleteLabel)}</button>` : ""}</div>
  </form>`;
  const f = d.querySelector("form");
  let busy = false;
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const bad = [...f.elements].find((el) => el.willValidate && !el.checkValidity());
    if (bad) { bad.focus(); toast(bad.dataset.msg || "入力を確認してください"); return; }
    const fd = Object.fromEntries(new FormData(f));
    busy = true;
    try { if ((await onSubmit(fd, f)) === false) return; } finally { busy = false; }
    save(); d.close(); render();
  };
  d.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => d.close()));
  if (onDelete) d.querySelector("[data-del]").onclick = async () => {
    if (!(await ask(deleteAsk, { sub: deleteSub, ok: "削除", danger: true }))) return;
    onDelete(); save(); d.close(); render();
  };
  onOpen?.(f);
  d.showModal();
}
// 読むためのシート（右上は「編集」）。onOpen でシートの中のボタンに処理をつけられる。閉じたら画面を描き直す
function openView(title, body, onEdit, onOpen) {
  const d = $("#sheet");
  if (d.open) d.close();
  d.onclose = () => { d.onclose = null; render(); };
  d.innerHTML = `<form>
    <div class="sheet-head"><button type="button" class="txt-btn" data-close>閉じる</button><h2 tabindex="-1" autofocus>${esc(title)}</h2><button type="button" class="txt-btn strong" data-edit>編集</button></div>
    <div class="sheet-body">${body}</div>
  </form>`;
  d.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => d.close()));
  d.querySelector("[data-edit]").onclick = () => { d.close(); onEdit(); };
  onOpen?.(d.querySelector("form"));
  d.showModal();
}

/* ---------- 写真の選択（フォーム用） ----------
   保存を押すまで確定しない。commit() で新しい写真を保存し、外した写真を消して、最終的な写真 ID の配列を返す */
const photoField = (max) => `<div class="group"><div class="photo-grid" data-photos></div>
  <input type="file" accept="image/*"${max > 1 ? " multiple" : ""} class="visually-hidden" data-photo-files></div>`;
function bindPhotoField(f, pids, max) {
  const st = { items: (pids || []).map((pid) => ({ pid, url: mediaUrls.get(pid) })), removed: [] };
  const grid = f.querySelector("[data-photos]"), input = f.querySelector("[data-photo-files]");
  const draw = () => {
    grid.innerHTML = st.items.map((it, i) => `<div class="ph">${it.url ? `<img src="${it.url}" alt="">` : ""}
        <button type="button" class="rm" data-i="${i}" aria-label="この写真を削除">${icon("close", 2.2)}</button></div>`).join("")
      + (st.items.length < max ? `<button type="button" class="add" data-add>${icon("image")}<span>写真を追加</span></button>` : "");
    grid.querySelectorAll(".rm").forEach((b) => (b.onclick = () => {
      const [it] = st.items.splice(+b.dataset.i, 1);
      if (it.pid) st.removed.push(it.pid); else URL.revokeObjectURL(it.url);
      draw();
    }));
    grid.querySelector("[data-add]")?.addEventListener("click", () => input.click());
  };
  for (const it of st.items) if (!it.url) idbGet("ph:" + it.pid).then((b) => {
    if (!b) return;
    it.url = URL.createObjectURL(b);
    mediaUrls.set(it.pid, it.url);
    draw();
  }).catch(() => {});
  input.onchange = async () => {
    const files = [...input.files].slice(0, max - st.items.length);
    input.value = "";
    for (const file of files) {
      try {
        const blob = await processImage(file, { max: 1600 });
        st.items.push({ blob, url: URL.createObjectURL(blob) });
      } catch { toast("この画像は読み込めませんでした"); }
    }
    draw();
  };
  st.commit = async () => {
    const out = [];
    for (const it of st.items) {
      if (it.pid) { out.push(it.pid); continue; }
      try { out.push(await saveMedia(it.blob)); } catch { toast("写真を保存できませんでした"); }
      URL.revokeObjectURL(it.url);
    }
    st.removed.forEach(deleteMedia);
    return out;
  };
  draw();
  return st;
}

const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${label}</option>`;
const oshiOptions = (sel) => opt("", "指定なし", sel || "") + data.oshis.map((o) => opt(o.id, esc(o.name), sel)).join("");
// 新しく記録するときの推し：ホームで絞り込み中ならその推し、推しが1人ならその推し
const defaultOshiId = () => (ui.tab === "home" && oshiOf(ui.oshiFilter) ? ui.oshiFilter : data.oshis.length === 1 ? data.oshis[0].id : "");

/* ---------- 確認ダイアログ ----------
   ブラウザ標準の confirm() はサイト名（「〜の内容」）が出てしまうので、アプリ内で表示する */
function ask(title, { sub = "", ok = "OK", danger = false } = {}) {
  return new Promise((resolve) => {
    const d = $("#confirm");
    d.innerHTML = `<div class="cf-body"><p class="cf-title">${esc(title)}</p>${sub ? `<p class="cf-sub">${esc(sub)}</p>` : ""}</div>
      <div class="cf-btns"><button type="button" data-v="0">キャンセル</button><button type="button" data-v="1" class="${danger ? "danger" : "strong"}">${esc(ok)}</button></div>`;
    d.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => { d.close(); resolve(b.dataset.v === "1"); }));
    d.oncancel = () => resolve(false);
    d.showModal();
    d.querySelector("[data-v='0']").focus();
  });
}

/* ---------- トースト ---------- */
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

