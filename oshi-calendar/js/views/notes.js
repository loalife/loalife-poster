"use strict";
/* ノート：写真つきの推し活レポート（日記）と、行きたい場所リスト */

/* ノート：レポート・行きたい場所・年表 */
function renderNotes() {
  const tab = ui.noteTab;
  let h = topbar("ノート", `レポート ${data.reports.length}件  ·  行きたい場所 ${data.places.length}件`,
    tab === "timeline" ? "" : addBtn(tab === "reports" ? "レポートを書く" : "行きたい場所を追加"));
  h += `<div class="seg seg-top" role="tablist" aria-label="ノートの種類">${[["reports", "レポート"], ["places", "行きたい場所"], ["timeline", "年表"]]
    .map(([v, l]) => `<button role="tab" data-act="note-tab" data-v="${v}" aria-selected="${tab === v}" aria-pressed="${tab === v}">${l}</button>`).join("")}</div>`;
  return h + (tab === "reports" ? reportsView() : tab === "places" ? placesView() : timelineView());
}

/* ---------- レポート ---------- */
const reportDate = (r) => `${fmtDot(r.date)}  ${dowEn(r.date)}`;
const excerpt = (s) => esc(String(s || "").split("\n").find((l) => l.trim()) || "");

function reportsView() {
  const t = today();
  let h = "";
  // 終わった予定で、まだレポートを書いていないもの（直近60日）
  const pending = occurrences(addDays(t, -60), t)
    .filter((o) => !isTask(o) && !o.virtual && !reportFor(o.id, o.occDate))
    .reverse().slice(0, 3);
  if (pending.length) {
    h += `<section class="panel"><div class="eyebrow ja"><span>レポートを書いていない予定</span></div><div class="rows">${pending.map((o) =>
      `<button class="row" data-act="write-report" data-id="${o.id}" data-date="${o.occDate}">
        <span class="row-d">${md(o.occDate)}<small>${dowEn(o.occDate)}</small></span>
        <span><span class="row-t">${esc(displayTitle(o))}</span><span class="row-m">${joinMeta([o.venue && esc(o.venue), tag(oshiOf(o.oshiId))]) || esc(typeOf(o.type).label)}</span></span>
        <span class="row-e write">書く${icon("right", 1.8)}</span>
      </button>`).join("")}</div></section>`;
  }

  const list = [...data.reports].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (!list.length) {
    return h + `<section class="panel"><div class="empty"><p>イベントの思い出を、写真と感想で残しておけます。</p>
      <button class="btn primary" data-act="add-report">レポートを書く</button></div></section>`;
  }
  h += `<section class="panel"><div class="eyebrow ja"><span>これまでのレポート</span></div><div class="rows">${list.map((r) =>
    `<button class="note-row" data-act="view-report" data-id="${r.id}">
      ${thumb(r.photos?.[0], "note")}
      <span class="body"><span class="d num">${reportDate(r)}</span><span class="t">${esc(r.title || "レポート")}</span>
        <span class="x">${joinMeta([tag(oshiOf(r.oshiId)), excerpt(r.text), r.photos?.length > 1 ? `写真${r.photos.length}枚` : ""])}</span></span>
    </button>`).join("")}</div></section>`;
  return h;
}

async function openReportView(r) {
  const urls = await Promise.all((r.photos || []).map(ensureMedia));
  const ev = data.events.find((e) => e.id === r.eventId);
  const body = `<div class="report-view">
    ${urls.some(Boolean) ? `<div class="gallery">${urls.filter(Boolean).map((u) => `<img src="${u}" alt="">`).join("")}</div>` : ""}
    <div class="meta num">${joinMeta([reportDate(r), tag(oshiOf(r.oshiId))])}</div>
    <h3>${esc(r.title || "レポート")}</h3>
    ${ev?.venue ? `<div class="next-meta">${icon("pin", 1.7)}<span class="visually-hidden">場所：</span>${esc(ev.venue)}</div>` : ""}
    <div class="text">${r.text ? esc(r.text) : `<span class="muted">感想はまだありません</span>`}</div>
  </div>`;
  openView("レポート", body, () => openReportForm(r));
}

