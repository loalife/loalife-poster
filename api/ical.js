// Vercel serverless function
// POSTで受け取ったiCalデータをtext/calendarとして返す
// iOSはHTTPレスポンスのContent-Typeを見てカレンダーアプリに渡す

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

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
  res.status(200).end(content);
};
