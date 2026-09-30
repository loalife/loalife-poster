"use strict";
/* 入力フォーム（予定・推し活費・推し） */

function openEventForm(ev, presetDate) {
  const e = ev || { type: "live", date: presetDate || today(), oshiId: defaultOshiId() };
  const body = `
    <div class="group"><label class="field title"><input name="title" maxlength="60" value="${esc(e.title)}" placeholder="タイトル" aria-label="タイトル"></label></div>
    <div class="group">
      <label class="field"><span>種類</span><select name="type">${EVENT_TYPES.map((t) => opt(t.id, t.label, e.type)).join("")}</select></label>
      <label class="field"><span>推し</span><select name="oshiId">${oshiOptions(e.oshiId)}</select></label>
    </div>
    <div class="group">
      <label class="field"><span>日付</span><input type="date" name="date" required data-msg="日付を入れてください" value="${esc(e.date)}"></label>
      <label class="field"><span>時間</span><input type="time" name="time" value="${esc(e.time)}"></label>
      <label class="field"><span class="grow">毎年くり返す</span><span class="toggle"><input type="checkbox" name="yearly"${e.yearly ? " checked" : ""} aria-label="毎年くり返す"><i></i></span></label>
    </div>
    <div class="group">
      <label class="field"><span>場所</span><input name="venue" maxlength="60" value="${esc(e.venue)}" placeholder="会場・配信先など"></label>
      <label class="field stack-f"><span>メモ</span><textarea name="memo" rows="3" maxlength="500" placeholder="座席、持ち物、同行者など">${esc(e.memo)}</textarea></label>
    </div>`;
  openSheet(ev ? "予定を編集" : "新しい予定", body, {
    deleteLabel: "予定を削除",
    deleteAsk: "この予定を削除しますか？",
    onOpen: (f) => { f.type.onchange = () => { if (typeOf(f.type.value).yearly) f.yearly.checked = true; }; },
    onSubmit: (fd) => {
      const rec = {
        id: e.id || uid(), title: fd.title.trim(), type: fd.type, oshiId: fd.oshiId, date: fd.date,
        time: fd.time, venue: fd.venue.trim(), yearly: !!fd.yearly, memo: fd.memo.trim(),
      };
      if (ev) data.events[data.events.findIndex((x) => x.id === ev.id)] = rec;
      else data.events.push(rec);
      ui.selDate = rec.date;
      toast(ev ? "予定を更新しました" : "予定を追加しました");
    },
    onDelete: ev ? () => { data.events = data.events.filter((x) => x.id !== ev.id); toast("予定を削除しました"); } : null,
  });
}

function openExpenseForm(x) {
  const e = x || { date: ui.moneyMonth === today().slice(0, 7) ? today() : ui.moneyMonth + "-01", category: "goods", oshiId: defaultOshiId() };
  const body = `
    <div class="group"><label class="field title"><span>金額</span><input type="number" name="amount" inputmode="numeric" min="1" max="99999999" step="1" required data-msg="金額を入れてください" value="${esc(e.amount)}" placeholder="¥0"></label></div>
    <div class="group">
      <label class="field"><span>内容</span><input name="memo" maxlength="60" value="${esc(e.memo)}" placeholder="アクスタ、缶バッジ など"></label>
      <label class="field"><span>カテゴリ</span><select name="category">${EXPENSE_CATS.map((c) => opt(c.id, c.label, e.category)).join("")}</select></label>
      <label class="field"><span>推し</span><select name="oshiId">${oshiOptions(e.oshiId)}</select></label>
      <label class="field"><span>日付</span><input type="date" name="date" required data-msg="日付を入れてください" value="${esc(e.date)}"></label>
    </div>`;
  openSheet(x ? "推し活費を編集" : "推し活費を記録", body, {
    deleteLabel: "記録を削除",
    deleteAsk: "この記録を削除しますか？",
    onSubmit: (fd) => {
      const rec = { id: e.id || uid(), amount: Math.round(+fd.amount), category: fd.category, oshiId: fd.oshiId, date: fd.date, memo: fd.memo.trim() };
      if (x) data.expenses[data.expenses.findIndex((y) => y.id === x.id)] = rec;
      else data.expenses.push(rec);
      ui.moneyMonth = rec.date.slice(0, 7);
      toast(x ? "更新しました" : "記録しました");
    },
    onDelete: x ? () => { data.expenses = data.expenses.filter((y) => y.id !== x.id); toast("削除しました"); } : null,
  });
}

