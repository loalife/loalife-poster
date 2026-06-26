import { CareKind, FamilyMember, ItemType } from '../types';

export const TYPE_META: Record<ItemType, { label: string; emoji: string; bg: string; fg: string }> = {
  dream:  { label: '夢',    emoji: '🌈', bg: '#FFE0EC', fg: '#FF2D7E' },
  work:   { label: '仕事',  emoji: '💼', bg: '#E6E8FB', fg: '#4F5BD5' },
  event:  { label: '予定',  emoji: '📅', bg: '#ECE3FF', fg: '#7C4DFF' },
  social: { label: '飲み会',emoji: '🍻', bg: '#FFE7D6', fg: '#E8730C' },
  habit:  { label: '習慣',  emoji: '💪', bg: '#FFF4D6', fg: '#D99400' },
  care:   { label: 'ケア',  emoji: '🩺', bg: '#DBF6F1', fg: '#0E9E8E' },
};

export const ME_TYPES: ItemType[] = ['dream', 'work', 'event', 'social', 'habit'];

export const KIND_STYLE = {
  pet:    { bg: '#DBF6F1', fg: '#0E9E8E', word: 'ケア' },
  person: { bg: '#E3EEFF', fg: '#3B7BF6', word: '予定' },
} as const;

interface CareKindDef {
  key: CareKind;
  label: string;
  emoji: string;
}

export const DOG_KINDS: CareKindDef[] = [
  { key: 'vaccine',  label: 'ワクチン',   emoji: '💉' },
  { key: 'rabies',   label: '狂犬病',     emoji: '🐕' },
  { key: 'filaria',  label: 'フィラリア', emoji: '🦟' },
  { key: 'trim',     label: 'トリミング', emoji: '✂️' },
  { key: 'hospital', label: '通院',       emoji: '🏥' },
  { key: 'other',    label: 'その他',     emoji: '🐾' },
];

export const CAT_KINDS: CareKindDef[] = [
  { key: 'vaccine',  label: 'ワクチン',   emoji: '💉' },
  { key: 'filaria',  label: 'フィラリア', emoji: '🦟' },
  { key: 'trim',     label: 'トリミング', emoji: '✂️' },
  { key: 'hospital', label: '通院',       emoji: '🏥' },
  { key: 'other',    label: 'その他',     emoji: '🐾' },
];

export const OTHER_PET_KINDS: CareKindDef[] = [
  { key: 'checkup',  label: '健康診断',   emoji: '🩺' },
  { key: 'groom',    label: 'お手入れ',   emoji: '🧼' },
  { key: 'hospital', label: '通院',       emoji: '🏥' },
  { key: 'other',    label: 'その他',     emoji: '🐾' },
];

export const PERSON_KINDS: CareKindDef[] = [
  { key: 'vaccine',  label: '予防接種',   emoji: '💉' },
  { key: 'checkup',  label: '健康診断',   emoji: '🩺' },
  { key: 'lesson',   label: '習い事',     emoji: '🎒' },
  { key: 'hospital', label: '通院',       emoji: '🏥' },
  { key: 'event',    label: '予定',       emoji: '📅' },
  { key: 'other',    label: 'その他',     emoji: '✨' },
];

export const HIGH_RISK_KINDS = new Set<CareKind>(['vaccine', 'filaria', 'rabies', 'hospital', 'checkup']);

export const REPEATS = [
  { key: 'none',    label: 'なし' },
  { key: 'daily',   label: '毎日' },
  { key: 'weekly',  label: '毎週' },
  { key: 'monthly', label: '毎月' },
  { key: 'yearly',  label: '毎年' },
] as const;

export const REMINDER_OPTS = [
  { key: 0,    label: '開始時' },
  { key: 5,    label: '5分前' },
  { key: 30,   label: '30分前' },
  { key: 60,   label: '1時間前' },
  { key: 1440, label: '前日' },
] as const;

export const PET_EMOJIS = ['🐶', '🐱', '🐰', '🐹', '🐦', '🐢'];
export const PERSON_EMOJIS = ['👧', '🧒', '👦', '👶', '👩', '👨'];
export const SPECIES = [
  { key: 'dog' as const,   label: '犬',   emoji: '🐶' },
  { key: 'cat' as const,   label: '猫',   emoji: '🐱' },
  { key: 'other' as const, label: 'その他', emoji: '🐹' },
];

