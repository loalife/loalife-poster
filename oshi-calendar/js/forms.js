"use strict";
/* 入力フォーム（予定・推し活費・推し） */

// occDate：毎年くり返す予定の「その年の日付」（レポートの紐づけに使う）
function openEventForm(ev, presetDate, occDate) {
  const e = ev || { type: "live", date: presetDate || today(), oshiId: defaultOshiId() };
  const occ = occDate || e.date;
  const typeOpts = (task) => EVENT_TYPES.filter((t) => !!t.task === task).map((t) => opt(t.id, t.label, e.type)).join("");
  // 終わった予定（今日を含む）には、レポートへの入口を出す
  const report = ev && !isTask(e) && occ <= today() ? reportFor(e.id, occ) : undefined;
  const reportBtn = ev && !isTask(e) && occ <= today()
    ? `<button type="button" class="btn block report-btn" data-report>${icon("note")}${report ? "レポートを見る" : "この日のレポートを書く"}</button>` : "";
  const body = `
    <div class="group"><label class="field title"><input name="title" maxlength="60" value="${esc(e.title)}" placeholder="タイトル" aria-label="タイトル"></label></div>
    <div class="group">
      <label class="field"><span>種類</span><select name="type">
        <optgroup label="イベント">${typeOpts(false)}</optgroup>
        <optgroup label="リマインダー（チケット）">${typeOpts(true)}</optgroup>
      </select></label>
      <label class="field"><span>推し</span><select name="oshiId">${oshiOptions(e.oshiId)}</select></label>
    </div>
    <div class="group">
      <label class="field"><span data-date-label>日付</span><input type="date" name="date" required data-msg="日付を入れてください" value="${esc(e.date)}"></label>
      <label class="field"><span data-time-label>時間</span><input type="time" name="time" value="${esc(e.time)}"></label>
      <label class="field" data-yearly-row><span class="grow">毎年くり返す</span><span class="toggle"><input type="checkbox" name="yearly"${e.yearly ? " checked" : ""} aria-label="毎年くり返す"><i></i></span></label>
      <label class="field" data-done-row><span class="grow">完了した</span><span class="toggle"><input type="checkbox" name="done"${e.done ? " checked" : ""} aria-label="完了した"><i></i></span></label>
    </div>
    <div class="group">
      <label class="field"><span>場所</span><input name="venue" maxlength="60" value="${esc(e.venue)}" placeholder="会場・配信先など"></label>
      <label class="field stack-f"><span>メモ</span><textarea name="memo" rows="3" maxlength="500" placeholder="座席、持ち物、同行者など">${esc(e.memo)}</textarea></label>
    </div>
    ${reportBtn}`;
  openSheet(ev ? "予定を編集" : "新しい予定", body, {
    deleteLabel: "予定を削除",
    deleteAsk: "この予定を削除しますか？",
    onOpen: (f) => {
      // リマインダーは「締切」と「完了」、イベントは「毎年くり返す」を出す
      const sync = () => {
        const task = !!typeOf(f.type.value).task;
        f.querySelector("[data-done-row]").hidden = !task;
        f.querySelector("[data-yearly-row]").hidden = task;
        f.querySelector("[data-date-label]").textContent = task ? "締切日" : "日付";
        f.querySelector("[data-time-label]").textContent = task ? "締切時間" : "時間";
        f.title.placeholder = task ? "タイトル（例：ドームツアー 1次抽選）" : "タイトル";
      };
      f.type.onchange = () => { if (typeOf(f.type.value).yearly) f.yearly.checked = true; sync(); };
      sync();
      f.querySelector("[data-report]")?.addEventListener("click", () => {
        if (report) openReportView(report);
        else openReportForm(null, { eventId: e.id, date: occ, oshiId: e.oshiId });
      });
    },
    onSubmit: (fd) => {
      const task = !!typeOf(fd.type).task;
      const rec = {
        id: e.id || uid(), title: fd.title.trim(), type: fd.type, oshiId: fd.oshiId, date: fd.date,
        time: fd.time, venue: fd.venue.trim(), yearly: !task && !!fd.yearly, memo: fd.memo.trim(),
      };
      if (task) rec.done = !!fd.done;
      if (ev) data.events[data.events.findIndex((x) => x.id === ev.id)] = rec;
      else data.events.push(rec);
      ui.selDate = rec.date;
      toast(ev ? "予定を更新しました" : "予定を追加しました");
    },
    onDelete: ev ? () => {
      data.events = data.events.filter((x) => x.id !== ev.id);
      // レポートは残し、予定との紐づけだけ外す
      for (const r of data.reports) if (r.eventId === ev.id) r.eventId = "";
      toast("予定を削除しました");
    } : null,
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
      <div class="actions"><button type="button" class="txt-btn" data-photo-pick></button><button type="button" class="txt-btn rm" data-photo-rm>写真を削除</button></div>
      <input type="file" accept="image/*" class="visually-hidden" data-photo-input>
    </div>
    <div class="group"><label class="field stack-f title"><span>推しの名前</span><input name="name" required maxlength="30" data-msg="推しの名前を入れてください" value="${esc(e.name)}" placeholder="例：ミナト"></label></div>
    <div class="group-label">テーマカラー</div>
    <div class="group">
      <div class="swatches">${MEMBER_COLORS.map((c) => `<button type="button" data-color="${c}" style="--oc:${c}" aria-label="${COLOR_NAMES[c] || c}" aria-pressed="${c === e.color}"></button>`).join("")}</div>
      <label class="field"><span class="grow">カスタムカラー</span><input type="color" name="color" value="${esc(e.color)}"></label>
    </div>
    <div class="group-label">誕生日・記念日</div>
    <div class="group" data-annivs>
      <div class="field"><span>誕生日</span>
        <select name="bdMonth" class="md-sel" aria-label="誕生日の月">${opt("", "—", "")}${Array.from({ length: 12 }, (_, i) => opt(pad(i + 1), `${i + 1}月`, (e.birthday || "").slice(0, 2))).join("")}</select>
        <select name="bdDay" class="md-sel" aria-label="誕生日の日">${opt("", "—", "")}${Array.from({ length: 31 }, (_, i) => opt(pad(i + 1), `${i + 1}日`, (e.birthday || "").slice(3))).join("")}</select>
      </div>
      ${(e.annivs || []).map(annivRowHtml).join("")}
      <button type="button" class="add-row" data-add-anniv>${icon("plus", 1.8)}記念日を追加</button>
    </div>
    <p class="note" style="margin:8px 4px 0">デビュー日や結成日など。ホームとカレンダーに「あと◯日」と表示されます。</p>
    ${data.oshis.length > (o ? 1 : 0) ? `<div class="group">
      <label class="field"><span class="grow">メインの推しにする</span><span class="toggle"><input type="checkbox" name="main"${isMain ? " checked" : ""} aria-label="メインの推しにする" aria-describedby="mainHelp"><i></i></span></label>
    </div>
    <p class="note" id="mainHelp" style="margin:8px 4px 0">タブなどのアクセントカラーが、この推しのカラーになります。</p>` : ""}`;
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
      f.querySelector("[data-add-anniv]").onclick = (ev) => {
        ev.currentTarget.insertAdjacentHTML("beforebegin", annivRowHtml({}));
        ev.currentTarget.previousElementSibling.querySelector("input").focus();
      };
      f.querySelector("[data-annivs]").addEventListener("click", (ev) => { const b = ev.target.closest("[data-rm-anniv]"); if (b) b.closest(".ann-row").remove(); });
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
    onSubmit: (fd, f) => {
      const rec = { ...(o || {}), id: e.id || uid(), name: fd.name.trim(), color: fd.color };
      if (!rec.name) { toast("名前を入れてください"); return false; }
      if (!!fd.bdMonth !== !!fd.bdDay) { toast("誕生日は月と日の両方を選んでください"); return false; }
      // 2/30 のような日付は、その月の最終日にそろえる（2月は29日まで）
      rec.birthday = fd.bdMonth ? `${fd.bdMonth}-${pad(Math.min(+fd.bdDay, new Date(2000, +fd.bdMonth, 0).getDate()))}` : "";
      rec.annivs = [...f.querySelectorAll(".ann-row")]
        .map((row) => ({ label: row.querySelector("[name=annLabel]").value.trim(), date: row.querySelector("[name=annDate]").value }))
        .filter((a) => a.date);
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
      for (const x of [...data.events, ...data.expenses, ...data.reports, ...data.places]) if (x.oshiId === o.id) x.oshiId = "";
      toast("削除しました（予定と推し活費は残っています）");
    } : null,
  });
}


const annivRowHtml = (a) => `<div class="ann-row">
  <input name="annLabel" maxlength="20" value="${esc(a.label)}" placeholder="デビュー記念日" aria-label="記念日の名前">
  <input type="date" name="annDate" value="${esc(a.date)}" aria-label="記念日の日付">
  <button type="button" class="rm-anniv" data-rm-anniv aria-label="この記念日を削除">${icon("close", 2)}</button>
</div>`;

/* ---------- 年間予算 ---------- */
function openBudgetForm(y) {
  const cur = budgetOf(y);
  const body = `
    <div class="group"><label class="field title"><span>${y}年</span><input type="number" name="budget" inputmode="numeric" min="1" max="999999999" step="1" required data-msg="予算を入れてください" value="${cur || ""}" placeholder="¥0"></label></div>
    <p class="note" style="margin:10px 4px 0">推し活費画面に「今年の予算」「年間累計」「残り予算」が表示されます。</p>`;
  openSheet(`${y}年の予算`, body, {
    deleteLabel: "予算を削除",
    deleteAsk: `${y}年の予算を削除しますか？`,
    onSubmit: (fd) => { data.settings.budgets[String(y)] = Math.round(+fd.budget); toast("予算を設定しました"); },
    onDelete: cur ? () => { delete data.settings.budgets[String(y)]; toast("予算を削除しました"); } : null,
  });
}

/* ---------- 推し活レポート ---------- */
function openReportForm(r, preset = {}) {
  const t = today();
  const e = r || { date: preset.date || t, eventId: preset.eventId || "", oshiId: preset.oshiId ?? defaultOshiId(), title: "", text: "", photos: [] };
  // 紐づけられる予定：この1年の終わった予定（値は「予定ID|日付」）
  const past = occurrences(addDays(t, -365), t).filter((o) => !isTask(o) && !o.virtual).reverse();
  const cur = e.eventId ? `${e.eventId}|${e.date}` : "";
  const evOpts = opt("", "紐づけない", cur) + past.map((o) => opt(`${o.id}|${o.occDate}`, `${md(o.occDate)}  ${esc(displayTitle(o))}`, cur)).join("");
  const body = `
    ${photoField(4)}
    <div class="group"><label class="field title"><input name="title" maxlength="60" value="${esc(e.title)}" placeholder="タイトル（空欄なら予定の名前）" aria-label="タイトル"></label></div>
    <div class="group">
      <label class="field"><span>予定</span><select name="link">${evOpts}</select></label>
      <label class="field"><span>日付</span><input type="date" name="date" required data-msg="日付を入れてください" value="${esc(e.date)}"></label>
      <label class="field"><span>推し</span><select name="oshiId">${oshiOptions(e.oshiId)}</select></label>
    </div>
    <div class="group"><label class="field stack-f"><span>感想・メモ</span><textarea name="text" rows="7" maxlength="4000" placeholder="よかったところ、セットリスト、買ったグッズ、一緒に行った人など">${esc(e.text)}</textarea></label></div>`;
  let photos;
  openSheet(r ? "レポートを編集" : "推し活レポート", body, {
    deleteLabel: "レポートを削除",
    deleteAsk: "このレポートを削除しますか？",
    deleteSub: "写真も一緒に削除されます。",
    onOpen: (f) => {
      photos = bindPhotoField(f, e.photos, 4);
      // 予定を選んだら、日付と推しをその予定に合わせる
      f.link.onchange = () => {
        const [id, date] = f.link.value.split("|");
        const ev = data.events.find((x) => x.id === id);
        if (!ev) return;
        f.date.value = date;
        if (ev.oshiId) f.oshiId.value = ev.oshiId;
      };
    },
    onSubmit: async (fd) => {
      const [eventId = "", linkDate] = fd.link.split("|");
      const ev = data.events.find((x) => x.id === eventId);
      const rec = {
        ...(r || { createdAt: new Date().toISOString() }),
        id: e.id || uid(), eventId: ev ? eventId : "", date: ev && linkDate ? linkDate : fd.date,
        oshiId: fd.oshiId, text: fd.text.trim(),
        title: fd.title.trim() || (ev ? displayTitle({ ...ev, occDate: linkDate, years: +linkDate.slice(0, 4) - +ev.date.slice(0, 4) }) : ""),
        photos: await photos.commit(),
      };
      if (r) data.reports[data.reports.findIndex((x) => x.id === r.id)] = rec;
      else data.reports.push(rec);
      ui.tab = "notes";
      ui.noteTab = "reports";
      toast(r ? "レポートを更新しました" : "レポートを保存しました");
    },
    onDelete: r ? () => {
      (r.photos || []).forEach(deleteMedia);
      data.reports = data.reports.filter((x) => x.id !== r.id);
      toast("レポートを削除しました");
    } : null,
  });
}

/* ---------- 行きたい場所 ---------- */
function openPlaceForm(p) {
  const e = p || { category: "cafe", oshiId: "", visited: false, photos: [] };
  const q = [e.name, e.area].filter(Boolean).join(" ");
  const body = `
    ${photoField(1)}
    <div class="group"><label class="field title"><input name="name" required maxlength="60" data-msg="場所の名前を入れてください" value="${esc(e.name)}" placeholder="場所の名前" aria-label="場所の名前"></label></div>
    <div class="group">
      <label class="field"><span>カテゴリ</span><select name="category">${PLACE_CATS.map((c) => opt(c.id, c.label, e.category)).join("")}</select></label>
      <label class="field"><span>エリア</span><input name="area" maxlength="80" value="${esc(e.area)}" placeholder="住所・最寄り駅など"></label>
      <label class="field"><span>URL</span><input type="url" name="url" maxlength="500" value="${esc(e.url)}" placeholder="https://" data-msg="URL は https:// から入力してください"></label>
      <label class="field"><span>推し</span><select name="oshiId">${oshiOptions(e.oshiId)}</select></label>
      <label class="field"><span class="grow">行った</span><span class="toggle"><input type="checkbox" name="visited"${e.visited ? " checked" : ""} aria-label="行った"><i></i></span></label>
    </div>
    <div class="group"><label class="field stack-f"><span>メモ</span><textarea name="memo" rows="3" maxlength="1000" placeholder="営業時間、予約の要否、行きたい理由など">${esc(e.memo)}</textarea></label></div>
    ${p ? `<div class="btn-row" style="margin-top:16px">
      <a class="btn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}" target="_blank" rel="noopener">${icon("pin")}地図で見る</a>
      ${e.url ? `<a class="btn" href="${esc(e.url)}" target="_blank" rel="noopener">サイトを開く</a>` : ""}
    </div>` : ""}`;
  let photos;
  openSheet(p ? "行きたい場所を編集" : "行きたい場所", body, {
    deleteLabel: "この場所を削除",
    deleteAsk: "この場所を削除しますか？",
    onOpen: (f) => { photos = bindPhotoField(f, e.photos, 1); },
    onSubmit: async (fd) => {
      if (!fd.name.trim()) { toast("場所の名前を入れてください"); return false; }
      const visited = !!fd.visited;
      const rec = {
        ...(p || { createdAt: new Date().toISOString() }),
        id: e.id || uid(), name: fd.name.trim(), category: fd.category, area: fd.area.trim(), url: fd.url.trim(),
        oshiId: fd.oshiId, memo: fd.memo.trim(), visited,
        visitedAt: visited ? e.visitedAt || new Date().toISOString() : "",
        photos: await photos.commit(),
      };
      if (p) data.places[data.places.findIndex((x) => x.id === p.id)] = rec;
      else data.places.push(rec);
      ui.tab = "notes";
      ui.noteTab = "places";
      toast(p ? "更新しました" : "行きたい場所に追加しました");
    },
    onDelete: p ? () => {
      (p.photos || []).forEach(deleteMedia);
      data.places = data.places.filter((x) => x.id !== p.id);
      toast("削除しました");
    } : null,
  });
}