/* ---------- 行きたい場所 ---------- */
function placesView() {
  const want = data.places.filter((p) => !p.visited).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const went = data.places.filter((p) => p.visited).sort((a, b) => (b.visitedAt || "").localeCompare(a.visitedAt || ""));
  if (!data.places.length) {
    return `<section class="panel"><div class="empty"><p><span class="lead">推し活で行きたい場所を、ここに。</span><br>コラボカフェやライブの遠征先、ドッグランなど、気になる場所を写真やメモと一緒にストックしておけます。</p>
      <button class="btn primary" data-act="add-place">行きたい場所を追加</button></div></section>`;
  }
  const list = ui.placeFilter === "went" ? went : want;
  return `<section class="panel">
    <div class="seg" style="margin:0 0 14px">${[["want", `行きたい ${want.length}`], ["went", `行った ${went.length}`]]
      .map(([v, l]) => `<button data-act="place-filter" data-v="${v}" aria-pressed="${ui.placeFilter === v}">${l}</button>`).join("")}</div>
    ${list.length ? `<div class="rows">${list.map(placeRow).join("")}</div>`
      : `<div class="empty">${ui.placeFilter === "went"
        ? "<p>行った場所にチェックを入れると、推し活の思い出としてここに残ります。</p>"
        : `<p>行きたい場所は、ぜんぶ行けました。<br>次のお出かけ先も探してみませんか？</p><button class="btn" data-act="add-place">行きたい場所を追加</button>`}</div>`}
  </section>`;
}
function placeRow(p) {
  const c = placeCatOf(p.category);
  return `<div class="row-wrap">
    <button class="note-row" data-act="edit-place" data-id="${p.id}">
      ${thumb(p.photos?.[0], "pin")}
      <span class="body"><span class="t">${esc(p.name)}</span>
        <span class="x">${joinMeta([esc(c.label), p.area && esc(p.area), tag(oshiOf(p.oshiId))])}</span>
        ${p.memo ? `<span class="x">${excerpt(p.memo)}</span>` : ""}</span>
    </button>
    <button class="check" data-act="toggle-visited" data-id="${p.id}" aria-pressed="${!!p.visited}" aria-label="${p.visited ? "行ったを取り消す" : "行ったにする"}">${icon("check", 2.2)}</button>
  </div>`;
}

/* ---------- 年表 ----------
   これまでに行ったイベント・書いたレポート・行った場所を、年ごと・新しい順にまとめる */
function timelineView() {
  const t = today();
  if (ui.timelineOshi && !oshiOf(ui.timelineOshi)) ui.timelineOshi = "";
  const f = ui.timelineOshi;
  const mine = (x) => !f || x.oshiId === f;
  const items = [];
  // 予定：終わったもの（毎年くり返す誕生日などは年表では除く）
  for (const e of data.events) {
    if (isTask(e) || e.yearly || e.date > t || !mine(e)) continue;
    items.push({ date: e.date, kind: "event", e, r: reportFor(e.id, e.date) });
  }
  // 予定に紐づいていないレポート
  for (const r of data.reports) {
    if (r.eventId && data.events.some((e) => e.id === r.eventId && !e.yearly)) continue;
    if (mine(r)) items.push({ date: r.date, kind: "report", r });
  }
  // 行った場所
  for (const p of data.places) if (p.visited && p.visitedAt && mine(p)) items.push({ date: p.visitedAt.slice(0, 10), kind: "place", p });
  items.sort((a, b) => b.date.localeCompare(a.date));

  let h = data.oshis.length > 1 ? oshiFilterBar(f, "tl-filter") : "";
  if (!items.length) {
    return h + `<section class="panel"><div class="empty"><p>終わったイベントやレポート、行った場所が、ここに年表としてまとまっていきます。</p></div></section>`;
  }
  const years = [...new Set(items.map((x) => x.date.slice(0, 4)))];
  for (const y of years) {
    const list = items.filter((x) => x.date.startsWith(y));
    const nEvents = list.filter((x) => x.kind === "event").length;
    const nReports = list.filter((x) => x.r || x.kind === "report").length;
    const spent = sum(data.expenses.filter((x) => x.date.startsWith(y) && mine(x)));
    h += `<section class="panel">
      <div class="tl-year"><span class="y num">${y}</span><span class="s num">${joinMeta([nEvents && `イベント ${nEvents}回`, nReports && `レポート ${nReports}件`, spent && `推し活費 ¥${yenNum(spent)}`])}</span></div>
      <ol class="tl">${list.map(timelineItem).join("")}</ol>
    </section>`;
  }
  return h;
}
function timelineItem(x) {
  let osh, title, meta, act, pid;
  if (x.kind === "event") {
    const e = x.e;
    osh = oshiOf(e.oshiId);
    title = displayTitle({ ...e, occDate: e.date, years: 0 });
    meta = joinMeta([e.venue ? esc(e.venue) : esc(typeOf(e.type).label), x.r && "レポートあり"]);
    act = `data-act="edit-event" data-id="${e.id}" data-date="${e.date}"`;
    pid = x.r?.photos?.[0];
  } else if (x.kind === "report") {
    const r = x.r;
    osh = oshiOf(r.oshiId);
    title = r.title || "レポート";
    meta = joinMeta(["レポート", excerpt(r.text)]);
    act = `data-act="view-report" data-id="${r.id}"`;
    pid = r.photos?.[0];
  } else {
    const p = x.p;
    osh = oshiOf(p.oshiId);
    title = p.name;
    meta = joinMeta(["行った場所", esc(placeCatOf(p.category).label), p.area && esc(p.area)]);
    act = `data-act="edit-place" data-id="${p.id}"`;
    pid = p.photos?.[0];
  }
  return `<li style="${colorVars(osh?.color)}"><button class="tl-item" ${act}>
    <span class="tl-d num">${md(x.date, ".")}</span>
    <span class="body"><span class="t">${esc(title)}</span><span class="m">${joinMeta([meta, tag(osh)])}</span></span>
    ${pid ? thumb(pid, "image", 44) : ""}
  </button></li>`;
}
