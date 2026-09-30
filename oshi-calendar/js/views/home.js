"use strict";
/* ホーム
   NEXT EVENT → REMINDER（抽選・入金・発券）→ ANNIVERSARY（誕生日・記念日のカウントダウン）→ UPCOMING → 今月の推し活費 */

// 推しフィルターに合う予定か（「すべて」のときは全部）
const byFilter = (o) => !ui.oshiFilter || o.oshiId === ui.oshiFilter;

function renderHome() {
  const t = today(), td = parseDate(t);
  // 消された推しを選んだままにならないように
  if (ui.oshiFilter && !oshiOf(ui.oshiFilter)) ui.oshiFilter = "";
  const occ = occurrences(t, addDays(t, 730)).filter(byFilter);
  const events = occ.filter((o) => !isTask(o) && !isAnniv(o));
  // ふつうの予定がなければ、誕生日・記念日を NEXT EVENT に出す
  const next = events[0] || occ.find((o) => !isTask(o));
  // 推しが2人以上なら、ヘッダーの下に推しのアイコンを並べて絞り込めるようにする
  const filterable = data.oshis.length > 1;
  let h = topbar("推し活カレンダー", `${fmtDot(t)}  ${WEEK_EN[td.getDay()]}`,
    `${addBtn("予定を追加")}${filterable ? "" : avatarBtn()}`);
  if (filterable) h += oshiFilterBar();

  h += next ? nextEventPanel(next, t) : emptyNextPanel();
  h += reminderPanel(t);
  h += annivPanel(t, next);

  const yearAhead = addDays(t, 365);
  const rest = events.filter((o) => o !== next && o.occDate <= yearAhead).slice(0, 6);
  if (rest.length) {
    h += `<section class="panel">
      <div class="eyebrow"><span>UPCOMING</span><button class="link" data-tab="cal">カレンダー${icon("right", 1.8)}</button></div>
      <div class="rows">${rest.map((o) => eventRow(o, t)).join("")}</div>
    </section>`;
  }

  h += spendPanel(t);
  return h;
}

function nextEventPanel(next, t) {
  const osh = oshiOf(next.oshiId);
  const title = displayTitle(next);
  const who = osh && !title.includes(osh.name) ? `<span class="who">${esc(osh.name)}</span>` : "";
  const n = daysBetween(t, next.occDate);
  const act = next.virtual ? `data-act="edit-oshi" data-id="${next.oshiId}"` : `data-act="edit-event" data-id="${next.id}" data-date="${next.occDate}"`;
  return `<section class="panel next" ${act} style="${colorVars(osh?.color)}" role="button" tabindex="0">
    <div class="eyebrow"><span>NEXT EVENT</span><span class="count${n === 0 ? " today" : ""}">${countLabel(t, next.occDate)}</span></div>
    <div class="next-date"><span class="md num">${md(next.occDate, ".")}</span><span class="dw num">${dowEn(next.occDate)}${next.time ? `  ${esc(next.time)}` : ""}</span>${osh && oshiPhotos.has(osh.id) ? oshiAvatar(osh, 44) : ""}</div>
    <div class="next-title">${who}${esc(title)}</div>
    <div class="next-meta">${next.venue ? `${icon("pin", 1.7)}<span class="visually-hidden">場所：</span>${esc(next.venue)}` : esc(typeOf(next.type).label)}</div>
  </section>`;
}

function emptyNextPanel() {
  const fresh = !data.oshis.length;
  const osh = oshiOf(ui.oshiFilter);
  if (osh) {
    return `<section class="panel">
      <div class="eyebrow"><span>NEXT EVENT</span></div>
      <div class="empty"><p>${esc(osh.name)}のこれからの予定はまだありません。</p>
        <div class="btn-row"><button class="btn primary" data-act="add-event">予定を追加</button><button class="btn" data-act="oshi-filter" data-id="">すべての推しを見る</button></div></div>
    </section>`;
  }
  return `<section class="panel">
    <div class="eyebrow"><span>NEXT EVENT</span></div>
    <div class="empty">
      <p>${fresh ? "推しを登録して、最初の予定を入れましょう。<br>好きな写真を背景にすると、自分だけのアプリに。" : "これからの予定はまだありません。"}</p>
      <div class="btn-row">${fresh
        ? `<button class="btn primary" data-act="add-oshi">推しを登録</button><button class="btn" data-act="pick-photo">背景写真を選ぶ</button>`
        : `<button class="btn primary" data-act="add-event">予定を追加</button>`}</div>
    </div>
  </section>`;
}

