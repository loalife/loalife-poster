"use strict";
/* 推し活費 */

/* ---------- 推し活費 ---------- */
function renderMoney() {
  const ym = ui.moneyMonth, [y, m] = ym.split("-").map(Number);
  const items = monthItems(ym).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const total = sum(items);
  const prev = sum(monthItems(shiftMonth(ym, -1)));
  const yearTotal = sum(data.expenses.filter((x) => x.date.startsWith(String(y))));
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
        <div class="caption num">先月 ¥${yenNum(prev)}<span class="sep">·</span>${y}年累計 ¥${yenNum(yearTotal)}</div>
      </div>
    </section>`;

  if (!items.length) {
    return h + `<section class="panel"><div class="empty"><p>${ym === today().slice(0, 7) ? "今月" : `${y}年${m}月`}の記録はまだありません</p>
      <button class="btn primary" data-act="add-expense">記録する</button></div></section>`;
  }

  const byOshi = group((x) => x.oshiId || "");
  h += `<section class="panel"><div class="eyebrow"><span>BY OSHI</span></div>
    <div class="stack">${byOshi.map(([id, v]) => `<i style="flex:${v};${colorVars(oshiOf(id)?.color)}"></i>`).join("")}</div>
    ${byOshi.map(([id, v]) => { const o = oshiOf(id); return `<div class="lg" style="${colorVars(o?.color)}"><span class="dot"></span><span class="nm">${o ? esc(o.name) : "指定なし"}</span><span class="pct">${pct(v)}</span><span class="v">¥${yenNum(v)}</span></div>`; }).join("")}
  </section>`;

  const byCat = group((x) => x.category);
  const maxCat = byCat[0][1];
  h += `<section class="panel"><div class="eyebrow"><span>BY CATEGORY</span></div>
    ${byCat.map(([id, v]) => `<div class="lg"><div class="lg-col"><div class="top-line"><span class="nm">${esc(catOf(id).label)}</span><span class="pct">${pct(v)}</span><span class="v">¥${yenNum(v)}</span></div>
      <div class="meter"><i style="width:${(v / maxCat) * 100}%"></i></div></div></div>`).join("")}
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

