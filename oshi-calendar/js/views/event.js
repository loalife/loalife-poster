"use strict";
/* 予定の詳細
   通知（カレンダーに追加）・会場マップとホテル・現場ツール（座席メモ・持ち物チェック・ペンライト）・レポート */

const PACKING_DEFAULT = ["チケット（電子チケット）", "身分証", "モバイルバッテリー", "ペンライト・うちわ", "双眼鏡", "現金・交通系IC", "タオル"];
const mapsSearch = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
const mapsRoute = (q) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
const webSearch = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
const extBtn = (href, label, ic) => `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">${ic ? icon(ic) : ""}${label}</a>`;
// 会場の地図や現場ツールは、実際に足を運ぶ予定のときだけ出す（配信・発売日・リマインダーは除く）
const isOnSite = (e) => !isTask(e) && !["stream", "release"].includes(e.type);

function openEventView(ev, occDate) {
  if (!ev) return;
  const t = today(), occ = occDate || ev.date;
  const osh = oshiOf(ev.oshiId), task = isTask(ev), ty = typeOf(ev.type), n = daysBetween(t, occ);
  const o = { ...ev, occDate: occ, years: +occ.slice(0, 4) - +ev.date.slice(0, 4) };
  const title = task && !ev.title ? (osh ? osh.name : "チケット") : displayTitle(o);
  const count = task ? (ev.done ? "完了" : n < 0 ? "期限切れ" : countLabel(t, occ)) : n >= 0 ? countLabel(t, occ) : `${-n}日前`;
  const onSite = isOnSite(ev) && ev.venue;

  let body = `<div class="ev-head" style="${colorVars(osh?.color)}">
    <div class="eyebrow"><span>${task ? `<span class="badge">${ty.label}</span>` : esc(ty.label)}</span><span class="count${n === 0 ? " today" : ""}">${count}</span></div>
    <div class="next-date"><span class="md num">${md(occ, ".")}</span><span class="dw num">${dowEn(occ)}${ev.time ? `  ${esc(ev.time)}` : ""}</span>${osh ? oshiAvatar(osh, 44) : ""}</div>
    <div class="next-title">${osh && !title.includes(osh.name) ? `<span class="who">${esc(osh.name)}</span>` : ""}${esc(title)}</div>
    ${ev.venue ? `<div class="next-meta">${icon("pin", 1.7)}<span class="visually-hidden">場所：</span>${esc(ev.venue)}</div>` : ""}
    ${ev.memo ? `<p class="ev-memo">${esc(ev.memo)}</p>` : ""}
  </div>`;

  // リマインダーは完了チェック
  if (task) {
    body += `<div class="group"><label class="field"><span class="grow">完了した</span><span class="toggle"><input type="checkbox" data-done${ev.done ? " checked" : ""} aria-label="完了した"><i></i></span></label></div>`;
  }

  // チケットの申し込み（FC先行・一般など、いくつでも）
  const apps = task ? [] : data.apps.filter((a) => a.eventId === ev.id);
  if (!task) {
    body += `<div class="group-label">チケットの申し込み</div>
      <div class="group">${apps.map(appRow).join("")}
        <button type="button" class="add-row" data-add-app>${icon("plus", 1.8)}申し込みを追加</button></div>
      ${apps.length ? "" : `<p class="note" style="margin:8px 4px 0">FC先行・一般などの受付ごとに、申込締切・当落発表・入金期限と状態をまとめて管理できます。</p>`}`;
  }

  // 通知：これからの予定と、申し込みの締切
  const appDl = appDeadlines().filter((d) => apps.some((a) => a.id === d.appId) && d.date >= t);
  if (occ >= t || appDl.length) {
    body += `<div class="group-label">通知</div>
      <div class="group"><button type="button" class="add-row" data-ics>${icon("bell")}iPhone などのカレンダーに追加${appDl.length ? `（締切${appDl.length}件も）` : ""}</button></div>
      <p class="note" style="margin:8px 4px 0">カレンダーに入れておくと、アプリを閉じていても前日と当日の朝に通知が届きます。時間を入れた予定や締切は、その3時間前にもお知らせします。</p>`;
  }

  // 会場とホテル
  if (onSite) {
    const h = ev.hotel;
    body += `<div class="group-label">会場・ホテル</div>
      <div class="btn-row">${extBtn(mapsSearch(ev.venue), "地図で見る", "pin")}${extBtn(mapsRoute(ev.venue), "経路を調べる", "route")}</div>
      ${h?.name ? `<div class="group hotel">
          <div class="hotel-in">${icon("bed")}<div class="body"><div class="t">${esc(h.name)}</div>
            <div class="m num">${joinMeta([h.checkIn && `${md(h.checkIn, "/")} チェックイン`, h.nights && `${h.nights}泊`, h.confirm && `予約番号 ${esc(h.confirm)}`])}</div></div></div>
          <div class="btn-row pad">${h.url ? extBtn(h.url, "予約ページ") : ""}${extBtn(mapsSearch(h.name), "地図")}<button type="button" class="btn" data-hotel>編集</button></div>
        </div>`
      : `<div class="btn-row" style="margin-top:8px">${extBtn(mapsSearch(`${ev.venue} 周辺 ホテル`), "周辺のホテルを地図で", "bed")}${extBtn(webSearch(`${ev.venue} ホテル 予約`), "ホテルを検索", "search")}</div>
        <div class="group"><button type="button" class="add-row" data-hotel>${icon("plus", 1.8)}予約したホテルを記録</button></div>`}`;
  }

  // 現場ツール
  if (isOnSite(ev)) {
    body += `<div class="group-label">現場ツール</div>
      <div class="group"><label class="field"><span>座席</span><input data-seat maxlength="60" value="${esc(ev.seat)}" placeholder="座席・整理番号など"></label></div>
      <div class="group" data-pack></div>
      <div class="btn-row" style="margin-top:12px"><button type="button" class="btn" data-penlight>${icon("light")}ペンライト</button><button type="button" class="link" data-pack-reset>チェックをすべて外す</button></div>
      <p class="note" style="margin:8px 4px 0">ペンライトは、画面いっぱいに推しカラーを表示します。</p>`;
  }

  // レポート：終わった予定（今日を含む）
  const report = !task && occ <= t ? reportFor(ev.id, occ) : undefined;
  if (!task && occ <= t) body += `<button type="button" class="btn block report-btn" data-report>${icon("note")}${report ? "レポートを見る" : "この日のレポートを書く"}</button>`;

  openView("予定", body, () => openEventForm(ev, null, occ), (f) => {
    f.querySelector("[data-done]")?.addEventListener("change", (e) => { ev.done = e.target.checked; save(); toast(ev.done ? "完了にしました" : "未完了に戻しました"); });
    f.querySelector("[data-ics]")?.addEventListener("click", () =>
      downloadIcs(`oshi-${occ}`, [...(occ >= t ? [[ev, occ]] : []), ...appDl.map((d) => [d, d.date])]));
    f.querySelector("[data-add-app]")?.addEventListener("click", () => openAppForm(ev));
    f.querySelectorAll("[data-app]").forEach((b) => b.addEventListener("click", () => openAppForm(ev, apps.find((a) => a.id === b.dataset.app))));
    f.querySelector("[data-hotel]")?.addEventListener("click", () => openHotelForm(ev, occ));
    f.querySelector("[data-report]")?.addEventListener("click", () => {
      if (report) openReportView(report);
      else openReportForm(null, { eventId: ev.id, date: occ, oshiId: ev.oshiId });
    });
    f.querySelector("[data-penlight]")?.addEventListener("click", () => openPenlight(osh));
    const seat = f.querySelector("[data-seat]");
    seat?.addEventListener("change", () => { ev.seat = seat.value.trim(); save(); toast("座席を保存しました"); });
    const pack = f.querySelector("[data-pack]");
    if (pack) bindPacking(ev, pack, f.querySelector("[data-pack-reset]"));
  });
}

