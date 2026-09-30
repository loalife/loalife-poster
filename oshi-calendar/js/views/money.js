"use strict";
/* 推し活費 */

/* ---------- 推し活費 ---------- */
function renderMoney() {
  const ym = ui.moneyMonth, [y, m] = ym.split("-").map(Number);
  const items = monthItems(ym).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const total = sum(items);
  const prev = sum(monthItems(shiftMonth(ym, -1)));
  const yTotal = yearTotal(y);
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0) + "%";
  const group = (keyFn) => {
    const mp = new Map();
    for (const x of items) mp.set(keyFn(x), (mp.get(keyFn(x)) || 0) + (+x.amount || 0));
    return [...mp.entries()].sort((a, b) => b[1] - a[1]);
  };

  let h = topbar("推し活費", `${y}`, addBtn("推し活費を記録")) + `
    <section class="panel">
      <div class="month-switch">
        <button class="ghost" data-act="money-prev" aria-label="前の月">${icon("left")}</button>
        <span class="m num">${y}.${pad(m)}</span>
        <button class="ghost" data-act="money-next" aria-label="次の月">${icon("right")}</button>
      </div>
      <div class="total">
        <div class="yen-big">${yenHtml(total)}</div>
        ${monthBudgetLine(total)}
        <div class="caption num">先月 ¥${yenNum(prev)}<span class="sep">·</span>${y}年累計 ¥${yenNum(yTotal)}</div>
      </div>
    </section>` + budgetPanel(y, yTotal) + savingsPanel();

  if (!items.length) {
    return h + `<section class="panel"><div class="empty"><p>${ym === today().slice(0, 7) ? "今月" : `${y}年${m}月`}の記録はまだありません</p>
      <button class="btn primary" data-act="add-expense">記録する</button></div></section>`;
  }

  const byOshi = group((x) => x.oshiId || "");
  h += `<section class="panel"><div class="eyebrow"><span>BY OSHI</span></div>
    <div class="stack">${byOshi.map(([id, v]) => `<i style="flex:${v};${colorVars(oshiOf(id)?.color)}"></i>`).join("")}</div>
    ${byOshi.map(([id, v]) => { const o = oshiOf(id); return `<div class="lg" style="${colorVars(o?.color)}"><span class="dot"></span><span class="nm">${o ? esc(o.name) : "指定なし"}</span><span class="pct">${pct(v)}</span><span class="v">¥${yenNum(v)}</span></div>`; }).join("")}
  </section>`;

  // カテゴリは色を増やさず、黒の濃淡で割合を見せる
  const byCat = group((x) => x.category);
  const shade = (i) => Math.max(0.14, 0.9 - i * 0.16);
  h += `<section class="panel"><div class="eyebrow"><span>BY CATEGORY</span></div>
    <div class="stack mono">${byCat.map(([, v], i) => `<i style="flex:${v};opacity:${shade(i)}"></i>`).join("")}</div>
    ${byCat.map(([id, v], i) => `<div class="lg"><span class="sq" style="opacity:${shade(i)}"></span><span class="nm">${esc(catOf(id).label)}</span><span class="pct">${pct(v)}</span><span class="v">¥${yenNum(v)}</span></div>`).join("")}
  </section>`;

  h += `<section class="panel"><div class="eyebrow"><span>HISTORY</span></div><div class="rows">${items.map((x) => {
    const c = catOf(x.category), o = oshiOf(x.oshiId);
    return `<button class="row" data-act="edit-expense" data-id="${x.id}">
      <span class="row-d">${md(x.date)}<small>${dowEn(x.date)}</small></span>
      <span><span class="row-t">${esc(x.memo || c.label)}</span><span class="row-m">${joinMeta([esc(c.label), tag(o)])}</span></span>
      <span class="row-e amt">¥${yenNum(x.amount)}</span></button>`;
  }).join("")}</div></section>`;
  return h;
}


