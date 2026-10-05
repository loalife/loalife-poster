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
  // 推し活費・レポートのある日（予定とは別の、白抜きの丸で示す）
  const recDays = new Set([...data.expenses.map((x) => x.date), ...data.reports.map((r) => r.date)]);

  let g = WEEK_EN.map((w) => `<div class="dow">${w.slice(0, 1)}</div>`).join("");
  for (let i = 0; i < cells; i++) {
    const s = addDays(start, i), dow = i % 7, list = byDate[s] || [];
    const cls = ["cell", s.slice(0, 7) !== ui.calMonth && "out", s === t && "today", s === ui.selDate && "sel", (dow === 0 || dow === 6) && "wk"].filter(Boolean).join(" ");
    // ふつうの予定は推しカラーの点、リマインダーは黒い小さなひし形
    const dots = list.slice(0, 3).map((o) => isTask(o)
      ? `<i class="task ${toneOf(o)}${o.done ? " done" : ""}"></i>`
      : `<i style="${colorVars(oshiOf(o.oshiId)?.color)}"></i>`).join("") + (recDays.has(s) && list.length < 3 ? `<i class="rec"></i>` : "");
    const label = `${+s.slice(5, 7)}月${+s.slice(8)}日(${WEEK[dow]})${list.length ? `、予定${list.length}件` : ""}`;
    g += `<button class="${cls}" data-act="sel-date" data-date="${s}" aria-label="${label}"${s === ui.selDate ? ' aria-pressed="true"' : ""}><span class="n">${+s.slice(8)}</span><span class="dots">${dots}</span></button>`;
  }

  const dayList = occurrences(ui.selDate, ui.selDate);
  const sd = ui.selDate;
  // この月のまとめ（予定・推し活費・レポート）
  const ym = ui.calMonth;
  const monthEvents = occurrences(`${ym}-01`, ymd(new Date(y, m, 0))).filter((o) => !isTask(o)).length;
  const monthSpend = sum(monthItems(ym));
  const monthReports = data.reports.filter((r) => r.date.startsWith(ym)).length;
  // 選んだ日の推し活費とレポート
  const dayExp = data.expenses.filter((x) => x.date === sd);
  const dayRep = data.reports.filter((r) => r.date === sd);
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
      <div class="cal-sum num">${joinMeta([`予定 ${monthEvents}件`, `推し活費 ¥${yenNum(monthSpend)}`, monthReports && `レポート ${monthReports}件`])}</div>
      <div class="grid">${g}</div>
      <div class="legend"><span><i class="dot"></i>予定</span><span><i class="task apply"></i>申込締切</span><span><i class="task pay"></i>入金</span><span><i class="task"></i>当落・発券など</span><span><i class="rec"></i>推し活費・レポート</span></div>
    </section>
    <section class="panel">
      <div class="eyebrow"><span class="num">${sd.replaceAll("-", ".")}  ${dowEn(sd)}</span><button class="link" data-act="add-event" data-date="${sd}">追加${icon("plus", 1.8)}</button></div>
      ${dayList.length ? `<div class="rows">${dayList.map((o) => eventRow(o, t)).join("")}</div>` : `<div class="empty">予定はありません</div>`}
      ${dayExp.length ? `<div class="day-sub"><span>推し活費</span><span class="num">¥${yenNum(sum(dayExp))}</span></div>
        <div class="rows">${dayExp.map((x) => { const c = catOf(x.category); return `<button class="row" data-act="edit-expense" data-id="${x.id}">
          <span class="row-d">${icon("money")}</span><span><span class="row-t">${esc(x.memo || c.label)}</span><span class="row-m">${joinMeta([esc(c.label), tag(oshiOf(x.oshiId))])}</span></span>
          <span class="row-e amt">¥${yenNum(x.amount)}</span></button>`; }).join("")}</div>` : ""}
      ${dayRep.length ? `<div class="day-sub"><span>レポート</span></div>
        <div class="rows">${dayRep.map((r) => `<button class="note-row" data-act="view-report" data-id="${r.id}">${thumb(r.photos?.[0], "note", 44)}
          <span class="body"><span class="t">${esc(r.title || "レポート")}</span><span class="x">${joinMeta([tag(oshiOf(r.oshiId)), excerpt(r.text)])}</span></span></button>`).join("")}</div>` : ""}
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
