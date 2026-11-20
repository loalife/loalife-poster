// ============================================================
// Vercel Edge Middleware: 名刺URLの共有プレビュー（動的OGP）
//
// 名刺URL（/?card=<cardId>）を LINE 等で共有したとき、プレビュー取得ボットは
// JS を実行しないため、通常は全カード共通の固定OGPしか表示されない。
// このミドルウェアは「プレビューボット × card/pet パラメータあり」の場合だけ
// そのカード専用の OGP HTML を返し、それ以外は完全素通しする。
//
// 実ユーザーへの無影響が絶対条件:
//   - matcher はルート "/" のみ
//   - ボット判定は api/_ogp-lib.js のボット専用トークン（LINE は line-poker。
//     アプリ内ブラウザの "Line/14.x" は実ユーザーなので対象にしない）
//   - Firestore 取得失敗・不存在・例外時はすべて素通し（汎用プレビューのまま）
// ============================================================
import lib from "./api/_ogp-lib.js";

const {
  SITE_ORIGIN,
  GENERIC_OG_IMAGE,
  isBotUA,
  isValidCardId,
  fetchPublicCard,
  buildCardTitle,
  buildCardDescription,
  decodePetParam,
  buildPetTitle,
  buildPetDescription,
  buildOgHtml
} = lib;

export const config = { matcher: "/" };

// 素通し（オリジンへそのまま流す）
function next() {
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}

function ogResponse(html) {
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=600"
    }
  });
}

export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const cardId = url.searchParams.get("card");
    const petRaw = url.searchParams.get("pet");
    if (!cardId && !petRaw) return next();

    const ua = request.headers.get("user-agent") || "";
    if (!isBotUA(ua)) return next();

    if (cardId) {
      if (!isValidCardId(cardId)) return next();
      const card = await fetchPublicCard(cardId, undefined, 2500);
      if (!card) return next(); // 取得失敗・不存在は汎用プレビューのまま
      const hasPhoto = typeof card.photo === "string" && card.photo.indexOf("data:image/") === 0;
      const pageUrl = SITE_ORIGIN + "/?card=" + encodeURIComponent(cardId);
      return ogResponse(buildOgHtml({
        title: buildCardTitle(card),
        description: buildCardDescription(card),
        image: hasPhoto ? SITE_ORIGIN + "/api/card-img?id=" + encodeURIComponent(cardId) : GENERIC_OG_IMAGE,
        url: pageUrl,
        largeImage: hasPhoto
      }));
    }

    // レガシー ?pet= リンク（データはURL内包。写真は含まれないため画像は汎用のまま）
    const pet = decodePetParam(petRaw);
    if (!pet) return next();
    return ogResponse(buildOgHtml({
      title: buildPetTitle(pet),
      description: buildPetDescription(pet),
      image: GENERIC_OG_IMAGE,
      url: SITE_ORIGIN + "/?pet=" + encodeURIComponent(petRaw),
      largeImage: false
    }));
  } catch (e) {
    return next();
  }
}