// 年間予算：今年の予算・年間累計・残り予算
// 月の予算：その月の合計の下に、残りと使った割合のバー
function monthBudgetLine(total) {
  const mb = +data.settings.monthBudget || 0;
  if (!mb) return "";
  const left = mb - total, rate = total / mb;
  return `<div class="bar mb${left < 0 ? " over" : ""}" role="img" aria-label="月の予算の${Math.round(rate * 100)}%を使用"><i style="width:${Math.min(100, rate * 100)}%"></i></div>
    <div class="caption num${left < 0 ? " over-text" : ""}">月の予算 ¥${yenNum(mb)}<span class="sep">·</span>${left < 0 ? `¥${yenNum(-left)} オーバー` : `残り ¥${yenNum(left)}`}</div>`;
}
function budgetPanel(y, spent) {
  const budget = budgetOf(y), mb = +data.settings.monthBudget || 0;
  if (!budget) {
    return `<section class="panel"><div class="eyebrow"><span>BUDGET ${y}</span>${mb ? `<button class="link" data-act="edit-budget" data-year="${y}">変更</button>` : ""}</div>
      <div class="empty"><p>${mb ? `月の予算：¥${yenNum(mb)}<br>年間の予算も決めると、1年の残りがひと目でわかります。` : "月や年間の予算を決めると、使いすぎや残りの予算がひと目でわかります。"}</p>
      <button class="btn" data-act="edit-budget" data-year="${y}">予算を設定</button></div></section>`;
  }
  const left = budget - spent, rate = spent / budget;
  return `<section class="panel">
    <div class="eyebrow"><span>BUDGET ${y}</span><button class="link" data-act="edit-budget" data-year="${y}">変更</button></div>
    <div class="label">${left < 0 ? "予算オーバー" : "残り予算"}</div>
    <div class="yen-big${left < 0 ? " over-text" : ""}">${yenHtml(Math.abs(left))}</div>
    <div class="bar${left < 0 ? " over" : ""}" role="img" aria-label="予算の${Math.round(rate * 100)}%を使用"><i style="width:${Math.min(100, rate * 100)}%"></i></div>
    <div class="kv">
      <div><small>今年の予算</small><b class="num">¥${yenNum(budget)}</b></div>
      <div><small>年間累計</small><b class="num">¥${yenNum(spent)}</b><span class="pct num"> ${Math.round(rate * 100)}%</span></div>
    </div>
    ${mb ? `<p class="note" style="margin:14px 0 0">月の予算：¥${yenNum(mb)}</p>` : ""}
  </section>`;
}

// 推し活貯金：目標ごとに「いくら貯まったか」と「毎月いくら貯めれば間に合うか」
function savingsPanel() {
  const t = today();
  const list = [...data.savings].sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  if (!list.length) {
    return `<section class="panel"><div class="eyebrow"><span>SAVINGS</span></div>
      <div class="empty"><p>遠征やグッズ、記念日のために目標を決めて、推し活貯金をはじめましょう。</p>
      <button class="btn" data-act="add-saving">${icon("piggy")}貯金の目標をつくる</button></div></section>`;
  }
  const total = list.reduce((s, g) => s + savedOf(g), 0);
  return `<section class="panel">
    <div class="eyebrow"><span>SAVINGS</span><button class="link" data-act="add-saving">追加${icon("plus", 1.8)}</button></div>
    <div class="label">貯金の合計</div>
    <div class="yen-big">${yenHtml(total)}</div>
    <div class="rows" style="margin-top:12px">${list.map((g) => {
      const saved = savedOf(g), rate = g.target ? Math.min(1, saved / g.target) : 0, left = g.target - saved, osh = oshiOf(g.oshiId);
      const days = g.deadline ? daysBetween(t, g.deadline) : null;
      const pace = left > 0 && g.deadline && days >= 0 ? `毎月 ¥${yenNum(Math.ceil(left / Math.max(1, monthsUntil(t, g.deadline))))} で間に合います` : "";
      const status = left <= 0 ? `<span class="goal-done">達成</span>` : days === null ? "" : days < 0 ? `<span class="over-text">期限を過ぎました</span>` : `あと${days}日`;
      return `<div class="saving" style="${colorVars(osh?.color)}">
        <button class="sv-main" data-act="edit-saving" data-id="${g.id}">
          <span class="sv-top"><span class="t">${esc(g.name)}</span><span class="m">${status}</span></span>
          <span class="sv-amt num"><b>¥${yenNum(saved)}</b> / ¥${yenNum(g.target)}<span class="pct"> ${Math.round(rate * 100)}%</span></span>
          <span class="bar${osh ? " oshi" : ""}"><i style="width:${rate * 100}%"></i></span>
          <span class="m">${joinMeta([tag(osh), pace, g.deadline && `${fmtDot(g.deadline)} まで`])}</span>
        </button>
        <button class="btn sm" data-act="deposit" data-id="${g.id}">${icon("plus", 1.8)}貯金</button>
      </div>`;
    }).join("")}</div>
  </section>`;
}