// 30日以内のリマインダーと、過ぎたのに完了していないもの（2週間前まで）
function reminderPanel(t) {
  const list = occurrences(addDays(t, -14), addDays(t, 30))
    .filter(byFilter)
    .filter((o) => isTask(o) && !o.done && (o.occDate >= t || daysBetween(o.occDate, t) <= 14))
    .slice(0, 5);
  if (!list.length) return "";
  return `<section class="panel">
    <div class="eyebrow"><span>REMINDER</span><span class="count">${list.length}件</span></div>
    <div class="rows">${list.map((o) => eventRow(o, t)).join("")}</div>
  </section>`;
}

// 推しの誕生日・記念日までのカウントダウン（NEXT EVENT に出したものは除く）
function annivPanel(t, next) {
  const list = occurrences(t, addDays(t, 365)).filter(byFilter).filter((o) => isAnniv(o) && !(next && o.id === next.id && o.occDate === next.occDate)).slice(0, 3);
  if (!list.length) return "";
  return `<section class="panel">
    <div class="eyebrow"><span>ANNIVERSARY</span></div>
    <div class="rows">${list.map((o) => annivRow(o, t)).join("")}</div>
  </section>`;
}
function annivRow(o, t) {
  const osh = oshiOf(o.oshiId), n = daysBetween(t, o.occDate);
  const act = o.virtual ? `data-act="edit-oshi" data-id="${o.oshiId}"` : `data-act="edit-event" data-id="${o.id}" data-date="${o.occDate}"`;
  const av = osh ? oshiAvatar(osh, 40) : `<span class="av" style="--s:40px;--oc:var(--fill);--oi:var(--text2)">${icon("gift")}</span>`;
  return `<button class="ann" ${act} style="${colorVars(osh?.color)}">
    ${av}
    <span class="body"><span class="t">${esc(displayTitle(o))}</span><span class="m num">${md(o.occDate, ".")} ${dowEn(o.occDate)}</span></span>
    <span class="cd${n === 0 ? " today" : ""}">${n === 0 ? "<b>今日</b>" : `<small>あと</small><b class="num">${n}</b><span>日</span>`}</span>
  </button>`;
}

function spendPanel(t) {
  const y = t.slice(0, 4);
  const osh = oshiOf(ui.oshiFilter);
  const items = monthItems(t.slice(0, 7)).filter(byFilter);
  // 予算は推しごとではなく全体のものなので、「すべて」のときだけ出す
  const budget = osh ? 0 : budgetOf(y);
  const left = budget - yearTotal(y);
  const budgetLine = budget
    ? `<div class="caption-sm num${left < 0 ? " over-text" : ""}">${left < 0 ? `予算オーバー ¥${yenNum(-left)}` : `残り予算 ¥${yenNum(left)}`}</div>`
    : "";
  return `<section class="panel spend" data-tab="money" role="button" tabindex="0">
    <div><div class="label">今月の推し活費${osh ? `<span class="sep">·</span>${esc(osh.name)}` : ""}</div>
      <div class="yen-big">${yenHtml(sum(items))}</div>
      <div class="caps">${items.length} ${items.length === 1 ? "ITEM" : "ITEMS"}</div>${budgetLine}</div>
    <button class="ghost" data-act="add-expense" aria-label="推し活費を記録">${icon("plus", 1.8)}</button>
  </section>`;
}

// 推しフィルター：「すべて」＋推しのアイコン。選んでいる推しをもう一度押すと「すべて」に戻る
function oshiFilterBar() {
  const cur = ui.oshiFilter;
  const item = (id, av, name, ring) => `<button class="of${cur === id ? " on" : ""}${cur && cur !== id ? " dim" : ""}" data-act="oshi-filter" data-id="${id}"
      aria-pressed="${cur === id}" style="--ring:${ring}">${av}<span class="of-name">${name}</span></button>`;
  return `<div class="oshi-filter" role="group" aria-label="推しで絞り込む">
    ${item("", `<span class="av all" style="--s:40px">${icon("all", 1.6)}</span>`, "すべて", "var(--text)")}
    ${data.oshis.map((o) => item(o.id, oshiAvatar(o, 40), esc(o.name), esc(o.color))).join("")}
  </div>`;
}
