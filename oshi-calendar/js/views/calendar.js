"use strict";
/* カレンダー */

/* ---------- カレンダー ---------- */
function renderCal() {
  const t = today();
  const [y, m] = ui.calMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = first.getDay();
  const dim = new Date(y, m, 0).getDate();
  const start = addDays(ymd(first), -lead);
  const cells = Math.ceil((lead + dim) / 7) * 7;
  const byDate = {};
  for (const o of occurrences(start, addDays(start, cells - 1))) (byDate[o.occDate] ||= []).push(o);

  let g = WEEK_EN.map((w) => `<div class="dow">${w.slice(0, 1)}</div>`).join("");
  for (let i = 0; i < cells; i++) {
    const s = addDays(start, i), dow = i % 7, list = byDate[s] || [];
    const cls = ["cell", s.slice(0, 7) !== ui.calMonth && "out", s === t && "today", s === ui.selDate && "sel", (dow === 0 || dow === 6) && "wk"].filter(Boolean).join(" ");
    // ふつうの予定は推しカラーの点、リマインダーは黒い小さなひし形
    const dots = list.slice(0, 3).map((o) => isTask(o)
      ? `<i class="task${o.done ? " done" : ""}"></i>`
      : `<i style="${colorVars(oshiOf(o.oshiId)?.color)}"></i>`).join("");
    const label = `${+s.slice(5, 7)}月${+s.slice(8)}日(${WEEK[dow]})${list.length ? `、予定${list.length}件` : ""}`;
    g += `<button class="${cls}" data-act="sel-date" data-date="${s}" aria-label="${label}"${s === ui.selDate ? ' aria-pressed="true"' : ""}><span class="n">${+s.slice(8)}</span><span class="dots">${dots}</span></button>`;
  }

  const dayList = occurrences(ui.selDate, ui.selDate);
  const sd = ui.selDate;
  return topbar("カレンダー", `${y}`, addBtn("この日に予定を追加")) + `
    <section class="panel">
      <div class="cal-head">
        <div><span class="cal-month">${m}月</span><span class="cal-year num">${y}</span></div>
        <div class="cal-nav">
          ${ui.calMonth !== t.slice(0, 7) ? `<button class="link" data-act="cal-today">今日</button>` : ""}
          <button class="ghost" data-act="cal-prev" aria-label="前の月">${icon("left")}</button>
          <button class="ghost" data-act="cal-next" aria-label="次の月">${icon("right")}</button>
        </div>
      </div>
      <div class="grid">${g}</div>
      <div class="legend"><span><i class="dot"></i>予定</span><span><i class="task"></i>リマインダー（抽選・入金・発券）</span></div>
    </section>
    <section class="panel">
      <div class="eyebrow"><span class="num">${sd.replaceAll("-", ".")}  ${dowEn(sd)}</span><button class="link" data-act="add-event" data-date="${sd}">追加${icon("plus", 1.8)}</button></div>
      ${dayList.length ? `<div class="rows">${dayList.map((o) => eventRow(o, t)).join("")}</div>` : `<div class="empty">予定はありません</div>`}
    </section>${monthAnnivPanel(y, m, t)}`;
}


// 表示中の月の誕生日・記念日を、カウントダウンつきで
function monthAnnivPanel(y, m, t) {
  const from = `${y}-${pad(m)}-01`, to = ymd(new Date(y, m, 0));
  const list = occurrences(from, to).filter((o) => isAnniv(o) && o.occDate >= t);
  if (!list.length) return "";
  return `<section class="panel"><div class="eyebrow"><span>ANNIVERSARY</span><span class="count">${m}月</span></div>
    <div class="rows">${list.map((o) => annivRow(o, t)).join("")}</div></section>`;
}
