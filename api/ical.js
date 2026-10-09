// Vercel serverless function
// POSTで受け取ったiCalデータをtext/calendarとして返す
// iOSはHTTPレスポンスのContent-Typeを見てカレンダーアプリに渡す
//
// セキュリティ（監査 F7）:
//  - リクエストボディに上限を設ける（無制限読み込みによるメモリ枯渇を防止）。
//  - BEGIN:VCALENDAR で始まる内容のみ反射。X-Content-Type-Options: nosniff を付与。
//  - レスポンスは attachment（ダウンロード）＋ text/calendar のため HTML としては解釈されない。

const MAX_BODY = 256 * 1024; // 256KB

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  let body = "";
  let size = 0;
  let tooBig = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) { tooBig = true; break; }
    body += chunk;
  }
  if (tooBig) {
    res.status(413).end("Payload Too Large");
    return;
  }

  let content = "";
  try {
    const params = new URLSearchParams(body);
    content = decodeURIComponent(params.get("content") || "");
  } catch (e) {
    res.status(400).end("Bad Request");
    return;
  }

  if (!content.startsWith("BEGIN:VCALENDAR")) {
    res.status(400).end("Invalid calendar data");
    return;
  }

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="loalife.ics"');
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).end(content);
};
