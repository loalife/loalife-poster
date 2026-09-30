"use strict";
/* 入力フォーム（予定・推し活費・推し） */

// occDate：毎年くり返す予定の「その年の日付」（レポートの紐づけに使う）
function openEventForm(ev, presetDate, occDate) {
  const e = ev || { type: "live", date: presetDate || today(), oshiId: defaultOshiId() };
  const occ = occDate || e.date;
  const typeOpts = (task) => EVENT_TYPES.filter((t) => !!t.task === task && !t.app).map((t) => opt(t.id, t.label, e.type)).join("");
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
      <label class="field stack-f"><span>メモ</span><textarea name="memo" rows="3" maxlength="500" placeholder="同行者、買いたいグッズなど">${esc(e.memo)}</textarea></label>
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
      <label class="field"><span class="grow">ほかの色を選ぶ</span><input type="color" name="color" value="${esc(e.color)}" aria-label="ほかの色を選ぶ"></label>
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
// 年間の予算と、毎月の予算（どちらか片方だけでもよい）
function openBudgetForm(y) {
  const cur = budgetOf(y), month = +data.settings.monthBudget || 0;
  const body = `
    <div class="group">
      <label class="field"><span>毎月</span><input type="number" name="month" inputmode="numeric" min="0" max="99999999" step="1" value="${month || ""}" placeholder="¥0"></label>
      <label class="field"><span>${y}年</span><input type="number" name="budget" inputmode="numeric" min="0" max="999999999" step="1" value="${cur || ""}" placeholder="¥0"></label>
    </div>
    <p class="note" style="margin:10px 4px 0">毎月の予算を決めると、その月の残りと使いすぎがひと目でわかります。空欄にすると、その予算は使いません。</p>`;
  openSheet("予算", body, {
    onSubmit: (fd) => {
      const m = Math.round(+fd.month || 0), b = Math.round(+fd.budget || 0);
      if (m) data.settings.monthBudget = m; else delete data.settings.monthBudget;
      if (b) data.settings.budgets[String(y)] = b; else delete data.settings.budgets[String(y)];
      toast("予算を保存しました");
    },
  });
}

/* ---------- 推し活レポート ---------- */
function openReportForm(r, preset = {}) {
  const t = today();
  const presetEv = data.events.find((x) => x.id === preset.eventId);
  const e = r || { date: preset.date || t, eventId: preset.eventId || "", oshiId: preset.oshiId ?? defaultOshiId(), title: "", text: "", photos: [], seat: presetEv?.seat || "" };
  // 紐づけられる予定：この1年の終わった予定（値は「予定ID|日付」）
  const past = occurrences(addDays(t, -365), t).filter((o) => !isTask(o) && !o.virtual).reverse();
  // 編集中のレポートの予定が1年より前でも、選択肢から消えて紐づけが外れないように
  if (e.eventId && !past.some((o) => o.id === e.eventId && o.occDate === e.date)) {
    const ev = data.events.find((x) => x.id === e.eventId);
    if (ev) past.push({ ...ev, occDate: e.date, years: +e.date.slice(0, 4) - +ev.date.slice(0, 4) });
  }
  // ＋から新しく書くときは、直近（2週間以内）に終わった、まだレポートのない予定を最初から選んでおく
  const auto = !r && !preset.eventId ? past.find((o) => o.occDate >= addDays(t, -14) && !reportFor(o.id, o.occDate)) : null;
  if (auto) Object.assign(e, { eventId: auto.id, date: auto.occDate, oshiId: auto.oshiId || e.oshiId, seat: e.seat || data.events.find((x) => x.id === auto.id)?.seat || "" });
  const cur = e.eventId ? `${e.eventId}|${e.date}` : "";
  const evOpts = opt("", "予定を選ばない", cur) + past.map((o) => {
    const done = reportFor(o.id, o.occDate) && !(r && r.eventId === o.id && r.date === o.occDate);
    return opt(`${o.id}|${o.occDate}`, `${md(o.occDate)}  ${esc(displayTitle(o))}${done ? "（レポートあり）" : ""}`, cur);
  }).join("");
  const body = `
    ${photoField(4)}
    <div class="group"><label class="field title"><input name="title" maxlength="60" value="${esc(e.title)}" placeholder="タイトル（空欄なら予定の名前）" aria-label="タイトル"></label></div>
    <div class="group">
      <label class="field"><span>予定</span><select name="link">${evOpts}</select></label>
      <label class="field"><span>日付</span><input type="date" name="date" required data-msg="日付を入れてください" value="${esc(e.date)}"></label>
      <label class="field"><span>推し</span><select name="oshiId">${oshiOptions(e.oshiId)}</select></label>
    </div>
    ${auto ? `<p class="note" style="margin:8px 4px 0">直近の予定を選んでいます。ほかの予定に変えたり、「予定を選ばない」にしたりもできます。</p>` : ""}
    <div class="group-label">参戦記録</div>
    <div class="group">
      <label class="field"><span>座席</span><input name="seat" maxlength="60" value="${esc(e.seat)}" placeholder="アリーナA7 12列 など"></label>
      <label class="field"><span>一緒に</span><input name="companions" maxlength="60" value="${esc(e.companions)}" placeholder="一緒に行った人"></label>
      <label class="field stack-f"><span>セットリスト</span><textarea name="setlist" rows="4" maxlength="3000" placeholder="1曲ずつ改行して入力">${esc(e.setlist)}</textarea></label>
    </div>
    <p class="note" style="margin:8px 4px 0">かかった費用は、この日の「推し活費」から自動で集計して表示します。</p>
    <div class="group"><label class="field stack-f"><span>感想・メモ</span><textarea name="text" rows="6" maxlength="4000" placeholder="よかったところ、MC、&#10;買ったグッズなど">${esc(e.text)}</textarea></label></div>`;
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
        if (ev.seat && !f.seat.value) f.seat.value = ev.seat;
      };
    },
    onSubmit: async (fd) => {
      const [eventId = "", linkDate] = fd.link.split("|");
      const ev = data.events.find((x) => x.id === eventId);
      const rec = {
        ...(r || { createdAt: new Date().toISOString() }),
        id: e.id || uid(), eventId: ev ? eventId : "", date: ev && linkDate ? linkDate : fd.date,
        oshiId: fd.oshiId, text: fd.text.trim(),
        seat: fd.seat.trim(), companions: fd.companions.trim(), setlist: fd.setlist.trim(),
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
    <div class="group"><label class="field stack-f title"><span>場所の名前</span><input name="name" required maxlength="60" data-msg="場所の名前を入れてください" value="${esc(e.name)}" placeholder="例：○○コラボカフェ、○○アリーナ"></label></div>
    <div class="group">
      <label class="field"><span>カテゴリ</span><select name="category">${PLACE_CATS.map((c) => opt(c.id, c.label, e.category)).join("")}</select></label>
      <label class="field"><span>エリア</span><input name="area" maxlength="80" value="${esc(e.area)}" placeholder="最寄り駅や住所など"></label>
      <label class="field"><span>URL</span><input type="url" name="url" maxlength="500" value="${esc(e.url)}" placeholder="https://" data-msg="URL は https:// から入力してください"></label>
      <label class="field"><span>推し</span><select name="oshiId">${oshiOptions(e.oshiId)}</select></label>
      <label class="field"><span class="grow">行った</span><span class="toggle"><input type="checkbox" name="visited"${e.visited ? " checked" : ""} aria-label="行った"><i></i></span></label>
    </div>
    <div class="group"><label class="field stack-f"><span>メモ</span><textarea name="memo" rows="3" maxlength="1000" placeholder="行きたい理由、営業時間、&#10;予約やペット同伴の可否など">${esc(e.memo)}</textarea></label></div>
    ${p ? `<div class="btn-row" style="margin-top:16px">
      <a class="btn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}" target="_blank" rel="noopener">${icon("pin")}地図で見る</a>
      ${e.url ? `<a class="btn" href="${esc(e.url)}" target="_blank" rel="noopener">サイトを開く</a>` : ""}
    </div>` : ""}`;
  let photos;
  openSheet(p ? "行きたい場所を編集" : "行きたい場所を追加", body, {
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

/* ---------- 予約したホテル（予定ごと） ---------- */
function openHotelForm(ev, occ) {
  const h = ev.hotel || { checkIn: occ, nights: 1 };
  const back = () => setTimeout(() => openEventView(ev, occ));
  const body = `
    <div class="group"><label class="field stack-f title"><span>ホテル名</span><input name="name" required maxlength="60" data-msg="ホテル名を入れてください" value="${esc(h.name)}" placeholder="例：○○ホテル 会場前"></label></div>
    <div class="group">
      <label class="field"><span>チェックイン</span><input type="date" name="checkIn" value="${esc(h.checkIn)}"></label>
      <label class="field"><span>泊数</span><input type="number" name="nights" inputmode="numeric" min="1" max="30" value="${esc(h.nights)}"></label>
      <label class="field"><span>予約番号</span><input name="confirm" maxlength="40" value="${esc(h.confirm)}" placeholder="確認メールの番号など"></label>
      <label class="field"><span>予約ページ</span><input type="url" name="url" maxlength="500" value="${esc(h.url)}" placeholder="https://" data-msg="URL は https:// から入力してください"></label>
    </div>
    <p class="note" style="margin:8px 4px 0">宿泊費は「推し活費」に「遠征（交通・宿泊）」として記録すると、予算にも反映されます。</p>`;
  openSheet(ev.hotel ? "ホテルを編集" : "予約したホテル", body, {
    deleteLabel: "ホテルの記録を削除",
    deleteAsk: "ホテルの記録を削除しますか？",
    onSubmit: (fd) => {
      ev.hotel = { name: fd.name.trim(), checkIn: fd.checkIn, nights: +fd.nights || "", confirm: fd.confirm.trim(), url: fd.url.trim() };
      toast("ホテルを記録しました");
      back();
    },
    onDelete: ev.hotel ? () => { delete ev.hotel; toast("ホテルの記録を削除しました"); back(); } : null,
  });
}

/* ---------- 推し活貯金 ---------- */
function openSavingForm(g) {
  const e = g || { oshiId: defaultOshiId(), deposits: [] };
  const deposits = [...(e.deposits || [])].sort((a, b) => b.date.localeCompare(a.date));
  const body = `
    <div class="group"><label class="field stack-f title"><span>目標の名前</span><input name="name" required maxlength="40" data-msg="目標の名前を入れてください" value="${esc(e.name)}" placeholder="例：ドームツアー遠征費"></label></div>
    <div class="group">
      <label class="field"><span>目標金額</span><input type="number" name="target" inputmode="numeric" min="1" max="99999999" required data-msg="目標金額を入れてください" value="${esc(e.target)}" placeholder="¥0"></label>
      <label class="field"><span>いつまでに</span><input type="date" name="deadline" value="${esc(e.deadline)}"></label>
      <label class="field"><span>推し</span><select name="oshiId">${oshiOptions(e.oshiId)}</select></label>
    </div>
    ${deposits.length ? `<div class="group-label">これまでの記録</div><div class="group" data-deps>${deposits.map((d) => `
      <div class="ck" data-dep="${d.id}"><span class="dep-d num">${md(d.date)}</span><span class="dep-m">${esc(d.memo || (d.amount < 0 ? "引き出し" : "貯金"))}</span>
        <span class="dep-a num${d.amount < 0 ? " minus" : ""}">${d.amount < 0 ? "−" : "+"}¥${yenNum(Math.abs(d.amount))}</span>
        <button type="button" class="rm-anniv" data-rm-dep="${d.id}" aria-label="この記録を削除">${icon("close", 2)}</button></div>`).join("")}</div>` : ""}`;
  const removed = new Set();
  openSheet(g ? "貯金の目標を編集" : "貯金の目標", body, {
    deleteLabel: "目標を削除",
    deleteAsk: "この貯金の目標を削除しますか？",
    deleteSub: "これまでの貯金の記録も削除されます。",
    onOpen: (f) => f.querySelector("[data-deps]")?.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-rm-dep]");
      if (!b) return;
      removed.add(b.dataset.rmDep);
      b.closest("[data-dep]").remove();
    }),
    onSubmit: (fd) => {
      const rec = {
        ...(g || { createdAt: new Date().toISOString() }), id: e.id || uid(),
        name: fd.name.trim(), target: Math.round(+fd.target), deadline: fd.deadline, oshiId: fd.oshiId,
        deposits: (e.deposits || []).filter((d) => !removed.has(d.id)),
      };
      if (g) data.savings[data.savings.findIndex((x) => x.id === g.id)] = rec;
      else data.savings.push(rec);
      toast(g ? "更新しました" : "貯金の目標をつくりました");
    },
    onDelete: g ? () => { data.savings = data.savings.filter((x) => x.id !== g.id); toast("削除しました"); } : null,
  });
}
function openDepositForm(g) {
  const body = `
    <div class="group"><label class="field title"><span>金額</span><input type="number" name="amount" inputmode="numeric" min="1" max="99999999" required data-msg="金額を入れてください" placeholder="¥0"></label></div>
    <div class="group">
      <label class="field"><span>日付</span><input type="date" name="date" required value="${today()}"></label>
      <label class="field"><span>メモ</span><input name="memo" maxlength="40" placeholder="お給料日に、など"></label>
      <label class="field"><span class="grow">引き出す（使った分）</span><span class="toggle"><input type="checkbox" name="out" aria-label="引き出す"><i></i></span></label>
    </div>
    <p class="note" style="margin:8px 4px 0">「${esc(g.name)}」 いま ¥${yenNum(savedOf(g))} ／ 目標 ¥${yenNum(g.target)}</p>`;
  openSheet("貯金する", body, {
    onSubmit: (fd) => {
      const amount = Math.round(+fd.amount) * (fd.out ? -1 : 1);
      (g.deposits ||= []).push({ id: uid(), date: fd.date, amount, memo: fd.memo.trim() });
      const saved = savedOf(g);
      toast(amount > 0 && saved >= g.target ? "目標を達成しました！" : amount > 0 ? `¥${yenNum(amount)} 貯金しました` : "引き出しを記録しました");
    },
  });
}

/* ---------- チケットの申し込み ----------
   同じ公演に、FC先行・一般などいくつも申し込めるように、予定ごとに複数持つ */
// 状態を変える。入金済みになったら、金額を推し活費（チケット）にも記録する
function setAppStatus(a, status) {
  a.status = status;
  const ev = data.events.find((e) => e.id === a.eventId);
  if (status === "paid" && +a.price > 0 && !data.expenses.some((x) => x.id === a.expenseId)) {
    a.expenseId = uid();
    data.expenses.push({ id: a.expenseId, amount: Math.round(+a.price), category: "ticket", oshiId: ev?.oshiId || "", date: today(), memo: `${ev?.title || "チケット"} ${a.name || ""}`.trim() });
    return "入金済みにして、推し活費にも記録しました";
  }
  return `「${appStatusOf(status).label}」にしました`;
}
function openAppForm(ev, a) {
  const e = a || { eventId: ev.id, status: "planned", count: 1 };
  const back = () => setTimeout(() => openEventView(ev));
  const dt = (label, d, tm, tone) => `<div class="field dt"><span class="${tone}">${label}</span>
    <input type="date" name="${d}" value="${esc(e[d])}" aria-label="${label}の日付"><input type="time" name="${tm}" value="${esc(e[tm])}" aria-label="${label}の時間"></div>`;
  const body = `
    <div class="group"><label class="field stack-f title"><span>受付の名前</span><input name="name" required maxlength="40" data-msg="受付の名前を入れてください" value="${esc(e.name)}" placeholder="例：FC 1次先行、一般発売"></label></div>
    <div class="group-label">状態</div>
    <div class="status-seg" role="radiogroup" aria-label="状態">${APP_STATUS.map((s) => `<label><input type="radio" name="status" value="${s.id}"${e.status === s.id ? " checked" : ""}><span class="st st-${s.id}">${s.label}</span></label>`).join("")}</div>
    <div class="group-label">締切</div>
    <div class="group">
      ${dt("申込締切", "applyBy", "applyTime", "apply")}
      ${dt("当落発表", "resultAt", "resultTime", "")}
      ${dt("入金期限", "payBy", "payTime", "pay")}
    </div>
    <p class="note" style="margin:8px 4px 0">状態に合わせて、必要な締切だけがホームとカレンダーに出ます（申込締切は申込前、当落発表は結果が出るまで、入金期限は当選したとき）。</p>
    <div class="group">
      <label class="field"><span>枚数</span><input type="number" name="count" inputmode="numeric" min="1" max="20" value="${esc(e.count)}"></label>
      <label class="field"><span>金額</span><input type="number" name="price" inputmode="numeric" min="0" max="9999999" value="${esc(e.price)}" placeholder="合計 ¥0"></label>
      <label class="field stack-f"><span>メモ</span><textarea name="memo" rows="2" maxlength="500" placeholder="申込ページ、同行者の名義など">${esc(e.memo)}</textarea></label>
    </div>
    <p class="note" style="margin:8px 4px 0">入金済みにすると、金額を推し活費（チケット）にも記録します。</p>`;
  openSheet(a ? "申し込みを編集" : "申し込みを追加", body, {
    deleteLabel: "申し込みを削除",
    deleteAsk: "この申し込みを削除しますか？",
    onSubmit: (fd) => {
      const rec = {
        ...(a || { createdAt: new Date().toISOString() }), id: e.id || uid(), eventId: ev.id, name: fd.name.trim(),
        applyBy: fd.applyBy, applyTime: fd.applyTime, resultAt: fd.resultAt, resultTime: fd.resultTime, payBy: fd.payBy, payTime: fd.payTime,
        count: +fd.count || "", price: fd.price === "" ? "" : Math.round(+fd.price), memo: fd.memo.trim(), status: e.status,
      };
      const msg = rec.status !== fd.status || (fd.status === "paid" && !a) ? setAppStatus(rec, fd.status) : "";
      if (a) data.apps[data.apps.findIndex((x) => x.id === a.id)] = rec;
      else data.apps.push(rec);
      toast(msg || (a ? "申し込みを更新しました" : "申し込みを追加しました"));
      back();
    },
    onDelete: a ? () => { data.apps = data.apps.filter((x) => x.id !== a.id); toast("申し込みを削除しました"); back(); } : null,
  });
}
// 当落発表のチェック：当選か落選かを選ぶ
function openResultPicker(a) {
  const ev = data.events.find((e) => e.id === a.eventId);
  const body = `<p class="note" style="margin:8px 4px 16px">${esc(ev?.title || "")} ${esc(a.name || "")} の結果を選んでください。</p>
    <div class="result-pick"><button type="button" class="btn primary" data-r="won">当選</button><button type="button" class="btn" data-r="lost">落選</button></div>
    ${a.payBy ? "" : `<p class="note" style="margin:16px 4px 0">当選の場合は、申し込みの画面で入金期限も入れておくと、締切をお知らせできます。</p>`}`;
  openView("当落の結果", body, () => ev && openAppForm(ev, a), (f) => {
    f.querySelectorAll("[data-r]").forEach((b) => (b.onclick = () => {
      const msg = setAppStatus(a, b.dataset.r);
      save();
      $("#sheet").close();
      toast(msg);
      if (b.dataset.r === "won" && !a.payBy && ev) setTimeout(() => openAppForm(ev, a), 200);
    }));
  });
}