/* ---------- 持ち物チェックリスト ----------
   予定ごとに保存。まだ触っていない予定は、よく使う持ち物から始める */
function bindPacking(ev, box, resetBtn) {
  const list = () => (ev.packing ||= PACKING_DEFAULT.map((t) => ({ t, done: false })));
  const draw = () => {
    const items = ev.packing || PACKING_DEFAULT.map((t) => ({ t, done: false }));
    const left = items.filter((x) => !x.done).length;
    box.innerHTML = `<div class="pack-head"><span>${icon("list")}持ち物</span><span class="num">${items.length - left}/${items.length}</span></div>`
      + items.map((x, i) => `<div class="ck${x.done ? " done" : ""}">
          <label><input type="checkbox" data-i="${i}"${x.done ? " checked" : ""}><span>${esc(x.t)}</span></label>
          <button type="button" class="rm-anniv" data-rm="${i}" aria-label="${esc(x.t)}を外す">${icon("close", 2)}</button></div>`).join("")
      + `<div class="ck add"><input data-new maxlength="30" placeholder="持ち物を追加" aria-label="持ち物を追加"><button type="button" class="link" data-add>追加</button></div>`;
  };
  box.addEventListener("change", (e) => {
    const i = e.target.dataset.i;
    if (i === undefined) return;
    list()[+i].done = e.target.checked;
    save(); draw();
  });
  box.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) { list().splice(+rm.dataset.rm, 1); save(); draw(); return; }
    if (e.target.closest("[data-add]")) add();
  });
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-new]")) { e.preventDefault(); add(); } });
  const add = () => {
    const input = box.querySelector("[data-new]"), v = input.value.trim();
    if (!v) return input.focus();
    list().push({ t: v, done: false });
    save(); draw();
    box.querySelector("[data-new]").focus();
  };
  resetBtn?.addEventListener("click", () => { list().forEach((x) => (x.done = false)); save(); draw(); });
  draw();
}