function openOshiForm(o) {
  const e = o || { color: MEMBER_COLORS[data.oshis.length % MEMBER_COLORS.length] };
  const isMain = o ? mainOshi() === o : !data.oshis.length;
  // 写真の変更は「保存」を押すまで確定しない（undefined=変更なし / null=外す / Blob=新しい写真）
  let pending, pendingUrl;
  const body = `
    <div class="group oshi-photo">
      <span class="pv"></span>
      <div class="actions"><button type="button" class="txt-btn" data-photo-pick></button><button type="button" class="txt-btn rm" data-photo-rm>写真を外す</button></div>
      <input type="file" accept="image/*" class="visually-hidden" data-photo-input>
    </div>
    <div class="group"><label class="field title"><input name="name" required maxlength="30" data-msg="名前を入れてください" value="${esc(e.name)}" placeholder="推しの名前" aria-label="名前"></label></div>
    <div class="group-label">テーマカラー</div>
    <div class="group">
      <div class="swatches">${MEMBER_COLORS.map((c) => `<button type="button" data-color="${c}" style="--oc:${c}" aria-label="${c}" aria-pressed="${c === e.color}"></button>`).join("")}</div>
      <label class="field"><span class="grow">カスタムカラー</span><input type="color" name="color" value="${esc(e.color)}"></label>
    </div>
    ${data.oshis.length > (o ? 1 : 0) ? `<div class="group">
      <label class="field"><span class="grow">メインの推しにする</span><span class="toggle"><input type="checkbox" name="main"${isMain ? " checked" : ""} aria-label="メインの推しにする"><i></i></span></label>
    </div>` : ""}`;
  openSheet(o ? "推しを編集" : "推しを登録", body, {
    deleteLabel: "推しを削除",
    deleteAsk: o ? `「${o.name}」を削除しますか？` : "",
    deleteSub: "登録済みの予定と推し活費は残ります。",
    onOpen: (f) => {
      const sync = () => f.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.color === f.color.value));
      f.querySelectorAll("[data-color]").forEach((b) => (b.onclick = () => { f.color.value = b.dataset.color; sync(); }));
      const nameInput = f.elements.namedItem("name"), fileInput = f.querySelector("[data-photo-input]");
      const refresh = () => {
        const url = pending === null ? null : pending ? pendingUrl : o && oshiPhotos.get(o.id);
        f.querySelector(".pv").innerHTML = oshiAvatar({ id: "", name: nameInput.value, color: f.color.value }, 88, url);
        f.querySelector("[data-photo-pick]").textContent = url ? "写真を変更" : "写真を選ぶ";
        f.querySelector("[data-photo-rm]").hidden = !url;
      };
      f.color.oninput = () => { sync(); refresh(); };
      f.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", refresh));
      nameInput.addEventListener("input", refresh);
      f.querySelector("[data-photo-pick]").onclick = () => fileInput.click();
      f.querySelector("[data-photo-rm]").onclick = () => { pending = null; refresh(); };
      fileInput.onchange = async () => {
        const file = fileInput.files[0];
        fileInput.value = "";
        if (!file) return;
        try {
          const blob = await processImage(file, { max: 480, square: true });
          if (pendingUrl) URL.revokeObjectURL(pendingUrl);
          pending = blob;
          pendingUrl = URL.createObjectURL(blob);
          refresh();
        } catch { toast("この画像は読み込めませんでした"); }
      };
      refresh();
    },
    onSubmit: (fd) => {
      const rec = { ...(o || {}), id: e.id || uid(), name: fd.name.trim(), color: fd.color };
      if (!rec.name) { toast("名前を入れてください"); return false; }
      if (o) data.oshis[data.oshis.findIndex((y) => y.id === o.id)] = rec;
      else data.oshis.push(rec);
      if (fd.main) data.settings.mainOshiId = rec.id;
      else if (data.settings.mainOshiId === rec.id) data.settings.mainOshiId = "";
      if (pending !== undefined) {
        setOshiPhoto(rec.id, pending);
        (pending ? idbSet("oshi:" + rec.id, pending) : idbDel("oshi:" + rec.id)).catch(() => toast("写真を保存できませんでした"));
      }
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
      toast(o ? "更新しました" : `${rec.name} を登録しました`);
    },
    onDelete: o ? () => {
      data.oshis = data.oshis.filter((y) => y.id !== o.id);
      if (data.settings.mainOshiId === o.id) data.settings.mainOshiId = "";
      setOshiPhoto(o.id, null);
      idbDel("oshi:" + o.id).catch(() => {});
      // 予定や推し活費は残し、推しの指定だけ外す
      for (const x of [...data.events, ...data.expenses]) if (x.oshiId === o.id) x.oshiId = "";
      toast("削除しました（予定と推し活費は残っています）");
    } : null,
  });
}

