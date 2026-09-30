"use strict";
/* ホーム */

/* ---------- ホーム ---------- */
function renderHome() {
  const t = today(), td = parseDate(t);
  const occ = occurrences(t, addDays(t, 730));
  const next = occ[0];
  let h = topbar("推し活カレンダー", `${t.replaceAll("-", ".")}  ${WEEK_EN[td.getDay()]}`,
    `${addBtn("予定を追加")}${avatarBtn()}`);

  if (next) {
    const osh = oshiOf(next.oshiId);
    const title = displayTitle(next);
    const who = osh && !title.includes(osh.name) ? `<span class="who">${esc(osh.name)}</span>` : "";
    const n = daysBetween(t, next.occDate);
    h += `<section class="panel next" data-act="edit-event" data-id="${next.id}" style="${colorVars(osh?.color)}" role="button" tabindex="0">
      <div class="eyebrow"><span>NEXT EVENT</span><span class="count${n === 0 ? " today" : ""}">${countLabel(t, next.occDate)}</span></div>
      <div class="next-date"><span class="md num">${md(next.occDate, ".")}</span><span class="dw num">${dowEn(next.occDate)}${next.time ? `  ${esc(next.time)}` : ""}</span>${osh && oshiPhotos.has(osh.id) ? oshiAvatar(osh, 44) : ""}</div>
      <div class="next-title">${who}${esc(title)}</div>
      <div class="next-meta">${next.venue ? `${icon("pin", 1.7)}<span class="visually-hidden">場所：</span>${esc(next.venue)}` : esc(typeOf(next.type).label)}</div>
    </section>`;
  } else {
    const fresh = !data.oshis.length;
    h += `<section class="panel">
      <div class="eyebrow"><span>NEXT EVENT</span></div>
      <div class="empty">
        <p>${fresh ? "推しを登録して、最初の予定を入れましょう。<br>好きな写真を背景にすると、自分だけのアプリに。" : "これからの予定はまだありません。"}</p>
        <div class="btn-row">${fresh
          ? `<button class="btn primary" data-act="add-oshi">推しを登録</button><button class="btn" data-act="pick-photo">背景写真を選ぶ</button>`
          : `<button class="btn primary" data-act="add-event">予定を追加</button>`}</div>
      </div>
    </section>`;
  }

  const yearAhead = addDays(t, 365);
  const rest = occ.slice(1).filter((o) => o.occDate <= yearAhead).slice(0, 6);
  if (rest.length) {
    h += `<section class="panel">
      <div class="eyebrow"><span>UPCOMING</span><button class="link" data-tab="cal">カレンダー${icon("right", 1.8)}</button></div>
      <div class="rows">${rest.map((o) => eventRow(o, t)).join("")}</div>
    </section>`;
  }

  const items = monthItems(t.slice(0, 7));
  h += `<section class="panel spend" data-tab="money" role="button" tabindex="0">
    <div><div class="label">今月の推し活費</div>
      <div class="yen-big">${yenHtml(sum(items))}</div>
      <div class="caps">${items.length} ${items.length === 1 ? "ITEM" : "ITEMS"}</div></div>
    <button class="ghost" data-act="add-expense" aria-label="推し活費を記録">${icon("plus", 1.8)}</button>
  </section>`;
  return h;
}

