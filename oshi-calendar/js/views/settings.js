"use strict";
/* 推し・設定 */

/* ---------- 推し・設定 ---------- */
function renderSettings() {
  const t = today(), s = data.settings, main = mainOshi();
  const upcoming = occurrences(t, addDays(t, 365));
  let h = topbar("推し・設定", data.oshis.length ? `推し ${data.oshis.length}人` : "推しを登録しましょう", addBtn("推しを登録"));

  h += `<section class="panel"><div class="eyebrow ja"><span>推し</span>${data.oshis.length ? `<button class="link" data-act="add-oshi">追加${icon("plus", 1.8)}</button>` : ""}</div>`;
  h += data.oshis.length
    ? `<div class="rows">${data.oshis.map((o) => {
        const n = upcoming.filter((e) => e.oshiId === o.id).length;
        return `<button class="item" data-act="edit-oshi" data-id="${o.id}" style="${colorVars(o.color)}">
          ${oshiAvatar(o, 40)}
          <span class="body"><span class="t">${esc(o.name)}</span><span class="m">${n ? `これからの予定 ${n}件` : "予定なし"}</span></span>
          ${o === main && data.oshis.length > 1 ? `<span class="main-badge">メイン</span>` : ""}
          <span class="chev">${icon("right")}</span></button>`;
      }).join("")}</div>
      ${data.oshis.length > 1 ? `<p class="note">メインの推しのカラーが、タブなどのアクセントになります。推しの編集画面で変更できます。</p>` : ""}`
    : `<div class="empty"><p>推しを登録すると、予定と推し活費を推しごとに整理できます。</p><button class="btn primary" data-act="add-oshi">推しを登録</button></div>`;
  h += `</section>`;

  h += `<section class="panel"><div class="eyebrow ja"><span>背景</span></div>
    <div class="bg-preview">
      <div class="pv-img" id="pvImg"></div><div class="pv-scrim" id="pvScrim"></div>
      <div class="pv-card"><div class="e">NEXT EVENT</div><div class="d num">10.11 <span style="font-size:11px;font-weight:600;letter-spacing:.1em">SUN</span></div><div class="t">ドームツアー 東京公演</div></div>
    </div>
    <div class="btn-row" style="margin-top:16px">
      <button class="btn${hasPhoto ? "" : " primary"}" data-act="pick-photo">${hasPhoto ? "写真を変更" : "写真を選ぶ"}</button>
      ${hasPhoto ? `<button class="btn" data-act="clear-photo" style="color:var(--danger)">写真を外す</button>` : ""}
    </div>
    ${hasPhoto ? `
    <label class="setting"><span class="head"><span>オーバーレイ</span><output id="scrimOut" class="num">${Math.round(s.scrim * 100)}%</output></span>
      <input type="range" id="scrimRange" min="30" max="90" step="5" value="${Math.round(s.scrim * 100)}"></label>
    <label class="setting"><span class="head"><span>ぼかし</span><output id="blurOut" class="num">${s.blur}px</output></span>
      <input type="range" id="blurRange" min="0" max="20" step="1" value="${s.blur}"></label>
    <div class="setting"><span class="head"><span>写真の位置</span></span>
      <div class="seg">${[["top", "上"], ["center", "中央"], ["bottom", "下"]].map(([v, l]) => `<button data-act="bg-pos" data-pos="${v}" aria-pressed="${s.bgPos === v}">${l}</button>`).join("")}</div></div>
    <p class="note">写真が派手で文字が読みにくいときは、オーバーレイを強めてください。</p>` : `<p class="note">推しの写真を背景にできます。写真はこの端末の中だけに保存されます。</p>`}
  </section>`;

  h += `<section class="panel"><div class="eyebrow ja"><span>データ</span></div>
    <p class="note" style="margin:0 0 16px">予定・推し・推し活費はこのブラウザの中に保存されます。機種変更の前にバックアップを書き出してください（背景写真・推しの写真は含まれません）。</p>
    <div class="btn-row"><button class="btn" data-act="export">書き出す</button><button class="btn" data-act="import">読み込む</button></div>
  </section>`;
  return h;
}