export const PICKER_EMOJIS = [
  '✨', '🌈', '💪', '🏃', '🚴', '🏋️', '🧘', '🎹', '🎸', '🎤',
  '🎬', '📚', '🎓', '💼', '✈️', '🏖️', '⛰️', '📷', '🍳', '☕',
  '💰', '🏥', '💉', '🦷', '✂️', '🦮', '🐶', '🐱', '🎂', '💍',
  '🧸', '🧹', '📦', '🗣️', '👁️', '🦟', '❤️', '⭐', '🎯', '🌷',
];

const EMOJI_RULES: [string[], string][] = [
  [['目', '眼', 'ICL', 'メガネ', '視力', 'レーシック'], '👁️'],
  [['マラソン', 'ラン', '走', 'ジョギング', '駅伝'], '🏃'],
  [['ジム', '筋トレ', 'トレーニング', 'crossfit', '筋'], '🏋️'],
  [['自転車', 'サイクリング', 'ロングライド', 'ライド'], '🚴'],
  [['泳', 'スイミング', 'プール', '水泳'], '🏊'],
  [['ヨガ', 'ストレッチ', '瞑想'], '🧘'],
  [['ピアノ', 'ジャズ', '鍵盤'], '🎹'],
  [['ギター', '楽器', '音楽', 'バンド'], '🎸'],
  [['ライブ', 'コンサート', '歌', 'カラオケ'], '🎤'],
  [['映画', 'シネマ'], '🎬'],
  [['本', '読書', '読む'], '📚'],
  [['試験', '資格', '勉強', '検定', 'TOEIC', '学習'], '🎓'],
  [['面接', '転職', 'キャリア', '副業'], '💼'],
  [['会議', '打ち合わせ', 'MTG', 'ミーティング', '商談'], '📊'],
  [['飲み会', '会食', '宴会', 'パーティ', '歓迎会', '送別会'], '🍻'],
  [['旅', '旅行', '海外', '観光'], '✈️'],
  [['海', 'ビーチ', '南国'], '🏖️'],
  [['山', '登山', 'ハイキング', 'トレッキング'], '⛰️'],
  [['語', 'スペイン語', '英語', '中国語', '会話'], '🗣️'],
  [['写真', 'カメラ', '撮'], '📷'],
  [['料理', 'ごはん', 'レストラン', 'クッキング'], '🍳'],
  [['コーヒー', 'カフェ', '珈琲'], '☕'],
  [['貯金', 'お金', '投資', 'NISA', 'iDeCo'], '💰'],
  [['病院', '通院', '受診', '健診', '健康診断'], '🏥'],
  [['ワクチン', '予防接種', '注射', '接種'], '💉'],
  [['フィラリア', '蚊', 'ノミ', 'ダニ'], '🦟'],
  [['狂犬病'], '🐕'],
  [['歯', '歯科', 'デンタル'], '🦷'],
  [['トリミング', 'カット', 'ヘア', 'サロン'], '✂️'],
  [['散歩', 'お散歩', 'ウォーキング'], '🦮'],
  [['習い事', 'レッスン', '塾', 'スクール'], '🎒'],
  [['誕生', '記念', 'バースデー'], '🎂'],
  [['結婚', 'プロポーズ', '婚'], '💍'],
  [['掃除', '片付'], '🧹'],
  [['引っ越', '引越', '移住'], '📦'],
];

export const guessEmoji = (title: string, fallback: string): string => {
  const t = (title || '').toLowerCase();
  for (const [keys, emo] of EMOJI_RULES) {
    if (keys.some((k) => t.includes(k.toLowerCase()))) return emo;
  }
  return fallback;
};

export const careKindsFor = (m: Pick<FamilyMember, 'kind' | 'species'>): CareKindDef[] => {
  if (m.kind === 'person') return PERSON_KINDS;
  if (m.species === 'cat') return CAT_KINDS;
  if (m.species === 'other') return OTHER_PET_KINDS;
  return DOG_KINDS;
};

export const reminderLabel = (mins: number): string =>
  REMINDER_OPTS.find((o) => o.key === mins)?.label ?? `${mins}分前`;
