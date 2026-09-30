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
        <div class="caption num">先月 ¥${yenNum(prev)}<span class="sep">·</span>${y}年累計 ¥${yenNum(yTotal)}</div>
      </div>
    </section>` + budgetPanel(y, yTotal);

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
function budgetPanel(y, spent) {
  const budget = budgetOf(y);
  if (!budget) {
    return `<section class="panel"><div class="eyebrow"><span>BUDGET ${y}</span></div>
      <div class="empty"><p>年間の予算を決めると、残りの予算がひと目でわかります。</p>
      <button class="btn" data-act="edit-budget" data-year="${y}">${y}年の予算を設定</button></div></section>`;
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
  </section>`;
}
