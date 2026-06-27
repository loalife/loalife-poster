// ============================================================================
// schema.js — データ永続性・スキーマ移行レイヤー（生活インフラとしての安全装置）
//
// このアプリのユーザーデータは長期的に蓄積される前提（生活インフラ）。
// 以下のルールを今後の機能追加・改修で「絶対に」守ること。
//
//  1. データ永続性ファースト
//     ユーザーデータは絶対に破棄しない。削除ではなく「変換・互換・移行」で対応する。
//     ストレージキーの変更・全削除を伴う仕様変更は禁止。
//
//  2. スキーマバージョニング
//     主要ドキュメント(state / member / item / household)に version を持たせる。
//     version 無し = v1 とみなして吸収する。
//
//  3. マイグレーション戦略（lazy / ログイン時 / 読み取り時変換）
//     旧バージョンは MIGRATIONS に「from N -> N+1」の純粋関数を足すだけで吸収する。
//
//  4. 互換性優先設計
//     新フィールドは必ず optional（nullable）。旧データが存在しても UI が壊れないよう、
//     normalize* が default を補完する。
//
//  5. 非破壊変換
//     破壊的変更（フィールド削除・rename・構造変更）は必ずこの変換レイヤーを通す。
//     既存値の直接上書きや、未知フィールドの取りこぼしは禁止（必ず ...spread で温存）。
//
//  6. UI耐性
//     normalize* が null / undefined を吸収し、欠損データでも画面が崩れないようにする。
//
//  === スキーマを変更するときの手順（必読）===
//   a. SCHEMA_VERSION を +1 する
//   b. MIGRATIONS[旧バージョン] に from->to の純粋・非破壊な変換関数を追加する
//   c. その変更の「影響範囲」と「マイグレーション方法」を関数の直上にコメントで残す
//   d. 旧フィールドは消さず、当面は読み取り互換のため残す（実害が無ければ温存）
// ============================================================================

// 現在のスキーマバージョン。フィールド追加だけなら据え置きでよいが、
// 既存データの「意味」を変える変更を入れる時は必ず +1 すること。
export const SCHEMA_VERSION = 2;

// localStorage の現行キー。これは今後変更しないこと（変更＝既存ユーザーのデータ切り離し）。
export const STORAGE_KEY = "patty-yaritai-v3";
// 過去に使われた可能性のある旧キー。消さずに「拾って引き継ぐ」ためのリスト。
// 新→古の順で探索し、最初に見つかったものを現行キーへ移行する（旧キーはバックアップとして残す）。
export const LEGACY_STORAGE_KEYS = ["patty-yaritai-v2", "patty-yaritai-v1", "patty-yaritai"];

// ---------------------------------------------------------------------------
// バージョン別マイグレーション（from N -> N+1、純粋関数・非破壊）
// 各関数は「未知フィールドを保持しつつ、欠損を補完する」。フィールド削除は禁止。
// ---------------------------------------------------------------------------
const MIGRATIONS = {
  // v1 -> v2
  // 影響範囲: 旧 items は type を持たないものがあった（care/dream の区別が careKind 依存）。
  // マイグレーション方法: type が無い旧アイテムのみ careKind の有無から推定して補完する。
  //   既存の type / その他フィールドは一切変更しない（非破壊）。
  1: (state) => {
    const items = (state.items || []).map((it) => {
      if (!it || typeof it !== "object") return it;
      if (it.type) return it; // 既存値は触らない
      return { ...it, type: it.careKind ? "care" : "dream" };
    });
    return { ...state, items };
  },

  // 例) 次にスキーマを変える時:
  // v2 -> v3
  // 影響範囲: ...
  // マイグレーション方法: ...
  // 2: (state) => { return state; },
};

// state 全体に必要なマイグレーションを順次適用する。
// version 無し = v1 とみなす。変換が失敗しても元データは保持する（破棄しない）。
export function runMigrations(rawState) {
  const state = rawState && typeof rawState === "object" ? rawState : {};
  let v = Number.isFinite(state.version) ? state.version : 1;
  let data = state;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (typeof step === "function") {
      try { data = step(data); } catch (e) { /* 失敗時も元データを温存して次へ */ }
    }
    v++;
  }
  return { ...data, version: SCHEMA_VERSION };
}

// ---------------------------------------------------------------------------
// 防御的正規化（read-time / lazy）。
// 欠損した optional を default で補完し、UI を null 安全にする。
// 既知以外（将来追加される未知フィールド）も必ず温存する（前方互換）。
// ---------------------------------------------------------------------------
export function normalizeMember(m) {
  if (!m || typeof m !== "object") return null;
  return {
    ...m, // 未知フィールドを温存（前方互換）
    id: m.id,
    name: m.name ?? "（名称未設定）",
    emoji: m.emoji ?? "🙂",
    kind: m.kind ?? "pet",
    species: m.species ?? (m.kind === "pet" || m.kind == null ? "dog" : undefined),
    birthday: m.birthday ?? "",
    visibility: m.visibility ?? "household",
    version: m.version ?? SCHEMA_VERSION,
  };
}

export function normalizeItem(it) {
  if (!it || typeof it !== "object") return null;
  return {
    ...it, // 未知・新フィールドを温存
    id: it.id,
    space: it.space ?? "me",
    type: it.type ?? (it.careKind ? "care" : "dream"),
    title: it.title ?? "",
    emoji: it.emoji ?? "",
    done: it.done ?? false,
    repeat: it.repeat ?? "none",
    createdAt: it.createdAt ?? Date.now(),
    version: it.version ?? SCHEMA_VERSION,
    // 以下は optional。無ければ undefined のまま（UI 側で必ずガードする）:
    //   dueDate, time, reminders, doneDate, lastBought, cycleDays, careKind, photo, completedAt
  };
}

export function normalizeMembers(arr) {
  return (Array.isArray(arr) ? arr : []).map(normalizeMember).filter(Boolean);
}
export function normalizeItems(arr) {
  return (Array.isArray(arr) ? arr : []).map(normalizeItem).filter(Boolean);
}

// localStorage の 1 ブロブ全体を「移行 + 正規化」して返す。データは破棄しない。
export function migrateState(raw) {
  const migrated = runMigrations(raw);
  return {
    ...migrated,
    members: normalizeMembers(migrated.members),
    items: normalizeItems(migrated.items),
    usage: migrated.usage && typeof migrated.usage === "object" ? migrated.usage : {},
    meEmoji: migrated.meEmoji ?? null,
    meBirthday: migrated.meBirthday ?? null,
    version: SCHEMA_VERSION,
  };
}

// localStorage へ書き出す 1 ブロブを組み立てる（必ず version を埋め込む）。
export function serializeState({ members, items, usage, meEmoji, meBirthday }) {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    members: members || [],
    items: items || [],
    usage: usage || {},
    meEmoji: meEmoji ?? null,
    meBirthday: meBirthday ?? null,
  });
}

// Firestore 書き込み用: version スタンプを付与（merge 前提・非破壊）。
export function withSchemaMeta(obj) {
  return { ...obj, version: SCHEMA_VERSION };
}