/* ---------- ペンライト ----------
   画面いっぱいに推しカラー。下の丸で色を切り替え、画面をタップすると閉じる */
let wakeLock = null;
function openPenlight(osh) {
  const colors = [...new Set([osh?.color, ...data.oshis.map((o) => o.color), "#ffffff"].filter(Boolean))];
  const el = $("#penlight");
  const paint = (c) => {
    el.style.background = c;
    el.querySelectorAll("[data-c]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.c === c));
  };
  el.innerHTML = `<div class="pl-hint">${esc(osh?.name || "")}${osh ? "　·　" : ""}画面をタップすると閉じます</div>
    <div class="pl-colors">${colors.map((c) => `<button type="button" data-c="${esc(c)}" style="--oc:${esc(c)}" aria-label="${esc(COLOR_NAMES[c] || c)}"></button>`).join("")}</div>`;
  el.onclick = (e) => {
    const b = e.target.closest("[data-c]");
    if (b) return paint(b.dataset.c);
    closePenlight();
  };
  paint(colors[0]);
  $("#sheet").close();
  el.hidden = false;
  // 画面が暗くならないように（対応している端末のみ）
  navigator.wakeLock?.request("screen").then((l) => (wakeLock = l)).catch(() => {});
}
function closePenlight() {
  $("#penlight").hidden = true;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// 申し込み1件：受付の名前・状態・次の締切
function appRow(a) {
  const t = today();
  const next = appDeadlines().filter((d) => d.appId === a.id).sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time))[0];
  const n = next ? daysBetween(t, next.date) : null;
  const when = next ? `<span class="${toneOf(next)}-t">${typeOf(next.type).label}</span> ${md(next.date)}${next.time ? " " + esc(next.time) : ""}${n < 0 ? "（過ぎています）" : n === 0 ? "（今日）" : `（あと${n}日）`}` : "";
  return `<button type="button" class="app-row" data-app="${a.id}">
    <span class="body"><span class="t">${esc(a.name || "申し込み")}</span>
      <span class="m">${joinMeta([when, a.count && `${a.count}枚`, a.price && `¥${yenNum(a.price)}`])}</span></span>
    <span class="st st-${a.status}">${appStatusOf(a.status).label}</span>
  </button>`;
}
