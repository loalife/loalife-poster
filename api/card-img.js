// Vercel serverless function
// 公開名刺の写真を実画像として返すエンドポイント（GET /api/card-img?id=<cardId>）。
//
// 名刺ドキュメント（Firestore publicCards/{cardId}）の写真は data URI で保存されて
// いるが、og:image には data URI を指定できないため、SNSプレビュー用に
// デコードして image/* で返す。写真が無い・取得できない場合は汎用OG画像へ
// リダイレクトする（プレビューが壊れた画像にならないように）。
const lib = require("./_ogp-lib.js");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  let id = (req.query && req.query.id) || "";
  if (!id) {
    try { id = new URL(req.url, "http://localhost").searchParams.get("id") || ""; } catch (e) {}
  }
  if (!lib.isValidCardId(id)) {
    res.status(400).end("Bad Request");
    return;
  }

  const card = await lib.fetchPublicCard(id, undefined, 5000);
  const decoded = card ? lib.decodeDataUri(card.photo) : null;
  if (!decoded) {
    res.status(302);
    res.setHeader("Location", lib.GENERIC_OG_IMAGE);
    res.setHeader("Cache-Control", "public, max-age=60");
    res.end();
    return;
  }

  const buf = Buffer.from(decoded.base64, "base64");
  res.status(200);
  res.setHeader("Content-Type", decoded.mime);
  res.setHeader("Content-Length", buf.length);
  // 名刺の写真は差し替え可能なので、CDNには長め・ブラウザには短めのキャッシュ
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "HEAD") res.end();
  else res.end(buf);
};
