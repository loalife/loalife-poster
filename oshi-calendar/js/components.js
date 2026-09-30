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
function eventRow(o, t) {
  const osh = oshiOf(o.oshiId);
  const n = daysBetween(t, o.occDate);
  const end = n === 0 ? `<span class="row-e hot">今日</span>` : n === 1 ? `<span class="row-e">明日</span>` : "";
  return `<button class="row" data-act="edit-event" data-id="${o.id}">
    <span class="row-d">${md(o.occDate)}<small>${dowEn(o.occDate)}</small></span>
    <span><span class="row-t">${esc(displayTitle(o))}</span>
      <span class="row-m">${joinMeta([o.time && `<span class="num">${esc(o.time)}</span>`, o.venue && esc(o.venue), tag(osh)]) || esc(typeOf(o.type).label)}</span></span>
    ${end}
  </button>`;
}


/* ---------- シート（入力フォーム） ---------- */
function openSheet(title, body, { onSubmit, onDelete, onOpen, deleteLabel = "削除", deleteAsk = "削除しますか？", deleteSub = "" } = {}) {
  const d = $("#sheet");
  d.innerHTML = `<form novalidate>
    <div class="sheet-head"><button type="button" class="txt-btn" data-close>キャンセル</button><h2>${esc(title)}</h2><button type="submit" class="txt-btn strong">保存</button></div>
    <div class="sheet-body">${body}${onDelete ? `<button type="button" class="danger-btn" data-del>${esc(deleteLabel)}</button>` : ""}</div>
  </form>`;
  const f = d.querySelector("form");
  f.onsubmit = (e) => {
    e.preventDefault();
    const bad = [...f.elements].find((el) => el.willValidate && !el.checkValidity());
    if (bad) { bad.focus(); toast(bad.dataset.msg || "入力を確認してください"); return; }
    const fd = Object.fromEntries(new FormData(f));
    if (onSubmit(fd, f) === false) return;
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
const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${label}</option>`;
const oshiOptions = (sel) => opt("", "指定なし", sel || "") + data.oshis.map((o) => opt(o.id, esc(o.name), sel)).join("");
const defaultOshiId = () => (data.oshis.length === 1 ? data.oshis[0].id : "");

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

