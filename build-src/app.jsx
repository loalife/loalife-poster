import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import html2canvas from "html2canvas";
import { FB_READY, fbAuth, fbDb } from "./firebase";
import {
  GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification
} from "firebase/auth";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc,
  collection, onSnapshot, serverTimestamp,
  arrayUnion, writeBatch, getDocs, query, where
} from "firebase/firestore";
// データ永続性・スキーマ移行レイヤー（生活インフラの安全装置）。詳細は schema.js のヘッダ参照。
import {
  SCHEMA_VERSION, STORAGE_KEY, LEGACY_STORAGE_KEYS,
  migrateState, serializeState, normalizeMember, normalizeItem, withSchemaMeta
} from "./schema";
const iso = (d) => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${da}`; };
const plusDays = (n) => { const d=new Date(); d.setDate(d.getDate()+n); return iso(d); };
const daysUntil = (s) => { if(!s)return null; const[y,m,d]=s.split("-").map(Number); const due=new Date(y,m-1,d),now=new Date(),t0=new Date(now.getFullYear(),now.getMonth(),now.getDate()); return Math.round((due-t0)/86400000); };
const addInterval = (s,rep) => { const[y,m,d]=s.split("-").map(Number); const dt=new Date(y,m-1,d); if(rep==="daily")dt.setDate(dt.getDate()+1); else if(rep==="weekly")dt.setDate(dt.getDate()+7); else if(rep==="monthly")dt.setMonth(dt.getMonth()+1); else if(rep==="yearly")dt.setFullYear(dt.getFullYear()+1); return iso(dt); };
const fmtDate = (s) => { if(!s)return""; const[,m,d]=s.split("-").map(Number); return`${m}/${d}`; };
// 授乳タイマー用のフォーマッタ（ms タイムスタンプ基準）。
const isoOf = (ms) => iso(new Date(ms));
const fmtDur = (sec) => sec<60?`${sec}秒`:`${Math.floor(sec/60)}分${sec%60?`${sec%60}秒`:""}`;
const fmtClock = (ms) => { const d=new Date(ms); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const sinceLabel = (ms) => { const mins=Math.max(0,Math.floor((Date.now()-ms)/60000)); if(mins<1)return"たった今"; if(mins<60)return`${mins}分`; const h=Math.floor(mins/60),m=mins%60; return`${h}時間${m?`${m}分`:""}`; };
// 散歩記録：2点間の距離（メートル・Haversine）、距離表記、GPSルートのSVGトレース。
const haversineM = (a,b) => { const R=6371000,rad=Math.PI/180; const dLat=(b.lat-a.lat)*rad,dLng=(b.lng-a.lng)*rad; const s=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.min(1,Math.sqrt(s))); };
const fmtDist = (m) => m==null?"—":m>=1000?`${(m/1000).toFixed(2)}km`:`${Math.round(m)}m`;
const routePath = (route,w,h,pad=6) => { if(!Array.isArray(route)||route.length<2)return""; let minLa=Infinity,maxLa=-Infinity,minLo=Infinity,maxLo=-Infinity; route.forEach(p=>{if(p.lat<minLa)minLa=p.lat;if(p.lat>maxLa)maxLa=p.lat;if(p.lng<minLo)minLo=p.lng;if(p.lng>maxLo)maxLo=p.lng;}); const spanLa=Math.max(1e-6,maxLa-minLa),spanLo=Math.max(1e-6,maxLo-minLo); const iw=w-2*pad,ih=h-2*pad; return route.map(p=>{const x=pad+((p.lng-minLo)/spanLo)*iw; const y=pad+(1-(p.lat-minLa)/spanLa)*ih; return `${x.toFixed(1)},${y.toFixed(1)}`;}).join(" "); };
// 散歩の月間めやす（犬種サイズ×年齢）。獣医の助言ではなく、あくまでゆるやかな目安。
const WALK_BREED_SMALL=["チワワ","トイプードル","ダックス","ポメラニアン","シーズー","マルチーズ","ヨークシャー","パピヨン","豆柴","カニンヘン","チン","キャバリア","ペキニーズ","ピンシャー","ビション","パグ","フレンチブル","ボストン"];
const WALK_BREED_LARGE=["ゴールデン","ラブラドール","レトリバー","シェパード","ハスキー","ボーダーコリー","バーニーズ","ピレニーズ","ドーベルマン","ダルメシアン","秋田","ワイマラナー","ロットワイラー","スタンダードプードル","フラットコーテッド","コリー","ボクサー","グレート"];
const walkSizeOf=(breed)=>{const b=(breed||"");if(WALK_BREED_LARGE.some(k=>b.includes(k)))return"large";if(WALK_BREED_SMALL.some(k=>b.includes(k)))return"small";return"medium";};
const walkGoalFor=(m)=>{
  if(!m||m.species!=="dog")return null;
  const size=walkSizeOf(m.breed);
  const mo=typeof monthsOld==="function"?monthsOld(m.birthday):null;
  const stage=mo==null?"adult":mo<12?"puppy":mo>=96?"senior":"adult"; // <1歳=子犬, 8歳以上=シニア
  const baseKm={small:2,medium:3.5,large:5.5}[size];
  const factor={puppy:0.5,adult:1,senior:0.65}[stage];
  const monthlyKm=Math.round(baseKm*factor*30);
  const dailyWalks=size==="small"?1:2;
  const monthlyWalks=Math.round(dailyWalks*(stage==="senior"?0.7:1)*30);
  return{size,stage,monthlyKm,monthlyWalks,sizeLabel:{small:"小型",medium:"中型",large:"大型"}[size],stageLabel:{puppy:"子犬",adult:"成犬",senior:"シニア"}[stage],knownBreed:size!=="medium"||!!(m.breed&&m.breed.trim()),knownAge:mo!=null};
};
const daysBetween = (a,b) => { const[ay,am,ad]=a.split("-").map(Number),[by,bm,bd]=b.split("-").map(Number); return Math.round((new Date(by,bm-1,bd)-new Date(ay,am-1,ad))/86400000); };
const addDays = (s,n) => { const[y,m,d]=s.split("-").map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+n); return iso(dt); };
const fmtBirthday = (s) => { if(!s)return""; const[,mo,d]=s.split("-").map(Number); return`${mo}月${d}日`; };

// dream は選択カテゴリから廃止。既存データ（過去に作成された「夢」項目）の表示互換のため定義のみ残す。
const TYPE_META={work:{label:"仕事",labelEn:"Work",labelZh:"工作",labelEs:"Trabajo",emoji:"💼",bg:"#E7E9EF",fg:"#5B6B9E"},event:{label:"予定",labelEn:"Plan",labelZh:"计划",labelEs:"Plan",emoji:"📅",bg:"#ECE6F1",fg:"#8A6D9E"},social:{label:"飲み会",labelEn:"Social",labelZh:"聚会",labelEs:"Social",emoji:"🍻",bg:"#F3E7D6",fg:"#C77A2E"},habit:{label:"習慣",labelEn:"Habit",labelZh:"习惯",labelEs:"Hábito",emoji:"💪",bg:"#F5EAD2",fg:"#C99A2E"},health:{label:"通院",labelEn:"Doctor",labelZh:"就诊",labelEs:"Médico",emoji:"🏥",bg:"#E3EFE6",fg:"#557E63"},dream:{label:"夢",labelEn:"Dream",labelZh:"梦想",labelEs:"Sueño",emoji:"🌈",bg:"#F5EAD8",fg:"#B23A48"}};
const ME_TYPES=["work","event","social","habit","health"];
// 予定系（その日に起きる・カレンダー表示・日付が実質必須）。それ以外はToDo系＝期限は任意。
const KIND_STYLE={pet:{bg:"#E4EEE7",fg:"#557E63",word:"ケア"},person:{bg:"#E3EEFF",fg:"#3B7BF6",word:"予定"}};
// 安心ステータスのレベル：OK / 注意 / 要対応
const LEVEL_META={ok:{label:"順調",dot:"#6FA382"},warn:{label:"注意",dot:"#D9A441"},alert:{label:"要対応",dot:"#B23A48"},none:{label:"記録なし",dot:"#B5ADA3"},memorial:{label:"追悼",dot:"#A98BC9"}};
const DOG_KINDS=[{key:"daycare",label:"保育園",labelEn:"Daycare",labelZh:"托儿所",labelEs:"Guardería",emoji:"🏫"},{key:"vaccine",label:"ワクチン",labelEn:"Vaccine",labelZh:"疫苗",labelEs:"Vacuna",emoji:"💉"},{key:"rabies",label:"狂犬病",labelEn:"Rabies",labelZh:"狂犬病",labelEs:"Rabia",emoji:"🐕"},{key:"filaria",label:"フィラリア",labelEn:"Heartworm",labelZh:"心丝虫",labelEs:"Filaria",emoji:"🦟"},{key:"med",label:"投薬",labelEn:"Medication",labelZh:"用药",labelEs:"Medicación",emoji:"💊"},{key:"trim",label:"トリミング",labelEn:"Grooming",labelZh:"美容",labelEs:"Peluquería",emoji:"✂️"},{key:"hospital",label:"通院",labelEn:"Vet visit",labelZh:"就诊",labelEs:"Veterinario",emoji:"🏥"},{key:"other",label:"その他",labelEn:"Other",labelZh:"其他",labelEs:"Otro",emoji:"🐾"}];
const CAT_KINDS=[{key:"vaccine",label:"ワクチン",labelEn:"Vaccine",labelZh:"疫苗",labelEs:"Vacuna",emoji:"💉"},{key:"filaria",label:"フィラリア",labelEn:"Heartworm",labelZh:"心丝虫",labelEs:"Filaria",emoji:"🦟"},{key:"med",label:"投薬",labelEn:"Medication",labelZh:"用药",labelEs:"Medicación",emoji:"💊"},{key:"trim",label:"トリミング",labelEn:"Grooming",labelZh:"美容",labelEs:"Peluquería",emoji:"✂️"},{key:"hospital",label:"通院",labelEn:"Vet visit",labelZh:"就诊",labelEs:"Veterinario",emoji:"🏥"},{key:"other",label:"その他",labelEn:"Other",labelZh:"其他",labelEs:"Otro",emoji:"🐾"}];
const OTHER_PET_KINDS=[{key:"checkup",label:"健康診断",labelEn:"Check-up",labelZh:"体检",labelEs:"Revisión",emoji:"🩺"},{key:"med",label:"投薬",labelEn:"Medication",labelZh:"用药",labelEs:"Medicación",emoji:"💊"},{key:"groom",label:"お手入れ",labelEn:"Grooming",labelZh:"美容",labelEs:"Peluquería",emoji:"🧼"},{key:"hospital",label:"通院",labelEn:"Vet visit",labelZh:"就诊",labelEs:"Veterinario",emoji:"🏥"},{key:"other",label:"その他",labelEn:"Other",labelZh:"其他",labelEs:"Otro",emoji:"🐾"}];
const PERSON_KINDS=[{key:"lesson",label:"習い事",labelEn:"Lessons",labelZh:"兴趣班",labelEs:"Actividades",emoji:"🎒"},{key:"event",label:"予定",labelEn:"Event",labelZh:"计划",labelEs:"Evento",emoji:"📅"},{key:"school",label:"学校行事",labelEn:"School event",labelZh:"学校活动",labelEs:"Evento escolar",emoji:"🏫"},{key:"med",label:"投薬",labelEn:"Medication",labelZh:"用药",labelEs:"Medicación",emoji:"💊"},{key:"hospital",label:"通院",labelEn:"Doctor visit",labelZh:"就诊",labelEs:"Médico",emoji:"🏥"},{key:"dental",label:"歯科",labelEn:"Dental",labelZh:"牙科",labelEs:"Dentista",emoji:"🦷"},{key:"checkup",label:"健康診断",labelEn:"Check-up",labelZh:"体检",labelEs:"Revisión",emoji:"🩺"},{key:"vaccine",label:"予防接種",labelEn:"Vaccination",labelZh:"疫苗接种",labelEs:"Vacunación",emoji:"💉"},{key:"other",label:"その他",labelEn:"Other",labelZh:"其他",labelEs:"Otro",emoji:"✨"}];
const SPECIES=[{key:"dog",label:"犬",labelEn:"Dog",labelZh:"狗",labelEs:"Perro",emoji:"🐶"},{key:"cat",label:"猫",labelEn:"Cat",labelZh:"猫",labelEs:"Gato",emoji:"🐱"},{key:"other",label:"その他",labelEn:"Other",labelZh:"其他",labelEs:"Otro",emoji:"🐹"}];
// 犬種・猫種・毛色の候補（datalist の検索候補。一覧になくても自由入力で登録できる＝「見つからなくても登録OK」）。
// 日本で一般的な犬種・猫種を先頭に、海外の主要種を続けて網羅。末尾は必ず「ミックス（雑種）」「その他」。
const DOG_BREEDS=["柴犬","豆柴","トイプードル","チワワ","ミニチュアダックスフンド","カニンヘンダックスフンド","ポメラニアン","ミニチュアシュナウザー","ヨークシャーテリア","マルチーズ","シーズー","パピヨン","ペキニーズ","パグ","フレンチブルドッグ","ボストンテリア","ビションフリーゼ","キャバリアキングチャールズスパニエル","ジャックラッセルテリア","ミニチュアピンシャー","イタリアングレーハウンド","ウェルシュコーギーペンブローク","ウェルシュコーギーカーディガン","ウエストハイランドホワイトテリア","ケアーンテリア","ワイアーフォックステリア","ビーグル","コッカースパニエル","シェットランドシープドッグ","ボーダーコリー","ブルドッグ","ダルメシアン","秋田犬","甲斐犬","紀州犬","北海道犬","四国犬","日本スピッツ","サモエド","シベリアンハスキー","ゴールデンレトリバー","ラブラドールレトリバー","フラットコーテッドレトリバー","スタンダードプードル","ジャーマンシェパード","ドーベルマン","ロットワイラー","ボクサー","バーニーズマウンテンドッグ","グレートピレニーズ","グレートデーン","セントバーナード","ラフコリー","オーストラリアンシェパード","ワイマラナー","ウィペット","チャウチャウ","狆（チン）","ミックス（雑種）","その他"];
const CAT_BREEDS=["日本猫（雑種）","スコティッシュフォールド","マンチカン","アメリカンショートヘア","ブリティッシュショートヘア","ラグドール","ノルウェージャンフォレストキャット","メインクーン","ペルシャ","ロシアンブルー","ベンガル","アビシニアン","ソマリ","シャム","ヒマラヤン","ラガマフィン","エキゾチックショートヘア","セルカークレックス","デボンレックス","コーニッシュレックス","オリエンタルショートヘア","サイベリアン","トンキニーズ","バーミーズ","ボンベイ","エジプシャンマウ","ターキッシュアンゴラ","ターキッシュバン","シンガプーラ","スフィンクス","アメリカンカール","ジャパニーズボブテイル","マンクス","サバンナ","ミヌエット（ナポレオン）","ミックス（雑種）","その他"];
// 毛色は犬・猫で分離（犬に猫特有色／猫に犬特有色が混ざらないように）。
const DOG_COAT=["ブラック（黒）","ホワイト（白）","ブラウン（茶）","レッド","クリーム","フォーン","アプリコット","ゴールド","シルバー","グレー","ブルー","ブラック＆タン","トライカラー（三色）","ブリンドル","セーブル","パーティカラー","その他"];
const CAT_COAT=["黒（ブラック）","白（ホワイト）","茶（レッド）","クリーム","グレー（ブルー）","ブラウン","シルバー","キジトラ","茶トラ","サバトラ","三毛（キャリコ）","サビ（トーティ）","ハチワレ（バイカラー）","ポイント","タビー（縞）","その他"];
const OTHER_COAT=["ホワイト（白）","ブラック（黒）","ブラウン（茶）","グレー","クリーム","ミックス","その他"];
const breedOptionsFor=(species)=>species==="cat"?CAT_BREEDS:species==="dog"?DOG_BREEDS:[];
const coatOptionsFor=(species)=>species==="cat"?CAT_COAT:species==="dog"?DOG_COAT:OTHER_COAT;

// 誤食・中毒の危険物リスト（犬・猫向けの一般的な注意。獣医の診断に代わるものではない）。
// 危険度4段階 / カテゴリ / エイリアス / 症状・発症目安・受診の目安・やってはいけないこと・病院に伝える情報・出典。
// 具体的な毒性量(mg/kg)や致死量、安全量は載せない（断定を避ける）。判断は量・体重・部位・経過・個体差で変わる。
const TOX_RISK={
  emergency:{label:"緊急",emoji:"🚨",desc:"少量でも重大な中毒の恐れ。すぐ動物病院・夜間救急へ相談"},
  high:{label:"高リスク",emoji:"⚠️",desc:"症状が出る可能性。量・体重で対応が変わる"},
  caution:{label:"注意",emoji:"⚠️",desc:"大量摂取など一定の条件で危険"},
  avoid:{label:"基本NG",emoji:"ℹ️",desc:"犬に与えるべきではない"},
};
const TOX_CATS=[{k:"all",l:"すべて"},{k:"food",l:"食品"},{k:"medicine",l:"薬"},{k:"plant",l:"植物"},{k:"household",l:"家庭用品"}];
const TOX_RANK={emergency:0,high:1,caution:2,avoid:3};
// 共通の「やってはいけないこと」「病院に伝える情報」「出典」。各項目の追記と合わせて表示。
const TOX_DONT_CORE=["自己判断で吐かせない（無理な催吐は誤嚥や悪化の恐れ）","牛乳・塩水・下剤などを自己判断で与えない","症状がなくても「元気だから様子見」で放置しない"];
const TOX_VET_CORE=["何を・いつ・どのくらい食べたか","犬の体重・年齢・持病・飲んでいる薬","現物やパッケージ（成分表示）を持参する"];
const TOX_SOURCE="参照：ASPCA中毒管理センター／Pet Poison Helpline／Merck獣医マニュアル等の一般情報";
const TOX_REVIEWED="2026-09-18";
const TOXIC_ITEMS=[
  {id:"choco",name:"チョコレート・ココア",aliases:["チョコ","ちょこ","ココア","カカオ","チョコレート"],category:"food",species:"both",risk:"high",toxic:"カカオのテオブロミン（ビター・製菓用ほど濃い）",symptoms:["嘔吐","下痢","落ち着かない","心拍が速い","ふるえ","重症でけいれん・不整脈"],onset:"6〜12時間以内に出ることが多い",urgency:"量が多い／ビター・製菓用／小型犬／症状があるときは早めに",variesBy:["量","体重","製品の濃さ"]},
  {id:"grape",name:"ぶどう・レーズン",aliases:["ぶどう","ブドウ","レーズン","干しぶどう","グレープ"],category:"food",species:"both",risk:"emergency",toxic:"原因物質は特定されていないが、少量でも急性腎障害の報告",symptoms:["嘔吐","下痢","元気消失","食欲不振","尿量の変化"],onset:"数時間〜24〜72時間で腎症状が出ることも（遅れて出る）",urgency:"量に関わらず早めに（少量でも報告あり）",variesBy:["個体差"]},
  {id:"allium",name:"ねぎ類（玉ねぎ・長ねぎ・にら・にんにく）",aliases:["玉ねぎ","たまねぎ","ねぎ","長ねぎ","にら","ニラ","にんにく","ニンニク"],category:"food",species:"both",risk:"high",toxic:"有機硫黄化合物が赤血球を壊す（加熱・スープでも）",symptoms:["元気消失","食欲不振","貧血","赤〜茶色の尿"],onset:"数時間〜数日後に貧血が出ることも（遅発に注意）",urgency:"量が多い／元気消失や尿の色の変化があるとき",variesBy:["量","体重"]},
  {id:"xylitol",name:"キシリトール（無糖ガム・お菓子）",aliases:["キシリトール","xylitol","無糖ガム","シュガーレス","ガム"],category:"food",species:"dog",risk:"emergency",toxic:"犬でごく少量でも急激な低血糖・肝障害の恐れ",symptoms:["ふらつき","ぐったり","けいれん","嘔吐"],onset:"30〜60分で低血糖のことも／肝障害は1〜2日後のことも",urgency:"少量でも早めに",variesBy:["量","体重"]},
  {id:"alcohol",name:"アルコール",aliases:["アルコール","お酒","酒","ビール","エタノール"],category:"food",species:"both",risk:"high",toxic:"飲料のほか、パン生地・消毒液・発酵物にも含まれる",symptoms:["ふらつき","嘔吐","呼吸が浅い","低体温","重症で昏睡"],onset:"30分〜数時間",urgency:"ぐったり／呼吸の変化があるとき",variesBy:["量","体重"]},
  {id:"caffeine",name:"カフェイン（コーヒー・お茶・エナジー飲料）",aliases:["カフェイン","コーヒー","珈琲","お茶","紅茶","エナジードリンク","茶葉"],category:"food",species:"both",risk:"high",toxic:"コーヒー・茶葉・エナジー飲料・コーヒーかす",symptoms:["落ち着かない","心拍が速い","ふるえ","重症でけいれん"],onset:"1〜2時間",urgency:"量が多い／落ち着かない・心拍が速いとき",variesBy:["量","体重"]},
  {id:"macadamia",name:"マカダミアナッツ",aliases:["マカダミア","ナッツ"],category:"food",species:"dog",risk:"high",toxic:"少量でも一過性の神経症状が出ることがある",symptoms:["後ろ足の脱力","ふるえ","発熱","元気消失","嘔吐"],onset:"12時間以内が多い",urgency:"歩きにくそう／ふるえがあるとき",variesBy:["量","体重"]},
  {id:"dough",name:"生のパン生地",aliases:["パン生地","生地","発酵"],category:"food",species:"both",risk:"high",toxic:"胃内で発酵・膨張し、アルコールも発生する",symptoms:["お腹の張り","吐こうとして出ない","ふらつき"],onset:"食後まもなく〜数時間",urgency:"お腹が張る／苦しそうなときはすぐ",variesBy:["量"]},
  {id:"avocado",name:"アボカド",aliases:["アボカド"],category:"food",species:"both",risk:"caution",toxic:"ペルシンを含む。種は誤飲・閉塞の恐れ",symptoms:["嘔吐","下痢"],onset:"数時間",urgency:"種を丸呑み／繰り返す嘔吐",variesBy:["量","部位"]},
  {id:"bone",name:"加熱した骨（鶏・魚など）",aliases:["骨","鶏の骨","魚の骨"],category:"food",species:"both",risk:"caution",toxic:"加熱骨は鋭く割れ、口〜消化管を傷つける・詰まる",symptoms:["よだれ","口を気にする","嘔吐","血便","食欲不振"],onset:"直後〜数日",urgency:"のどに詰まる／血が出る／繰り返す嘔吐",variesBy:["部位","大きさ"]},
  {id:"salt",name:"塩分の多い人の食べ物",aliases:["塩","塩分","ハム","スナック","出汁"],category:"food",species:"both",risk:"caution",toxic:"過剰な塩分で体調を崩すことがある",symptoms:["嘔吐","多飲多尿","ふらつき"],onset:"数時間",urgency:"大量／ふらつきがあるとき",variesBy:["量","体重"]},
  {id:"dairy",name:"牛乳・乳製品",aliases:["牛乳","乳製品","チーズ","ヨーグルト"],category:"food",species:"both",risk:"avoid",toxic:"乳糖が合わない子が多い",symptoms:["お腹のゆるみ","下痢"],onset:"数時間",urgency:"下痢が続くとき",variesBy:["個体差"]},
  {id:"nsaid",name:"人用の鎮痛薬（イブプロフェン・アセトアミノフェン等）",aliases:["痛み止め","鎮痛薬","イブプロフェン","ロキソニン","ロキソプロフェン","バファリン","アセトアミノフェン","カロナール","NSAIDs"],category:"medicine",species:"both",risk:"emergency",toxic:"人用鎮痛薬は犬に少量でも中毒（消化管・腎・肝）",symptoms:["嘔吐","黒い便","元気消失","ふらつき"],onset:"数時間〜1日",urgency:"1錠でも相談（自己判断で犬に与えない）",variesBy:["量","体重"]},
  {id:"cold",name:"風邪薬・鼻炎薬（人用）",aliases:["風邪薬","感冒薬","鼻炎薬","咳止め","プソイドエフェドリン"],category:"medicine",species:"both",risk:"emergency",toxic:"人用の風邪薬・鼻炎薬の成分が中毒を起こすことがある",symptoms:["落ち着かない","心拍が速い","ふるえ","けいれん"],onset:"数時間",urgency:"誤飲したら早めに（成分がわかるものを持参）",variesBy:["成分","量","体重"]},
  {id:"psych",name:"睡眠薬・向精神薬など（人の処方薬）",aliases:["睡眠薬","抗うつ薬","精神安定剤","処方薬","安定剤"],category:"medicine",species:"both",risk:"high",toxic:"人の処方薬は犬に影響が出ることがある",symptoms:["強い眠気または逆に興奮","ふらつき","ふるえ"],onset:"数時間",urgency:"種類・量が不明でも相談",variesBy:["成分","量","体重"]},
  {id:"supp",name:"人用サプリ（鉄・ビタミンD等）",aliases:["サプリ","サプリメント","鉄剤","ビタミンD"],category:"medicine",species:"both",risk:"high",toxic:"鉄・ビタミンD等は過剰摂取で中毒のことがある",symptoms:["嘔吐","下痢","元気消失"],onset:"数時間〜1日",urgency:"量が多い／成分が不明なとき",variesBy:["成分","量","体重"]},
  {id:"lily",name:"ユリ科の植物（花・葉・花粉・生けた水）",aliases:["ユリ","ゆり","百合"],category:"plant",species:"cat",risk:"emergency",toxic:"猫はごく微量で急性腎障害（切り花・花粉・花瓶の水にも）",symptoms:["嘔吐","元気消失","尿が出ない"],onset:"数時間〜1〜2日で腎症状",urgency:"猫は少量でもすぐ相談",variesBy:["個体差"]},
  {id:"houseplant",name:"観葉植物（ポトス・アイビー・サゴヤシ等）",aliases:["ポトス","アイビー","サゴヤシ","観葉植物"],category:"plant",species:"both",risk:"caution",toxic:"口内を刺激する種類が多い。サゴヤシは特に危険",symptoms:["よだれ","口を気にする","嘔吐"],onset:"直後〜数時間",urgency:"サゴヤシ／大量／ぐったり",variesBy:["種類","量"]},
  {id:"bulb",name:"球根植物（チューリップ・スイセン等）",aliases:["チューリップ","スイセン","水仙","球根"],category:"plant",species:"both",risk:"caution",toxic:"球根に刺激・有害成分（特に球根部分）",symptoms:["よだれ","嘔吐","下痢"],onset:"直後〜数時間",urgency:"球根を食べた／繰り返す嘔吐",variesBy:["部位","量"]},
  {id:"antifreeze",name:"不凍液（エチレングリコール）",aliases:["不凍液","クーラント","エチレングリコール"],category:"household",species:"both",risk:"emergency",toxic:"甘く犬が舐めやすい。少量でも腎障害・致死の恐れ",symptoms:["酔ったようなふらつき","多飲多尿","その後ぐったり"],onset:"30分〜数時間で神経症状、その後に腎障害",urgency:"疑ったら一刻も早く（時間が勝負）",variesBy:["量","体重"]},
  {id:"pesticide",name:"殺鼠剤・殺虫剤・農薬",aliases:["殺鼠剤","ネズミ","殺虫剤","農薬","駆除剤"],category:"household",species:"both",risk:"emergency",toxic:"種類により出血・けいれん等。製品で作用が違う",symptoms:["出血が止まりにくい","ふるえ","けいれん","元気消失"],onset:"種類による（数時間〜数日）",urgency:"製品（パッケージ）を持ってすぐ相談",variesBy:["製品","量","体重"]},
  {id:"detergent",name:"洗剤・漂白剤",aliases:["洗剤","漂白剤","ハイター","カビ取り","トイレ洗剤"],category:"household",species:"both",risk:"high",toxic:"口・食道・胃の粘膜を傷めることがある",symptoms:["よだれ","口を気にする","嘔吐","元気消失"],onset:"直後〜数時間",urgency:"強い製品／口を痛がる／飲んだ量が多い",dont:["吐かせない（逆流で食道をさらに傷める恐れ）"],variesBy:["製品","量"]},
  {id:"nicotine",name:"たばこ・ニコチン",aliases:["たばこ","タバコ","ニコチン","加熱式","吸い殻","電子タバコ","リキッド"],category:"household",species:"both",risk:"high",toxic:"ニコチンで中毒。吸い殻・リキッドも",symptoms:["よだれ","嘔吐","落ち着かない","ふるえ","心拍が速い"],onset:"15分〜1時間",urgency:"量が多い／けいれん・ふるえ",variesBy:["量","体重"]},
  {id:"battery",name:"電池・ボタン電池",aliases:["電池","ボタン電池","バッテリー","コイン電池"],category:"household",species:"both",risk:"emergency",toxic:"飲み込むと化学やけど・穴があくことも（特にボタン電池）",symptoms:["よだれ","口を痛がる","嘔吐","元気消失"],onset:"数時間以内に損傷が進むことも",urgency:"飲み込んだ疑いだけでもすぐ（時間が勝負）",dont:["吐かせない（逆流でさらに傷める恐れ）"],variesBy:["種類","大きさ","経過時間"]},
  {id:"mold",name:"カビの生えた食品・生ゴミ",aliases:["カビ","かび","カビた","生ゴミ","腐った"],category:"food",species:"both",risk:"high",toxic:"カビ毒（マイコトキシン）でふるえ・けいれんを起こすことがある",symptoms:["ふるえ","落ち着かない","嘔吐","重症でけいれん"],onset:"数分〜数時間",urgency:"ふるえ・けいれんがあればすぐ",variesBy:["量","体重"]},
  {id:"essentialoil",name:"アロマ・精油（ティーツリー等）",aliases:["アロマ","精油","エッセンシャルオイル","ティーツリー","ディフューザー"],category:"household",species:"both",risk:"high",toxic:"精油は皮膚や経口で中毒を起こすことがある（原液は特に）",symptoms:["よだれ","ふらつき","ふるえ","元気消失"],onset:"数時間",urgency:"原液をなめた／皮膚に大量／ふらつきがあるとき",variesBy:["種類","量","体重"]},
  {id:"wildmushroom",name:"野生のキノコ",aliases:["キノコ","きのこ","茸","野生のキノコ"],category:"plant",species:"both",risk:"high",toxic:"種類の判別が難しく、有毒種は重篤な中毒（肝・神経）の恐れ",symptoms:["嘔吐","下痢","よだれ","ふらつき","重症で肝障害"],onset:"種類による（数十分〜数日）",urgency:"食べた可能性があれば早めに（できれば現物を保存）",variesBy:["種類","量"]},
];
// 夜間・救急で電話するときに伝えたいこと（安全な備えガイド。病院データは各自で登録）。
const EMERGENCY_TIPS=[
  "ペットの種類・年齢・体重（例：柴犬・5歳・8kg）",
  "何が起きたか（いつ・何を・どれくらい）",
  "今の様子（意識・呼吸・嘔吐や下痢・出血・けいれんの有無）",
  "誤食なら、食べたもの・量・時間（できれば現物やパッケージを手元に）",
  "持病・飲んでいる薬・かかりつけの有無",
  "向かうまでの目安時間",
];
const EMERGENCY_PREP=[
  "キャリー／タオル（保温・保定に）",
  "現物・パッケージ（誤食のとき）",
  "お薬手帳・ワクチン接種証明（アプリの記録も確認可）",
  "支払い手段（対応している支払い方法を事前に確認）",
];
// 受診時の持ち物（優先順位つき。準備より受診を優先）。
const EMERGENCY_PREP_TIERS=[
  {label:"まず持つ",items:["犬本体","リード／ハーネス","キャリーなど安全に運べるもの"]},
  {label:"可能なら",items:["誤食した現物・パッケージ","薬のパッケージ・服薬情報","ワクチン・診療の記録（アプリの記録も）"]},
  {label:"事前に確認",items:["支払い方法","駐車場・夜間入口"]},
];
// 明らかな緊急サイン（診断ではなく“迷ったら連絡”の安全側案内）。
const EMERGENCY_REDFLAGS=["意識がおかしい","呼吸がおかしい","けいれん","大量の出血","急な悪化"];
// 平時のチェックリスト（優先度の高いものに絞る）。
const EMERGENCY_CHECKLIST=[
  "夜間救急の病院を登録した",
  "電話番号・受付時間を確認した",
  "犬の体重を最新にした",
  "服薬情報を更新した",
  "キャリー等をすぐ持ち出せる場所に置いた",
];
// 防災・避難の備え（同行避難が基本。一般的な備えガイド。避難先は各自で自治体確認）。
const DISASTER_PREP=[
  "フード・水（できれば5〜7日分）と食器",
  "常備薬・療法食・お薬手帳／ワクチン接種証明",
  "キャリー／クレート・リード・ハーネス（脱走防止に予備も）",
  "トイレ用品（ペットシーツ・うんち袋・猫砂）",
  "迷子札・鑑札・マイクロチップ番号の控え",
  "はぐれた時のための写真（飼い主と一緒に写ったもの）",
  "タオル・毛布（保温・目隠し・音対策）",
  "ガムテープ・油性ペン（ケージ補修・情報書き）",
];
const DISASTER_TIPS=[
  "災害時は「同行避難」が基本。まず自分と家族の安全を確保してから、落ち着いてペットと避難を。",
  "避難所はペットの受け入れ可否・飼育場所が施設ごとに違います。指定避難所とペット可否を事前に自治体で確認しておく。",
  "普段からキャリー／クレートに慣らしておくと、いざという時ストレスが少なく安全。",
  "はぐれ対策に、迷子札＋マイクロチップの登録情報を最新に。連絡先も定期的に見直す。",
  "無駄吠え・トイレなどの基本のしつけは、避難所での共同生活を助けます。",
  "親戚・知人・ペットホテルなど、預け先の候補も複数考えておくと安心。",
];
// 上記セーフティ配列の英語版（日本語は非破壊で保持）。表示時に APP_LANG で選択。
const EMERGENCY_TIPS_EN=[
  "Pet's type, age, weight (e.g. Shiba, 5 yrs, 8kg)",
  "What happened (when, what, how much)",
  "Current state (consciousness, breathing, vomiting/diarrhea, bleeding, seizures)",
  "If ingested: what, how much, when (keep the item or package if you can)",
  "Chronic conditions, current meds, whether you have a regular vet",
  "Rough time until you arrive",
];
const EMERGENCY_PREP_TIERS_EN=[
  {label:"Grab first",items:["The dog","Leash / harness","A carrier or safe way to carry them"]},
  {label:"If you can",items:["The ingested item / package","Medication package & dosing info","Vaccine & visit records (in-app too)"]},
  {label:"Check ahead",items:["Payment method","Parking / night entrance"]},
];
const EMERGENCY_REDFLAGS_EN=["Altered consciousness","Trouble breathing","Seizures","Heavy bleeding","Sudden worsening"];
const EMERGENCY_CHECKLIST_EN=[
  "Registered a night-emergency clinic",
  "Confirmed the phone number and hours",
  "Updated the dog's weight",
  "Updated medication info",
  "Put the carrier somewhere you can grab it fast",
];
const DISASTER_PREP_EN=[
  "Food & water (ideally 5–7 days) and bowls",
  "Regular meds / therapeutic food / med record & vaccine certificate",
  "Carrier / crate, leash, harness (a spare to prevent escape)",
  "Toilet supplies (pee pads, poop bags, cat litter)",
  "ID tag, license, a note of the microchip number",
  "A photo for if you get separated (one with the owner in it)",
  "Towels & blankets (warmth, cover, noise)",
  "Duct tape & marker (cage repair, writing info)",
];
const DISASTER_TIPS_EN=[
  "In a disaster, evacuating together is the norm. Secure your own and your family's safety first, then calmly evacuate with your pet.",
  "Whether shelters accept pets and where they're kept varies by facility. Check your designated shelter and its pet policy with your local government in advance.",
  "Getting them used to a carrier / crate day to day means less stress and more safety when it counts.",
  "To prepare for getting separated, keep the ID tag and microchip registration up to date. Review contacts regularly too.",
  "Basic training like not barking and toilet habits helps with shared shelter life.",
  "It's reassuring to have several backup options — relatives, friends, a pet hotel.",
];
// 文字列から電話番号らしき部分を抽出（tel: リンク用）。無ければ null。
const extractTel=(str)=>{const m=(str||"").match(/0\d{1,4}[-(]?\d{1,4}[-)]?\d{3,4}/);return m?m[0].replace(/[()]/g,"-").replace(/--/g,"-"):null;};
const HIGH_KINDS=new Set(["vaccine","filaria","rabies","hospital","checkup"]);
// 「実施日から次回まで」で期限が決まる更新型ケア（狂犬病・ワクチン等）。実施日＋周期＝有効期限。
const RENEW_KINDS=new Set(["vaccine","rabies","filaria","checkup","dental","trim","groom"]);
const isRenewCare=(x)=>!!(x&&x.type==="care"&&x.careKind&&RENEW_KINDS.has(x.careKind));
// 「今日のLOALIFE」通知カテゴリ（優先順位＝この順）。todo=予定, insight=気づき, tip=提案, memory=思い出。
const NOTICE_META={todo:{icon:"clock",label:"やること",order:0},insight:{icon:"activity",label:"気づき",order:1},tip:{icon:"sparkles",label:"提案",order:2},memory:{icon:"heart",label:"思い出",order:3}};
// 記録タブの情報設計：セクションを「毎日つけるもの(record)」と「ときどき・もしも(manage)」に頻度で振り分ける。
// この順序＝各タブでの既定の並び。SECSEG は key→どちらのタブに出すか。
const SEC_DEF={
  record:["diary","routine","chore","walk","toilet","nursing","feed","meds","help","prep"],
  manage:["list","certs","health","growth","review","supply","expense","belong","allowance","foodreg","album","vet","sheet1","cards"],
};
const SECSEG=Object.fromEntries(Object.entries(SEC_DEF).flatMap(([seg,keys])=>keys.map(k=>[k,seg])));
// 迷子ポスターの「見かけた場合のお願い」定型文。性格(temper)に応じて自動で切り替える。
const PLEA_PRESETS=[
  {key:"normal",label:"ふつう",text:"見かけた方は追いかけず、見かけた場所・時間をご連絡ください。",textEn:"If you see them, please don't chase — just tell us where and when you saw them."},
  {key:"timid",label:"怖がり・警戒心が強い",text:"怖がって逃げる可能性があります。追いかけず、距離を保ったままご連絡ください。",textEn:"They may get scared and run. Please don't chase; keep your distance and contact us."},
  {key:"friendly",label:"人なつっこい",text:"人なつっこい子です。可能なら やさしく声をかけて保護し、ご連絡ください。",textEn:"They're friendly. If you can, gently call to them, keep them safe, and contact us."},
];
// 性格が登録されていれば、それに合う定型文を初期選択にする（ユーザーは変更可）。
const pleaKeyFor=(m)=>{const li=m&&m.lostInfo||{};if(li.pleaKey)return li.pleaKey;const t=li.temper||"";if(t==="timid")return"timid";if(t==="friendly")return"friendly";return"normal";};
const pleaTextOf=(m)=>{const k=pleaKeyFor(m);const pr=PLEA_PRESETS.find(p=>p.key===k)||PLEA_PRESETS[0];return APP_LANG==="ja"?pr.text:pr.textEn;};
const TEMPER_OPTS=[{k:"",l:"未設定"},{k:"friendly",l:"人なつっこい"},{k:"normal",l:"ふつう"},{k:"timid",l:"怖がり"}];
// 連絡先が電話番号っぽいか（国内・数字10〜11桁、先頭0）。ポスターで大きな発信ボタンにするか判定。
const isPhoneLike=(s)=>{const d=(s||"").replace(/[^0-9]/g,"");return d.length>=10&&d.length<=11&&d[0]==="0";};
// 電話番号にハイフンを入れ直す（携帯 3-4-4／東京・大阪 2-4-4／その他固定 3-3-4）。判定できなければ原文のまま。
function fmtJPPhone(raw){const d=(raw||"").replace(/[^0-9]/g,"");if(d.length===11)return`${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;if(d.length===10){if(/^0[36]/.test(d))return`${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6)}`;return`${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;}return raw||"";}
// ケア種別ごとの「周期」。記録すると次回がこの間隔で自動セットされる。
// none＝単発（保育園・通院など）。単発は「期限切れ」にしない。
const CARE_CYCLE={vaccine:"yearly",rabies:"yearly",filaria:"monthly",trim:"monthly",groom:"monthly",checkup:"yearly",dental:"yearly",lesson:"weekly",med:"daily",hospital:"none",daycare:"none",event:"none",school:"none",other:"none"};
// 実効周期：明示の repeat を優先、無ければケア種別の既定周期。
function effRepeat(x){if(!x)return"none";if(x.repeat&&x.repeat!=="none")return x.repeat;if(x.type==="care")return CARE_CYCLE[x.careKind]||"none";return"none";}
const isCyclic=(x)=>effRepeat(x)!=="none";
// 「期限切れ(赤)」は、周期があり・未完了・前回(期限)を過ぎたものだけ。状態として持たず毎回計算する。
function isOverdue(x){return !!(x&&!x.done&&isCyclic(x)&&x.dueDate&&daysUntil(x.dueDate)<0);}
// 種別ごとのアイコン候補（正面顔・ゆるいトーンで統一。各配列の先頭が既定選択）。
const SPECIES_EMOJIS={
  dog:["🐶","🐕","🐩"],
  cat:["🐱","🐈","🐈‍⬛"],
  // その他は幅広い動物をカバー（前半＝正面顔のゆるい系）。該当が無ければ写真アイコンを使う。
  other:["🐹","🐰","🐤","🐭","🐷","🐮","🐸","🐴","🐧","🐢","🐍","🐠","🦔","🦎","🦜"],
};
const petEmojisFor=(species)=>SPECIES_EMOJIS[species]||SPECIES_EMOJIS.dog;
const PET_EMOJIS=["🐶","🐱","🐰","🐹","🐤","🐢"]; // 既定・後方互換（🐦→🐤に統一）
const PERSON_EMOJIS=["👧","🧒","👦","👶","👩","👨"];
// 人メンバーの種別（記録項目の出し分け）。赤ちゃん→子ども→大人→高齢者の順で提示。
const PERSON_TYPES=[{k:"baby",l:"赤ちゃん",lEn:"Baby",lZh:"婴儿",lEs:"Bebé",emoji:"👶"},{k:"child",l:"子ども",lEn:"Child",lZh:"儿童",lEs:"Niño/a",emoji:"🧒"},{k:"adult",l:"大人",lEn:"Adult",lZh:"成人",lEs:"Adulto",emoji:"🧑"},{k:"senior",l:"高齢者",lEn:"Senior",lZh:"长者",lEs:"Mayor",emoji:"👵"}];
// {k,l,lEn} 形式のロケール対応ラベル（種別・性別など）。
const lOf=(o)=>o?(APP_LANG==="ja"?o.l:APP_LANG==="zh"?(o.lZh||o.lEn||o.l):APP_LANG==="es"?(o.lEs||o.lEn||o.l):(o.lEn||o.l)):"";
const ME_EMOJIS=["🙂","😊","😄","🥰","😎","🤓","🧑","👩","👨","🧑‍💻","👩‍💻","👨‍💻","🧑‍🎤","🦊","🐱","🌸","🌺","🌈","⭐","✨","🍀","🎯","🔥","💫"];
const REPEATS=[{key:"none",label:"なし"},{key:"daily",label:"毎日"},{key:"weekly",label:"毎週"},{key:"monthly",label:"毎月"},{key:"yearly",label:"毎年"}];
// 1日のルーティン（タスクテンプレ）
// ルーティン（1日のタスク）テンプレ：相手によって内容を変える
// kind は "pet" / "person" / "me"（自分）。相手によってテンプレを出し分ける。
const ROUTINE_TEMPLATES={
  pet:[{title:"散歩",emoji:"🦮",time:"07:00"},{title:"ごはん",emoji:"🍚",time:"08:00"},{title:"トイレ掃除",emoji:"🧹",time:"09:00"}],
  person:[{title:"歯みがき",emoji:"🪥",time:"08:00"},{title:"宿題",emoji:"📖",time:"17:00"},{title:"お風呂",emoji:"🛁",time:"19:00"},{title:"薬",emoji:"💊",time:"20:00"}],
  me:[{title:"運動",emoji:"🏃",time:"07:00"},{title:"筋トレ",emoji:"🏋️",time:"07:30"},{title:"勉強",emoji:"📖",time:"21:00"},{title:"読書",emoji:"📚",time:"22:00"},{title:"掃除",emoji:"🧹",time:"10:00"},{title:"洗濯",emoji:"🧺",time:"09:00"},{title:"ストレッチ",emoji:"🧘",time:"22:30"},{title:"薬・サプリ",emoji:"💊",time:"08:00"}],
};
const normKind=(k)=>k==="person"?"person":k==="me"?"me":"pet";
const routineTemplatesFor=(kind)=>ROUTINE_TEMPLATES[normKind(kind)];
const ROUTINE_EMOJIS={pet:["🦮","🍚","🧹","💊","🛁","🦴","🚽","🪥","🐾","💧"],person:["🪥","📖","🛁","💊","🍚","🌙","⏰","🎒","🧴","💧"],me:["🏃","🏋️","📖","📚","🧹","🧺","🧘","💊","💧","🌙","⏰","☕"]};
// 消耗品（ストック）テンプレ：買った日＋消費サイクルで「そろそろ切れそう」を自動表示
const SUPPLY_TEMPLATES={
  pet:[{title:"フード",emoji:"🍚",cycleDays:30},{title:"おやつ",emoji:"🦴",cycleDays:30},{title:"トイレシーツ",emoji:"🧻",cycleDays:30},{title:"薬・サプリ",emoji:"💊",cycleDays:30}],
  person:[{title:"おむつ",emoji:"🧷",cycleDays:30},{title:"ティッシュ",emoji:"🧻",cycleDays:30},{title:"洗剤",emoji:"🧴",cycleDays:45},{title:"薬・サプリ",emoji:"💊",cycleDays:30}],
  me:[{title:"サプリ",emoji:"💊",cycleDays:30},{title:"コンタクト",emoji:"👁️",cycleDays:30},{title:"洗剤",emoji:"🧴",cycleDays:45},{title:"日用品",emoji:"🧻",cycleDays:30}],
};
const supplyTemplatesFor=(kind)=>SUPPLY_TEMPLATES[normKind(kind)];
const SUPPLY_EMOJIS=["🍚","🦴","🧻","💊","👁️","🧴","🥫","🧼","🪥","🧂","☕","🍼"];
const SUPPLY_CYCLES=[7,14,30,45,60,90];
// 残り日数とトーンを算出。lowAt=サイクルの20%（最低3日）を切ったら「そろそろ」
function supplyStatus(item){
  if(!item.lastBought||!item.cycleDays)return null;
  const since=-daysUntil(item.lastBought);
  const left=item.cycleDays-since;
  const lowAt=Math.max(3,Math.round(item.cycleDays*0.2));
  const tone=left<0?"out":(left<=lowAt?"low":"ok");
  return{left,tone,since,lowAt};
}
function supplyLine(item){
  const s=supplyStatus(item);if(!s)return"";
  if(s.tone==="out")return tr(APP_LANG,"supply.lineOut");
  if(s.tone==="low")return tr(APP_LANG,"supply.lineLow",{n:s.left});
  return tr(APP_LANG,"supply.lineOk",{n:s.left});
}

// --- 逆算リマインド（在庫切れ・期限が迫ったものを1日1回まとめて通知）---
const DIGEST_KEY="loalife-digest-date";   // 「最後にダイジェスト通知した日」を保存し1日1回に制限
const SUPPLY_NOTIFY_LEFT=3;               // 残りこの日数以下で通知対象
const CARE_NOTIFY_DAYS=3;                 // 重要ケア期限のこの日数前から通知対象
// 通知すべき緊急アイテムを集めて [{emoji,text,sort}] を残量/期限の近い順で返す
function buildDigest(items){
  const urgent=[];
  (items||[]).forEach(x=>{
    if(!x||x.done)return;
    if(x.type==="supply"){
      const s=supplyStatus(x);
      if(s&&(s.tone==="out"||s.left<=SUPPLY_NOTIFY_LEFT))
        urgent.push({emoji:x.emoji||"📦",text:`${x.title}：${s.tone==="out"?"そろそろ切れそう":"あと"+s.left+"日"}`,sort:s.left});
      return;
    }
    if(x.dueDate){
      const d=daysUntil(x.dueDate);
      const isHigh=x.careKind&&HIGH_KINDS.has(x.careKind);
      // 年1回の更新（狂犬病・ワクチン等）は期限の約1か月前から、それ以外は直近3日から。期限切れは周期ありのみ。
      const win=isHigh&&effRepeat(x)==="yearly"?30:CARE_NOTIFY_DAYS;
      const renew=x.careKind&&RENEW_KINDS.has(x.careKind);
      if(isHigh&&d!==null&&d<=win&&(d>=0||isCyclic(x)))
        urgent.push({emoji:x.emoji||"⚠️",text:`${x.title}：${d<0?"期限切れ":d===0?(renew?"今日で期限":"今日"):renew?`あと${d}日で期限`:"あと"+d+"日"}`,sort:d});
    }
  });
  return urgent.sort((a,b)=>a.sort-b.sort);
}
const REMINDER_OPTS=[{key:0,label:"開始時"},{key:5,label:"5分前"},{key:30,label:"30分前"},{key:60,label:"1時間前"},{key:1440,label:"前日"}];
const reminderLabel=(mins)=>(REMINDER_OPTS.find(o=>o.key===mins)||{}).label||`${mins}分前`;

// --- Notification helpers ---
const notifSupported = typeof window !== "undefined" && "Notification" in window;

async function requestNotifPermission() {
  if (!notifSupported) return "unsupported";
  try {
    const p = await Notification.requestPermission();
    return p || "default";
  } catch (e) {
    // iOS Safari など：ホーム画面に追加していないと requestPermission が例外/未対応
    return "unsupported";
  }
}

function fireNotif(title, body) {
  if (!notifSupported || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/icon-192.png", badge: "/icon-192.png" });
  } catch(e) {}
}

function scheduleReminders(items, members) {
  if (!notifSupported || Notification.permission !== "granted") return [];
  const ids = [];
  const now = new Date();
  const todayStr = iso(now);
  items.forEach(item => {
    if (!item.time || !item.reminders?.length) return;
    const [h, mn] = item.time.split(":").map(Number);
    const memberName = item.space === "me" ? "わたし" : (members.find(m => m.id === item.space)?.name || "");
    // 毎日のルーティン：今日まだ完了していなければ今日の時刻で通知
    if (item.type === "routine") {
      if (item.doneDate === todayStr) return;
      item.reminders.forEach(minsBefore => {
        const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mn - minsBefore, 0, 0);
        const delay = base - now;
        if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
          ids.push(setTimeout(() => {
            fireNotif(`${item.emoji || "🐾"} ${item.title}`, `${memberName}の${minsBefore === 0 ? "時間です" : reminderLabel(minsBefore)+"です"}`);
          }, delay));
        }
      });
      return;
    }
    if (!item.dueDate) return;
    const d = daysUntil(item.dueDate);
    item.reminders.forEach(minsBefore => {
      const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      base.setDate(base.getDate() + (d ?? 0));
      base.setHours(h, mn - minsBefore, 0, 0);
      const delay = base - now;
      if (delay > 0 && delay < 24 * 60 * 60 * 1000) {
        const id = setTimeout(() => {
          fireNotif(`${item.emoji || "📋"} ${item.title}`, `${memberName}の${minsBefore === 0 ? "今日の予定" : reminderLabel(minsBefore)+"の予定"}です`);
        }, delay);
        ids.push(id);
      }
    });
  });
  return ids;
}

// --- Image helpers ---
function downscaleImage(file,maxDim=1100,quality=0.72){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{let{width,height}=img;if(width>height&&width>maxDim){height=(height*maxDim)/width;width=maxDim;}else if(height>=width&&height>maxDim){width=(width*maxDim)/height;height=maxDim;}const c=document.createElement("canvas");c.width=Math.round(width);c.height=Math.round(height);c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);try{resolve(c.toDataURL("image/jpeg",quality));}catch(e){reject(e);}};img.onerror=reject;img.src=url;});}

// JPEG の EXIF から撮影日（DateTimeOriginal 0x9003、無ければ DateTime 0x0132）を読む。
// キャンバス変換で EXIF は失われるため、元ファイルの先頭（〜256KB）だけを読んで解析する。
// 返り値は "YYYY-MM-DD"（取れなければ null）。壊れた/非対応データでは常に null。
function parseExifDate(buf){
  try{
    const dv=new DataView(buf);const len=dv.byteLength;
    if(len<4||dv.getUint16(0)!==0xFFD8)return null; // JPEG(SOI) 以外は非対応
    let off=2;
    while(off+4<len){
      if(dv.getUint8(off)!==0xFF)return null;
      const marker=dv.getUint16(off);
      if(marker===0xFFE1)break;                       // APP1(Exif)
      if(marker===0xFFDA||marker===0xFFD9)return null; // 画像本体に到達＝EXIFなし
      off+=2+dv.getUint16(off+2);                      // 次のマーカーへ
    }
    if(off+10>=len||dv.getUint16(off)!==0xFFE1)return null;
    const app1=off+4;
    if(dv.getUint32(app1)!==0x45786966)return null;    // "Exif"
    const tiff=app1+6;
    const little=dv.getUint16(tiff)===0x4949;          // "II"=リトル / "MM"=ビッグ
    const g16=o=>dv.getUint16(o,little),g32=o=>dv.getUint32(o,little);
    if(g16(tiff+2)!==0x002A)return null;
    const ascii=(o,cnt)=>{let s="";for(let i=0;i<cnt&&o+i<len;i++){const c=dv.getUint8(o+i);if(c===0)break;s+=String.fromCharCode(c);}return s;};
    const findTag=(base,tag)=>{const n=g16(base);for(let i=0;i<n;i++){const e=base+2+i*12;if(e+12>len)break;if(g16(e)===tag)return e;}return -1;};
    const ifd0=tiff+g32(tiff+4);
    if(ifd0+2>len)return null;
    let s=null;
    const exifE=findTag(ifd0,0x8769);                  // Exif サブIFDへのポインタ
    if(exifE>=0){const sub=tiff+g32(exifE+8);if(sub+2<len){const dtoE=findTag(sub,0x9003);if(dtoE>=0){const cnt=g32(dtoE+4);const vo=cnt<=4?dtoE+8:tiff+g32(dtoE+8);s=ascii(vo,cnt);}}}
    if(!s){const dtE=findTag(ifd0,0x0132);if(dtE>=0){const cnt=g32(dtE+4);const vo=cnt<=4?dtE+8:tiff+g32(dtE+8);s=ascii(vo,cnt);}}
    if(s&&/^\d{4}:\d\d:\d\d/.test(s))return s.slice(0,10).replace(/:/g,"-");
    return null;
  }catch(e){return null;}
}
function readExifDate(file){return new Promise(res=>{try{const r=new FileReader();r.onload=()=>res(parseExifDate(r.result));r.onerror=()=>res(null);r.readAsArrayBuffer(file.slice(0,256*1024));}catch(e){res(null);}});}

// 高齢者向けのケア・予定の種別（通院・介護サポート）。
const SENIOR_KINDS=[{key:"hospital",label:"通院",labelEn:"Doctor visit",labelZh:"就诊",labelEs:"Médico",emoji:"🏥"},{key:"med",label:"服薬",labelEn:"Medication",labelZh:"用药",labelEs:"Medicación",emoji:"💊"},{key:"pickup",label:"薬の受け取り",labelEn:"Med pickup",labelZh:"取药",labelEs:"Recoger medicación",emoji:"💊"},{key:"care",label:"介護サービス",labelEn:"Care service",labelZh:"护理服务",labelEs:"Servicio de cuidados",emoji:"🧑"},{key:"daycare",label:"デイサービス",labelEn:"Day service",labelZh:"日间照护",labelEs:"Centro de día",emoji:"🏫"},{key:"rehab",label:"リハビリ",labelEn:"Rehab",labelZh:"康复",labelEs:"Rehabilitación",emoji:"🩹"},{key:"nurse",label:"訪問看護",labelEn:"Home nursing",labelZh:"上门护理",labelEs:"Enfermería a domicilio",emoji:"🩺"},{key:"checkup",label:"健診",labelEn:"Check-up",labelZh:"体检",labelEs:"Revisión",emoji:"🩺"},{key:"vaccine",label:"予防接種",labelEn:"Vaccination",labelZh:"疫苗接种",labelEs:"Vacunación",emoji:"💉"},{key:"other",label:"その他",labelEn:"Other",labelZh:"其他",labelEs:"Otro",emoji:"✨"}];
// 赤ちゃん（乳児）向けの予定・ケアの種別（乳児健診・予防接種・通院など）。日々のミルク/おむつ等は「お世話ログ」で扱う。
const BABY_KINDS=[{key:"checkup",label:"乳児健診",labelEn:"Baby check-up",labelZh:"婴儿体检",labelEs:"Revisión del bebé",emoji:"🩺"},{key:"vaccine",label:"予防接種",labelEn:"Vaccination",labelZh:"疫苗接种",labelEs:"Vacunación",emoji:"💉"},{key:"hospital",label:"通院",labelEn:"Doctor visit",labelZh:"就诊",labelEs:"Médico",emoji:"🏥"},{key:"med",label:"投薬",labelEn:"Medication",labelZh:"用药",labelEs:"Medicación",emoji:"💊"},{key:"event",label:"予定",labelEn:"Event",labelZh:"计划",labelEs:"Evento",emoji:"📅"},{key:"other",label:"その他",labelEn:"Other",labelZh:"其他",labelEs:"Otro",emoji:"✨"}];
// 「自分」の健康・ケア記録用の種別（証明書写真も保存できる）。データ構造は members と同じ care/careKind を流用。
const SELF_KINDS=[{key:"checkup",label:"健康診断",labelEn:"Check-up",labelZh:"体检",labelEs:"Revisión",emoji:"🩺"},{key:"vaccine",label:"予防接種",labelEn:"Vaccination",labelZh:"疫苗接种",labelEs:"Vacunación",emoji:"💉"},{key:"hospital",label:"通院",labelEn:"Doctor visit",labelZh:"就诊",labelEs:"Médico",emoji:"🏥"},{key:"med",label:"投薬・服薬",labelEn:"Medication",labelZh:"用药",labelEs:"Medicación",emoji:"💊"},{key:"dental",label:"歯科",labelEn:"Dental",labelZh:"牙科",labelEs:"Dentista",emoji:"🦷"},{key:"other",label:"その他",labelEn:"Other",labelZh:"其他",labelEs:"Otro",emoji:"📄"}];
const careKindsFor=(m)=>{if(!m)return SELF_KINDS;if(m.kind==="person")return m.personType==="senior"?SENIOR_KINDS:m.personType==="baby"?BABY_KINDS:PERSON_KINDS;if(m.species==="dog")return DOG_KINDS;if(m.species==="cat")return CAT_KINDS;if(m.species==="other")return OTHER_PET_KINDS;return OTHER_PET_KINDS;};
// ケア種別の表示ラベル（ロケール対応。日本語は非破壊で label をそのまま返す）。
const careLabel=(k)=>k?(APP_LANG==="ja"?k.label:APP_LANG==="zh"?(k.labelZh||k.labelEn||k.label):APP_LANG==="es"?(k.labelEs||k.labelEn||k.label):(k.labelEn||k.label)):"";
// 汎用の {label,labelEn} ロケール対応ラベル（症状・今日のようす・体調などのデータ辞書用）。
const lblOf=(o)=>o?(APP_LANG==="ja"?o.label:APP_LANG==="zh"?(o.labelZh||o.labelEn||o.label):APP_LANG==="es"?(o.labelEs||o.labelEn||o.label):(o.labelEn||o.label)):"";
// ケア種別 → ラインアイコン名（SF Symbols相当）
const CARE_ICON={daycare:"building",vaccine:"syringe",rabies:"paw",filaria:"bug",med:"pill",trim:"scissors",hospital:"activity",other:"filetext",checkup:"stethoscope",groom:"sparkles",lesson:"bag",event:"calendar",school:"building",dental:"tooth",pickup:"pill",care:"users",rehab:"activity",nurse:"stethoscope"};
const careIcon=(k)=>CARE_ICON[k]||"paw";

// ライフログ・カレンダー用：各アイテムが「どの日に紐づくか」を1つに正規化する。
//  予定/ケア=dueDate、ストック=購入日(lastBought)、思い出=date、ルーティン=実施日(doneDate)。
//  誕生日(bday)は毎年くりかえしなので日付軸では別扱い（null）。
function itemDate(it){
  if(!it)return null;
  if(it.type==="memory")return it.date||null;
  if(it.type==="supply")return it.lastBought||null;
  if(it.type==="routine")return it.doneDate||null;
  if(it.type==="toilet")return it.date||null;
  if(it.type==="bday")return null;
  return it.dueDate||null;
}
// ケア種別ごとの日付ラベル（表示のみ。保存先は常に dueDate のまま・データ構造は不変）。
// 健康系（ワクチン・投薬等）は「実施日」、受診系は「受診日」、それ以外は「期限」。
const careDateLabel=(k)=>tr(APP_LANG,({vaccine:"sched.dateDone",rabies:"sched.dateDone",filaria:"sched.dateDone",med:"sched.dateDone",trim:"sched.dateDone",groom:"sched.dateDone",daycare:"sched.dateDate",checkup:"sched.dateVisit",hospital:"sched.dateVisit",dental:"sched.dateVisit"}[k]||"sched.dateDue"));
// カレンダー区分（色・アイコン）。予定/ケア/ストック/思い出。
function calCategory(it){
  if(!it)return"event";
  if(it.type==="memory")return"memory";
  if(it.type==="supply")return"supply";
  if(it.type==="care")return"care";
  if(it.type==="routine")return"routine";
  return"event";
}
const WEEKDAYS_JA=["日","月","火","水","木","金","土"];
const MON_EN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtMonthDay=(s)=>{if(!s)return"";const[,m,d]=s.split("-").map(Number);return`${m}月${d}日`;};
const mmdd=(s)=>s?s.slice(5):""; // "MM-DD"
const dowOf=(iso)=>{if(!iso)return 0;const[y,m,d]=iso.split("-").map(Number);return new Date(y,m-1,d).getDay();};
// 写真は複数可。新形式は item.photos=[id...]、旧形式は photo:true（IDBキーは photo:<item.id>）。
const photoIdsOf=(it)=>it&&Array.isArray(it.photos)&&it.photos.length?it.photos:(it&&it.photo?[it.id]:[]);
const firstPhotoId=(it)=>{const a=photoIdsOf(it);return a.length?a[0]:null;};
// お世話ログ（やった履歴・前回からの経過）。対象（自分/ペット/家族）で出し分け
const CHORE_TPL_PET=[{title:"トイレ掃除",emoji:"🧹"},{title:"シャンプー",emoji:"🛁"},{title:"爪切り",emoji:"✂️"},{title:"ブラッシング",emoji:"🪮"},{title:"耳そうじ",emoji:"👂"},{title:"歯みがき",emoji:"🦷"},{title:"トイレ砂替え",emoji:"🐾"}];
// 人の候補は種別ごとに文脈へ合わせて出し分ける（あとから調整しやすいよう定数で保持）。
const CHORE_TPL_CHILD=[{title:"上履き洗い",emoji:"👟"},{title:"持ち物準備",emoji:"🎒"},{title:"体温チェック",emoji:"🌡️"},{title:"歯みがき仕上げ",emoji:"🦷"},{title:"髪カット",emoji:"💇"},{title:"爪切り",emoji:"✂️"}];
const CHORE_TPL_SENIOR=[{title:"服薬確認",emoji:"💊"},{title:"通院付き添い",emoji:"🏥"},{title:"体温チェック",emoji:"🌡️"},{title:"血圧チェック",emoji:"🩺"},{title:"シーツ交換",emoji:"🛏️"},{title:"爪切り",emoji:"✂️"}];
const CHORE_TPL_ADULT=[{title:"体調メモ",emoji:"📝"},{title:"服薬・サプリ",emoji:"💊"},{title:"シーツ交換",emoji:"🛏️"},{title:"爪切り",emoji:"✂️"},{title:"美容院",emoji:"💇"},{title:"体重チェック",emoji:"⚖️"}];
// 赤ちゃん：ぴよログ的な毎日のお世話。前回からの経過が出るので「前回の授乳から◯時間」等が把握できる。
const CHORE_TPL_BABY=[{title:"ミルク",emoji:"🍼"},{title:"母乳",emoji:"🤱"},{title:"おむつ替え",emoji:"🧷"},{title:"寝かしつけ",emoji:"😴"},{title:"検温",emoji:"🌡️"},{title:"沐浴",emoji:"🛁"},{title:"離乳食",emoji:"🍚"},{title:"つめ切り",emoji:"✂️"}];
const CHORE_TPL_ME=[{title:"掃除",emoji:"🧹"},{title:"洗濯",emoji:"🧺"},{title:"シーツ交換",emoji:"🛏️"},{title:"換気",emoji:"🪟"},{title:"水やり",emoji:"🪴"},{title:"ゴミ出し",emoji:"🗑️"}];
// 引数はメンバー(または null=自分)。人は personType(大人/子ども/高齢者)で候補を切替。
const choreTemplatesFor=(m)=>{
  if(!m)return CHORE_TPL_ME;
  if(m.kind==="pet")return CHORE_TPL_PET;
  if(m.kind==="person"){const pt=m.personType||"child";return pt==="senior"?CHORE_TPL_SENIOR:pt==="adult"?CHORE_TPL_ADULT:pt==="baby"?CHORE_TPL_BABY:CHORE_TPL_CHILD;}
  return CHORE_TPL_ME;
};

// フード・食事：種別・単位・食事の時間帯。犬・猫・その他ペット共通（種別依存を持ち込まない汎用設計）。
const FOOD_TYPES=[{k:"dry",l:"ドライ",ic:"utensils"},{k:"wet",l:"ウェット",ic:"droplet"},{k:"homemade",l:"手作り",ic:"utensils"},{k:"treat",l:"おやつ",ic:"cake"},{k:"supplement",l:"サプリ",ic:"pill"},{k:"other",l:"その他",ic:"utensils"}];
const FOOD_UNITS=[{k:"g",l:"g"},{k:"ml",l:"ml"},{k:"piece",l:"個"}];
const MEAL_SLOTS=[{k:"morning",l:"朝"},{k:"noon",l:"昼"},{k:"night",l:"夜"},{k:"treat",l:"おやつ"}];
const foodTypeMeta=(k)=>FOOD_TYPES.find(t=>t.k===k)||FOOD_TYPES[FOOD_TYPES.length-1];
const foodUnitLabel=(k)=>({serving:"回",g:"g",ml:"ml",grain:"粒",piece:"個"}[k]||k||"");
const mealSlotLabel=(k)=>(MEAL_SLOTS.find(s=>s.k===k)||{}).l||"";
// 摂取カロリー：kcalが登録されている場合のみ計算。per100はg/mlのみ、perUnitは個で計算。
// 手作り・おやつ等でkcal未登録なら無理に計算しない（null＝量だけ記録）。
function computeMealKcal(def,amount){
  if(!def)return null;const k=Number(def.kcal);if(def.kcal===""||def.kcal==null||isNaN(k)||k<=0)return null;
  const amt=Number(amount);if(!(amt>0))return null;
  if(def.kcalBasis==="perUnit")return Math.round(k*amt);
  if(def.unit==="g"||def.unit==="ml")return Math.round(k*amt/100);
  return null;
}
// 1日のフード量計算（犬・猫）。RER=70×理想体重^0.75、DER=RER×活動係数、フード量=DER÷ME×100。※参考値。
const LIFESTAGE={
  dog:[{k:"puppy_s",l:"子犬（〜4ヶ月）",f:3.0},{k:"puppy_l",l:"子犬（4ヶ月〜1歳）",f:2.0},{k:"adult_n",l:"成犬（避妊・去勢済み）",f:1.6},{k:"adult",l:"成犬（未避妊・未去勢）",f:1.8},{k:"senior",l:"高齢犬",f:1.4},{k:"diet",l:"減量が必要",f:1.0}],
  cat:[{k:"kitten",l:"子猫（成長期）",f:2.5},{k:"adult_n",l:"成猫（避妊・去勢済み）",f:1.2},{k:"adult",l:"成猫（未避妊・未去勢）",f:1.4},{k:"senior",l:"高齢猫",f:1.1},{k:"diet",l:"減量が必要",f:0.8}],
};
const bcsAdjust=(bcs)=>1+0.1*(bcs-5); // 補正値（BCS5=適正=1.0、1段階=約10%）
// BCS（ボディ・コンディション・スコア）9段階。適正は犬BCS4〜5・猫BCS5。犬・猫で説明を分ける。
const BCS_GUIDE={
  dog:[
    [1,"削痩","遠距離からでも肋骨・腰椎・骨盤などの隆起がはっきり見える。体脂肪が全く認められない。明らかな筋肉量低下。"],
    [2,"低体重","肋骨・腰椎・骨盤を容易に見ることができる。体脂肪が触知できない。筋肉量低下はごくわずか。"],
    [3,"やや低体重","肋骨は容易に触知でき体脂肪が触れない。腰椎上部が見え、骨盤が骨ばって見える。腰がはっきりくびれる。"],
    [4,"理想","わずかな体脂肪が肋骨を被い、肋骨は容易に触れる。上から見て腰のくびれが容易に認められ、腹部のへこみがはっきり見える。"],
    [5,"理想","肋骨を被う余分な脂肪はなく容易に触れる。上から見て肋骨の後ろに腰のくびれ、腹部が引き締まっている。"],
    [6,"やや過体重","肋骨はわずかな過剰脂肪に覆われるが触れる。上から見て腰のくびれはあまりはっきりしない。腹部のへこみははっきり。"],
    [7,"過体重","肋骨の触知は困難だが可能。かなりの脂肪。腰椎部・尾の付け根に脂肪沈着。腰のくびれはほとんど無い。"],
    [8,"肥満","過剰な脂肪で肋骨が触れない、または触知にかなりの力を要す。腰椎部・尾の付け根にかなりの脂肪沈着。腰のくびれ・腹部のへこみなし。"],
    [9,"重度肥満","胸部・脊椎・尾の付け根に大量の脂肪沈着。腰のくびれ・腹部のへこみなし。首と四肢にも脂肪沈着。腹部膨張が明らか。"],
  ],
  cat:[
    [1,"削痩","短毛種で肋骨が見える。体脂肪が触知できない。著しい腹部のへこみ。腰椎・腸骨がはっきり見え容易に触れる。"],
    [2,"低体重","短毛種で肋骨が容易に見える。筋肉量がごくわずかで腰椎がはっきり見える。腹部のへこみが顕著。体脂肪が触れない。"],
    [3,"やや低体重","ごく薄い体脂肪が肋骨を被い容易に触れる。腰椎がはっきり見える。肋骨の後ろに腰がはっきりくびれる。腹部の体脂肪はごくわずか。"],
    [4,"やや低体重","ごく薄い体脂肪が肋骨を被い触れる。肋骨の後ろに腰がくびれて見える。腹部のくびれはわずか。腹部の脂肪層がない。"],
    [5,"理想","均整が取れている。肋骨の後ろに腰のくびれ。肋骨はわずかに脂肪に覆われ触れる。腹部はごく薄い脂肪層に覆われる。"],
    [6,"やや過体重","肋骨はわずかに余分な脂肪に覆われるが触れる。ウエスト・腹部の脂肪層がそれほどはっきりでないが見える。腰のくびれはない。"],
    [7,"過体重","肋骨は中程度の脂肪に覆われ触知困難。腰のくびれはほとんどない。腹部は丸みを帯び中程度の脂肪に覆われる。"],
    [8,"肥満","肋骨は余分な脂肪に覆われ触れない。ウエストがない。腹部の丸みが明らかで脂肪層が目立つ。腰椎部に脂肪沈着。"],
    [9,"重度肥満","肋骨は厚い脂肪に覆われ触れない。腰椎部・顔・四肢にかなりの脂肪沈着。腹部が膨張し腰のくびれがない。"],
  ],
};
const bcsIdeal=(species,n)=>species==="cat"?(n===5):(n===4||n===5);
// ME（100gあたりkcal）の目安。市販の療法食リスト等から代表的なレンジ。実値は必ずパッケージで確認。
const ME_GUIDE={
  dog:[["総合栄養食 ドライ","約350〜420"],["ドライ（減量・満腹感タイプ）","約270〜340"],["ウェット（缶・パウチ）","約70〜170"],["リキッド","約100〜150"],["療法食","製品ごとに大きく異なる（要確認）"]],
  cat:[["総合栄養食 ドライ","約350〜430"],["ドライ（減量・体重ケア）","約290〜350"],["ウェット（缶・パウチ）","約60〜140"],["療法食","製品ごとに大きく異なる（要確認）"]],
};
function calcFoodAmount(species,bw,stageKey,bcs,me){
  const w=Number(bw),m=Number(me),bc=Number(bcs);
  if(!(w>0)||!(bc>=1&&bc<=9))return null;
  const ideal=w/bcsAdjust(bc);
  const stage=(LIFESTAGE[species]||LIFESTAGE.dog).find(s=>s.k===stageKey);
  const f=stage?stage.f:(species==="cat"?1.2:1.6);
  const der=70*Math.pow(ideal,0.75)*f;
  const res={ideal:Math.round(ideal*100)/100,der:Math.round(der),factor:f};
  if(m>0){const g=der/m*100;res.grams=Math.round(g);res.per2=Math.round(g/2);res.per3=Math.round(g/3);res.per4=Math.round(g/4);}
  return res;
}
// まとめて記録（多頭飼い向け）：選んだ子にワンタップで一括記録する日課
const BATCH_ACTIONS=[{title:"ご飯",emoji:"🍚"},{title:"お薬",emoji:"💊"},{title:"散歩",emoji:"🦮"},{title:"トイレ",emoji:"🚽"}];
// 前回実施日からの経過ラベル（前回いつ？をひと目で）
// 前回からの経過ラベル。warn 日以上で黄、alert 日以上で赤（しきい値は設定で変更可）。
function elapsedLabel(dateStr,warn=7,alert=14){
  if(!dateStr)return{txt:"まだ記録なし",tone:"none",kind:"none"};
  const d=daysUntil(dateStr);if(d==null)return{txt:"—",tone:"none",kind:"dash"};
  const ago=-d;
  const tone=ago<=0?"fresh":(ago>=alert?"over":(ago>=warn?"warn":"ok"));
  // 経過表記の統一ルール：当日→「今日」／7日未満→「◯日前」／
  // 7日以上〜1か月(30日)未満→「◯週間前」／1か月以上→「約◯か月前」。
  // Math.max(1,…) で「0か月前」「0週間前」などの0始まり表記を必ず防ぐ。
  // kind/n も返す（多言語で t() 側が数値から文言を組み立てるため。txt は日本語の既存表記）。
  let txt,kind,n;
  if(ago<=0){txt="今日";kind="today";}
  else if(ago<7){n=ago;txt=`${ago}日前`;kind="daysAgo";}
  else if(ago<30){n=Math.max(1,Math.floor(ago/7));txt=`${n}週間前`;kind="weeksAgo";}
  else {n=Math.max(1,Math.floor(ago/30));txt=`約${n}か月前`;kind="monthsAgo";}
  return{txt,tone,kind,n};
}
// からだの記録（体重・身長・体調）
const HEALTH_CONDS=[{key:"good",label:"元気",labelEn:"Good",labelZh:"良好",labelEs:"Bien",emoji:"😊"},{key:"ok",label:"ふつう",labelEn:"OK",labelZh:"一般",labelEs:"Normal",emoji:"😐"},{key:"bad",label:"元気ない",labelEn:"Unwell",labelZh:"没精神",labelEs:"Mal",emoji:"😟"}];
const condMeta=(k)=>HEALTH_CONDS.find(c=>c.key===k)||null;
// 登録ユーザーごとの色（色定義はここ1箇所）。フィルターチップ・カレンダーのドット・
// メンバーバー等はすべて colorOf() 経由でこの配列を参照する。登録順で自動割り当て、
// 設定でユーザーが個別に選ぶことも可能。
// 前半＝従来のやさしいアース系、後半＝追加したパステル・明るめカラー（既存の色は不変）。
const MEMBER_COLORS=["#E39A5C","#B23A48","#557E63","#D9A441","#5B7A9E","#C77A2E","#8A6D9E","#3E8E8E","#7A8B4F","#8A8178","#EBA0B7","#C7A8E9","#8FC1EA","#7FCFC4","#A9D48C","#F2C86E","#F0A882","#E29CC6","#9AA8E0","#6FB6A6","#D46A6A","#6A9FB5","#A67C52","#9E8ABF","#5FA871","#C98BB0","#7EA05A","#6C8CD5","#CE7BA0","#4FA88F"];
// 今日のようす（日記）の選択肢。元気は5段階（推移グラフ用に score を持つ。旧3段階キーも内包）
const DIARY_ENERGY=[{key:"great",label:"とても元気",labelEn:"Great",labelZh:"非常好",labelEs:"Genial",emoji:"😄",score:5},{key:"genki",label:"元気",labelEn:"Good",labelZh:"良好",labelEs:"Bien",emoji:"😊",score:4},{key:"normal",label:"ふつう",labelEn:"Normal",labelZh:"一般",labelEs:"Normal",emoji:"🙂",score:3},{key:"low",label:"低め",labelEn:"Low",labelZh:"偏低",labelEs:"Baja",emoji:"😕",score:2},{key:"bad",label:"ぐったり",labelEn:"Exhausted",labelZh:"无力",labelEs:"Agotado",emoji:"😣",score:1}];
const DIARY_APPETITE=[{key:"lots",label:"もりもり",labelEn:"Hearty",labelZh:"很好",labelEs:"Mucho",emoji:"🍽️",score:3},{key:"normal",label:"ふつう",labelEn:"Normal",labelZh:"一般",labelEs:"Normal",emoji:"🍚",score:2},{key:"little",label:"すくなめ",labelEn:"Little",labelZh:"偏少",labelEs:"Poco",emoji:"🥄",score:1}];
const DIARY_POOP=[{key:"good",label:"good",labelEn:"Good",labelZh:"良好",labelEs:"Bien",emoji:"💩"},{key:"loose",label:"ゆるい",labelEn:"Loose",labelZh:"偏软",labelEs:"Blanda",emoji:"💧"},{key:"none",label:"なし",labelEn:"None",labelZh:"没有",labelEs:"Nada",emoji:"🚫"}];
// トイレ記録（成功/失敗）。うんちは状態も残せる。
const POOP_COND=[{key:"normal",label:"普通",emoji:"💩"},{key:"soft",label:"軟便",emoji:"💧"},{key:"loose",label:"下痢",emoji:"🚨"}];
// うんちの硬さ：ブリストル便性状スケール（1=硬い〜7=水様、4が理想）。tone は色分け用。
const BRISTOL=[
  {n:1,label:"コロコロ",desc:"硬い木の実のような塊",tone:"hard"},
  {n:2,label:"かたい",desc:"ゴツゴツした固まり",tone:"hard"},
  {n:3,label:"ややかたい",desc:"表面にひび割れ",tone:"ok"},
  {n:4,label:"理想的",desc:"なめらかで柔らかい",tone:"good"},
  {n:5,label:"やわらかい",desc:"はっきりした境界の柔らかい塊",tone:"ok"},
  {n:6,label:"泥状",desc:"境界がくずれた泥状",tone:"soft"},
  {n:7,label:"水様",desc:"固形物のない水様",tone:"loose"},
];
const bristolMeta=(n)=>BRISTOL.find(b=>b.n===n)||null;
// うんちの硬さ 1〜7 の形イラスト（塗り。tone色で着色）。viewBox 0 0 24 24。
const POOP_SHAPE={
  1:'<circle cx="6" cy="13" r="2.6"/><circle cx="12" cy="10" r="2.6"/><circle cx="18" cy="13.5" r="2.6"/>',
  2:'<path d="M4 12c0-3 3.5-4 8-4s8 1 8 4-3.5 4-8 4-8-1-8-4z"/><circle cx="8" cy="10.5" r="1" fill="#fff"/><circle cx="15" cy="13" r="1" fill="#fff"/>',
  3:'<rect x="3" y="9.5" width="18" height="5.5" rx="2.7"/><path d="M9 9.8v5M14 9.8v5" stroke="#fff" stroke-width="1" fill="none"/>',
  4:'<rect x="3" y="9.8" width="18" height="4.6" rx="2.3"/>',
  5:'<circle cx="8" cy="12" r="4"/><circle cx="15" cy="12.5" r="4.4"/>',
  6:'<circle cx="6" cy="13.5" r="2.8"/><circle cx="11" cy="11" r="3.4"/><circle cx="16.5" cy="13.5" r="2.8"/>',
  7:'<ellipse cx="12" cy="14" rx="9" ry="2.8"/><ellipse cx="8" cy="12.5" rx="2" ry="1"/>',
};
const POOP_TONE_COLOR={hard:"#B98A5A",ok:"#A9803F",good:"#8A6A3E",soft:"#C89B5E",loose:"#CBA96A"};
// WMO 天気コード → 絵文字＋日本語。Open-Meteo の weather_code に対応。
function weatherCodeMeta(code){
  const m={0:["☀️","快晴"],1:["🌤","晴れ"],2:["⛅","一部くもり"],3:["☁️","くもり"],45:["🌫","霧"],48:["🌫","霧氷"],51:["🌦","霧雨"],53:["🌦","霧雨"],55:["🌦","強い霧雨"],56:["🌧","着氷性の霧雨"],57:["🌧","着氷性の霧雨"],61:["🌧","小雨"],63:["🌧","雨"],65:["🌧","強い雨"],66:["🌧","着氷性の雨"],67:["🌧","着氷性の雨"],71:["🌨","小雪"],73:["🌨","雪"],75:["🌨","大雪"],77:["🌨","霧雪"],80:["🌦","にわか雨"],81:["🌦","にわか雨"],82:["🌦","激しいにわか雨"],85:["🌨","にわか雪"],86:["🌨","にわか雪"],95:["⛈","雷雨"],96:["⛈","雹を伴う雷雨"],99:["⛈","雹を伴う雷雨"]};
  const e=m[code];return e?{emoji:e[0],label:e[1]}:{emoji:"🌡️",label:""};
}
// 気象庁（JMA）警報・注意報：府県予報区コード＋代表座標。緯度経度から最寄りを選ぶ（府県単位の概況）。
// 北海道・沖縄は地方ごとに分割。取得先: https://www.jma.go.jp/bosai/warning/data/warning/{code}.json
const JMA_AREAS=[
  ["011000","宗谷地方",45.42,141.67],["012000","上川・留萌地方",43.77,142.36],["013000","網走・北見・紋別地方",44.02,144.27],["014100","釧路・根室・十勝地方",42.98,144.38],["015000","胆振・日高地方",42.32,140.97],["016000","石狩・空知・後志地方",43.06,141.35],["017000","渡島・檜山地方",41.77,140.73],
  ["020000","青森県",40.82,140.74],["030000","岩手県",39.70,141.15],["040000","宮城県",38.27,140.87],["050000","秋田県",39.72,140.10],["060000","山形県",38.24,140.36],["070000","福島県",37.75,140.47],
  ["080000","茨城県",36.34,140.45],["090000","栃木県",36.57,139.88],["100000","群馬県",36.39,139.06],["110000","埼玉県",35.86,139.65],["120000","千葉県",35.61,140.12],["130000","東京都",35.69,139.69],["140000","神奈川県",35.45,139.64],
  ["150000","新潟県",37.90,139.02],["160000","富山県",36.70,137.21],["170000","石川県",36.59,136.63],["180000","福井県",36.07,136.22],["190000","山梨県",35.66,138.57],["200000","長野県",36.65,138.18],["210000","岐阜県",35.39,136.72],["220000","静岡県",34.98,138.38],["230000","愛知県",35.18,136.91],["240000","三重県",34.73,136.51],
  ["250000","滋賀県",35.00,135.87],["260000","京都府",35.02,135.76],["270000","大阪府",34.69,135.52],["280000","兵庫県",34.69,135.20],["290000","奈良県",34.69,135.83],["300000","和歌山県",34.23,135.17],
  ["310000","鳥取県",35.50,134.24],["320000","島根県",35.47,133.05],["330000","岡山県",34.66,133.93],["340000","広島県",34.40,132.46],["350000","山口県",34.19,131.47],
  ["360000","徳島県",34.07,134.56],["370000","香川県",34.34,134.04],["380000","愛媛県",33.84,132.77],["390000","高知県",33.56,133.53],
  ["400000","福岡県",33.61,130.42],["410000","佐賀県",33.25,130.30],["420000","長崎県",32.74,129.87],["430000","熊本県",32.79,130.74],["440000","大分県",33.24,131.61],["450000","宮崎県",31.91,131.42],["460100","鹿児島県",31.56,130.56],
  ["471000","沖縄本島地方",26.21,127.68],["473000","宮古島地方",24.80,125.28],["474000","八重山地方",24.34,124.16],
];
function nearestJmaArea(lat,lon){
  if(typeof lat!=="number"||typeof lon!=="number")return null;
  let best=null,bd=Infinity;
  for(const a of JMA_AREAS){const dLat=lat-a[2],dLon=(lon-a[3])*Math.cos(lat*Math.PI/180);const d=dLat*dLat+dLon*dLon;if(d<bd){bd=d;best=a;}}
  return best?{code:best[0],name:best[1]}:null;
}
// 気象警報・注意報の種類コード → 名称。level: 3=特別警報 / 2=警報 / 1=注意報。
const JMA_WARN={"02":["暴風雪警報",2],"03":["大雨警報",2],"04":["洪水警報",2],"05":["暴風警報",2],"06":["大雪警報",2],"07":["波浪警報",2],"08":["高潮警報",2],"10":["大雨注意報",1],"12":["大雪注意報",1],"13":["風雪注意報",1],"14":["雷注意報",1],"15":["強風注意報",1],"16":["波浪注意報",1],"17":["融雪注意報",1],"18":["洪水注意報",1],"19":["高潮注意報",1],"20":["濃霧注意報",1],"21":["乾燥注意報",1],"22":["なだれ注意報",1],"23":["低温注意報",1],"24":["霜注意報",1],"25":["着氷注意報",1],"26":["着雪注意報",1],"32":["暴風雪特別警報",3],"33":["大雨特別警報",3],"35":["暴風特別警報",3],"36":["大雪特別警報",3],"37":["波浪特別警報",3],"38":["高潮特別警報",3]};
// 警報JSONをパース：解除以外の有効な警報・注意報を種類ごとに1件へ集約（府県内のいずれかで発表）。
function parseJmaWarnings(j){
  const seen=new Map();
  (j&&j.areaTypes||[]).forEach(at=>(at.areas||[]).forEach(a=>(a.warnings||[]).forEach(w=>{
    if(!w||!w.code||w.status==="解除"||w.status==="発表警報・注意報はなし")return;
    const meta=JMA_WARN[w.code];if(!meta)return;
    if(!seen.has(w.code))seen.set(w.code,{code:w.code,name:meta[0],level:meta[1]});
  })));
  return[...seen.values()].sort((a,b)=>b.level-a.level);
}
// お散歩の目安：気温・湿度・体感・路面(地表)温度から、いま散歩に出てよいかを3段階で判定。
function walkAdvice(w){
  if(!w||w.error||typeof w.temp!=="number")return null;
  const t=w.temp,h=w.humidity,road=(typeof w.roadTemp==="number")?w.roadTemp:null,app=(typeof w.apparent==="number")?w.apparent:t;
  const code=w.code,precip=(typeof w.precip==="number")?w.precip:null,pop=(typeof w.pop==="number")?w.pop:null;
  if((road!=null&&road>=50)||app>=35||t>=35)
    return{level:"danger",emoji:"🚫",label:"いまは控えて",msg:"熱中症・肉球やけどの危険。朝夕の涼しい時間帯に。"};
  if([95,96,99].includes(code)||(precip!=null&&precip>=4))
    return{level:"danger",emoji:"⛈",label:"いまは控えて",msg:"雷雨・大雨のおそれ。落ち着いてからにしましょう。"};
  if((precip!=null&&precip>=0.3)||[61,63,65,66,67,80,81,82].includes(code))
    return{level:"warn",emoji:"🌧",label:"雨に注意",msg:"雨で足元がすべりやすく、体も冷えます。無理せず短めに・雨具を。"};
  if((road!=null&&road>=40)||app>=28||t>26||(typeof h==="number"&&h>=85))
    return{level:"warn",emoji:"⚠️",label:"注意して",msg:"地面が熱め。短めに・日陰を選び、水分を持って。"};
  if(t<=0||(road!=null&&road<=0))
    return{level:"warn",emoji:"❄️",label:"寒さ注意",msg:"路面凍結や冷えに注意。防寒して短めに。"};
  if((pop!=null&&pop>=70)||[51,53,55].includes(code))
    return{level:"warn",emoji:"🌧",label:"雨のおそれ",msg:"降り出しそうです。短時間で切り上げられるように。"};
  return{level:"ok",emoji:"🐾",label:"お散歩日和",msg:"いまは比較的お散歩に向いています。"};
}
// お散歩指数：気温・蒸し暑さ・路面・雨・寒さ・風・紫外線・乾燥から0〜100で採点。
// 各要因の減点（内訳）と主因も返す。
function walkIndex(w){
  if(!w||w.error||typeof w.temp!=="number")return null;
  const t=w.temp,code=w.code;
  const wind=(typeof w.wind==="number")?w.wind:null;
  const h=(typeof w.humidity==="number")?w.humidity:null;
  const road=(typeof w.roadTemp==="number")?w.roadTemp:null;
  const uv=(typeof w.uv==="number")?w.uv:null;
  const F=[];const add=(key,label,icon,pen)=>{if(pen>0)F.push({key,label,icon,penalty:Math.round(pen)});};
  // 暑さ（気温）
  let heat=0;if(t>=35)heat=85;else if(t>=30)heat=60;else if(t>=28)heat=42;else if(t>=26)heat=28;else if(t>=24)heat=14;
  add("heat","暑さ","sun",heat);
  // 寒さ（気温）
  let cold=0;if(t<0)cold=48;else if(t<3)cold=32;else if(t<7)cold=18;else if(t<11)cold=8;
  add("cold","寒さ","snow",cold);
  // 蒸し暑さ（気温高め＋多湿）
  let mug=0;if(h!=null&&t>=23){const over=Math.max(0,h-65);mug=Math.min(28,over*0.4+(t>=28?8:0));}
  add("mug","蒸し暑さ","thermometer",mug);
  // 路面の暑さ
  let rh=0;if(road!=null){if(road>=55)rh=40;else if(road>=50)rh=30;else if(road>=45)rh=20;else if(road>=40)rh=10;}
  add("road","路面の暑さ","paw",rh);
  // 雨・雪・雷・霧：天気コードに加え、実際の降水量と現在時間帯の降水確率も反映
  // （大雨警報級で降水確率が高い場合、今の天気コードが雨でなくても「日和」にしない）
  let wx=0,wxl="雨",wxi="cloudrain";
  if([51,53,55,56,57].includes(code)){wx=22;wxl="霧雨";}
  else if([61,63,65,66,67,80,81,82].includes(code)){wx=45;wxl="雨";}
  else if([71,73,75,77,85,86].includes(code)){wx=42;wxl="雪";wxi="snow";}
  else if([95,96,99].includes(code)){wx=70;wxl="雷雨";}
  else if([45,48].includes(code)){wx=14;wxl="霧";}
  const precip=(typeof w.precip==="number")?w.precip:null;
  const pop=(typeof w.pop==="number")?w.pop:null;
  if(precip!=null&&precip>0){const p=precip>=4?72:precip>=1?55:38;if(p>wx){wx=p;wxl=precip>=4?"強い雨":"雨";wxi="cloudrain";}} // 実際に降っている
  if(pop!=null){let p=0;if(pop>=90)p=60;else if(pop>=70)p=50;else if(pop>=60)p=42;else if(pop>=40)p=22;if(p>wx){wx=p;wxl=pop>=70?"雨のおそれ":"雨の可能性";wxi="cloudrain";}} // 降水確率
  add("wx",wxl,wxi,wx);
  // 風
  let vp=0;if(wind!=null){if(wind>=12)vp=52;else if(wind>=8)vp=32;else if(wind>=5)vp=16;else if(wind>=3.5)vp=6;}
  add("wind","風","wind",vp);
  // 紫外線
  let uvp=0;if(uv!=null){if(uv>=11)uvp=26;else if(uv>=8)uvp=18;else if(uv>=6)uvp=10;else if(uv>=3)uvp=4;}
  add("uv","紫外線","glasses",uvp);
  // 乾燥
  let dry=0;if(h!=null){if(h<20)dry=12;else if(h<30)dry=6;}
  add("dry","乾燥","droplet",dry);
  const total=F.reduce((a,f)=>a+f.penalty,0);
  const score=Math.max(0,Math.min(100,100-total));
  F.sort((a,b)=>b.penalty-a.penalty);
  const stars=score>=80?5:score>=60?4:score>=40?3:score>=20?2:1;
  const level=score>=60?"ok":score>=35?"warn":"danger";
  const label=score>=80?"お散歩日和":score>=60?"まずまず":score>=40?"ふつう":score>=20?"やや不向き":"お散歩は控えめに";
  return{score,stars,level,label,factors:F,main:F[0]||null};
}
// 1時間ぶんの散歩レベル判定（体感温度・降水・UV・雷を考慮。時間帯ごとに判定して時間軸で推奨を出す）。good/caution/avoid。
function walkHourLevel(hr){
  if(!hr)return"good";
  const t=typeof hr.app==="number"?hr.app:hr.temp;
  const pop=hr.pop,code=hr.code,uv=hr.uv;
  const thunder=[95,96,99].includes(code);
  const heavyRain=[65,67,75,82,86].includes(code)||(typeof pop==="number"&&pop>=80);
  if(typeof t==="number"){
    if(t>=31||thunder)return"avoid";           // 猛暑・雷
    if(t<=-3)return"avoid";                     // 厳しい寒さ
    if(t>=28)return"caution";                   // 暑い
    if(t<=1)return"caution";                    // 寒い
  }else if(thunder)return"avoid";
  if(heavyRain)return"avoid";
  if(typeof pop==="number"&&pop>=55)return"caution"; // 雨が降りやすい
  if(typeof uv==="number"&&uv>=8)return"caution";    // 紫外線が強い（日差しの強い時間帯）
  return"good";
}
// 今日の散歩タイム（時間別の色帯＋おすすめ時間帯）。hours=[{h,temp,app,pop,uv,code}]。
function walkTimeline(hours){
  if(!Array.isArray(hours)||hours.length===0)return null;
  const segs=hours.map(hr=>({h:hr.h,level:walkHourLevel(hr)}));
  const bestRun=(lvl)=>{let best=null,s=-1;for(let i=0;i<=segs.length;i++){const ok=i<segs.length&&segs[i].level===lvl;if(ok&&s<0)s=i;if(!ok&&s>=0){const run={from:segs[s].h,to:segs[i-1].h,len:i-s};if(!best||run.len>best.len)best=run;s=-1;}}return best;};
  const best=bestRun("good")||bestRun("caution");
  return{segs,best};
}
const diaryMeta=(group,k)=>group.find(c=>c.key===k)||null;
// 症状（お薬手帳・体調メモ用。複数選択可）
// 症状マスタ（キー→表示）。種別ごとの出し分けは DIARY_CONFIG で参照。sensitive はセンシティブ項目。
const SYMPTOMS={
  fever:{label:"熱",labelEn:"Fever",labelZh:"发烧",labelEs:"Fiebre",emoji:"🌡️"},cough:{label:"咳",labelEn:"Cough",labelZh:"咳嗽",labelEs:"Tos",emoji:"😮‍💨"},sneeze:{label:"くしゃみ",labelEn:"Sneeze",labelZh:"打喷嚏",labelEs:"Estornudos",emoji:"🤧"},nose:{label:"鼻水",labelEn:"Runny nose",labelZh:"流鼻涕",labelEs:"Mocos",emoji:"💧"},throat:{label:"喉の痛み",labelEn:"Sore throat",labelZh:"喉咙痛",labelEs:"Dolor de garganta",emoji:"😷"},headache:{label:"頭痛",labelEn:"Headache",labelZh:"头痛",labelEs:"Dolor de cabeza",emoji:"🤕"},fatigue:{label:"だるさ",labelEn:"Fatigue",labelZh:"乏力",labelEs:"Cansancio",emoji:"🥱"},diarrhea:{label:"下痢",labelEn:"Diarrhea",labelZh:"腹泻",labelEs:"Diarrea",emoji:"🚽"},vomit:{label:"嘔吐",labelEn:"Vomiting",labelZh:"呕吐",labelEs:"Vómitos",emoji:"🤮"},noappetite:{label:"食欲不振",labelEn:"No appetite",labelZh:"食欲不振",labelEs:"Sin apetito",emoji:"🥄"},itch:{label:"かゆがる",labelEn:"Itching",labelZh:"瘙痒",labelEs:"Picor",emoji:"🐾"},rash:{label:"発疹",labelEn:"Rash",labelZh:"皮疹",labelEs:"Sarpullido",emoji:"🔴"},mood:{label:"機嫌がわるい",labelEn:"Irritable",labelZh:"烦躁",labelEs:"Irritable",emoji:"😤"},period:{label:"生理",labelEn:"Period",labelZh:"生理期",labelEs:"Regla",emoji:"🩸",sensitive:true},limp:{label:"元気がない",labelEn:"Low energy",labelZh:"没精神",labelEs:"Decaído",emoji:"😣"}
};
const symptomMeta=(k)=>SYMPTOMS[k]||null;
// 症状キー → ラインアイコン名。データ(SYMPTOMS.emoji)は温存し、表示だけアイコン化する。
const SYM_ICON={fever:"thermometer",cough:"wind",sneeze:"wind",nose:"droplet",throat:"alert",headache:"alert",fatigue:"meh",diarrhea:"droplet",vomit:"alert",noappetite:"utensils",itch:"paw",rash:"alert",mood:"angry",period:"heart",limp:"frown"};
const symIcon=(k)=>SYM_ICON[k]||"alert";
// 食欲キー → ラインアイコン名。
const APPETITE_ICON={lots:"utensils",normal:"utensils",little:"meh",none:"ban"};
const appetiteIcon=(k)=>APPETITE_ICON[k]||"utensils";
// 種別 → 今日のようすの表示行・症状。ハードコードせずここで一元管理（将来項目を足しやすい）。
// rows: energy(元気) / appetite(食欲) / poop(うんち) / walk(さんぽ) / hospital(病院)
const DIARY_CONFIG={
  pet:{rows:["energy","appetite","poop","walk","hospital"],symptoms:["cough","sneeze","diarrhea","vomit","noappetite","itch"]},
  adult:{rows:["energy","appetite","sleep","hospital"],symptoms:["headache","fever","cough","nose","throat","fatigue","period"]},
  child:{rows:["energy","appetite","sleep","hospital"],symptoms:["fever","cough","nose","vomit","diarrhea","rash","mood"]},
  senior:{rows:["energy","appetite","sleep","hospital"],symptoms:["headache","fever","cough","fatigue","nose","throat"]},
  baby:{rows:["energy","appetite","poop","sleep","hospital"],symptoms:["fever","cough","nose","vomit","diarrhea","rash"]},
};
const diaryConfigFor=(t)=>DIARY_CONFIG[t]||DIARY_CONFIG.adult;
// 家族台帳（人）：性別・血液型の選択肢。
// 性別の文言は種別で出し分け（キーは boy/girl/other で共通・保存互換）。
const GENDER_OPTS_CHILD=[{k:"boy",l:"男の子"},{k:"girl",l:"女の子"},{k:"other",l:"その他"}];
const GENDER_OPTS_ADULT=[{k:"boy",l:"男性"},{k:"girl",l:"女性"},{k:"other",l:"その他"}];
const genderOptsFor=(personType)=>(personType==="child"||personType==="baby")?GENDER_OPTS_CHILD:GENDER_OPTS_ADULT;
const GENDER_OPTS=GENDER_OPTS_CHILD; // 後方互換（既存参照用）
const BLOOD_OPTS=["A","B","O","AB"];
const genderLabel=(k,personType)=>(genderOptsFor(personType).find(o=>o.k===k)||{}).l||"";
// 成長記録（育児日記）のカテゴリと、よく使うマイルストーンのひな型。
const MILESTONE_CATS=[
  {key:"first",label:"はじめて",icon:"sparkles"},
  {key:"word",label:"ことば",icon:"smile"},
  {key:"body",label:"からだ",icon:"activity"},
  {key:"can",label:"できた",icon:"check"},
  {key:"learn",label:"まなび",icon:"note"},
];
const milestoneCatMeta=(k)=>MILESTONE_CATS.find(c=>c.key===k)||MILESTONE_CATS[0];
// お手伝いポイントのひな型（タスク→ポイント）。
const HELP_PRESETS=[{task:"お皿はこび",pt:1},{task:"おふろそうじ",pt:2},{task:"くつをそろえる",pt:1},{task:"おもちゃのかたづけ",pt:1},{task:"ゴミすて",pt:1},{task:"せんたくたたみ",pt:2},{task:"食器あらい",pt:2},{task:"お手伝い",pt:1}];
// おこづかい帳の入出金の向き。
const ALLOWANCE_DIRS=[{k:"in",l:"もらった",sign:1},{k:"out",l:"つかった",sign:-1},{k:"save",l:"ちょきん",sign:0}];
// 家族ノート（メッセージ・感謝・きもち）の種別。
const NOTE_KINDS=[{k:"note",l:"今日のこと",icon:"note"},{k:"thanks",l:"ありがとう",icon:"heart"},{k:"mood",l:"きもち",icon:"smile"}];
const noteKindMeta=(k)=>NOTE_KINDS.find(o=>o.k===k)||NOTE_KINDS[0];
const MILESTONE_PRESETS={
  first:["初めて笑った","初めて寝返りした","初めてハイハイした","初めて立った","初めて歩いた","初めての言葉"],
  word:["ママと言えた","パパと言えた","二語文が出た","自分の名前が言えた"],
  body:["歯が生えた","トイレでできた","ひとりで着替えできた","くつが履けた","靴のサイズが変わった","服のサイズが変わった"],
  can:["スプーンで食べられた","自転車に乗れた","泳げた","ボタンがとめられた"],
  learn:["ひらがなが読めた","数を数えられた","自分の名前が書けた","時計が読めた"],
};
// 大切な情報カード（緊急連絡先・アレルギー/禁忌・病院メモなど）
const CARD_PRESETS=[{key:"emergency",label:"緊急連絡先",emoji:"🚨"},{key:"allergy",label:"アレルギー・禁忌",emoji:"⚠️"},{key:"hospital",label:"かかりつけ・病院メモ",emoji:"🏥"},{key:"shelter",label:"避難先・防災メモ",emoji:"🏫"},{key:"insurance",label:"保険証・保険情報",emoji:"🪪"},{key:"other",label:"メモ",emoji:"📝"}];
const cardMeta=(k)=>CARD_PRESETS.find(c=>c.key===k)||CARD_PRESETS[CARD_PRESETS.length-1];
// 大切な情報カードの種別 → ラインアイコン名。
const CARD_ICON={emergency:"alert",allergy:"alert",hospital:"activity",shelter:"home",insurance:"shield",other:"note"};
const cardIcon=(k)=>CARD_ICON[k]||"note";
// 思い出の「はじめて」タグ
const FIRST_TAG="はじめて";
// 支出カテゴリー（対象によって出し分け：ペットと人で項目が変わる）
const EXPENSE_CATS_PET=[{key:"hospital",label:"病院代",labelEn:"Vet bills",labelZh:"医疗费",labelEs:"Veterinario",emoji:"🏥",color:"#B23A48"},{key:"food",label:"ごはん・おやつ",labelEn:"Food & treats",labelZh:"食物与零食",labelEs:"Comida y premios",emoji:"🍚",color:"#C77A2E"},{key:"hygiene",label:"トイレ・衛生",labelEn:"Litter & hygiene",labelZh:"如厕与卫生",labelEs:"Higiene",emoji:"🧻",color:"#557E63"},{key:"grooming",label:"トリミング・美容",labelEn:"Grooming",labelZh:"美容",labelEs:"Peluquería",emoji:"✂️",color:"#B23A48"},{key:"goods",label:"おもちゃ・用品",labelEn:"Toys & supplies",labelZh:"玩具与用品",labelEs:"Juguetes y accesorios",emoji:"🧸",color:"#C77A2E"},{key:"insurance",label:"ペット保険",labelEn:"Pet insurance",labelZh:"宠物保险",labelEs:"Seguro de mascota",emoji:"🛡️",color:"#3B7BF6"},{key:"other",label:"その他",labelEn:"Other",labelZh:"其他",labelEs:"Otro",emoji:"📦",color:"#8A8178"}];
const EXPENSE_CATS_PERSON=[{key:"medical",label:"医療費",labelEn:"Medical",labelZh:"医疗费",labelEs:"Médico",emoji:"🏥",color:"#B23A48"},{key:"food",label:"食費",labelEn:"Food",labelZh:"伙食费",labelEs:"Comida",emoji:"🍚",color:"#C77A2E"},{key:"education",label:"学費・習い事",labelEn:"Education & lessons",labelZh:"教育与兴趣班",labelEs:"Educación y clases",emoji:"🎒",color:"#3B7BF6"},{key:"clothing",label:"衣類",labelEn:"Clothing",labelZh:"服装",labelEs:"Ropa",emoji:"👕",color:"#B23A48"},{key:"daily",label:"日用品",labelEn:"Daily goods",labelZh:"日用品",labelEs:"Artículos diarios",emoji:"🧴",color:"#557E63"},{key:"transport",label:"交通費",labelEn:"Transport",labelZh:"交通费",labelEs:"Transporte",emoji:"🚃",color:"#557E63"},{key:"leisure",label:"レジャー・娯楽",labelEn:"Leisure",labelZh:"休闲娱乐",labelEs:"Ocio",emoji:"🎟️",color:"#C77A2E"},{key:"other",label:"その他",labelEn:"Other",labelZh:"其他",labelEs:"Otro",emoji:"📦",color:"#8A8178"}];
const expenseCatsFor=(kind)=>kind==="pet"?EXPENSE_CATS_PET:EXPENSE_CATS_PERSON;
const ALL_EXPENSE_CATS=[...EXPENSE_CATS_PET,...EXPENSE_CATS_PERSON.filter(p=>!EXPENSE_CATS_PET.some(q=>q.key===p.key))];
const expCatMeta=(k)=>ALL_EXPENSE_CATS.find(c=>c.key===k)||ALL_EXPENSE_CATS[ALL_EXPENSE_CATS.length-1];
// 支出カテゴリの表示ラベル（ロケール対応。日本語は非破壊）。
const expCatLabel=(c)=>c?(APP_LANG==="ja"?c.label:APP_LANG==="zh"?(c.labelZh||c.labelEn||c.label):APP_LANG==="es"?(c.labelEs||c.labelEn||c.label):(c.labelEn||c.label)):"";
const fmtYen=(n)=>"¥"+Math.round(n||0).toLocaleString("ja-JP");

const EMOJI_RULES=[[["目","眼","メガネ","視力","コンタクト"],"👁️"],[["マラソン","ラン","走","ジョギング","駅伝"],"🏃"],[["ジム","筋トレ","トレーニング","クロスフィット","crossfit","筋"],"🏋️"],[["自転車","サイクリング","ロングライド","ライド","ロード"],"🚴"],[["泳","スイミング","プール","水泳"],"🏊"],[["ヨガ","ストレッチ","瞑想"],"🧘"],[["ピアノ","ジャズ","鍵盤","セッション"],"🎹"],[["ギター","楽器","音楽","バンド"],"🎸"],[["ライブ","コンサート","歌","カラオケ"],"🎤"],[["映画","シネマ"],"🎬"],[["本","読書","読む"],"📚"],[["試験","資格","勉強","検定","TOEIC","G検定","学習"],"🎓"],[["面接","転職","仕事","キャリア","案件","副業"],"💼"],[["会議","打ち合わせ","打合せ","MTG","ミーティング","商談"],"📊"],[["飲み","飲み会","会食","宴会","パーティ","ランチ会","歓迎会","送別会","二次会"],"🍻"],[["旅","旅行","海外","訪ね","観光","ステイ"],"✈️"],[["海","ビーチ","南国"],"🏖️"],[["山","登山","富士","ハイキング","トレッキング"],"⛰️"],[["語","スペイン語","英語","中国語","会話"],"🗣️"],[["写真","カメラ","撮"],"📷"],[["料理","ごはん","ご飯","レストラン","食","クッキング"],"🍳"],[["コーヒー","カフェ","珈琲"],"☕"],[["貯金","お金","投資","iDeCo","ふるさと納税","資産","NISA"],"💰"],[["病院","通院","受診","健診","健康診断","診察"],"🏥"],[["ワクチン","予防接種","注射","接種"],"💉"],[["フィラリア","蚊","ノミ","ダニ"],"🦟"],[["狂犬病"],"🐕"],[["歯","歯科","デンタル"],"🦷"],[["美容","トリミング","カット","ヘア","サロン"],"✂️"],[["散歩","お散歩","ウォーキング"],"🦮"],[["習い事","レッスン","塾","スクール"],"🎒"],[["誕生","記念","バースデー"],"🎂"],[["結婚","プロポーズ","婚"],"💍"],[["掃除","片付","そうじ"],"🧹"],[["引っ越","引越","移住"],"📦"],[["占い","星","運勢"],"✨"]];
const PICKER_EMOJIS=["✨","🌈","💪","🏃","🚴","🏋️","🧘","🎹","🎸","🎤","🎬","📚","🎓","💼","✈️","🏖️","⛰️","📷","🍳","☕","💰","🏥","💉","🦷","✂️","🦮","🐶","🐱","🎂","💍","🧸","🧹","📦","🗣️","👁️","🦟","❤️","⭐","🎯","🌷"];
function guessEmoji(title,fallback){const t=(title||"").toLowerCase();for(const[keys,emo]of EMOJI_RULES){if(keys.some(k=>t.includes(k.toLowerCase())))return emo;}return fallback;}
// タイトル文字列 → ラインアイコン名。お世話ログ・ストック・ルーティン等の自由入力項目を
// 絵文字に頼らずアイコン表示するための推定表（データは温存、表示のみ）。
// ルール：「アイコン＝その行動・ケアの内容」。足跡(paw)はペット固有の散歩だけに使い、
// 検温・寝かしつけなど人にも共通するケアは、対象（犬/子ども/自分）に関わらず同じ行動アイコンに統一する。
const ICON_RULES=[
  [["散歩","おさんぽ","お散歩","ウォーキング","さんぽ"],"paw"],
  [["ごはん","ご飯","フード","餌","えさ","おやつ","食事","ミルク","ふりかけ","母乳","授乳","離乳"],"utensils"],
  [["水分","水","お水","飲水","給水"],"droplet"],
  [["トイレ","うんち","おしっこ"],"droplet"],
  [["掃除","そうじ","片付","かたづけ","ゴミ","ごみ"],"sparkles"],
  [["洗濯","洗剤","せんたく"],"droplet"],
  [["シャンプー","お風呂","風呂","入浴","バス","沐浴"],"droplet"],
  [["検温","体温","平熱","発熱"],"thermometer"],
  [["体重"],"scale"],
  [["血圧","体調","調子","バイタル","脈拍","心拍"],"activity"],
  [["ブラッシング","ブラシ","毛づくろい","コーミング","お手入れ","手入れ"],"sparkles"],
  [["爪","つめ","カット","トリミング","美容","サロン","ヘア","髪"],"scissors"],
  [["歯","はみがき","歯みがき","歯磨き","デンタル"],"tooth"],
  [["耳","目薬","点眼"],"droplet"],
  [["薬","くすり","サプリ","投薬","服薬"],"pill"],
  [["ワクチン","予防接種","注射","接種"],"syringe"],
  [["フィラリア","蚊","ノミ","ダニ","駆虫"],"bug"],
  [["病院","通院","受診","健診","健康診断","診察","動物病院"],"stethoscope"],
  [["換気","窓"],"wind"],
  [["ストレッチ","ヨガ","瞑想","運動","ジム","筋トレ","ラン","走","散歩以外"],"activity"],
  [["コーヒー","カフェ","珈琲","お茶","ティー"],"coffee"],
  [["夜","寝る","就寝","睡眠","おやすみ","ねんね","寝かし","昼寝","お昼寝"],"moon"],
  [["朝","起床","起きる"],"sun"],
  [["習い事","レッスン","塾","スクール","保育園","幼稚園","学校","授業","宿題","勉強","持ち物","上履き","上ばき","支度"],"bag"],
  [["写真","カメラ","撮影"],"camera"],
  [["お金","貯金","支出","費用","会計"],"wallet"],
  [["フード在庫","ストック","シーツ","おむつ","ティッシュ","詰め替え","買い"],"package"],
  [["コンタクト","眼鏡","メガネ","視力"],"glasses"],
  [["予定","イベント","記念","誕生"],"calendar"],
];
// 未マッチ時は動物を連想させない中立アイコン（sparkles）を既定に。散歩など paw が必要な項目はルールで明示。
function guessIcon(title,fallback="sparkles"){const t=(title||"").toLowerCase();for(const[keys,ic]of ICON_RULES){if(keys.some(k=>t.includes(k.toLowerCase())))return ic;}return fallback;}

// Google Analytics 4：本番のみ計測。gtag未定義（＝開発環境）では無害なno-op。GA4推奨のsnake_caseイベント名を使う。
function track(name,params){try{if(typeof window!=="undefined"&&typeof window.gtag==="function")window.gtag("event",name,params||{});}catch(e){}}

const storage={get:k=>Promise.resolve().then(()=>{const v=localStorage.getItem(k);return v!=null?{value:v}:null;}),set:(k,v)=>Promise.resolve().then(()=>localStorage.setItem(k,v)),delete:k=>Promise.resolve().then(()=>localStorage.removeItem(k))};

// ---------------------------------------------------------------------------
// 写真ストレージ（IndexedDB）。
// 写真は容量が大きく localStorage(約5MB) を圧迫し、コアデータの保存失敗＝消失を招く。
// そこで写真だけ大容量の IndexedDB に保存する。IDB が使えない環境は localStorage に自動フォールバック。
// get は生の文字列(dataURL)または null を返す。
// ---------------------------------------------------------------------------
const IDB_AVAILABLE = typeof indexedDB !== "undefined";
const PHOTO_DB = "loalife-photos", PHOTO_STORE = "photos";
function idbOpen(){
  return new Promise((resolve,reject)=>{
    try{
      const req=indexedDB.open(PHOTO_DB,1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(PHOTO_STORE))db.createObjectStore(PHOTO_STORE);};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    }catch(e){reject(e);}
  });
}
function idbReq(mode,fn){
  return idbOpen().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(PHOTO_STORE,mode);
    const rq=fn(tx.objectStore(PHOTO_STORE));
    tx.oncomplete=()=>resolve(rq&&rq.result);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error);
  }));
}
const photoStorage={
  async get(k){
    if(IDB_AVAILABLE){try{const v=await idbReq("readonly",s=>s.get(k));if(v!=null)return v;}catch(e){}}
    try{return localStorage.getItem(k);}catch(e){return null;} // 旧データ・フォールバック
  },
  async set(k,v){
    if(IDB_AVAILABLE){try{await idbReq("readwrite",s=>s.put(v,k));return true;}catch(e){}}
    try{localStorage.setItem(k,v);return true;}catch(e){return false;}
  },
  async delete(k){
    if(IDB_AVAILABLE){try{await idbReq("readwrite",s=>s.delete(k));}catch(e){}}
    try{localStorage.removeItem(k);}catch(e){}
  },
};
// 既存の localStorage 内の写真を IndexedDB へ移行（コピー成功後に localStorage 側を削除して枠を解放）。
// 非破壊：IDB へ確実に入ったことを確認してからのみ localStorage を消す。
async function migratePhotosToIDB(){
  if(!IDB_AVAILABLE)return;
  try{
    const keys=[];
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.indexOf("photo:")===0)keys.push(k);}
    for(const k of keys){
      const val=localStorage.getItem(k);if(val==null)continue;
      try{
        const existing=await idbReq("readonly",s=>s.get(k));
        if(existing==null)await idbReq("readwrite",s=>s.put(val,k));
        const check=await idbReq("readonly",s=>s.get(k));
        if(check!=null)localStorage.removeItem(k); // IDB に入ったのを確認してから解放
      }catch(e){/* この1枚はそのまま localStorage に残す（消さない） */}
    }
  }catch(e){}
}

// 体験用のサンプルデータ。個人情報を含まない一般的な内容にし、
// 今日やること/安心ステータス/爆弾/消耗品の各機能が一通り見えるようにしている。
function makeSeed(){
  let c=Date.now();const next=()=>--c;
  const me=[
    {emoji:"🏥",type:"event",title:"健康診断",dueDate:plusDays(6)},
    {emoji:"💪",type:"habit",title:"運動する",dueDate:plusDays(2),repeat:"weekly"},
    {emoji:"🦷",type:"event",title:"歯のクリーニング",dueDate:plusDays(14)},
    {emoji:"✈️",type:"dream",title:"行きたい場所へ旅行する"},
    {emoji:"📚",type:"dream",title:"資格の勉強を続ける"},
  ].map((it,i)=>({id:"m"+i,space:"me",repeat:"none",done:false,createdAt:next(),...it}));
  const pet=[
    {emoji:"💉",title:"混合ワクチン",careKind:"vaccine",repeat:"yearly",dueDate:plusDays(30)},
    {emoji:"🐕",title:"狂犬病ワクチン",careKind:"rabies",repeat:"yearly",dueDate:plusDays(-5)},
    {emoji:"🦟",title:"フィラリア予防薬",careKind:"filaria",repeat:"monthly",dueDate:plusDays(4)},
  ].map((it,i)=>({id:"p"+i,space:"pet1",type:"care",done:false,createdAt:next(),...it}));
  const petSupply=[
    {id:"ps0",space:"pet1",type:"supply",title:"フード",emoji:"🍚",cycleDays:30,lastBought:plusDays(-27),createdAt:next()},
    {id:"ps1",space:"pet1",type:"supply",title:"トイレシーツ",emoji:"🧻",cycleDays:30,lastBought:plusDays(-10),createdAt:next()},
  ];
  const petRoutine=[
    {id:"pr0",space:"pet1",type:"routine",title:"散歩",emoji:"🦮",time:"07:00",reminders:[0],repeat:"daily",doneDate:null,createdAt:next()},
    {id:"pr1",space:"pet1",type:"routine",title:"ごはん",emoji:"🍚",time:"08:00",reminders:[0],repeat:"daily",doneDate:null,createdAt:next()},
  ];
  const kid=[
    {emoji:"🎒",title:"習い事",careKind:"lesson",repeat:"weekly",dueDate:plusDays(3),time:"16:00"},
    {emoji:"🏫",title:"授業参観",careKind:"school",dueDate:plusDays(9)},
  ].map((it,i)=>({id:"k"+i,space:"kid1",type:"care",done:false,createdAt:next(),...it}));
  return{
    members:[
      {id:"pet1",name:"ぽち",emoji:"🐶",kind:"pet",species:"dog",birthday:"",visibility:"household"},
      {id:"kid1",name:"ゆい",emoji:"👧",kind:"person",birthday:"",visibility:"household"},
    ],
    items:[...me,...pet,...petSupply,...petRoutine,...kid],
  };
}

function dueStatus(item){if(!item.dueDate)return null;if(item.done)return{label:"完了",tone:"doneChip"};const d=daysUntil(item.dueDate);if(d>3)return{label:fmtDate(item.dueDate),tone:"normal"};if(d>0)return{label:`あと${d}日`,tone:"soon"};if(d===0)return{label:"今日",tone:"today"};if(item.type==="dream")return{label:"また今度でも大丈夫",tone:"gentleOver"};if(isCyclic(item))return{label:"期限切れ",tone:"careOver"};return{label:fmtDate(item.dueDate),tone:"normal"};}
// ケアの3状態：未対応(赤)／予定済み(黄)／完了(緑)。打ち消し線＋期限切れの読めない状態を1目で。
function careState(item){
  if(item.done)return{label:"✅ 完了",tone:"done"};
  const renew=isRenewCare(item);
  if(isOverdue(item)){const d=-daysUntil(item.dueDate);return{label:renew?`🔴 期限切れ・${d}日超過`:`🔴 未対応・${d}日超過`,tone:"todo"};}
  if(item.dueDate){const d=daysUntil(item.dueDate);
    if(d<0)return{label:`予定日 ${fmtDate(item.dueDate)}`,tone:"planned"};
    if(renew){
      if(d===0)return{label:"🟡 今日で期限",tone:"planned"};
      if(d<=30)return{label:`🟡 あと${d}日で期限`,tone:"planned"};
      return{label:`🟢 有効・あと${d}日`,tone:"doneChip"};
    }
    return{label:d===0?"🟡 今日やる":`🟡 予定・あと${d}日`,tone:"planned"};
  }
  return{label:"🟡 予定済み",tone:"planned"};
}
// 更新型ケア（狂犬病・ワクチン等）の有効期限までの残り。証明書セルなどの小さな表示用。
function renewLeft(item){
  if(!isRenewCare(item)||!item.dueDate)return null;
  const d=daysUntil(item.dueDate);if(d==null)return null;
  if(d<0)return{txt:tr(APP_LANG,"renew.expired",{n:-d}),tone:"over"};
  if(d===0)return{txt:tr(APP_LANG,"renew.today"),tone:"soon"};
  if(d<=30)return{txt:tr(APP_LANG,"renew.left",{n:d}),tone:"soon"};
  return{txt:tr(APP_LANG,"renew.left",{n:d}),tone:"ok"};
}

function daysUntilBirthday(birthday) {
  if (!birthday) return null;
  const [,bm,bd] = birthday.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), bm - 1, bd);
  if (next < today) next.setFullYear(next.getFullYear() + 1);
  return Math.round((next - today) / 86400000);
}
// 記念日（誕生日・うちの子記念日）までの日数。daysUntilBirthday と同じ計算。
const daysUntilAnniv = daysUntilBirthday;
// その日付から今回の記念日で何年目になるか（年が分かる場合のみ。不明なら null）
function yearsSinceAnniv(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || y < 1900) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let years = today.getFullYear() - y;
  // 今年の記念日がまだ来ていなければ、次に迎えるのは years 年目
  const thisYear = new Date(today.getFullYear(), m - 1, d);
  if (thisYear < today) years += 1; // 既に過ぎた→次回は+1年
  return years;
}
// 満年齢／経過周年（西暦がある場合のみ。年不明＝"0000"や未入力は null）
function ageNow(dateStr){
  if(!dateStr)return null;
  const[y,m,d]=dateStr.split("-").map(Number);
  if(!y||y<1900)return null;
  const now=new Date();
  let a=now.getFullYear()-y;
  const passed=(now.getMonth()+1>m)||(now.getMonth()+1===m&&now.getDate()>=d);
  if(!passed)a-=1;
  return a<0?null:a;
}
// お迎えから今日までの日数（西暦がある場合のみ）。何日一緒に過ごしたか。
function daysTogether(dateStr,endStr){
  if(!dateStr)return null;
  const[y,m,d]=dateStr.split("-").map(Number);
  if(!y||y<1900)return null;
  const start=new Date(y,m-1,d);
  let end;
  if(endStr){const[ey,em,ed]=endStr.split("-").map(Number);if(ey&&ey>=1900)end=new Date(ey,em-1,ed);}
  if(!end){const now=new Date();end=new Date(now.getFullYear(),now.getMonth(),now.getDate());}
  const days=Math.floor((end-start)/86400000);
  return days>=0?days:null;
}
// 生後の月齢（西暦がある場合のみ）。子犬・子猫の成長を月単位で。
function monthsOld(dateStr){
  if(!dateStr)return null;
  const[y,m,d]=dateStr.split("-").map(Number);
  if(!y||y<1900)return null;
  const now=new Date();
  let months=(now.getFullYear()-y)*12+(now.getMonth()+1-m);
  if(now.getDate()<d)months-=1;
  return months<0?null:months;
}
// 年齢の表示ラベル：1歳未満は月齢、2歳未満は「X歳Yヶ月」、以降は「X歳」。西暦なしは空。
function ageLabel(dateStr){
  const m=monthsOld(dateStr);if(m==null)return"";
  if(m<12)return`${m}ヶ月`;
  const yrs=Math.floor(m/12),rem=m%12;
  if(yrs<2)return rem>0?`${yrs}歳${rem}ヶ月`:`${yrs}歳`;
  return`${yrs}歳`;
}

// ある日付時点の年齢ラベル（成長記録で「その時何歳だったか」を表示）。
function ageAtLabel(birthStr,atStr){
  if(!birthStr||!atStr)return"";
  const[by,bm,bd]=birthStr.split("-").map(Number);
  const[ay,am,ad]=atStr.split("-").map(Number);
  if(!by||by<1900||!ay)return"";
  let months=(ay-by)*12+(am-bm);if(ad<bd)months-=1;
  if(months<0)return"";
  if(months<12)return`${months}ヶ月`;
  const yrs=Math.floor(months/12),rem=months%12;
  if(yrs<3)return rem>0?`${yrs}歳${rem}ヶ月`:`${yrs}歳`;
  return`${yrs}歳`;
}

function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// --- Calendar helpers ---
function gcalLink(item, memberName, memberEmoji) {
  const title = encodeURIComponent(`${item.emoji||""} ${item.title} [${memberEmoji}${memberName}]`);
  const [y,m,d]=item.dueDate.split("-").map(Number);
  let dates;
  if(item.time){
    const [h,mn]=item.time.split(":").map(Number);
    const fmt=(dt)=>`${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,"0")}${String(dt.getDate()).padStart(2,"0")}T${String(dt.getHours()).padStart(2,"0")}${String(dt.getMinutes()).padStart(2,"0")}00`;
    const st=new Date(y,m-1,d,h,mn);const en=new Date(st.getTime()+3600000);
    dates=`${fmt(st)}/${fmt(en)}`;
  }else{
    const s=`${y}${String(m).padStart(2,"0")}${String(d).padStart(2,"0")}`;
    const nd=new Date(y,m-1,d+1);
    const e=`${nd.getFullYear()}${String(nd.getMonth()+1).padStart(2,"0")}${String(nd.getDate()).padStart(2,"0")}`;
    dates=`${s}/${e}`;
  }
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}`;
}

function generateIcal(items, members, meEmoji, meName) {
  const nameOf=(sid)=>sid==="me"?(meName||"わたし"):(members.find(m=>m.id===sid)?.name||"");
  const emojiOf=(sid)=>sid==="me"?meEmoji:(members.find(m=>m.id===sid)?.emoji||"");
  const now=new Date();
  const stamp=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}T${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}00Z`;
  const esc=(s)=>String(s==null?"":s).replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//LOALIFE//Family//JA","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:LOALIFE家族カレンダー"];
  items.filter(it=>it.dueDate&&!it.done).forEach(item=>{
    const [y,m,d]=item.dueDate.split("-").map(Number);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:loalife-${item.id}@loalife`);
    lines.push(`SUMMARY:${esc(`${item.emoji||""} ${item.title} [${emojiOf(item.space)}${nameOf(item.space)}]`)}`);
    lines.push(`DTSTAMP:${stamp}`);
    if(item.time){
      const [h,mn]=item.time.split(":").map(Number);
      const fmt=(dt)=>`${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,"0")}${String(dt.getDate()).padStart(2,"0")}T${String(dt.getHours()).padStart(2,"0")}${String(dt.getMinutes()).padStart(2,"0")}00`;
      const st=new Date(y,m-1,d,h,mn);const en=new Date(st.getTime()+3600000);
      lines.push(`DTSTART;TZID=Asia/Tokyo:${fmt(st)}`);
      lines.push(`DTEND;TZID=Asia/Tokyo:${fmt(en)}`);
    }else{
      const s=`${y}${String(m).padStart(2,"0")}${String(d).padStart(2,"0")}`;
      const nd=new Date(y,m-1,d+1);
      const e=`${nd.getFullYear()}${String(nd.getMonth()+1).padStart(2,"0")}${String(nd.getDate()).padStart(2,"0")}`;
      lines.push(`DTSTART;VALUE=DATE:${s}`);lines.push(`DTEND;VALUE=DATE:${e}`);
    }
    if(item.repeat&&item.repeat!=="none"){
      const rmap={daily:"DAILY",weekly:"WEEKLY",monthly:"MONTHLY",yearly:"YEARLY"};
      lines.push(`RRULE:FREQ=${rmap[item.repeat]||"WEEKLY"}`);
    }
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadIcal(content, filename="loalife-calendar.ics"){
  // Blob ダウンロードに統一。以前の iOS 用 form POST(target=_blank) は
  // PWAスタンドアロンで空白タブ（白い画面）になり進めなくなるため廃止。
  try{
    const blob=new Blob([content],{type:"text/calendar;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=filename;a.rel="noopener";
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }catch(e){
    // 最終フォールバック：同一タブでデータURLを開く（白い別タブは作らない）
    try{window.location.href="data:text/calendar;charset=utf-8,"+encodeURIComponent(content);}catch(_){}
  }
}

// テキストファイル（CSV等）のダウンロード。Excel が日本語を化けさせないよう BOM 付き。
function downloadTextFile(content, filename, mime="text/csv"){
  try{
    const blob=new Blob(["﻿"+content],{type:mime+";charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=filename;a.rel="noopener";
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  }catch(e){
    try{window.location.href="data:"+mime+";charset=utf-8,"+encodeURIComponent(content);}catch(_){}
  }
}
// DOMノードをPNG画像化して保存/共有（シート・カード・ポスターの「画像で保存」用）。
// ・.yl-noprint（ボタン等）は写さない ・常にライト配色で書き出す。
// ・iPhone等は共有シート（navigator.share）でアルバム保存・LINE送信できるように。
//   非対応環境（PC等）はファイルダウンロードにフォールバック。
// 返り値: "shared" | "download" | "aborted"
// 元canvasを指定サイズの枠に中央配置（SNSのストーリー等、決まった縦横比に整える用）。
function frameCanvas(src, W, H, bg){
  const c=document.createElement("canvas");c.width=W;c.height=H;
  const ctx=c.getContext("2d");ctx.fillStyle=bg||"#ffffff";ctx.fillRect(0,0,W,H);
  const pad=Math.round(W*0.045);
  const s=Math.min((W-pad*2)/src.width,(H-pad*2)/src.height);
  const w=Math.round(src.width*s),h=Math.round(src.height*s);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  ctx.drawImage(src,Math.round((W-w)/2),Math.round((H-h)/2),w,h);
  return c;
}
async function nodeToImageBlob(node, opts={}){
  const sheet=!!opts.sheet; // シート系は2カラムの用紙風にして縦長・余白を抑える
  const story=!!opts.story; // 迷子ポスターはSNS/ストーリー向けに幅広2カラム＋9:16の枠に整える
  let canvas=await html2canvas(node,{
    backgroundColor:"#ffffff",
    scale:2,
    useCORS:true,
    logging:false,
    windowWidth:sheet?800:(story?960:undefined), // 420px超で2カラムグリッドが効く
    ignoreElements:(el)=>el.classList&&el.classList.contains("yl-noprint"),
    onclone:(docu)=>{try{
      docu.documentElement.setAttribute("data-theme","light");
      if(sheet){const t=docu.querySelector(".yl-vetsum");if(t){t.classList.add("yl-shot");const m=t.closest(".yl-modal");if(m){m.style.maxWidth="none";m.style.width="auto";m.style.padding="0";}}}
      if(story){const t=docu.querySelector(".yl-lost-poster")||docu.querySelector(".yl-lost");if(t){t.classList.add("yl-lost-story");const m=t.closest(".yl-modal");if(m){m.style.maxWidth="none";m.style.width="auto";m.style.padding="0";}}}
    }catch(e){}},
  });
  if(story)canvas=frameCanvas(canvas,1080,1920,"#ffffff"); // Instagramストーリー等の9:16に合わせる
  const blob=await new Promise((resolve)=>{if(canvas.toBlob)canvas.toBlob(resolve,"image/png");else{try{const durl=canvas.toDataURL("image/png");const bin=atob(durl.split(",")[1]);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);resolve(new Blob([arr],{type:"image/png"}));}catch(e){resolve(null);}}});
  if(!blob)throw new Error("no blob");
  return blob;
}
function downloadBlob(blob, filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=filename;a.rel="noopener";
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
async function saveNodeAsImage(node, filename, opts){
  const blob=await nodeToImageBlob(node,opts);
  // 共有シートが画像ファイルに対応していれば優先（iOS: 「画像を保存」でアルバムへ）。
  try{
    const file=new File([blob],filename,{type:"image/png"});
    if(navigator.canShare&&navigator.canShare({files:[file]})&&navigator.share){
      try{await navigator.share({files:[file]});return "shared";}
      catch(e){if(e&&e.name==="AbortError")return "aborted";/* 権限切れ等はDLへフォールバック */}
    }
  }catch(e){/* File未対応等はDLへ */}
  downloadBlob(blob,filename);
  return "download";
}
// CSV 1セルのエスケープ（カンマ・改行・引用符を含む場合は "" で囲む）。
const csvCell=(v)=>{const s=v==null?"":String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};

// ───────── 多言語化の基盤（英語パイロット。ja=ソース言語＝フォールバック / en=英語） ─────────
// 方針：未翻訳キーは ja にフォールバックし、ja も無ければキー文字列を返す。UIテキストのみ対象で、
// ユーザーの登録データ（名前・誕生日・体重など）は翻訳しない。ES・简体中文は同じ辞書にlanguage追加で拡張。
const LOCALES={ja:"ja-JP",en:"en-US",es:"es-ES",zh:"zh-CN"};
// モジュールレベルのコンポーネント（BdayInput等、Appの t にアクセスできない箇所）用の現在言語。
// App の lang 変更 effect で更新し、再レンダー時に参照する。
let APP_LANG="ja";
const MESSAGES={
  ja:{
    "nav.home":"ホーム","nav.calendar":"カレンダー","nav.settings":"設定","title.daily":"毎日",
    "seg.daily":"毎日","seg.manage":"管理",
    "home.family":"家族のようす","home.okNoRecord":"まだ記録がありません","home.okPet":"{name}は順調です","home.okGeneric":"順調です",
    "level.ok":"順調","level.warn":"注意","level.alert":"要対応","level.none":"記録なし","level.memorial":"追悼",
    "home.layerToday":"今日","home.calmTitle":"今日は安心です","home.calmNone":"ゆっくり過ごせる一日を",
    "home.calmOnePet":"{emoji} {name}は穏やかです","home.calmOne":"{emoji} {name}も穏やかです","home.calmAll":"{emojis} みんな穏やかです",
    "home.todayTodos":"今日やること","home.export":"出力","home.moreCount":"ほかに {n} 件",
    "home.dontMiss":"見逃せないこと","home.upcoming":"直近の予定","home.quickCond":"今日のみんなの調子は？","home.quickCondBtn":"今日も元気",
    "home.restock":"そろそろ買い足し","home.recap":"小さなふりかえり","home.statWeekCare":"今週やったケア","home.statTodayRoutine":"今日のルーティン",
    "rel.today":"今日","rel.overdue":"やり残し","rel.tomorrow":"明日","rel.inDays":"あと{d}日","rel.dueInDays":"あと{d}日で期限","rel.overdueBy":"{d}日超過",
    "settings.title":"設定","set.language":"言語","set.appearance":"外観・テーマ",
    "theme.aria":"テーマ","theme.system":"端末に合わせる","theme.light":"ライト","theme.dark":"ダーク",
    "set.notifications":"通知","set.notifDesc":"予定や誕生日を、通知でそっと。","set.notifOn":"通知は許可されています","set.notifDenied":"端末の設定で通知がオフになっています","set.notifAllow":"通知を許可する",
    "set.weather":"天気の地点","set.weatherDesc":"自宅も実家も公園も、気になる場所の天気を（最大{n}件）。","set.weatherMax":"最大{n}件まで。削除すると追加できます。","set.addLocation":"地点を追加",
    "wx.first":"先頭","wx.moveUp":"上へ","wx.moveDown":"下へ","wx.pinTop":"先頭に固定","wx.rename":"名前を変更","wx.delete":"削除","wx.namePlaceholder":"地点名（例：自宅・実家・軽井沢）",
    "common.save":"保存","common.cancel":"キャンセル","common.stop":"やめる",
    "set.colorTime":"色が変わる時間（お世話・やることログ）","set.colorWarn":"黄色になるまで","set.colorAlert":"赤になるまで","set.colorNow":"現在：","set.colorDaySuffix":"日で","unit.dShort":"日",
    "set.petSafety":"ペットの安全","safety.toxic":"誤食・中毒の危険物リスト","safety.emergency":"夜間・救急の備え","safety.disaster":"防災・避難の備え",
    "set.backup":"バックアップ","set.backupDesc":"写真も記録も、この端末の中だけ。","set.backupDesc2":"書き出して保管を。","backup.export":"データを書き出す（写真ふくむ）","backup.exportCsv":"記録をCSVで書き出す","backup.restoreWarn":"読み込むと、いまのデータはバックアップの内容で上書きされます。よろしいですか？","backup.chooseFile":"ファイルを選んで復元","backup.restore":"バックアップから復元する",
    "set.familyShare":"家族で共有","share.settings":"共有の設定",
    "set.about":"アプリについて","about.help":"使い方・機能紹介","about.whatsNew":"変更点・新機能","about.tourAgain":"使い方をもう一度見る","about.aboutApp":"このアプリについて","about.reset":"データを消して最初から",
    "rel.daysAgo":"{n}日前","rel.today2":"今日","rel.overdueDeadline":"期限切れ","rel.todayDeadline":"今日で期限","rel.dueInDaysDeadline":"あと{n}日で期限",
    "common.add":"追加","common.delete":"削除","common.edit":"編集","common.done":"完了","common.clear":"解除","common.me":"わたし","common.optional":"（任意）",
    "a11y.delete":"削除","a11y.pickColor":"色を選ぶ","a11y.editProfile":"プロフィールを編集","a11y.editPhotoProfile":"写真・プロフィールを編集","a11y.editIconName":"アイコン・名前を変更",
    "ph.name":"名前","ph.title":"タイトル",
    "gender.boy":"男の子","gender.girl":"女の子","neuter.done":"済み","neuter.not":"まだ",
    "ptype.baby":"赤ちゃん","ptype.child":"子ども","ptype.adult":"大人","ptype.senior":"高齢者",
    "toast.saved":"記録しました ✓","toast.added":"追加しました ✓","toast.deleted":"削除しました","toast.nameNeeded":"名前を入力してください","toast.titleNeeded":"タイトルを入力してください",
    "toast.healthSaved":"からだの記録を保存しました 📈","toast.weightNum":"体重は数字で入力してください","toast.healthNeeded":"体重などを入力してください","toast.heightNum":"身長は数字で入力してください",
    "toast.foodSaved":"フードを登録しました 🍚","toast.foodNameNeeded":"フード・食事名を入力してください","toast.pickFood":"フードを選んでください","toast.amountNeeded":"分量を入力してください","toast.qtyNeeded":"量を入力してください","toast.milkNeeded":"ミルクの量(ml)を入力してください",
    "toast.diarySaved":"今日のようすを記録しました 📝","toast.diaryPick":"ようすを選ぶか、ひとことを書いてください",
    "toast.cardSaved":"カードを保存しました 📌","toast.cardNeed":"内容か写真を入れてください","toast.medSaved":"お薬を登録しました","toast.medName":"お薬の名前を入力してください","toast.stockSaved":"ストックを保存しました 📦","toast.routineSaved":"ルーティンを保存しました 🗓","toast.noteSaved":"ノートに残しました","toast.noteNeed":"写真・ひとこと・日記のどれかを入れてください",
    "toast.memorySaved":"思い出に残しました 📸","toast.memoryDeleted":"思い出を削除しました","toast.photoMax":"写真は4枚までです","toast.photoAdded":"写真を追加しました 📷","toast.fileTooBig":"ファイルが大きすぎます（20MB以下）","toast.imgFail":"画像を読み込めませんでした","toast.imgSaveFail":"保存できませんでした。別の画像でお試しください","toast.storageFull":"ストレージ容量が不足しています",
    "toast.recordedWell":"今日も元気、記録しました 👌","toast.alreadyRecorded":"今日はもう記録ずみです 👌","toast.pickWho":"記録する子を選んでください","toast.dupItem":"同じ項目があります","toast.tomorrow":"明日へ送りました","toast.dateFixed":"日付を修正しました ✓","toast.iconSet":"アイコンを設定しました","toast.certDeleted":"証明書を削除しました","toast.growthSaved":"成長記録に残しました","toast.belongNeeded":"持ち物を入力してください","toast.belongAdded":"持ち物を追加しました 🎒",
    "toast.logged":"{emoji} {title} を記録 ✓","toast.memberDeleted":"{name} を削除しました",
    "care.overdue":"期限切れ {n}","care.soon":"期限近 {n}","care.ok":"ケアは順調","vis.private":"非公開","vis.shared":"共有中",
    "hero.addPhoto":"写真を追加","hero.rainbow":"虹の橋へ","hero.togetherThanks":"・{n}日間ありがとう","me.setBirthday":"自分の誕生日を登録",
    "prof.title":"{name}のプロフィール","prof.familyDefault":"家族","sp.catShort":"ねこ","sp.dogShort":"いぬ","sp.petShort":"ペット",
    "prof.usePhoto":"写真にする","prof.backToEmoji":"絵文字に戻す","prof.nickname":"ニックネーム（任意）","ph.nickname":"例：ゆいちゃん / ゆいたん","prof.folder":"フォルダ（分類・任意）","ph.folderPerson":"例：ご家族 / 2階の親 / 実家","ph.folderPet":"例：犬たち / ハムスター / 2階の子",
    "prof.calColor":"カレンダーの色","prof.calColorDesc":"カレンダーで見分けやすく。","prof.birthday":"誕生日（年は任意）","prof.gotcha":"うちの子記念日（年は任意）","prof.gotchaDesc":"お迎え記念日のお祝いに。",
    "prof.breedCat":"猫種","prof.breedDog":"犬種","prof.breedOther":"種類","ph.breedDog":"犬種を検索・入力（一覧にない種類も登録OK）","ph.breedCat":"猫種を検索・入力（一覧にない種類も登録OK）","ph.breedOther":"種類を入力（自由入力）","prof.breedDescDog":"散歩のめやすに。","prof.breedDescOther":"体格に合わせた記録に。",
    "prof.coat":"毛の色（任意）","ph.coat":"入力して検索（自由入力も可）","prof.gender":"性別（任意）","prof.genderDesc":"迷子ポスターにも自動で反映されます。","prof.neuter":"避妊・去勢","prof.microchip":"マイクロチップ番号（任意）","ph.microchip":"15桁の番号（例：392...）","prof.microchipDesc":"迷子・防災時の備えに。",
    "prof.personType":"種別（記録項目の出し分け）","prof.blood":"血液型（任意）","blood.suffix":"型","prof.rainbow":"虹の橋（お別れの記録・任意）","prof.rainbowSet":"お別れを記録して追悼モードにする","prof.rainbowDesc":"お知らせを止め、そっと思い出を振り返る表示に。",
    "prof.visShared":"この子の記録を、招待した家族と共有します。","prof.visPrivate":"この端末だけに保存し、家族には共有しません。","prof.visNote":"アレルギー・生理・医療メモなど見せたくない情報は「自分のみ」に。","prof.saveMember":"保存する","prof.deleteMember":"このメンバーを削除",
    "fun.gotchaToday":"迎えて{y}年！","fun.gotchaTodayNoYear":"うちの子記念日！","fun.gotchaAnniv":"記念日 {date}","fun.gotchaAnnivY":"記念日 {date}（{y}周年）","fun.together":"お迎えから{n}日","fun.neuter":"避妊・去勢{s}","member.addFamily":"家族・ペットを追加",
    "word.pet":"ケア","word.person":"予定","rec.memberTitle":"{name} の{word}","rec.tapEditDate":"タップで日付を修正",
    "rel.stillNone":"まだ記録なし","rel.weeksAgo":"{n}週間前","rel.monthsAgo":"約{n}か月前",
    "rec.routineTitle":"今日のルーティン","rec.addFromPlus":"右下の ＋ から追加","rec.choreTitlePet":"毎日のお世話","rec.choreTitleMe":"セルフケアの記録","rec.choreTitleOther":"お世話ログ","rec.choreDescPet":"「やった」で記録。前回からの経過が色でわかります。","rec.choreDescOther":"「やった」で記録。前回からの経過がひと目で。","rec.did":"やった","rec.lastDone":"前回 {date}・{txt}","rec.totalCount":"（計{n}回）",
    "common.all":"すべて","a11y.prevMonth":"前の月","a11y.nextMonth":"次の月","cal.addRecord":"＋ 記録","cal.noRecords":"記録はまだありません","cal.exportIcs":"予定をカレンダーアプリに出力（.ics）","cal.foot":"日付をタップで記録・ふりかえり","cal.dayTitle":"{md}（{wd}）",
    "bday.month":"月","bday.day":"日","bday.yearOpt":"年（任意）","bday.monthSuffix":"月","bday.daySuffix":"日",
    "common.close":"とじる","food.editTitle":"フードを編集","food.newTitle":"フード・食事を登録","ph.foodName":"フード・食事名（例：○○チキン ドライ）","ph.brand":"メーカー・ブランド（任意）","food.type":"種類","foodtype.dry":"ドライ","foodtype.wet":"ウェット","foodtype.homemade":"手作り","foodtype.treat":"おやつ","foodtype.supplement":"サプリ","foodtype.other":"その他","food.amountUnit":"1回の量・単位（任意）","ph.amount":"量","foodunit.g":"g","foodunit.ml":"ml","foodunit.piece":"個","food.timesTime":"1日の回数・時間（任意）","ph.times":"回","ph.feedTime":"時間（例：朝7時・夜19時）","food.kcal":"カロリー（任意・分かる場合）","food.kcalDesc":"登録するとカロリーを自動計算。未入力でも量だけ記録OK。","food.mealTitle":"食事を記録","food.food":"フード","food.when":"いつ","mealslot.morning":"朝","mealslot.noon":"昼","mealslot.night":"夜","mealslot.treat":"おやつ","food.qty":"量","food.approxKcal":"約{kc}kcal","food.logBtn":"記録","bday.addTitle":"誕生日・記念日を追加","ph.bdayName":"名前・予定（例：ゆいの誕生日）","bday.dateYearOpt":"日付（年は任意）",
    "rec.healthTitle":"からだの記録","chart.weight":"体重","chart.height":"身長","chart.bpSys":"血圧（上）","health.chartSoon":"あと1回記録すると、体重の推移グラフが出ます。","health.emptyPlus":"右下の ＋ から体重などを記録。","health.recordOf":"{date}の記録","health.bpPrefix":"血圧 ",
    "rec.medsTitle":"お薬・サプリ","med.finished":"のみ終わりました","med.progress":"{days}日間・{n}日目・のこり{left}日","med.tookDone":"のんだ✓","med.took":"のんだ","ph.medName":"お薬・サプリ名（例：ビタミン・処方薬）","med.daysUnit":"日間","common.register":"＋ 登録",
    "rec.sheetsTitle":"まとめて1枚に","rec.sheetsDescPet":"通院・お預けのときに、記録を1枚で。","rec.sheetsDescOther":"お預け・もしもの時に、1枚で。","rec.vetSummary":"獣医さん用サマリー","rec.careSheet":"預け先・お世話シート","rec.lostPoster":"迷子ポスター","rec.handoverToday":"今日の引き継ぎシート","rec.emergencyCard":"緊急カード",
    "rec.feedTitle":"フード・食事","food.delMeal":"食事の記録","food.delRecord":"記録","food.registerLink":"＋ フード登録","food.todayCount":"今日 {n}回","food.pickToLog":"フードを選んで食事を記録。","food.recordLabel":"記録","food.tapToLog":"タップして記録","food.todayMeal":"タップで今日のごはん。","food.amountOnly":"量だけ記録","food.registerBig":"フード・食事を登録する","food.defaultName":"ごはん",
    "rec.toiletTitle":"トイレ成功率","toilet.peeRate":"おしっこ成功率","toilet.poopRate":"うんち成功率","toilet.none":"記録なし","toilet.count":" ({success}/{total}回)","toilet.logBtn":"トイレを記録する",
    "rec.diaryTitle":"今日のようす","diary.recordedDone":"今日の体調は記録ずみ","diary.editMore":"追記・編集","diary.recordBtn":"体調を記録","chart.energy":"元気の推移（5段階）","chart.sleep":"睡眠時間の推移","chart.appetite":"食欲の推移（3段階）","diary.empty":"「体調を記録」から残せます",
    "life.editTitle":"記録を編集","life.newTitle":"この日を記録","cat.memory":"思い出・日記","cat.event":"予定","ph.eventTitle":"予定のタイトル（例：病院）","ph.memoTitle":"ひとこと（任意・例：はじめて海へ）","common.photo":"写真","ph.diary":"日記（長文・任意）","life.tag":"タグ","life.firstTag":"はじめて","ph.tag":"例：発表会 / お弁当 / 自転車","life.date":"日付","life.time":"時間","life.repeat":"繰り返し","repeat.none":"なし","repeat.daily":"毎日","repeat.weekly":"毎週","repeat.monthly":"毎月","repeat.yearly":"毎年","life.notify":"通知（任意）","notif.allowShort":"許可する","remind.0":"開始時","remind.5":"5分前","remind.30":"30分前","remind.60":"1時間前","remind.1440":"前日","life.notifyHint":"🔔が多いと見落としがち。必要なぶんだけに。",
    "rec.trayTitle":"大切な情報","rec.trayCount":"（{n}）","rec.trayHint":"緊急連絡先・アレルギー・かかりつけ等をカードで保存。","card.nightTag":"夜間","card.hoursPh":"受付・診療時間（任意 例：24時間／夜間 20:00〜翌8:00）","card.addrPh":"住所（任意）","card.nightToggle":"夜間・救急でまず電話する病院にする",
    "card.editTitle":"カードを編集","card.newTitle":"カードを追加","cardkind.emergency":"緊急連絡先","cardkind.allergy":"アレルギー・禁忌","cardkind.hospital":"かかりつけ・病院メモ","cardkind.shelter":"避難先・防災メモ","cardkind.insurance":"保険証・保険情報","cardkind.other":"メモ","ph.cardTitle":"タイトル（例：かかりつけ病院）","ph.cardBody":"連絡先・アレルギー・注意点・お薬の残り期間など",
    "rec.walkTitle":"おさんぽ記録","walk.goalTitle":"今月のめやす（参考）","walk.distance":"距離","walk.count":"回数","walk.timesUnit":"回","walk.dcPre":"犬種","walk.dcMid":"と年齢","walk.dcPost1":"からの","walk.dcBold":"一般的な目安（参考値）","walk.dcPost2":"です。健康状態や個体差で必要な運動量は変わります。体調やかかりつけ獣医さんの助言に合わせて調整してください。","walk.dcBreedUnset":"（未設定→中型で計算）","walk.dcAgeUnset":"（未設定→成犬で計算）","walk.reviewTitle":"おさんぽのふりかえり","walk.vsLast":"先月比 ","walk.summaryThisMonth":"今月 ","walk.walksUnit":"回","walk.summaryMin":"・{m}分","walk.summarySep":"　／　6か月合計 ","walk.time":"時間","walk.gpsRecording":"GPSでルート記録中（{n}点）","walk.gpsStart":"GPSでルートを記録中…歩き出すと距離が増えます","walk.stopSave":"終了して記録","walk.otherRunning":"別のコの散歩を記録中です","walk.startBtn":"散歩スタート","walk.delLabel":"散歩の記録",
    "growth.title":"成長の記録","growth.desc":"はじめてできた瞬間を、写真とともに。","growth.custom":"自分で追加（例：逆上がりができた）","growth.camTitle":"作品・写真を追加","growth.photoSaved":"作品・写真を保存しました","common.plusRecord":"＋ 記録","common.plusAdd":"＋ 追加","common.amount":"金額","common.foot":"大切な家族の毎日を、ひとつの場所で。","a11y.edit":"編集",
    "review.title":"今月のふりかえり","review.daysLabel":"体調の記録（日）","review.sleepLabel":"平均睡眠(h)","review.movesLabel":"運動の記録","review.logsLabel":"やること記録","review.vsPrev":"先月とくらべて：{parts}","review.openTasks":"未完了のやること：{n}件","review.note":"※記録した事実をならべたものです。良し悪しの判定はしません。","review.pDays":"記録 {v}日","review.pSleep":"睡眠 {v}h","review.pLogs":"やること {v}回",
    "album.title":"思い出","album.cancelSel":"選択をやめる","album.select":"選択","album.loading":"読み込み中…","album.bulkAdd":"写真をまとめて追加（撮影日で自動振り分け）","album.selHint":"写真をタップして選択（最大{n}枚）→ 下の「別の子へ移動」で、まとめて他の家族・うちのこへ移せます。","album.empty":"写真とひとことで残せます","album.selCount":"{n}枚を選択中","album.moveBtn":"別の子へ移動","album.moveDesc":"選択した {n}枚 の思い出を、まとめて移動します。",
    "points.title":"お手伝いポイント","points.total":"合計 {n}pt","points.week":"（今週 {n}）","points.custom":"自分で追加（+1pt）",
    "allow.title":"おこづかい帳","allow.balance":"のこり","allow.memoPh":"メモ（おかし 等・任意）","allowdir.in":"もらった","allowdir.out":"つかった","allowdir.save":"ちょきん",
    "meds.namePh":"お薬・サプリ名（例：抗生剤・ビタミン）",
    "belong.title":"持ち物（曜日ごと）","belong.empty":"右下の ＋ から持ち物を登録",
    "foodreg.title":"フードの登録","foodreg.desc":"よく使うフードを登録しておく。","foodreg.addFood":"フード・食事を登録","foodreg.calc":"1日のフード量を計算",
    "supply.title":"消耗品の在庫","supply.emptyMe":"サプリや日用品、切らさないように。","supply.empty":"フードなどを登録すると、残りを自動でお知らせ","supply.bought":"買った","supply.check":"確認","supply.lineOut":"切れているかも・買い足しを","supply.lineLow":"あと{n}日で切れそう","supply.lineOk":"在庫OK（あと{n}日分）","supply.careOut":"在庫なし・買い足しを","supply.careLow":"のこり{n}回・そろそろ買い足し",
    "exp.title":"支出","exp.scopeThisFallback":"このコ","exp.scopeAll":"みんな","exp.emptyAll":"まだ支出の記録がありません。","exp.emptyThis":"右下の ＋ から追加","exp.total":"合計","exp.year":"{y}年","exp.monthlyAvg":"月平均","exp.annual":"年間見込み","exp.byMember":"メンバー別","exp.byCategory":"カテゴリ別","exp.trend":"月ごとの推移","exp.trendRecent":"（直近{n}ヶ月）","exp.trendEmpty":"データが増えると、月ごとの推移が表示されます。","exp.delLabel":"{date}の支出","exp.editTitle":"支出を編集","exp.dateLabel":"日付（レシート遅れ・代理入力などの修正用）",
    "certs.title":"通院・証明書","certs.cert":"証明書","certs.addCert":"＋ 証明書を追加","certs.empty":"＋から種類と日付を選び、証明書を保存。","certs.certHint":"証明書（タップで拡大）","certs.noDate":"日付なし","certs.yearLabel":"{y}年","certs.addablePhoto":"写真（証明書）を追加できる記録","certs.tapAddPhoto":"タップで証明書の写真を追加","renew.expired":"期限切れ {n}日","renew.today":"今日で期限","renew.left":"あと{n}日",
    "common.memoOpt":"メモ（任意）","exp.addTitle":"支出を記録","exp.addHint":"今日の日付で記録。修正は明細をタップ。","exp.notePh":"メモ（任意）","belong.addTitle":"持ち物を追加","belong.addPh":"例：体操服 / 図書の本 / 習字道具","belong.dowSuffix":"曜",
    "hub.title":"何を記録しますか？","hub.addable":"追加できる機能","hub.schedulePet":"ケア・予定","hub.scheduleMe":"予定・ToDo","hub.toilet":"トイレ記録","hub.routine":"ルーティン（習慣）","hub.health":"体重・からだ","hub.belong":"持ち物（曜日）","hub.bday":"誕生日・記念日",
    "del.confirmTitle":"本当に削除しますか？","del.confirmBody":"「{label}」を削除します。この操作は元に戻せません。","del.confirmBodyPlain":"この操作は元に戻せません。","del.confirmBtn":"削除する",
    "health.addTitle":"からだの記録","health.bp":"血圧","health.temp":"体温","health.glucose":"血糖値","health.bpHigh":"上","health.bpLow":"下","health.optionalPh":"任意","health.smallAnimalHint":"小動物は0.1g単位","health.condLabel":"体調","health.saveBtn":"からだを記録","health.targetWeight":"目標体重","health.targetHint":"目標との差を表示。",
    "diary.quickHealthy":"今日も元気（ワンタップで完了）","diary.hint":"くわしく残すときだけ（任意）。","diary.energy":"元気","diary.appetite":"食欲","diary.poop":"うんち","diary.sleep":"睡眠","diary.other":"その他","diary.symptoms":"症状","diary.hours":"{h}時間","diary.hoursSuffix":"時間","diary.hoursPh":"時間","diary.walk":"さんぽ・おでかけ","diary.hospital":"病院に行った","diary.periodPriv":"本人だけの記録です","diary.periodNote":"前回 {last}・次はそろそろ {next}ごろ（約{avg}日周期）","diary.notePh":"日々の様子・病院でのこと・ひとこと…","diary.delPhoto":"写真を削除","diary.addPhoto":"写真を追加（お薬・症状など）","diary.saveBtn":"今日のようすを記録",
    "feed.addTitle":"ごはんの記録","feed.servingLabel":"1回分の量","feed.servingPh":"例：100","feed.hintSet":"1回分＝{g}g として総量に反映します（初回だけ設定すればOK）","feed.hintUnset":"未設定でも記録できます（設定すると総量に反映）","feed.amount":"分量","feed.previewPre":"＝ 約 ","feed.previewPost":"（{n}回分）","feed.saveBtn":"ごはんを記録","feed.today":"今日の合計 約{g}g（{n}回）",
    "sched.titlePet":"ケア・予定を追加","sched.titleSelf":"健康・ケアを追加","sched.titleMe":"予定・ToDoを追加","sched.frequent":"よく使う","sched.contentPh":"内容を入力…","sched.addLabelPh":"{label}を追加…","sched.content":"内容","sched.dateOptMe":"日付・期限（任意）","sched.time":"時間","sched.dateHint":"日付・期限を入れると、その日のカレンダーに表示されます。","sched.certPhoto":"証明書・写真（任意）","sched.changePhoto":"写真を変更","sched.attachPhoto":"＋ 写真を添付","sched.notify":"通知","sched.quickAdd":"1タップ追加（前回コピー）","sched.lastDate":"前回 {date}","sched.dateDone":"実施日","sched.dateDate":"日付","sched.dateVisit":"受診日","sched.dateDue":"期限","care.fallback":"ケア","filter.all":"すべて",
    "toilet.hint":"タップで記録（今日・現在時刻）。","toilet.pee":"おしっこ","toilet.success":"✓ 成功","toilet.fail":"✕ 失敗","toilet.hardness":"うんちの硬さ（7段階）","toilet.bristolNote":"4が健康的。1や7が続くときは獣医さんに相談を。","toilet.alertBody":"気をつけたいこと：消化管異物・腸閉塞・中毒","toilet.alertLink":"危険物リストで詳しく","toilet.ideal":"（理想的）","toilet.disclaimer":"受診の目安です（診断ではありません）。","toilet.trendLoose":"ゆるいうんちが続いています。長引くようなら受診の目安です。","toilet.trendHard":"硬いうんちが続いています。水分や食事、気になるときは受診を。",
    "emg.title":"夜間・救急","emg.lead":"異変が起きたら、まず病院に電話。自己判断で処置せず、指示に従ってください。","emg.step1":"電話する","emg.callDefault":"かかりつけ／夜間救急","emg.registerHosp":"病院の連絡先を登録","emg.registerHospSub":"夜間救急・かかりつけの番号を手元に","emg.note1":"受け入れ可否や診療方法は病院により異なり、事前連絡が必要なことも。診療時間・連絡先は最新を病院にご確認を。","emg.redHead":"このサインは、迷わず今すぐ連絡","emg.dontHead":"してはいけないこと","emg.dont1":"自己判断で吐かせる・薬や水を飲ませる","emg.dont2":"ネットの情報だけで「様子見」と決める","emg.dont3":"まず病院に連絡し、指示に従う","emg.step2":"電話で伝える","emg.profNone":"プロフィール未登録","emg.toxHead":"誤食チェックの内容","emg.toxWhat":"何を","emg.toxAmount":"量","emg.toxWhen":"いつ","emg.toxWeight":"体重","emg.toxSymptom":"症状","emg.say1":"今の様子（意識・呼吸・けいれん・出血・嘔吐や下痢の有無）","emg.say2":"いつ・何が起きたか（誤食なら食べたもの・量・時間）","emg.say3":"持病・飲んでいる薬・かかりつけの有無","emg.tipsHead":"もっと詳しく伝えるなら","emg.step3":"持っていく","emg.note2":"準備より受診を優先。手元にあるものだけで、すぐ向かって大丈夫です。","emg.contactsTitle":"登録済みの連絡先","emg.register":"＋ 登録","emg.contactsEmpty":"動物病院と、家族・預け先の番号を登録しておくと安心です。ここから発信でき、カードにも残ります。","emg.groupHosp":"🏥 動物病院","emg.groupPerson":"👤 家族・預け先","emg.addNumber":"番号を追加","emg.hospFallback":"病院","emg.contactFallback":"連絡先","emg.prepHead":"平時の備え（落ち着いたときに）","emg.foot":"※ 病院情報は変わることがあります。最新は必ず各病院にご確認ください。緊急時はためらわず、かかりつけや近隣の夜間救急へご連絡を。",
    "disaster.title":"防災・避難の備え","disaster.alert":"災害時はペットとの「同行避難」が基本です。日ごろの備えと、避難先の事前確認をしておきましょう。","disaster.shelterTitle":"わが家の避難先","disaster.registerShelter":"＋ 避難先を登録","disaster.shelterEmpty":"避難先や預け先を、家族で共有。カードにも残ります。","disaster.shelterFallback":"避難先","disaster.prepTitle":"持ち出し・備蓄（ペット用）","disaster.tipsHead":"いざという時のポイント","disaster.foot":"※ 指定避難所のペット受け入れ可否・場所は自治体ごとに異なります。お住まいの自治体・自主防災組織で必ず事前にご確認ください。",
    "safety.sectionLabel":"いざという時","safety.sectionNote":"登録済みの情報から、迷子ポスターや緊急カードをすぐ作れます。","safety.toxicShort":"誤食・中毒","safety.emergencyShort":"夜間・救急","safety.emergencyCard":"緊急カード","safety.lostPoster":"迷子ポスター","safety.disasterShort":"防災・避難",
    "common.saveImage":"画像で保存","common.print":"印刷","common.addPhotoMax4":"写真を追加（最大4枚）","ecard.meFallback":"わたし","ecard.allergy":"アレルギー・禁忌","ecard.meds":"服薬中","ecard.contacts":"緊急連絡先・かかりつけ","ecard.contactsEmpty":"※「大切な情報」に連絡先を登録すると、ここに表示されます","ecard.addInfo":"連絡先・情報を追加","ecard.note":"※もしもの時に見せる・印刷して持たせる用。データは端末内保存なので電波がなくても表示できます。","ecard.fileSuffix":"緊急カード",
    "lost.step0":"場所・日時","lost.step1":"ペット情報","lost.step2":"ポスター","lost.stepFmt":"{n}. {lab}","lost.step0LeadBold":"まず、落ち着いて。","lost.step0LeadRest":"最後に見かけた場所と時間を入れましょう。あとから直せます。","lost.placeLabel":"最後に見かけた場所","lost.placeHint":"迷子になった可能性がある場所を入れてください","lost.placePh":"例：〇〇公園の入口付近 ／ 〇〇駅前","lost.placeNoteLabel":"場所の補足（任意）","lost.placeNotePh":"例：コンビニの向かい ／ 東口","lost.whenLabel":"見かけた日時","lost.whenPh":"例：9月18日 18時ごろ","lost.step1Lead":"この内容でポスターを作ります。写真と特徴を確認してください。","lost.featType":"種類","lost.featCoat":"毛色","lost.featGender":"性別","lost.featAge":"年齢","lost.featWeight":"体重","lost.featCollar":"首輪・ハーネス","lost.collarLabel":"首輪・ハーネス（任意）","lost.collarPh":"例：赤い首輪・迷子札あり","lost.situationLabel":"逃げたときの様子（任意）","lost.situationPh":"例：花火に驚いてリードが外れた","lost.temperLabel":"性格（お願い文を自動で調整）","lost.noteLabel":"その他 伝えたいこと（任意）","lost.notePh":"例：SNSでも拡散のご協力をお願いします","lost.registerContact":"連絡先を登録（見つけた人からの連絡に必要）","lost.found":"発見済み","lost.headDog":"迷子犬を探しています","lost.headOther":"さがしています","lost.sightPlace":"最後に目撃された場所","lost.sightWhen":"目撃日時","lost.situationTitle":"逃げたときの様子","lost.contactPlea":"見かけた方は、こちらまでご連絡ください","lost.contactEmpty":"※「大切な情報」に緊急連絡先を登録すると、ここに表示されます","lost.action":"【重要】もし見かけたら、この番号にすぐお電話ください。追いかけないでください。","lost.footNote":"追いかけず、見かけた場所と時間をお知らせください。印刷・画面提示OK、電波がなくても表示できます。","lost.afterTitle":"できました。次に、みんなに知らせましょう。","lost.foundToggle":"見つかった（ポスターに「発見済み」を表示）","lost.privacy":"住所やマイクロチップ番号は載せません。連絡先は登録済みのものだけ表示されます。","lost.nextPet":"次へ：ペット情報","lost.back":"もどる","lost.makePoster":"ポスターを作成","lost.share":"共有","lost.fileSuffix":"迷子","temper.unset":"未設定","temper.friendly":"人なつっこい","temper.normal":"ふつう","temper.timid":"怖がり",
    "ob.title":"大切な家族の毎日を、ひとつに。","ob.sub":"ペットも子どもも。記録から、もしもの備えまで。","ob.start":"はじめる","ob.trySample":"サンプルで試してみる","ob.h2":"まず、ひとり登録しましょう","ob.choicePet":"🐶 うちの子（犬・猫など）","ob.choiceMe":"👤 自分（自分のケアも）","ob.choicePerson":"👨‍👩‍👧 家族（人）","ob.skip":"今は追加しない","ob.photoIcon":"写真をアイコンにする","ob.iconHintPre":"絵文字を選ぶか、右端の ","ob.iconHintPost":" から写真も使えます","ob.namePetPh":"名前（例：ぽち）","ob.nameMePh":"あなたの名前（例：かおり）","ob.namePersonPh":"名前（例：ゆうと）","ob.birthday":"誕生日（年は任意）","ob.back":"戻る",
    "tour.headseg.title":"「毎日」と「管理」で切り替え","tour.headseg.body":"上のこのタブで切り替えます。毎日＝その日の記録、管理＝ケア予定・お世話・大切な情報など。","tour.fab.title":"記録はここから","tour.fab.body":"右下の＋から、予定・ケア・ごはん・体重などを記録できます。","tour.cal.title":"カレンダー","tour.cal.body":"家族の予定が一覧に。日付タップでふりかえり。","tour.home.title":"家族ごとに","tour.home.body":"ホームで家族をタップするとその子のページへ。開いたら上の一覧でいつでも切り替えられます。","coach.cal.title":"日付をタップ","coach.cal.body":"色つきドットはその日の予定。タップでふりかえり。","coach.record.title":"からだ・ようすを記録","coach.record.body":"右下の＋から、体重・体調・ごはん・日記を記録。","coach.manage.title":"毎日のお世話・予定","coach.manage.body":"やることや予定はここに。「やった」で経過がわかる。","tour.next":"次へ","tour.skip":"スキップ","common.ok":"OK",
  },
  en:{
    "nav.home":"Home","nav.calendar":"Calendar","nav.settings":"Settings","title.daily":"Daily",
    "seg.daily":"Daily","seg.manage":"Manage",
    "home.family":"Family","home.okNoRecord":"No records yet","home.okPet":"{name} is doing well","home.okGeneric":"Doing well",
    "level.ok":"On track","level.warn":"Watch","level.alert":"Needs care","level.none":"No data","level.memorial":"In memory",
    "home.layerToday":"Today","home.calmTitle":"All calm today","home.calmNone":"Wishing you an easy day",
    "home.calmOnePet":"{emoji} {name} is settled","home.calmOne":"{emoji} {name} is settled too","home.calmAll":"{emojis} Everyone's settled",
    "home.todayTodos":"Today's to-dos","home.export":"Export","home.moreCount":"{n} more",
    "home.dontMiss":"Don't miss","home.upcoming":"Coming up","home.quickCond":"How's everyone today?","home.quickCondBtn":"All good",
    "home.restock":"Time to restock","home.recap":"A little recap","home.statWeekCare":"Care this week","home.statTodayRoutine":"Today's routines",
    "rel.today":"Today","rel.overdue":"Overdue","rel.tomorrow":"Tomorrow","rel.inDays":"In {d} days","rel.dueInDays":"Due in {d} days","rel.overdueBy":"{d}d overdue",
    "settings.title":"Settings","set.language":"Language","set.appearance":"Appearance",
    "theme.aria":"Theme","theme.system":"Match device","theme.light":"Light","theme.dark":"Dark",
    "set.notifications":"Notifications","set.notifDesc":"Gentle nudges for schedules and birthdays.","set.notifOn":"Notifications are on","set.notifDenied":"Notifications are off in your device settings","set.notifAllow":"Allow notifications",
    "set.weather":"Weather locations","set.weatherDesc":"Weather for home, family's place, the park — up to {n} spots.","set.weatherMax":"Up to {n} spots. Remove one to add more.","set.addLocation":"Add a location",
    "wx.first":"Top","wx.moveUp":"Move up","wx.moveDown":"Move down","wx.pinTop":"Pin to top","wx.rename":"Rename","wx.delete":"Delete","wx.namePlaceholder":"Place name (e.g. Home, Family's)",
    "common.save":"Save","common.cancel":"Cancel","common.stop":"Cancel",
    "set.colorTime":"When colors change (care & task log)","set.colorWarn":"Turns yellow after","set.colorAlert":"Turns red after","set.colorNow":"Now: ","set.colorDaySuffix":"d → ","unit.dShort":"d",
    "set.petSafety":"Pet safety","safety.toxic":"Toxic foods & hazards","safety.emergency":"Night & emergency prep","safety.disaster":"Disaster & evacuation prep",
    "set.backup":"Backup","set.backupDesc":"Your photos and records stay on this device only. ","set.backupDesc2":"Export to keep them safe.","backup.export":"Export data (with photos)","backup.exportCsv":"Export records as CSV","backup.restoreWarn":"Restoring overwrites your current data with the backup. Continue?","backup.chooseFile":"Choose a file to restore","backup.restore":"Restore from backup",
    "set.familyShare":"Family sharing","share.settings":"Sharing settings",
    "set.about":"About","about.help":"How it works","about.whatsNew":"What's new","about.tourAgain":"Replay the walkthrough","about.aboutApp":"About this app","about.reset":"Erase data & start over",
    "rel.daysAgo":"{n} days ago","rel.today2":"Today","rel.overdueDeadline":"Overdue","rel.todayDeadline":"Due today","rel.dueInDaysDeadline":"Due in {n} days",
    "common.add":"Add","common.delete":"Delete","common.edit":"Edit","common.done":"Done","common.clear":"Clear","common.me":"Me","common.optional":" (optional)",
    "a11y.delete":"Delete","a11y.pickColor":"Pick a color","a11y.editProfile":"Edit profile","a11y.editPhotoProfile":"Edit photo & profile","a11y.editIconName":"Change icon & name",
    "ph.name":"Name","ph.title":"Title",
    "gender.boy":"Boy","gender.girl":"Girl","neuter.done":"Yes","neuter.not":"Not yet",
    "ptype.baby":"Baby","ptype.child":"Child","ptype.adult":"Adult","ptype.senior":"Senior",
    "toast.saved":"Saved ✓","toast.added":"Added ✓","toast.deleted":"Deleted","toast.nameNeeded":"Please enter a name","toast.titleNeeded":"Please enter a title",
    "toast.healthSaved":"Health record saved 📈","toast.weightNum":"Weight must be a number","toast.healthNeeded":"Enter a weight or other value","toast.heightNum":"Height must be a number",
    "toast.foodSaved":"Food saved 🍚","toast.foodNameNeeded":"Please enter a food name","toast.pickFood":"Please choose a food","toast.amountNeeded":"Please enter an amount","toast.qtyNeeded":"Please enter an amount","toast.milkNeeded":"Please enter the milk amount (ml)",
    "toast.diarySaved":"Today's notes saved 📝","toast.diaryPick":"Pick how they're doing, or add a note",
    "toast.cardSaved":"Card saved 📌","toast.cardNeed":"Add some details or a photo","toast.medSaved":"Medication saved","toast.medName":"Please enter the medication name","toast.stockSaved":"Stock saved 📦","toast.routineSaved":"Routine saved 🗓","toast.noteSaved":"Note saved","toast.noteNeed":"Add a photo, a note, or a diary entry",
    "toast.memorySaved":"Saved to memories 📸","toast.memoryDeleted":"Memory deleted","toast.photoMax":"Up to 4 photos","toast.photoAdded":"Photo added 📷","toast.fileTooBig":"File too large (max 20MB)","toast.imgFail":"Couldn't load the image","toast.imgSaveFail":"Couldn't save. Try another image.","toast.storageFull":"Not enough storage",
    "toast.recordedWell":"Marked as doing well 👌","toast.alreadyRecorded":"Already recorded today 👌","toast.pickWho":"Choose who to record","toast.dupItem":"That item already exists","toast.tomorrow":"Moved to tomorrow","toast.dateFixed":"Date updated ✓","toast.iconSet":"Icon set","toast.certDeleted":"Certificate deleted","toast.growthSaved":"Saved to milestones","toast.belongNeeded":"Please enter an item","toast.belongAdded":"Item added 🎒",
    "toast.logged":"Logged {emoji} {title} ✓","toast.memberDeleted":"Deleted {name}",
    "care.overdue":"Overdue {n}","care.soon":"Due soon {n}","care.ok":"Care on track","vis.private":"Private","vis.shared":"Shared",
    "hero.addPhoto":"Add photo","hero.rainbow":"Rainbow Bridge","hero.togetherThanks":" · {n} days together, thank you","me.setBirthday":"Add your birthday",
    "prof.title":"{name}'s profile","prof.familyDefault":"Family","sp.catShort":"Cat","sp.dogShort":"Dog","sp.petShort":"Pet",
    "prof.usePhoto":"Use a photo","prof.backToEmoji":"Back to emoji","prof.nickname":"Nickname (optional)","ph.nickname":"e.g. Yui, Yui-chan","prof.folder":"Folder (grouping, optional)","ph.folderPerson":"e.g. Family / Parents upstairs","ph.folderPet":"e.g. Dogs / Hamster",
    "prof.calColor":"Calendar color","prof.calColorDesc":"Easier to tell apart on the calendar.","prof.birthday":"Birthday (year optional)","prof.gotcha":"Gotcha day (year optional)","prof.gotchaDesc":"To celebrate the day they joined you.",
    "prof.breedCat":"Breed","prof.breedDog":"Breed","prof.breedOther":"Type","ph.breedDog":"Search or type a breed (any breed is OK)","ph.breedCat":"Search or type a breed (any breed is OK)","ph.breedOther":"Type (free text)","prof.breedDescDog":"Helps gauge walk length.","prof.breedDescOther":"For records that fit their size.",
    "prof.coat":"Coat color (optional)","ph.coat":"Type to search (free text OK)","prof.gender":"Sex (optional)","prof.genderDesc":"Also shown on the lost-pet poster.","prof.neuter":"Spay / neuter","prof.microchip":"Microchip number (optional)","ph.microchip":"15-digit number (e.g. 392...)","prof.microchipDesc":"Handy for lost-pet or disaster prep.",
    "prof.personType":"Type (which fields to show)","prof.blood":"Blood type (optional)","blood.suffix":"","prof.rainbow":"Rainbow Bridge (memorial, optional)","prof.rainbowSet":"Record a goodbye and switch to memorial mode","prof.rainbowDesc":"Pauses reminders and gently shows memories.",
    "prof.visShared":"Shares this one's records with your invited family.","prof.visPrivate":"Kept on this device only, not shared with family.","prof.visNote":"Set anything private — allergies, cycle, medical notes — to \"Only me\".","prof.saveMember":"Save","prof.deleteMember":"Delete this member",
    "fun.gotchaToday":"{y} years together!","fun.gotchaTodayNoYear":"Gotcha day!","fun.gotchaAnniv":"Gotcha day {date}","fun.gotchaAnnivY":"Gotcha day {date} ({y} yr)","fun.together":"{n} days together","fun.neuter":"Spay/neuter: {s}","member.addFamily":"Add family or pet",
    "word.pet":"care","word.person":"plan","rec.memberTitle":"{name}'s {word}","rec.tapEditDate":"Tap to edit the date",
    "rel.stillNone":"Not recorded yet","rel.weeksAgo":"{n} wk ago","rel.monthsAgo":"~{n} mo ago",
    "rec.routineTitle":"Today's routines","rec.addFromPlus":"Add with the ＋ button","rec.choreTitlePet":"Daily care","rec.choreTitleMe":"Self-care log","rec.choreTitleOther":"Care log","rec.choreDescPet":"Tap \"Done\" to log. Color shows time since last.","rec.choreDescOther":"Tap \"Done\" to log. See time since last at a glance.","rec.did":"Done","rec.lastDone":"Last {date} · {txt}","rec.totalCount":" ({n} total)",
    "common.all":"All","a11y.prevMonth":"Previous month","a11y.nextMonth":"Next month","cal.addRecord":"＋ Record","cal.noRecords":"No records yet","cal.exportIcs":"Export events to your calendar (.ics)","cal.foot":"Tap a date to log or look back","cal.dayTitle":"{wd}, {md}",
    "bday.month":"Month","bday.day":"Day","bday.yearOpt":"Year (optional)","bday.monthSuffix":"","bday.daySuffix":"",
    "common.close":"Close","food.editTitle":"Edit food","food.newTitle":"Add food or meal","ph.foodName":"Food or meal name (e.g. Chicken, dry)","ph.brand":"Brand (optional)","food.type":"Type","foodtype.dry":"Dry","foodtype.wet":"Wet","foodtype.homemade":"Homemade","foodtype.treat":"Treat","foodtype.supplement":"Supplement","foodtype.other":"Other","food.amountUnit":"Amount per serving (optional)","ph.amount":"Qty","foodunit.g":"g","foodunit.ml":"ml","foodunit.piece":"pcs","food.timesTime":"Times/day & time (optional)","ph.times":"×/day","ph.feedTime":"Time (e.g. 7am, 7pm)","food.kcal":"Calories (optional, if known)","food.kcalDesc":"Auto-calculates calories. Amount only is fine too.","food.mealTitle":"Log a meal","food.food":"Food","food.when":"When","mealslot.morning":"Morning","mealslot.noon":"Noon","mealslot.night":"Night","mealslot.treat":"Treat","food.qty":"Amount","food.approxKcal":"~{kc} kcal","food.logBtn":"Log","bday.addTitle":"Add a birthday or anniversary","ph.bdayName":"Name (e.g. Yui's birthday)","bday.dateYearOpt":"Date (year optional)",
    "rec.healthTitle":"Health","chart.weight":"Weight","chart.height":"Height","chart.bpSys":"Blood pressure (sys)","health.chartSoon":"One more entry and the weight trend chart appears.","health.emptyPlus":"Log weight and more with the ＋ button.","health.recordOf":"{date} record","health.bpPrefix":"BP ",
    "rec.medsTitle":"Meds & supplements","med.finished":"Finished","med.progress":"{days} days · day {n} · {left} left","med.tookDone":"Taken ✓","med.took":"Take","ph.medName":"Med or supplement name (e.g. vitamin)","med.daysUnit":"days","common.register":"＋ Register",
    "rec.sheetsTitle":"All in one sheet","rec.sheetsDescPet":"One sheet for vet visits or pet-sitting.","rec.sheetsDescOther":"One sheet for handoffs or emergencies.","rec.vetSummary":"Vet summary","rec.careSheet":"Pet-sitter care sheet","rec.lostPoster":"Lost-pet poster","rec.handoverToday":"Today's handover sheet","rec.emergencyCard":"Emergency card",
    "rec.feedTitle":"Food & meals","food.delMeal":"meal record","food.delRecord":"record","food.registerLink":"＋ Add food","food.todayCount":"Today: {n}","food.pickToLog":"Pick a food to log a meal.","food.recordLabel":"Logged","food.tapToLog":"Tap to log","food.todayMeal":"Tap to log today's meal.","food.amountOnly":"Log amount only","food.registerBig":"Add a food or meal","food.defaultName":"Meal",
    "rec.toiletTitle":"Potty success rate","toilet.peeRate":"Pee success","toilet.poopRate":"Poop success","toilet.none":"No data","toilet.count":" ({success}/{total})","toilet.logBtn":"Log potty",
    "rec.diaryTitle":"Today's notes","diary.recordedDone":"Today's condition logged","diary.editMore":"Add / edit","diary.recordBtn":"Log condition","chart.energy":"Energy trend (1–5)","chart.sleep":"Sleep trend","chart.appetite":"Appetite trend (1–3)","diary.empty":"Log it via \"Log condition\"",
    "life.editTitle":"Edit record","life.newTitle":"Log this day","cat.memory":"Memory / diary","cat.event":"Event","ph.eventTitle":"Event title (e.g. Vet)","ph.memoTitle":"A note (optional, e.g. First beach trip)","common.photo":"Photo","ph.diary":"Diary (optional)","life.tag":"Tag","life.firstTag":"First","ph.tag":"e.g. Recital / Bento / Bike","life.date":"Date","life.time":"Time","life.repeat":"Repeat","repeat.none":"None","repeat.daily":"Daily","repeat.weekly":"Weekly","repeat.monthly":"Monthly","repeat.yearly":"Yearly","life.notify":"Notifications (optional)","notif.allowShort":"Allow","remind.0":"At start","remind.5":"5 min before","remind.30":"30 min before","remind.60":"1 hr before","remind.1440":"Day before","life.notifyHint":"Too many 🔔 are easy to miss — keep just what you need.",
    "rec.trayTitle":"Important info","rec.trayCount":" ({n})","rec.trayHint":"Save contacts, allergies, and vet info as cards.","card.nightTag":"Night","card.hoursPh":"Hours (optional, e.g. 24h / night 8pm–8am)","card.addrPh":"Address (optional)","card.nightToggle":"Make this the clinic to call first at night / in emergencies",
    "card.editTitle":"Edit card","card.newTitle":"Add card","cardkind.emergency":"Emergency contact","cardkind.allergy":"Allergies & no-gos","cardkind.hospital":"Vet & clinic notes","cardkind.shelter":"Shelter & disaster notes","cardkind.insurance":"Insurance info","cardkind.other":"Note","ph.cardTitle":"Title (e.g. Regular vet)","ph.cardBody":"Contacts, allergies, notes, meds remaining, etc.",
    "rec.walkTitle":"Walk log","walk.goalTitle":"This month's guide (reference)","walk.distance":"Distance","walk.count":"Walks","walk.timesUnit":"","walk.dcPre":"Based on breed","walk.dcMid":" and age","walk.dcPost1":", a ","walk.dcBold":"general guideline (reference)","walk.dcPost2":". Actual needs vary with health and each dog — adjust to their condition and your vet's advice.","walk.dcBreedUnset":" (not set → medium)","walk.dcAgeUnset":" (not set → adult)","walk.reviewTitle":"Walk review","walk.vsLast":"vs last month ","walk.summaryThisMonth":"This month ","walk.walksUnit":" walks","walk.summaryMin":" · {m} min","walk.summarySep":" / 6-mo total ","walk.time":"Time","walk.gpsRecording":"Recording route by GPS ({n} pts)","walk.gpsStart":"Recording route by GPS… start walking and the distance grows","walk.stopSave":"Finish & save","walk.otherRunning":"A walk for another one is being tracked","walk.startBtn":"Start walk","walk.delLabel":"walk record",
    "growth.title":"Growth log","growth.desc":"Capture each first, with a photo.","growth.custom":"Add your own (e.g. did a pull-up)","growth.camTitle":"Add work/photo","growth.photoSaved":"Saved the work/photo","common.plusRecord":"＋ Log","common.plusAdd":"＋ Add","common.amount":"Amount","common.foot":"Every day with your family, in one place.","a11y.edit":"Edit",
    "review.title":"This month's review","review.daysLabel":"Health logs (days)","review.sleepLabel":"Avg sleep (h)","review.movesLabel":"Exercise logs","review.logsLabel":"Task logs","review.vsPrev":"vs last month: {parts}","review.openTasks":"Open tasks: {n}","review.note":"※ Just the facts you logged, listed — no good/bad judgment.","review.pDays":"records {v}d","review.pSleep":"sleep {v}h","review.pLogs":"tasks {v}",
    "album.title":"Memories","album.cancelSel":"Cancel","album.select":"Select","album.loading":"Loading…","album.bulkAdd":"Add photos in bulk (auto-sorted by date taken)","album.selHint":"Tap photos to select (up to {n}) → use “Move to another” below to move them together to another family member.","album.empty":"Keep them with a photo and a note","album.selCount":"{n} selected","album.moveBtn":"Move to another","album.moveDesc":"Move the {n} selected memories together.",
    "points.title":"Helper points","points.total":"Total {n} pt","points.week":" (this week {n})","points.custom":"Add your own (+1pt)",
    "allow.title":"Allowance book","allow.balance":"Left","allow.memoPh":"Memo (snacks, etc. · optional)","allowdir.in":"Got","allowdir.out":"Spent","allowdir.save":"Saved",
    "meds.namePh":"Med or supplement name (e.g. antibiotic, vitamin)",
    "belong.title":"Belongings (by day)","belong.empty":"Tap ＋ at bottom-right to add belongings",
    "foodreg.title":"Food registry","foodreg.desc":"Register foods you use often.","foodreg.addFood":"Register food/meal","foodreg.calc":"Calculate daily food amount",
    "supply.title":"Supplies stock","supply.emptyMe":"Keep supplements and daily items from running out.","supply.empty":"Register foods and we'll auto-track what's left","supply.bought":"Bought","supply.check":"Check","supply.lineOut":"May be out — time to restock","supply.lineLow":"About {n} days left","supply.lineOk":"In stock (about {n} days left)","supply.careOut":"Out of stock — restock","supply.careLow":"{n} left — restock soon",
    "exp.title":"Expenses","exp.scopeThisFallback":"This one","exp.scopeAll":"Everyone","exp.emptyAll":"No expenses recorded yet.","exp.emptyThis":"Tap ＋ at bottom-right to add","exp.total":"Total","exp.year":"{y}","exp.monthlyAvg":"Monthly avg","exp.annual":"Annual est.","exp.byMember":"By member","exp.byCategory":"By category","exp.trend":"Monthly trend","exp.trendRecent":" (last {n} mo)","exp.trendEmpty":"As data grows, the monthly trend will appear.","exp.delLabel":"expense on {date}","exp.editTitle":"Edit expense","exp.dateLabel":"Date (for late receipts, proxy entry, etc.)",
    "certs.title":"Care & certificates","certs.cert":"Certificate","certs.addCert":"＋ Add certificate","certs.empty":"Tap ＋ to pick a type and date, then save a certificate.","certs.certHint":"Certificates (tap to enlarge)","certs.noDate":"No date","certs.yearLabel":"{y}","certs.addablePhoto":"Records you can add a photo (certificate) to","certs.tapAddPhoto":"Tap to add a certificate photo","renew.expired":"Expired {n}d","renew.today":"Due today","renew.left":"{n}d left",
    "common.memoOpt":"Memo (optional)","exp.addTitle":"Record expense","exp.addHint":"Saved with today's date. Tap an item to edit.","exp.notePh":"Memo (optional)","belong.addTitle":"Add belongings","belong.addPh":"e.g. gym clothes / library book / calligraphy set","belong.dowSuffix":"",
    "hub.title":"What would you like to record?","hub.addable":"Add a feature","hub.schedulePet":"Care & plans","hub.scheduleMe":"Plans & to-dos","hub.toilet":"Toilet log","hub.routine":"Routines (habits)","hub.health":"Weight & body","hub.belong":"Belongings (by day)","hub.bday":"Birthdays & anniversaries",
    "del.confirmTitle":"Delete this?","del.confirmBody":"Delete “{label}”. This can’t be undone.","del.confirmBodyPlain":"This can’t be undone.","del.confirmBtn":"Delete",
    "health.addTitle":"Body record","health.bp":"Blood pressure","health.temp":"Temperature","health.glucose":"Blood glucose","health.bpHigh":"Sys","health.bpLow":"Dia","health.optionalPh":"optional","health.smallAnimalHint":"Small animals: 0.1 g steps","health.condLabel":"Condition","health.saveBtn":"Log body","health.targetWeight":"Target weight","health.targetHint":"Shows the gap to your target.",
    "diary.quickHealthy":"Doing well today (one tap)","diary.hint":"Only when you want details (optional).","diary.energy":"Energy","diary.appetite":"Appetite","diary.poop":"Poop","diary.sleep":"Sleep","diary.other":"Other","diary.symptoms":"Symptoms","diary.hours":"{h} h","diary.hoursSuffix":"h","diary.hoursPh":"hrs","diary.walk":"Walk / outing","diary.hospital":"Went to the clinic","diary.periodPriv":"A private record, just for you","diary.periodNote":"Last {last} · next around {next} (~{avg}-day cycle)","diary.notePh":"Daily notes, clinic visit, a quick word…","diary.delPhoto":"Delete photo","diary.addPhoto":"Add a photo (meds, symptoms, etc.)","diary.saveBtn":"Save today's notes",
    "feed.addTitle":"Meal log","feed.servingLabel":"Amount per serving","feed.servingPh":"e.g. 100","feed.hintSet":"1 serving = {g}g, applied to the total (set once and you're done)","feed.hintUnset":"You can log without setting this (set it to reflect in the total)","feed.amount":"Amount","feed.previewPre":"= about ","feed.previewPost":" ({n} servings)","feed.saveBtn":"Log meal","feed.today":"Today's total ~{g}g ({n})",
    "sched.titlePet":"Add care or plan","sched.titleSelf":"Add health or care","sched.titleMe":"Add plan or to-do","sched.frequent":"Frequent","sched.contentPh":"Enter details…","sched.addLabelPh":"Add {label}…","sched.content":"item","sched.dateOptMe":"Date / deadline (optional)","sched.time":"Time","sched.dateHint":"Add a date or deadline and it appears on that day's calendar.","sched.certPhoto":"Certificate / photo (optional)","sched.changePhoto":"Change photo","sched.attachPhoto":"＋ Attach photo","sched.notify":"Notify","sched.quickAdd":"One-tap add (copy last)","sched.lastDate":"Last {date}","sched.dateDone":"Date done","sched.dateDate":"Date","sched.dateVisit":"Visit date","sched.dateDue":"Due","care.fallback":"Care","filter.all":"All",
    "toilet.hint":"Tap to log (today, current time).","toilet.pee":"Pee","toilet.success":"✓ Success","toilet.fail":"✕ Miss","toilet.hardness":"Stool firmness (7 levels)","toilet.bristolNote":"4 is healthy. If 1 or 7 keeps up, check with your vet.","toilet.alertBody":"Watch for: GI foreign objects, intestinal blockage, poisoning","toilet.alertLink":"See the hazards list","toilet.ideal":" (ideal)","toilet.disclaimer":"A guide for when to see a vet (not a diagnosis).","toilet.trendLoose":"Loose stools have continued. If it lasts, consider seeing a vet.","toilet.trendHard":"Hard stools have continued. Watch hydration and diet; see a vet if concerned.",
    "emg.title":"Night & emergency","emg.lead":"If something's wrong, call the clinic first. Don't treat on your own — follow their guidance.","emg.step1":"Call","emg.callDefault":"Regular / night emergency","emg.registerHosp":"Register a clinic contact","emg.registerHospSub":"Keep night-emergency & regular vet numbers handy","emg.note1":"Whether they can see you and how varies by clinic, and some need a call ahead. Confirm hours and contact with the clinic.","emg.redHead":"These signs: call right now, don't hesitate","emg.dontHead":"What not to do","emg.dont1":"Making them vomit, or giving meds/water, on your own","emg.dont2":"Deciding to “wait and see” from web info alone","emg.dont3":"Call the clinic first and follow their guidance","emg.step2":"What to tell them","emg.profNone":"No profile yet","emg.toxHead":"Ingestion check details","emg.toxWhat":"What","emg.toxAmount":"Amount","emg.toxWhen":"When","emg.toxWeight":"Weight","emg.toxSymptom":"Symptom","emg.say1":"Current state (consciousness, breathing, seizures, bleeding, vomiting/diarrhea)","emg.say2":"When and what happened (if ingested: what, how much, time)","emg.say3":"Chronic conditions, current meds, whether you have a regular vet","emg.tipsHead":"To explain in more detail","emg.step3":"Bring","emg.note2":"Getting seen matters more than packing. It's fine to head out with just what's on hand.","emg.contactsTitle":"Saved contacts","emg.register":"＋ Register","emg.contactsEmpty":"It helps to save your vet clinic and family/sitter numbers. You can call from here, and they're kept on cards.","emg.groupHosp":"🏥 Vet clinic","emg.groupPerson":"👤 Family / sitter","emg.addNumber":"Add number","emg.hospFallback":"Clinic","emg.contactFallback":"Contact","emg.prepHead":"Everyday prep (when things are calm)","emg.foot":"※ Clinic info can change — always confirm with the clinic. In an emergency, don't hesitate to call your vet or a nearby night-emergency clinic.",
    "disaster.title":"Disaster & evacuation prep","disaster.alert":"In a disaster, evacuating together with your pet is the norm. Prepare day to day and check your evacuation site in advance.","disaster.shelterTitle":"Our evacuation site","disaster.registerShelter":"＋ Register a site","disaster.shelterEmpty":"Share evacuation and sitter options with family. Kept on cards too.","disaster.shelterFallback":"Evacuation site","disaster.prepTitle":"Go-bag & stockpile (for pets)","disaster.tipsHead":"Key points when it counts","disaster.foot":"※ Whether designated shelters accept pets, and where, varies by municipality. Always confirm in advance with your local government or neighborhood disaster group.",
    "safety.sectionLabel":"In an emergency","safety.sectionNote":"From your saved info, quickly make a lost-pet poster or emergency card.","safety.toxicShort":"Toxic & poisoning","safety.emergencyShort":"Night & emergency","safety.emergencyCard":"Emergency card","safety.lostPoster":"Lost-pet poster","safety.disasterShort":"Disaster & evacuation",
    "common.saveImage":"Save as image","common.print":"Print","common.addPhotoMax4":"Add photos (up to 4)","ecard.meFallback":"Me","ecard.allergy":"Allergies / contraindications","ecard.meds":"On medication","ecard.contacts":"Emergency contacts / regular vet","ecard.contactsEmpty":"※ Register contacts in “Important info” and they'll show here","ecard.addInfo":"Add contacts / info","ecard.note":"※ To show or print and carry for emergencies. Data is stored on your device, so it shows even without signal.","ecard.fileSuffix":"emergency-card",
    "lost.step0":"Place & time","lost.step1":"Pet info","lost.step2":"Poster","lost.stepFmt":"{n}. {lab}","lost.step0LeadBold":"First, stay calm.","lost.step0LeadRest":" Enter where and when they were last seen. You can fix it later.","lost.placeLabel":"Where last seen","lost.placeHint":"Enter where they may have gone missing","lost.placePh":"e.g. near the park entrance / by the station","lost.placeNoteLabel":"Place notes (optional)","lost.placeNotePh":"e.g. across from the convenience store / east exit","lost.whenLabel":"Date/time seen","lost.whenPh":"e.g. around 6pm on Sep 18","lost.step1Lead":"We'll make the poster from this. Check the photo and details.","lost.featType":"Type","lost.featCoat":"Coat","lost.featGender":"Sex","lost.featAge":"Age","lost.featWeight":"Weight","lost.featCollar":"Collar / harness","lost.collarLabel":"Collar / harness (optional)","lost.collarPh":"e.g. red collar with ID tag","lost.situationLabel":"How they got out (optional)","lost.situationPh":"e.g. startled by fireworks, slipped the leash","lost.temperLabel":"Temperament (auto-adjusts the plea)","lost.noteLabel":"Anything else (optional)","lost.notePh":"e.g. please help share on social media","lost.registerContact":"Register a contact (needed for finders to reach you)","lost.found":"Found","lost.headDog":"Lost dog — please help","lost.headOther":"Please help find","lost.sightPlace":"Last seen at","lost.sightWhen":"Seen on","lost.situationTitle":"How they got out","lost.contactPlea":"If you see them, please contact us here","lost.contactEmpty":"※ Register an emergency contact in “Important info” and it'll show here","lost.action":"[Important] If you see them, please call this number right away. Please don't chase them.","lost.footNote":"Please don't chase — let us know where and when you saw them. Print or show on screen; works without signal.","lost.afterTitle":"Done. Next, let's spread the word.","lost.foundToggle":"Found (show “Found” on the poster)","lost.privacy":"We don't include your address or microchip number. Only saved contacts are shown.","lost.nextPet":"Next: pet info","lost.back":"Back","lost.makePoster":"Make poster","lost.share":"Share","lost.fileSuffix":"lost","temper.unset":"Not set","temper.friendly":"Friendly","temper.normal":"Normal","temper.timid":"Timid",
    "ob.title":"Your family's every day, in one place.","ob.sub":"Pets and kids alike — from daily records to being ready for the unexpected.","ob.start":"Get started","ob.trySample":"Try it with sample data","ob.h2":"First, let's add someone","ob.choicePet":"🐶 A pet (dog, cat, etc.)","ob.choiceMe":"👤 Myself (my own care too)","ob.choicePerson":"👨‍👩‍👧 Family (a person)","ob.skip":"Not now","ob.photoIcon":"Use a photo as the icon","ob.iconHintPre":"Pick an emoji, or add a photo from the ","ob.iconHintPost":" on the right","ob.namePetPh":"Name (e.g. Pochi)","ob.nameMePh":"Your name (e.g. Kaori)","ob.namePersonPh":"Name (e.g. Yuto)","ob.birthday":"Birthday (year optional)","ob.back":"Back",
    "tour.headseg.title":"Switch between Daily and Manage","tour.headseg.body":"Switch with these tabs at the top. Daily = that day's records; Manage = care plans, chores, important info, and more.","tour.fab.title":"Record from here","tour.fab.body":"Use the ＋ at the bottom-right to log plans, care, meals, weight, and more.","tour.cal.title":"Calendar","tour.cal.body":"See the family's plans at a glance. Tap a date to look back.","tour.home.title":"Per family member","tour.home.body":"Tap a family member on Home to open their page. Once open, switch anytime from the list at the top.","coach.cal.title":"Tap a date","coach.cal.body":"Colored dots are that day's plans. Tap to look back.","coach.record.title":"Log body & condition","coach.record.body":"Use the ＋ at the bottom-right to log weight, condition, meals, and diary.","coach.manage.title":"Daily chores & plans","coach.manage.body":"To-dos and plans go here. Tap \"Done\" to see time since last.","tour.next":"Next","tour.skip":"Skip","common.ok":"OK",
  },
  es:{
    "nav.home":"Inicio","nav.calendar":"Calendario","nav.settings":"Ajustes","title.daily":"Diario",
    "seg.daily":"Diario","seg.manage":"Gestionar",
    "home.family":"Familia","home.okNoRecord":"Aún sin registros","home.okPet":"{name} está bien","home.okGeneric":"Todo bien",
    "level.ok":"En orden","level.warn":"Atención","level.alert":"Necesita cuidado","level.none":"Sin datos","level.memorial":"En memoria",
    "home.layerToday":"Hoy","home.calmTitle":"Todo tranquilo hoy","home.calmNone":"Que tengas un día tranquilo",
    "home.calmOnePet":"{emoji} {name} está tranquilo","home.calmOne":"{emoji} {name} también está tranquilo","home.calmAll":"{emojis} Todos tranquilos",
    "home.todayTodos":"Tareas de hoy","home.export":"Exportar","home.moreCount":"{n} más",
    "home.dontMiss":"No te lo pierdas","home.upcoming":"Próximamente","home.quickCond":"¿Cómo están todos hoy?","home.quickCondBtn":"Todo bien",
    "home.restock":"Hora de reponer","home.recap":"Un pequeño resumen","home.statWeekCare":"Cuidados esta semana","home.statTodayRoutine":"Rutinas de hoy",
    "rel.today":"Hoy","rel.overdue":"Vencido","rel.tomorrow":"Mañana","rel.inDays":"En {d} días","rel.dueInDays":"Vence en {d} días","rel.overdueBy":"{d} d de retraso",
    "settings.title":"Ajustes","set.language":"Idioma","set.appearance":"Apariencia",
    "theme.aria":"Tema","theme.system":"Según el dispositivo","theme.light":"Claro","theme.dark":"Oscuro",
    "set.notifications":"Notificaciones","set.notifDesc":"Avisos suaves para citas y cumpleaños.","set.notifOn":"Notificaciones activadas","set.notifDenied":"Las notificaciones están desactivadas en los ajustes del dispositivo","set.notifAllow":"Permitir notificaciones",
    "set.weather":"Ubicaciones del clima","set.weatherDesc":"Clima para casa, la casa de la familia, el parque — hasta {n} lugares.","set.weatherMax":"Hasta {n} lugares. Quita uno para añadir más.","set.addLocation":"Añadir una ubicación",
    "wx.first":"Arriba","wx.moveUp":"Subir","wx.moveDown":"Bajar","wx.pinTop":"Fijar arriba","wx.rename":"Renombrar","wx.delete":"Eliminar","wx.namePlaceholder":"Nombre del lugar (p. ej. Casa, De la familia)",
    "common.save":"Guardar","common.cancel":"Cancelar","common.stop":"Cancelar",
    "set.colorTime":"Cuándo cambian los colores (cuidados y registro de tareas)","set.colorWarn":"Se vuelve amarillo tras","set.colorAlert":"Se vuelve rojo tras","set.colorNow":"Ahora: ","set.colorDaySuffix":"d → ","unit.dShort":"d",
    "set.petSafety":"Seguridad de la mascota","safety.toxic":"Alimentos tóxicos y peligros","safety.emergency":"Preparación para urgencias nocturnas","safety.disaster":"Preparación ante desastres y evacuación",
    "set.backup":"Copia de seguridad","set.backupDesc":"Tus fotos y registros se quedan solo en este dispositivo. ","set.backupDesc2":"Exporta para conservarlos seguros.","backup.export":"Exportar datos (con fotos)","backup.exportCsv":"Exportar registros como CSV","backup.restoreWarn":"Restaurar sobrescribe tus datos actuales con la copia. ¿Continuar?","backup.chooseFile":"Elige un archivo para restaurar","backup.restore":"Restaurar desde copia",
    "set.familyShare":"Compartir con la familia","share.settings":"Ajustes de uso compartido",
    "set.about":"Acerca de","about.help":"Cómo funciona","about.whatsNew":"Novedades","about.tourAgain":"Repetir el tutorial","about.aboutApp":"Sobre esta app","about.reset":"Borrar datos y empezar de nuevo",
    "rel.daysAgo":"hace {n} días","rel.today2":"Hoy","rel.overdueDeadline":"Vencido","rel.todayDeadline":"Vence hoy","rel.dueInDaysDeadline":"Vence en {n} días",
    "common.add":"Añadir","common.delete":"Eliminar","common.edit":"Editar","common.done":"Hecho","common.clear":"Borrar","common.me":"Yo","common.optional":" (opcional)",
    "a11y.delete":"Eliminar","a11y.pickColor":"Elegir un color","a11y.editProfile":"Editar perfil","a11y.editPhotoProfile":"Editar foto y perfil","a11y.editIconName":"Cambiar icono y nombre",
    "ph.name":"Nombre","ph.title":"Título",
    "gender.boy":"Niño","gender.girl":"Niña","neuter.done":"Sí","neuter.not":"Todavía no",
    "ptype.baby":"Bebé","ptype.child":"Niño/a","ptype.adult":"Adulto","ptype.senior":"Mayor",
    "toast.saved":"Guardado ✓","toast.added":"Añadido ✓","toast.deleted":"Eliminado","toast.nameNeeded":"Introduce un nombre","toast.titleNeeded":"Introduce un título",
    "toast.healthSaved":"Registro de salud guardado 📈","toast.weightNum":"El peso debe ser un número","toast.healthNeeded":"Introduce un peso u otro valor","toast.heightNum":"La altura debe ser un número",
    "toast.foodSaved":"Comida guardada 🍚","toast.foodNameNeeded":"Introduce el nombre de la comida","toast.pickFood":"Elige una comida","toast.amountNeeded":"Introduce una cantidad","toast.qtyNeeded":"Introduce una cantidad","toast.milkNeeded":"Introduce la cantidad de leche (ml)",
    "toast.diarySaved":"Notas de hoy guardadas 📝","toast.diaryPick":"Elige cómo está, o añade una nota",
    "toast.cardSaved":"Tarjeta guardada 📌","toast.cardNeed":"Añade algún detalle o una foto","toast.medSaved":"Medicación guardada","toast.medName":"Introduce el nombre de la medicación","toast.stockSaved":"Stock guardado 📦","toast.routineSaved":"Rutina guardada 🗓","toast.noteSaved":"Nota guardada","toast.noteNeed":"Añade una foto, una nota o una entrada de diario",
    "toast.memorySaved":"Guardado en recuerdos 📸","toast.memoryDeleted":"Recuerdo eliminado","toast.photoMax":"Hasta 4 fotos","toast.photoAdded":"Foto añadida 📷","toast.fileTooBig":"Archivo demasiado grande (máx. 20 MB)","toast.imgFail":"No se pudo cargar la imagen","toast.imgSaveFail":"No se pudo guardar. Prueba con otra imagen.","toast.storageFull":"No hay suficiente almacenamiento",
    "toast.recordedWell":"Marcado como bien 👌","toast.alreadyRecorded":"Ya registrado hoy 👌","toast.pickWho":"Elige a quién registrar","toast.dupItem":"Ese elemento ya existe","toast.tomorrow":"Movido a mañana","toast.dateFixed":"Fecha actualizada ✓","toast.iconSet":"Icono asignado","toast.certDeleted":"Certificado eliminado","toast.growthSaved":"Guardado en hitos","toast.belongNeeded":"Introduce un objeto","toast.belongAdded":"Objeto añadido 🎒",
    "toast.logged":"Registrado {emoji} {title} ✓","toast.memberDeleted":"{name} eliminado",
    "care.overdue":"Vencido {n}","care.soon":"Vence pronto {n}","care.ok":"Cuidados en orden","vis.private":"Privado","vis.shared":"Compartido",
    "hero.addPhoto":"Añadir foto","hero.rainbow":"Puente del arcoíris","hero.togetherThanks":" · {n} días juntos, gracias","me.setBirthday":"Añade tu cumpleaños",
    "prof.title":"Perfil de {name}","prof.familyDefault":"Familia","sp.catShort":"Gato","sp.dogShort":"Perro","sp.petShort":"Mascota",
    "prof.usePhoto":"Usar una foto","prof.backToEmoji":"Volver al emoji","prof.nickname":"Apodo (opcional)","ph.nickname":"p. ej. Yui, Yui-chan","prof.folder":"Carpeta (agrupar, opcional)","ph.folderPerson":"p. ej. Familia / Padres arriba","ph.folderPet":"p. ej. Perros / Hámster",
    "prof.calColor":"Color del calendario","prof.calColorDesc":"Más fácil de distinguir en el calendario.","prof.birthday":"Cumpleaños (año opcional)","prof.gotcha":"Día de adopción (año opcional)","prof.gotchaDesc":"Para celebrar el día en que llegó a tu vida.",
    "prof.breedCat":"Raza","prof.breedDog":"Raza","prof.breedOther":"Tipo","ph.breedDog":"Busca o escribe una raza (cualquiera vale)","ph.breedCat":"Busca o escribe una raza (cualquiera vale)","ph.breedOther":"Tipo (texto libre)","prof.breedDescDog":"Ayuda a estimar la duración del paseo.","prof.breedDescOther":"Para registros acordes a su tamaño.",
    "prof.coat":"Color del pelaje (opcional)","ph.coat":"Escribe para buscar (texto libre)","prof.gender":"Sexo (opcional)","prof.genderDesc":"También aparece en el cartel de mascota perdida.","prof.neuter":"Esterilización","prof.microchip":"Número de microchip (opcional)","ph.microchip":"Número de 15 dígitos (p. ej. 392...)","prof.microchipDesc":"Útil para mascota perdida o desastres.",
    "prof.personType":"Tipo (qué campos mostrar)","prof.blood":"Grupo sanguíneo (opcional)","blood.suffix":"","prof.rainbow":"Puente del arcoíris (memorial, opcional)","prof.rainbowSet":"Registrar una despedida y pasar a modo memorial","prof.rainbowDesc":"Pausa los recordatorios y muestra los recuerdos con suavidad.",
    "prof.visShared":"Comparte los registros de este miembro con la familia invitada.","prof.visPrivate":"Se guarda solo en este dispositivo, no se comparte con la familia.","prof.visNote":"Marca como «Solo yo» lo que sea privado: alergias, ciclo, notas médicas.","prof.saveMember":"Guardar","prof.deleteMember":"Eliminar este miembro",
    "fun.gotchaToday":"¡{y} años juntos!","fun.gotchaTodayNoYear":"¡Día de adopción!","fun.gotchaAnniv":"Día de adopción {date}","fun.gotchaAnnivY":"Día de adopción {date} ({y} a)","fun.together":"{n} días juntos","fun.neuter":"Esterilización: {s}","member.addFamily":"Añadir familia o mascota",
    "word.pet":"cuidados","word.person":"plan","rec.memberTitle":"{word} de {name}","rec.tapEditDate":"Toca para editar la fecha",
    "rel.stillNone":"Aún sin registrar","rel.weeksAgo":"hace {n} sem","rel.monthsAgo":"hace ~{n} mes(es)",
    "rec.routineTitle":"Rutinas de hoy","rec.addFromPlus":"Añade con el botón ＋","rec.choreTitlePet":"Cuidado diario","rec.choreTitleMe":"Registro de autocuidado","rec.choreTitleOther":"Registro de cuidados","rec.choreDescPet":"Toca «Hecho» para registrar. El color muestra el tiempo desde la última vez.","rec.choreDescOther":"Toca «Hecho» para registrar. Ve de un vistazo el tiempo transcurrido.","rec.did":"Hecho","rec.lastDone":"Última vez {date} · {txt}","rec.totalCount":" ({n} en total)",
    "common.all":"Todos","a11y.prevMonth":"Mes anterior","a11y.nextMonth":"Mes siguiente","cal.addRecord":"＋ Registrar","cal.noRecords":"Aún sin registros","cal.exportIcs":"Exporta los eventos a tu calendario (.ics)","cal.foot":"Toca una fecha para registrar o repasar","cal.dayTitle":"{wd}, {md}",
    "bday.month":"Mes","bday.day":"Día","bday.yearOpt":"Año (opcional)","bday.monthSuffix":"","bday.daySuffix":"",
    "common.close":"Cerrar","food.editTitle":"Editar comida","food.newTitle":"Añadir comida","ph.foodName":"Nombre de la comida (p. ej. Pollo, seco)","ph.brand":"Marca (opcional)","food.type":"Tipo","foodtype.dry":"Seco","foodtype.wet":"Húmedo","foodtype.homemade":"Casero","foodtype.treat":"Premio","foodtype.supplement":"Suplemento","foodtype.other":"Otro","food.amountUnit":"Cantidad por ración (opcional)","ph.amount":"Cant.","foodunit.g":"g","foodunit.ml":"ml","foodunit.piece":"uds","food.timesTime":"Veces/día y hora (opcional)","ph.times":"×/día","ph.feedTime":"Hora (p. ej. 7:00, 19:00)","food.kcal":"Calorías (opcional, si se conocen)","food.kcalDesc":"Calcula las calorías automáticamente. Solo la cantidad también vale.","food.mealTitle":"Registrar una comida","food.food":"Comida","food.when":"Cuándo","mealslot.morning":"Mañana","mealslot.noon":"Mediodía","mealslot.night":"Noche","mealslot.treat":"Premio","food.qty":"Cantidad","food.approxKcal":"~{kc} kcal","food.logBtn":"Registrar","bday.addTitle":"Añadir un cumpleaños o aniversario","ph.bdayName":"Nombre (p. ej. Cumpleaños de Yui)","bday.dateYearOpt":"Fecha (año opcional)",
    "rec.healthTitle":"Salud","chart.weight":"Peso","chart.height":"Altura","chart.bpSys":"Presión arterial (sist.)","health.chartSoon":"Un registro más y aparecerá la gráfica de peso.","health.emptyPlus":"Registra el peso y más con el botón ＋.","health.recordOf":"registro de {date}","health.bpPrefix":"PA ",
    "rec.medsTitle":"Medicación y suplementos","med.finished":"Finalizado","med.progress":"{days} días · día {n} · quedan {left}","med.tookDone":"Tomado ✓","med.took":"Tomar","ph.medName":"Nombre del medicamento o suplemento (p. ej. vitamina)","med.daysUnit":"días","common.register":"＋ Registrar",
    "rec.sheetsTitle":"Todo en una hoja","rec.sheetsDescPet":"Una hoja para el veterinario o el cuidador.","rec.sheetsDescOther":"Una hoja para relevos o urgencias.","rec.vetSummary":"Resumen para el veterinario","rec.careSheet":"Hoja de cuidados para el cuidador","rec.lostPoster":"Cartel de mascota perdida","rec.handoverToday":"Hoja de relevo de hoy","rec.emergencyCard":"Tarjeta de emergencia",
    "rec.feedTitle":"Comida y raciones","food.delMeal":"registro de comida","food.delRecord":"registro","food.registerLink":"＋ Añadir comida","food.todayCount":"Hoy: {n}","food.pickToLog":"Elige una comida para registrarla.","food.recordLabel":"Registrado","food.tapToLog":"Toca para registrar","food.todayMeal":"Toca para registrar la comida de hoy.","food.amountOnly":"Registrar solo cantidad","food.registerBig":"Añadir una comida","food.defaultName":"Comida",
    "rec.toiletTitle":"Tasa de acierto en el baño","toilet.peeRate":"Acierto pipí","toilet.poopRate":"Acierto caca","toilet.none":"Sin datos","toilet.count":" ({success}/{total})","toilet.logBtn":"Registrar baño",
    "rec.diaryTitle":"Notas de hoy","diary.recordedDone":"Estado de hoy registrado","diary.editMore":"Añadir / editar","diary.recordBtn":"Registrar estado","chart.energy":"Tendencia de energía (1–5)","chart.sleep":"Tendencia de sueño","chart.appetite":"Tendencia de apetito (1–3)","diary.empty":"Regístralo con «Registrar estado»",
    "life.editTitle":"Editar registro","life.newTitle":"Registrar este día","cat.memory":"Recuerdo / diario","cat.event":"Evento","ph.eventTitle":"Título del evento (p. ej. Veterinario)","ph.memoTitle":"Una nota (opcional, p. ej. Primera vez en la playa)","common.photo":"Foto","ph.diary":"Diario (opcional)","life.tag":"Etiqueta","life.firstTag":"Primera vez","ph.tag":"p. ej. Recital / Almuerzo / Bici","life.date":"Fecha","life.time":"Hora","life.repeat":"Repetir","repeat.none":"No","repeat.daily":"Cada día","repeat.weekly":"Cada semana","repeat.monthly":"Cada mes","repeat.yearly":"Cada año","life.notify":"Notificaciones (opcional)","notif.allowShort":"Permitir","remind.0":"Al empezar","remind.5":"5 min antes","remind.30":"30 min antes","remind.60":"1 h antes","remind.1440":"El día antes","life.notifyHint":"Demasiados 🔔 se pasan por alto — deja solo los necesarios.",
    "rec.trayTitle":"Información importante","rec.trayCount":" ({n})","rec.trayHint":"Guarda contactos, alergias e info del veterinario como tarjetas.","card.nightTag":"Noche","card.hoursPh":"Horario (opcional, p. ej. 24 h / noche 20:00–8:00)","card.addrPh":"Dirección (opcional)","card.nightToggle":"Marcar como la clínica a la que llamar primero de noche o en urgencias",
    "card.editTitle":"Editar tarjeta","card.newTitle":"Añadir tarjeta","cardkind.emergency":"Contacto de emergencia","cardkind.allergy":"Alergias y prohibiciones","cardkind.hospital":"Notas del veterinario","cardkind.shelter":"Refugio y desastres","cardkind.insurance":"Datos del seguro","cardkind.other":"Nota","ph.cardTitle":"Título (p. ej. Veterinario habitual)","ph.cardBody":"Contactos, alergias, notas, medicación restante, etc.",
    "rec.walkTitle":"Registro de paseos","walk.goalTitle":"Guía de este mes (referencia)","walk.distance":"Distancia","walk.count":"Paseos","walk.timesUnit":"","walk.dcPre":"Según la raza","walk.dcMid":" y la edad","walk.dcPost1":", una ","walk.dcBold":"guía general (referencia)","walk.dcPost2":". Las necesidades reales varían según la salud y cada perro — ajústalas a su estado y al consejo de tu veterinario.","walk.dcBreedUnset":" (sin definir → mediano)","walk.dcAgeUnset":" (sin definir → adulto)","walk.reviewTitle":"Resumen de paseos","walk.vsLast":"vs el mes pasado ","walk.summaryThisMonth":"Este mes ","walk.walksUnit":" paseos","walk.summaryMin":" · {m} min","walk.summarySep":" / total 6 meses ","walk.time":"Tiempo","walk.gpsRecording":"Grabando ruta por GPS ({n} pts)","walk.gpsStart":"Grabando ruta por GPS… empieza a caminar y la distancia aumenta","walk.stopSave":"Terminar y guardar","walk.otherRunning":"Se está registrando el paseo de otro","walk.startBtn":"Empezar paseo","walk.delLabel":"registro de paseo",
    "growth.title":"Registro de crecimiento","growth.desc":"Captura cada primera vez, con una foto.","growth.custom":"Añade el tuyo (p. ej. hizo una dominada)","growth.camTitle":"Añadir trabajo/foto","growth.photoSaved":"Trabajo/foto guardado","common.plusRecord":"＋ Registrar","common.plusAdd":"＋ Añadir","common.amount":"Cantidad","common.foot":"Cada día con tu familia, en un solo lugar.","a11y.edit":"Editar",
    "review.title":"Resumen de este mes","review.daysLabel":"Registros de salud (días)","review.sleepLabel":"Sueño medio (h)","review.movesLabel":"Registros de ejercicio","review.logsLabel":"Registros de tareas","review.vsPrev":"vs el mes pasado: {parts}","review.openTasks":"Tareas pendientes: {n}","review.note":"※ Solo los hechos que registraste — sin juicios de bueno/malo.","review.pDays":"registros {v} d","review.pSleep":"sueño {v} h","review.pLogs":"tareas {v}",
    "album.title":"Recuerdos","album.cancelSel":"Cancelar","album.select":"Seleccionar","album.loading":"Cargando…","album.bulkAdd":"Añadir fotos en lote (ordenadas por fecha de captura)","album.selHint":"Toca fotos para seleccionar (hasta {n}) → usa «Mover a otro» abajo para moverlas juntas a otro miembro de la familia.","album.empty":"Guárdalos con una foto y una nota","album.selCount":"{n} seleccionadas","album.moveBtn":"Mover a otro","album.moveDesc":"Mover juntos los {n} recuerdos seleccionados.",
    "points.title":"Puntos de ayuda","points.total":"Total {n} pt","points.week":" (esta semana {n})","points.custom":"Añade el tuyo (+1 pt)",
    "allow.title":"Libreta de paga","allow.balance":"Queda","allow.memoPh":"Nota (golosinas, etc. · opcional)","allowdir.in":"Recibió","allowdir.out":"Gastó","allowdir.save":"Ahorró",
    "meds.namePh":"Nombre del medicamento o suplemento (p. ej. antibiótico, vitamina)",
    "belong.title":"Objetos (por día)","belong.empty":"Toca ＋ abajo a la derecha para añadir objetos",
    "foodreg.title":"Registro de comidas","foodreg.desc":"Registra las comidas que usas a menudo.","foodreg.addFood":"Registrar comida/ración","foodreg.calc":"Calcular la ración diaria",
    "supply.title":"Stock de consumibles","supply.emptyMe":"Que no se agoten los suplementos ni los productos diarios.","supply.empty":"Registra comidas y calcularemos lo que queda automáticamente","supply.bought":"Comprado","supply.check":"Ver","supply.lineOut":"Puede que se haya agotado — hora de reponer","supply.lineLow":"Quedan unos {n} días","supply.lineOk":"En stock (unos {n} días)","supply.careOut":"Sin stock — reponer","supply.careLow":"Quedan {n} — reponer pronto",
    "exp.title":"Gastos","exp.scopeThisFallback":"Este","exp.scopeAll":"Todos","exp.emptyAll":"Aún sin gastos registrados.","exp.emptyThis":"Toca ＋ abajo a la derecha para añadir","exp.total":"Total","exp.year":"{y}","exp.monthlyAvg":"Media mensual","exp.annual":"Est. anual","exp.byMember":"Por miembro","exp.byCategory":"Por categoría","exp.trend":"Tendencia mensual","exp.trendRecent":" (últimos {n} meses)","exp.trendEmpty":"A medida que crezcan los datos, aparecerá la tendencia mensual.","exp.delLabel":"gasto del {date}","exp.editTitle":"Editar gasto","exp.dateLabel":"Fecha (para recibos tardíos, registro por otra persona, etc.)",
    "certs.title":"Visitas y certificados","certs.cert":"Certificado","certs.addCert":"＋ Añadir certificado","certs.empty":"Toca ＋ para elegir tipo y fecha, y guardar un certificado.","certs.certHint":"Certificados (toca para ampliar)","certs.noDate":"Sin fecha","certs.yearLabel":"{y}","certs.addablePhoto":"Registros a los que puedes añadir una foto (certificado)","certs.tapAddPhoto":"Toca para añadir la foto de un certificado","renew.expired":"Vencido {n} d","renew.today":"Vence hoy","renew.left":"Quedan {n} d",
    "common.memoOpt":"Nota (opcional)","exp.addTitle":"Registrar gasto","exp.addHint":"Se guarda con la fecha de hoy. Toca un elemento para editarlo.","exp.notePh":"Nota (opcional)","belong.addTitle":"Añadir objetos","belong.addPh":"p. ej. ropa de gimnasia / libro de la biblioteca / caja de caligrafía","belong.dowSuffix":"",
    "hub.title":"¿Qué quieres registrar?","hub.addable":"Añadir una función","hub.schedulePet":"Cuidados y planes","hub.scheduleMe":"Planes y tareas","hub.toilet":"Registro de baño","hub.routine":"Rutinas (hábitos)","hub.health":"Peso y cuerpo","hub.belong":"Objetos (por día)","hub.bday":"Cumpleaños y aniversarios",
    "del.confirmTitle":"¿Eliminar esto?","del.confirmBody":"Eliminar «{label}». No se puede deshacer.","del.confirmBodyPlain":"No se puede deshacer.","del.confirmBtn":"Eliminar",
    "health.addTitle":"Registro corporal","health.bp":"Presión arterial","health.temp":"Temperatura","health.glucose":"Glucosa","health.bpHigh":"Sist.","health.bpLow":"Diast.","health.optionalPh":"opcional","health.smallAnimalHint":"Animales pequeños: pasos de 0,1 g","health.condLabel":"Estado","health.saveBtn":"Registrar cuerpo","health.targetWeight":"Peso objetivo","health.targetHint":"Muestra la diferencia con tu objetivo.",
    "diary.quickHealthy":"Bien hoy (un toque)","diary.hint":"Solo cuando quieras dar detalles (opcional).","diary.energy":"Energía","diary.appetite":"Apetito","diary.poop":"Caca","diary.sleep":"Sueño","diary.other":"Otro","diary.symptoms":"Síntomas","diary.hours":"{h} h","diary.hoursSuffix":"h","diary.hoursPh":"h","diary.walk":"Paseo / salida","diary.hospital":"Fue a la clínica","diary.periodPriv":"Un registro privado, solo para ti","diary.periodNote":"Última {last} · próxima hacia {next} (ciclo ~{avg} días)","diary.notePh":"Notas del día, visita a la clínica, unas palabras…","diary.delPhoto":"Eliminar foto","diary.addPhoto":"Añadir una foto (medicación, síntomas, etc.)","diary.saveBtn":"Guardar las notas de hoy",
    "feed.addTitle":"Registro de comida","feed.servingLabel":"Cantidad por ración","feed.servingPh":"p. ej. 100","feed.hintSet":"1 ración = {g} g, se aplica al total (configúralo una vez y listo)","feed.hintUnset":"Puedes registrar sin configurar esto (configúralo para reflejarlo en el total)","feed.amount":"Cantidad","feed.previewPre":"= unos ","feed.previewPost":" ({n} raciones)","feed.saveBtn":"Registrar comida","feed.today":"Total de hoy ~{g} g ({n})",
    "sched.titlePet":"Añadir cuidado o plan","sched.titleSelf":"Añadir salud o cuidado","sched.titleMe":"Añadir plan o tarea","sched.frequent":"Frecuentes","sched.contentPh":"Escribe los detalles…","sched.addLabelPh":"Añadir {label}…","sched.content":"elemento","sched.dateOptMe":"Fecha / plazo (opcional)","sched.time":"Hora","sched.dateHint":"Añade una fecha o plazo y aparecerá en el calendario de ese día.","sched.certPhoto":"Certificado / foto (opcional)","sched.changePhoto":"Cambiar foto","sched.attachPhoto":"＋ Adjuntar foto","sched.notify":"Avisar","sched.quickAdd":"Añadir con un toque (copia el anterior)","sched.lastDate":"Última {date}","sched.dateDone":"Fecha realizada","sched.dateDate":"Fecha","sched.dateVisit":"Fecha de la cita","sched.dateDue":"Plazo","care.fallback":"Cuidado","filter.all":"Todos",
    "toilet.hint":"Toca para registrar (hoy, hora actual).","toilet.pee":"Pipí","toilet.success":"✓ Acierto","toilet.fail":"✕ Fallo","toilet.hardness":"Firmeza de las heces (7 niveles)","toilet.bristolNote":"El 4 es sano. Si el 1 o el 7 se mantienen, consulta a tu veterinario.","toilet.alertBody":"Cuidado con: cuerpos extraños, obstrucción intestinal, intoxicación","toilet.alertLink":"Ver la lista de peligros","toilet.ideal":" (ideal)","toilet.disclaimer":"Una guía de cuándo acudir al veterinario (no un diagnóstico).","toilet.trendLoose":"Las heces blandas han continuado. Si persisten, plantéate ver al veterinario.","toilet.trendHard":"Las heces duras han continuado. Vigila la hidratación y la dieta; ve al veterinario si te preocupa.",
    "emg.title":"Noche y urgencias","emg.lead":"Si algo va mal, llama primero a la clínica. No lo trates por tu cuenta — sigue sus indicaciones.","emg.step1":"Llamar","emg.callDefault":"Habitual / urgencias nocturnas","emg.registerHosp":"Registrar un contacto de clínica","emg.registerHospSub":"Ten a mano los números de urgencias y del veterinario habitual","emg.note1":"Que puedan atenderte y cómo varía según la clínica, y algunas requieren llamar antes. Confirma horarios y contacto con la clínica.","emg.redHead":"Estas señales: llama ya, sin dudarlo","emg.dontHead":"Qué no hacer","emg.dont1":"Provocarle el vómito o darle medicación/agua por tu cuenta","emg.dont2":"Decidir «esperar a ver» solo con info de internet","emg.dont3":"Llama primero a la clínica y sigue sus indicaciones","emg.step2":"Qué contarles","emg.profNone":"Aún sin perfil","emg.toxHead":"Detalles de la ingesta","emg.toxWhat":"Qué","emg.toxAmount":"Cantidad","emg.toxWhen":"Cuándo","emg.toxWeight":"Peso","emg.toxSymptom":"Síntoma","emg.say1":"Estado actual (consciencia, respiración, convulsiones, sangrado, vómitos/diarrea)","emg.say2":"Cuándo y qué pasó (si ingirió: qué, cuánto, hora)","emg.say3":"Enfermedades crónicas, medicación actual, si tienes veterinario habitual","emg.tipsHead":"Para explicarlo con más detalle","emg.step3":"Llevar","emg.note2":"Que lo vean importa más que preparar. Está bien salir solo con lo que tengas a mano.","emg.contactsTitle":"Contactos guardados","emg.register":"＋ Registrar","emg.contactsEmpty":"Ayuda guardar los números de tu clínica y de la familia/cuidador. Puedes llamar desde aquí y quedan en las tarjetas.","emg.groupHosp":"🏥 Clínica veterinaria","emg.groupPerson":"👤 Familia / cuidador","emg.addNumber":"Añadir número","emg.hospFallback":"Clínica","emg.contactFallback":"Contacto","emg.prepHead":"Preparación cotidiana (cuando haya calma)","emg.foot":"※ La info de la clínica puede cambiar — confírmala siempre con ella. En una urgencia, no dudes en llamar a tu veterinario o a una clínica de urgencias cercana.",
    "disaster.title":"Preparación ante desastres y evacuación","disaster.alert":"En un desastre, evacuar junto a tu mascota es lo normal. Prepárate día a día y comprueba tu punto de evacuación por adelantado.","disaster.shelterTitle":"Nuestro punto de evacuación","disaster.registerShelter":"＋ Registrar un punto","disaster.shelterEmpty":"Comparte opciones de evacuación y de cuidador con la familia. También quedan en las tarjetas.","disaster.shelterFallback":"Punto de evacuación","disaster.prepTitle":"Mochila y reservas (para mascotas)","disaster.tipsHead":"Puntos clave cuando importa","disaster.foot":"※ Que los refugios designados acepten mascotas, y dónde, varía según el municipio. Confírmalo siempre por adelantado con tu ayuntamiento o grupo vecinal de emergencias.",
    "safety.sectionLabel":"En una emergencia","safety.sectionNote":"Con tu info guardada, crea rápido un cartel de mascota perdida o una tarjeta de emergencia.","safety.toxicShort":"Tóxicos e intoxicación","safety.emergencyShort":"Noche y urgencias","safety.emergencyCard":"Tarjeta de emergencia","safety.lostPoster":"Cartel de mascota perdida","safety.disasterShort":"Desastres y evacuación",
    "common.saveImage":"Guardar como imagen","common.print":"Imprimir","common.addPhotoMax4":"Añadir fotos (hasta 4)","ecard.meFallback":"Yo","ecard.allergy":"Alergias / contraindicaciones","ecard.meds":"En tratamiento","ecard.contacts":"Contactos de emergencia / veterinario","ecard.contactsEmpty":"※ Registra contactos en «Información importante» y aparecerán aquí","ecard.addInfo":"Añadir contactos / info","ecard.note":"※ Para mostrar o imprimir y llevar en emergencias. Los datos se guardan en tu dispositivo, así que se ven incluso sin señal.","ecard.fileSuffix":"tarjeta-emergencia",
    "lost.step0":"Lugar y hora","lost.step1":"Info de la mascota","lost.step2":"Cartel","lost.stepFmt":"{n}. {lab}","lost.step0LeadBold":"Primero, mantén la calma.","lost.step0LeadRest":" Indica dónde y cuándo se le vio por última vez. Puedes corregirlo después.","lost.placeLabel":"Dónde se le vio por última vez","lost.placeHint":"Indica dónde pudo perderse","lost.placePh":"p. ej. cerca de la entrada del parque / junto a la estación","lost.placeNoteLabel":"Detalles del lugar (opcional)","lost.placeNotePh":"p. ej. frente a la tienda / salida este","lost.whenLabel":"Fecha/hora en que se le vio","lost.whenPh":"p. ej. hacia las 18:00 del 18 de sept.","lost.step1Lead":"Haremos el cartel con esto. Revisa la foto y los datos.","lost.featType":"Tipo","lost.featCoat":"Pelaje","lost.featGender":"Sexo","lost.featAge":"Edad","lost.featWeight":"Peso","lost.featCollar":"Collar / arnés","lost.collarLabel":"Collar / arnés (opcional)","lost.collarPh":"p. ej. collar rojo con chapa","lost.situationLabel":"Cómo se escapó (opcional)","lost.situationPh":"p. ej. se asustó con fuegos artificiales y soltó la correa","lost.temperLabel":"Carácter (ajusta el mensaje automáticamente)","lost.noteLabel":"Algo más (opcional)","lost.notePh":"p. ej. ayuda a difundir en redes sociales, por favor","lost.registerContact":"Registra un contacto (necesario para que quien lo encuentre te avise)","lost.found":"Encontrado","lost.headDog":"Perro perdido — ayuda, por favor","lost.headOther":"Ayuda a encontrarlo, por favor","lost.sightPlace":"Visto por última vez en","lost.sightWhen":"Visto el","lost.situationTitle":"Cómo se escapó","lost.contactPlea":"Si lo ves, contáctanos aquí, por favor","lost.contactEmpty":"※ Registra un contacto de emergencia en «Información importante» y aparecerá aquí","lost.action":"[Importante] Si lo ves, llama a este número enseguida, por favor. No lo persigas.","lost.footNote":"No lo persigas — dinos dónde y cuándo lo viste. Imprime o muestra en pantalla; funciona sin señal.","lost.afterTitle":"Listo. Ahora, corre la voz.","lost.foundToggle":"Encontrado (mostrar «Encontrado» en el cartel)","lost.privacy":"No incluimos tu dirección ni el número de microchip. Solo se muestran los contactos guardados.","lost.nextPet":"Siguiente: info de la mascota","lost.back":"Atrás","lost.makePoster":"Crear cartel","lost.share":"Compartir","lost.fileSuffix":"perdido","temper.unset":"Sin definir","temper.friendly":"Sociable","temper.normal":"Normal","temper.timid":"Miedoso",
    "ob.title":"El día a día de tu familia, en un solo lugar.","ob.sub":"Mascotas y niños por igual — desde el registro diario hasta estar listos ante lo inesperado.","ob.start":"Empezar","ob.trySample":"Probar con datos de ejemplo","ob.h2":"Primero, añade a alguien","ob.choicePet":"🐶 Una mascota (perro, gato, etc.)","ob.choiceMe":"👤 Yo (también mi cuidado)","ob.choicePerson":"👨‍👩‍👧 Familia (una persona)","ob.skip":"Ahora no","ob.photoIcon":"Usar una foto como icono","ob.iconHintPre":"Elige un emoji, o añade una foto desde la ","ob.iconHintPost":" de la derecha","ob.namePetPh":"Nombre (p. ej. Pochi)","ob.nameMePh":"Tu nombre (p. ej. Kaori)","ob.namePersonPh":"Nombre (p. ej. Yuto)","ob.birthday":"Cumpleaños (año opcional)","ob.back":"Atrás",
    "tour.headseg.title":"Cambia entre Diario y Gestionar","tour.headseg.body":"Cambia con estas pestañas de arriba. Diario = los registros de ese día; Gestionar = planes de cuidado, tareas, información importante y más.","tour.fab.title":"Registra desde aquí","tour.fab.body":"Usa el ＋ de abajo a la derecha para registrar planes, cuidados, comidas, peso y más.","tour.cal.title":"Calendario","tour.cal.body":"Ve los planes de la familia de un vistazo. Toca una fecha para repasar.","tour.home.title":"Por cada miembro","tour.home.body":"Toca un miembro en Inicio para abrir su página. Una vez abierta, cambia cuando quieras desde la lista de arriba.","coach.cal.title":"Toca una fecha","coach.cal.body":"Los puntos de color son los planes de ese día. Toca para repasar.","coach.record.title":"Registra cuerpo y estado","coach.record.body":"Usa el ＋ de abajo a la derecha para registrar peso, estado, comidas y diario.","coach.manage.title":"Tareas y planes diarios","coach.manage.body":"Las tareas y planes van aquí. Toca «Hecho» para ver el tiempo desde la última vez.","tour.next":"Siguiente","tour.skip":"Omitir","common.ok":"OK",
  },
  zh:{
    "nav.home":"首页","nav.calendar":"日历","nav.settings":"设置","title.daily":"日常",
    "seg.daily":"日常","seg.manage":"管理",
    "home.family":"家人","home.okNoRecord":"暂无记录","home.okPet":"{name}很好","home.okGeneric":"一切都好",
    "level.ok":"正常","level.warn":"注意","level.alert":"需要照护","level.none":"无数据","level.memorial":"纪念中",
    "home.layerToday":"今天","home.calmTitle":"今天一切平静","home.calmNone":"祝你今天顺心",
    "home.calmOnePet":"{emoji} {name}很安稳","home.calmOne":"{emoji} {name}也很安稳","home.calmAll":"{emojis} 大家都很安稳",
    "home.todayTodos":"今天的待办","home.export":"导出","home.moreCount":"还有{n}项",
    "home.dontMiss":"别错过","home.upcoming":"即将到来","home.quickCond":"今天大家怎么样？","home.quickCondBtn":"都很好",
    "home.restock":"该补货了","home.recap":"小结","home.statWeekCare":"本周照护","home.statTodayRoutine":"今天的日常",
    "rel.today":"今天","rel.overdue":"已逾期","rel.tomorrow":"明天","rel.inDays":"{d}天后","rel.dueInDays":"{d}天后到期","rel.overdueBy":"逾期{d}天",
    "settings.title":"设置","set.language":"语言","set.appearance":"外观",
    "theme.aria":"主题","theme.system":"跟随设备","theme.light":"浅色","theme.dark":"深色",
    "set.notifications":"通知","set.notifDesc":"为日程和生日提供温和的提醒。","set.notifOn":"通知已开启","set.notifDenied":"通知在设备设置中已关闭","set.notifAllow":"允许通知",
    "set.weather":"天气地点","set.weatherDesc":"家、家人住处、公园的天气 — 最多{n}个地点。","set.weatherMax":"最多{n}个地点。删除一个再添加。","set.addLocation":"添加地点",
    "wx.first":"置顶","wx.moveUp":"上移","wx.moveDown":"下移","wx.pinTop":"固定到顶部","wx.rename":"重命名","wx.delete":"删除","wx.namePlaceholder":"地点名称（如 家、家人处）",
    "common.save":"保存","common.cancel":"取消","common.stop":"取消",
    "set.colorTime":"颜色变化的时机（照护与任务记录）","set.colorWarn":"变黄的天数","set.colorAlert":"变红的天数","set.colorNow":"当前：","set.colorDaySuffix":"天 → ","unit.dShort":"天",
    "set.petSafety":"宠物安全","safety.toxic":"有毒食物与危险","safety.emergency":"夜间与急救准备","safety.disaster":"防灾与疏散准备",
    "set.backup":"备份","set.backupDesc":"你的照片和记录仅保存在本设备上。 ","set.backupDesc2":"导出以妥善保存。","backup.export":"导出数据（含照片）","backup.exportCsv":"将记录导出为CSV","backup.restoreWarn":"恢复会用备份覆盖当前数据。是否继续？","backup.chooseFile":"选择要恢复的文件","backup.restore":"从备份恢复",
    "set.familyShare":"家庭共享","share.settings":"共享设置",
    "set.about":"关于","about.help":"使用说明","about.whatsNew":"更新内容","about.tourAgain":"重看引导","about.aboutApp":"关于本应用","about.reset":"清除数据并重新开始",
    "rel.daysAgo":"{n}天前","rel.today2":"今天","rel.overdueDeadline":"已逾期","rel.todayDeadline":"今天到期","rel.dueInDaysDeadline":"{n}天后到期",
    "common.add":"添加","common.delete":"删除","common.edit":"编辑","common.done":"完成","common.clear":"清除","common.me":"我","common.optional":"（可选）",
    "a11y.delete":"删除","a11y.pickColor":"选择颜色","a11y.editProfile":"编辑资料","a11y.editPhotoProfile":"编辑照片和资料","a11y.editIconName":"更改图标和名称",
    "ph.name":"名称","ph.title":"标题",
    "gender.boy":"男孩","gender.girl":"女孩","neuter.done":"是","neuter.not":"还没有",
    "ptype.baby":"婴儿","ptype.child":"儿童","ptype.adult":"成人","ptype.senior":"长者",
    "toast.saved":"已保存 ✓","toast.added":"已添加 ✓","toast.deleted":"已删除","toast.nameNeeded":"请输入名称","toast.titleNeeded":"请输入标题",
    "toast.healthSaved":"健康记录已保存 📈","toast.weightNum":"体重必须是数字","toast.healthNeeded":"请输入体重等数值","toast.heightNum":"身高必须是数字",
    "toast.foodSaved":"食物已保存 🍚","toast.foodNameNeeded":"请输入食物名称","toast.pickFood":"请选择食物","toast.amountNeeded":"请输入数量","toast.qtyNeeded":"请输入数量","toast.milkNeeded":"请输入奶量（ml）",
    "toast.diarySaved":"今日记录已保存 📝","toast.diaryPick":"选择状态，或添加备注",
    "toast.cardSaved":"卡片已保存 📌","toast.cardNeed":"添加一些信息或照片","toast.medSaved":"用药已保存","toast.medName":"请输入药物名称","toast.stockSaved":"库存已保存 📦","toast.routineSaved":"日常已保存 🗓","toast.noteSaved":"备注已保存","toast.noteNeed":"添加照片、备注或日记",
    "toast.memorySaved":"已保存到回忆 📸","toast.memoryDeleted":"回忆已删除","toast.photoMax":"最多4张照片","toast.photoAdded":"照片已添加 📷","toast.fileTooBig":"文件过大（最大20MB）","toast.imgFail":"无法加载图片","toast.imgSaveFail":"无法保存。请换一张图片试试。","toast.storageFull":"存储空间不足",
    "toast.recordedWell":"已标记为状态良好 👌","toast.alreadyRecorded":"今天已记录 👌","toast.pickWho":"请选择要记录的对象","toast.dupItem":"该项目已存在","toast.tomorrow":"已移到明天","toast.dateFixed":"日期已更新 ✓","toast.iconSet":"图标已设置","toast.certDeleted":"证明已删除","toast.growthSaved":"已保存到里程碑","toast.belongNeeded":"请输入物品","toast.belongAdded":"物品已添加 🎒",
    "toast.logged":"已记录 {emoji} {title} ✓","toast.memberDeleted":"已删除{name}",
    "care.overdue":"逾期{n}","care.soon":"即将到期{n}","care.ok":"照护正常","vis.private":"私密","vis.shared":"已共享",
    "hero.addPhoto":"添加照片","hero.rainbow":"彩虹桥","hero.togetherThanks":" · 相伴{n}天，谢谢你","me.setBirthday":"添加你的生日",
    "prof.title":"{name}的资料","prof.familyDefault":"家人","sp.catShort":"猫","sp.dogShort":"狗","sp.petShort":"宠物",
    "prof.usePhoto":"使用照片","prof.backToEmoji":"返回表情","prof.nickname":"昵称（可选）","ph.nickname":"如 Yui、小Yui","prof.folder":"文件夹（分组，可选）","ph.folderPerson":"如 家人 / 楼上父母","ph.folderPet":"如 狗 / 仓鼠",
    "prof.calColor":"日历颜色","prof.calColorDesc":"在日历上更容易区分。","prof.birthday":"生日（年份可选）","prof.gotcha":"领养日（年份可选）","prof.gotchaDesc":"庆祝它来到你身边的日子。",
    "prof.breedCat":"品种","prof.breedDog":"品种","prof.breedOther":"类型","ph.breedDog":"搜索或输入品种（任何品种都可以）","ph.breedCat":"搜索或输入品种（任何品种都可以）","ph.breedOther":"类型（自由输入）","prof.breedDescDog":"有助于估算散步时长。","prof.breedDescOther":"便于按体型记录。",
    "prof.coat":"毛色（可选）","ph.coat":"输入以搜索（可自由输入）","prof.gender":"性别（可选）","prof.genderDesc":"也会显示在寻宠海报上。","prof.neuter":"绝育","prof.microchip":"芯片号码（可选）","ph.microchip":"15位数字（如 392...）","prof.microchipDesc":"在走失或防灾时很有用。",
    "prof.personType":"类型（显示哪些项目）","prof.blood":"血型（可选）","blood.suffix":"型","prof.rainbow":"彩虹桥（纪念，可选）","prof.rainbowSet":"记录告别并切换到纪念模式","prof.rainbowDesc":"暂停提醒，静静地回顾回忆。",
    "prof.visShared":"与你邀请的家人共享该成员的记录。","prof.visPrivate":"仅保存在本设备，不与家人共享。","prof.visNote":"把私密内容（过敏、生理周期、医疗备注）设为「仅自己」。","prof.saveMember":"保存","prof.deleteMember":"删除该成员",
    "fun.gotchaToday":"相伴{y}年了！","fun.gotchaTodayNoYear":"领养日！","fun.gotchaAnniv":"领养日 {date}","fun.gotchaAnnivY":"领养日 {date}（{y}年）","fun.together":"相伴{n}天","fun.neuter":"绝育：{s}","member.addFamily":"添加家人或宠物",
    "word.pet":"照护","word.person":"计划","rec.memberTitle":"{name}的{word}","rec.tapEditDate":"点按编辑日期",
    "rel.stillNone":"尚未记录","rel.weeksAgo":"{n}周前","rel.monthsAgo":"约{n}个月前",
    "rec.routineTitle":"今天的日常","rec.addFromPlus":"用 ＋ 按钮添加","rec.choreTitlePet":"每日照护","rec.choreTitleMe":"自我照护记录","rec.choreTitleOther":"照护记录","rec.choreDescPet":"点按「完成」记录。颜色显示距上次的时间。","rec.choreDescOther":"点按「完成」记录。一眼看出距上次的时间。","rec.did":"完成","rec.lastDone":"上次 {date} · {txt}","rec.totalCount":" （共{n}次）",
    "common.all":"全部","a11y.prevMonth":"上个月","a11y.nextMonth":"下个月","cal.addRecord":"＋ 记录","cal.noRecords":"暂无记录","cal.exportIcs":"将事件导出到你的日历（.ics）","cal.foot":"点按日期以记录或回顾","cal.dayTitle":"{md} {wd}",
    "bday.month":"月","bday.day":"日","bday.yearOpt":"年（可选）","bday.monthSuffix":"月","bday.daySuffix":"日",
    "common.close":"关闭","food.editTitle":"编辑食物","food.newTitle":"添加食物","ph.foodName":"食物名称（如 鸡肉、干粮）","ph.brand":"品牌（可选）","food.type":"类型","foodtype.dry":"干粮","foodtype.wet":"湿粮","foodtype.homemade":"自制","foodtype.treat":"零食","foodtype.supplement":"保健品","foodtype.other":"其他","food.amountUnit":"每份分量（可选）","ph.amount":"数量","foodunit.g":"g","foodunit.ml":"ml","foodunit.piece":"个","food.timesTime":"每天次数与时间（可选）","ph.times":"次/天","ph.feedTime":"时间（如 7:00、19:00）","food.kcal":"热量（可选，若知道）","food.kcalDesc":"自动计算热量。只填分量也可以。","food.mealTitle":"记录一餐","food.food":"食物","food.when":"何时","mealslot.morning":"早上","mealslot.noon":"中午","mealslot.night":"晚上","mealslot.treat":"零食","food.qty":"分量","food.approxKcal":"约{kc}kcal","food.logBtn":"记录","bday.addTitle":"添加生日或纪念日","ph.bdayName":"名称（如 Yui的生日）","bday.dateYearOpt":"日期（年份可选）",
    "rec.healthTitle":"健康","chart.weight":"体重","chart.height":"身高","chart.bpSys":"血压（收缩压）","health.chartSoon":"再记录一次就会出现体重趋势图。","health.emptyPlus":"用 ＋ 按钮记录体重等。","health.recordOf":"{date}的记录","health.bpPrefix":"血压 ",
    "rec.medsTitle":"用药与保健品","med.finished":"已结束","med.progress":"{days}天 · 第{n}天 · 剩{left}天","med.tookDone":"已服用 ✓","med.took":"服用","ph.medName":"药物或保健品名称（如 维生素）","med.daysUnit":"天","common.register":"＋ 登记",
    "rec.sheetsTitle":"整合成一张表","rec.sheetsDescPet":"就诊或寄养时的一张表。","rec.sheetsDescOther":"交接或急救时的一张表。","rec.vetSummary":"兽医摘要","rec.careSheet":"寄养照护表","rec.lostPoster":"寻宠海报","rec.handoverToday":"今天的交接表","rec.emergencyCard":"急救卡",
    "rec.feedTitle":"食物与用餐","food.delMeal":"用餐记录","food.delRecord":"记录","food.registerLink":"＋ 添加食物","food.todayCount":"今天：{n}","food.pickToLog":"选择一种食物来记录用餐。","food.recordLabel":"已记录","food.tapToLog":"点按记录","food.todayMeal":"点按记录今天的用餐。","food.amountOnly":"只记录分量","food.registerBig":"添加食物","food.defaultName":"用餐",
    "rec.toiletTitle":"如厕成功率","toilet.peeRate":"小便成功","toilet.poopRate":"大便成功","toilet.none":"无数据","toilet.count":" （{success}/{total}）","toilet.logBtn":"记录如厕",
    "rec.diaryTitle":"今日状态","diary.recordedDone":"今天的状态已记录","diary.editMore":"添加/编辑","diary.recordBtn":"记录状态","chart.energy":"精神趋势（1–5）","chart.sleep":"睡眠趋势","chart.appetite":"食欲趋势（1–3）","diary.empty":"用「记录状态」来记录",
    "life.editTitle":"编辑记录","life.newTitle":"记录这一天","cat.memory":"回忆/日记","cat.event":"事件","ph.eventTitle":"事件标题（如 兽医）","ph.memoTitle":"备注（可选，如 第一次去海边）","common.photo":"照片","ph.diary":"日记（可选）","life.tag":"标签","life.firstTag":"第一次","ph.tag":"如 演出 / 便当 / 骑车","life.date":"日期","life.time":"时间","life.repeat":"重复","repeat.none":"不重复","repeat.daily":"每天","repeat.weekly":"每周","repeat.monthly":"每月","repeat.yearly":"每年","life.notify":"通知（可选）","notif.allowShort":"允许","remind.0":"开始时","remind.5":"提前5分钟","remind.30":"提前30分钟","remind.60":"提前1小时","remind.1440":"前一天","life.notifyHint":"🔔太多容易忽略 — 只留需要的。",
    "rec.trayTitle":"重要信息","rec.trayCount":" （{n}）","rec.trayHint":"把联系人、过敏和兽医信息保存为卡片。","card.nightTag":"夜间","card.hoursPh":"接诊时间（可选，如 24小时／夜间 20:00〜次日8:00）","card.addrPh":"地址（可选）","card.nightToggle":"设为夜间/急救时首先拨打的医院",
    "card.editTitle":"编辑卡片","card.newTitle":"添加卡片","cardkind.emergency":"紧急联系人","cardkind.allergy":"过敏与禁忌","cardkind.hospital":"兽医备注","cardkind.shelter":"避难与防灾备注","cardkind.insurance":"保险信息","cardkind.other":"备注","ph.cardTitle":"标题（如 常去的兽医）","ph.cardBody":"联系人、过敏、备注、剩余药量等。",
    "rec.walkTitle":"散步记录","walk.goalTitle":"本月参考量","walk.distance":"距离","walk.count":"次数","walk.timesUnit":"次","walk.dcPre":"根据品种","walk.dcMid":"和年龄","walk.dcPost1":"的","walk.dcBold":"一般参考值","walk.dcPost2":"。实际运动量因健康状况和个体差异而不同 — 请根据它的状态和兽医的建议来调整。","walk.dcBreedUnset":"（未设置→按中型计算）","walk.dcAgeUnset":"（未设置→按成犬计算）","walk.reviewTitle":"散步回顾","walk.vsLast":"较上月 ","walk.summaryThisMonth":"本月 ","walk.walksUnit":"次","walk.summaryMin":" · {m}分钟","walk.summarySep":" / 6个月合计 ","walk.time":"时间","walk.gpsRecording":"正在用GPS记录路线（{n}点）","walk.gpsStart":"正在用GPS记录路线…开始走动距离就会增加","walk.stopSave":"结束并保存","walk.otherRunning":"正在记录另一位的散步","walk.startBtn":"开始散步","walk.delLabel":"散步记录",
    "growth.title":"成长记录","growth.desc":"用照片记录每一个第一次。","growth.custom":"自定义添加（如 会翻单杠了）","growth.camTitle":"添加作品/照片","growth.photoSaved":"作品/照片已保存","common.plusRecord":"＋ 记录","common.plusAdd":"＋ 添加","common.amount":"数量","common.foot":"和家人的每一天，都在同一个地方。","a11y.edit":"编辑",
    "review.title":"本月回顾","review.daysLabel":"健康记录（天）","review.sleepLabel":"平均睡眠（h）","review.movesLabel":"运动记录","review.logsLabel":"任务记录","review.vsPrev":"较上月：{parts}","review.openTasks":"未完成任务：{n}","review.note":"※ 只是把记录的事实罗列出来，不做好坏判断。","review.pDays":"记录 {v}天","review.pSleep":"睡眠 {v}h","review.pLogs":"任务 {v}",
    "album.title":"回忆","album.cancelSel":"取消","album.select":"选择","album.loading":"加载中…","album.bulkAdd":"批量添加照片（按拍摄日期自动归类）","album.selHint":"点按照片进行选择（最多{n}张）→ 用下方的「移到其他」把它们一起移到其他家庭成员。","album.empty":"用一张照片和一句话留住它","album.selCount":"已选{n}张","album.moveBtn":"移到其他","album.moveDesc":"把选中的{n}个回忆一起移动。",
    "points.title":"帮忙积分","points.total":"合计{n}分","points.week":" （本周{n}）","points.custom":"自定义添加（+1分）",
    "allow.title":"零花钱账本","allow.balance":"剩余","allow.memoPh":"备注（零食等 · 可选）","allowdir.in":"收入","allowdir.out":"支出","allowdir.save":"存起",
    "meds.namePh":"药物或保健品名称（如 抗生素、维生素）",
    "belong.title":"物品（按星期）","belong.empty":"点按右下角的 ＋ 来添加物品",
    "foodreg.title":"食物登记","foodreg.desc":"登记常用的食物。","foodreg.addFood":"登记食物/用餐","foodreg.calc":"计算每日食量",
    "supply.title":"耗材库存","supply.emptyMe":"别让保健品和日用品用光。","supply.empty":"登记食物后会自动提醒剩余量","supply.bought":"已购买","supply.check":"查看","supply.lineOut":"可能已用完 — 该补货了","supply.lineLow":"大约还剩{n}天","supply.lineOk":"有库存（大约还剩{n}天）","supply.careOut":"无库存 — 需补货","supply.careLow":"还剩{n} — 快补货",
    "exp.title":"支出","exp.scopeThisFallback":"这一位","exp.scopeAll":"所有人","exp.emptyAll":"还没有支出记录。","exp.emptyThis":"点按右下角的 ＋ 添加","exp.total":"合计","exp.year":"{y}年","exp.monthlyAvg":"月均","exp.annual":"年度预估","exp.byMember":"按成员","exp.byCategory":"按类别","exp.trend":"每月趋势","exp.trendRecent":" （近{n}个月）","exp.trendEmpty":"随着数据增多，会显示每月趋势。","exp.delLabel":"{date}的支出","exp.editTitle":"编辑支出","exp.dateLabel":"日期（用于补录收据、代填等）",
    "certs.title":"就诊与证明","certs.cert":"证明","certs.addCert":"＋ 添加证明","certs.empty":"点按 ＋ 选择类型和日期，保存证明。","certs.certHint":"证明（点按放大）","certs.noDate":"无日期","certs.yearLabel":"{y}年","certs.addablePhoto":"可以添加照片（证明）的记录","certs.tapAddPhoto":"点按添加证明照片","renew.expired":"已逾期{n}天","renew.today":"今天到期","renew.left":"还剩{n}天",
    "common.memoOpt":"备注（可选）","exp.addTitle":"记录支出","exp.addHint":"以今天的日期保存。点按明细可编辑。","exp.notePh":"备注（可选）","belong.addTitle":"添加物品","belong.addPh":"如 体操服 / 图书馆的书 / 书法用具","belong.dowSuffix":"",
    "hub.title":"想记录什么？","hub.addable":"可添加的功能","hub.schedulePet":"照护与计划","hub.scheduleMe":"计划与待办","hub.toilet":"如厕记录","hub.routine":"日常（习惯）","hub.health":"体重与身体","hub.belong":"物品（按星期）","hub.bday":"生日与纪念日",
    "del.confirmTitle":"确定要删除吗？","del.confirmBody":"删除「{label}」。此操作无法撤销。","del.confirmBodyPlain":"此操作无法撤销。","del.confirmBtn":"删除",
    "health.addTitle":"身体记录","health.bp":"血压","health.temp":"体温","health.glucose":"血糖","health.bpHigh":"高压","health.bpLow":"低压","health.optionalPh":"可选","health.smallAnimalHint":"小动物以0.1g为单位","health.condLabel":"状态","health.saveBtn":"记录身体","health.targetWeight":"目标体重","health.targetHint":"显示与目标的差距。",
    "diary.quickHealthy":"今天也很好（一键完成）","diary.hint":"只在想详细记录时（可选）。","diary.energy":"精神","diary.appetite":"食欲","diary.poop":"大便","diary.sleep":"睡眠","diary.other":"其他","diary.symptoms":"症状","diary.hours":"{h}小时","diary.hoursSuffix":"小时","diary.hoursPh":"小时","diary.walk":"散步/外出","diary.hospital":"去了医院","diary.periodPriv":"只属于本人的记录","diary.periodNote":"上次 {last} · 下次大约 {next}（周期约{avg}天）","diary.notePh":"日常状态、就诊情况、一句话…","diary.delPhoto":"删除照片","diary.addPhoto":"添加照片（药物、症状等）","diary.saveBtn":"保存今日状态",
    "feed.addTitle":"用餐记录","feed.servingLabel":"每份分量","feed.servingPh":"如 100","feed.hintSet":"1份＝{g}g，会计入总量（只需设置一次）","feed.hintUnset":"不设置也可以记录（设置后会计入总量）","feed.amount":"分量","feed.previewPre":"＝ 约 ","feed.previewPost":"（{n}份）","feed.saveBtn":"记录用餐","feed.today":"今天合计 约{g}g（{n}次）",
    "sched.titlePet":"添加照护或计划","sched.titleSelf":"添加健康或照护","sched.titleMe":"添加计划或待办","sched.frequent":"常用","sched.contentPh":"输入内容…","sched.addLabelPh":"添加{label}…","sched.content":"内容","sched.dateOptMe":"日期/期限（可选）","sched.time":"时间","sched.dateHint":"填入日期/期限后，会显示在当天的日历上。","sched.certPhoto":"证明/照片（可选）","sched.changePhoto":"更换照片","sched.attachPhoto":"＋ 附加照片","sched.notify":"通知","sched.quickAdd":"一键添加（复制上次）","sched.lastDate":"上次 {date}","sched.dateDone":"实施日","sched.dateDate":"日期","sched.dateVisit":"就诊日","sched.dateDue":"期限","care.fallback":"照护","filter.all":"全部",
    "toilet.hint":"点按记录（今天，当前时间）。","toilet.pee":"小便","toilet.success":"✓ 成功","toilet.fail":"✕ 失败","toilet.hardness":"大便硬度（7级）","toilet.bristolNote":"4是健康的。如果1或7持续，请咨询兽医。","toilet.alertBody":"需要注意：消化道异物、肠梗阻、中毒","toilet.alertLink":"查看危险物清单","toilet.ideal":"（理想）","toilet.disclaimer":"就诊的参考（并非诊断）。","toilet.trendLoose":"稀便持续中。如果拖久了，建议就诊。","toilet.trendHard":"硬便持续中。注意补水和饮食，担心时请就诊。",
    "emg.title":"夜间与急救","emg.lead":"出现异常时，先给医院打电话。不要自行处理 — 请遵从指示。","emg.step1":"打电话","emg.callDefault":"常去/夜间急救","emg.registerHosp":"登记医院联系方式","emg.registerHospSub":"把夜间急救和常去兽医的号码放在手边","emg.note1":"能否接诊及诊疗方式因医院而异，有的需要提前联系。请向医院确认最新的诊疗时间和联系方式。","emg.redHead":"出现这些信号：立刻联系，不要犹豫","emg.dontHead":"不要做的事","emg.dont1":"自行催吐、喂药或喂水","emg.dont2":"只凭网上的信息就决定「再观察」","emg.dont3":"先联系医院，遵从指示","emg.step2":"电话里要说的","emg.profNone":"尚未登记资料","emg.toxHead":"误食检查内容","emg.toxWhat":"吃了什么","emg.toxAmount":"数量","emg.toxWhen":"何时","emg.toxWeight":"体重","emg.toxSymptom":"症状","emg.say1":"当前状态（意识、呼吸、抽搐、出血、有无呕吐/腹泻）","emg.say2":"何时、发生了什么（若误食：吃了什么、多少、时间）","emg.say3":"基础病、正在服用的药、有无常去的兽医","emg.tipsHead":"想说得更详细的话","emg.step3":"带上","emg.note2":"就诊比准备更重要。带上手边现有的东西马上出发也没关系。","emg.contactsTitle":"已登记的联系方式","emg.register":"＋ 登记","emg.contactsEmpty":"登记好动物医院和家人/寄养的号码会更安心。可以从这里拨打，也会保存在卡片里。","emg.groupHosp":"🏥 动物医院","emg.groupPerson":"👤 家人/寄养","emg.addNumber":"添加号码","emg.hospFallback":"医院","emg.contactFallback":"联系方式","emg.prepHead":"平时的准备（在平静的时候）","emg.foot":"※ 医院信息可能会变，请务必向各医院确认最新情况。紧急时不要犹豫，联系常去的兽医或附近的夜间急救。",
    "disaster.title":"防灾与疏散准备","disaster.alert":"灾害时，与宠物「一同疏散」是基本原则。请做好日常准备，并提前确认疏散地点。","disaster.shelterTitle":"我家的疏散地点","disaster.registerShelter":"＋ 登记疏散地点","disaster.shelterEmpty":"把疏散地点和寄养处与家人共享。也会保存在卡片里。","disaster.shelterFallback":"疏散地点","disaster.prepTitle":"随身与储备（宠物用）","disaster.tipsHead":"关键时刻的要点","disaster.foot":"※ 指定避难所是否接收宠物及地点因地区而异。请务必提前向当地政府或自主防灾组织确认。",
    "safety.sectionLabel":"紧急时刻","safety.sectionNote":"用已登记的信息，快速制作寻宠海报或急救卡。","safety.toxicShort":"误食与中毒","safety.emergencyShort":"夜间与急救","safety.emergencyCard":"急救卡","safety.lostPoster":"寻宠海报","safety.disasterShort":"防灾与疏散",
    "common.saveImage":"保存为图片","common.print":"打印","common.addPhotoMax4":"添加照片（最多4张）","ecard.meFallback":"我","ecard.allergy":"过敏/禁忌","ecard.meds":"用药中","ecard.contacts":"紧急联系人/常去兽医","ecard.contactsEmpty":"※ 在「重要信息」中登记联系人后会显示在这里","ecard.addInfo":"添加联系人/信息","ecard.note":"※ 供紧急时出示或打印携带。数据保存在本设备，即使没有信号也能显示。","ecard.fileSuffix":"急救卡",
    "lost.step0":"地点与时间","lost.step1":"宠物信息","lost.step2":"海报","lost.stepFmt":"{n}. {lab}","lost.step0LeadBold":"先别慌。","lost.step0LeadRest":" 填写最后一次看到它的地点和时间。之后可以修改。","lost.placeLabel":"最后看到的地点","lost.placeHint":"填写它可能走失的地点","lost.placePh":"如 公园入口附近 / 车站前","lost.placeNoteLabel":"地点补充（可选）","lost.placeNotePh":"如 便利店对面 / 东出口","lost.whenLabel":"看到的日期时间","lost.whenPh":"如 9月18日 18点左右","lost.step1Lead":"将用这些信息制作海报。请确认照片和特征。","lost.featType":"类型","lost.featCoat":"毛色","lost.featGender":"性别","lost.featAge":"年龄","lost.featWeight":"体重","lost.featCollar":"项圈/胸背带","lost.collarLabel":"项圈/胸背带（可选）","lost.collarPh":"如 红色项圈、有身份牌","lost.situationLabel":"走失时的情况（可选）","lost.situationPh":"如 被烟花吓到挣脱了牵引绳","lost.temperLabel":"性格（自动调整请求语）","lost.noteLabel":"其他想说的（可选）","lost.notePh":"如 也请帮忙在社交媒体上转发","lost.registerContact":"登记联系方式（发现者联系时需要）","lost.found":"已找到","lost.headDog":"寻找走失的狗","lost.headOther":"正在寻找","lost.sightPlace":"最后目击地点","lost.sightWhen":"目击时间","lost.situationTitle":"走失时的情况","lost.contactPlea":"如果看到，请联系我们","lost.contactEmpty":"※ 在「重要信息」中登记紧急联系人后会显示在这里","lost.action":"【重要】如果看到，请立刻拨打此号码。请不要追赶。","lost.footNote":"请不要追赶 — 告诉我们你看到的地点和时间。可打印或在屏幕上出示，没有信号也能显示。","lost.afterTitle":"完成了。接下来，把消息传出去吧。","lost.foundToggle":"已找到（在海报上显示「已找到」）","lost.privacy":"不会刊登你的住址或芯片号码。只显示已登记的联系方式。","lost.nextPet":"下一步：宠物信息","lost.back":"返回","lost.makePoster":"制作海报","lost.share":"分享","lost.fileSuffix":"走失","temper.unset":"未设置","temper.friendly":"亲人","temper.normal":"普通","temper.timid":"胆小",
    "ob.title":"家人的每一天，都在同一个地方。","ob.sub":"宠物和孩子都适用 — 从日常记录到应对万一的准备。","ob.start":"开始","ob.trySample":"用示例数据体验","ob.h2":"先添加一位","ob.choicePet":"🐶 我家的（狗、猫等）","ob.choiceMe":"👤 自己（也照护自己）","ob.choicePerson":"👨‍👩‍👧 家人（人）","ob.skip":"暂不添加","ob.photoIcon":"用照片作为图标","ob.iconHintPre":"选择表情，或从右边的 ","ob.iconHintPost":" 使用照片","ob.namePetPh":"名称（如 小白）","ob.nameMePh":"你的名字（如 Kaori）","ob.namePersonPh":"名称（如 Yuto）","ob.birthday":"生日（年份可选）","ob.back":"返回",
    "tour.headseg.title":"在「日常」和「管理」之间切换","tour.headseg.body":"用上方的这个标签切换。日常＝当天的记录，管理＝照护计划、日常照料、重要信息等。","tour.fab.title":"从这里记录","tour.fab.body":"用右下角的 ＋ 记录计划、照护、用餐、体重等。","tour.cal.title":"日历","tour.cal.body":"一览家人的计划。点按日期即可回顾。","tour.home.title":"按家庭成员","tour.home.body":"在首页点按家庭成员即可打开其页面。打开后，随时可从上方的列表切换。","coach.cal.title":"点按日期","coach.cal.body":"彩色圆点是当天的计划。点按即可回顾。","coach.record.title":"记录身体与状态","coach.record.body":"用右下角的 ＋ 记录体重、状态、用餐和日记。","coach.manage.title":"每日照料与计划","coach.manage.body":"待办和计划都在这里。点按「完成」即可看出距上次的时间。","tour.next":"下一步","tour.skip":"跳过","common.ok":"OK",
  },
};
function tr(lang,key,vars){
  let s=(MESSAGES[lang]&&MESSAGES[lang][key]);
  if(s==null&&lang!=="en")s=(MESSAGES.en&&MESSAGES.en[key]); // 未訳キーは英語にフォールバック（es 等の段階的追加用）
  if(s==null)s=(MESSAGES.ja&&MESSAGES.ja[key]);
  if(s==null)return key;
  if(vars)s=s.replace(/\{(\w+)\}/g,(mm,k)=>vars[k]!=null?String(vars[k]):mm);
  return s;
}
// 言語判定：navigator の言語を ja/en にマップ（該当なしは ja）。初回のみ利用。
function detectLang(){try{const ls=navigator.languages||[navigator.language||"ja"];for(const l of ls){const p=(l||"").toLowerCase();if(p.startsWith("en"))return "en";if(p.startsWith("ja"))return "ja";if(p.startsWith("es"))return "es";if(p.startsWith("zh"))return "zh";}}catch(e){}return "ja";}
// Intl.DateTimeFormat ベースの日付・曜日（絶対日付表示用の基盤。ja出力は既存表記に一致）。
function fmtDateLoc(isoStr,lang){if(!isoStr)return"";const[y,m,d]=isoStr.split("-").map(Number);if(!m||!d)return"";const dt=new Date(y&&y>1900?y:2001,m-1,d);try{return new Intl.DateTimeFormat(LOCALES[lang]||"ja-JP",lang==="ja"?{month:"long",day:"numeric"}:{month:"short",day:"numeric"}).format(dt);}catch(e){return`${m}/${d}`;}}
function fmtWeekdayLoc(isoStr,lang){if(!isoStr)return"";const[y,m,d]=isoStr.split("-").map(Number);if(!y||!m||!d)return"";try{return new Intl.DateTimeFormat(LOCALES[lang]||"ja-JP",{weekday:"short"}).format(new Date(y,m-1,d));}catch(e){return"";}}

const HOURS=Array.from({length:24},(_,i)=>i);
const MINS=[0,5,10,15,20,25,30,35,40,45,50,55];
// Lucide ベースのラインアイコン（絵文字置き換え用）。currentColor で色を継承。
const ICONS={
  home:'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  calendar:'<rect x="3" y="4" width="18" height="18" rx="2.4"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  record:'<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2 2 0 0 1 2.8 2.8L12 15l-4 1 1-4z"/>',
  folder:'<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 8 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  paw:'<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5 3 3 0 0 1-6 2 3 3 0 0 1-4-4 5 5 0 0 1 5-3z"/>',
  camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  pencil:'<path d="M18.4 2.6a2 2 0 0 1 2.8 2.8L8 18.6l-4 1 1-4z"/>',
  bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  thermometer:'<path d="M14 14.76V4a2 2 0 0 0-4 0v10.76a4 4 0 1 0 4 0z"/>',
  printer:'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  filetext:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
  note:'<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2 2 0 0 1 2.8 2.8L12 15l-4 1 1-4z"/>',
  scale:'<path d="M12 3v18M7 3h10M5 7l-3 6a4 4 0 0 0 6 0L5 7zM19 7l-3 6a4 4 0 0 0 6 0l-3-6z"/>',
  wallet:'<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  package:'<path d="M16.5 9.4 7.5 4.2M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8"/>',
  pin:'<path d="M12 17v5M9 10.8V6l-2-1V3h10v2l-2 1v4.8l2 3.2v1H7v-1z"/>',
  link:'<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"/><path d="M12 8C12 8 12 3 9 3a2 2 0 0 0 0 4h6a2 2 0 0 0 0-4c-3 0-3 5-3 5z"/>',
  repeat:'<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  bag:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  cake:'<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/>',
  heart:'<path d="M19 14c1.5-1.5 3-3.5 3-5.5A5.5 5.5 0 0 0 12 5 5.5 5.5 0 0 0 2 8.5c0 2 1.5 4 3 5.5l7 7z"/>',
  scissors:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  hash:'<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  droplet:'<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/>',
  wind:'<path d="M12.8 19.6A2 2 0 1 0 14 16H2M17.5 8A2.5 2.5 0 1 1 19 12.5H2M9.6 4.6A2 2 0 1 1 11 8H2"/>',
  palette:'<circle cx="13.5" cy="6.5" r="1.2"/><circle cx="17" cy="10.5" r="1.2"/><circle cx="8.5" cy="7.5" r="1.2"/><circle cx="6.5" cy="12" r="1.2"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2 2 2 0 0 1 2-2h1.5a3.5 3.5 0 0 0 3.5-3.5C22.5 6.6 17.8 2 12 2z"/>',
  alert:'<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  syringe:'<path d="m18 2 4 4M17 7l3-3M19 9 8.7 19.3a2.4 2.4 0 0 1-3.4 0l-.6-.6a2.4 2.4 0 0 1 0-3.4L15 5M9 11l4 4M5 19l-3 3M14 4l6 6"/>',
  pill:'<path d="m10.5 20.5 10-10a5 5 0 0 0-7-7l-10 10a5 5 0 0 0 7 7z"/><path d="m8.5 8.5 7 7"/>',
  bug:'<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 6V3M9 4 7.5 2.5M15 4l1.5-1.5M8 11H4M20 11h-4M8 16H4M20 16h-4M8 20l-2 2M16 20l2 2"/>',
  stethoscope:'<path d="M4 3v5a4 4 0 0 0 8 0V3M8 16a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/><path d="M4 3H2.5M12 3h-1.5"/>',
  tooth:'<path d="M12 5.5C10 3.5 6.5 3 5 6c-1.4 2.8.3 6 .8 8.7.4 2.2 1 5.3 2.4 5.3s1.4-3 1.9-5c.1-.6.6-1.6 1.9-1.6s1.8 1 1.9 1.6c.5 2 .5 5 1.9 5s2-3.1 2.4-5.3c.5-2.7 2.2-5.9.8-8.7C17.5 3 14 3.5 12 5.5z"/>',
  building:'<rect x="4" y="2" width="16" height="20" rx="1.5"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  activity:'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  sparkles:'<path d="m12 3-1.9 5.8-5.8 1.9 5.8 1.9L12 18l1.9-5.4 5.8-1.9-5.8-1.9z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  snow:'<path d="M2 12h20M12 2v20M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7"/>',
  cloudrain:'<path d="M4 14.9A5 5 0 1 1 15 8h1a4 4 0 0 1 1 7.9M8 19v2M12 19v2M16 19v2"/>',
  glasses:'<circle cx="6" cy="15" r="3"/><circle cx="18" cy="15" r="3"/><path d="M9 15a3 3 0 0 1 6 0M2 12l3-3M22 12l-3-3"/>',
  briefcase:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  utensils:'<path d="M3 2v7a2 2 0 0 0 4 0V2M5 9v13M18 2v20M18 9c0-3 1-5 3.5-6"/>',
  ban:'<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  smile:'<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  smileplus:'<path d="M22 11v1a10 10 0 1 1-9-10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M16 5h6M19 2v6"/>',
  meh:'<circle cx="12" cy="12" r="10"/><path d="M8 15h8M9 9h.01M15 9h.01"/>',
  frown:'<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2M9 9h.01M15 9h.01"/>',
  angry:'<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2M7.5 8 10 9M14 9l2.5-1M9 10h.01M15 10h.01"/>',
  moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  coffee:'<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2"/>',
  trash:'<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/>',
  chevron:'<path d="M9 6l6 6-6 6"/>',
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  tag:'<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4a1.2 1.2 0 0 1 1.2-1.2h8a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8z"/><path d="M7 7h.01"/>',
};
const TYPE_ICON={work:"briefcase",event:"calendar",social:"users",habit:"repeat",health:"stethoscope",dream:"sparkles"};
const ENERGY_ICON={great:"smileplus",genki:"smile",normal:"meh",low:"frown",bad:"angry"};
const POOP_DIARY_ICON={good:"check",loose:"droplet",none:"ban"};
function Icon({name,size=22,stroke=1.9,className}){const d=ICONS[name];if(!d)return null;return(<svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{__html:d}}/>);}
// うんちの硬さイラスト（塗り）。POOP_SHAPE のパスを tone 色で描画。
function PoopShape({n,size=30}){const d=POOP_SHAPE[n];if(!d)return null;const bm=bristolMeta(n);const col=(bm&&POOP_TONE_COLOR[bm.tone])||"#A9803F";return(<svg width={size} height={size} viewBox="0 0 24 24" fill={col} aria-hidden="true" dangerouslySetInnerHTML={{__html:d}}/>);}

// IME（日本語入力）に強いテキスト入力。変換中(composition)は親stateを更新せず、
// 変換確定時にまとめて反映する。背景の再描画で変換が消える不具合を防ぐ。
function IMEInput({value,onChange,onBlur,...rest}){
  const composing=useRef(false);
  const [local,setLocal]=useState(value||"");
  useEffect(()=>{ if(!composing.current&&value!==local)setLocal(value||""); },[value]); // eslint-disable-line
  // 変換中でも親へ即時反映する。表示値(local)は常にDOMの実値と一致させるので、
  // 親の再描画でinputのDOM値が書き換わることはなく、日本語変換は中断されない。
  // これによりiOS Safariでcompositionendが発火しない場合でも入力が確実に保存される。
  const push=(v)=>{setLocal(v);onChange(v);};
  return(<input {...rest} value={local}
    onCompositionStart={()=>{composing.current=true;}}
    onCompositionEnd={e=>{composing.current=false;push(e.target.value);}}
    onChange={e=>push(e.target.value)}
    onBlur={e=>{composing.current=false;push(e.target.value);if(onBlur)onBlur(e);}}/>);
}

function TimeInput({value,onChange}){
  const curH=value?Number(value.split(":")[0]):"";
  const curM=value?Math.round(Number(value.split(":")[1])/5)*5%60:0;
  const upd=(h,m)=>{if(h===""){onChange("");return;}const hh=String(h).padStart(2,"0"),mm=String(m).padStart(2,"0");onChange(hh+":"+mm);};
  return(<div className="yl-timepick"><select className="yl-tsel" value={curH} onChange={e=>upd(e.target.value===""?"":Number(e.target.value),curM)}><option value="">--</option>{HOURS.map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}</option>)}</select><span className="yl-tcolon">:</span><select className="yl-tsel" value={curM} onChange={e=>upd(curH===""?9:curH,Number(e.target.value))}>{MINS.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}</select></div>);
}

// 誕生日・記念日の入力：月・日は必須、年（西暦）は任意。毎年くりかえす前提で、
// 年が空のときは内部的に "0000-MM-DD" で保存し、年齢/周年は表示しない。
const BMONTHS=Array.from({length:12},(_,i)=>i+1);
const dimOf=(mm)=>mm?new Date(2001,Number(mm),0).getDate():31; // 2001=平年。年不明でも月末日を安全側で算出
function BdayInput({value,onChange}){
  const[y,setY]=useState("");const[m,setM]=useState("");const[d,setD]=useState("");
  // 外から値が渡された時に同期。年は実在年のときだけ反映し、"0000"では上書きしない（入力中の桁を消さないため）。
  useEffect(()=>{const p=(value||"").split("-");if(p.length===3){setM(String(Number(p[1])));setD(String(Number(p[2])));if(p[0]!=="0000")setY(p[0]);}else{setM("");setD("");setY("");}},[value]);
  const emit=(yy,mm,dd)=>{if(!mm||!dd){onChange("");return;}const yr=/^\d{4}$/.test(yy)?yy:"0000";onChange(`${yr}-${String(Number(mm)).padStart(2,"0")}-${String(Number(dd)).padStart(2,"0")}`);};
  const onMonth=e=>{const nm=e.target.value;let nd=d;if(nm&&d&&Number(d)>dimOf(nm))nd=String(dimOf(nm));setM(nm);setD(nd);emit(y,nm,nd);};
  const onDay=e=>{const nd=e.target.value;setD(nd);emit(y,m,nd);};
  const onYear=e=>{const v=e.target.value.replace(/[^0-9]/g,"").slice(0,4);setY(v);emit(v,m,d);};
  return(<span className="yl-bdaypick">
    <select className="yl-bsel" value={m} onChange={onMonth}><option value="">{tr(APP_LANG,"bday.month")}</option>{BMONTHS.map(mm=><option key={mm} value={mm}>{mm}{tr(APP_LANG,"bday.monthSuffix")}</option>)}</select>
    <select className="yl-bsel" value={d} onChange={onDay}><option value="">{tr(APP_LANG,"bday.day")}</option>{Array.from({length:dimOf(m)},(_,i)=>i+1).map(dd=><option key={dd} value={dd}>{dd}{tr(APP_LANG,"bday.daySuffix")}</option>)}</select>
    <input className="yl-byear" type="text" inputMode="numeric" maxLength={4} placeholder={tr(APP_LANG,"bday.yearOpt")} value={y} onChange={onYear}/>
  </span>);
}

// ───────── コーチマーク（スポットライト型ガイド） ─────────
// 対象要素の実測位置(getBoundingClientRect)にスポットライトと吹き出しを重ねる。
// 座標はベタ書きせず、要素をセレクタで探して毎フレーム追従（リサイズ・スクロールにも対応）。
const TOUR_STEPS=[
  {k:"headseg",sel:'[data-tour="headseg"]'},
  {k:"fab",sel:'[data-tour="fab"]'},
  {k:"cal",sel:'[data-tour="nav-cal"]'},
  {k:"home",sel:'[data-tour="nav-home"]'},
];
// 画面ごとの初回1ポイント案内（B）。キー＝画面（coach.<key>.title/body）、value＝{sel}
const COACH_HINTS={
  cal:{sel:".yl-cal-grid"},
  record:{sel:'[data-tour="fab"]'},
  manage:{sel:".yl-chore, .yl-routine, .yl-list"},
};
// 永続フラグ（UI設定なのでローカル保存。ツアーAと画面案内Bは別キーで管理）。
const tourIsDone=()=>{try{return localStorage.getItem("loalife-tour-v1")==="1";}catch(e){return true;}};
const markTourDone=()=>{try{localStorage.setItem("loalife-tour-v1","1");}catch(e){}};
const coachIsSeen=(k)=>{try{return !!(JSON.parse(localStorage.getItem("loalife-coach-v1")||"{}")[k]);}catch(e){return true;}};
const markCoachSeen=(k)=>{try{const o=JSON.parse(localStorage.getItem("loalife-coach-v1")||"{}");o[k]=1;localStorage.setItem("loalife-coach-v1",JSON.stringify(o));}catch(e){}};
const resetGuides=()=>{try{localStorage.removeItem("loalife-tour-v1");localStorage.removeItem("loalife-coach-v1");}catch(e){}};
function CoachMark({sel,title,body,step,total,nextLabel,onNext,onSkip,single}){
  const[rect,setRect]=useState(null);
  useEffect(()=>{
    const measure=()=>{const el=document.querySelector(sel);if(el){const r=el.getBoundingClientRect();if(r.width||r.height){setRect({top:r.top,left:r.left,width:r.width,height:r.height});return;}}setRect(null);};
    measure();const iv=setInterval(measure,150);
    window.addEventListener("resize",measure);window.addEventListener("scroll",measure,true);
    return()=>{clearInterval(iv);window.removeEventListener("resize",measure);window.removeEventListener("scroll",measure,true);};
  },[sel]);
  if(!rect)return null; // 対象が見つかるまで待つ（見つかり次第スポットライト表示）
  const pad=8;const vh=typeof window!=="undefined"?window.innerHeight:800;
  const hole={top:rect.top-pad,left:rect.left-pad,w:rect.width+pad*2,h:rect.height+pad*2};
  const placeBelow=(hole.top+hole.h+16)<(vh-190);
  const tipStyle=placeBelow?{top:hole.top+hole.h+14}:{bottom:(vh-hole.top)+14};
  return(<div className="yl-coach">
    <div className="yl-coach-hole" style={{top:hole.top,left:hole.left,width:hole.w,height:hole.h}}/>
    <div className="yl-coach-tip" style={tipStyle}>
      {total?<span className="yl-coach-step">{step} / {total}</span>:null}
      <h4 className="yl-coach-title">{title}</h4>
      <p className="yl-coach-body">{body}</p>
      <div className="yl-coach-btns">
        {!single&&<button className="yl-coach-skip" onClick={onSkip}>{tr(APP_LANG,"tour.skip")}</button>}
        <button className="yl-coach-next" onClick={onNext}>{nextLabel}</button>
      </div>
    </div>
  </div>);
}

// 体重・身長の推移グラフ（軽量SVG折れ線）。points=[{date,value}]（古い→新しい順）
// 2点以上でのみ折れ線を描く（1点以下は呼び出し側で空状態メッセージ）。
function MiniChart({points,unit,color,label}){
  if(!points||points.length<2)return null;
  // 描画エリアを分離：左＝Y軸ラベルの余白、下＝X軸ラベルの余白。折れ線はその内側だけに描く。
  const W=300,H=120,padL=40,padR=14,padTop=14,padBot=22;
  const plotB=H-padBot; // プロット領域の下端（X軸ラベルはこれより下に描く）
  const vals=points.map(p=>p.value);
  const dataMin=Math.min(...vals),dataMax=Math.max(...vals);
  // Y軸に余白：最小レンジと上下パディングを確保し、0.1kg差が画面端から端まで振れないように。
  let min=dataMin,max=dataMax,span=max-min;
  const floor=Math.max((Math.abs(max)||1)*0.12,unit==="cm"?2:(unit==="kg"?1:0.4));
  if(span<floor){const c=(min+max)/2;min=c-floor/2;max=c+floor/2;span=floor;}
  const padv=span*0.2;min-=padv;max+=padv;span=max-min;
  const n=points.length;
  const xAt=(i)=>padL+(i*(W-padL-padR))/(n-1);
  const yAt=(v)=>padTop+(1-(v-min)/span)*(plotB-padTop);
  const fmtV=(v)=>Number.isInteger(v)?v:v.toFixed(1);
  const latest=points[n-1],first=points[0];
  return(
    <div className="yl-chart-wrap">
      <div className="yl-chart-head"><span className="yl-chart-label">{label}</span><span className="yl-chart-latest" style={{color}}>{latest.value}{unit}</span></div>
      <svg className="yl-chart" viewBox={`0 0 ${W} ${H}`}>
        {/* プロット領域の枠（下端の基準線） */}
        <line x1={padL} y1={plotB} x2={W-padR} y2={plotB} stroke="#E7E1D8" strokeWidth="1"/>
        <polyline points={points.map((p,i)=>`${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(" ")} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
        {points.map((p,i)=><circle key={i} cx={xAt(i).toFixed(1)} cy={yAt(p.value).toFixed(1)} r="3" fill={color}/>)}
        {/* Y軸：左の余白に上＝データ最大・下＝データ最小（右寄せ） */}
        <text x={padL-6} y={padTop+4} textAnchor="end" className="yl-chart-ax">{fmtV(dataMax)}{unit}</text>
        <text x={padL-6} y={plotB} textAnchor="end" className="yl-chart-ax">{fmtV(dataMin)}{unit}</text>
        {/* X軸：下の余白に起点（左寄せ）と最新（右寄せ） */}
        {n>1&&<text x={padL} y={H-6} textAnchor="start" className="yl-chart-ax">{fmtDate(first.date)}</text>}
        <text x={W-padR} y={H-6} textAnchor="end" className="yl-chart-ax">{fmtDate(latest.date)}</text>
      </svg>
    </div>
  );
}

// Visibility toggle component
function VisibilityToggle({value, onChange}) {
  const isHousehold = value === "household";
  return (
    <button
      className={"yl-vis-toggle" + (isHousehold ? " household" : " private")}
      onClick={() => onChange(isHousehold ? "private" : "household")}
      title={isHousehold ? "家族に見せています" : "自分だけに表示"}
    >
      {isHousehold ? "👨‍👩‍👧 家族に見せる" : "🔒 自分のみ"}
    </button>
  );
}

// 大項目（セクション）並び替え用ラッパー。ドラッグは見出しのハンドル(⠿)のみ。
function SortableSection({id,children}){
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id});
  const style={transform:CSS.Transform.toString(transform),transition,position:"relative",...(isDragging?{opacity:.7,zIndex:30,boxShadow:"0 12px 28px rgba(120,80,160,.28)",borderRadius:18}:{})};
  return(
    <div ref={setNodeRef} style={style} className="yl-sec-wrap">
      <button className="yl-sec-handle" {...attributes} {...listeners} aria-label="セクションを並び替え" title="ドラッグで並び替え">⠿</button>
      {children}
    </div>
  );
}
// 並び替え用カード（長押し/ドラッグでD&D）。ドラッグ中は拡大・影・半透明。
function SortableCard({id,className,children}){
  const {attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id});
  const base=CSS.Transform.toString(transform);
  const style={transform:isDragging&&base?`${base} scale(1.03)`:base,transition,touchAction:"manipulation",...(isDragging?{opacity:.65,boxShadow:"0 12px 28px rgba(120,80,160,.28)",zIndex:20,position:"relative"}:{})};
  return <li ref={setNodeRef} style={style} className={className} {...attributes} {...listeners}>{children}</li>;
}

function App(){
  const[members,setMembers]=useState([]);
  const[items,setItems]=useState([]);
  const[loaded,setLoaded]=useState(false);
  const[tab,setTab]=useState("home");
  const[filter,setFilter]=useState("all");
  const[flash,setFlash]=useState("");
  const[draft,setDraft]=useState("");
  const[draftType,setDraftType]=useState("work");
  const[draftKind,setDraftKind]=useState("vaccine");
  const[draftDate,setDraftDate]=useState("");
  const[draftPhoto,setDraftPhoto]=useState(null); // ケア・予定追加フォーム内で先に選ぶ写真（証明書）。保存時に既存の photoStorage へ書き込む
  const[selfCare,setSelfCare]=useState(false); // 「自分」の健康・ケア記録を追加する時だけ true（ケアフォームを自分にも開放。既存の予定・ToDoとは別導線）
  const[draftTime,setDraftTime]=useState("");
  const[draftRepeat,setDraftRepeat]=useState("none");
  const[draftReminders,setDraftReminders]=useState([]);
  const[draftAuto,setDraftAuto]=useState(false);
  const[adding,setAdding]=useState(false);
  const[newKind,setNewKind]=useState("pet");
  const[newSpecies,setNewSpecies]=useState("dog");
  const[newPersonType,setNewPersonType]=useState("child");
  const[newName,setNewName]=useState("");
  const[newEmoji,setNewEmoji]=useState("🐶");
  const[newBirthday,setNewBirthday]=useState("");
  const[newVisibility,setNewVisibility]=useState("household");
  const[editingId,setEditingId]=useState(null);
  const[editName,setEditName]=useState("");
  const[editNickname,setEditNickname]=useState(""); // ニックネーム（子ども・自分。任意）
  const[editBirthday,setEditBirthday]=useState("");
  const[editGotcha,setEditGotcha]=useState(""); // うちの子記念日（ペットのみ）
  const[editGroup,setEditGroup]=useState(""); // フォルダ（多頭飼い向けの分類）
  const[editMicrochip,setEditMicrochip]=useState(""); // マイクロチップ番号（ペット）
  const[editBreed,setEditBreed]=useState(""); // 犬種・猫種
  const[editCoat,setEditCoat]=useState(""); // 毛の色
  const[editNeuter,setEditNeuter]=useState(""); // 避妊・去勢（""＝未設定 / done / not）
  const[editMemorial,setEditMemorial]=useState(""); // 虹の橋（お別れの日）。""＝現役 / 日付＝追悼モード
  const[editAvatar,setEditAvatar]=useState(""); // 写真アイコン（photo id）
  const[editVisibility,setEditVisibility]=useState("household");
  const[editPersonType,setEditPersonType]=useState("child"); // 人メンバーの大人/子ども区分
  const[editGender,setEditGender]=useState(""); // 性別（人・任意）
  const[editBlood,setEditBlood]=useState(""); // 血液型（人・任意）
  const[msCat,setMsCat]=useState("first"); // 成長記録：選択中カテゴリ
  const[msDraft,setMsDraft]=useState(""); // 成長記録：自由入力
  const[pointTask,setPointTask]=useState(""); // お手伝いポイント：自由入力タスク
  const[allowAmt,setAllowAmt]=useState(""); // おこづかい：金額
  const[allowDir,setAllowDir]=useState("in"); // もらった/つかった/ちょきん
  const[allowReason,setAllowReason]=useState(""); // おこづかい：メモ
  const[medName,setMedName]=useState(""); // お薬：名前
  const[medDays,setMedDays]=useState("5"); // お薬：日数
  const[notesOpen,setNotesOpen]=useState(false); // 家族ノート（メッセージ・感謝）
  const[noteText,setNoteText]=useState("");
  const[noteKind,setNoteKind]=useState("note");
  const[confirmDel,setConfirmDel]=useState(null);
  const[confirmReset,setConfirmReset]=useState(false);
  const[confirmRestore,setConfirmRestore]=useState(false);
  const[choreDateEdit,setChoreDateEdit]=useState(null); // お世話ログの実施日を後から修正 {id,date}
  const[choreDraft,setChoreDraft]=useState(""); // お世話ログの自由追加入力
  const[batchSel,setBatchSel]=useState(null); // まとめて記録：選択中の子（null=全ペット既定）
  const[bristolScore,setBristolScore]=useState(4); // トイレ記録：うんちの硬さ（ブリストル1-7、4が理想）
  const[toiletRange,setToiletRange]=useState(7); // 成功率の集計期間（日）
  const[colorDays,setColorDays]=useState(()=>{try{const s=JSON.parse(localStorage.getItem("loalife-colordays"));if(s&&s.warn>0&&s.alert>0)return s;}catch(e){}return{warn:7,alert:14};}); // お世話ログの色が変わる目安（黄/赤の日数）
  const persistColorDays=(next)=>{setColorDays(next);try{localStorage.setItem("loalife-colordays",JSON.stringify(next));}catch(e){}};
  const[vetOpen,setVetOpen]=useState(false); // 獣医さん用サマリー表示
  const[handoverOpen,setHandoverOpen]=useState(false); // 預け先・ホテル用の引き継ぎシート
  const[lostOpen,setLostOpen]=useState(false); // 迷子ポスター（オフライン表示・印刷）
  const[lostStep,setLostStep]=useState(0); // 迷子モードの一本道ステップ（0:場所日時 → 1:ペット情報 → 2:ポスター）
  const[emergencyCardOpen,setEmergencyCardOpen]=useState(false); // 緊急カード（子ども・自分／オフライン表示・印刷）
  const[vetDays,setVetDays]=useState(30); // サマリーの対象期間（日）
  const[a2hsHint,setA2hsHint]=useState(false); // 「ホーム画面に追加」データ保護の案内（1回だけ）
  const[confirmAct,setConfirmAct]=useState(null); // 汎用「本当に削除しますか？」 {label,fn}
  const askDelete=(label,fn)=>setConfirmAct({label,fn});
  const[memberSel,setMemberSel]=useState(()=>{try{return localStorage.getItem("loalife-membersel")||"me";}catch(e){return"me";}}); // メンバーモードで選択中の人（再訪時に復元）
  const[friendBdayName,setFriendBdayName]=useState(""); // 友達の誕生日・記念日（わくわく）
  const[healthW,setHealthW]=useState("");const[healthH,setHealthH]=useState("");const[healthCond,setHealthCond]=useState(""); // からだの記録の入力
  const[healthBpS,setHealthBpS]=useState("");const[healthBpD,setHealthBpD]=useState("");const[healthTemp,setHealthTemp]=useState("");const[healthGlucose,setHealthGlucose]=useState(""); // 高齢者バイタル（血圧上/下・体温・血糖値）
  const[feedUnit,setFeedUnit]=useState("serving");const[feedAmt,setFeedAmt]=useState("");const[feedMult,setFeedMult]=useState(1);const[feedServing,setFeedServing]=useState(""); // ごはん記録（回/g/ml/粒・1回分基準g・倍率）
  const[foodForm,setFoodForm]=useState(null); // フード詳細の登録フォーム null|{id?,name,brand,foodType,amount,unit,times,feedTime,kcal,kcalBasis}
  const[mealForm,setMealForm]=useState(null); // 今日の食事の記録フォーム null|{foodId,slot,amount}
  const[foodCalc,setFoodCalc]=useState(null); // 1日のフード量計算 null|{species,bw,stage,bcs,me}
  const[foodCalcGuide,setFoodCalcGuide]=useState(false); // BCSの見かたガイド開閉
  const[foodCalcMeGuide,setFoodCalcMeGuide]=useState(false); // MEの目安ガイド開閉
  // 授乳タイマー（赤ちゃん）：稼働中タイマーは localStorage に持たせてアプリを閉じても続く。
  const[nursing,setNursing]=useState(()=>{try{return JSON.parse(localStorage.getItem("loalife-nursing")||"null");}catch(e){return null;}}); // {space,side,start}
  // 散歩記録：稼働中の散歩（GPSルート・距離）。アプリを閉じても復帰できるよう localStorage に保持。
  const[walk,setWalk]=useState(()=>{try{return JSON.parse(localStorage.getItem("loalife-walk")||"null");}catch(e){return null;}}); // {space,start,route:[{lat,lng,t}],distanceM}
  const[walkNow,setWalkNow]=useState(Date.now());
  const[walkGpsErr,setWalkGpsErr]=useState("");
  const walkWatchRef=useRef(null);
  const[nursingNow,setNursingNow]=useState(Date.now());
  const[milkMl,setMilkMl]=useState("");
  const[friendBdayDate,setFriendBdayDate]=useState("");
  const[pickerId,setPickerId]=useState(null);
  const[viewer,setViewer]=useState(null);
  const[photos,setPhotos]=useState({});
  const[memoryDraft,setMemoryDraft]=useState(null); // {space,title} 思い出追加モーダル（旧）
  // カレンダー（ライフログ）
  const[calCursor,setCalCursor]=useState(()=>{const d=new Date();return{y:d.getFullYear(),m:d.getMonth()};}); // m:0-11
  const[calDay,setCalDay]=useState(null); // 選択日(ISO)
  const[calFilter,setCalFilter]=useState("all"); // all | me | memberId
  // ライフイベント統合エディタ（カレンダーからの登録・編集の単一入力）
  const[lifeDraft,setLifeDraft]=useState(null); // {id?,space,category,title,date,time,note,photoDataUrl,photoChanged,reminders,repeat}
  const[usage,setUsage]=useState({});
  const[editItemId,setEditItemId]=useState(null);
  const[eTitle,setETitle]=useState("");
  const[eDate,setEDate]=useState("");
  const[eTime,setETime]=useState("");
  const[eRepeat,setERepeat]=useState("none");
  const[eReminders,setEReminders]=useState([]);
  const[ePlace,setEPlace]=useState("");const[eUrl,setEUrl]=useState("");const[eMemo,setEMemo]=useState(""); // 予定の詳細（場所・URL・メモ）
  const[eChecklist,setEChecklist]=useState([]);const[eCheckDraft,setECheckDraft]=useState(""); // 予定のチェックリスト（持ち物など）
  const[eStock,setEStock]=useState(""); // ケアの残り在庫（回分・任意）。フィラリア等の買い足し管理に
  const[onboarding,setOnboarding]=useState(false);
  const[obStep,setObStep]=useState(0);
  const[obKind,setObKind]=useState(null);
  const[obSpecies,setObSpecies]=useState("dog");
  const[obPersonType,setObPersonType]=useState("child");
  const[obName,setObName]=useState("");
  const[obEmoji,setObEmoji]=useState("🐶");
  const[obAvatar,setObAvatar]=useState(""); // オンボーディングの写真アイコン（photo id）
  const[obBirthday,setObBirthday]=useState("");
  const[newAvatar,setNewAvatar]=useState(""); // 通常追加フォームの写真アイコン（photo id）
  const[notifPerm,setNotifPerm]=useState(notifSupported?Notification.permission:"denied");
  const[meEmoji,setMeEmoji]=useState("🙂");
  const[meBirthday,setMeBirthday]=useState("");
  const[meBdayEdit,setMeBdayEdit]=useState(false);
  const[meBdayDraft,setMeBdayDraft]=useState("");
  const[mePicker,setMePicker]=useState(false);
  const[meColor,setMeColor]=useState("");
  const[meName,setMeName]=useState("");   // わたしの表示名（任意・空なら「わたし」）
  const[meAvatar,setMeAvatar]=useState(""); // わたしの写真アイコン（IDBの photo:<id>）
  const[meNameDraft,setMeNameDraft]=useState("");
  // 今日のようす（日記）入力（症状・写真も。お薬手帳/体調メモ兼用）
  const[diaryDraft,setDiaryDraft]=useState({energy:"",appetite:"",poop:"",walk:false,hospital:false,sleep:"",note:"",symptoms:[],photo:null});
  const[diaryOpen,setDiaryOpen]=useState({}); // 今日のようすカードの開閉（アプリ内state・localStorage非依存）。既定=今日開・過去閉
  const[profileOpen,setProfileOpen]=useState(false); // プロフィール詳細（顔写真・説明・誕生日・編集）の開閉。既定=畳む
  const[profilePrompt,setProfilePrompt]=useState(null); // メンバー追加直後の「プロフィールを設定しませんか？」案内（対象 member id）
  const[memListOpen,setMemListOpen]=useState(false); // メンバー切替のドロップアップ一覧の開閉
  // 支出入力（記録は常に今日の日付で即記録。日付変更は編集画面のみ＝例外用途）
  const[expAmount,setExpAmount]=useState("");
  const[expCat,setExpCat]=useState("hospital");
  const[expNote,setExpNote]=useState("");
  const[expScope,setExpScope]=useState("this"); // this=このコ / all=みんな（全体）
  const[expEdit,setExpEdit]=useState(null); // {id,amount,category,note,date}
  // 使い方・機能紹介ページ
  const[helpOpen,setHelpOpen]=useState(false);
  const[aboutOpen,setAboutOpen]=useState(false); // 「このアプリについて」（バージョン・データ保存・共有方針・注意事項・お問い合わせ）
  const[whatsNewOpen,setWhatsNewOpen]=useState(false); // 「変更点・新機能」（What's New）
  // 表示言語（ja/en）。UI設定なのでローカル保存。既存ユーザー保護のため初回は日本語がデフォルト。
  const[lang,setLang]=useState(()=>{try{const s=localStorage.getItem("loalife-lang-v1");if(s==="ja"||s==="en"||s==="es"||s==="zh")return s;}catch(e){}return "ja";});
  // loalife-lang-v1 が未設定なら初回言語選択を表示（既存ユーザー＝設定済みには出さない）。
  const[langChosen,setLangChosen]=useState(()=>{try{const s=localStorage.getItem("loalife-lang-v1");return s==="ja"||s==="en"||s==="es"||s==="zh";}catch(e){return true;}});
  APP_LANG=lang; // モジュールレベルのコンポーネント用（レンダー時に同期）
  // 言語が未確定（初回選択中）のうちは loalife-lang-v1 を書き込まない（未設定状態を保つ）。
  useEffect(()=>{try{if(langChosen)localStorage.setItem("loalife-lang-v1",lang);}catch(e){}try{document.documentElement.lang=lang;}catch(e){}},[lang,langChosen]);
  // 初回言語選択の確定（設定画面と共通の setLang を使い、保存ロジックは二重化しない）。
  const confirmLang=useCallback(()=>{try{localStorage.setItem("loalife-lang-v1",lang);}catch(e){}setLangChosen(true);},[lang]);
  const t=useCallback((k,v)=>tr(lang,k,v),[lang]);
  // 相対日付タグ（既存の日本語タグ文字列を解釈して各言語へ。ja選択時は元の文言と一致）。
  const locTag=useCallback((tag)=>{
    if(tag==null)return tag;
    if(tag==="今日")return t("rel.today");
    if(tag==="やり残し")return t("rel.overdue");
    if(tag==="明日")return t("rel.tomorrow");
    const m=/^あと(\d+)日(で期限)?$/.exec(tag);
    if(m)return m[2]?t("rel.dueInDays",{d:m[1]}):t("rel.inDays",{d:m[1]});
    return tag; // 時刻など（そのまま）
  },[t]);
  // 経過表記（elapsedLabel の kind/n を各言語へ。ja選択時は元の日本語表記に一致）。
  const elText=useCallback((el)=>{
    if(!el)return"";
    switch(el.kind){
      case"none":return t("rel.stillNone");
      case"today":return t("rel.today");
      case"daysAgo":return t("rel.daysAgo",{n:el.n});
      case"weeksAgo":return t("rel.weeksAgo",{n:el.n});
      case"monthsAgo":return t("rel.monthsAgo",{n:el.n});
      default:return el.txt;
    }
  },[t]);
  // 外観テーマ（system=端末に追従 / light / dark）。UI設定なのでローカル保存。
  const[theme,setTheme]=useState(()=>{try{return localStorage.getItem("loalife-theme-v1")||"system";}catch(e){return "system";}});
  useEffect(()=>{
    const root=document.documentElement;
    const mq=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)");
    const apply=()=>{const dark=theme==="dark"||(theme==="system"&&mq&&mq.matches);if(dark)root.setAttribute("data-theme","dark");else root.removeAttribute("data-theme");};
    apply();
    try{localStorage.setItem("loalife-theme-v1",theme);}catch(e){}
    if(theme==="system"&&mq&&mq.addEventListener){mq.addEventListener("change",apply);return()=>mq.removeEventListener("change",apply);}
  },[theme]);
  // 大切な情報カード 編集
  const[cardEdit,setCardEdit]=useState(null); // {id?,space,kind,title,body,photo}
  // 持ち物（曜日ごと）入力
  const[belongDraft,setBelongDraft]=useState("");
  const[belongDow,setBelongDow]=useState(()=>{const d=new Date();return(d.getDay()+1)%7;}); // 既定=明日の曜日
  // 大切な情報トレイの開閉
  const[trayOpen,setTrayOpen]=useState(false);
  // ホーム「記録」層の開閉（低頻度の情報は既定で畳む）
  const[recOpen,setRecOpen]=useState(false);
  // 人/ペット/わたし画面の表示セグメント（見せ方だけ：today/record/info。データは共通）
  const[personSeg,setPersonSeg]=useState(()=>{try{return localStorage.getItem("loalife-personseg")||"record";}catch(e){return"record";}});
  // 大項目（セクション）の並び順（タブごと）。UI設定なので別キーに保存し本体データから分離。
  const[secOrder,setSecOrder]=useState(()=>{const DEF={record:[...SEC_DEF.record],manage:[...SEC_DEF.manage]};try{const s=JSON.parse(localStorage.getItem("loalife-secorder-v2"));if(s&&typeof s==="object"){const merged={...DEF,...s};for(const seg of Object.keys(DEF)){const cur=Array.isArray(merged[seg])?[...merged[seg]]:[];DEF[seg].forEach(k=>{if(!cur.includes(k))cur.push(k);});merged[seg]=cur;}return merged;}}catch(e){}return DEF;});
  // 天気（登録地点の気温・湿度／熱中症注意）。位置は端末ローカルに保存。データ元＝Open-Meteo（APIキー不要）。
  // 複数地点対応：weatherLocs＝保存した地点リスト、weatherLocId＝選択中。weatherLoc は選択中の地点（既存ロジックはこれを参照）。
  const LOC_MAX=5;
  const[weatherLocs,setWeatherLocs]=useState(()=>{
    try{const a=JSON.parse(localStorage.getItem("loalife-weatherlocs"));if(Array.isArray(a)&&a.length)return a;}catch(e){}
    try{const o=JSON.parse(localStorage.getItem("loalife-weatherloc"));if(o&&o.lat!=null)return[{id:"loc"+Date.now(),name:o.name||"現在地",lat:o.lat,lon:o.lon}];}catch(e){}
    return[];
  });
  const[weatherLocId,setWeatherLocId]=useState(()=>{try{return localStorage.getItem("loalife-weatherloc-sel")||null;}catch(e){return null;}});
  const weatherLoc=useMemo(()=>weatherLocs.length?(weatherLocs.find(l=>l.id===weatherLocId)||weatherLocs[0]):null,[weatherLocs,weatherLocId]);
  const[weather,setWeather]=useState(null); // {temp,humidity,time}|{error:true}
  const[weatherLoading,setWeatherLoading]=useState(false);
  const[jmaWarn,setJmaWarn]=useState(null); // 気象庁の警報・注意報 {area,warnings:[{code,name,level}],at}|null
  const[wxQuery,setWxQuery]=useState("");
  const[wxResults,setWxResults]=useState(null); // null=未検索, []=該当なし
  const[wxSearching,setWxSearching]=useState(false);
  const[wxAddOpen,setWxAddOpen]=useState(false);   // 地点追加モーダル
  const[wxGeoLoading,setWxGeoLoading]=useState(false);
  const[wxRename,setWxRename]=useState(null);       // {id,val} 地点名の変更中
  const[walkOpen,setWalkOpen]=useState(false); // お散歩指数の内訳の開閉
  const[wxDetail,setWxDetail]=useState(false); // 天気カードの詳細の開閉（初期は要点だけ）
  const[walkDay,setWalkDay]=useState("today"); // 散歩タイム：今日/明日の切替
  const[toxicOpen,setToxicOpen]=useState(false); // 誤食・中毒の危険物リスト
  const[toxicSp,setToxicSp]=useState("all"); // dog/cat/all
  const[toxicQ,setToxicQ]=useState("");
  const[toxicCat,setToxicCat]=useState("all"); // 食品/薬/植物/家庭用品
  const[toxicExpanded,setToxicExpanded]=useState(null); // 展開中の項目id
  const[toxicEmgOpen,setToxicEmgOpen]=useState(false); // 「今、食べたかも？」チェック
  const[toxicSrcOpen,setToxicSrcOpen]=useState(false); // 「情報源について」の開閉
  const[emergencyOpen,setEmergencyOpen]=useState(false); // 夜間・救急の備え
  const[disasterOpen,setDisasterOpen]=useState(false); // 防災・避難の備え
  const[tipsOpen,setTipsOpen]=useState(false); // 「もっと詳しく伝える」の開閉
  const[toxicEmgForm,setToxicEmgForm]=useState({what:"",amount:"",when:"",weight:"",symptom:""}); // 誤食チェックの入力
  const[toxicEmgInfo,setToxicEmgInfo]=useState(null); // 誤食チェックの内容（救急画面へ連携。セッション中のみ保持）
  const[emgPrepOpen,setEmgPrepOpen]=useState(false); // 平時のチェックリストの開閉
  const[emgDontOpen,setEmgDontOpen]=useState(false); // 「してはいけないこと」の開閉
  const[imgSaving,setImgSaving]=useState(false); // シート・カードの画像保存中フラグ
  const[disasterTipsOpen,setDisasterTipsOpen]=useState(false); // 防災「いざという時のポイント」の開閉
  const[menuOpen,setMenuOpen]=useState(false); // まとめメニュー（右からのドロワー）
  const[authTab,setAuthTab]=useState("google"); // 家族共有のサインイン方式：google/email
  const[authEmail,setAuthEmail]=useState("");
  const[authPw,setAuthPw]=useState("");
  const[authIsSignup,setAuthIsSignup]=useState(false);
  // ＋入力ハブ（全入力を1か所に集約）。hubOpen=チューザー、inputSheet=開いている入力フォーム
  const[hubOpen,setHubOpen]=useState(false);
  const[tourStep,setTourStep]=useState(null); // 初回ツアー(A)の現在ステップ（null=非表示）
  const[coachKey,setCoachKey]=useState(null); // 画面ごとの初回案内(B)の対象画面キー
  const tourInit=useRef(false);
  const[inputSheet,setInputSheet]=useState(null); // "schedule"|"health"|"diary"|"expense"|"belong"|"bday"|null
  const[doneOpen,setDoneOpen]=useState(false); // 予定リストの「完了済み」セクションの開閉（既定は折りたたみ）
  // 記録メニューに「追加した機能」のキー一覧（ユーザー操作で増える。UI設定なのでローカル保存）。
  // メイン領域への表示は「使ったか」ではなく、この明示的な追加操作でのみ変わる（並びの安定性）。
  const[menuAdded,setMenuAdded]=useState(()=>{try{return JSON.parse(localStorage.getItem("loalife-menu-added"))||[];}catch(e){return[];}});
  const menuMigrated=useRef(false);
  const addToMenu=useCallback((key)=>{setMenuAdded(prev=>{if(prev.includes(key))return prev;const next=[...prev,key];try{localStorage.setItem("loalife-menu-added",JSON.stringify(next));}catch(e){}return next;});},[]);
  // 既存ユーザー移行：すでにデータのある任意機能は「追加済み」として扱い、メインに残す（初回のみ）。
  useEffect(()=>{
    if(menuMigrated.current)return;
    try{if(localStorage.getItem("loalife-menu-migrated")==="1"){menuMigrated.current=true;return;}}catch(e){}
    if(!items.length)return; // データ読込を待つ
    const map={health:"health",expense:"expense",memory:"memory",supply:"supply",card:"card",belong:"belonging",bday:"bday"};
    const seed=Object.keys(map).filter(k=>items.some(x=>x.type===map[k]));
    if(seed.length)setMenuAdded(prev=>{const next=[...new Set([...prev,...seed])];try{localStorage.setItem("loalife-menu-added",JSON.stringify(next));}catch(e){}return next;});
    try{localStorage.setItem("loalife-menu-migrated","1");}catch(e){}
    menuMigrated.current=true;
  },[items]);
  // 思い出アルバムのタグ絞り込み
  const[albumTag,setAlbumTag]=useState("");
  // 思い出の一括選択・移動（selMode=選択中の思い出ID配列 or null＝通常）／moveOpen=移動先ピッカー
  const[albumSel,setAlbumSel]=useState(null);
  const[albumMoveOpen,setAlbumMoveOpen]=useState(false);
  // 思い出に付けるタグ入力（ライフエディタ）
  const[tagInput,setTagInput]=useState("");
  const timerIds=useRef([]);

  // Firebase / Family sharing state
  const[fireUser,setFireUser]=useState(null);
  const[fireLoading,setFireLoading]=useState(FB_READY);
  const[household,setHousehold]=useState(null);
  const[showShareModal,setShowShareModal]=useState(false);
  const[shareStep,setShareStep]=useState("menu");
  const[joinCodeInput,setJoinCodeInput]=useState("");
  const[shareError,setShareError]=useState("");
  const[shareLoading,setShareLoading]=useState(false);
  const[copiedCode,setCopiedCode]=useState(false);
  const householdUnsub=useRef(null);

  // Quick-add state
  const[quickAdd,setQuickAdd]=useState(null); // {kind,emoji,title,space,lastDate,repeat}
  const[quickDate,setQuickDate]=useState("");

  // Calendar picker state
  const[calPicker,setCalPicker]=useState(null); // {item} | {bulk:true}

  // ルーティン編集モーダル state
  const[routineEdit,setRoutineEdit]=useState(null); // {id?,title,emoji,time,reminders,space}

  // 消耗品ストック編集モーダル state
  const[supplyEdit,setSupplyEdit]=useState(null); // {id?,title,emoji,cycleDays,lastBought,space}

  // Load local data
  useEffect(()=>{(async()=>{
    // データ読み込み: 現行キー → 旧キー の順で探し、見つかったら migrate して引き継ぐ。
    // ユーザーデータは絶対に破棄しない（旧キー・破損データも消さず退避＝自動バックアップ）。
    const tryParse=(s)=>{try{return JSON.parse(s);}catch(e){return null;}};
    let raw=null,fromLegacy=false;
    try{
      const res=await storage.get(STORAGE_KEY);
      if(res&&res.value)raw=res.value;
      else{
        for(const k of LEGACY_STORAGE_KEYS){
          const r=await storage.get(k);
          if(r&&r.value){raw=r.value;fromLegacy=true;break;}
        }
      }
    }catch(e){}
    const parsed=raw?tryParse(raw):null;
    if(parsed){
      // 移行は非破壊（未知フィールド温存・欠損補完）。旧データでも UI が壊れない。
      const state=migrateState(parsed);
      setMembers(state.members);setItems(state.items);setUsage(state.usage);
      if(state.meEmoji)setMeEmoji(state.meEmoji);
      if(state.meBirthday)setMeBirthday(state.meBirthday);
      if(state.meColor)setMeColor(state.meColor);
      if(state.meName)setMeName(state.meName);
      if(state.meAvatar)setMeAvatar(state.meAvatar);
      // 前回メンバーの画面を見ていたら、その子で再開する（毎回「自分」に戻らないように）。
      try{const lt=localStorage.getItem("loalife-tab");if(lt&&state.members.some(m=>m.id===lt))setTab(lt);}catch(e){}
      setLoaded(true);
      // 旧キー由来 / バージョンが古い場合のみ現行キーへ保存（旧キーは残す＝バックアップ）。
      try{
        const needWrite=fromLegacy||parsed.version!==SCHEMA_VERSION;
        if(needWrite){
          if(!fromLegacy)await storage.set(STORAGE_KEY+".bak",raw); // 念のため移行前の生データを退避
          await storage.set(STORAGE_KEY,serializeState({members:state.members,items:state.items,usage:state.usage,meEmoji:state.meEmoji,meBirthday:state.meBirthday,meColor:state.meColor,meName:state.meName,meAvatar:state.meAvatar}));
        }
      }catch(e){}
      return;
    }
    // パース不能な破損データは絶対に消さず .corrupt に退避（手動復旧の余地を残す）。
    if(raw){try{await storage.set(STORAGE_KEY+".corrupt",raw);}catch(e){}}
    setMembers([]);setItems([]);setOnboarding(true);setLoaded(true);
  })();},[]);

  // データ永続化の要求＋写真をIDBへ移行（iOS等の自動削除リスク低減）
  useEffect(()=>{
    try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});}catch(e){}
    migratePhotosToIDB(); // 既存のlocalStorage写真をIDBへ移してlocalStorage枠を解放
  },[]);

  // 「ホーム画面に追加」案内の出し分け：
  //  - 守るデータがある人（メンバー/項目を登録済み）にだけ出す
  //  - ホーム画面に追加済み（standalone起動）なら出さない
  //  - 「OK」は永久非表示ではなくスヌーズ（数日）。未追加なら時々リマインド
  useEffect(()=>{
    if(!loaded){setA2hsHint(false);return;}
    try{
      const standalone=(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||window.navigator.standalone;
      const hasData=members.length>0||items.length>0;
      const snoozeUntil=Number(localStorage.getItem("loalife-a2hs-snooze")||0);
      setA2hsHint(!standalone&&hasData&&Date.now()>=snoozeUntil);
    }catch(e){setA2hsHint(false);}
  },[loaded,members,items]);

  // Firebase Auth state
  useEffect(()=>{setMemListOpen(false);setAdding(false);},[tab,personSeg]); // 画面切替でメンバー一覧・追加フォームを閉じる
  useEffect(()=>{setAlbumSel(null);setAlbumMoveOpen(false);},[tab,personSeg]); // メンバー切替で思い出の選択状態をリセット（他メンバーへ持ち越さない）
  useEffect(()=>{
    if(!FB_READY){setFireLoading(false);return;}
    return onAuthStateChanged(fbAuth,async(user)=>{
      setFireUser(user);
      if(user){
        try{
          const uRef=doc(fbDb,"users",user.uid);
          const uSnap=await getDoc(uRef);
          if(uSnap.exists()){
            const ud=uSnap.data();
            if(ud.meEmoji)setMeEmoji(ud.meEmoji);
            if(ud.meBirthday)setMeBirthday(ud.meBirthday);
            if(ud.meColor)setMeColor(ud.meColor);
            if(ud.meName)setMeName(ud.meName);
            if(ud.meAvatar)setMeAvatar(ud.meAvatar);
            if(ud.householdId){
              const hhSnap=await getDoc(doc(fbDb,"households",ud.householdId));
              if(hhSnap.exists()){
                setHousehold({id:ud.householdId,...hhSnap.data()});
              }
            }
          }
        }catch(e){}
      }else{
        setHousehold(null);
        if(householdUnsub.current){householdUnsub.current();householdUnsub.current=null;}
      }
      setFireLoading(false);
    });
  },[]);

  // Firestore members real-time subscription
  useEffect(()=>{
    if(householdUnsub.current){householdUnsub.current();householdUnsub.current=null;}
    if(!household||!fireUser)return;
    const hid=household.id;
    const q=collection(fbDb,"households",hid,"members");
    const unsub=onSnapshot(q,(snap)=>{
      // Firestore 読み取り時に lazy 正規化（旧スキーマでも UI が壊れないよう default 補完）
      const firestoreMembers=snap.docs
        .map(d=>normalizeMember({id:d.id,...d.data()}))
        .filter(m=>m&&(m.visibility==="household"||m.ownerUid===fireUser.uid));
      setMembers(firestoreMembers);
      // Also load items for each member from Firestore
      Promise.all(firestoreMembers.map(async m=>{
        const iSnap=await getDocs(collection(fbDb,"households",hid,"members",m.id,"items"));
        return iSnap.docs.map(d=>normalizeItem({id:d.id,...d.data(),space:m.id})).filter(Boolean);
      })).then(allItems=>{
        const flat=allItems.flat();
        // Merge with local "me" items
        setItems(prev=>{
          const meItems=prev.filter(x=>x.space==="me");
          return[...meItems,...flat];
        });
      }).catch(()=>{});
    });
    householdUnsub.current=unsub;
    return()=>{unsub();householdUnsub.current=null;};
  },[household,fireUser]);

  // Schedule reminders when items/permission change
  useEffect(()=>{
    timerIds.current.forEach(clearTimeout);
    timerIds.current=scheduleReminders(items,members);
    return()=>timerIds.current.forEach(clearTimeout);
  },[items,members,notifPerm]);

  // 追悼モード（虹の橋）の子。予定・ケアのお知らせや「今日やること」から除外する。
  // ※ 通知やhomeDataの useEffect/useMemo 依存配列より前で宣言する必要がある（TDZ回避）。
  const memorialIds=useMemo(()=>new Set(members.filter(m=>m.kind==="pet"&&m.memorial).map(m=>m.id)),[members]);
  const isMemorialSpace=(sp)=>memorialIds.has(sp);
  // お散歩するペット（犬）がいるか。いなければお散歩指数・散歩タイム等は隠し、天気だけ出す。
  const hasWalker=useMemo(()=>members.some(m=>m.kind==="pet"&&!m.memorial&&m.species==="dog"),[members]);

  // Birthday & うちの子記念日 notifications on load
  useEffect(()=>{
    if(!loaded||notifPerm!=="granted") return;
    members.forEach(m=>{
      if(m.kind==="pet"&&m.memorial)return; // 追悼モードの子は誕生日・記念日通知を控える
      const d=daysUntilBirthday(m.birthday);
      if(d===0) setTimeout(()=>fireNotif(`🎂 ${m.name}の誕生日！`,`今日は${m.name}の誕生日です`),1000);
      if(d===3) setTimeout(()=>fireNotif(`🎂 ${m.name}の誕生日まであと3日`,`お祝いの準備はできてますか？`),2000);
      // うちの子記念日（おうちに来た日）
      const g=daysUntilAnniv(m.gotchaDay);
      if(g===0){const y=yearsSinceAnniv(m.gotchaDay);setTimeout(()=>fireNotif(`🎉 ${m.name} うちの子記念日！`,y?`今日で迎えて${y}年。おめでとう！`:`今日は${m.name}をおうちに迎えた記念日です`),1500);}
    });
    // 友達の誕生日・記念日（自分タブに登録したもの）
    items.filter(x=>x.space==="me"&&x.type==="bday"&&x.birthday).forEach(x=>{
      const d=daysUntilAnniv(x.birthday);
      if(d===0)setTimeout(()=>fireNotif(`🎂 ${x.title}`,`今日は「${x.title}」です`),1200);
      if(d===3)setTimeout(()=>fireNotif(`🎂 ${x.title}まであと3日`,`お祝いの準備はできてますか？`),2200);
    });
  },[loaded,notifPerm]);

  // 逆算リマインド：アプリを開いた時、その日まだ通知していなければ
  // 「在庫切れ・期限が近いもの」を1日1回まとめて端末通知する。
  // ※ アプリ完全クローズ中の配信は別途バックエンド(FCM)が必要。ここは開いた時の確実な一発。
  useEffect(()=>{
    if(!loaded||notifPerm!=="granted")return;
    let last=null;try{last=localStorage.getItem(DIGEST_KEY);}catch(e){}
    const today=iso(new Date());
    if(last===today)return; // 今日はもう通知済み
    const urgent=buildDigest(items.filter(x=>!memorialIds.has(x.space))); // 追悼モードの子は除外
    if(urgent.length===0)return;
    const body=urgent.slice(0,3).map(u=>`${u.emoji} ${u.text}`).join(" / ")+(urgent.length>3?` ほか${urgent.length-3}件`:"");
    const id=setTimeout(()=>{
      fireNotif("🔔 今日の見守り",body);
      try{localStorage.setItem(DIGEST_KEY,today);}catch(e){}
    },1800);
    return()=>clearTimeout(id);
  },[loaded,notifPerm,items,memorialIds]);

  // Local persist (used when no household)
  const persist=async(m,it,u=usage)=>{
    setMembers(m);setItems(it);setUsage(u);
    if(!household){
      try{await storage.set(STORAGE_KEY,serializeState({members:m,items:it,usage:u,meEmoji,meBirthday,meColor,meName,meAvatar}));}catch(e){}
    }
  };

  // 天気の取得（Open-Meteo・APIキー不要・CORS対応）。現在の実況＋当日の予報（最高/最低・天気）を取得。
  const fetchWeather=useCallback(async(loc)=>{
    if(!loc)return;setWeatherLoading(true);
    try{
      const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,cloud_cover,weather_code,wind_speed_10m,uv_index,precipitation&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,uv_index,soil_temperature_0cm&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max&wind_speed_unit=ms&forecast_days=2&timezone=auto`);
      if(!r.ok)throw new Error("bad");
      const j=await r.json();const c=j.current||{};const d=j.daily||{};const H=j.hourly||{};
      // 路面（地表）温度：Open-Meteo の地表温度(0cm)を現在の時刻で取得。無ければ日射モデルで推定。
      let road=null,roadEstimated=false;
      const ht=H.time,hs=H.soil_temperature_0cm;
      if(Array.isArray(ht)&&Array.isArray(hs)&&c.time){const idx=ht.findIndex(t=>t.slice(0,13)===c.time.slice(0,13));if(idx>=0&&typeof hs[idx]==="number")road=hs[idx];}
      if(road==null&&typeof c.temperature_2m==="number"){const isDay=c.is_day===1;const cloud=typeof c.cloud_cover==="number"?c.cloud_cover:50;const delta=!isDay?2:(cloud<30?25:cloud<70?15:8);road=c.temperature_2m+delta;roadEstimated=true;}
      // 現在時間帯の降水確率（大雨警報級＝今の天気コードが雨でなくても高い確率を見逃さない）
      let curPop=null;
      if(Array.isArray(ht)&&Array.isArray(H.precipitation_probability)&&c.time){const pidx=ht.findIndex(t=>t.slice(0,13)===c.time.slice(0,13));if(pidx>=0&&typeof H.precipitation_probability[pidx]==="number")curPop=H.precipitation_probability[pidx];}
      const hi=Array.isArray(d.temperature_2m_max)?d.temperature_2m_max[0]:null;
      const lo=Array.isArray(d.temperature_2m_min)?d.temperature_2m_min[0]:null;
      const code=typeof c.weather_code==="number"?c.weather_code:(Array.isArray(d.weather_code)?d.weather_code[0]:null);
      const uv=typeof c.uv_index==="number"?c.uv_index:(Array.isArray(d.uv_index_max)?d.uv_index_max[0]:null);
      // 今日の時間別（散歩タイム判定用）。5〜22時ぶんを取り出す。
      let hours=null;
      if(Array.isArray(ht)){
        const day=(c.time||ht[0]||"").slice(0,10);
        hours=[];
        ht.forEach((t,i)=>{const hh=parseInt(t.slice(11,13),10);if(t.slice(0,10)===day&&hh>=5&&hh<=22)hours.push({h:hh,temp:H.temperature_2m?.[i],app:H.apparent_temperature?.[i],pop:H.precipitation_probability?.[i],uv:H.uv_index?.[i],code:H.weather_code?.[i]});});
        if(hours.length===0)hours=null;
      }
      // 明日の予報（最高/最低・天気・UV）＋時間別（散歩タイム用）。
      let tomorrow=null;
      if(Array.isArray(ht)){
        const today=(c.time||ht[0]||"").slice(0,10);
        const tmr=addInterval(today,"daily");
        const th=[];
        ht.forEach((t,i)=>{const hh=parseInt(t.slice(11,13),10);if(t.slice(0,10)===tmr&&hh>=5&&hh<=22)th.push({h:hh,temp:H.temperature_2m?.[i],app:H.apparent_temperature?.[i],pop:H.precipitation_probability?.[i],uv:H.uv_index?.[i],code:H.weather_code?.[i]});});
        const thi=Array.isArray(d.temperature_2m_max)?d.temperature_2m_max[1]:null;
        const tlo=Array.isArray(d.temperature_2m_min)?d.temperature_2m_min[1]:null;
        const tcode=Array.isArray(d.weather_code)?d.weather_code[1]:null;
        const tuv=Array.isArray(d.uv_index_max)?d.uv_index_max[1]:null;
        if(thi!=null||th.length)tomorrow={hi:thi,lo:tlo,code:tcode,uv:tuv,hours:th.length?th:null};
      }
      setWeather({temp:c.temperature_2m,humidity:c.relative_humidity_2m,apparent:c.apparent_temperature,isDay:c.is_day===1,cloud:c.cloud_cover,wind:c.wind_speed_10m,uv,precip:(typeof c.precipitation==="number"?c.precipitation:null),pop:curPop,roadTemp:road==null?null:Math.round(road*10)/10,roadEstimated,hi,lo,code,hours,tomorrow,time:c.time,fetchedAt:Date.now()});
    }catch(e){setWeather({error:true});}
    setWeatherLoading(false);
  },[]);
  useEffect(()=>{if(weatherLoc)fetchWeather(weatherLoc);},[weatherLoc,fetchWeather]);
  // 気象庁（JMA）の警報・注意報を取得。Open-Meteoの予報が晴れでも、実際の警報を反映するため。
  // 取得不可（CORS/障害/開発環境のプロキシ制限）は静かにnull＝Open-Meteoのみで動作（既存機能は不変）。
  const fetchJmaWarnings=useCallback(async(loc)=>{
    if(!loc||loc.lat==null){setJmaWarn(null);return;}
    const area=nearestJmaArea(loc.lat,loc.lon);if(!area){setJmaWarn(null);return;}
    try{
      const r=await fetch(`https://www.jma.go.jp/bosai/warning/data/warning/${area.code}.json`,{cache:"no-store"});
      if(!r.ok)throw new Error("bad");
      const j=await r.json();
      setJmaWarn({area:area.name,warnings:parseJmaWarnings(j),at:Date.now()});
    }catch(e){setJmaWarn(null);}
  },[]);
  useEffect(()=>{if(weatherLoc)fetchJmaWarnings(weatherLoc);else setJmaWarn(null);},[weatherLoc,fetchJmaWarnings]);
  // アプリを再び前面にしたとき（PWAは開きっぱなしになりがち）、天気が古ければ自動で更新して実況とのズレを防ぐ。
  useEffect(()=>{
    const onVis=()=>{if(document.visibilityState==="visible"&&weatherLoc){setWeather(w=>{if(!w||!w.fetchedAt||Date.now()-w.fetchedAt>10*60*1000)fetchWeather(weatherLoc);return w;});}};
    document.addEventListener("visibilitychange",onVis);
    return()=>document.removeEventListener("visibilitychange",onVis);
  },[weatherLoc,fetchWeather]);
  // 地域検索（Open-Meteo Geocoding）。同名地名が全国・海外に多数あるため、
  // 日本国内を優先し、人口が多い（＝よく知られた）地点を上位に並べて取り違えを防ぐ。
  const searchPlace=async()=>{const q=wxQuery.trim();if(!q)return;setWxSearching(true);setWxResults(null);
    try{
      const r=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=20&language=ja&format=json`);
      const j=await r.json();
      let list=Array.isArray(j.results)?j.results:[];
      const jp=list.filter(x=>x.country_code==="JP");
      if(jp.length)list=jp; // 日本に該当があれば海外の同名を除外
      list=list.slice().sort((a,b)=>(b.population||0)-(a.population||0)); // 人口降順（不明は後ろ）
      setWxResults(list.slice(0,8));
    }
    catch(e){setWxResults([]);}
    setWxSearching(false);};
  // 表示・保存用の地名（都道府県・市区町村を付けて取り違えを防ぐ）
  const placeParts=(res)=>[res.admin1,res.admin2,res.admin3].filter(v=>v&&v!==res.name);
  const placeLabel=(res)=>[res.name,...placeParts(res)].join("・");
  // 地点リストの保存（端末ローカル）。選択中の地点は旧キー（loalife-weatherloc）にも同期し、互換性を保つ。
  const persistLocs=(arr,selId)=>{
    setWeatherLocs(arr);
    try{localStorage.setItem("loalife-weatherlocs",JSON.stringify(arr));}catch(e){}
    if(selId!==undefined){setWeatherLocId(selId);try{selId?localStorage.setItem("loalife-weatherloc-sel",selId):localStorage.removeItem("loalife-weatherloc-sel");}catch(e){}}
    try{const sid=selId!==undefined?selId:weatherLocId;const sel=arr.find(l=>l.id===sid)||arr[0];if(sel)localStorage.setItem("loalife-weatherloc",JSON.stringify({name:sel.name,lat:sel.lat,lon:sel.lon}));else localStorage.removeItem("loalife-weatherloc");}catch(e){}
  };
  const addPlace=(loc)=>{
    if(weatherLocs.length>=LOC_MAX){showFlash(`地点は最大${LOC_MAX}件までです`);return null;}
    const id="loc"+Date.now()+Math.floor(Math.random()*1000);
    const entry={id,name:((loc.name||"地点").trim()||"地点").slice(0,24),lat:loc.lat,lon:loc.lon};
    setWeather(null);
    persistLocs([...weatherLocs,entry],id);
    return id;
  };
  const pickPlace=(res)=>{const nm=res.name+(res.admin1&&res.admin1!==res.name?`・${res.admin1}`:"");if(addPlace({name:nm,lat:res.latitude,lon:res.longitude})){setWxResults(null);setWxQuery("");setWxAddOpen(false);}};
  const selectPlace=(id)=>{if(id===weatherLoc?.id)return;setWeather(null);setWeatherLocId(id);try{localStorage.setItem("loalife-weatherloc-sel",id);const sel=weatherLocs.find(l=>l.id===id);if(sel)localStorage.setItem("loalife-weatherloc",JSON.stringify({name:sel.name,lat:sel.lat,lon:sel.lon}));}catch(e){}};
  const renamePlace=(id,name)=>{persistLocs(weatherLocs.map(l=>l.id===id?{...l,name:(name.trim()||l.name).slice(0,24)}:l));};
  const removePlace=(id)=>{const arr=weatherLocs.filter(l=>l.id!==id);const nextSel=(id===weatherLoc?.id)?(arr[0]?arr[0].id:null):weatherLocId;setWeather(null);persistLocs(arr,nextSel);};
  const movePlace=(id,dir)=>{const i=weatherLocs.findIndex(l=>l.id===id);if(i<0)return;const j=i+dir;if(j<0||j>=weatherLocs.length)return;const arr=[...weatherLocs];[arr[i],arr[j]]=[arr[j],arr[i]];persistLocs(arr);};
  const pinPlace=(id)=>{const i=weatherLocs.findIndex(l=>l.id===id);if(i<=0)return;const arr=[...weatherLocs];const[it]=arr.splice(i,1);arr.unshift(it);persistLocs(arr);};
  const useCurrentLoc=()=>{
    if(!navigator.geolocation){showFlash("この端末では位置情報が使えません");return;}
    setWxGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos)=>{setWxGeoLoading(false);if(addPlace({name:"現在地",lat:pos.coords.latitude,lon:pos.coords.longitude}))setWxAddOpen(false);},
      ()=>{setWxGeoLoading(false);showFlash("現在地を取得できませんでした");},
      {enableHighAccuracy:false,timeout:10000,maximumAge:300000}
    );
  };

  // Firestore: save member
  const saveMemberToFs=async(member)=>{
    if(!household||!fireUser)return;
    const hid=household.id;
    const{id,...rest}=member;
    await setDoc(doc(fbDb,"households",hid,"members",id),{...withSchemaMeta(rest),ownerUid:fireUser.uid,updatedAt:serverTimestamp()},{merge:true});
  };

  // Firestore: save item
  const saveItemToFs=async(item)=>{
    if(!household||!fireUser)return;
    if(item.space==="me")return; // Me items stay local
    const hid=household.id;
    const{id,space,...rest}=item;
    await setDoc(doc(fbDb,"households",hid,"members",space,"items",id),{...withSchemaMeta(rest),ownerUid:fireUser.uid,updatedAt:serverTimestamp()},{merge:true});
  };

  // Firestore: delete item
  const deleteItemFromFs=async(item)=>{
    if(!household||!fireUser||item.space==="me")return;
    const hid=household.id;
    try{await deleteDoc(doc(fbDb,"households",hid,"members",item.space,"items",item.id));}catch(e){}
  };

  // Firestore: delete member + items
  const deleteMemberFromFs=async(memberId)=>{
    if(!household||!fireUser)return;
    const hid=household.id;
    try{
      const iSnap=await getDocs(collection(fbDb,"households",hid,"members",memberId,"items"));
      const batch=writeBatch(fbDb);
      iSnap.docs.forEach(d=>batch.delete(d.ref));
      batch.delete(doc(fbDb,"households",hid,"members",memberId));
      await batch.commit();
    }catch(e){}
  };

  const persistMeEmoji=(emo)=>{
    setMeEmoji(emo);
    try{storage.set(STORAGE_KEY,serializeState({members,items,usage,meEmoji:emo,meBirthday,meColor,meName,meAvatar})).catch(()=>{});}catch(e){}
    if(fireUser){try{setDoc(doc(fbDb,"users",fireUser.uid),{meEmoji:emo},{merge:true}).catch(()=>{});}catch(e){}}
  };
  const persistMeBirthday=(bday)=>{
    setMeBirthday(bday);
    try{storage.set(STORAGE_KEY,serializeState({members,items,usage,meEmoji,meBirthday:bday,meColor,meName,meAvatar})).catch(()=>{});}catch(e){}
    if(fireUser){try{setDoc(doc(fbDb,"users",fireUser.uid),{meBirthday:bday},{merge:true}).catch(()=>{});}catch(e){}}
  };
  const persistMeColor=(c)=>{
    setMeColor(c);
    try{storage.set(STORAGE_KEY,serializeState({members,items,usage,meEmoji,meBirthday,meColor:c,meName,meAvatar})).catch(()=>{});}catch(e){}
    if(fireUser){try{setDoc(doc(fbDb,"users",fireUser.uid),{meColor:c},{merge:true}).catch(()=>{});}catch(e){}}
  };
  const persistMeName=(nm)=>{
    setMeName(nm);
    try{storage.set(STORAGE_KEY,serializeState({members,items,usage,meEmoji,meBirthday,meColor,meName:nm,meAvatar})).catch(()=>{});}catch(e){}
    if(fireUser){try{setDoc(doc(fbDb,"users",fireUser.uid),{meName:nm},{merge:true}).catch(()=>{});}catch(e){}}
  };
  const persistMeAvatar=(pid)=>{
    setMeAvatar(pid);
    try{storage.set(STORAGE_KEY,serializeState({members,items,usage,meEmoji,meBirthday,meColor,meName,meAvatar:pid})).catch(()=>{});}catch(e){}
    if(fireUser){try{setDoc(doc(fbDb,"users",fireUser.uid),{meAvatar:pid},{merge:true}).catch(()=>{});}catch(e){}}
  };
  // わたしの写真アイコン取り込み（軽量リサイズ→IDB保存→丸型はCSSで適用）
  const pickMeAvatar=async(e)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash(t("toast.fileTooBig"));return;}
    try{
      const dataUrl=await downscaleImage(file,400,0.8);
      const pid="meav"+Date.now();
      const ok=await photoStorage.set(`photo:${pid}`,dataUrl);
      if(!ok){showFlash(t("toast.storageFull"));return;}
      setPhotos(p=>({...p,[pid]:dataUrl}));
      if(meAvatar){try{photoStorage.delete(`photo:${meAvatar}`);}catch(er){}}
      persistMeAvatar(pid);
      showFlash(t("toast.iconSet"));
    }catch(err){showFlash(t("toast.imgFail"));}
  };
  const clearMeAvatar=()=>{if(meAvatar){try{photoStorage.delete(`photo:${meAvatar}`);}catch(e){}}persistMeAvatar("");};
  const showFlash=(msg)=>{setFlash(msg);setTimeout(()=>setFlash(""),2200);};
  // 設定：データのバックアップ書き出し（本体データ＋写真をまとめて1ファイルに）。
  // 端末が変わっても復元できるよう、証明書・思い出・アイコンの写真も同梱する。
  const exportData=async()=>{
    try{
      const ids=new Set();
      items.forEach(it=>photoIdsOf(it).forEach(pid=>ids.add(pid)));
      members.forEach(m=>{if(m.avatar)ids.add(m.avatar);});
      if(meAvatar)ids.add(meAvatar);
      const photoMap={};
      for(const pid of ids){let d=photos[pid];if(!d){try{d=await photoStorage.get(`photo:${pid}`);}catch(e){}}if(d)photoMap[pid]=d;}
      const state=JSON.parse(serializeState({members,items,usage,meEmoji,meBirthday,meColor,meName,meAvatar}));
      const backup={__loalife_backup:1,exportedAt:Date.now(),state,photos:photoMap};
      const blob=new Blob([JSON.stringify(backup)],{type:"application/json"});
      const url=URL.createObjectURL(blob);const a=document.createElement("a");
      a.href=url;a.download=`loalife-backup-${iso(new Date())}.json`;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      const n=Object.keys(photoMap).length;
      showFlash(n?`バックアップを書き出しました 💾（写真${n}枚ふくむ）`:"バックアップを書き出しました 💾");
    }catch(e){showFlash("書き出せませんでした");}
  };
  // 記録を CSV で書き出し（表計算で開ける形式）。体重・トイレ・お世話ログ・ケア/予定・支出・今日のようすを1ファイルに。
  const exportCSV=()=>{
    try{
      const nameOfSpace=(sp)=>sp==="me"?(meName||"わたし"):(members.find(m=>m.id===sp)||{}).name||sp;
      const rows=[["日付","メンバー","種類","内容","値・区分","メモ"]];
      const push=(date,sp,kind,title,val,note)=>rows.push([date||"",nameOfSpace(sp),kind,title||"",val||"",note||""]);
      items.forEach(x=>{
        if(x.type==="health")push(x.date,x.space,"からだの記録",x.weight!=null?"体重":"記録",x.weight!=null?x.weight+"kg":"",x.note);
        else if(x.type==="toilet")push(x.date,x.space,"トイレ",x.toiletKind==="pee"?"おしっこ":"うんち",x.success?"成功":"失敗",x.bristol?`硬さ${x.bristol}/7`:"");
        else if(x.type==="expense")push(x.date,x.space,"支出",x.title,x.amount!=null?x.amount+"円":"",x.category||"");
        else if(x.type==="diary"){const en=x.energy?(diaryMeta(DIARY_ENERGY,x.energy)||{}).label:"";const syms=(x.symptoms||[]).map(s=>(symptomMeta(s)||{}).label||s).join("・");push(x.date,x.space,"今日のようす",en||"記録",[x.appetite?(diaryMeta(DIARY_APPETITE,x.appetite)||{}).label:"",x.walk?"散歩":"",x.hospital?"通院":""].filter(Boolean).join("・"),[syms,x.note].filter(Boolean).join(" / "));}
        else if(x.type==="chore")(x.history||[]).forEach(d=>push(d,x.space,"やった記録",x.title,"",""));
        else if(x.type==="care")push(x.dueDate,x.space,"ケア・予定",x.title,x.done?"完了":(x.dueDate?"予定":""),x.repeat&&x.repeat!=="none"?(REPEATS.find(r=>r.key===x.repeat)||{}).label:"");
        else if(x.type==="memory")push(x.date,x.space,"思い出",x.title,"",x.note);
      });
      rows.sort((a,b)=>a===rows[0]?-1:b===rows[0]?1:(a[0]<b[0]?1:a[0]>b[0]?-1:0));
      const csv=rows.map(r=>r.map(csvCell).join(",")).join("\r\n");
      downloadTextFile(csv,`loalife-records-${iso(new Date())}.csv`);
      showFlash("CSVを書き出しました");
    }catch(e){showFlash("書き出せませんでした");}
  };
  // バックアップの読み込み（復元）。写真同梱の新形式・本体のみの旧形式どちらも受ける。既存データは上書き。
  const importData=async(e)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    try{
      const text=await file.text();
      const parsed=JSON.parse(text);
      const isWrapped=parsed&&parsed.__loalife_backup;
      const rawState=isWrapped?parsed.state:parsed;
      const photoMap=isWrapped&&parsed.photos?parsed.photos:{};
      const st=migrateState(rawState);
      if(!st||!Array.isArray(st.members)||!Array.isArray(st.items)){showFlash("このファイルは読み込めませんでした");return;}
      // 写真をIDBへ復元
      const restored={};
      for(const pid of Object.keys(photoMap)){try{const ok=await photoStorage.set(`photo:${pid}`,photoMap[pid]);if(ok)restored[pid]=photoMap[pid];}catch(er){}}
      setMembers(st.members);setItems(st.items);setUsage(st.usage||{});
      setMeEmoji(st.meEmoji||"🙂");setMeBirthday(st.meBirthday||"");setMeColor(st.meColor||"");setMeName(st.meName||"");setMeAvatar(st.meAvatar||"");
      setPhotos(p=>({...p,...restored}));
      try{await storage.set(STORAGE_KEY,serializeState({members:st.members,items:st.items,usage:st.usage||{},meEmoji:st.meEmoji,meBirthday:st.meBirthday,meColor:st.meColor,meName:st.meName,meAvatar:st.meAvatar}));}catch(er){}
      setConfirmRestore(false);setOnboarding(false);setTab("home");
      const n=Object.keys(restored).length;
      showFlash(n?`復元しました 💾（写真${n}枚）`:"復元しました 💾");
    }catch(err){showFlash("このファイルは読み込めませんでした");}
  };
  const loadSample=()=>{const seed=makeSeed();persist(seed.members,seed.items);setOnboarding(false);setTab("home");};

  const finishOnboarding=()=>{
    // 「自分」を選んだ場合はメンバーを作らず、既存の me* にだけ反映する（me→member化はしない）。
    if(obKind==="me"){
      const nm2=obName.trim()||meName;const em=obEmoji||meEmoji;const bd=obBirthday||meBirthday;const av=obAvatar||meAvatar;
      setMeName(nm2);setMeEmoji(em);setMeBirthday(bd);setMeAvatar(av);
      try{storage.set(STORAGE_KEY,serializeState({members,items,usage,meEmoji:em,meBirthday:bd,meColor,meName:nm2,meAvatar:av})).catch(()=>{});}catch(e){}
      if(fireUser){try{setDoc(doc(fbDb,"users",fireUser.uid),{meEmoji:em,meBirthday:bd,meName:nm2,meAvatar:av},{merge:true}).catch(()=>{});}catch(e){}}
      track("app_start",{first_kind:"me"});
      setOnboarding(false);setObStep(0);setTab("home");
      return;
    }
    const nm=[];const ni=[];let newId=null;
    if(obKind&&obName.trim()){const m={id:"f"+Date.now(),name:obName.trim(),emoji:obEmoji,avatar:obAvatar||"",kind:obKind,birthday:obBirthday||"",visibility:"household"};if(obKind==="pet")m.species=obSpecies;else if(obKind==="person")m.personType=obPersonType;nm.push(m);newId=m.id;}
    persist(nm,ni);if(newId)setMemberSel(newId);track("app_start",{first_kind:obKind||"none"});if(newId)track("member_add",{member_kind:obKind,via:"onboarding"});setOnboarding(false);setObStep(0);setTab("home"); // 追加した本人を選択中にして、記録/管理タブが「自分」ではなく登録した子を表示するように
  };

  const resetApp=()=>{try{storage.delete(STORAGE_KEY).catch(()=>{});}catch(e){}setMembers([]);setItems([]);setPhotos({});setConfirmDel(null);setObStep(0);setObKind(null);setObSpecies("dog");setObName("");setObEmoji("🐶");setObAvatar("");setObBirthday("");setMeEmoji("🙂");setMeBirthday("");setMeColor("");setMeName("");setMeAvatar("");setHousehold(null);setFireUser(null);setOnboarding(true);setTab("home");};

  const handleNotifRequest=async()=>{const p=await requestNotifPermission();setNotifPerm(p);if(p==="granted"){showFlash("通知を許可しました 🔔");}else if(p==="denied"){showFlash("端末の設定から通知をオンにできます");}else if(p==="unsupported"){const iOS=/iP(hone|ad|od)/.test(navigator.userAgent);showFlash(iOS?"ホーム画面に追加すると通知を使えます":"この端末では通知を利用できません");}};

  // --- Family sharing functions ---
  const signInWithGoogle=async()=>{
    if(!FB_READY)return;
    setShareLoading(true);setShareError("");
    try{
      const provider=new GoogleAuthProvider();
      await signInWithPopup(fbAuth,provider);
    }catch(e){
      setShareError("サインインできませんでした");
    }
    setShareLoading(false);
  };

  // メール＋パスワードのエラーを日本語に。
  const emailAuthError=(e)=>{
    const c=e&&e.code||"";
    if(c.includes("email-already-in-use"))return"このメールアドレスは登録済みです。ログインしてください。";
    if(c.includes("invalid-email"))return"メールアドレスの形式が正しくありません。";
    if(c.includes("weak-password"))return"パスワードは6文字以上にしてください。";
    if(c.includes("wrong-password")||c.includes("invalid-credential"))return"メールアドレスかパスワードが違います。";
    if(c.includes("user-not-found"))return"このメールでは登録されていません。新規登録してください。";
    if(c.includes("too-many-requests"))return"試行が多すぎます。しばらくしてからお試しください。";
    if(c.includes("operation-not-allowed"))return"メール＋パスワード登録が有効化されていません（Firebase設定）。";
    return"うまくいきませんでした。もう一度お試しください。";
  };
  // メール＋パスワードで新規登録。確認メールを送る。
  const signUpEmail=async()=>{
    if(!FB_READY)return;
    const em=authEmail.trim();if(!em||authPw.length<6){setShareError("メールアドレスと6文字以上のパスワードを入力してください。");return;}
    setShareLoading(true);setShareError("");
    try{
      const cred=await createUserWithEmailAndPassword(fbAuth,em,authPw);
      try{await sendEmailVerification(cred.user);}catch(_){}
      setAuthPw("");
      showFlash("確認メールを送りました。メール内のリンクを開いてください");
    }catch(e){setShareError(emailAuthError(e));}
    setShareLoading(false);
  };
  // メール＋パスワードでログイン。
  const signInEmail=async()=>{
    if(!FB_READY)return;
    const em=authEmail.trim();if(!em||!authPw){setShareError("メールアドレスとパスワードを入力してください。");return;}
    setShareLoading(true);setShareError("");
    try{
      await signInWithEmailAndPassword(fbAuth,em,authPw);
      setAuthPw("");
    }catch(e){setShareError(emailAuthError(e));}
    setShareLoading(false);
  };

  const signOutUser=async()=>{
    if(!FB_READY)return;
    await fbSignOut(fbAuth);
    setFireUser(null);setHousehold(null);setShareStep("menu");setShowShareModal(false);
    showFlash("サインアウトしました");
  };

  const createHousehold=async()=>{
    if(!fireUser)return;
    setShareLoading(true);setShareError("");
    try{
      const code=genCode();
      const hid="hh_"+Date.now();
      const batch=writeBatch(fbDb);
      // Create household doc
      batch.set(doc(fbDb,"households",hid),{ownerUid:fireUser.uid,inviteCode:code,memberUids:[fireUser.uid],createdAt:serverTimestamp(),version:SCHEMA_VERSION});
      // Create invite code lookup
      batch.set(doc(fbDb,"inviteCodes",code),{householdId:hid});
      // Update user profile
      batch.set(doc(fbDb,"users",fireUser.uid),{householdId:hid,meEmoji,meBirthday},{merge:true});
      // Migrate existing members to Firestore
      members.forEach(m=>{
        const{id,...rest}=m;
        batch.set(doc(fbDb,"households",hid,"members",id),{...rest,visibility:m.visibility||"household",ownerUid:fireUser.uid,createdAt:serverTimestamp()});
        items.filter(it=>it.space===id).forEach(it=>{
          const{id:iid,space,...irest}=it;
          batch.set(doc(fbDb,"households",hid,"members",id,"items",iid),{...irest,ownerUid:fireUser.uid,createdAt:serverTimestamp()});
        });
      });
      await batch.commit();
      const newHH={id:hid,ownerUid:fireUser.uid,inviteCode:code,memberUids:[fireUser.uid]};
      setHousehold(newHH);
      setShareStep("created");
    }catch(e){
      setShareError("作成できませんでした: "+e.message);
    }
    setShareLoading(false);
  };

  const joinHousehold=async()=>{
    if(!fireUser||!joinCodeInput.trim())return;
    setShareLoading(true);setShareError("");
    try{
      const code=joinCodeInput.trim().toUpperCase();
      const codeSnap=await getDoc(doc(fbDb,"inviteCodes",code));
      if(!codeSnap.exists())throw new Error("招待コードが見つかりません");
      const hid=codeSnap.data().householdId;
      if(household&&household.id===hid)throw new Error("すでにこの家族に参加しています");
      // Add user to household
      await updateDoc(doc(fbDb,"households",hid),{memberUids:arrayUnion(fireUser.uid)});
      // Update user profile
      await setDoc(doc(fbDb,"users",fireUser.uid),{householdId:hid,meEmoji,meBirthday},{merge:true});
      const hhSnap=await getDoc(doc(fbDb,"households",hid));
      setHousehold({id:hid,...hhSnap.data()});
      setShowShareModal(false);
      showFlash("家族に参加しました 👨‍👩‍👧");
    }catch(e){
      setShareError(e.message||"参加できませんでした");
    }
    setShareLoading(false);
  };

  const leaveHousehold=async()=>{
    if(!fireUser||!household)return;
    setShareLoading(true);
    try{
      await updateDoc(doc(fbDb,"households",household.id),{memberUids:arrayUnion()});
      await setDoc(doc(fbDb,"users",fireUser.uid),{householdId:null},{merge:true});
      setHousehold(null);setShowShareModal(false);
      showFlash("家族スペースを退出しました");
    }catch(e){}
    setShareLoading(false);
  };

  const copyInviteCode=()=>{
    if(!household)return;
    navigator.clipboard?.writeText(household.inviteCode).then(()=>{setCopiedCode(true);setTimeout(()=>setCopiedCode(false),2000);}).catch(()=>{});
  };

  // --- Main app state derived ---
  const activeMember=members.find(m=>m.id===tab);
  const isMemberTab=!!activeMember;
  const isPersonMode=tab==="me"||isMemberTab; // 人/ペットの詳細を見ているモード
  // ── コーチマーク：初回ツアー(A)と画面ごと案内(B) ──
  const startTour=useCallback(()=>{setCoachKey(null);setTab("me");setTourStep(0);},[]);
  const endTour=useCallback(()=>{markTourDone();setTourStep(null);setTab("home");},[]);
  const tourNext=useCallback(()=>{setTourStep(s=>{if(s==null)return null;if(s>=TOUR_STEPS.length-1){markTourDone();setTab("home");return null;}return s+1;});},[]);
  // 初回起動：オンボーディング終了後、未完了ならツアーを自動表示（一度だけ）
  useEffect(()=>{
    if(tourInit.current||onboarding||!loaded)return;
    tourInit.current=true;
    if(!tourIsDone())startTour();
  },[onboarding,loaded,startTour]);
  // 画面ごとの初回案内(B)：ツアー中は抑制。1画面1ポイント、既表示は出さない。
  useEffect(()=>{
    if(tourStep!==null||coachKey||onboarding||!loaded)return;
    let key=null;
    if(tab==="cal")key="cal";
    else if(isPersonMode&&personSeg==="record")key="record";
    else if(isPersonMode&&personSeg==="manage")key="manage";
    if(key&&COACH_HINTS[key]&&!coachIsSeen(key))setCoachKey(key);
  },[tab,personSeg,isPersonMode,tourStep,coachKey,onboarding,loaded]);
  const dismissCoach=useCallback(()=>{setCoachKey(k=>{if(k)markCoachSeen(k);return null;});},[]);
  // 迷子モードを開くたびに最初のステップ（場所・日時）から。パニック時でも一本道で進める。
  useEffect(()=>{if(lostOpen)setLostStep(0);},[lostOpen]);
  // 誤食・中毒を開くたびに展開・チェックをリセット
  useEffect(()=>{if(toxicOpen){setToxicExpanded(null);setToxicEmgOpen(false);setToxicSrcOpen(false);}},[toxicOpen]);
  // ルーティン/ストックは「わたし」タブでも使える。space=tab、kind は me/person/pet。
  const isPersonalTab=tab!=="home";          // わたし＋各メンバー（ホーム以外）
  const curKind=activeMember?activeMember.kind:"me";
  // 今日のようすの種別：自分=大人／ペット=pet／人=personType(既定child)。生理は大人のみに出す安全側。
  const diaryTypeOf=(space)=>{if(space==="me")return"adult";const m=members.find(x=>x.id===space);if(!m)return"adult";if(m.kind==="pet")return"pet";return m.personType||"child";};
  const nameOf=(spaceId)=>spaceId==="me"?(meName||"わたし"):(members.find(m=>m.id===spaceId)||{}).name||"";

  // 授乳タイマー稼働中は1秒ごとに表示を更新する。
  useEffect(()=>{if(!nursing)return;const id=setInterval(()=>setNursingNow(Date.now()),1000);return()=>clearInterval(id);},[nursing]);
  // 選択中メンバー・セグメント・タブを保存し、次回起動時に前回の画面で再開できるように。
  useEffect(()=>{try{localStorage.setItem("loalife-membersel",memberSel);}catch(e){}},[memberSel]);
  useEffect(()=>{try{localStorage.setItem("loalife-personseg",personSeg);}catch(e){}},[personSeg]);
  useEffect(()=>{if(loaded){try{localStorage.setItem("loalife-tab",tab);}catch(e){}}},[tab,loaded]);
  // GA4：SPA画面遷移のページビュー。tab / personSeg が変わるたびに仮想パスで送信（初回マウント時も送る）。
  useEffect(()=>{
    const key=tab==="home"?"home":tab==="cal"?"calendar":tab==="settings"?"settings":isPersonMode?(personSeg==="manage"?"manage":"record"):"record";
    const title=tab==="home"?"ホーム":tab==="cal"?"カレンダー":tab==="settings"?"設定":isPersonMode?(personSeg==="manage"?"管理":"記録"):"記録";
    track("page_view",{page_title:"LoaLife｜"+title,page_location:location.origin+location.pathname+"#"+key,page_path:"/"+key});
  },[tab,personSeg,isPersonMode]);
  // GA4：安全・緊急ページの閲覧。開いた時に1回。
  useEffect(()=>{if(toxicOpen)track("safety_view",{safety_type:"toxic"});},[toxicOpen]);
  useEffect(()=>{if(emergencyOpen)track("safety_view",{safety_type:"emergency"});},[emergencyOpen]);
  useEffect(()=>{if(disasterOpen)track("safety_view",{safety_type:"disaster"});},[disasterOpen]);
  useEffect(()=>{setFilter("all");if(activeMember){const list=careKindsFor(activeMember);const kind=list.find(k=>k.key===draftKind)?draftKind:list[0].key;if(kind!==draftKind)setDraftKind(kind);const label=careLabel(list.find(k=>k.key===kind));if(kind!=="other"&&(draft===""||draftAuto)){setDraft(label);setDraftAuto(true);}else if(kind==="other"&&draftAuto){setDraft("");setDraftAuto(false);}}else if(draftAuto){setDraft("");setDraftAuto(false);}},[tab]);

  const toggle=(id)=>{
    const it=items.find(x=>x.id===id);if(!it)return;let next;
    const cyc=effRepeat(it); // ケア種別の既定周期も含めて判定
    if(!it.done&&cyc!=="none"){
      // 記録＝前回を今日に更新し、次回を周期ぶん先へ自動セット（赤が消えて静かに次へ）
      const today=iso(new Date());const newDue=addInterval(today,cyc);
      next=items.map(x=>x.id===id?{...x,dueDate:newDue,lastDone:today,repeat:x.repeat&&x.repeat!=="none"?x.repeat:cyc,done:false,...(typeof x.stock==="number"&&x.stock>0?{stock:x.stock-1}:{})}:x);
      showFlash(`✓ 記録しました。次は ${fmtDate(newDue)} ごろ 🗓`);
      track("task_complete",{task_type:it.type||"care",care_kind:it.careKind});
    }
    else{next=items.map(x=>x.id===id?{...x,done:!x.done,completedAt:!x.done?Date.now():null}:x);if(!it.done)track("task_complete",{task_type:it.type||"care",care_kind:it.careKind});}
    persist(members,next);
    const updated=next.find(x=>x.id===id);
    if(updated)saveItemToFs(updated).catch(()=>{});
  };

  const remove=(id)=>{
    const it=items.find(x=>x.id===id);
    if(it&&it.photo){try{photoStorage.delete(`photo:${id}`);}catch(e){}}
    deleteItemFromFs(it).catch(()=>{});
    persist(members,items.filter(x=>x.id!==id));
  };

  const onFilePicked=async(e,id,okMsg="証明書を保存しました")=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash(t("toast.fileTooBig"));return;}
    try{
      const dataUrl=await downscaleImage(file);
      const ok=await photoStorage.set(`photo:${id}`,dataUrl);
      if(!ok){showFlash(t("toast.storageFull"));return;}
      setPhotos(p=>({...p,[id]:dataUrl}));
      const next=items.map(x=>x.id===id?{...x,photo:true}:x);
      persist(members,next);saveItemToFs(next.find(x=>x.id===id)).catch(()=>{});
      showFlash(okMsg);
    }catch(err){showFlash(t("toast.imgSaveFail"));}
  };

  const viewPhoto=async(id)=>{if(photos[id]){setViewer({id,src:photos[id]});return;}setViewer({id,loading:true});try{const src=await photoStorage.get(`photo:${id}`);setViewer({id,src});}catch(e){setViewer({id,src:null});}};
  const removePhoto=(id)=>{try{photoStorage.delete(`photo:${id}`);}catch(e){}setPhotos(p=>{const n={...p};delete n[id];return n;});persist(members,items.map(x=>x.id===id?{...x,photo:false}:x));setViewer(null);showFlash(t("toast.certDeleted"));};
  // 迷子ポスター／緊急カード用の追加写真（member.posterPhotos = [photoId...]・最大4枚）。IDBに保存。
  const addPosterPhoto=async(mid,e)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash(t("toast.fileTooBig"));return;}
    const m=members.find(x=>x.id===mid);if(!m)return;
    if((m.posterPhotos||[]).length>=4){showFlash(t("toast.photoMax"));return;}
    try{const dataUrl=await downscaleImage(file,760,0.78);const pid="pp"+Date.now();const ok=await photoStorage.set(`photo:${pid}`,dataUrl);if(!ok){showFlash(t("toast.storageFull"));return;}
      setPhotos(p=>({...p,[pid]:dataUrl}));
      persist(members.map(x=>x.id===mid?{...x,posterPhotos:[...(x.posterPhotos||[]),pid]}:x),items);
      showFlash(t("toast.photoAdded"));
    }catch(er){showFlash(t("toast.imgFail"));}
  };
  const removePosterPhoto=(mid,pid)=>{try{photoStorage.delete(`photo:${pid}`);}catch(e){}setPhotos(p=>{const n={...p};delete n[pid];return n;});persist(members.map(x=>x.id===mid?{...x,posterPhotos:(x.posterPhotos||[]).filter(q=>q!==pid)}:x),items);};
  // 迷子ポスターの迷子情報（member.lostInfo）を更新
  const setLostField=(mid,patch)=>{persist(members.map(x=>x.id===mid?{...x,lostInfo:{...(x.lostInfo||{}),...patch}}:x),items);};
  // 迷子ポスターの共有（Web Share・テキスト）。画像は印刷/スクショで保存する案内。
  const shareLost=async(m)=>{
    const li=m.lostInfo||{};
    const lines=[`迷子犬を探しています：${m.name}`];
    if(li.place)lines.push(`最後に目撃された場所：${li.place}${li.placeNote?`（${li.placeNote}）`:""}`);
    if(li.when)lines.push(`目撃日時：${li.when}`);
    lines.push(pleaTextOf(m));
    const text=lines.join("\n");
    try{
      if(navigator.share){await navigator.share({title:`迷子犬を探しています：${m.name}`,text});}
      else if(navigator.clipboard){await navigator.clipboard.writeText(text);showFlash("内容をコピーしました。SNS等に貼り付けできます 📋");}
      else{showFlash("この端末では共有できません。印刷・スクショをご利用ください");}
    }catch(e){}
  };

  // --- 思い出（記録を思い出に変える）---
  // 既存アクション（散歩などのルーティン）から写真1枚で思い出を残す。入力は写真選択だけ。
  // type:"memory" の追記型ログ（上書きしない）。写真は IndexedDB(photo:<id>) に保存。
  const addMemory=async(e,{space,title,emoji})=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash(t("toast.fileTooBig"));return;}
    try{
      const dataUrl=await downscaleImage(file);
      const id="mem"+Date.now();
      const ok=await photoStorage.set(`photo:${id}`,dataUrl);
      if(!ok){showFlash(t("toast.storageFull"));return;}
      setPhotos(p=>({...p,[id]:dataUrl}));
      const mem={id,space,type:"memory",date:todayIso,title:title||"思い出",emoji:emoji||"📸",photo:true,createdAt:Date.now()};
      persist(members,[...items,mem]);
      saveItemToFs(mem).catch(()=>{});
      showFlash(t("toast.memorySaved"));
    }catch(err){showFlash(t("toast.imgSaveFail"));}
  };
  const viewMemory=async(id)=>{
    const cached=photos[id];
    if(cached){setViewer({id,src:cached,isMemory:true});return;}
    setViewer({id,loading:true,isMemory:true});
    try{const src=await photoStorage.get(`photo:${id}`);setViewer({id,src,isMemory:true});}catch(e){setViewer({id,src:null,isMemory:true});}
  };
  const removeMemory=(id)=>{try{photoStorage.delete(`photo:${id}`);}catch(e){}setPhotos(p=>{const n={...p};delete n[id];return n;});deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));setViewer(null);showFlash(t("toast.memoryDeleted"));};

  // --- 思い出の一括選択・別の子へ移動 ---
  const ALBUM_SEL_MAX=30; // 一度に選べる上限
  const toggleAlbumSel=(id)=>{setAlbumSel(sel=>{const cur=sel||[];if(cur.includes(id))return cur.filter(x=>x!==id);if(cur.length>=ALBUM_SEL_MAX){showFlash(`一度に選べるのは${ALBUM_SEL_MAX}枚までです`);return cur;}return[...cur,id];});};
  const moveMemoriesTo=(targetSpace)=>{
    const ids=albumSel||[];if(ids.length===0||!targetSpace)return;
    const idset=new Set(ids);
    const next=items.map(x=>idset.has(x.id)?{...x,space:targetSpace}:x);
    persist(members,next);
    next.forEach(x=>{if(idset.has(x.id))saveItemToFs(x).catch(()=>{});});
    const tName=targetSpace==="me"?(meName||"わたし"):(members.find(m=>m.id===targetSpace)?.name||"");
    setAlbumMoveOpen(false);setAlbumSel(null);
    showFlash(`${ids.length}枚を「${tName}」へ移動しました 📸`);
  };

  // --- ライフイベント統合エディタ（カレンダーの単一入力。写真・日記・予定すべて1か所で）---
  const CAL_CATS=[{key:"memory",label:"思い出・日記",emoji:"📸"},{key:"event",label:"予定",emoji:"📅"}];
  const openLifeNew=(date,space)=>setLifeDraft({mode:"new",space:space||(activeMember?activeMember.id:"me"),category:"memory",title:"",date:date||todayIso,time:"",note:"",photos:[],reminders:[],repeat:"none",tags:[]});
  const openLifeEdit=async(it)=>{
    const ids=photoIdsOf(it);
    const ph=await Promise.all(ids.map(async id=>{let dataUrl=photos[id]||null;if(!dataUrl){try{dataUrl=await photoStorage.get(`photo:${id}`);}catch(e){}}return{id,dataUrl,isNew:false};}));
    const category=it.type==="memory"?"memory":"event";
    setLifeDraft({mode:"edit",id:it.id,space:it.space,category,title:it.title&&it.title!=="思い出"?it.title:"",date:itemDate(it)||todayIso,time:it.time||"",note:it.note||"",photos:ph.filter(p=>p.dataUrl),reminders:it.reminders||[],repeat:it.repeat||"none",origType:it.type,careKind:it.careKind,tags:it.tags||[]});
  };
  const pickLifePhoto=async(e)=>{
    const files=Array.from(e.target.files||[]);e.target.value="";if(!files.length)return;
    for(const file of files){
      if(file.size>20*1024*1024){showFlash(t("toast.fileTooBig"));continue;}
      try{const dataUrl=await downscaleImage(file);const pid="p"+Date.now()+Math.random().toString(36).slice(2,6);setLifeDraft(p=>p?{...p,photos:[...p.photos,{id:pid,dataUrl,isNew:true}]}:p);}
      catch(er){showFlash(t("toast.imgFail"));}
    }
  };
  const removeLifePhoto=(pid)=>setLifeDraft(p=>p?{...p,photos:p.photos.filter(x=>x.id!==pid)}:p);
  // 写真をまとめて取り込み、撮影日（EXIF）ごとに思い出へ自動振り分け。
  // 撮影日が取れない写真はファイル更新日→今日の順でフォールバック。現在表示中の子に追加。
  const[bulkBusy,setBulkBusy]=useState(false);
  const bulkAddPhotos=async(e)=>{
    const files=Array.from(e.target.files||[]).filter(f=>f.type&&f.type.startsWith("image/"));e.target.value="";
    if(!files.length||bulkBusy)return;
    const list=files.slice(0,60); // 一度の取り込み上限
    setBulkBusy(true);showFlash(`写真を読み込み中…（${list.length}枚）`);
    const space=tab;const newItems=[];const newPhotos={};const dateSet=new Set();let full=false;
    for(const file of list){
      if(file.size>20*1024*1024)continue;
      let date=await readExifDate(file);
      if(!date&&file.lastModified){const d=new Date(file.lastModified);if(!isNaN(d))date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
      if(!date)date=todayIso;
      let dataUrl;try{dataUrl=await downscaleImage(file);}catch(er){continue;}
      const pid="p"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      const ok=await photoStorage.set(`photo:${pid}`,dataUrl);
      if(!ok){full=true;break;}
      newPhotos[pid]=dataUrl;
      newItems.push({id:"mem"+Date.now().toString(36)+Math.random().toString(36).slice(2,6),space,type:"memory",date,title:"思い出",emoji:"📸",photo:true,photos:[pid],createdAt:Date.now()});
      dateSet.add(date);
    }
    if(newItems.length){
      setPhotos(p=>({...p,...newPhotos}));
      const next=[...items,...newItems];persist(members,next);
      newItems.forEach(it=>saveItemToFs(it).catch(()=>{}));
    }
    setBulkBusy(false);
    if(full)showFlash(newItems.length?`ストレージ不足のため${newItems.length}枚まで追加しました`:"ストレージ容量が不足しています");
    else if(newItems.length)showFlash(`${newItems.length}枚を撮影日ごとに追加しました（${dateSet.size}日分）📅`);
    else showFlash("追加できる写真がありませんでした");
  };
  const toggleLifeReminder=(mins)=>setLifeDraft(p=>p?{...p,reminders:p.reminders.includes(mins)?p.reminders.filter(m=>m!==mins):[...p.reminders,mins].sort((a,b)=>a-b)}:p);
  const saveLife=async()=>{
    if(!lifeDraft)return;
    const d=lifeDraft;const title=(d.title||"").trim(),note=(d.note||"").trim();const ph=d.photos||[];const hasPhoto=ph.length>0;
    if(d.category==="event"&&!title){showFlash(t("toast.titleNeeded"));return;}
    if(d.category==="memory"&&!title&&!note&&!hasPhoto){showFlash(t("toast.noteNeed"));return;}
    const id=d.id||((d.category==="memory"?"mem":"x")+Date.now());
    // 新規写真をIDBへ保存
    for(const p of ph){if(p.isNew&&p.dataUrl){const ok=await photoStorage.set(`photo:${p.id}`,p.dataUrl);if(!ok){showFlash(t("toast.storageFull"));return;}setPhotos(prev=>({...prev,[p.id]:p.dataUrl}));}}
    const photoIds=ph.map(p=>p.id);
    const rem=d.reminders.length?d.reminders:undefined;
    let base;
    if(d.category==="memory"){
      const tags=(d.tags||[]).map(t=>t.trim()).filter(Boolean);
      base={id,space:d.space,type:"memory",date:d.date,time:d.time||undefined,title:title||"思い出",note:note||undefined,emoji:guessEmoji(title,"📸"),photo:hasPhoto,photos:hasPhoto?photoIds:undefined,reminders:rem,repeat:d.repeat&&d.repeat!=="none"?d.repeat:undefined,tags:tags.length?tags:undefined};
    }else{
      const keepCare=d.origType==="care";
      base={id,space:d.space,type:keepCare?"care":"event",title:title,note:note||undefined,emoji:guessEmoji(title,keepCare?"🏥":"📅"),dueDate:d.date,time:d.time||undefined,reminders:rem,repeat:d.repeat,photo:hasPhoto?true:undefined,photos:hasPhoto?photoIds:undefined};
      if(keepCare)base.careKind=d.careKind;
    }
    let next;
    if(d.id)next=items.map(x=>x.id===d.id?{...x,...base}:x);
    else next=[...items,base];
    persist(members,next);
    const saved=next.find(x=>x.id===id);if(saved)saveItemToFs(saved).catch(()=>{});
    setLifeDraft(null);showFlash(t("toast.saved"));
  };
  const removeLife=(id)=>{const it=items.find(x=>x.id===id);if(it)photoIdsOf(it).forEach(pid=>{try{photoStorage.delete(`photo:${pid}`);}catch(e){}});deleteItemFromFs(it).catch(()=>{});persist(members,items.filter(x=>x.id!==id));setLifeDraft(null);showFlash(t("toast.deleted"));};
  const snooze=(id)=>{const next=items.map(x=>x.id===id?{...x,dueDate:plusDays(1)}:x);persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});showFlash(t("toast.tomorrow"));};
  const setEmoji=(id,emo)=>{const next=items.map(x=>x.id===id?{...x,emoji:emo}:x);persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});setPickerId(null);};
  const openEdit=(it)=>{setEditItemId(it.id);setETitle(it.title);setEDate(it.dueDate||"");setETime(it.time||"");setERepeat(it.repeat||"none");setEReminders(it.reminders||[]);setEPlace(it.place||"");setEUrl(it.url||"");setEMemo(it.memo||"");setEChecklist(Array.isArray(it.checklist)?it.checklist.map(c=>({...c})):[]);setECheckDraft("");setEStock(it.stock!=null?String(it.stock):"");};
  const saveEdit=()=>{const place=ePlace.trim(),url=eUrl.trim(),memo=eMemo.trim();const cl=eChecklist.filter(c=>c.text&&c.text.trim());const stock=eStock!==""&&!isNaN(+eStock)?Math.max(0,parseInt(eStock,10)):undefined;const next=items.map(x=>x.id===editItemId?{...x,title:eTitle.trim()||x.title,dueDate:eDate||undefined,time:eTime||undefined,repeat:eRepeat,reminders:eReminders.length?eReminders:undefined,place:place||undefined,url:url||undefined,memo:memo||undefined,checklist:cl.length?cl:undefined,stock}:x);persist(members,next);const it=next.find(x=>x.id===editItemId);if(it)saveItemToFs(it).catch(()=>{});setEditItemId(null);};
  // チェックリスト（編集フォーム内）：追加・チェック・削除
  const addECheck=()=>{const t=eCheckDraft.trim();if(!t)return;setEChecklist(prev=>[...prev,{id:"c"+Date.now(),text:t,done:false}]);setECheckDraft("");};
  const toggleECheck=(id)=>setEChecklist(prev=>prev.map(c=>c.id===id?{...c,done:!c.done}:c));
  const removeECheck=(id)=>setEChecklist(prev=>prev.filter(c=>c.id!==id));
  // リスト表示からその場でチェック（即保存・同期）
  const toggleChecklistItem=(itemId,checkId)=>{const next=items.map(x=>x.id===itemId?{...x,checklist:(x.checklist||[]).map(c=>c.id===checkId?{...c,done:!c.done}:c)}:x);persist(members,next);const it=next.find(x=>x.id===itemId);if(it)saveItemToFs(it).catch(()=>{});};
  // 予定の場所・URLをタップで外部起動。URLはスキーム補完、場所はiOS=Apple/その他=Google Maps。
  const openUrl=(u)=>{if(!u)return;const url=/^https?:\/\//i.test(u)?u:"https://"+u;try{window.open(url,"_blank","noopener,noreferrer");}catch(e){location.href=url;}};
  const openMap=(place)=>{if(!place)return;const q=encodeURIComponent(place);const iOS=/iP(hone|ad|od)/.test(navigator.userAgent);const url=iOS?`https://maps.apple.com/?q=${q}`:`https://www.google.com/maps/search/?api=1&query=${q}`;try{window.open(url,"_blank","noopener,noreferrer");}catch(e){location.href=url;}};
  const toggleEReminder=(mins)=>setEReminders(prev=>prev.includes(mins)?prev.filter(m=>m!==mins):[...prev,mins].sort((a,b)=>a-b));
  const toggleReminder=(mins)=>setDraftReminders(prev=>prev.includes(mins)?prev.filter(m=>m!==mins):[...prev,mins].sort((a,b)=>a-b));
  const pickCareKind=(k)=>{setDraftKind(k.key);if(k.key==="other"){if(draftAuto){setDraft("");setDraftAuto(false);}return;}if(draft===""||draftAuto){setDraft(careLabel(k));setDraftAuto(true);}};

  const addItem=async()=>{
    const asCare=isMemberTab||selfCare; // 「自分」でも selfCare の時は members と同じ care/careKind で保存
    let title=draft.trim();let careMeta=null;
    if(asCare){careMeta=careKindsFor(activeMember).find(x=>x.key===draftKind);if(!title&&draftKind!=="other")title=careLabel(careMeta);}
    if(!title)return;
    let base={id:"x"+Date.now(),space:tab,title,done:false,createdAt:Date.now(),dueDate:draftDate||undefined,time:draftTime||undefined,repeat:draftRepeat,reminders:draftReminders.length?draftReminders:undefined};
    if(asCare){base={...base,type:"care",careKind:draftKind,emoji:guessEmoji(title,(careMeta||{}).emoji||"📄")};
      // 狂犬病・ワクチン等の更新型：入力日は「実施日」。実施日＋周期を有効期限(dueDate)に、実施日をlastDoneに。
      if(draftDate&&RENEW_KINDS.has(draftKind)){const cyc=(draftRepeat&&draftRepeat!=="none")?draftRepeat:(CARE_CYCLE[draftKind]||"yearly");base.lastDone=draftDate;base.dueDate=addInterval(draftDate,cyc);base.repeat=draftRepeat&&draftRepeat!=="none"?draftRepeat:cyc;}
    }
    else{base={...base,type:draftType,emoji:guessEmoji(title,TYPE_META[draftType].emoji)};}
    // ケア追加フォームで先に写真（証明書）を選んでいた場合、既存の photoStorage / photos をそのまま利用して保存前に添付（onFilePicked と同じ保存先）。
    if(asCare&&draftPhoto){try{const ok=await photoStorage.set(`photo:${base.id}`,draftPhoto);if(ok){setPhotos(p=>({...p,[base.id]:draftPhoto}));base.photo=true;base.photos=[base.id];}}catch(e){}}
    const uKey=tab+" "+title;
    persist(members,[...items,base],{...usage,[uKey]:(usage[uKey]||0)+1});
    if(asCare)track("care_record",{care_kind:draftKind});else track("task_add",{task_type:draftType});
    saveItemToFs(base).catch(()=>{});
    setDraftDate("");setDraftTime("");setDraftRepeat("none");setDraftReminders([]);setDraftPhoto(null);
    if(asCare&&careMeta&&draftKind!=="other"){setDraft(careLabel(careMeta));setDraftAuto(true);}else{setDraft("");setDraftAuto(false);}
  };

  const addMember=()=>{
    const name=newName.trim();if(!name){showFlash(t("toast.nameNeeded"));return;}
    const id="f"+Date.now();
    // 登録時に固定色を自動割り当て（既に使われている色を避けて MEMBER_COLORS から選ぶ）
    const used=new Set([meColor||MEMBER_COLORS[0],...members.map(m=>m.color).filter(Boolean)]);
    const color=MEMBER_COLORS.find(c=>!used.has(c))||MEMBER_COLORS[(members.length+1)%MEMBER_COLORS.length];
    const member={id,name,emoji:newEmoji,avatar:newAvatar||"",kind:newKind,birthday:newBirthday||"",visibility:newVisibility,color};
    if(newKind==="pet")member.species=newSpecies;
    if(newKind==="person")member.personType=newPersonType;
    persist([...members,member],items);
    track("member_add",{member_kind:newKind,species:newKind==="pet"?newSpecies:undefined});
    saveMemberToFs(member).catch(()=>{});
    setNewName("");setNewBirthday("");setNewVisibility("household");setNewAvatar("");setAdding(false);setTab(id);setMemberSel(id);
    setProfilePrompt(id); // 追加直後にプロフィール充実をやさしく案内（強制遷移はしない）
  };
  // ケア・予定フォーム内の写真選択（保存前）。既存の downscaleImage をそのまま利用。
  const pickDraftPhoto=async(e)=>{const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;if(file.size>20*1024*1024){showFlash(t("toast.fileTooBig"));return;}try{const dataUrl=await downscaleImage(file);setDraftPhoto(dataUrl);}catch(er){showFlash(t("toast.imgFail"));}};
  // 指定メンバーのプロフィール編集を開く（追加直後の案内から利用）。編集state群を対象メンバーで初期化。
  const startMemberEdit=(m)=>{if(!m)return;setTab(m.id);setMemberSel(m.id);setPersonSeg("manage");setEditName(m.name);setEditNickname(m.nickname||"");setEditBirthday(m.birthday||"");setEditGotcha(m.gotchaDay||"");setEditGroup(m.group||"");setEditMicrochip(m.microchip||"");setEditBreed(m.breed||"");setEditCoat(m.coat||"");setEditNeuter(m.neuter||"");setEditMemorial(m.memorial||"");setEditAvatar(m.avatar||"");setEditVisibility(m.visibility||"household");setEditPersonType(m.personType||"child");setEditGender(m.gender||"");setEditBlood(m.blood||"");setProfileOpen(true);setEditingId(m.id);};
  useEffect(()=>{if(inputSheet!=="schedule"){setDraftPhoto(null);setSelfCare(false);}},[inputSheet]); // ケア追加フォームを閉じたら未保存の写真・自分ケアフラグをクリア

  const removeMember=(id)=>{
    const m=members.find(x=>x.id===id);
    persist(members.filter(x=>x.id!==id),items.filter(x=>x.space!==id));
    deleteMemberFromFs(id).catch(()=>{});
    setTab("me");setMemberSel("me");setConfirmDel(null);
    if(m)showFlash(t("toast.memberDeleted",{name:m.name}));
  };

  const saveRename=(id)=>{
    const name=editName.trim();if(!name)return;
    const next=members.map(m=>m.id===id?{...m,name,nickname:editNickname.trim()||"",birthday:editBirthday,gotchaDay:editGotcha||"",group:editGroup.trim()||"",microchip:editMicrochip.trim()||"",breed:editBreed.trim()||"",coat:editCoat.trim()||"",neuter:editNeuter||"",memorial:(m.kind==="pet"?(editMemorial||""):""),avatar:editAvatar||"",visibility:editVisibility,...(m.kind==="person"?{personType:editPersonType,gender:editGender||"",blood:editBlood||""}:(m.kind==="pet"?{gender:editGender||""}:{}))}:m);
    persist(next,items);
    const updated=next.find(m=>m.id===id);
    if(updated)saveMemberToFs(updated).catch(()=>{});
    setEditingId(null);
  };
  // 写真アイコンを選ぶ（編集フォーム内）。IDBに保存して editAvatar にセット
  const pickAvatar=async(e)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash(t("toast.fileTooBig"));return;}
    try{const dataUrl=await downscaleImage(file,400,0.8);const pid="av"+Date.now();const ok=await photoStorage.set(`photo:${pid}`,dataUrl);if(!ok){showFlash(t("toast.storageFull"));return;}setPhotos(p=>({...p,[pid]:dataUrl}));setEditAvatar(pid);}
    catch(er){showFlash(t("toast.imgFail"));}
  };
  // 写真アイコンを選ぶ（追加フォーム用の共通処理）。IDBに保存し、set で photo id を反映。
  const pickAvatarInto=async(e,set)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash(t("toast.fileTooBig"));return;}
    try{const dataUrl=await downscaleImage(file,400,0.8);const pid="av"+Date.now();const ok=await photoStorage.set(`photo:${pid}`,dataUrl);if(!ok){showFlash(t("toast.storageFull"));return;}setPhotos(p=>({...p,[pid]:dataUrl}));set(pid);}
    catch(er){showFlash(t("toast.imgFail"));}
  };
  const pickObAvatar=(e)=>pickAvatarInto(e,setObAvatar);
  const pickNewAvatar=(e)=>pickAvatarInto(e,setNewAvatar);
  // メンバーのアイコン表示（写真があれば写真、無ければ絵文字）
  const avatarNode=(m,cls)=>{const src=m&&m.avatar&&photos[m.avatar];return src?<img className={"yl-avatar "+(cls||"")} src={src} alt=""/>:<span className={cls}>{m?m.emoji:""}</span>;};

  // --- Quick-add functions ---
  const openQuickAdd=(kind,emoji,title,space,lastDate,repeat)=>{
    setQuickAdd({kind,emoji,title,space,lastDate:lastDate||null,repeat:repeat||"none"});
    setQuickDate("");
  };
  const openQuickCopy=(it)=>{
    setQuickAdd({kind:it.careKind,emoji:it.emoji,title:it.title,space:it.space,lastDate:it.dueDate||null,repeat:it.repeat||"none"});
    setQuickDate("");
  };
  const saveQuickAdd=()=>{
    if(!quickAdd)return;
    const base={id:"x"+Date.now(),space:quickAdd.space,title:quickAdd.title,emoji:quickAdd.emoji,type:"care",careKind:quickAdd.kind,done:false,createdAt:Date.now(),dueDate:quickDate||undefined,repeat:quickAdd.repeat};
    const next=[...items,base];
    persist(members,next);
    saveItemToFs(base).catch(()=>{});
    setQuickAdd(null);setQuickDate("");
    showFlash("追加しました！");
  };

  // --- ルーティン（1日のタスク）---
  const todayIso=iso(new Date());
  const openRoutineTemplate=(t)=>setRoutineEdit({title:t.title,emoji:t.emoji,time:t.time,reminders:[0],space:tab});
  const openRoutineCustom=()=>setRoutineEdit({title:"",emoji:curKind==="pet"?"🐾":"⏰",time:"08:00",reminders:[0],space:tab});
  const openRoutineEdit=(r)=>setRoutineEdit({id:r.id,title:r.title,emoji:r.emoji||"⏰",time:r.time||"08:00",reminders:r.reminders||[],space:r.space});
  const toggleRoutineReminder=(mins)=>setRoutineEdit(prev=>prev?{...prev,reminders:prev.reminders.includes(mins)?prev.reminders.filter(m=>m!==mins):[...prev.reminders,mins].sort((a,b)=>a-b)}:prev);
  const saveRoutine=()=>{
    if(!routineEdit)return;
    const title=routineEdit.title.trim();if(!title)return;
    const rem=routineEdit.reminders.length?routineEdit.reminders:undefined;
    let next,savedId;
    if(routineEdit.id){
      savedId=routineEdit.id;
      next=items.map(x=>x.id===routineEdit.id?{...x,title,emoji:routineEdit.emoji,time:routineEdit.time,reminders:rem}:x);
    }else{
      savedId="rt"+Date.now();
      next=[...items,{id:savedId,space:routineEdit.space,type:"routine",title,emoji:routineEdit.emoji,time:routineEdit.time,reminders:rem,repeat:"daily",doneDate:null,createdAt:Date.now()}];
    }
    persist(members,next);
    if(!routineEdit.id)track("task_add",{task_type:"routine"});
    const saved=next.find(x=>x.id===savedId);
    if(saved)saveItemToFs(saved).catch(()=>{});
    setRoutineEdit(null);showFlash(t("toast.routineSaved"));
  };
  const toggleRoutine=(id)=>{
    const r=items.find(x=>x.id===id);if(!r)return;
    const done=r.doneDate===todayIso;
    if(!done)track("task_complete",{task_type:"routine"});
    const next=items.map(x=>x.id===id?{...x,doneDate:done?null:todayIso}:x);
    persist(members,next);
    const u=next.find(x=>x.id===id);if(u)saveItemToFs(u).catch(()=>{});
  };
  const removeRoutine=(id)=>{
    const r=items.find(x=>x.id===id);
    deleteItemFromFs(r).catch(()=>{});
    persist(members,items.filter(x=>x.id!==id));
    setRoutineEdit(null);
  };
  const routines=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="routine").sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99")),[items,tab]);
  const routineDone=routines.filter(r=>r.doneDate===todayIso).length;

  // --- 消耗品ストック（買った日＋サイクルで残量を自動計算）---
  const openSupplyTemplate=(t)=>setSupplyEdit({title:t.title,emoji:t.emoji,cycleDays:t.cycleDays,lastBought:todayIso,space:tab});
  const openSupplyCustom=()=>setSupplyEdit({title:"",emoji:"🥫",cycleDays:30,lastBought:todayIso,space:tab});
  const openSupplyEdit=(s)=>setSupplyEdit({id:s.id,title:s.title,emoji:s.emoji||"🥫",cycleDays:s.cycleDays||30,lastBought:s.lastBought||todayIso,space:s.space});
  const saveSupply=()=>{
    if(!supplyEdit)return;
    const title=supplyEdit.title.trim();if(!title)return;
    let next,savedId;
    if(supplyEdit.id){
      savedId=supplyEdit.id;
      next=items.map(x=>x.id===supplyEdit.id?{...x,title,emoji:supplyEdit.emoji,cycleDays:Number(supplyEdit.cycleDays),lastBought:supplyEdit.lastBought}:x);
    }else{
      savedId="sp"+Date.now();
      next=[...items,{id:savedId,space:supplyEdit.space,type:"supply",title,emoji:supplyEdit.emoji,cycleDays:Number(supplyEdit.cycleDays),lastBought:supplyEdit.lastBought,createdAt:Date.now()}];
    }
    persist(members,next);
    const saved=next.find(x=>x.id===savedId);
    if(saved)saveItemToFs(saved).catch(()=>{});
    setSupplyEdit(null);showFlash(t("toast.stockSaved"));
  };
  // 「買った！」＝最後に買った日を今日に更新（ユーザー入力はここだけ）
  const markBought=(id)=>{
    const next=items.map(x=>x.id===id?{...x,lastBought:todayIso}:x);
    persist(members,next);
    const u=next.find(x=>x.id===id);if(u)saveItemToFs(u).catch(()=>{});
    const it=next.find(x=>x.id===id);
    showFlash(`${it?.emoji||"📦"} 買った！次は約${it?.cycleDays||30}日後の目安です`);
  };
  const removeSupply=(id)=>{
    deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});
    persist(members,items.filter(x=>x.id!==id));
    setSupplyEdit(null);
  };
  const supplies=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="supply").sort((a,b)=>{const la=(supplyStatus(a)||{}).left??999,lb=(supplyStatus(b)||{}).left??999;return la-lb;}),[items,tab]);
  // 思い出（新しい順）
  const memories=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="memory").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  // からだの記録（体重・身長・体調）
  const healthRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="health").sort((a,b)=>(a.date||"").localeCompare(b.date||"")||(a.createdAt||0)-(b.createdAt||0)),[items,tab]);
  const weightPts=useMemo(()=>healthRecords.filter(r=>r.weight!=null).map(r=>({date:r.date,value:r.weight,unit:r.wunit||"kg"})),[healthRecords]);
  const bpPts=useMemo(()=>healthRecords.filter(r=>r.bpSys!=null).map(r=>({date:r.date,value:r.bpSys,unit:"mmHg"})),[healthRecords]);
  const heightPts=useMemo(()=>healthRecords.filter(r=>r.height!=null).map(r=>({date:r.date,value:r.height})),[healthRecords]);
  // 体重の単位（メンバーごと。小動物はg）。自分はkg固定
  const weightUnit=isMemberTab?(activeMember.weightUnit||"kg"):"kg";
  const setMemberWeightUnit=(u)=>{if(!activeMember)return;const next=members.map(m=>m.id===activeMember.id?{...m,weightUnit:u}:m);persist(next,items);const upd=next.find(m=>m.id===activeMember.id);if(upd)saveMemberToFs(upd).catch(()=>{});};
  // 目標体重（ダイエット手帳）。メンバーごと
  const targetWeight=isMemberTab?(activeMember.targetWeight||""):"";
  const setMemberTarget=(v)=>{if(!activeMember)return;const t=v===""?undefined:Number(v);const next=members.map(m=>m.id===activeMember.id?{...m,targetWeight:t}:m);persist(next,items);const upd=next.find(m=>m.id===activeMember.id);if(upd)saveMemberToFs(upd).catch(()=>{});};
  const latestWeight=weightPts.length?weightPts[weightPts.length-1].value:null;
  const weightDiff=(targetWeight!==""&&latestWeight!=null)?(latestWeight-Number(targetWeight)):null;
  const saveHealth=()=>{
    const w=healthW.trim()===""?null:Number(healthW);const h=healthH.trim()===""?null:Number(healthH);
    const num=(s)=>{const t=(s||"").trim();if(t==="")return null;const n=Number(t);return isNaN(n)?null:n;};
    const bpS=num(healthBpS),bpD=num(healthBpD),temp=num(healthTemp),glu=num(healthGlucose);
    const hasVital=bpS!=null||bpD!=null||temp!=null||glu!=null;
    if(w==null&&h==null&&!healthCond&&!hasVital){showFlash(t("toast.healthNeeded"));return;}
    if(w!=null&&(isNaN(w)||w<=0)){showFlash(t("toast.weightNum"));return;}
    if(h!=null&&(isNaN(h)||h<=0)){showFlash(t("toast.heightNum"));return;}
    const rec={id:"hl"+Date.now(),space:tab,type:"health",date:todayIso,createdAt:Date.now()};
    if(w!=null){rec.weight=w;rec.wunit=weightUnit;}if(h!=null)rec.height=h;if(healthCond)rec.condition=healthCond;
    if(bpS!=null)rec.bpSys=bpS;if(bpD!=null)rec.bpDia=bpD;if(temp!=null)rec.temp=temp;if(glu!=null)rec.glucose=glu;
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    if(w!=null)track("weight_record");else track("body_record");
    setHealthW("");setHealthH("");setHealthCond("");setHealthBpS("");setHealthBpD("");setHealthTemp("");setHealthGlucose("");
    showFlash(t("toast.healthSaved"));
  };
  const removeHealth=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // --- ごはん（給餌）記録：回/g/ml/粒。1回分=◯g を設定すると「回」を内部でg換算し総摂取量に反映 ---
  const FEED_UNITS=[{k:"serving",l:"回"},{k:"g",l:"g"},{k:"ml",l:"ml"},{k:"grain",l:"粒"}];
  const feedUnitLabel=(k)=>(FEED_UNITS.find(u=>u.k===k)||{}).l||k;
  // 単位の並び順：そのペットで前回使った単位を先頭に（よく使う順）
  const feedUnitsOrdered=useMemo(()=>{const last=isMemberTab?activeMember.lastFeedUnit:null;if(!last)return FEED_UNITS;return[...FEED_UNITS.filter(u=>u.k===last),...FEED_UNITS.filter(u=>u.k!==last)];},[activeMember,isMemberTab]);
  const servingG=isMemberTab&&activeMember.servingG!=null&&activeMember.servingG!==""?Number(activeMember.servingG):null; // 1回分の基準量(g)
  const openFeed=()=>{setFeedUnit((activeMember&&activeMember.lastFeedUnit)||"serving");setFeedServing(servingG!=null?String(servingG):"");setFeedAmt("");setFeedMult(1);setInputSheet("feed");};
  const feedEntryText=(x)=>{const u=feedUnitLabel(x.unit);const base=x.unit==="serving"?`×${x.amount}`:`${x.amount}${u}`;return x.grams!=null&&x.unit!=="g"?`${base}（約${x.grams}g）`:base;};
  const feedRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="feed").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  const feedToday=useMemo(()=>feedRecords.filter(x=>x.date===todayIso),[feedRecords,todayIso]);
  const feedTodayG=useMemo(()=>feedToday.reduce((s,x)=>s+(x.grams||0),0),[feedToday]);
  const saveFeed=()=>{
    const unit=feedUnit;const memberPatch={lastFeedUnit:unit};let amount,grams=null;
    if(unit==="serving"){
      amount=feedMult;
      const draftG=Number(feedServing);
      let baseG=servingG;
      // 1回分の基準量：未設定なら今回入力で確定し以降使い回す。変更もここで反映。
      if(feedServing.trim()!==""&&draftG>0&&draftG!==servingG){baseG=draftG;memberPatch.servingG=draftG;}
      if(baseG)grams=Math.round(feedMult*baseG); // 倍率×基準量でg換算
    }else{
      const n=Number(feedAmt);if(feedAmt.trim()===""||isNaN(n)||n<=0){showFlash(t("toast.amountNeeded"));return;}
      amount=n;if(unit==="g"||unit==="ml")grams=n; // g・mlはそのまま総量へ（ml≒g）。粒は換算せず記録のみ
    }
    const rec={id:"fd"+Date.now(),space:tab,type:"feed",date:todayIso,unit,amount,createdAt:Date.now()};
    if(grams!=null)rec.grams=grams;
    const nextMembers=members.map(m=>m.id===tab?{...m,...memberPatch}:m);
    persist(nextMembers,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    const um=nextMembers.find(m=>m.id===tab);if(um)saveMemberToFs(um).catch(()=>{});
    setFeedAmt("");setFeedMult(1);
    showFlash(grams!=null?`ごはんを記録しました（約${grams}g）🍚`:"ごはんを記録しました 🍚");
  };
  const removeFeed=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // --- フード・食事：フード登録（fooddef）＋ 今日の食事記録（feed に食事情報を付与） ---
  const foodDefs=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="fooddef").sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)),[items,tab]);
  const foodDefText=(d)=>{const parts=[];if(d.amount!==""&&d.amount!=null)parts.push(`${d.amount}${foodUnitLabel(d.unit)}`);if(d.timesPerDay!==""&&d.timesPerDay!=null)parts.push(`1日${d.timesPerDay}回`);if(d.kcal!==""&&d.kcal!=null)parts.push(d.kcalBasis==="perUnit"?`${d.kcal}kcal/${foodUnitLabel(d.unit)}`:`${d.kcal}kcal/100${d.unit==="ml"?"ml":"g"}`);return parts.join(" ・ ");};
  // 共有・引き継ぎ用の表示：カロリー密度（kcal/100g）ではなく「1回◯・1日◯回（＝1日の目安kcal）」で、そのまま行動できる形に。
  const foodDefShareText=(d)=>{const parts=[];if(d.amount!==""&&d.amount!=null)parts.push(`1回 ${d.amount}${foodUnitLabel(d.unit)}`);if(d.timesPerDay!==""&&d.timesPerDay!=null)parts.push(`1日${d.timesPerDay}回`);let s=parts.join(" ・ ");const per=computeMealKcal(d,d.amount);const t=Number(d.timesPerDay);if(per!=null&&t>0)s+=`${s?"（":""}約${Math.round(per*t)}kcal/日${s?"）":""}`;return s;};
  // 「画像で保存」：指定セレクタのシート・カードをPNGとして書き出す。
  const saveSheetImage=async(selector,filename,opts)=>{
    if(imgSaving)return;
    const node=document.querySelector(selector);
    if(!node){showFlash("画像を作成できませんでした");return;}
    setImgSaving(true);showFlash("画像を作成中…");
    try{
      const r=await saveNodeAsImage(node,filename,opts);
      if(r==="shared")showFlash("「画像を保存」でアルバムに保存できます 🖼️");
      else if(r==="download")showFlash("画像を保存しました 🖼️");
      else showFlash(""); // キャンセル時は静かに閉じる
    }
    catch(e){showFlash("画像を保存できませんでした");}
    finally{setImgSaving(false);}
  };
  const safeName=(s)=>String(s||"").replace(/[\\/:*?"<>|]/g,"").trim()||"loalife";
  const openFoodNew=()=>setFoodForm({name:"",brand:"",foodType:"dry",amount:"",unit:"g",times:"",feedTime:"",kcal:"",kcalBasis:"per100"});
  // 1日のフード量計算：体重は最新の体重記録、MEは登録フード（/100g）から初期値を補完。
  const openFoodCalc=()=>{
    const sp=(activeMember&&activeMember.species==="cat")?"cat":"dog";
    const ws=items.filter(x=>x.space===tab&&x.type==="health"&&x.weight!=null).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0));
    const bw=ws[0]&&ws[0].weight!=null?String(ws[0].weight):"";
    const food=foodDefs.find(f=>f.kcalBasis==="per100"&&f.kcal!==""&&f.kcal!=null);
    setFoodCalc({species:sp,bw,stage:"",bcs:5,me:food?String(food.kcal):""});
    setFoodCalcGuide(false);setFoodCalcMeGuide(false);
  };
  // 計算結果の1回分（g）を登録フードの「1回の量」へ反映。対象は計算に使ったフード（無ければ新規登録フォームへ）。
  const applyCalcToFood=(grams,times)=>{
    if(!(grams>0)){showFlash("先に体重・BCS・ME を入れてください");return;}
    const me=Number(foodCalc.me);
    const food=foodDefs.find(f=>f.kcalBasis==="per100"&&String(f.kcal)===String(foodCalc.me))||foodDefs.find(f=>f.kcalBasis==="per100");
    if(food){
      const rec={...food,amount:grams,unit:"g",timesPerDay:times};
      persist(members,items.map(x=>x.id===food.id?rec:x));saveItemToFs(rec).catch(()=>{});
      setFoodCalc(null);showFlash(`「${food.name}」を 1回${grams}g・1日${times}回 に設定しました 🍚`);
    }else{
      setFoodCalc(null);
      setFoodForm({name:"",brand:"",foodType:"dry",amount:String(grams),unit:"g",times:String(times),feedTime:"",kcal:me>0?String(me):"",kcalBasis:"per100"});
    }
  };
  const openFoodEdit=(d)=>setFoodForm({id:d.id,name:d.name||"",brand:d.brand||"",foodType:d.foodType||"dry",amount:d.amount??"",unit:d.unit||"g",times:d.timesPerDay??"",feedTime:d.feedTime||"",kcal:d.kcal??"",kcalBasis:d.kcalBasis||"per100"});
  const saveFoodDef=()=>{const f=foodForm;if(!f)return;const name=(f.name||"").trim();if(!name){showFlash(t("toast.foodNameNeeded"));return;}
    const numOrBlank=(v)=>{if(v===""||v==null)return"";const n=Number(v);return isNaN(n)?"":n;};
    const base={name,brand:(f.brand||"").trim(),foodType:f.foodType||"other",amount:numOrBlank(f.amount),unit:f.unit||"g",timesPerDay:numOrBlank(f.times),feedTime:(f.feedTime||"").trim(),kcal:numOrBlank(f.kcal),kcalBasis:f.kcalBasis||"per100"};
    if(f.id){const old=items.find(x=>x.id===f.id)||{};const rec={...old,...base};persist(members,items.map(x=>x.id===f.id?rec:x));saveItemToFs(rec).catch(()=>{});}
    else{const rec={id:"food"+Date.now(),space:tab,type:"fooddef",...base,createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});}
    track("food_register",{food_type:base.foodType});
    setFoodForm(null);showFlash(t("toast.foodSaved"));};
  const removeFoodDef=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  const openMeal=(foodId)=>{const d=foodDefs.find(x=>x.id===foodId)||foodDefs[0];if(!d){openFoodNew();return;}const h=new Date().getHours();const slot=d.foodType==="treat"?"treat":(h<11?"morning":h<15?"noon":"night");setMealForm({foodId:d.id,slot,amount:(d.amount!==""&&d.amount!=null)?String(d.amount):""});};
  const saveMeal=()=>{const f=mealForm;if(!f)return;const d=foodDefs.find(x=>x.id===f.foodId);if(!d){showFlash(t("toast.pickFood"));return;}
    const amt=Number(f.amount);if(f.amount===""||isNaN(amt)||amt<=0){showFlash(t("toast.qtyNeeded"));return;}
    const kcal=computeMealKcal(d,amt);
    const rec={id:"fd"+Date.now(),space:tab,type:"feed",date:todayIso,unit:d.unit,amount:amt,foodId:d.id,foodName:d.name,foodType:d.foodType,slot:f.slot,createdAt:Date.now()};
    if(d.unit==="g"||d.unit==="ml")rec.grams=amt; // 同単位の合計量集計に使用
    if(kcal!=null)rec.kcal=kcal;
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    setMealForm(null);showFlash(kcal!=null?`記録しました（約${kcal}kcal）🍚`:"食事を記録しました 🍚");};
  // 今日の食事サマリー：回数／同単位ごとの合計量／合計kcal（計算可能な分のみ）。異なる単位は合算しない。
  const mealSummary=useMemo(()=>{
    const byUnit={};let kcal=0,hasKcal=false;
    feedToday.forEach(x=>{const u=x.unit;if(u&&u!=="serving"&&x.amount!=null)byUnit[u]=(byUnit[u]||0)+Number(x.amount);if(x.kcal!=null){kcal+=Number(x.kcal);hasKcal=true;}});
    return{count:feedToday.length,byUnit,kcal:hasKcal?Math.round(kcal):null};
  },[feedToday]);
  const mealAmountText=(m)=>Object.entries(m.byUnit).map(([u,v])=>`${Math.round(v*10)/10}${foodUnitLabel(u)}`).join(" ・ ");
  // --- 授乳タイマー（赤ちゃん）：母乳は左右のタイマー、ミルクは量(ml)で記録。前回からの経過が出る ---
  const nursingRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="nursing").sort((a,b)=>(b.ts||0)-(a.ts||0)),[items,tab]);
  const nursingToday=useMemo(()=>nursingRecords.filter(x=>x.date===todayIso),[nursingRecords,todayIso]);
  const lastNursingTs=nursingRecords.length?nursingRecords[0].ts:null;
  const startNursing=(side)=>{const t={space:tab,side,start:Date.now()};setNursing(t);try{localStorage.setItem("loalife-nursing",JSON.stringify(t));}catch(e){}setNursingNow(Date.now());};
  const cancelNursing=()=>{setNursing(null);try{localStorage.removeItem("loalife-nursing");}catch(e){}};
  const stopNursing=()=>{if(!nursing)return;const durationSec=Math.max(1,Math.round((Date.now()-nursing.start)/1000));const rec={id:"ns"+Date.now(),space:nursing.space,type:"nursing",ts:nursing.start,date:isoOf(nursing.start),side:nursing.side,durationSec,createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});const side=nursing.side;cancelNursing();showFlash(`授乳を記録しました（${side==="left"?"左":"右"} ${fmtDur(durationSec)}）`);};
  const logMilk=()=>{const n=Number(milkMl);if(!milkMl.trim()||isNaN(n)||n<=0){showFlash(t("toast.milkNeeded"));return;}const rec={id:"ns"+Date.now(),space:tab,type:"nursing",ts:Date.now(),date:todayIso,side:"milk",amountMl:Math.round(n),createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});setMilkMl("");showFlash(`ミルクを記録しました（${Math.round(n)}ml）🍼`);};
  const removeNursing=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // --- 散歩記録（開始・終了／時間・距離・GPSルート）---
  const walkRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="walk").sort((a,b)=>(b.start||0)-(a.start||0)),[items,tab]);
  const walkMonthStats=useMemo(()=>{const mo=todayIso.slice(0,7);const list=walkRecords.filter(w=>(w.date||"").slice(0,7)===mo);return{count:list.length,km:list.reduce((s,w)=>s+(w.distanceM||0),0)/1000};},[walkRecords,todayIso]);
  // おさんぽの振り返り：直近6か月の距離・回数・時間（ごほうび的なふりかえり用）
  const walkMonthly=useMemo(()=>{
    const map={};walkRecords.forEach(w=>{const mo=(w.date||"").slice(0,7);if(!mo)return;if(!map[mo])map[mo]={km:0,count:0,sec:0};map[mo].km+=(w.distanceM||0)/1000;map[mo].count++;map[mo].sec+=(w.durationSec||0);});
    const d=new Date();const arr=[];for(let i=5;i>=0;i--){const dt=new Date(d.getFullYear(),d.getMonth()-i,1);const key=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;const m=map[key]||{km:0,count:0,sec:0};arr.push({key,label:(dt.getMonth()+1)+"月",km:m.km,count:m.count,sec:m.sec});}
    return arr;
  },[walkRecords]);
  const walkPersist=(w)=>{try{w?localStorage.setItem("loalife-walk",JSON.stringify(w)):localStorage.removeItem("loalife-walk");}catch(e){}};
  const onWalkPos=(pos)=>{const p={lat:pos.coords.latitude,lng:pos.coords.longitude,t:Date.now()};setWalk(prev=>{if(!prev)return prev;const route=prev.route||[];const last=route[route.length-1];let add=0;if(last){const d=haversineM(last,p);if(d<3)return prev;add=d;} // 3m未満のブレは無視
    const next={...prev,route:[...route,p],distanceM:(prev.distanceM||0)+add};walkPersist(next);return next;});};
  const onWalkErr=(e)=>{setWalkGpsErr(e&&e.code===1?"位置情報が許可されていません（時間は記録できます）":"位置情報を取得できませんでした");};
  const startWalkWatch=()=>{if(walkWatchRef.current!=null||!navigator.geolocation)return;try{walkWatchRef.current=navigator.geolocation.watchPosition(onWalkPos,onWalkErr,{enableHighAccuracy:true,maximumAge:2000,timeout:15000});}catch(e){}};
  const stopWalkWatch=()=>{if(walkWatchRef.current!=null&&navigator.geolocation){try{navigator.geolocation.clearWatch(walkWatchRef.current);}catch(e){}}walkWatchRef.current=null;};
  const startWalk=()=>{if(walk){showFlash("すでに散歩を記録中です");return;}setWalkGpsErr("");const w={space:tab,start:Date.now(),route:[],distanceM:0};setWalk(w);walkPersist(w);setWalkNow(Date.now());track("walk_start");startWalkWatch();if(!navigator.geolocation)setWalkGpsErr("この端末では位置情報が使えません（時間は記録できます）");};
  const cancelWalk=()=>{stopWalkWatch();setWalk(null);walkPersist(null);setWalkGpsErr("");};
  const stopWalk=()=>{if(!walk)return;stopWalkWatch();const durationSec=Math.max(1,Math.round((Date.now()-walk.start)/1000));const distanceM=Math.round(walk.distanceM||0);const rec={id:"wk"+Date.now(),space:walk.space,type:"walk",start:walk.start,end:Date.now(),durationSec,distanceM,route:walk.route||[],date:isoOf(walk.start),createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});setWalk(null);walkPersist(null);setWalkGpsErr("");showFlash(`おさんぽ記録：${fmtDur(durationSec)}・${fmtDist(distanceM)} 🐾`);};
  const removeWalk=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // 散歩の経過時間を1秒ごとに更新＋アプリ復帰時にGPS監視を再開。
  useEffect(()=>{if(!walk)return;const id=setInterval(()=>setWalkNow(Date.now()),1000);startWalkWatch();return()=>{clearInterval(id);stopWalkWatch();};// eslint-disable-next-line
  },[walk?.start]);
  // --- 今日のようす（日記）：元気・食欲・うんち・さんぽ・病院・症状・写真・ひとことを追記型で記録 ---
  const diaryRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="diary").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  // 1日=1カード：同じ日付でグルーピング（日降順、カード内は時系列昇順）。レコードは束ねるだけで消さない。
  const diaryByDate=useMemo(()=>{const map={};diaryRecords.forEach(r=>{(map[r.date]=map[r.date]||[]).push(r);});return Object.keys(map).sort((a,b)=>b.localeCompare(a)).map(date=>({date,recs:map[date].slice().sort((a,b)=>(a.createdAt||0)-(b.createdAt||0))}));},[diaryRecords]);
  // その日のカードをまるごと削除（写真も掃除）
  const removeDiaryDay=(date)=>{const del=diaryRecords.filter(r=>r.date===date);del.forEach(r=>{photoIdsOf(r).forEach(pid=>{try{photoStorage.delete(`photo:${pid}`);}catch(e){}});deleteItemFromFs(r).catch(()=>{});});persist(members,items.filter(r=>!(r.type==="diary"&&r.space===tab&&r.date===date)));};
  // 元気の推移グラフ（5段階を score 化。古い順）
  const energyPts=useMemo(()=>[...diaryRecords].reverse().filter(r=>r.energy&&diaryMeta(DIARY_ENERGY,r.energy)).map(r=>({date:r.date,value:diaryMeta(DIARY_ENERGY,r.energy).score})),[diaryRecords]);
  // 睡眠時間・食欲の推移（今日のようすの記録から。子ども/自分の傾向グラフに再利用）
  const sleepPts=useMemo(()=>[...diaryRecords].reverse().filter(r=>r.sleep!=null&&r.sleep!=="").map(r=>({date:r.date,value:Number(r.sleep)})).filter(p=>!isNaN(p.value)),[diaryRecords]);
  const appetitePts=useMemo(()=>[...diaryRecords].reverse().filter(r=>r.appetite&&diaryMeta(DIARY_APPETITE,r.appetite)).map(r=>({date:r.date,value:diaryMeta(DIARY_APPETITE,r.appetite).score})),[diaryRecords]);
  // 「最近どう？」ふりかえり（子ども・自分）：今月と先月を事実ベースで並べる。評価・診断はしない。
  const selfReview=useMemo(()=>{
    if(curKind==="pet")return null;
    const thisMo=todayIso.slice(0,7);
    const d=new Date();const lastMo=`${new Date(d.getFullYear(),d.getMonth()-1,1).getFullYear()}-${String(new Date(d.getFullYear(),d.getMonth()-1,1).getMonth()+1).padStart(2,"0")}`;
    const inMo=(dt,mo)=>(dt||"").slice(0,7)===mo;
    const dDays=(mo)=>new Set(diaryRecords.filter(r=>inMo(r.date,mo)).map(r=>r.date)).size;
    const sleepAvg=(mo)=>{const v=diaryRecords.filter(r=>inMo(r.date,mo)&&r.sleep!=null&&r.sleep!=="").map(r=>Number(r.sleep)).filter(n=>!isNaN(n));return v.length?v.reduce((s,n)=>s+n,0)/v.length:null;};
    const logCount=(mo)=>{let n=0;items.filter(x=>x.space===tab&&x.type==="chore").forEach(c=>{(c.history||[]).forEach(dt=>{if(inMo(dt,mo))n++;});});items.filter(x=>x.space===tab&&x.type==="routine").forEach(r=>{if(r.doneDate&&inMo(r.doneDate,mo))n++;});return n;};
    const moveCount=(mo)=>walkRecords.filter(w=>inMo(w.date,mo)).length;
    const openTasks=items.filter(x=>x.space===tab&&(x.type==="care"||x.type==="event")&&x.dueDate&&!x.done).length;
    const cur={days:dDays(thisMo),sleep:sleepAvg(thisMo),logs:logCount(thisMo),moves:moveCount(thisMo)};
    const prev={days:dDays(lastMo),sleep:sleepAvg(lastMo),logs:logCount(lastMo),moves:moveCount(lastMo)};
    const any=cur.days||cur.logs||cur.moves||cur.sleep!=null||prev.days||prev.logs;
    return any?{cur,prev,openTasks}:null;
  },[curKind,diaryRecords,items,tab,walkRecords,todayIso]);
  const setDiary=(patch)=>setDiaryDraft(d=>({...d,...patch}));
  const toggleSymptom=(k)=>setDiaryDraft(d=>({...d,symptoms:(d.symptoms||[]).includes(k)?d.symptoms.filter(s=>s!==k):[...(d.symptoms||[]),k]}));
  const pickDiaryPhoto=async(e)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash(t("toast.fileTooBig"));return;}
    try{const dataUrl=await downscaleImage(file);setDiaryDraft(d=>({...d,photo:dataUrl}));}catch(er){showFlash(t("toast.imgFail"));}
  };
  const saveDiary=async()=>{
    const d=diaryDraft;const note=(d.note||"").trim();const syms=d.symptoms||[];
    if(!d.energy&&!d.appetite&&!d.poop&&!d.walk&&!d.hospital&&!d.sleep&&!note&&!syms.length&&!d.photo){showFlash(t("toast.diaryPick"));return;}
    const id="dy"+Date.now();
    const rec={id,space:tab,type:"diary",date:todayIso,createdAt:Date.now()};
    if(d.energy)rec.energy=d.energy;if(d.appetite)rec.appetite=d.appetite;if(d.poop)rec.poop=d.poop;if(d.sleep)rec.sleep=d.sleep;
    if(d.walk)rec.walk=true;if(d.hospital)rec.hospital=true;if(note)rec.note=note;if(syms.length)rec.symptoms=syms;
    if(syms.includes("period"))rec.private=true; // 生理を含む記録はセンシティブ＝本人のみ
    if(d.photo){const pid="dyp"+Date.now();const ok=await photoStorage.set(`photo:${pid}`,d.photo);if(ok){setPhotos(p=>({...p,[pid]:d.photo}));rec.photo=true;rec.photos=[pid];}}
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    setDiaryDraft({energy:"",appetite:"",poop:"",walk:false,hospital:false,sleep:"",note:"",symptoms:[],photo:null});
    showFlash(t("toast.diarySaved"));
  };
  const removeDiary=(id)=>{const it=items.find(x=>x.id===id);if(it)photoIdsOf(it).forEach(pid=>{try{photoStorage.delete(`photo:${pid}`);}catch(e){}});deleteItemFromFs(it).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // --- 生理：入力はモーダルの症状タグ「🩸生理」に一本化。センシティブなので private フラグ（本人のみ）。---
  // 共有機能は未実装だが、将来 private 項目を共有対象から除外できるようフラグを持たせておく（漏れ防止）。
  const isSharable=(it)=>!it.private; // 共有可否。家族共有実装時にこの判定でセンシティブ項目を除外する。
  const periodDates=(sp)=>{const set=new Set();items.forEach(x=>{if(x.space!==sp)return;if(x.type==="period"&&x.date)set.add(x.date);else if(x.type==="diary"&&(x.symptoms||[]).includes("period")&&x.date)set.add(x.date);});return[...set].sort();};
  // やさしい周期予測：period 日を「かたまり（開始日）」に分け、開始間隔の平均から次回目安を出す。医療精度は主張しない。
  const periodForecast=(sp)=>{
    const ds=periodDates(sp);if(ds.length===0)return null;
    const starts=[];let prev=null;ds.forEach(d=>{if(prev===null||daysBetween(prev,d)>10)starts.push(d);prev=d;});
    const last=starts[starts.length-1];
    if(starts.length<2)return{last,next:null};
    const iv=[];for(let i=1;i<starts.length;i++)iv.push(daysBetween(starts[i-1],starts[i]));
    const avg=Math.round(iv.reduce((a,b)=>a+b,0)/iv.length);
    return{last,next:addDays(last,avg),avg};
  };
  // --- ワンタップ記録：迷わず「今日も元気👌」の1タップで当日の体調記録を完了 ---
  // 一度入れたら二度と入れさせない：当日すでに体調（diaryのenergy / healthのcondition）があれば重複させない。
  const todayHasCond=(sp)=>items.some(x=>x.space===sp&&x.date===todayIso&&((x.type==="diary"&&x.energy)||(x.type==="health"&&x.condition)));
  const quickHealthy=(spaceId)=>{
    const sp=spaceId||tab;
    if(todayHasCond(sp)){showFlash(t("toast.alreadyRecorded"));return;}
    const rec={id:"dy"+Date.now(),space:sp,type:"diary",date:todayIso,energy:"genki",createdAt:Date.now()};
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    showFlash(t("toast.recordedWell"));
  };
  // --- 大切な情報カード（緊急連絡先・アレルギー/禁忌・病院メモ）。写真も保存可 ---
  const cards=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="card").sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)),[items,tab]);
  const openCardNew=(kind)=>{const m=cardMeta(kind);setCardEdit({space:tab,kind,title:m.label,body:"",photo:null,photoId:null,hours:"",addr:"",night:false});};
  const openCardEdit=async(c)=>{let photo=null;const pid=firstPhotoId(c);if(pid){photo=photos[pid]||null;if(!photo){try{photo=await photoStorage.get(`photo:${pid}`);}catch(e){}}}setCardEdit({id:c.id,space:c.space,kind:c.kind||"other",title:c.title||"",body:c.body||"",photo,photoId:pid||null,hours:c.hours||"",addr:c.addr||"",night:!!c.night});};
  const pickCardPhoto=async(e)=>{const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;if(file.size>20*1024*1024){showFlash(t("toast.fileTooBig"));return;}try{const dataUrl=await downscaleImage(file);setCardEdit(c=>c?{...c,photo:dataUrl,photoNew:true}:c);}catch(er){showFlash(t("toast.imgFail"));}};
  const saveCard=async()=>{
    if(!cardEdit)return;const c=cardEdit;const title=(c.title||"").trim()||cardMeta(c.kind).label;const body=(c.body||"").trim();
    const hasHosp=c.kind==="hospital"&&((c.hours||"").trim()||(c.addr||"").trim());
    if(!body&&!c.photo&&!hasHosp){showFlash(t("toast.cardNeed"));return;}
    const id=c.id||("cd"+Date.now());let photoId=c.photoId||null;
    if(c.photoNew&&c.photo){const pid="cdp"+Date.now();const ok=await photoStorage.set(`photo:${pid}`,c.photo);if(ok){setPhotos(p=>({...p,[pid]:c.photo}));photoId=pid;}}
    else if(!c.photo&&c.photoId){try{photoStorage.delete(`photo:${c.photoId}`);}catch(e){}photoId=null;}
    const isHosp=c.kind==="hospital";const hours=isHosp?(c.hours||"").trim():"";const addr=isHosp?(c.addr||"").trim():"";const night=isHosp?!!c.night:false;
    const rec={id,space:c.space,type:"card",kind:c.kind,title,body:body||undefined,photo:photoId?true:undefined,photos:photoId?[photoId]:undefined,hours:hours||undefined,addr:addr||undefined,night:night||undefined,createdAt:c.id?(items.find(x=>x.id===c.id)||{}).createdAt||Date.now():Date.now()};
    const next=c.id?items.map(x=>x.id===c.id?{...x,...rec}:x):[...items,rec];
    persist(members,next);saveItemToFs(rec).catch(()=>{});setCardEdit(null);showFlash(t("toast.cardSaved"));
  };
  const removeCard=(id)=>{const it=items.find(x=>x.id===id);if(it)photoIdsOf(it).forEach(pid=>{try{photoStorage.delete(`photo:${pid}`);}catch(e){}});deleteItemFromFs(it).catch(()=>{});persist(members,items.filter(x=>x.id!==id));setCardEdit(null);};
  // --- 持ち物（曜日ごと）：明日の準備チェックリスト。学校の忘れ物防止 ---
  const belongings=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="belonging"),[items,tab]);
  const addBelonging=()=>{const t=belongDraft.trim();if(!t){showFlash(t("toast.belongNeeded"));return;}const rec={id:"bl"+Date.now(),space:tab,type:"belonging",title:t,dow:belongDow,createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});setBelongDraft("");showFlash(t("toast.belongAdded"));};
  const removeBelonging=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // 成長記録（育児日記）：はじめて・できたこと等のマイルストーンを記録。
  const growthRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="milestone").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  const addMilestone=(cat,title)=>{const t=(title||"").trim();if(!t)return;const rec={id:"ms"+Date.now(),space:tab,type:"milestone",date:todayIso,category:cat||"first",title:t,createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});setMsDraft("");showFlash(t("toast.growthSaved"));};
  const removeMilestone=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // お手伝いポイント：タスクごとにポイントを付与。合計・今週を集計。
  const pointRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="point").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  const pointStats=useMemo(()=>{const total=pointRecords.reduce((s,x)=>s+(Number(x.points)||0),0);const wk=iso(new Date(Date.now()-6*86400000));const week=pointRecords.filter(x=>(x.date||"")>=wk).reduce((s,x)=>s+(Number(x.points)||0),0);return{total,week};},[pointRecords]);
  const addPoint=(task,pt)=>{const t=(task||"").trim();if(!t)return;const rec={id:"pt"+Date.now(),space:tab,type:"point",date:todayIso,task:t,points:Number(pt)||1,createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});setPointTask("");showFlash(`${t} +${Number(pt)||1}pt`);};
  const removePoint=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // おこづかい帳：もらった/つかった/ちょきん。残高を集計（ちょきんは残高に影響しない記録）。
  const allowanceRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="allowance").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  const allowanceBalance=useMemo(()=>allowanceRecords.reduce((s,x)=>{const d=ALLOWANCE_DIRS.find(o=>o.k===x.dir);return s+(d?d.sign:0)*(Number(x.amount)||0);},0),[allowanceRecords]);
  const addAllowance=()=>{const amt=Number(allowAmt);if(!allowAmt.trim()||isNaN(amt)||amt<=0){showFlash("金額を入力してください");return;}const rec={id:"al"+Date.now(),space:tab,type:"allowance",date:todayIso,amount:amt,dir:allowDir,reason:(allowReason||"").trim()||undefined,createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});setAllowAmt("");setAllowReason("");showFlash("おこづかいを記録しました");};
  const removeAllowance=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // お薬コース：X日間の服用を1日ずつチェック。残り日数を表示。
  const medCourses=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="medcourse").sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  const addMedCourse=()=>{const n=(medName||"").trim();if(!n){showFlash(t("toast.medName"));return;}const days=Math.max(1,parseInt(medDays||"1",10));const rec={id:"md"+Date.now(),space:tab,type:"medcourse",name:n,days,startDate:todayIso,taken:[],createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});setMedName("");showFlash(t("toast.medSaved"));};
  const toggleMedToday=(id)=>{const next=items.map(x=>{if(x.id!==id)return x;const taken=x.taken||[];const has=taken.includes(todayIso);const nt=has?taken.filter(d=>d!==todayIso):[...taken,todayIso];return{...x,taken:nt};});persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});};
  const removeMedCourse=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // 家族ノート（メッセージ・感謝・きもち）。端末内で家族が書き込める簡易ボード。
  const familyNotes=useMemo(()=>items.filter(x=>x.type==="familynote").sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)),[items]);
  const addFamilyNote=()=>{const t=(noteText||"").trim();if(!t)return;const author=(meName||"わたし");const rec={id:"fn"+Date.now(),space:"me",type:"familynote",kind:noteKind,text:t,author,date:todayIso,createdAt:Date.now()};persist(members,[...items,rec]);setNoteText("");showFlash(t("toast.noteSaved"));};
  const removeFamilyNote=(id)=>{persist(members,items.filter(x=>x.id!==id));};
  const tomorrowIso=plusDays(1);const tomorrowDow=dowOf(tomorrowIso);
  const tomorrowBelongings=useMemo(()=>belongings.filter(b=>b.dow===tomorrowDow),[belongings,tomorrowDow]);
  const toggleBelongPrep=(id)=>{const next=items.map(x=>x.id===id?{...x,prepDate:x.prepDate===tomorrowIso?null:tomorrowIso}:x);persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});};
  // --- 支出：病院代・餌代などをカテゴリ別に記録し、費用を可視化 ---
  const expenseRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="expense").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  const expenseMonth=useMemo(()=>{
    const ym=todayIso.slice(0,7);
    const inMonth=expenseRecords.filter(x=>(x.date||"").slice(0,7)===ym);
    const total=inMonth.reduce((s,x)=>s+(Number(x.amount)||0),0);
    const byCat={};inMonth.forEach(x=>{const k=x.category||"other";byCat[k]=(byCat[k]||0)+(Number(x.amount)||0);});
    const cats=ALL_EXPENSE_CATS.map(c=>({...c,amount:byCat[c.key]||0})).filter(c=>c.amount>0).sort((a,b)=>b.amount-a.amount);
    return{total,cats,ym};
  },[expenseRecords,todayIso]);
  // 費用の集計（このコ／みんな 切替）：合計・今年・月平均・年間見込み・カテゴリ内訳・月次推移・メンバー別。
  const expStats=useMemo(()=>{
    const all=items.filter(x=>x.type==="expense");
    const recs=expScope==="all"?all:all.filter(x=>x.space===tab);
    const amt=x=>Number(x.amount)||0;
    const total=recs.reduce((s,x)=>s+amt(x),0);
    const yr=todayIso.slice(0,4);
    const thisYear=recs.filter(x=>(x.date||"").slice(0,4)===yr).reduce((s,x)=>s+amt(x),0);
    // カテゴリ内訳
    const byCat={};recs.forEach(x=>{const k=x.category||"other";byCat[k]=(byCat[k]||0)+amt(x);});
    const cats=ALL_EXPENSE_CATS.map(c=>({...c,amount:byCat[c.key]||0})).filter(c=>c.amount>0).sort((a,b)=>b.amount-a.amount);
    // 月次推移：実データのある期間に合わせて表示月数を可変に（最大12・最小3の枠）。
    const now=new Date(todayIso+"T00:00:00");
    const byMonth={};recs.forEach(x=>{const k=(x.date||"").slice(0,7);if(k)byMonth[k]=(byMonth[k]||0)+amt(x);});
    const monthsWithData=Object.keys(byMonth).sort();
    // 記録がある最古の月〜今月の月数（span）。月平均や表示期間の基準に使う。
    let span=1;
    if(monthsWithData.length){const first=monthsWithData[0];const[fy,fm]=first.split("-").map(Number);span=Math.max(1,(now.getFullYear()-fy)*12+(now.getMonth()+1-fm)+1);}
    const monthlyAvg=Math.round(total/span);
    // グラフ表示月数：データ範囲(span)に合わせて 3〜12ヶ月。2ヶ月以上のデータで推移を表示。
    const trendMonths=Math.min(12,Math.max(3,span));
    const series=[];
    for(let i=trendMonths-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;series.push({ym,m:d.getMonth()+1,total:byMonth[ym]||0});}
    const trendReady=monthsWithData.length>=2; // 1ヶ月分だけでは「推移」にならないためプレースホルダー
    const annual=monthlyAvg*12;
    // メンバー別（みんな表示のとき）
    const spaces=["me",...members.map(m=>m.id)];
    const byMember=spaces.map(sp=>({space:sp,name:nameOf(sp)||"わたし",total:all.filter(x=>x.space===sp).reduce((s,x)=>s+amt(x),0)})).filter(m=>m.total>0).sort((a,b)=>b.total-a.total);
    const grandTotal=all.reduce((s,x)=>s+amt(x),0);
    return{total,thisYear,monthlyAvg,annual,cats,series,trendReady,trendMonths,byMember,grandTotal,count:recs.length,year:yr};
  },[items,expScope,tab,todayIso,members,meName]);
  const saveExpense=()=>{
    const amt=Number(expAmount);
    if(!expAmount.trim()||isNaN(amt)||amt<=0){showFlash("金額を入力してください");return;}
    const cats=expenseCatsFor(curKind);const cat=cats.some(c=>c.key===expCat)?expCat:cats[0].key;
    const rec={id:"ex"+Date.now(),space:tab,type:"expense",date:todayIso,amount:amt,category:cat,note:(expNote||"").trim()||undefined,createdAt:Date.now()};
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    setExpAmount("");setExpNote("");
    showFlash("支出を記録しました 💰");
  };
  const removeExpense=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // 支出の編集（日付変更はここだけ＝レシート遅延・代理入力などの例外用途）
  const openExpEdit=(r)=>setExpEdit({id:r.id,amount:String(r.amount||""),category:r.category||"other",note:r.note||"",date:r.date||todayIso});
  const saveExpEdit=()=>{
    if(!expEdit)return;const amt=Number(expEdit.amount);
    if(!String(expEdit.amount).trim()||isNaN(amt)||amt<=0){showFlash("金額を入力してください");return;}
    const next=items.map(x=>x.id===expEdit.id?{...x,amount:amt,category:expEdit.category,note:expEdit.note.trim()||undefined,date:expEdit.date||x.date}:x);
    persist(members,next);const it=next.find(x=>x.id===expEdit.id);if(it)saveItemToFs(it).catch(()=>{});
    setExpEdit(null);showFlash("支出を更新しました 💰");
  };
  // サムネイルの遅延読み込み（複数写真対応。各 photoId を未ロードのみ取得）
  useEffect(()=>{
    const missing=[];const seen={};
    items.forEach(x=>photoIdsOf(x).forEach(pid=>{if(!photos[pid]&&!seen[pid]){seen[pid]=1;missing.push(pid);}}));
    members.forEach(m=>{if(m.avatar&&!photos[m.avatar]&&!seen[m.avatar]){seen[m.avatar]=1;missing.push(m.avatar);}(m.posterPhotos||[]).forEach(pid=>{if(pid&&!photos[pid]&&!seen[pid]){seen[pid]=1;missing.push(pid);}});});
    if(meAvatar&&!photos[meAvatar]&&!seen[meAvatar]){seen[meAvatar]=1;missing.push(meAvatar);}
    if(missing.length===0)return;
    let cancelled=false;
    (async()=>{for(const pid of missing){try{const v=await photoStorage.get(`photo:${pid}`);if(!cancelled&&v)setPhotos(p=>({...p,[pid]:v}));}catch(e){}}})();
    return()=>{cancelled=true;};
  },[items,members,meAvatar]);
  // 証明書（ワクチン等）：写真付きのケアを上部に出してすぐ見られるように
  const certs=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="care"&&x.photo).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  // 証明書を年ごとにまとめる（何年度ぶん、が分かるように）。
  // 対応済みにすると dueDate は次回（翌年）へ進むため、実施日 lastDone を優先して「その証明書が実際にいつのものか」で分類する。
  const certsByYear=useMemo(()=>{const map={};certs.forEach(c=>{const d=c.lastDone||itemDate(c)||(c.createdAt?iso(new Date(c.createdAt)):"");const y=d?d.slice(0,4):"----";(map[y]=map[y]||[]).push(c);});return Object.keys(map).sort((a,b)=>b.localeCompare(a)).map(y=>({year:y,items:map[y]}));},[certs]);
  // まだ写真（証明書）が付いていないケア記録。「健康・ケアの記録」でその場から写真を添付できるよう出し分ける（データ構造は変更せず読み取りのみ）。
  const careNoPhoto=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="care"&&!x.photo).sort((a,b)=>{const da=a.lastDone||itemDate(a)||"";const db=b.lastDone||itemDate(b)||"";return db.localeCompare(da);}),[items,tab]);
  // お世話ログ（トイレ掃除・シャンプー等）：やった履歴と前回からの経過
  const chores=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="chore").sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)),[items,tab]);
  const petMembers=useMemo(()=>members.filter(m=>m.kind==="pet"),[members]);
  const addChore=(title,emoji)=>{if(chores.some(c=>c.title===title))return;const rec={id:"ch"+Date.now(),space:tab,type:"chore",title,emoji:emoji||"🧹",lastDone:null,history:[],createdAt:Date.now()};persist(members,[...items,rec]);track("task_add",{task_type:"chore"});saveItemToFs(rec).catch(()=>{});};
  // お世話ログの自由追加（テンプレ以外も自分で登録）。絵文字は内容から推定。
  const addCustomChore=()=>{const t=choreDraft.trim();if(!t)return;if(chores.some(c=>c.title===t)){showFlash(t("toast.dupItem"));setChoreDraft("");return;}addChore(t,guessEmoji(t,"🧹"));setChoreDraft("");showFlash(t("toast.added"));};
  const logChore=(id)=>{const next=items.map(x=>{if(x.id!==id)return x;const hist=[todayIso,...(x.history||[]).filter(d=>d!==todayIso)].slice(0,30);return{...x,lastDone:todayIso,history:hist};});persist(members,next);track("task_complete",{task_type:"chore"});const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});showFlash(t("toast.saved"));};
  // まとめて記録：選択中の子（複数）に、日課（ご飯/お薬/散歩/トイレ）を一括でお世話ログに記録。
  const batchLog=(action,ids)=>{
    const sel=ids.filter(id=>members.some(m=>m.id===id&&m.kind==="pet"));
    if(sel.length===0){showFlash(t("toast.pickWho"));return;}
    let next=[...items];const touched=[];
    sel.forEach(sp=>{
      const idx=next.findIndex(x=>x.space===sp&&x.type==="chore"&&x.title===action.title);
      if(idx>=0){const x=next[idx];const hist=[todayIso,...(x.history||[]).filter(d=>d!==todayIso)].slice(0,30);next[idx]={...x,lastDone:todayIso,history:hist};touched.push(next[idx]);}
      else{const rec={id:"ch"+Date.now()+"-"+sp,space:sp,type:"chore",title:action.title,emoji:action.emoji,lastDone:todayIso,history:[todayIso],createdAt:Date.now()};next.push(rec);touched.push(rec);}
    });
    persist(members,next);touched.forEach(it=>saveItemToFs(it).catch(()=>{}));
    showFlash(`${sel.length}匹に「${action.emoji} ${action.title}」を記録 ✓`);
  };
  const removeChore=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // トイレ記録：おしっこ/うんちを成功・失敗で記録。うんちはブリストルスコア(1〜7)も残す。
  const logToilet=(tk,success,bristol)=>{
    const emoji=tk==="pee"?"💧":"💩";const klabel=tk==="pee"?"おしっこ":"うんち";
    const bm=tk==="poop"&&success&&bristol?bristolMeta(bristol):null;
    const title=`${klabel} ${success?"成功":"失敗"}`+(bm?`・${bm.label}`:"");
    const now=new Date();const time=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    const rec={id:"t"+Date.now(),space:tab,type:"toilet",tkind:tk,success:!!success,bristol:tk==="poop"?(bristol||null):null,title,emoji,date:todayIso,time,createdAt:Date.now()};
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    track("poop_record",{toilet_kind:tk});
    showFlash(t("toast.logged",{emoji,title}));
  };
  const removeToilet=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // うんちの傾向：直近のブリストルスコアが極端（1-2硬い/6-7ゆるい）に偏っていれば受診の目安を出す。
  const poopTrend=useMemo(()=>{
    const rs=items.filter(x=>x.space===tab&&x.type==="toilet"&&x.tkind==="poop"&&x.bristol).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)).slice(0,3);
    if(rs.length<3)return null;
    if(rs.every(r=>r.bristol>=6))return{txt:t("toilet.trendLoose"),tone:"loose"};
    if(rs.every(r=>r.bristol<=2))return{txt:t("toilet.trendHard"),tone:"hard"};
    return null;
  },[items,tab,t]);
  // トイレ成功率：現在のメンバーの、期間内(7/14/30日)の成功/合計をおしっこ・うんち別に集計。
  const toiletStats=useMemo(()=>{
    const mk=(days)=>{const from=plusDays(-(days-1));const recs=items.filter(x=>x.space===tab&&x.type==="toilet"&&x.date&&x.date>=from);
      const calc=(k)=>{const r=recs.filter(x=>x.tkind===k);const s=r.filter(x=>x.success).length;const br=r.filter(x=>x.bristol).map(x=>x.bristol);const avg=br.length?Math.round(br.reduce((a,b)=>a+b,0)/br.length*10)/10:null;return{total:r.length,success:s,rate:r.length?Math.round(s/r.length*100):null,avgBristol:avg,brCount:br.length};};
      return{pee:calc("pee"),poop:calc("poop"),total:recs.length};};
    return{7:mk(7),14:mk(14),30:mk(30)};
  },[items,tab,todayIso]);
  const hasToilet=useMemo(()=>items.some(x=>x.space===tab&&x.type==="toilet"),[items,tab]);
  // 獣医さん用サマリー：対象メンバーの、期間内の体重・トイレ・症状・予防/お世話をまとめる。
  const vetSummary=useMemo(()=>{
    if(!activeMember)return null;
    const sp=activeMember.id;const from=plusDays(-(vetDays-1));
    const inRange=(d)=>d&&d>=from&&d<=todayIso;
    const toilets=items.filter(x=>x.space===sp&&x.type==="toilet"&&inRange(x.date));
    const trate=(k)=>{const r=toilets.filter(x=>x.tkind===k);const s=r.filter(x=>x.success).length;return{total:r.length,rate:r.length?Math.round(s/r.length*100):null};};
    const br=toilets.filter(x=>x.tkind==="poop"&&x.bristol).map(x=>x.bristol);
    const brAvg=br.length?Math.round(br.reduce((a,b)=>a+b,0)/br.length*10)/10:null;
    const healths=items.filter(x=>x.space===sp&&x.type==="health"&&x.weight!=null&&inRange(x.date)).sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    const wLatest=healths.length?healths[healths.length-1]:null;const wFirst=healths.length?healths[0]:null;
    const wSeries=healths.map(h=>({value:h.weight,date:h.date}));
    const wUnit=wLatest?(wLatest.wunit||"kg"):"kg";
    const syms={};items.filter(x=>x.space===sp&&x.type==="diary"&&inRange(x.date)).forEach(r=>(r.symptoms||[]).forEach(s=>{syms[s]=(syms[s]||0)+1;}));
    const symList=Object.keys(syms).map(k=>({k,label:lblOf(symptomMeta(k))||k,n:syms[k]})).sort((a,b)=>b.n-a.n);
    // 元気（5段階）の平均：日々の記録と連動した体調の傾向
    const ens=items.filter(x=>x.space===sp&&x.type==="diary"&&inRange(x.date)&&x.energy).map(r=>{const em=DIARY_ENERGY.find(e=>e.key===r.energy);return em?em.score:null;}).filter(v=>v!=null);
    const energyAvg=ens.length?Math.round(ens.reduce((a,b)=>a+b,0)/ens.length*10)/10:null;
    const careNext=items.filter(x=>x.space===sp&&x.type==="care"&&x.dueDate&&!x.done).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,8).map(x=>({title:x.title,date:x.dueDate,emoji:x.emoji||"💉"}));
    const chores=items.filter(x=>x.space===sp&&x.type==="chore"&&x.lastDone).sort((a,b)=>(b.lastDone||"").localeCompare(a.lastDone||"")).slice(0,8).map(x=>({title:x.title,date:x.lastDone,emoji:x.emoji||"🧹"}));
    return{from,to:todayIso,pee:trate("pee"),poop:trate("poop"),brAvg,brCount:br.length,wLatest,wFirst,wSeries,wUnit,symList,energyAvg,energyN:ens.length,careNext,chores};
  },[items,activeMember,vetDays,todayIso]);
  // お世話ログの実施日（前回やった日）を後から修正。履歴の最新分を置き換え、最新日をlastDoneに。
  const saveChoreDate=(id,newDate)=>{
    if(!newDate){setChoreDateEdit(null);return;}
    const next=items.map(x=>{if(x.id!==id)return x;const rest=(x.history||[]).slice(1);const hist=[...new Set([newDate,...rest])].sort((a,b)=>b.localeCompare(a)).slice(0,30);return{...x,history:hist,lastDone:hist[0]||newDate};});
    persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});
    setChoreDateEdit(null);showFlash(t("toast.dateFixed"));
  };
  // 全メンバーの「そろそろ/切れた」ストック（ホーム表示用）
  const lowSupplies=useMemo(()=>items.filter(x=>x.type==="supply").map(x=>({item:x,st:supplyStatus(x)})).filter(o=>o.st&&o.st.tone!=="ok"),[items]);
  // 「買い足すもの」を一元化：②消耗品(日数サイクル)＋①予防薬などの在庫(care.stock・回数)をまとめて urgency 順に。
  // ③お薬コース(medcourse)は"服薬"なので含めない（毎日タブで管理）。データ構造は変えず表示だけ集約。
  const restockList=useMemo(()=>{
    const out=[];
    lowSupplies.forEach(({item,st})=>out.push({id:item.id,item,kind:"supply",tone:st.tone,left:st.left,line:supplyLine(item)}));
    items.filter(x=>x.type==="care"&&typeof x.stock==="number"&&x.stock<=1&&!x.done).forEach(x=>out.push({id:x.id,item:x,kind:"care",tone:x.stock<=0?"out":"low",left:x.stock,line:x.stock<=0?t("supply.careOut"):t("supply.careLow",{n:x.stock})}));
    return out.sort((a,b)=>{const ta=a.tone==="out"?0:1,tb=b.tone==="out"?0:1;return ta-tb||((a.left??999)-(b.left??999));});
  },[lowSupplies,items,t]);
  // ホームの支出サマリー（安心の場：総額＋メンバー別簡易比較＋急増のみ。詳細一覧は出さない）
  const homeExpense=useMemo(()=>{
    const ym=todayIso.slice(0,7);const pm=new Date(Number(ym.slice(0,4)),Number(ym.slice(5))-2,1);const prevYm=`${pm.getFullYear()}-${String(pm.getMonth()+1).padStart(2,"0")}`;
    const exp=items.filter(x=>x.type==="expense");
    let total=0;const cur={},prev={};
    exp.forEach(x=>{const m=(x.date||"").slice(0,7);const a=Number(x.amount)||0;if(m===ym){total+=a;cur[x.space]=(cur[x.space]||0)+a;}else if(m===prevYm){prev[x.space]=(prev[x.space]||0)+a;}});
    const rows=Object.keys(cur).map(sp=>{const c=cur[sp],p=prev[sp]||0;const spike=p>0&&c>=p*1.5&&(c-p)>=2000;return{space:sp,name:nameOf(sp),amount:c,spike};}).sort((a,b)=>b.amount-a.amount);
    return{total,rows,ym};
  },[items,todayIso]);

  // Last date per care kind for active member
  const lastDates=useMemo(()=>{
    if(!activeMember)return{};
    const mi=items.filter(x=>x.space===activeMember.id&&x.dueDate);
    const res={};
    careKindsFor(activeMember).forEach(k=>{
      const ki=mi.filter(x=>x.careKind===k.key);
      if(ki.length>0)res[k.key]=ki.sort((a,b)=>b.dueDate.localeCompare(a.dueDate))[0];
    });
    return res;
  },[items,activeMember]);

  const visible=useMemo(()=>{let arr=items.filter(x=>x.space===tab&&x.type!=="routine"&&x.type!=="supply"&&x.type!=="memory"&&x.type!=="bday"&&x.type!=="health"&&x.type!=="diary"&&x.type!=="expense"&&x.type!=="card"&&x.type!=="belonging"&&x.type!=="chore"&&x.type!=="toilet"&&x.type!=="feed"&&x.type!=="nursing"&&x.type!=="walk");if(filter!=="all")arr=arr.filter(x=>isMemberTab?x.careKind===filter:x.type===filter);arr=[...arr].sort((a,b)=>{const ao=a.order,bo=b.order;if(ao!=null&&bo!=null&&ao!==bo)return ao-bo;if(ao!=null&&bo==null)return -1;if(ao==null&&bo!=null)return 1;if(!a.dueDate&&!b.dueDate)return b.createdAt-a.createdAt;if(!a.dueDate)return 1;if(!b.dueDate)return -1;return a.dueDate.localeCompare(b.dueDate);});return arr.sort((a,b)=>a.done===b.done?0:a.done?1:-1);},[items,tab,filter,isMemberTab]);
  // 並び替え：長押し（モバイル）/ドラッグ（PC）で D&D。未完了タスクの並びだけ order に反映。
  const dndSensors=useSensors(
    useSensor(MouseSensor,{activationConstraint:{distance:6}}),
    useSensor(TouchSensor,{activationConstraint:{delay:250,tolerance:8}})
  );
  const onCardDragEnd=(e)=>{
    const{active,over}=e;if(!over||active.id===over.id)return;
    const ids=visible.filter(x=>!x.done).map(x=>x.id);
    const oldI=ids.indexOf(active.id),newI=ids.indexOf(over.id);
    if(oldI<0||newI<0)return;
    const arr=arrayMove(ids,oldI,newI);
    const orderMap={};arr.forEach((id,i)=>{orderMap[id]=i;});
    const next=items.map(x=>orderMap[x.id]!=null?{...x,order:orderMap[x.id]}:x);
    persist(members,next);
    arr.forEach(id=>{const u=next.find(y=>y.id===id);if(u)saveItemToFs(u).catch(()=>{});});
  };
  // 大項目セクションの並び替え（タブ単位）。順序は localStorage に保存。
  const reorderSec=(seg,e)=>{const{active,over}=e;if(!over||active.id===over.id)return;setSecOrder(prev=>{const cur=prev[seg]||[];const oi=cur.indexOf(active.id),ni=cur.indexOf(over.id);if(oi<0||ni<0)return prev;const next={...prev,[seg]:arrayMove(cur,oi,ni)};try{localStorage.setItem("loalife-secorder-v2",JSON.stringify(next));}catch(_){}return next;});};
  const renderSecs=(seg,defs)=>{
    const order=secOrder[seg]||[];
    const od=[...defs].sort((a,b)=>{const ia=order.indexOf(a.key),ib=order.indexOf(b.key);return(ia<0?99:ia)-(ib<0?99:ib);});
    if(od.length===0)return null;
    return(
      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={(e)=>reorderSec(seg,e)}>
        <SortableContext items={od.map(d=>d.key)} strategy={verticalListSortingStrategy}>
          {od.map(d=><SortableSection key={d.key} id={d.key}>{d.el}</SortableSection>)}
        </SortableContext>
      </DndContext>
    );
  };
  const filterChips=useMemo(()=>{const all={key:"all",label:t("filter.all")};if(isMemberTab)return[all,...careKindsFor(activeMember).map(k=>({key:k.key,label:careLabel(k)}))];return[all,...ME_TYPES.map(k=>({key:k,label:lblOf(TYPE_META[k])}))];},[tab,isMemberTab,lang]);
  // 絞り込みチップは中身がある時だけ出す（空なら押しても変わらず不要なので隠す。追加は右下＋）
  const hasListItems=useMemo(()=>items.some(x=>x.space===tab&&x.type!=="routine"&&x.type!=="supply"&&x.type!=="memory"&&x.type!=="bday"&&x.type!=="health"&&x.type!=="diary"&&x.type!=="expense"&&x.type!=="card"&&x.type!=="belonging"&&x.type!=="chore"&&x.type!=="toilet"&&x.type!=="feed"&&x.type!=="nursing"&&x.type!=="walk"),[items,tab]);
  const suggestions=useMemo(()=>{const prefix=tab+" ";return Object.entries(usage).filter(([k,c])=>k.startsWith(prefix)&&c>=2).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k.slice(prefix.length));},[usage,tab]);
  // 1件分のカード中身（D&D用に <li> から分離）。並び替えボタンは廃止し長押し/ドラッグへ。
  const cardInner=(it)=>{
    let meta,label;
    if(isMemberTab){meta=KIND_STYLE[activeMember.kind];label=careLabel(careKindsFor(activeMember).find(k=>k.key===it.careKind))||t("care.fallback");}
    else{meta=TYPE_META[it.type]||TYPE_META.dream;label=lblOf(meta);}
    const ds=dueStatus(it);
    // 会員タブのケアは3状態バッジ（未対応/予定済み/完了）で状態を1目に。それ以外は従来の期日チップ。
    const isCare=isMemberTab&&it.type==="care";
    const cst=isCare?careState(it):null;
    const actionable=isCare&&!it.done&&it.dueDate&&daysUntil(it.dueDate)<=0; // 期限切れ/今日＝その場でワンタップ解消
    return(<>
      {isCare?<span className="yl-bubble" style={{background:meta.bg,color:meta.fg}}><Icon name={careIcon(it.careKind)} size={22}/></span>:<span className="yl-bubble" style={{background:meta.bg,color:meta.fg}}><Icon name={guessIcon(it.title,TYPE_ICON[it.type]||"sparkles")} size={22}/></span>}
      <div className="yl-body" onClick={()=>openEdit(it)}>
        <div className="yl-row1"><span className="yl-badge" style={{background:meta.bg,color:meta.fg}}>{label}</span><span className="yl-text">{it.title}</span></div>
        {(ds||cst||it.time||it.reminders||it.type==="care"||(it.repeat&&it.repeat!=="none"))&&(
          <div className="yl-meta">
            {cst?<span className={"yl-cstate "+cst.tone}>{cst.label}</span>:ds&&<span className={"yl-due "+ds.tone}>{ds.label}</span>}
            {it.time&&<span className="yl-time"><Icon name="clock" size={12}/> {it.time}</span>}
            {isCare&&isRenewCare(it)&&it.lastDone&&<span className="yl-repeat"><Icon name="syringe" size={12}/> 実施 {fmtDate(it.lastDone)}</span>}
            {isCare&&typeof it.stock==="number"&&<span className={"yl-repeat"+(it.stock<=1?" yl-stock-low":"")}><Icon name="pill" size={12}/> 在庫あと{it.stock}回</span>}
            {it.repeat&&it.repeat!=="none"&&<span className="yl-repeat"><Icon name="repeat" size={12}/> {REPEATS.find(r=>r.key===it.repeat)?.label}</span>}
            {it.reminders&&it.reminders.length>0&&<span className="yl-notif-badge"><Icon name="bell" size={12}/> {it.reminders.length<=2?it.reminders.map(reminderLabel).join("・"):it.reminders.length+"件"}</span>}
            {actionable&&<button className="yl-resolve" onClick={e=>{e.stopPropagation();toggle(it.id);}} title="記録すると次回予定へ自動で進みます">✓ 完了にして次回へ</button>}
            {!isCare&&!it.done&&it.dueDate&&daysUntil(it.dueDate)<=0&&<button className="yl-snooze" onClick={e=>{e.stopPropagation();snooze(it.id);}}>→ 明日へ</button>}
            {it.type==="care"&&<button className="yl-prev-copy" onClick={e=>{e.stopPropagation();openQuickCopy(it);}} title="前回と同じ内容で追加">↩ 前回コピー</button>}
            {it.dueDate&&<button className="yl-cal-item" onClick={e=>{e.stopPropagation();setCalPicker({item:it});}} title="カレンダーに追加"><Icon name="calendar" size={14}/></button>}
            {it.type==="care"&&(it.photo?<button className="yl-photo" onClick={e=>{e.stopPropagation();viewPhoto(firstPhotoId(it));}}><Icon name="camera" size={14}/> 証明書</button>:<label className="yl-photo add" onClick={e=>e.stopPropagation()}><Icon name="camera" size={14}/> 証明書を追加<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>onFilePicked(e,it.id)}/></label>)}
          </div>
        )}
        {(it.place||it.url||it.memo)&&(
          <div className="yl-detailrow">
            {it.place&&<button className="yl-detail-chip" onClick={e=>{e.stopPropagation();openMap(it.place);}} title="地図で開く"><Icon name="pin" size={12}/> {it.place}</button>}
            {it.url&&<button className="yl-detail-chip" onClick={e=>{e.stopPropagation();openUrl(it.url);}} title={it.url}><Icon name="link" size={12}/> リンクを開く</button>}
            {it.memo&&<span className="yl-detail-memotxt"><Icon name="note" size={12}/> {it.memo}</span>}
          </div>
        )}
        {Array.isArray(it.checklist)&&it.checklist.length>0&&(
          <div className="yl-clist-view" onClick={e=>e.stopPropagation()}>
            <span className="yl-clist-prog"><Icon name="check" size={12}/> 持ち物 {it.checklist.filter(c=>c.done).length}/{it.checklist.length}</span>
            <ul className="yl-clist compact">
              {it.checklist.map(c=>(
                <li key={c.id} className="yl-clist-item">
                  <button type="button" className={"yl-clist-box"+(c.done?" on":"")} onClick={()=>toggleChecklistItem(it.id,c.id)} aria-label="チェック"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                  <span className={"yl-clist-text"+(c.done?" done":"")}>{c.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <button className={"yl-check"+(it.done?" on":"")} onClick={()=>toggle(it.id)} onPointerDown={e=>e.stopPropagation()} aria-label="完了"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
      <button className="yl-del" onClick={e=>{e.stopPropagation();askDelete(it.title,()=>remove(it.id));}} onPointerDown={e=>e.stopPropagation()} aria-label="削除">×</button>
    </>);
  };
  const meItems=items.filter(x=>x.space==="me"&&x.type!=="bday"); // 誕生日(繰り返し)はメーターに数えない
  const doneCount=meItems.filter(x=>x.done).length;
  const pct=meItems.length?Math.round((doneCount/meItems.length)*100):0;
  // 友達の誕生日・記念日を追加（毎年くりかえし。わくわくメーターには数えない）
  const addFriendBday=()=>{
    const t=friendBdayName.trim();if(!t||!friendBdayDate)return;
    const item={id:"b"+Date.now(),space:"me",type:"bday",title:t,emoji:guessEmoji(t,"🎂"),birthday:friendBdayDate,createdAt:Date.now()};
    persist(members,[...items,item]);
    setFriendBdayName("");setFriendBdayDate("");
    showFlash("追加しました 🎂");
  };
  // 「もうすぐ・楽しみ」：自分の誕生日記念日＋予定（日付あり）を近い順に
  const meUpcoming=useMemo(()=>{
    const list=[];
    items.forEach(x=>{
      if(x.space!=="me")return;
      if(x.type==="bday"&&x.birthday){const d=daysUntilAnniv(x.birthday);if(d!==null&&d<=60)list.push({id:x.id,emoji:x.emoji||"🎂",title:x.title,daysUntil:d,kind:"bday"});}
      else if(!x.done&&x.dueDate){const d=daysUntil(x.dueDate);if(d!==null&&d>=0&&d<=60)list.push({id:x.id,emoji:x.emoji||"📅",title:x.title,daysUntil:d,kind:"event"});}
    });
    return list.sort((a,b)=>a.daysUntil-b.daysUntil);
  },[items]);
  const memberStats=useMemo(()=>{if(!isMemberTab)return null;const arr=items.filter(x=>x.space===tab&&!x.done);let soon=0,over=0;arr.forEach(x=>{if(isOverdue(x)){over++;return;}const d=daysUntil(x.dueDate);if(d!==null&&d>=0&&d<=7)soon++;});return{soon,over};},[items,tab,isMemberTab]);
  const emojiSet=newKind==="person"?PERSON_EMOJIS:petEmojisFor(newSpecies);
  const spaces=useMemo(()=>[{id:"me",name:meName||"わたし",emoji:meEmoji,avatar:meAvatar||"",kind:"me"},...members],[members,meEmoji,meName,meAvatar]);
  // 「わたし（自分）」を実際に使っているか。ペットだけ登録した人には空の自分を出さない（家族のようす等）。
  const meUsed=useMemo(()=>!!(meBirthday||meAvatar||(meName&&meName.trim())||items.some(x=>x.space==="me")),[meBirthday,meAvatar,meName,items]);
  // ホームの「家族のようす」「今日の調子」用：自分が未使用なら除外
  const homeSpaces=useMemo(()=>meUsed?spaces:spaces.filter(s=>s.id!=="me"),[spaces,meUsed]);
  // フォルダ分け（多頭飼い）：未分類を先頭、その後グループ順
  const groupedMembers=useMemo(()=>{const order=[];const map={};members.forEach(m=>{const g=m.group||"";if(!(g in map)){map[g]=[];order.push(g);}map[g].push(m);});order.sort((a,b)=>a===""?-1:b===""?1:0);return order.map(g=>({group:g,members:map[g]}));},[members]);
  // スペース（自分/メンバー）の色（カレンダーの色別管理。自分で選べる）
  // 登録ユーザーごとの固定色を一元管理。フィルターチップ・カレンダーのドット・
  // メンバーバー等すべてがこの関数を参照する（色定義は MEMBER_COLORS 1箇所）。
  // 明示的に色を選んでいればそれを、未設定なら登録順で MEMBER_COLORS を安定割り当て。
  const colorIndex=useMemo(()=>{const map={me:0};let i=1;members.forEach(m=>{map[m.id]=i++;});return map;},[members]);
  const colorOf=useCallback((spaceId)=>{
    if(spaceId==="me")return meColor||MEMBER_COLORS[0];
    const m=members.find(x=>x.id===spaceId);
    if(m&&m.color)return m.color;
    const idx=colorIndex[spaceId];
    return MEMBER_COLORS[(idx==null?0:idx)%MEMBER_COLORS.length];
  },[members,meColor,colorIndex]);
  const setMemberColor=(c)=>{if(!activeMember)return;const next=members.map(m=>m.id===activeMember.id?{...m,color:c}:m);persist(next,items);const upd=next.find(m=>m.id===activeMember.id);if(upd)saveMemberToFs(upd).catch(()=>{});};
  const statusFor=(spaceId)=>{const arr=items.filter(x=>x.space===spaceId&&!x.done&&x.dueDate);let over=0,next=null,nextDays=Infinity;arr.forEach(x=>{const d=daysUntil(x.dueDate);if(isOverdue(x))over++;else if(d>=0&&d<nextDays){nextDays=d;next=x;}});return{over,next,nextDays};};
  const todayList=useMemo(()=>items.filter(x=>!x.done&&x.dueDate&&daysUntil(x.dueDate)<=0).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)),[items]);
  const summary=useMemo(()=>({dreams:items.filter(x=>x.type==="dream"&&x.done).length,careOverdue:items.filter(x=>x.type==="care"&&isOverdue(x)).length,family:members.length}),[items,members]);

  // --- カレンダー（ライフログ）の集計 ---
  const calSpaceItems=useMemo(()=>items.filter(x=>calFilter==="all"||x.space===calFilter),[items,calFilter]);
  const annivAll=useMemo(()=>{
    const list=[];
    members.forEach(m=>{if(m.birthday)list.push({mmdd:mmdd(m.birthday),emoji:m.emoji,label:`${m.name}の誕生日`,space:m.id});if(m.gotchaDay)list.push({mmdd:mmdd(m.gotchaDay),emoji:"🎉",label:`${m.name} うちの子記念日`,space:m.id});});
    if(meBirthday)list.push({mmdd:mmdd(meBirthday),emoji:meEmoji,label:"わたしの誕生日",space:"me"});
    items.forEach(x=>{if(x.type==="bday"&&x.birthday)list.push({mmdd:mmdd(x.birthday),emoji:x.emoji||"🎂",label:x.title,space:"me"});});
    return list;
  },[members,meBirthday,meEmoji,items]);
  const annivOn=(dateIso)=>{const md=mmdd(dateIso);return annivAll.filter(a=>a.mmdd===md&&(calFilter==="all"||a.space===calFilter));};
  // お世話ログ（chore）の実施履歴をカレンダーに反映：日付→[{space,title,emoji}]
  const choreEventsAll=useMemo(()=>{const map={};items.forEach(x=>{if(x.type!=="chore")return;(x.history||[]).forEach(d=>{if(!d)return;(map[d]=map[d]||[]).push({space:x.space,title:x.title,emoji:x.emoji||"🧹"});});});return map;},[items]);
  const choreOn=(dateIso)=>{const arr=choreEventsAll[dateIso]||[];return calFilter==="all"?arr:arr.filter(e=>e.space===calFilter);};
  const calGrid=useMemo(()=>{
    const{y,m}=calCursor;
    const startDow=new Date(y,m,1).getDay();
    const daysInMonth=new Date(y,m+1,0).getDate();
    const cells=[];
    for(let i=0;i<startDow;i++)cells.push(null);
    for(let d=1;d<=daysInMonth;d++){
      const dIso=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const di=calSpaceItems.filter(x=>itemDate(x)===dIso);
      const ch=choreOn(dIso);
      const an=annivOn(dIso);
      // 全カテゴリの項目を1件=1ドットで、該当ユーザー色で並べる（カテゴリで表示差はつけない）
      const dots=[...di.map(x=>colorOf(x.space)),...ch.map(e=>colorOf(e.space)),...an.map(a=>colorOf(a.space))];
      cells.push({d,iso:dIso,count:dots.length,dots});
    }
    while(cells.length%7!==0)cells.push(null);
    return cells;
  },[calCursor,calSpaceItems,annivAll,choreEventsAll,calFilter,colorOf]);
  const dayTimeline=useMemo(()=>{
    if(!calDay)return[];
    const list=calSpaceItems.filter(x=>itemDate(x)===calDay).map(x=>({item:x,time:x.time||""}));
    const anniv=annivOn(calDay).map(a=>({anniv:a,time:""}));
    const chore=choreOn(calDay).map(c=>({chore:c,time:""}));
    return[...anniv,...chore,...list].sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));
  },[calDay,calSpaceItems,annivAll,choreEventsAll,calFilter]);
  // 思い出アルバム（全スペース・新しい順）。タグで絞り込み可能
  const albumAll=useMemo(()=>items.filter(x=>x.type==="memory").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)),[items]);
  const albumTags=useMemo(()=>{const set=[];albumAll.forEach(m=>(m.tags||[]).forEach(t=>{if(t&&!set.includes(t))set.push(t);}));return set;},[albumAll]);
  const albumItems=useMemo(()=>albumTag?albumAll.filter(m=>(m.tags||[]).includes(albumTag)):albumAll,[albumAll,albumTag]);
  const monthLabel=lang==="ja"?`${calCursor.y}年${calCursor.m+1}月`:(()=>{try{return new Intl.DateTimeFormat(LOCALES[lang]||"en-US",{year:"numeric",month:"long"}).format(new Date(calCursor.y,calCursor.m,1));}catch(e){return `${calCursor.y}/${calCursor.m+1}`;}})();
  const weekdaysShort=useMemo(()=>{if(lang==="ja")return WEEKDAYS_JA;try{const a=[];for(let i=0;i<7;i++)a.push(new Intl.DateTimeFormat(LOCALES[lang]||"en-US",{weekday:"short"}).format(new Date(2023,0,1+i)));return a;}catch(e){return WEEKDAYS_JA;}},[lang]);
  const moveMonth=(delta)=>setCalCursor(c=>{const d=new Date(c.y,c.m+delta,1);return{y:d.getFullYear(),m:d.getMonth()};});

  // もうすぐの記念日：誕生日＋うちの子記念日（ペット）を7日以内で集約
  const upcomingAnniv=useMemo(()=>{
    const list=[];
    const add=(id,name,emoji,date,kind)=>{const dd=daysUntilAnniv(date);if(dd!==null&&dd<=7)list.push({key:id+":"+kind,name,emoji,date,kind,daysUntil:dd,years:yearsSinceAnniv(date)});};
    members.forEach(m=>{if(m.birthday)add(m.id,m.name,m.emoji,m.birthday,"birthday");if(m.gotchaDay)add(m.id,m.name,m.emoji,m.gotchaDay,"gotcha");});
    if(meBirthday)add("me","わたし",meEmoji,meBirthday,"birthday");
    items.forEach(x=>{if(x.space==="me"&&x.type==="bday"&&x.birthday)add(x.id,x.title,x.emoji||"🎂",x.birthday,"self");});
    return list.sort((a,b)=>a.daysUntil-b.daysUntil);
  },[members,meBirthday,meEmoji,items]);

  // 今日の「大切な日」＝ホームでお祝いする対象。今は誕生日（本人・家族・ペット・自分の登録誕生日）のみ。
  // upcomingAnniv の kind でイベント種別を持たせてあるので、将来「お迎え記念日」「ワクチン記念日」等へ
  // ここの filter を広げるだけで拡張できる（gotcha 等は既に kind として存在）。
  const todayBirthdays=useMemo(()=>upcomingAnniv.filter(a=>a.daysUntil===0&&(a.kind==="birthday"||a.kind==="self")),[upcomingAnniv]);
  // お祝いカードに出した誕生日は下の「もうすぐ」一覧から除いて重複を避ける（記念日など他は残す）。
  const upcomingAnnivRest=useMemo(()=>upcomingAnniv.filter(a=>!(a.daysUntil===0&&(a.kind==="birthday"||a.kind==="self"))),[upcomingAnniv]);

  const showNotifBanner=notifSupported&&notifPerm==="default";
  const hasReminders=items.some(x=>x.reminders?.length);

  // Grouped dashboard: items due within 7 days (or overdue), grouped by person
  const groupedDashboard=useMemo(()=>{
    const relevant=items.filter(x=>{
      if(!x.dueDate||x.done)return false;
      const d=daysUntil(x.dueDate);
      return d!==null&&d<=7;
    }).sort((a,b)=>(daysUntil(a.dueDate)||0)-(daysUntil(b.dueDate)||0));
    return spaces.map(s=>({space:s,items:relevant.filter(x=>x.space===s.id)})).filter(g=>g.items.length>0);
  },[items,spaces]);

  // --- ホーム再設計用の集計 ---
  // ③ 直近の"爆弾"（放置するとヤバいもの）と ① 今日やること（最大3件）
  const homeData=useMemo(()=>{
    const live=items.filter(x=>!memorialIds.has(x.space)); // 追悼モードの子は「今日やること」等から除外
    const bombs=[];
    live.forEach(x=>{
      if(x.done||!x.dueDate)return;
      const d=daysUntil(x.dueDate);
      const isHigh=x.careKind&&HIGH_KINDS.has(x.careKind);          // ワクチン・薬・通院など
      const isBigEvent=x.type==="event"||x.careKind==="event"||x.careKind==="school";
      // 直近(0〜7日)は出す。期限切れ(d<0)は「周期あり」のみ（単発の過ぎた予定は赤にしない）
      if((isHigh&&d<=7&&(d>=0||isCyclic(x)))||(isBigEvent&&d>=0&&d<=2))bombs.push({item:x,d});
    });
    bombs.sort((a,b)=>a.d-b.d);
    const bombSet=new Set(bombs.map(b=>b.item.id));
    // ① 今日やること：今日=今日だけ（今日のケア/予定＋未完了の今日のルーティン）。未来は混ぜない。
    const todos=[];
    live.forEach(x=>{
      if(x.done)return;
      if(x.type==="routine"){if(x.doneDate!==todayIso)todos.push({key:x.id,emoji:x.emoji||"⏰",title:x.title,space:x.space,time:x.time,tag:x.time||"今日",pri:2});return;}
      if(x.dueDate&&!bombSet.has(x.id)){const d=daysUntil(x.dueDate);if(d<=0)todos.push({key:x.id,emoji:x.emoji||"•",title:x.title,space:x.space,time:x.time,tag:d<0?"やり残し":"今日",pri:d<0?0:1});}
    });
    todos.sort((a,b)=>a.pri-b.pri||((a.time||"99")<(b.time||"99")?-1:1));
    // 直近の予定（明日〜7日・爆弾/ルーティン除く）は別枠で薄く表示。今日リストには混ぜない。
    const upcoming=[];
    live.forEach(x=>{if(x.done||!x.dueDate||bombSet.has(x.id)||x.type==="routine")return;const d=daysUntil(x.dueDate);const annual=x.careKind&&RENEW_KINDS.has(x.careKind)&&effRepeat(x)==="yearly";const win=annual?30:7;if(d>=1&&d<=win)upcoming.push({key:x.id,emoji:x.emoji||"•",title:x.title,space:x.space,d,tag:d===1?"明日":`あと${d}日${annual?"で期限":""}`});});
    upcoming.sort((a,b)=>a.d-b.d);
    return{bombs,todos,upcoming};
  },[items,todayIso,memorialIds]);

  // 今日やることを「誰の」でまとめる（横断表示）。自分→登録メンバー順。既存の space をそのまま利用。
  const todayByMember=useMemo(()=>{
    const groups={};
    homeData.todos.forEach(t=>{(groups[t.space]=groups[t.space]||[]).push(t);});
    const order=["me",...members.map(m=>m.id)];
    return order.filter(sp=>groups[sp]&&groups[sp].length).map(sp=>({space:sp,av:spaces.find(s=>s.id===sp)||null,name:nameOf(sp)||"わたし",todos:groups[sp]}));
  },[homeData.todos,members,spaces]);
  // 完了：タスク種別に応じて既存ハンドラへ振り分け（ルーティン=doneDate／お世話=履歴／ケア・予定=記録・完了）。
  const completeHomeTask=(id)=>{const it=items.find(x=>x.id===id);if(!it)return;if(it.type==="routine")toggleRoutine(id);else if(it.type==="chore")logChore(id);else toggle(id);};
  // 「1年前の今日」：過去の同じ月日の思い出を、そっと振り返る（全メンバー横断・年数が近い順）。
  const onThisDay=useMemo(()=>{
    const curY=new Date().getFullYear();const md=mmdd(todayIso);
    const list=[];
    items.forEach(x=>{if(x.type!=="memory"||!x.date||x.date.length<10||mmdd(x.date)!==md)return;const yy=parseInt(x.date.slice(0,4),10);if(!yy||yy>=curY)return;list.push({item:x,yearsAgo:curY-yy});});
    list.sort((a,b)=>a.yearsAgo-b.yearsAgo||(b.item.createdAt||0)-(a.item.createdAt||0));
    return list;
  },[items,todayIso]);

  // ── 「今日のLOALIFE」：蓄積データから“気づき”を生成。日付ベースのリマインドは通常ロジック、
  //    意味を抽出する部分（気づき・提案）は生成関数を分離し、将来AIに差し替えやすくしている。
  const notices=useMemo(()=>{
    const out=[];
    const petsLive=members.filter(m=>m.kind==="pet"&&!m.memorial);
    const dogs=petsLive.filter(m=>m.species==="dog");
    const nm=(sp)=>nameOf(sp)||"わたし";
    // 🔴 予定・リマインド：期限が近い/今日/超過（homeData 由来。重複はIDで排除）
    homeData.bombs.forEach(({item,d})=>{
      out.push({id:`todo:${item.id}:${item.dueDate}`,cat:"todo",title:d<0?`「${item.title}」の期限が過ぎています`:d===0?`今日は「${item.title}」の日です`:`もうすぐ「${item.title}」（あと${d}日）`,body:nm(item.space),actionLabel:"記録する",go:()=>{setTab(item.space);setPersonSeg("record");}});
    });
    homeData.upcoming.forEach(u=>{ if(u.d>7) out.push({id:`todo:${u.key}:up`,cat:"todo",title:`${u.title}（${u.tag}）`,body:nm(u.space),actionLabel:"確認する",go:()=>{setTab(u.space);setPersonSeg("record");}}); });
    // 🔴 お薬・予防薬の在庫が残りわずか（買い足しのめやす）
    items.forEach(x=>{ if(x.type==="care"&&typeof x.stock==="number"&&x.stock<=1&&!x.done) out.push({id:`todo:stock:${x.id}:${x.stock}`,cat:"todo",title:x.stock<=0?`「${x.title}」の在庫がなくなりました`:`「${x.title}」の在庫が残り1回分`,body:`${nm(x.space)}・買い足しのタイミングです`,actionLabel:"確認する",go:()=>{setTab(x.space);setPersonSeg("record");}}); });
    // 🟡 気づき：お散歩時間が短くなった（犬・十分な履歴がある時だけ、そっと。断定はしない）
    dogs.forEach(dog=>{
      const walks=items.filter(x=>x.type==="walk"&&x.space===dog.id&&x.durationSec>0).sort((a,b)=>(b.start||0)-(a.start||0));
      if(walks.length>=6){
        const avg=a=>a.reduce((s,w)=>s+w.durationSec,0)/a.length;
        const r=avg(walks.slice(0,3)),p=avg(walks.slice(3,6));
        if(p>0&&r<p*0.72) out.push({id:`insight:walk:${dog.id}:${todayIso.slice(0,7)}`,cat:"insight",title:"最近、お散歩の時間が少し短めです",body:`${dog.name}の直近のお散歩が、以前より短くなっているみたい`,actionLabel:"散歩記録を見る",go:()=>{setTab(dog.id);setPersonSeg("record");}});
      }
    });
    // 🟡 気づき：しばらく記録がない（履歴のある子だけ・7〜30日）
    petsLive.forEach(m=>{
      const recs=items.filter(x=>x.space===m.id&&(x.type==="health"||x.type==="diary"||x.type==="walk"||x.type==="chore"||x.type==="feed"||x.type==="toilet"));
      if(recs.length>=3){
        let last="";recs.forEach(x=>{const d=x.date||x.lastDone||(x.start?iso(new Date(x.start)):"")||"";if(d>last)last=d;});
        if(last){const gap=-daysUntil(last);if(gap>=7&&gap<=30) out.push({id:`insight:quiet:${m.id}:${last}`,cat:"insight",title:`${m.name}の記録が${gap}日ぶり`,body:"元気にしてるかな？ ひとことでも残しておくと、あとで振り返れます",actionLabel:"記録する",go:()=>{setTab(m.id);setPersonSeg("record");}});}
      }
    });
    // 🟡 気づき：子ども・自分（今回の記録データを活用。断定・診断はしない）
    const avgN=a=>a.reduce((s,n)=>s+n,0)/a.length;
    const persons=[...members.filter(m=>m.kind==="person"),{id:"me",name:meName||"わたし",kind:"me"}];
    persons.forEach(m=>{
      const drecs=items.filter(x=>x.space===m.id&&x.type==="diary").sort((a,b)=>(b.date||"").localeCompare(a.date||""));
      // 睡眠が以前より短め（十分な記録があるときだけ・そっと）
      const sl=drecs.filter(r=>r.sleep!=null&&r.sleep!=="").map(r=>Number(r.sleep)).filter(n=>!isNaN(n));
      if(sl.length>=6){const r=avgN(sl.slice(0,3)),p=avgN(sl.slice(3,6));if(p>0&&r<p*0.85&&(p-r)>=0.5) out.push({id:`insight:sleep:${m.id}:${todayIso.slice(0,7)}`,cat:"insight",title:"最近、寝る時間の記録が短めです",body:`${m.name}の直近の睡眠が、以前より短くなっているみたい`,actionLabel:"記録を見る",go:()=>{setTab(m.id);setPersonSeg("record");}});}
      // しばらく記録がない（履歴のある対象だけ・7〜30日）
      const recs=items.filter(x=>x.space===m.id&&(x.type==="diary"||x.type==="chore"||x.type==="health"||x.type==="milestone"||x.type==="walk"));
      if(recs.length>=3){let last="";recs.forEach(x=>{const d=x.date||x.lastDone||(x.start?iso(new Date(x.start)):"")||"";if(d>last)last=d;});if(last){const gap=-daysUntil(last);if(gap>=7&&gap<=30) out.push({id:`insight:quiet:${m.id}:${last}`,cat:"insight",title:`${m.name}の記録が${gap}日ぶり`,body:"最近どうかな？ ひとことでも残しておくと、あとで振り返れます",actionLabel:"記録する",go:()=>{setTab(m.id);setPersonSeg("record");}});}}
      // 未完了のやることがたまっている（3件以上）
      const open=items.filter(x=>x.space===m.id&&(x.type==="care"||x.type==="event")&&x.dueDate&&!x.done).length;
      if(open>=3) out.push({id:`insight:tasks:${m.id}:${todayIso}`,cat:"insight",title:`未完了のやることが${open}件`,body:`${m.name}の予定・提出物がたまっています`,actionLabel:"確認する",go:()=>{setTab(m.id);setPersonSeg("record");}});
    });
    // 🟢 今日の提案：天気・気温・季節（犬がいる時だけ・1件）
    if(dogs.length>0){
      let tip=null;
      if(hasWalker&&weather&&!weather.error){
        const rain=(weather.precip>0)||(weather.pop!=null&&weather.pop>=60)||(weather.code!=null&&weather.code>=51);
        if(rain)tip={id:`tip:rain:${todayIso}`,title:"今日は雨模様",body:"おうちで、においあて・かくれんぼなどの知育あそびはいかが？"};
        else if(weather.temp!=null&&weather.temp>=30)tip={id:`tip:heat:${todayIso}`,title:"日中は暑くなりそう",body:"お散歩は朝夕の涼しい時間に。肉球のやけど・熱中症に気をつけて"};
        else if(weather.temp!=null&&weather.temp<=3)tip={id:`tip:cold:${todayIso}`,title:"冷え込む一日",body:"シニアの子は特にあたたかく。短めのお散歩でも大丈夫"};
      }
      if(!tip){const mo=new Date().getMonth()+1;const s=mo<=2||mo===12?"winter":mo<=5?"spring":mo<=8?"summer":"autumn";
        const st={spring:["春はノミ・ダニに注意","暖かくなると活発に。予防のタイミングを確認しておきましょう"],summer:["夏は熱中症に注意","日中の散歩や車内でのお留守番は控えめに。水分もこまめに"],autumn:["秋は換毛の季節","ブラッシングを少し増やすと、抜け毛ケアが楽になります"],winter:["冬は乾燥と冷えに注意","肉球の乾燥ケアや、あたたかい寝床を用意してあげましょう"]}[s];
        tip={id:`tip:season:${s}:${todayIso.slice(0,7)}`,title:st[0],body:st[1]};
      }
      if(tip)out.push({cat:"tip",...tip});
    }
    // 🟡 気づき：体重の変化 → フード量の見直し（3週間以上の間隔で5%以上・断定はしない）
    petsLive.forEach(m=>{
      const ws=items.filter(x=>x.space===m.id&&x.type==="health"&&x.weight!=null&&x.date).sort((a,b)=>a.date.localeCompare(b.date));
      if(ws.length>=2){
        const latest=ws[ws.length-1];let base=null;
        for(let i=ws.length-2;i>=0;i--){if((new Date(latest.date)-new Date(ws[i].date))/86400000>=21){base=ws[i];break;}}
        if(base&&base.weight>0){const diff=(latest.weight-base.weight)/base.weight;if(Math.abs(diff)>=0.05)
          out.push({id:`insight:weight:${m.id}:${latest.date}`,cat:"insight",title:`${m.name}の体重が${diff>0?"増えて":"減って"}います`,body:`${base.weight}kg → ${latest.weight}kg。フード量を見直すタイミングかも`,actionLabel:"体重・フードを見る",go:()=>{setTab(m.id);setPersonSeg("record");}});}
      }
    });
    // 🟡 気づき：やわらかめのうんちが続く（直近5日で3回以上・受診の目安として。診断はしない）
    petsLive.forEach(m=>{
      const recent=items.filter(x=>x.space===m.id&&x.type==="toilet"&&x.tkind==="poop"&&x.bristol!=null&&x.date&&(-daysUntil(x.date))<=5);
      if(recent.length>=3&&recent.filter(x=>x.bristol>=6).length>=3)
        out.push({id:`insight:poop:${m.id}:${todayIso}`,cat:"insight",title:`${m.name}のうんちがやわらかめの日が続いています`,body:"数日続くようなら受診の目安に。フードや水分もふり返ってみて",actionLabel:"トイレ記録を見る",go:()=>{setTab(m.id);setPersonSeg("record");}});
    });
    // 🟢 提案：シニア期の子へ（年齢ベース・月1回・やさしい助言）
    petsLive.forEach(m=>{
      if(!m.birthday)return;const mo=monthsOld(m.birthday);if(mo==null)return;
      if(mo>=(m.species==="cat"?132:84))
        out.push({id:`tip:senior:${m.id}:${todayIso.slice(0,7)}`,cat:"tip",title:`${m.name}はシニア期`,body:"健診の回数を少し増やしたり、関節・歯・体重を気にかけてあげると安心です"});
    });
    // 💕 思い出：去年の今日（最大2件）
    onThisDay.slice(0,2).forEach(({item,yearsAgo})=>{
      out.push({id:`memory:${item.id}:${todayIso}`,cat:"memory",title:`${yearsAgo}年前の今日`,body:item.note||(item.title&&item.title!=="思い出"?item.title:"思い出の1枚")+(item.space?`（${nm(item.space)}）`:""),actionLabel:"思い出を見る",go:()=>{const pid=firstPhotoId(item);if(pid&&photos[pid])viewPhoto(pid);else{setTab(item.space);setPersonSeg("record");}}});
    });
    // 優先順位で並べ、重複IDを除き、最大8件（出しすぎない）
    const ids=new Set(),uniq=[];
    out.sort((a,b)=>NOTICE_META[a.cat].order-NOTICE_META[b.cat].order);
    for(const n of out){if(ids.has(n.id))continue;ids.add(n.id);uniq.push(n);}
    return uniq.slice(0,8);
  },[items,members,homeData,onThisDay,weather,hasWalker,todayIso,meName]);
  const[noticesRead,setNoticesRead]=useState(()=>{try{return new Set(JSON.parse(localStorage.getItem("loalife-notices-read")||"[]"));}catch(e){return new Set();}});
  const[noticesOpen,setNoticesOpen]=useState(false);
  const unreadNoticeCount=useMemo(()=>notices.filter(n=>!noticesRead.has(n.id)).length,[notices,noticesRead]);
  const openNotices=()=>{
    track("notices_open",{unread:unreadNoticeCount,total:notices.length});
    setNoticesOpen(true);
    const next=new Set(noticesRead);notices.forEach(n=>next.add(n.id));
    setNoticesRead(next);
    try{localStorage.setItem("loalife-notices-read",JSON.stringify([...next].slice(-300)));}catch(e){}
  };

  // AIサマリー：今日の要点を1〜3行で。あいさつ＋やること件数＋お散歩おすすめ＋直近の締切。
  const aiSummary=useMemo(()=>{
    const hr=new Date().getHours();
    const greet=hr<4?"こんばんは":hr<11?"おはよう":hr<18?"こんにちは":"こんばんは";
    const lines=[];
    const cnt=homeData.todos.length+homeData.bombs.length;
    lines.push(cnt>0?`今日は ${cnt}件 やることがあります。`:"今日はゆっくり過ごせそうです。");
    const jmaSevere=hasWalker&&jmaWarn&&jmaWarn.warnings.length&&jmaWarn.warnings[0].level>=2;
    if(jmaSevere){
      lines.push(`${jmaWarn.warnings[0].name}発表中。お散歩は控えてください。`);
    }else if(hasWalker&&weather&&!weather.error&&weather.hours){
      const wt=walkTimeline(weather.hours);
      const pet=petMembers.find(m=>m.species==="dog"&&!m.memorial);
      if(wt&&wt.best&&pet)lines.push(`${pet.name}のお散歩は ${wt.best.from===wt.best.to?wt.best.from+"時ごろ":wt.best.from+"〜"+wt.best.to+"時"} がおすすめです。`);
      else if(wt&&!wt.best)lines.push("今日はお散歩を控えめにすると安心です。");
    }
    const nb=homeData.bombs[0];
    if(nb&&lines.length<3){const d=nb.d;const w=nameOf(nb.item.space);const who=w?w+"の":"";lines.push(d<0?`${who}${nb.item.title} が ${-d}日 過ぎています。`:d===0?`${who}${nb.item.title} は今日です。`:`${who}${nb.item.title} まで あと${d}日 です。`);}
    return{greet,name:meName||"",lines:lines.slice(0,3)};
  },[homeData,hasWalker,weather,petMembers,meName,jmaWarn]);

  // ② 安心ステータス：各メンバーのレベルと一言
  // 「注意」は本当のケア漏れだけに絞る：期限切れ・在庫切れ＝要対応、重要ケアが迫る/在庫少＝注意。
  // 楽しみな予定（イベント等）は注意にしない（アラート疲れ防止）。
  // 見守るデータが1件も無い時は「順調(緑)」ではなく「記録なし(グレー)」＝偽の安心を出さない。
  const spaceTracked=(spaceId)=>items.some(x=>x.space===spaceId&&(x.type==="supply"||x.type==="routine"||x.type==="care"||!!x.dueDate));
  const spaceLevel=(spaceId)=>{
    if(memorialIds.has(spaceId))return"memorial";
    let overdue=0,soonCare=0;
    items.forEach(x=>{if(x.space!==spaceId||x.done||!x.dueDate)return;const d=daysUntil(x.dueDate);if(isOverdue(x))overdue++;else if(x.careKind&&HIGH_KINDS.has(x.careKind)&&d>=0&&d<=3)soonCare++;});
    const sup=lowSupplies.filter(o=>o.item.space===spaceId);
    if(overdue>0||sup.some(o=>o.st.tone==="out"))return"alert";
    if(soonCare>0||sup.some(o=>o.st.tone==="low"))return"warn";
    if(!spaceTracked(spaceId))return"none";
    return"ok";
  };
  const spaceConcern=(spaceId)=>{
    if(memorialIds.has(spaceId)){const m=members.find(x=>x.id===spaceId);const dl=m&&m.gotchaDay?daysTogether(m.gotchaDay,m.memorial):null;return dl?`${dl}日間、一緒に過ごしました`:"ずっと、心の中に";}
    let overdue=null,soonCare=null;
    items.forEach(x=>{if(x.space!==spaceId||x.done||!x.dueDate)return;const d=daysUntil(x.dueDate);if(isOverdue(x)){if(!overdue||d<overdue.d)overdue={item:x,d};}else if(x.careKind&&HIGH_KINDS.has(x.careKind)&&d>=0&&d<=3){if(!soonCare||d<soonCare.d)soonCare={item:x,d};}});
    const sup=lowSupplies.filter(o=>o.item.space===spaceId).sort((a,b)=>a.st.left-b.st.left)[0];
    if(sup&&sup.st.tone==="out")return`${sup.item.title}が切れているかも`;
    if(overdue)return`${overdue.item.title}が期限切れ`;
    if(sup&&sup.st.tone==="low")return`${sup.item.title} 残りわずか`;
    if(soonCare)return`${soonCare.item.title}・${soonCare.d===0?"今日":"あと"+soonCare.d+"日"}`;
    return null;
  };
  // ⑤ 小さなふりかえり（軽め）
  const weekDone=useMemo(()=>items.filter(x=>x.completedAt&&(Date.now()-x.completedAt)<7*86400000).length,[items]);
  const allRoutines=useMemo(()=>items.filter(x=>x.type==="routine"),[items]);
  const routineDoneToday=allRoutines.filter(x=>x.doneDate===todayIso).length;
  // ⑥ 何もない日：すべて落ち着いているか
  const allClear=homeData.todos.length===0&&homeData.bombs.length===0&&lowSupplies.length===0;

  const exportCalendar=()=>{
    const content=generateIcal(items,members,meEmoji);
    downloadIcal(content);
    showFlash("カレンダーファイルをダウンロードしました 📅");
  };

  const inHousehold=!!(fireUser&&household);

  // Share modal content
  const ShareModal=()=>{
    if(!FB_READY){
      return(
        <div className="yl-overlay" onClick={()=>setShowShareModal(false)}>
          <div className="yl-modal share" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="users" size={18}/> 家族共有</h3>
            <div className="yl-share-info">
              <p className="yl-share-desc">家族共有を使うには、Firebaseの設定が必要です。</p>
              <p className="yl-share-desc" style={{marginTop:8}}>build-src/firebase.js にFirebaseプロジェクトの設定を入力してください。</p>
            </div>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setShowShareModal(false)}>とじる</button></div>
          </div>
        </div>
      );
    }
    if(!fireUser){
      return(
        <div className="yl-overlay" onClick={()=>setShowShareModal(false)}>
          <div className="yl-modal share" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="users" size={18}/> 家族共有</h3>
            <p className="yl-share-desc">サインインで家族とデータを共有。</p>
            <div className="yl-auth-tabs">
              <button className={"yl-auth-tab"+(authTab==="google"?" on":"")} onClick={()=>{setAuthTab("google");setShareError("");}}>Google</button>
              <button className={"yl-auth-tab"+(authTab==="email"?" on":"")} onClick={()=>{setAuthTab("email");setShareError("");}}>メール</button>
            </div>
            {shareError&&<p className="yl-share-error">{shareError}</p>}
            {authTab==="google"?(
              <button className="yl-google-btn" onClick={signInWithGoogle} disabled={shareLoading}>
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.7 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.5 13.3l8 6.2C12.4 13 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.8-2.1 5.2-4.4 6.8l7 5.4C43.3 37.1 46.5 31.3 46.5 24.5z"/><path fill="#FBBC05" d="M10.5 28.5c-.5-1.5-.8-3-.8-4.5s.3-3 .8-4.5l-8-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l8-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7-5.4c-2 1.3-4.5 2.1-8.2 2.1-6.3 0-11.6-4.2-13.5-9.9l-8 6.2C6.6 42.6 14.6 48 24 48z"/></svg>
                Googleでサインイン
              </button>
            ):(
              <div className="yl-auth-email">
                <input className="yl-input" type="email" autoComplete="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="メールアドレス"/>
                <input className="yl-input" type="password" autoComplete={authIsSignup?"new-password":"current-password"} value={authPw} onChange={e=>setAuthPw(e.target.value)} placeholder={authIsSignup?"パスワード（6文字以上）":"パスワード"}/>
                <button className="yl-share-choice primary" onClick={authIsSignup?signUpEmail:signInEmail} disabled={shareLoading}>{shareLoading?"処理中…":(authIsSignup?"新規登録して確認メールを送る":"ログイン")}</button>
                <button className="yl-linkbtn" style={{marginTop:8,alignSelf:"center"}} onClick={()=>{setAuthIsSignup(v=>!v);setShareError("");}}>{authIsSignup?"すでにアカウントがある方はこちら":"はじめての方（メールで新規登録）"}</button>
              </div>
            )}
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setShowShareModal(false)}>とじる</button></div>
          </div>
        </div>
      );
    }
    // Signed in
    if(!household){
      return(
        <div className="yl-overlay" onClick={()=>setShowShareModal(false)}>
          <div className="yl-modal share" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="users" size={18}/> 家族共有</h3>
            <p className="yl-share-desc">{fireUser.displayName||fireUser.email} でサインイン中</p>
            {shareStep==="menu"&&(
              <>
                <button className="yl-share-choice" onClick={()=>setShareStep("create")}>＋ 新しい家族スペースを作る</button>
                <button className="yl-share-choice" onClick={()=>setShareStep("join")}><Icon name="hash" size={14}/> 招待コードで参加する</button>
              </>
            )}
            {shareStep==="create"&&(
              <>
                <p className="yl-share-desc">今のデータを移行して家族スペースを作成。</p>
                {shareError&&<p className="yl-share-error">{shareError}</p>}
                <button className="yl-share-choice primary" onClick={createHousehold} disabled={shareLoading}>{shareLoading?"作成中…":"家族スペースを作る"}</button>
                <button className="yl-modal-cancel" onClick={()=>setShareStep("menu")}>戻る</button>
              </>
            )}
            {shareStep==="join"&&(
              <>
                <input className="yl-input" value={joinCodeInput} onChange={e=>setJoinCodeInput(e.target.value.toUpperCase())} placeholder="招待コード（6文字）" maxLength={6} style={{letterSpacing:"0.2em",textAlign:"center"}}/>
                {shareError&&<p className="yl-share-error">{shareError}</p>}
                <button className="yl-share-choice primary" onClick={joinHousehold} disabled={shareLoading||!joinCodeInput.trim()}>{shareLoading?"参加中…":"参加する"}</button>
                <button className="yl-modal-cancel" onClick={()=>{setShareStep("menu");setShareError("");}}>戻る</button>
              </>
            )}
            {shareStep==="created"&&(
              <>
                <div className="yl-invite-box">
                  <p className="yl-invite-label">招待コード</p>
                  <p className="yl-invite-code">{household?.inviteCode}</p>
                  <button className="yl-copy-btn" onClick={copyInviteCode}>{copiedCode?"コピー済！":"コードをコピー"}</button>
                </div>
                <p className="yl-share-desc">このコードを家族に送って、一緒に使いましょう。</p>
              </>
            )}
            <div className="yl-modal-btns">
              <button className="yl-modal-cancel" onClick={()=>setShowShareModal(false)}>とじる</button>
              <button className="yl-modal-cancel" style={{color:"#B23A48"}} onClick={signOutUser}>サインアウト</button>
            </div>
          </div>
        </div>
      );
    }
    // In a household
    return(
      <div className="yl-overlay" onClick={()=>setShowShareModal(false)}>
        <div className="yl-modal share" onClick={e=>e.stopPropagation()}>
          <h3 className="yl-modal-title"><Icon name="users" size={18}/> 家族共有</h3>
          <div className="yl-share-status">
            <span className="yl-share-dot"/>
            <span>{fireUser.displayName||fireUser.email}</span>
          </div>
          <div className="yl-invite-box">
            <p className="yl-invite-label">招待コード</p>
            <p className="yl-invite-code">{household.inviteCode}</p>
            <button className="yl-copy-btn" onClick={copyInviteCode}>{copiedCode?"コピー済！":"コードをコピー"}</button>
          </div>
          <p className="yl-share-desc">家族の人数: {household.memberUids?.length||1}人</p>
          <div className="yl-modal-btns">
            <button className="yl-modal-cancel" onClick={()=>setShowShareModal(false)}>とじる</button>
            <button className="yl-modal-cancel" style={{color:"#B23A48"}} onClick={signOutUser}>サインアウト</button>
          </div>
        </div>
      </div>
    );
  };

  // 初回言語選択：loalife-lang-v1 未設定のときだけ、通常UI（オンボーディング含む）より前に表示。
  // 言語未確定なので日本語・英語を併記（t() に依存しない）。
  if(!langChosen){
    return(
      <div className="yl-ob yl-langfirst">
        <div className="yl-ob-inner">
          <div className="yl-ob-emoji">🐾</div>
          <h1 className="yl-langfirst-brand">LoaLife</h1>
          <p className="yl-langfirst-lead">言語を選択 / Choose your language / Elige tu idioma / 选择语言</p>
          <div className="yl-theme-seg yl-langfirst-seg" role="group" aria-label="言語 / Language / Idioma / 语言">
            {[["ja","日本語","🇯🇵"],["en","English","🇺🇸"],["es","Español","🇪🇸"],["zh","简体中文","🇨🇳"]].map(([v,label,flag])=>(
              <button key={v} className={"yl-theme-opt"+(lang===v?" on":"")} onClick={()=>setLang(v)} aria-pressed={lang===v}>
                <span aria-hidden="true">{flag}</span> <span>{label}</span>
              </button>
            ))}
          </div>
          <button className="yl-ob-btn" onClick={confirmLang}>はじめる / Continue</button>
        </div>
      </div>
    );
  }

  return(
    <div className={"yl-root"+(!onboarding&&tab==="cal"?"":" no-membar")}>
      {/* 初回ツアー(A)：主要操作を順番に案内。スキップで一括終了。 */}
      {!onboarding&&tourStep!==null&&TOUR_STEPS[tourStep]&&(
        <CoachMark key={"tour"+tourStep} sel={TOUR_STEPS[tourStep].sel} title={t("tour."+TOUR_STEPS[tourStep].k+".title")} body={t("tour."+TOUR_STEPS[tourStep].k+".body")}
          step={tourStep+1} total={TOUR_STEPS.length} nextLabel={tourStep<TOUR_STEPS.length-1?t("tour.next"):t("ob.start")} onNext={tourNext} onSkip={endTour}/>
      )}
      {/* 画面ごとの初回案内(B)：ツアー中は出さない（tourStep===null のみ）。1画面1ポイント。 */}
      {!onboarding&&tourStep===null&&coachKey&&COACH_HINTS[coachKey]&&(
        <CoachMark key={"coach"+coachKey} sel={COACH_HINTS[coachKey].sel} title={t("coach."+coachKey+".title")} body={t("coach."+coachKey+".body")}
          nextLabel={t("common.ok")} onNext={dismissCoach} single/>
      )}
      {onboarding&&(
        <div className="yl-ob">
          {obStep===0&&<div className="yl-ob-inner"><div className="yl-ob-emoji">🏠</div><h1 className="yl-ob-title">{t("ob.title")}</h1><p className="yl-ob-sub">{t("ob.sub")}</p><button className="yl-ob-btn" onClick={()=>setObStep(1)}>{t("ob.start")}</button><button className="yl-ob-link" onClick={loadSample}>{t("ob.trySample")}</button></div>}
          {obStep===1&&<div className="yl-ob-inner"><h2 className="yl-ob-h2">{t("ob.h2")}</h2>{!obKind?<div className="yl-ob-choices"><button className="yl-ob-choice" onClick={()=>{setObKind("pet");setObEmoji(PET_EMOJIS[0]);setObAvatar("");}}>{t("ob.choicePet")}</button><button className="yl-ob-choice" onClick={()=>{setObKind("me");setObEmoji(PERSON_EMOJIS[0]);setObAvatar("");}}>{t("ob.choiceMe")}</button><button className="yl-ob-choice" onClick={()=>{setObKind("person");setObEmoji(PERSON_EMOJIS[0]);setObAvatar("");}}>{t("ob.choicePerson")}</button><button className="yl-ob-link" onClick={finishOnboarding}>{t("ob.skip")}</button></div>:<div className="yl-ob-form">{obKind==="pet"&&<div className="yl-kindrow">{SPECIES.map(s=><button key={s.key} className={"yl-kindbtn sm"+(obSpecies===s.key?" on":"")} onClick={()=>{setObSpecies(s.key);setObEmoji(petEmojisFor(s.key)[0]);}}>{s.emoji} {lblOf(s)}</button>)}</div>}{obKind==="person"&&<div className="yl-kindrow">{PERSON_TYPES.map(pt=><button key={pt.k} className={"yl-kindbtn sm"+(obPersonType===pt.k?" on":"")} onClick={()=>{setObPersonType(pt.k);setObAvatar("");setObEmoji(pt.emoji);}}>{pt.emoji} {lOf(pt)}</button>)}</div>}<div className="yl-emoji-row">{(obKind==="pet"?petEmojisFor(obSpecies):PERSON_EMOJIS).map(e=><button key={e} className={"yl-emoji"+(!obAvatar&&obEmoji===e?" on":"")} onClick={()=>{setObAvatar("");setObEmoji(e);}}>{e}</button>)}<label className={"yl-emoji yl-emoji-photo"+(obAvatar?" on":"")} title={t("ob.photoIcon")}>{obAvatar&&photos[obAvatar]?<img className="yl-emoji-photoimg" src={photos[obAvatar]} alt=""/>:<Icon name="camera" size={17}/>}<input type="file" accept="image/*" style={{display:"none"}} onChange={pickObAvatar}/></label></div><p className="yl-ob-iconhint">{t("ob.iconHintPre")}<Icon name="camera" size={12}/>{t("ob.iconHintPost")}</p><IMEInput className="yl-input" value={obName} onChange={setObName} onKeyDown={e=>e.key==="Enter"&&finishOnboarding()} placeholder={obKind==="pet"?t("ob.namePetPh"):obKind==="me"?t("ob.nameMePh"):t("ob.namePersonPh")} autoFocus/><label className="yl-opt" style={{width:"100%",marginTop:8}}>{t("ob.birthday")}<BdayInput value={obBirthday} onChange={setObBirthday}/></label><button className="yl-ob-btn" onClick={finishOnboarding}>{t("ob.start")}</button><button className="yl-ob-link" onClick={()=>setObKind(null)}>{t("ob.back")}</button></div>}</div>}
        </div>
      )}

      <div className="yl-wrap">
        <header className="yl-head">
          {isPersonMode
            ?<div className="yl-headseg" data-tour="headseg" role="tablist">
              <button role="tab" aria-selected={personSeg==="record"} className={"yl-headseg-btn"+(personSeg==="record"?" on":"")} onClick={()=>setPersonSeg("record")}><Icon name="record" size={15}/> {t("seg.daily")}</button>
              <button role="tab" aria-selected={personSeg==="manage"} className={"yl-headseg-btn"+(personSeg==="manage"?" on":"")} onClick={()=>setPersonSeg("manage")}><Icon name="users" size={15}/> {t("seg.manage")}</button>
            </div>
            :<h1 className="yl-title">{tab==="home"?t("nav.home"):tab==="cal"?t("nav.calendar"):tab==="settings"?t("nav.settings"):t("title.daily")}</h1>}
          <div className="yl-head-actions">
            {/* 共有は Firebase 設定済みのときだけ表示（未設定だと押しても行き止まりのため隠す） */}
            {FB_READY&&(
              <button
                className={"yl-share-btn"+(inHousehold?" active":"")}
                onClick={()=>{setShowShareModal(true);setShareStep(household?"menu":"menu");setShareError("");}}
                title="家族共有"
              >
                {inHousehold?"👨‍👩‍👧":"👤"}{fireUser?"":" 共有"}
              </button>
            )}
            <button className="yl-menu-btn yl-bell" onClick={openNotices} aria-label="今日のLOALIFE" title="今日のLOALIFE"><Icon name="bell" size={20}/>{unreadNoticeCount>0&&<span className="yl-bell-badge">{unreadNoticeCount>9?"9+":unreadNoticeCount}</span>}</button>
            <button className="yl-menu-btn" onClick={()=>setHelpOpen(true)} aria-label="使い方・機能紹介" title="使い方・機能紹介"><Icon name="note" size={20}/></button>
            <button className="yl-menu-btn" onClick={()=>setMenuOpen(true)} aria-label="メニュー" title="メニュー"><Icon name="menu" size={22}/></button>
          </div>
        </header>

        {!onboarding&&isPersonMode&&(
          <div className="yl-famstrip" role="tablist" aria-label="家族を切り替え">
            {spaces.map(s=>(
              <button key={s.id} role="tab" aria-selected={tab===s.id} className={"yl-famchip"+(tab===s.id?" on":"")} onClick={()=>{setTab(s.id);setMemberSel(s.id);}}>
                <span className="yl-famchip-dot" style={{background:colorOf(s.id)}}/>{avatarNode(s,"sm")}<span className="yl-famchip-name">{s.name}</span>
              </button>
            ))}
            <button className="yl-famchip add" onClick={()=>setAdding(true)} aria-label="家族・ペットを追加"><Icon name="plus" size={17}/></button>
          </div>
        )}

        {adding&&(
          <div className="yl-petform">
            <div className="yl-kindrow"><button className={"yl-kindbtn"+(newKind==="pet"?" on":"")} onClick={()=>{setNewKind("pet");setNewEmoji(PET_EMOJIS[0]);setNewAvatar("");}}>🐾 ペット</button><button className={"yl-kindbtn"+(newKind==="person"?" on":"")} onClick={()=>{setNewKind("person");setNewEmoji(PERSON_EMOJIS[0]);setNewAvatar("");}}>👤 家族（人）</button></div>
            {newKind==="pet"&&<div className="yl-kindrow">{SPECIES.map(s=><button key={s.key} className={"yl-kindbtn sm"+(newSpecies===s.key?" on":"")} onClick={()=>{setNewSpecies(s.key);setNewEmoji(petEmojisFor(s.key)[0]);}}>{s.emoji} {lblOf(s)}</button>)}</div>}
            {newKind==="person"&&<div className="yl-kindrow">{PERSON_TYPES.map(pt=><button key={pt.k} className={"yl-kindbtn sm"+(newPersonType===pt.k?" on":"")} onClick={()=>{setNewPersonType(pt.k);setNewAvatar("");setNewEmoji(pt.emoji);}}>{pt.emoji} {lOf(pt)}</button>)}</div>}
            <div className="yl-emoji-row">{emojiSet.map(e=><button key={e} className={"yl-emoji"+(!newAvatar&&newEmoji===e?" on":"")} onClick={()=>{setNewAvatar("");setNewEmoji(e);}}>{e}</button>)}<label className={"yl-emoji yl-emoji-photo"+(newAvatar?" on":"")} title="写真をアイコンにする">{newAvatar&&photos[newAvatar]?<img className="yl-emoji-photoimg" src={photos[newAvatar]} alt=""/>:<Icon name="camera" size={17}/>}<input type="file" accept="image/*" style={{display:"none"}} onChange={pickNewAvatar}/></label></div>
            <div className="yl-petform-row"><IMEInput className="yl-input" value={newName} onChange={setNewName} onKeyDown={e=>e.key==="Enter"&&addMember()} placeholder={newKind==="person"?"名前（例：ゆうと）":"名前（例：ぽち）"}/><button className="yl-addbtn" onClick={addMember}>登録</button></div>
            <label className="yl-opt" style={{marginTop:10}}>誕生日（年は任意）<BdayInput value={newBirthday} onChange={setNewBirthday}/></label>
            {inHousehold&&<div style={{marginTop:10}}><VisibilityToggle value={newVisibility} onChange={setNewVisibility}/></div>}
          </div>
        )}

        {tab==="home"?(
          <div className="yl-home">
            {/* 初見（メンバー未登録）だけに出す追加導線。登録済みユーザーには表示しない */}
            {members.length===0&&(
              <section style={{background:"var(--card)",borderRadius:22,padding:"26px 20px",textAlign:"center",boxShadow:"0 6px 18px rgba(120,80,160,.1)"}}>
                <div style={{fontSize:34,lineHeight:1.1,marginBottom:10}}>🐶🐱</div>
                <p style={{margin:"0 0 6px",fontSize:18,fontWeight:800,color:"var(--text)"}}>ようこそ</p>
                <p style={{margin:"0 0 16px",fontSize:13.5,fontWeight:700,lineHeight:1.7,color:"var(--text-sub)"}}>大切な家族の毎日と、もしもの備えを、ひとつに。<br/>ペットも子どもも、まずはひとり登録しましょう。</p>
                <button className="yl-quick-big" onClick={()=>setAdding(true)}><Icon name="plus" size={18}/> うちの子・家族を登録</button>
              </section>
            )}
            {members.length>0&&(
              <section className="yl-ai">
                <p className="yl-ai-greet"><Icon name={new Date().getHours()<11?"sun":new Date().getHours()<18?"sun":"moon"} size={18}/> {aiSummary.greet}{aiSummary.name?`、${aiSummary.name}`:""}</p>
                {aiSummary.lines.map((l,i)=><p key={i} className="yl-ai-line">{l}</p>)}
              </section>
            )}

            {/* お願い系バナーは挨拶の下に、同時に1枚だけ（通知を優先） */}
            {members.length>0&&(()=>{const showNotif=showNotifBanner&&(hasReminders||members.some(m=>m.birthday));if(showNotif)return(
              <div className="yl-notif-banner">
                <span>通知を許可すると、リマインダーや誕生日をお知らせします</span>
                <button className="yl-notif-allow" onClick={handleNotifRequest}>許可する</button>
              </div>
            );if(a2hsHint)return(
              <div className="yl-notif-banner">
                <span>ホーム画面に追加すると、データが消えにくく安心です</span>
                <button className="yl-notif-allow" onClick={()=>{setA2hsHint(false);try{localStorage.setItem("loalife-a2hs-snooze",String(Date.now()+3*86400000));}catch(e){}}}>あとで</button>
              </div>
            );return null;})()}

            {/* 家族一覧：ホームの主役。タップでその子のページへ（メンバー中心ナビの入口） */}
            {homeSpaces.length>0&&<section className="yl-fammain">
              <h2 className="yl-sec-title">{t("home.family")}</h2>
              <div className="yl-statusgrid">{homeSpaces.map(s=>{
                const lv=spaceLevel(s.id);const meta=LEVEL_META[lv];const concern=spaceConcern(s.id);
                const okMsg=lv==="none"?t("home.okNoRecord"):(s.kind==="pet"?t("home.okPet",{name:s.name}):t("home.okGeneric"));
                return(
                  <button key={s.id} className={"yl-statuscard lv-"+lv} onClick={()=>{setTab(s.id);setMemberSel(s.id);setPersonSeg("record");}}>
                    <span className="yl-status-emoji">{avatarNode(s,"md")}</span>
                    <span className="yl-status-body">
                      <span className="yl-status-name">{s.name}</span>
                      <span className={"yl-status-line lv-"+lv}>{concern||okMsg}</span>
                    </span>
                    <span className={"yl-level-badge lv-"+lv}>{t("level."+lv)}</span>
                    <span className="yl-status-go" aria-hidden="true">›</span>
                  </button>
                );
              })}</div>
            </section>}

            {/* ━━ 第1層「今日」：3秒で今日やることが分かる場 ━━ */}
            {(()=>{const todayClear=homeData.todos.length===0&&homeData.bombs.length===0;return(
            <div className="yl-layer">
              <span className="yl-layer-label">{t("home.layerToday")}</span>
              {todayBirthdays.length>0&&(
                <section className="yl-bday-cheer">
                  <span className="yl-bday-cheer-ico">🎂</span>
                  <div className="yl-bday-cheer-body">
                    <p className="yl-bday-cheer-title">今日は{todayBirthdays.map(a=>`${a.name}${a.years?`（${a.years}歳）`:""}`).join("・")}のお誕生日です</p>
                    <p className="yl-bday-cheer-sub">おめでとうございます。すてきな一日になりますように。</p>
                  </div>
                </section>
              )}
              {upcomingAnnivRest.length>0&&(
                <section className="yl-bday-section compact">
                  {upcomingAnnivRest.slice(0,3).map(a=>(
                    <div key={a.key} className="yl-bday-row">
                      <span className="yl-bday-emoji">{a.emoji}</span>
                      <span className="yl-bday-name">{a.name}<span className="yl-bday-kind">{a.kind==="gotcha"?"・うちの子記念日":a.kind==="self"?"":"・誕生日"}</span></span>
                      <span className={"yl-bday-tag"+(a.daysUntil===0?" today":"")}>{a.daysUntil===0?(a.years?(a.kind==="gotcha"?`迎えて${a.years}年！`:`${a.years}歳！`):"今日！"):`あと${a.daysUntil}日`}</span>
                    </div>
                  ))}
                </section>
              )}
              {/* 1年前の今日：過去の同じ日の思い出をそっと振り返る */}
              {onThisDay.length>0&&(()=>{const years=[...new Set(onThisDay.map(o=>o.yearsAgo))];const otdTitle=years.length===1?`${years[0]}年前の今日`:"この日の思い出";return(
                <section className="yl-otd">
                  <p className="yl-otd-title"><Icon name="camera" size={14}/> {otdTitle}</p>
                  <div className="yl-otd-list">
                    {onThisDay.slice(0,3).map(({item,yearsAgo})=>{const pid=firstPhotoId(item);const src=pid&&photos[pid];return(
                      <button key={item.id} className="yl-otd-item" onClick={()=>src?viewMemory(pid):openLifeEdit(item)}>
                        {src?<img className="yl-otd-thumb" src={src} alt=""/>:<span className="yl-otd-thumb noimg"><Icon name="note" size={18}/></span>}
                        <span className="yl-otd-body">
                          <span className="yl-otd-when">{yearsAgo}年前 ・ {nameOf(item.space)||"わたし"}</span>
                          {(item.note||(item.title&&item.title!=="思い出"))&&<span className="yl-otd-note">{item.note||item.title}</span>}
                        </span>
                      </button>
                    );})}
                  </div>
                </section>
              );})()}
              {/* 今日やること（毎日使う）を先に。見逃せないことはその下に。 */}
              {todayClear?(
                <section className="yl-hero calm">
                  <div className="yl-hero-emoji"><Icon name="sun" size={40} stroke={1.7}/></div>
                  <p className="yl-hero-title">{t("home.calmTitle")}</p>
                  <p className="yl-hero-sub">{members.length===0?t("home.calmNone"):(()=>{const pets=members.filter(m=>m.kind==="pet");if(pets.length===1)return t("home.calmOnePet",{emoji:pets[0].emoji,name:pets[0].name});if(members.length===1)return t("home.calmOne",{emoji:members[0].emoji,name:members[0].name});return t("home.calmAll",{emojis:members.map(m=>m.emoji).join("")});})()}</p>
                </section>
              ):homeData.todos.length>0&&(
                <section className="yl-todo">
                  <div className="yl-dash-head">
                    <h2 className="yl-sec-title" style={{marginBottom:0}}>{t("home.todayTodos")}</h2>
                    <button className="yl-cal-export" onClick={()=>setCalPicker({bulk:true})} title="カレンダーにエクスポート"><Icon name="calendar" size={14}/> {t("home.export")}</button>
                  </div>
                  {/* 「誰の」でまとめて横断表示。チェックで完了（種別ごとの既存ハンドラへ）。 */}
                  {todayByMember.map(g=>(
                    <div key={g.space} className="yl-todo-group">
                      <button className="yl-todo-ghead" onClick={()=>setTab(g.space)}>
                        {g.av?avatarNode(g.av,"xs"):<span className="yl-todo-gemoji">👤</span>}
                        <span className="yl-todo-gname">{g.name}</span>
                        <span className="yl-todo-gcount">{g.todos.length}</span>
                      </button>
                      <ul className="yl-todo-list">
                        {g.todos.slice(0,5).map(t=>(
                          <li key={t.key} className="yl-todo-item">
                            <button className="yl-check" onClick={()=>completeHomeTask(t.key)} aria-label="完了にする"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                            <span className="yl-todo-emoji"><Icon name={guessIcon(t.title)} size={16}/></span>
                            <span className="yl-todo-body" onClick={()=>setTab(g.space)}><span className="yl-todo-text">{t.title}{t.time&&<span className="yl-todo-time"> {t.time}</span>}</span></span>
                            <span className={"yl-todo-tag"+(t.pri===0?" over":"")}>{locTag(t.tag)}</span>
                          </li>
                        ))}
                        {g.todos.length>5&&<li className="yl-todo-more2" onClick={()=>setTab(g.space)}>{t("home.moreCount",{n:g.todos.length-5})}</li>}
                      </ul>
                    </div>
                  ))}
                </section>
              )}
              {homeData.bombs.length>0&&(
                <section className="yl-bombs">
                  <h2 className="yl-sec-title alert">{t("home.dontMiss")}</h2>
                  <ul className="yl-bomb-list">
                    {homeData.bombs.slice(0,3).map(({item,d})=>(
                      <li key={item.id} className={"yl-bomb-item"+(d<0?" over":"")} onClick={()=>setTab(item.space)}>
                        <span className="yl-bomb-emoji"><Icon name={guessIcon(item.title,"alert")} size={20}/></span>
                        <span className="yl-bomb-body"><span className="yl-bomb-text">{item.title}</span><span className="yl-bomb-who">{nameOf(item.space)}</span></span>
                        <span className={"yl-bomb-tag"+(d<0?" over":"")}>{d<0?t("rel.overdueBy",{d:-d}):d===0?t("rel.today"):d===1?t("rel.tomorrow"):t("rel.inDays",{d})}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {homeData.upcoming.length>0&&(
                <section className="yl-upcoming">
                  <p className="yl-upcoming-label"><Icon name="calendar" size={14}/> {t("home.upcoming")}</p>
                  <ul className="yl-upcoming-list">
                    {homeData.upcoming.slice(0,4).map(u=>(
                      <li key={u.key} className="yl-upcoming-item" onClick={()=>setTab(u.space)}>
                        <span className="yl-upcoming-emoji"><Icon name={guessIcon(u.title,"calendar")} size={18}/></span>
                        <span className="yl-upcoming-text">{u.title}<span className="yl-upcoming-who"> ・{nameOf(u.space)}</span></span>
                        <span className="yl-upcoming-tag">{locTag(u.tag)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {/* ワンタップ記録：今日まだ体調記録が無いメンバーを、押すだけで完了できる導線 */}
              {(()=>{const need=homeSpaces.filter(s=>!todayHasCond(s.id));return need.length>0&&(
                <section className="yl-quickcond">
                  <p className="yl-quickcond-label">{t("home.quickCond")}</p>
                  <ul className="yl-quickcond-list">
                    {need.map(s=>(
                      <li key={s.id} className="yl-quickcond-item">
                        <span className="yl-quickcond-emoji">{avatarNode(s,"sm")}</span>
                        <span className="yl-quickcond-name">{s.name}</span>
                        <button className="yl-quickcond-btn" onClick={()=>quickHealthy(s.id)}><Icon name="check" size={15}/> {t("home.quickCondBtn")}</button>
                      </li>
                    ))}
                  </ul>
                </section>
              );})()}
            </div>
            );})()}

            {/* 天気・お散歩カードは犬がいる時(hasWalker)だけ表示。犬なしユーザーの主役にしない */}
            {hasWalker&&(weatherLoc?(<>
              {/* 地点切り替え：現在地／登録した場所を横並びで。タップでその地点の天気に切り替える。 */}
              <div className="yl-wxchips">
                {weatherLocs.map(l=>(
                  <button key={l.id} className={"yl-wxchip"+(l.id===weatherLoc.id?" on":"")} onClick={()=>selectPlace(l.id)}><Icon name="pin" size={11}/><span className="yl-wxchip-name">{l.name}</span></button>
                ))}
                {weatherLocs.length<LOC_MAX&&<button className="yl-wxchip add" onClick={()=>setWxAddOpen(true)}><Icon name="plus" size={12}/> 地点を追加</button>}
              </div>
              {(()=>{const wi=hasWalker?walkIndex(weather):null;const wa=hasWalker?walkAdvice(weather):null;const wt=hasWalker&&weather&&!weather.error&&weather.hours?walkTimeline(weather.hours):null;const tmr=weather&&!weather.error?weather.tomorrow:null;const wtT=hasWalker&&tmr&&tmr.hours?walkTimeline(tmr.hours):null;const wc=weather&&!weather.error&&weather.code!=null?weatherCodeMeta(weather.code):null;const jmaHi=(jmaWarn&&jmaWarn.warnings.length)?jmaWarn.warnings[0].level:0;const cardLv=jmaHi>=2?"danger":(wa&&wa.level==="danger")?"danger":(wi?wi.level:null);return(
              <div className={"yl-weather"+(cardLv?" lv-"+cardLv:"")}>
                {weather&&weather.error?(<>
                  <div className="yl-wx-top"><span className="yl-wx-loc"><Icon name="pin" size={13}/> {weatherLoc.name}</span><button className="yl-weather-refresh" onClick={()=>fetchWeather(weatherLoc)} aria-label="更新">↻</button></div>
                  <span className="yl-weather-err">取得できませんでした <button className="yl-weather-refresh" onClick={()=>fetchWeather(weatherLoc)}>再試行</button></span>
                </>):weather?(()=>{const advShort=(jmaHi>=2)?`${jmaWarn.warnings[0].name}発表中。お散歩は控えて`:wi?(wi.level==="danger"?"今日はお散歩を控えめに":wi.level==="warn"?"短めのお散歩がおすすめ":"お散歩日和です"):null;return(<>
                  <div className="yl-wx-top"><span className="yl-wx-loc"><Icon name="pin" size={13}/> {weatherLoc.name}</span><button className="yl-weather-refresh" onClick={()=>fetchWeather(weatherLoc)} aria-label="更新" disabled={weatherLoading}>↻</button></div>
                  {jmaWarn&&jmaWarn.warnings.length>0&&(
                    <div className="yl-jma">
                      <span className="yl-jma-head"><Icon name="alert" size={12}/> 気象庁・{jmaWarn.area}</span>
                      <span className="yl-jma-chips">{jmaWarn.warnings.slice(0,5).map(w=><span key={w.code} className={"yl-jma-chip lv"+w.level}>{w.name}</span>)}</span>
                    </div>
                  )}
                  <div className="yl-wx-hero">
                    <span className="yl-wx-temp">{Math.round(weather.temp)}°</span>
                    <div className="yl-wx-heroright">
                      {wc&&<span className="yl-wx-cond">{wc.label}</span>}
                      {wi&&<span className={"yl-wx-index lv-"+wi.level}><Icon name="paw" size={13}/> 散歩指数 {wi.score}</span>}
                    </div>
                  </div>
                  <p className="yl-wx-advice">{advShort||`体感 ${weather.apparent!=null?Math.round(weather.apparent):Math.round(weather.temp)}℃ ・ 湿度 ${Math.round(weather.humidity)}%`}</p>
                  <button className="yl-wx-more" onClick={()=>setWxDetail(o=>!o)}>{wxDetail?"閉じる":"詳細を見る"} <Icon name="chevron" size={13} className={wxDetail?"yl-rot90":""}/></button>
                  {wxDetail&&(<div className="yl-wx-detail">
                    <div className="yl-weather-vals">
                      {weather.apparent!=null&&<span className="yl-weather-feels">体感 {Math.round(weather.apparent)}℃</span>}
                      {(weather.hi!=null||weather.lo!=null)&&<span className="yl-weather-hilo">{weather.hi!=null?`↑${Math.round(weather.hi)}°`:""}{weather.lo!=null?` ↓${Math.round(weather.lo)}°`:""}</span>}
                      <span className="yl-weather-hum"><Icon name="droplet" size={13}/> {Math.round(weather.humidity)}%</span>
                      {weather.wind!=null&&<span className="yl-weather-wind"><Icon name="wind" size={13}/> {Math.round(weather.wind)}m/s</span>}
                      {weather.uv!=null&&<span className="yl-weather-uv"><Icon name="sun" size={13}/> UV {Math.round(weather.uv)}</span>}
                      {hasWalker&&weather.roadTemp!=null&&<span className="yl-weather-road"><Icon name="paw" size={13}/> 路面 {Math.round(weather.roadTemp)}℃</span>}
                    </div>
                    {weather.time&&<span className="yl-weather-time">現在（{weather.time.slice(11,16)}時点）の実況・当日の予報</span>}
                    {wi&&(<div className="yl-walk">
                      <span className="yl-walk-index"><span className={"yl-walk-badge lv-"+wi.level}><Icon name="paw" size={14}/> お散歩指数 {wi.score}／100</span><span className="yl-walk-stars">{"★".repeat(wi.stars)}{"☆".repeat(5-wi.stars)}</span></span>
                      {wa&&wa.level==="danger"&&<span className="yl-walk-danger"><Icon name="alert" size={13}/> {wa.msg}{weather.roadTemp!=null?`（路面約${Math.round(weather.roadTemp)}℃）`:""}</span>}
                      {wi.factors.length>0&&(
                        <div className="yl-walk-bd">
                          <span className="yl-walk-bd-label">スコアの内訳（減点）</span>
                          <ul className="yl-walk-bd-list">{wi.factors.map(f=><li key={f.key} className="yl-walk-bd-item"><span className="yl-walk-bd-name"><Icon name={f.icon} size={13}/> {f.label}</span><span className="yl-walk-bd-bar"><span className="yl-walk-bd-fill" style={{width:Math.min(100,f.penalty)+"%"}}/></span><span className="yl-walk-bd-pen">−{f.penalty}</span></li>)}</ul>
                        </div>
                      )}
                      {(wt||wtT)&&(<div className="yl-walktime">
                        <div className="yl-walktime-head">
                          <span className="yl-walktime-title"><Icon name="paw" size={15}/> おさんぽ、いつがいい？</span>
                          {wtT&&<span className="yl-walkday-toggle"><button className={"yl-walkday-btn"+(walkDay==="today"?" on":"")} onClick={()=>setWalkDay("today")}>今日</button><button className={"yl-walkday-btn"+(walkDay==="tomorrow"?" on":"")} onClick={()=>setWalkDay("tomorrow")}>明日</button></span>}
                        </div>
                        {(()=>{const isT=walkDay==="tomorrow"&&wtT;const active=isT?wtT:wt;if(!active)return<p className="yl-walktime-empty">明日の予報はまだ取得できません</p>;const tc=isT&&tmr&&tmr.code!=null?weatherCodeMeta(tmr.code):null;return(<>
                          {isT&&tmr&&<div className="yl-walk-tmrwx">{tc&&<span className="yl-walk-tmrcond">{tc.label}</span>}{(tmr.hi!=null||tmr.lo!=null)&&<span className="yl-walk-tmrhilo">{tmr.hi!=null?`↑${Math.round(tmr.hi)}°`:""}{tmr.lo!=null?` ↓${Math.round(tmr.lo)}°`:""}</span>}{tmr.uv!=null&&<span className="yl-walk-tmruv"><Icon name="sun" size={12}/> UV {Math.round(tmr.uv)}</span>}</div>}
                          {active.best?<span className="yl-walktime-badge"><Icon name="sun" size={12}/> {active.best.from===active.best.to?`${active.best.from}時ごろ`:`${active.best.from}〜${active.best.to}時`}が気もちよさそう</span>:<span className="yl-walktime-badge none">{isT?"明日はおうちでのんびり":"今日はおうちでのんびり"}</span>}
                          <div className="yl-walktime-bar">{active.segs.map(s=><span key={s.h} className={"yl-wt-seg lv-"+s.level} title={`${s.h}時`}/>)}</div>
                          <div className="yl-walktime-axis"><span>朝5時</span><span>9時</span><span>昼13時</span><span>17時</span><span>夜22時</span></div>
                          <div className="yl-walktime-legend"><span className="yl-wt-lg"><span className="yl-wt-dot good"/> ごきげん</span><span className="yl-wt-lg"><span className="yl-wt-dot caution"/> ほどほど</span><span className="yl-wt-lg"><span className="yl-wt-dot avoid"/> ひかえめに</span></div>
                        </>);})()}
                      </div>)}
                    </div>)}
                  </div>)}
                </>);})():(<><div className="yl-wx-top"><span className="yl-wx-loc"><Icon name="pin" size={13}/> {weatherLoc.name}</span></div><span className="yl-weather-load">{weatherLoading?"読み込み中…":"—"}</span></>)}
              </div>
            );})()}</>):(
              <button className="yl-weather-setup" onClick={()=>setWxAddOpen(true)}><Icon name="thermometer" size={16}/> 地点を追加して天気・お散歩判定を表示</button>
            ))}

            {/* 毎日いちばん使う「まとめてお世話記録」を天気のすぐ下に置き、開いてすぐ記録できるように */}
            {(()=>{const livePets=petMembers.filter(m=>!m.memorial);if(livePets.length===0)return null;const selIds=batchSel===null?livePets.map(m=>m.id):batchSel.filter(id=>livePets.some(m=>m.id===id));const toggle=(id)=>setBatchSel(()=>{const base=batchSel===null?livePets.map(m=>m.id):batchSel;return base.includes(id)?base.filter(x=>x!==id):[...base,id];});return(
              <section className="yl-batch">
                <div className="yl-batch-head"><span className="yl-batch-title">まとめてお世話記録</span></div>
                <div className="yl-batch-pets">{livePets.map(m=>{const on=selIds.includes(m.id);return(
                  <button key={m.id} className={"yl-batch-pet"+(on?" on":"")} onClick={()=>toggle(m.id)}>{avatarNode(m,"xs")}<span className="yl-batch-petname">{m.name}</span>{on&&<span className="yl-batch-check">✓</span>}</button>);})}
                </div>
                <div className="yl-batch-acts">{BATCH_ACTIONS.filter(a=>a.title!=="散歩"||hasWalker).map(a=><button key={a.title} className="yl-batch-act" disabled={selIds.length===0} onClick={()=>batchLog(a,selIds)}><span className="yl-batch-act-emoji"><Icon name={guessIcon(a.title)} size={18}/></span>{a.title}</button>)}</div>
              </section>);})()}

            {/* ━━ 第2層「コンディション」：習慣と思い出の軽チェック ━━ */}
            <div className="yl-layer">
              {allRoutines.length>0&&(
                <section className="yl-habit">
                  <span className="yl-habit-label">今日の習慣</span>
                  <span className="yl-habit-bar"><span className="yl-habit-fill" style={{width:Math.round(routineDoneToday/allRoutines.length*100)+"%"}}/></span>
                  <span className="yl-habit-count">{routineDoneToday}/{allRoutines.length}</span>
                </section>
              )}
              {(()=>{const mems=items.filter(x=>x.type==="memory"&&firstPhotoId(x)&&photos[firstPhotoId(x)]).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)).slice(0,3);if(mems.length===0)return null;return(
                <section className="yl-hmem">
                  <div className="yl-hmem-head"><span className="yl-hmem-title">思い出</span><button className="yl-hmem-more" onClick={()=>{const sp=members[0]?members[0].id:"me";setTab(sp);setPersonSeg("record");}}>もっと見る</button></div>
                  <div className="yl-hmem-strip">{mems.map(m=>(<button key={m.id} className="yl-hmem-cell" onClick={()=>viewPhoto(firstPhotoId(m))}><img src={photos[firstPhotoId(m)]} alt=""/></button>))}</div>
                </section>
              );})()}
            </div>

            {/* 安全・緊急：いざという時のショートカット。日常の主役ではないので下部に控えめに（メニュー・設定からも開ける） */}
            {spaces.length>0&&(
              <section className="yl-safety">
                <span className="yl-safety-label"><Icon name="shield" size={14}/> {t("safety.sectionLabel")}</span>
                <p className="yl-safety-note">{t("safety.sectionNote")}</p>
                <div className="yl-safety-acts">
                  {petMembers.length>0&&<button className="yl-safety-btn" onClick={()=>{setToxicSp("all");setToxicQ("");setToxicOpen(true);}}><Icon name="alert" size={15}/> {t("safety.toxicShort")}</button>}
                  <button className="yl-safety-btn" onClick={()=>setEmergencyOpen(true)}><Icon name="activity" size={15}/> {t("safety.emergencyShort")}</button>
                  {(members.some(m=>m.kind==="person")||meBirthday||items.some(x=>x.space==="me"&&x.type==="card"))&&<button className="yl-safety-btn" onClick={()=>{const sel=members.find(m=>m.id===memberSel&&m.kind==="person");const tg=sel?sel.id:(members.find(m=>m.kind==="person")?.id||"me");setTab(tg);setMemberSel(tg);setPersonSeg("record");setEmergencyCardOpen(true);}}><Icon name="filetext" size={15}/> {t("safety.emergencyCard")}</button>}
                  {petMembers.length>0&&<button className="yl-safety-btn" onClick={()=>{const sel=petMembers.find(m=>m.id===memberSel);const tg=sel?sel.id:petMembers[0].id;setTab(tg);setMemberSel(tg);setPersonSeg("manage");setLostOpen(true);}}><Icon name="paw" size={15}/> {t("safety.lostPoster")}</button>}
                  <button className="yl-safety-btn" onClick={()=>setDisasterOpen(true)}><Icon name="home" size={15}/> {t("safety.disasterShort")}</button>
                </div>
              </section>
            )}

            {/* ━━ 第3層「記録」：低頻度。既定で畳んで安心の場を守る ━━ */}
            <div className="yl-layer">
              <button className="yl-layer-toggle" onClick={()=>setRecOpen(o=>!o)}>
                <span className="yl-layer-label rec">記録</span>
                {restockList.length>0&&<span className="yl-layer-badge">買い足し {restockList.length}</span>}
                <span className="yl-layer-arrow">{recOpen?"▲":"▼"}</span>
              </button>
              {recOpen&&(
                <div className="yl-layer-body">
                  {homeExpense.total>0&&(
                    <section className="yl-hexp">
                      <div className="yl-hexp-top"><span className="yl-hexp-label">今月の支出</span><span className="yl-hexp-total">{fmtYen(homeExpense.total)}</span></div>
                      {homeExpense.rows.length>1&&(
                        <ul className="yl-hexp-rows">
                          {homeExpense.rows.slice(0,4).map(r=>(
                            <li key={r.space}><button className="yl-hexp-row" onClick={()=>setTab(r.space)}>
                              <span className="yl-hexp-name">{r.name}{r.spike&&<span className="yl-hexp-spike"><Icon name="alert" size={12}/> 先月より増</span>}</span>
                              <span className="yl-hexp-amt">{fmtYen(r.amount)}</span>
                            </button></li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}
                  {restockList.length>0&&(
                    <section className="yl-supply">
                      <h2 className="yl-sec-title">{t("home.restock")}</h2>
                      <ul className="yl-supply-list">
                        {restockList.map(r=>(
                          <li key={r.kind+":"+r.id} className={"yl-supply-item "+r.tone}>
                            <button className="yl-supply-main" onClick={()=>{setTab(r.item.space);if(r.kind==="care")setPersonSeg("manage");}}>
                              <span className="yl-supply-emoji"><Icon name={r.kind==="care"?"pill":guessIcon(r.item.title,"package")} size={18}/></span>
                              <span className="yl-supply-info">
                                <span className="yl-supply-name">{r.item.title}<span className="yl-supply-who">{(lang==="ja"?" ・":" · ")+nameOf(r.item.space)}</span></span>
                                <span className={"yl-supply-line "+r.tone}>{r.line}</span>
                              </span>
                            </button>
                            {r.kind==="supply"?<button className="yl-supply-bought" onClick={()=>markBought(r.item.id)}>{t("supply.bought")}</button>:<button className="yl-supply-bought" onClick={()=>{setTab(r.item.space);setPersonSeg("manage");}}>{t("supply.check")}</button>}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <section className="yl-summary"><h2 className="yl-sec-title light">{t("home.recap")}</h2><div className="yl-summary-row"><div className="yl-stat"><span className="yl-stat-n">{weekDone}</span><span className="yl-stat-l">{t("home.statWeekCare")}</span></div><div className="yl-stat"><span className="yl-stat-n">{allRoutines.length>0?`${routineDoneToday}/${allRoutines.length}`:"—"}</span><span className="yl-stat-l">{t("home.statTodayRoutine")}</span></div></div></section>
                  {homeExpense.total===0&&restockList.length===0&&<p className="yl-routine-empty" style={{padding:"4px 0"}}>記録はまだありません</p>}
                </div>
              )}
            </div>
            <button className="yl-reset" onClick={()=>setConfirmReset(true)}>⟳ サンプルを消して最初から</button>
          </div>
        ):tab==="cal"?(
          <div className="yl-cal">
            <div className="yl-cal-filter">
              <button className={"yl-cal-fchip"+(calFilter==="all"?" on":"")} onClick={()=>setCalFilter("all")}><Icon name="users" size={14}/> {t("common.all")}</button>
              {spaces.map(s=><button key={s.id} className={"yl-cal-fchip"+(calFilter===s.id?" on":"")} onClick={()=>{setCalFilter(s.id);setMemberSel(s.id);}}><span className="yl-cal-fdot" style={{background:colorOf(s.id)}}/>{s.name}</button>)}
            </div>
            <div className="yl-cal-head">
              <button className="yl-cal-nav" onClick={()=>moveMonth(-1)} aria-label={t("a11y.prevMonth")}>‹</button>
              <span className="yl-cal-month">{monthLabel}</span>
              <button className="yl-cal-nav" onClick={()=>moveMonth(1)} aria-label={t("a11y.nextMonth")}>›</button>
            </div>
            <div className="yl-cal-dow">{weekdaysShort.map((w,i)=><span key={i} className={"yl-cal-dowc"+(i===0?" sun":i===6?" sat":"")}>{w}</span>)}</div>
            <div className="yl-cal-grid">
              {calGrid.map((c,i)=>c?(
                <button key={c.iso} className={"yl-cal-cell"+(c.iso===todayIso?" today":"")+(c.iso===calDay?" sel":"")} onClick={()=>setCalDay(c.iso===calDay?null:c.iso)}>
                  <span className={"yl-cal-dnum"+(dowOf(c.iso)===0?" sun":dowOf(c.iso)===6?" sat":"")}>{c.d}</span>
                  {c.count>0&&(()=>{const shown=c.count<=4?c.count:3;return(
                    <span className="yl-cal-dots">
                      {c.dots.slice(0,shown).map((col,ci)=><span key={ci} className="yl-cal-dot" style={{background:col}}/>)}
                      {c.count>shown&&<span className="yl-cal-more">+{c.count-shown}</span>}
                    </span>
                  );})()}
                </button>
              ):<span key={"e"+i} className="yl-cal-cell empty"/>)}
            </div>
            {calDay&&(
              <section className="yl-cal-day">
                <div className="yl-cal-day-head">
                  <h3 className="yl-cal-day-title">{t("cal.dayTitle",{md:(lang==="ja"?fmtMonthDay(calDay):fmtDateLoc(calDay,lang)),wd:weekdaysShort[dowOf(calDay)]})}</h3>
                  <button className="yl-cal-add" onClick={()=>openLifeNew(calDay,calFilter==="all"?"me":calFilter)}>{t("cal.addRecord")}</button>
                </div>
                {dayTimeline.length===0?(
                  <p className="yl-routine-empty" style={{padding:"8px 0 4px"}}>{t("cal.noRecords")}</p>
                ):(
                  <ul className="yl-tlday">
                    {dayTimeline.map((e,idx)=>e.anniv?(
                      <li key={"a"+idx} className="yl-tlday-item anniv">
                        <span className="yl-tlday-time"><Icon name="gift" size={15}/></span>
                        <span className="yl-tlday-emoji"><Icon name={guessIcon(e.anniv.label,"cake")} size={17}/></span>
                        <span className="yl-tlday-body"><span className="yl-tlday-text">{e.anniv.label}</span></span>
                      </li>
                    ):e.chore?(
                      <li key={"c"+idx} className="yl-tlday-item chore" style={{borderLeftColor:colorOf(e.chore.space)}}>
                        <span className="yl-tlday-time"><Icon name="sparkles" size={15}/></span>
                        <span className="yl-tlday-emoji"><Icon name={guessIcon(e.chore.title)} size={17}/></span>
                        <span className="yl-tlday-body"><span className="yl-tlday-text">{e.chore.title}{nameOf(e.chore.space)&&calFilter==="all"?<span className="yl-tlday-who"> ・{nameOf(e.chore.space)}</span>:null}</span></span>
                      </li>
                    ):(
                      <li key={e.item.id} className={"yl-tlday-item cat-"+calCategory(e.item)+(((e.item.type==="memory"||e.item.type==="event"||e.item.type==="care"))?" tap":"")} style={{borderLeftColor:colorOf(e.item.space)}} onClick={()=>(e.item.type==="memory"||e.item.type==="event"||e.item.type==="care")?openLifeEdit(e.item):null}>
                        <span className="yl-tlday-time">{e.item.time||"—"}</span>
                        {firstPhotoId(e.item)&&photos[firstPhotoId(e.item)]?<span className="yl-tlday-thumbwrap"><img className="yl-tlday-thumb" src={photos[firstPhotoId(e.item)]} alt=""/>{photoIdsOf(e.item).length>1&&<span className="yl-photo-badge">+{photoIdsOf(e.item).length-1}</span>}</span>:<span className="yl-tlday-emoji"><Icon name={guessIcon(e.item.title,"calendar")} size={17}/></span>}
                        <span className="yl-tlday-body">
                          <span className="yl-tlday-text">{e.item.title}{nameOf(e.item.space)&&calFilter==="all"?<span className="yl-tlday-who"> ・{nameOf(e.item.space)}</span>:null}</span>
                          {e.item.note&&<span className="yl-tlday-note">{e.item.note}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            <button className="yl-cal-exportall" onClick={()=>setCalPicker({bulk:true})}><Icon name="download" size={16}/> {t("cal.exportIcs")}</button>
            <p className="yl-foot" style={{marginTop:8}}>{t("cal.foot")}</p>
          </div>
        ):tab==="settings"?(
          <div className="yl-settings">
            <h2 className="yl-sec-title" style={{marginBottom:12}}>{t("settings.title")}</h2>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="globe" size={16}/> {t("set.language")}</h3>
              <div className="yl-theme-seg" role="group" aria-label={t("set.language")}>
                {[["ja","日本語","🇯🇵"],["en","English","🇺🇸"],["es","Español","🇪🇸"],["zh","简体中文","🇨🇳"]].map(([v,label,flag])=>(
                  <button key={v} className={"yl-theme-opt"+(lang===v?" on":"")} onClick={()=>setLang(v)} aria-pressed={lang===v}>
                    <span aria-hidden="true">{flag}</span> <span>{label}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="sun" size={16}/> {t("set.appearance")}</h3>
              <div className="yl-theme-seg" role="group" aria-label={t("theme.aria")}>
                {[["system",t("theme.system"),"phone"],["light",t("theme.light"),"sun"],["dark",t("theme.dark"),"moon"]].map(([v,label,ic])=>(
                  <button key={v} className={"yl-theme-opt"+(theme===v?" on":"")} onClick={()=>setTheme(v)} aria-pressed={theme===v}>
                    <Icon name={ic} size={16}/> <span>{label}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="bell" size={16}/> {t("set.notifications")}</h3>
              <p className="yl-set-desc">{t("set.notifDesc")}</p>
              {notifPerm==="granted"?<p className="yl-set-ok"><Icon name="check" size={13}/> {t("set.notifOn")}</p>:notifPerm==="denied"?<p className="yl-set-warn">{t("set.notifDenied")}</p>:<button className="yl-addbtn sm" onClick={handleNotifRequest}>{t("set.notifAllow")}</button>}
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="thermometer" size={16}/> {t("set.weather")}</h3>
              <p className="yl-set-desc">{t("set.weatherDesc",{n:LOC_MAX})}</p>
              {weatherLocs.length>0&&<ul className="yl-wxmanage">{weatherLocs.map((l,i)=>(
                <li key={l.id} className="yl-wxmrow">
                  {wxRename&&wxRename.id===l.id?(
                    <span className="yl-wxm-edit"><input className="yl-input sm" value={wxRename.val} onChange={e=>setWxRename({id:l.id,val:e.target.value})} onKeyDown={e=>e.key==="Enter"&&(()=>{renamePlace(l.id,wxRename.val);setWxRename(null);})()} placeholder={t("wx.namePlaceholder")} autoFocus/><button className="yl-addbtn sm" onClick={()=>{renamePlace(l.id,wxRename.val);setWxRename(null);}}>{t("common.save")}</button><button className="yl-modal-cancel" onClick={()=>setWxRename(null)}>{t("common.cancel")}</button></span>
                  ):(<>
                    <span className="yl-wxm-name"><Icon name="pin" size={13}/> <span className="yl-wxm-nametext">{l.name}</span>{i===0&&<span className="yl-wxm-badge">{t("wx.first")}</span>}</span>
                    <span className="yl-wxm-acts">
                      <button className="yl-wxm-btn" onClick={()=>movePlace(l.id,-1)} disabled={i===0} aria-label={t("wx.moveUp")}>↑</button>
                      <button className="yl-wxm-btn" onClick={()=>movePlace(l.id,1)} disabled={i===weatherLocs.length-1} aria-label={t("wx.moveDown")}>↓</button>
                      {i!==0&&<button className="yl-wxm-btn" onClick={()=>pinPlace(l.id)} aria-label={t("wx.pinTop")}>★</button>}
                      <button className="yl-wxm-btn" onClick={()=>setWxRename({id:l.id,val:l.name})} aria-label={t("wx.rename")}><Icon name="pencil" size={13}/></button>
                      <button className="yl-wxm-btn del" onClick={()=>removePlace(l.id)} aria-label={t("wx.delete")}>×</button>
                    </span>
                  </>)}
                </li>
              ))}</ul>}
              {weatherLocs.length<LOC_MAX?<button className="yl-addbtn sm" onClick={()=>setWxAddOpen(true)}><Icon name="plus" size={14}/> {t("set.addLocation")}</button>:<p className="yl-set-desc">{t("set.weatherMax",{n:LOC_MAX})}</p>}
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="clock" size={16}/> {t("set.colorTime")}</h3>
              <div className="yl-colordays">
                <label className="yl-colordays-field"><span className="yl-legend-dot warn"/> {t("set.colorWarn")}<span className="yl-colordays-inp"><input type="number" inputMode="numeric" min="1" className="yl-health-num" value={colorDays.warn} onChange={e=>{const w=Math.max(1,parseInt(e.target.value||"1",10));persistColorDays({warn:w,alert:Math.max(w+1,colorDays.alert)});}}/>{t("unit.dShort")}</span></label>
                <label className="yl-colordays-field"><span className="yl-legend-dot alert"/> {t("set.colorAlert")}<span className="yl-colordays-inp"><input type="number" inputMode="numeric" min="2" className="yl-health-num" value={colorDays.alert} onChange={e=>{const a=Math.max(2,parseInt(e.target.value||"2",10));persistColorDays({warn:Math.min(colorDays.warn,a-1),alert:a});}}/>{t("unit.dShort")}</span></label>
              </div>
              <p className="yl-set-desc" style={{marginTop:6}}>{t("set.colorNow")}{colorDays.warn}{t("set.colorDaySuffix")}<span className="yl-legend-dot warn"/>・{colorDays.alert}{t("set.colorDaySuffix")}<span className="yl-legend-dot alert"/></p>
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="alert" size={16}/> {t("set.petSafety")}</h3>
              <div className="yl-set-actions">
                <button className="yl-addbtn sm" onClick={()=>{setToxicSp("all");setToxicQ("");setToxicOpen(true);}}><Icon name="alert" size={14}/> {t("safety.toxic")}</button>
                <button className="yl-addbtn sm" onClick={()=>setEmergencyOpen(true)}><Icon name="activity" size={14}/> {t("safety.emergency")}</button>
                <button className="yl-addbtn sm" onClick={()=>setDisasterOpen(true)}><Icon name="home" size={14}/> {t("safety.disaster")}</button>
              </div>
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="download" size={16}/> {t("set.backup")}</h3>
              <p className="yl-set-desc">{t("set.backupDesc")}<span className="yl-nowrap">{t("set.backupDesc2")}</span></p>
              <div className="yl-set-actions">
                <button className="yl-addbtn sm" onClick={exportData}><Icon name="download" size={14}/> {t("backup.export")}</button>
                <button className="yl-addbtn sm" onClick={exportCSV}><Icon name="filetext" size={14}/> {t("backup.exportCsv")}</button>
                {confirmRestore?(
                  <div className="yl-restore-confirm">
                    <p className="yl-set-warn" style={{margin:"0 0 8px"}}>{t("backup.restoreWarn")}</p>
                    <label className="yl-addbtn sm" style={{display:"inline-flex",cursor:"pointer"}}><Icon name="folder" size={14}/> {t("backup.chooseFile")}<input type="file" accept="application/json,.json" style={{display:"none"}} onChange={importData}/></label>
                    <button className="yl-modal-cancel" style={{marginLeft:8}} onClick={()=>setConfirmRestore(false)}>{t("common.stop")}</button>
                  </div>
                ):(
                  <button className="yl-reset" onClick={()=>setConfirmRestore(true)}><Icon name="folder" size={14}/> {t("backup.restore")}</button>
                )}
              </div>
            </section>
            {FB_READY&&(
              <section className="yl-set-sec">
                <h3 className="yl-set-title"><Icon name="users" size={16}/> {t("set.familyShare")}</h3>
                <div className="yl-set-actions"><button className="yl-addbtn sm" onClick={()=>setShowShareModal(true)}>{t("share.settings")}</button></div>
              </section>
            )}
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="note" size={16}/> {t("set.about")}</h3>
              <div className="yl-set-actions">
                <button className="yl-addbtn sm" onClick={()=>setHelpOpen(true)}>{t("about.help")}</button>
                <button className="yl-addbtn sm" onClick={()=>setWhatsNewOpen(true)}><Icon name="sparkles" size={14}/> {t("about.whatsNew")}</button>
                <button className="yl-addbtn sm" onClick={()=>{resetGuides();startTour();}}><Icon name="sparkles" size={14}/> {t("about.tourAgain")}</button>
                <button className="yl-addbtn sm" onClick={()=>setAboutOpen(true)}><Icon name="note" size={14}/> {t("about.aboutApp")}</button>
                <button className="yl-reset" onClick={()=>setConfirmReset(true)}>⟳ {t("about.reset")}</button>
              </div>
            </section>
          </div>
        ):(
          <>
            {/* メンバーのヒーロー：写真を主役に、名前・年齢・今日の状態を大きく（ペットも人も共通で常時表示） */}
            {isMemberTab&&(()=>{
              const isPet=activeMember.kind==="pet";
              const lv=spaceLevel(activeMember.id);const concern=spaceConcern(activeMember.id);
              const statusText=concern||(lv==="none"?t("home.okNoRecord"):t("home.okPet",{name:activeMember.name}));
              const photo=activeMember.avatar&&photos[activeMember.avatar];
              const memo=!!activeMember.memorial;
              const together=activeMember.gotchaDay?daysTogether(activeMember.gotchaDay,activeMember.memorial):null;
              const ptLabel=t("ptype."+(activeMember.personType||"child"))||t("prof.familyDefault");
              const sub=isPet
                ?([activeMember.breed,activeMember.birthday&&ageLabel(activeMember.birthday)].filter(Boolean).join(" · ")||(activeMember.species==="cat"?t("sp.catShort"):activeMember.species==="dog"?t("sp.dogShort"):t("sp.petShort")))
                :([activeMember.birthday&&ageLabel(activeMember.birthday)].filter(Boolean).join(" · ")||ptLabel);
              const openEdit=()=>{setEditingId(activeMember.id);setEditName(activeMember.name);setEditNickname(activeMember.nickname||"");setEditBirthday(activeMember.birthday||"");setEditGotcha(activeMember.gotchaDay||"");setEditGroup(activeMember.group||"");setEditMicrochip(activeMember.microchip||"");setEditBreed(activeMember.breed||"");setEditCoat(activeMember.coat||"");setEditNeuter(activeMember.neuter||"");setEditMemorial(activeMember.memorial||"");setEditAvatar(activeMember.avatar||"");setEditVisibility(activeMember.visibility||"household");setEditPersonType(activeMember.personType||"child");setEditGender(activeMember.gender||"");setEditBlood(activeMember.blood||"");setProfileOpen(true);};
              return(
                <section className={"yl-hero"+(memo?" memorial":"")}>
                  <button className="yl-hero-photo" onClick={openEdit} aria-label={t("a11y.editPhotoProfile")}>
                    {photo?<img src={photo} alt=""/>:<span className="yl-hero-ph"><Icon name="camera" size={26}/><span>{t("hero.addPhoto")}</span></span>}
                  </button>
                  <div className="yl-hero-body">
                    <h2 className="yl-hero-name">{activeMember.name}{activeMember.nickname?`（${activeMember.nickname}）`:""}</h2>
                    <p className="yl-hero-sub">{sub}</p>
                    {memo?<span className="yl-hero-memorial"><Icon name="sparkles" size={13}/> {t("hero.rainbow")} {fmtBirthday(activeMember.memorial)}{together?t("hero.togetherThanks",{n:together}):""}</span>:<span className={"yl-hero-status lv-"+lv}><span className="yl-hero-dot"/>{statusText}</span>}
                  </div>
                  <button className="yl-hero-edit" onClick={openEdit} aria-label={t("a11y.editProfile")}><Icon name="pencil" size={17}/></button>
                </section>
              );
            })()}
            {/* プロフィールは畳む：細いバー＋ⓘで開閉。ケア状態だけは常時表示（見守りの安心） */}
            <div className="yl-profbar">
              {isMemberTab&&activeMember.kind!=="pet"&&(()=>{const over=memberStats?.over||0,soon=memberStats?.soon||0;return over>0?<span className="yl-pill over"><Icon name="alert" size={13}/> {t("care.overdue",{n:over})}</span>:soon>0?<span className="yl-pill soon"><Icon name="clock" size={13}/> {t("care.soon",{n:soon})}</span>:<span className="yl-pill ok"><Icon name="check" size={13}/> {t("care.ok")}</span>;})()}
              <button className="yl-profbar-toggle" onClick={()=>setProfileOpen(o=>!o)}>{t("prof.title",{name:isMemberTab?activeMember.name:(meName||t("common.me"))})} {profileOpen?"▲":"▼"}</button>
            </div>
            {(profileOpen||(isMemberTab&&editingId===activeMember.id))&&(<>
            {!isMemberTab?<section className="yl-hero"><button className="yl-hero-photo" onClick={()=>{setMeNameDraft(meName);setMePicker(true);}} aria-label={t("a11y.editIconName")}>{meAvatar&&photos[meAvatar]?<img src={photos[meAvatar]} alt=""/>:<span className="yl-hero-emoji">{meEmoji}</span>}</button><div className="yl-hero-body"><h2 className="yl-hero-name">{meName||t("common.me")}</h2><div className="yl-me-bday">{meBdayEdit?<div className="yl-me-bday-edit"><BdayInput value={meBdayDraft} onChange={setMeBdayDraft}/><button className="yl-addbtn sm" onClick={()=>{persistMeBirthday(meBdayDraft);setMeBdayEdit(false);}}>{t("common.save")}</button><button className="yl-modal-cancel" onClick={()=>setMeBdayEdit(false)}>{t("common.cancel")}</button></div>:<button className="yl-me-bday-btn" onClick={()=>{setMeBdayDraft(meBirthday);setMeBdayEdit(true);}}><Icon name="cake" size={13}/> {meBirthday?`${fmtBirthday(meBirthday)}${ageLabel(meBirthday)?`（${ageLabel(meBirthday)}）`:""}`:t("me.setBirthday")}</button>}</div></div><button className="yl-hero-edit" onClick={()=>{setMeNameDraft(meName);setMePicker(true);}} aria-label={t("a11y.editIconName")}><Icon name="pencil" size={17}/></button></section>:(
              <section className="yl-petstatus">
                <div className="yl-petstatus-head">
                  {editingId===activeMember.id?(
                    <div className="yl-rename">
                      <div className="yl-editavatar">
                        {editAvatar&&photos[editAvatar]?<img className="yl-avatar lg" src={photos[editAvatar]} alt=""/>:<span className="yl-editavatar-emoji">{activeMember.emoji}</span>}
                        <label className="yl-editavatar-btn"><Icon name="camera" size={14}/> {t("prof.usePhoto")}<input type="file" accept="image/*" style={{display:"none"}} onChange={pickAvatar}/></label>
                        {editAvatar&&<button className="yl-editavatar-clear" onClick={()=>setEditAvatar("")}>{t("prof.backToEmoji")}</button>}
                      </div>
                      <IMEInput className="yl-input sm" value={editName} onChange={setEditName} onKeyDown={e=>e.key==="Enter"&&saveRename(activeMember.id)} placeholder={t("ph.name")} autoFocus/>
                      {activeMember.kind==="person"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="smile" size={14}/> {t("prof.nickname")}<input className="yl-input sm" style={{marginTop:4}} value={editNickname} onChange={e=>setEditNickname(e.target.value)} placeholder={t("ph.nickname")}/></label>}
                      <label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="folder" size={14}/> {t("prof.folder")}<input className="yl-input sm" style={{marginTop:4}} value={editGroup} onChange={e=>setEditGroup(e.target.value)} placeholder={activeMember.kind==="person"?t("ph.folderPerson"):t("ph.folderPet")}/></label>
                      <div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="palette" size={14}/> {t("prof.calColor")}<span className="yl-colorrow">{MEMBER_COLORS.map(col=><button key={col} className={"yl-colordot"+(colorOf(activeMember.id)===col?" on":"")} style={{background:col}} onClick={()=>setMemberColor(col)} aria-label={t("a11y.pickColor")}/>)}</span><span className="yl-set-desc" style={{width:"100%",marginTop:4}}>{t("prof.calColorDesc")}</span></div>
                      <label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="cake" size={14}/> {t("prof.birthday")}<BdayInput value={editBirthday} onChange={setEditBirthday}/></label>
                      {activeMember.kind==="pet"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="gift" size={14}/> {t("prof.gotcha")}<BdayInput value={editGotcha} onChange={setEditGotcha}/><span className="yl-set-desc" style={{width:"100%",marginTop:4}}>{t("prof.gotchaDesc")}</span></label>}
                      {activeMember.kind==="pet"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="paw" size={14}/> {activeMember.species==="cat"?t("prof.breedCat"):activeMember.species==="dog"?t("prof.breedDog"):t("prof.breedOther")}{t("common.optional")}<input className="yl-input sm" style={{marginTop:4}} list="yl-breed-list" value={editBreed} onChange={e=>setEditBreed(e.target.value)} placeholder={activeMember.species==="dog"?t("ph.breedDog"):activeMember.species==="cat"?t("ph.breedCat"):t("ph.breedOther")}/><datalist id="yl-breed-list">{breedOptionsFor(activeMember.species).map(b=><option key={b} value={b}/>)}</datalist><span className="yl-set-desc" style={{width:"100%",marginTop:4}}>{activeMember.species==="dog"?t("prof.breedDescDog"):t("prof.breedDescOther")}</span></label>}
                      {activeMember.kind==="pet"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="palette" size={14}/> {t("prof.coat")}<input className="yl-input sm" style={{marginTop:4}} list="yl-coat-list" value={editCoat} onChange={e=>setEditCoat(e.target.value)} placeholder={t("ph.coat")}/><datalist id="yl-coat-list">{coatOptionsFor(activeMember.species).map(c=><option key={c} value={c}/>)}</datalist></label>}
                      {activeMember.kind==="pet"&&<div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="heart" size={14}/> {t("prof.gender")}<span className="yl-seg-mini">{[{k:"男の子",l:t("gender.boy")},{k:"女の子",l:t("gender.girl")}].map(o=><button key={o.k} className={"yl-seg-mini-btn"+(editGender===o.k?" on":"")} onClick={()=>setEditGender(editGender===o.k?"":o.k)}>{o.l}</button>)}</span><span className="yl-set-desc" style={{width:"100%",marginTop:4}}>{t("prof.genderDesc")}</span></div>}
                      {activeMember.kind==="pet"&&<div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="scissors" size={14}/> {t("prof.neuter")}<span className="yl-seg-mini">{[{k:"done",l:t("neuter.done")},{k:"not",l:t("neuter.not")}].map(o=><button key={o.k} className={"yl-seg-mini-btn"+(editNeuter===o.k?" on":"")} onClick={()=>setEditNeuter(editNeuter===o.k?"":o.k)}>{o.l}</button>)}</span></div>}
                      {activeMember.kind==="pet"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="hash" size={14}/> {t("prof.microchip")}<input className="yl-input sm" style={{marginTop:4}} inputMode="numeric" value={editMicrochip} onChange={e=>setEditMicrochip(e.target.value)} placeholder={t("ph.microchip")}/><span className="yl-set-desc" style={{width:"100%",marginTop:4}}>{t("prof.microchipDesc")}</span></label>}
                      {activeMember.kind==="person"&&<div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="users" size={14}/> {t("prof.personType")}<span className="yl-seg-mini">{PERSON_TYPES.map(o=><button key={o.k} className={"yl-seg-mini-btn"+(editPersonType===o.k?" on":"")} onClick={()=>setEditPersonType(o.k)}>{t("ptype."+o.k)}</button>)}</span></div>}
                      {activeMember.kind==="person"&&<div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="smile" size={14}/> {t("prof.gender")}<span className="yl-seg-mini">{genderOptsFor(editPersonType).map(o=><button key={o.k} className={"yl-seg-mini-btn"+(editGender===o.k?" on":"")} onClick={()=>setEditGender(editGender===o.k?"":o.k)}>{o.l}</button>)}</span></div>}
                      {activeMember.kind==="person"&&<div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="droplet" size={14}/> {t("prof.blood")}<span className="yl-seg-mini">{BLOOD_OPTS.map(o=><button key={o} className={"yl-seg-mini-btn"+(editBlood===o?" on":"")} onClick={()=>setEditBlood(editBlood===o?"":o)}>{o}</button>)}</span></div>}
                      {activeMember.kind==="pet"&&<div className="yl-opt yl-memorial-opt" style={{marginTop:10,width:"100%"}}><Icon name="sparkles" size={14}/> {t("prof.rainbow")}
                        {editMemorial?<span className="yl-memorial-set"><span className="yl-memorial-date"><BdayInput value={editMemorial} onChange={setEditMemorial}/></span><button className="yl-linkbtn" onClick={()=>setEditMemorial("")}>{t("common.clear")}</button></span>:<button className="yl-memorial-btn" onClick={()=>setEditMemorial(todayIso)}>{t("prof.rainbowSet")}</button>}
                        <span className="yl-set-desc" style={{marginTop:4}}>{t("prof.rainbowDesc")}</span>
                      </div>}
                      {inHousehold&&<div style={{marginTop:8}}><VisibilityToggle value={editVisibility} onChange={setEditVisibility}/><span className="yl-set-desc" style={{marginTop:4,display:"block"}}>{editVisibility==="household"?t("prof.visShared"):t("prof.visPrivate")}{t("prof.visNote")}</span></div>}
                      <button className="yl-member-save" onClick={()=>saveRename(activeMember.id)}><Icon name="check" size={16}/> {t("prof.saveMember")}</button>
                      <button className="yl-member-del" onClick={()=>setConfirmDel(activeMember)}>{t("prof.deleteMember")}</button>
                    </div>
                  ):(
                    <span className="yl-petstatus-title" style={{color:KIND_STYLE[activeMember.kind].fg}}>
                      {avatarNode(activeMember,"sm")} {t("rec.memberTitle",{name:activeMember.name,word:t("word."+activeMember.kind)})}
                      <button className="yl-icon" onClick={()=>{setEditingId(activeMember.id);setEditName(activeMember.name);setEditNickname(activeMember.nickname||"");setEditBirthday(activeMember.birthday||"");setEditGotcha(activeMember.gotchaDay||"");setEditGroup(activeMember.group||"");setEditMicrochip(activeMember.microchip||"");setEditBreed(activeMember.breed||"");setEditCoat(activeMember.coat||"");setEditNeuter(activeMember.neuter||"");setEditMemorial(activeMember.memorial||"");setEditAvatar(activeMember.avatar||"");setEditVisibility(activeMember.visibility||"household");setEditPersonType(activeMember.personType||"child");setEditGender(activeMember.gender||"");setEditBlood(activeMember.blood||"");}}><Icon name="pencil" size={15}/></button>
                    </span>
                  )}
                </div>
                {/* ケア帯＝緊急度。異常が無い時は「順調 ✅」1個に畳み、数字が立った時だけ目立たせる */}
                <div className="yl-petstatus-chips">
                  {(memberStats?.over||0)>0&&<span className="yl-pill over"><Icon name="alert" size={13}/> {t("care.overdue",{n:memberStats.over})}</span>}
                  {(memberStats?.soon||0)>0&&<span className="yl-pill soon"><Icon name="clock" size={13}/> {t("care.soon",{n:memberStats.soon})}</span>}
                  {!(memberStats?.over)&&!(memberStats?.soon)&&<span className="yl-pill ok"><Icon name="check" size={13}/> {t("care.ok")}</span>}
                  {inHousehold&&<span className={"yl-pill vis"+(activeMember.visibility==="private"?" private":"")}>{activeMember.visibility==="private"?<><Icon name="shield" size={11}/> {t("vis.private")}</>:<><Icon name="users" size={11}/> {t("vis.shared")}</>}</span>}
                </div>
                {/* 誕生日・記念日＝お楽しみ。緊急度とは別の帯にして脳の使いどころを分ける */}
                {(activeMember.birthday||activeMember.gotchaDay||activeMember.microchip||activeMember.breed||activeMember.coat||activeMember.neuter||activeMember.gender||activeMember.blood)&&(
                  <div className="yl-petstatus-fun">
                    {activeMember.gender&&<span className="yl-funchip"><Icon name="smile" size={13}/>{genderLabel(activeMember.gender,activeMember.personType)}</span>}
                    {activeMember.blood&&<span className="yl-funchip"><Icon name="droplet" size={13}/>{activeMember.blood}{t("blood.suffix")}</span>}
                    {activeMember.breed&&<span className="yl-funchip"><Icon name="paw" size={13}/>{activeMember.breed}</span>}
                    {activeMember.birthday&&<span className="yl-funchip"><Icon name="cake" size={13}/>{fmtBirthday(activeMember.birthday)}{ageLabel(activeMember.birthday)?`（${ageLabel(activeMember.birthday)}）`:""}</span>}
                    {activeMember.gotchaDay&&<span className="yl-funchip"><Icon name="heart" size={13}/>{(()=>{const y=yearsSinceAnniv(activeMember.gotchaDay);const dd=daysUntilAnniv(activeMember.gotchaDay);const an=ageNow(activeMember.gotchaDay);return dd===0?(y?t("fun.gotchaToday",{y}):t("fun.gotchaTodayNoYear")):(an!=null?t("fun.gotchaAnnivY",{date:fmtBirthday(activeMember.gotchaDay),y:an}):t("fun.gotchaAnniv",{date:fmtBirthday(activeMember.gotchaDay)}));})()}</span>}
                    {activeMember.gotchaDay&&daysTogether(activeMember.gotchaDay)!=null&&<span className="yl-funchip"><Icon name="home" size={13}/>{t("fun.together",{n:daysTogether(activeMember.gotchaDay).toLocaleString()})}</span>}
                    {activeMember.coat&&<span className="yl-funchip"><Icon name="palette" size={13}/>{activeMember.coat}</span>}
                    {activeMember.neuter&&<span className="yl-funchip"><Icon name="scissors" size={13}/>{t("fun.neuter",{s:activeMember.neuter==="done"?t("neuter.done"):t("neuter.not")})}</span>}
                    {activeMember.microchip&&<span className="yl-funchip"><Icon name="hash" size={13}/>{activeMember.microchip}</span>}
                  </div>
                )}
              </section>
            )}</>)}

            {/* 「家族」タブから家族・ペットを追加できることを明示する導線（ラベル付きCTA） */}
            {personSeg==="manage"&&(
              <div style={{marginBottom:12}}><button className="yl-chore-add" onClick={()=>setAdding(true)}><Icon name="plus" size={13}/> {t("member.addFamily")}</button></div>
            )}
            {isPersonMode&&(()=>{const defs=[];
              defs.push({key:"routine",el:(
                <section className="yl-routine">
                  <div className="yl-routine-head">
                    <h2 className="yl-routine-title">{t("rec.routineTitle")}</h2>
                    {routines.length>0&&<span className="yl-routine-prog">{routineDone} / {routines.length}</span>}
                  </div>
                  {routines.length===0?(
                    <p className="yl-routine-empty">{t("rec.addFromPlus")}</p>
                  ):(
                    <ul className="yl-timeline">
                      {routines.map(r=>{
                        const done=r.doneDate===todayIso;
                        return(
                          <li key={r.id} className={"yl-tl-item"+(done?" done":"")}>
                            <span className="yl-tl-time">{r.time||"--:--"}</span>
                            <span className="yl-tl-dot"/>
                            <button className="yl-tl-body" onClick={()=>openRoutineEdit(r)}>
                              <span className="yl-tl-emoji"><Icon name={guessIcon(r.title)} size={18}/></span>
                              <span className="yl-tl-text">{r.title}</span>
                              {r.reminders&&r.reminders.length>0&&<span className="yl-tl-bell"><Icon name="bell" size={13}/></span>}
                            </button>
                            <label className="yl-tl-photo" title="写真で思い出に残す" onClick={e=>e.stopPropagation()}><Icon name="camera" size={16}/><input type="file" accept="image/*" style={{display:"none"}} onChange={e=>addMemory(e,{space:r.space,title:r.title,emoji:r.emoji})}/></label>
                            <button className={"yl-check"+(done?" on":"")} onClick={()=>toggleRoutine(r.id)} aria-label="完了"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(()=>{const tpls=routineTemplatesFor(curKind).filter(t=>!routines.some(r=>r.title===t.title));return tpls.length>0&&(<div className="yl-chore-tpl" style={{marginTop:routines.length?10:6}}>{tpls.map(t=><button key={t.title} className="yl-chore-add" onClick={()=>openRoutineTemplate(t)}>＋ <Icon name={guessIcon(t.title)} size={14}/> {t.title}</button>)}</div>);})()}
                </section>
              )});
              defs.push({key:"chore",el:(
                <section className="yl-chore">
                  <h2 className="yl-routine-title" style={{marginBottom:4}}>{curKind==="pet"?t("rec.choreTitlePet"):curKind==="me"?t("rec.choreTitleMe"):t("rec.choreTitleOther")}</h2>
                  <p className="yl-set-desc" style={{marginBottom:10}}>{curKind==="pet"?t("rec.choreDescPet"):t("rec.choreDescOther")}</p>
                  {chores.length>0&&(
                    <ul className="yl-chore-list">
                      {chores.map(c=>{const el=elapsedLabel(c.lastDone,colorDays.warn,colorDays.alert);const editing=choreDateEdit&&choreDateEdit.id===c.id;return(
                        <li key={c.id} className="yl-chore-item">
                          <span className="yl-chore-emoji"><Icon name={guessIcon(c.title)} size={18}/></span>
                          <span className="yl-chore-body">
                            <span className="yl-chore-name">{c.title}</span>
                            {editing?(
                              <span className="yl-chore-dateedit">
                                <input type="date" className="yl-date" value={choreDateEdit.date} onChange={e=>setChoreDateEdit({id:c.id,date:e.target.value})}/>
                                <button className="yl-addbtn sm" onClick={()=>saveChoreDate(c.id,choreDateEdit.date)}>{t("common.save")}</button>
                                <button className="yl-chore-cancel" onClick={()=>setChoreDateEdit(null)}>{t("common.stop")}</button>
                              </span>
                            ):(
                              <button className={"yl-chore-since "+el.tone} onClick={()=>c.lastDone&&setChoreDateEdit({id:c.id,date:c.lastDone})} title={c.lastDone?t("rec.tapEditDate"):""}>{c.lastDone?t("rec.lastDone",{date:fmtDate(c.lastDone),txt:elText(el)}):elText(el)}{(c.history||[]).length>1?t("rec.totalCount",{n:c.history.length}):""}{c.lastDone?" ✎":""}</button>
                            )}
                          </span>
                          <button className="yl-chore-did" onClick={()=>logChore(c.id)}>{t("rec.did")}</button>
                          <button className="yl-chore-del" onClick={()=>askDelete(c.title,()=>removeChore(c.id))} aria-label={t("a11y.delete")}>×</button>
                        </li>
                      );})}
                    </ul>
                  )}
                  <div className="yl-chore-tpl">
                    {choreTemplatesFor(activeMember).filter(t=>!chores.some(c=>c.title===t.title)).map(t=><button key={t.title} className="yl-chore-add" onClick={()=>addChore(t.title,t.emoji)}>＋ <Icon name={guessIcon(t.title)} size={14}/> {t.title}</button>)}
                  </div>
                  <div className="yl-chore-custom">
                    <input className="yl-input sm" value={choreDraft} onChange={e=>setChoreDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustomChore()} placeholder="自分で追加（例：水そうじ）"/>
                    <button className="yl-addbtn sm" onClick={addCustomChore}>＋ 追加</button>
                  </div>
                </section>
              )});
              defs.push({key:"list",el:(
                <section className="yl-listsec">
                  {hasListItems&&<div className="yl-sort">{filterChips.map(f=><button key={f.key} className={"yl-sortbtn"+(filter===f.key?" on":"")} onClick={()=>setFilter(f.key)}>{isMemberTab&&f.key!=="all"&&<Icon name={careIcon(f.key)} size={13}/>}{f.label}</button>)}</div>}
                  {!loaded?<p className="yl-loading">よみこみ中…</p>:visible.length===0?<p className="yl-empty">右下の ＋ から追加できます</p>:(()=>{
                    const actList=visible.filter(x=>!x.done);const doneList=visible.filter(x=>x.done);
                    return(<>
                      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onCardDragEnd}>
                        <SortableContext items={actList.map(x=>x.id)} strategy={verticalListSortingStrategy}>
                          <ul className="yl-list">
                            {actList.map(it=><SortableCard key={it.id} id={it.id} className="yl-card">{cardInner(it)}</SortableCard>)}
                          </ul>
                        </SortableContext>
                      </DndContext>
                      {actList.length===0&&<p className="yl-empty" style={{marginTop:2}}>これからの予定はありません。</p>}
                      {doneList.length>0&&(
                        <div className="yl-donesec">
                          <button className="yl-donesec-head" onClick={()=>setDoneOpen(o=>!o)} aria-expanded={doneOpen}>
                            <Icon name="check" size={14}/> 完了済み（{doneList.length}）
                            <span className={"yl-donesec-caret"+(doneOpen?" open":"")}>⌄</span>
                          </button>
                          {doneOpen&&<ul className="yl-list yl-donesec-list">{doneList.map(it=><li key={it.id} className="yl-card is-done">{cardInner(it)}</li>)}</ul>}
                        </div>
                      )}
                    </>);
                  })()}
                  {visible.filter(x=>!x.done).length>1&&<p className="yl-foot" style={{marginTop:2}}>長押しで並び替え</p>}
                </section>
              )});
              if(curKind==="person"&&tomorrowBelongings.length>0)defs.push({key:"prep",el:(
                <section className="yl-belong">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>明日（{WEEKDAYS_JA[tomorrowDow]}）の準備</h2>
                  <div className="yl-prep">
                    <ul className="yl-prep-list">
                      {tomorrowBelongings.map(b=>(
                        <li key={b.id} className={"yl-prep-item"+(b.prepDate===tomorrowIso?" done":"")} onClick={()=>toggleBelongPrep(b.id)}>
                          <span className={"yl-prep-check"+(b.prepDate===tomorrowIso?" on":"")}>{b.prepDate===tomorrowIso?"✓":""}</span>
                          <span className="yl-prep-text">{b.title}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )});
              defs.push({key:"supply",el:(
                <section className="yl-supply">
                  <div className="yl-routine-head">
                    <h2 className="yl-routine-title">{t("supply.title")}</h2>
                  </div>
                  {supplies.length===0?(
                    <p className="yl-routine-empty">{tab==="me"?t("supply.emptyMe"):t("supply.empty")}</p>
                  ):(
                    <ul className="yl-supply-list">
                      {supplies.map(s=>{
                        const st=supplyStatus(s)||{tone:"ok",left:0};
                        return(
                          <li key={s.id} className={"yl-supply-item "+st.tone}>
                            <button className="yl-supply-main" onClick={()=>openSupplyEdit(s)}>
                              <span className="yl-supply-emoji"><Icon name={guessIcon(s.title,"package")} size={18}/></span>
                              <span className="yl-supply-info">
                                <span className="yl-supply-name">{s.title}</span>
                                <span className={"yl-supply-line "+st.tone}>{supplyLine(s)}</span>
                              </span>
                            </button>
                            <button className="yl-supply-bought" onClick={()=>markBought(s.id)}>{t("supply.bought")}</button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )});
              defs.push({key:"expense",el:(
                <section className="yl-exp">
                  <div className="yl-exp-head">
                    <h2 className="yl-routine-title" style={{margin:0}}>{t("exp.title")}</h2>
                    <span className="yl-exp-scope">{[{k:"this",l:nameOf(tab)||t("exp.scopeThisFallback")},{k:"all",l:t("exp.scopeAll")}].map(o=><button key={o.k} className={"yl-exp-scopebtn"+(expScope===o.k?" on":"")} onClick={()=>setExpScope(o.k)}><span className="yl-exp-scopelab">{o.l}</span></button>)}</span>
                  </div>
                  {expStats.total===0?<p className="yl-routine-empty">{expScope==="all"?t("exp.emptyAll"):t("exp.emptyThis")}</p>:(<>
                    <div className="yl-exp-stats">
                      <div className="yl-exp-stat"><span className="yl-exp-stat-l">{t("exp.total")}</span><strong className="yl-exp-stat-v">{fmtYen(expStats.total)}</strong></div>
                      <div className="yl-exp-stat"><span className="yl-exp-stat-l">{t("exp.year",{y:expStats.year})}</span><strong className="yl-exp-stat-v">{fmtYen(expStats.thisYear)}</strong></div>
                      <div className="yl-exp-stat"><span className="yl-exp-stat-l">{t("exp.monthlyAvg")}</span><strong className="yl-exp-stat-v">{fmtYen(expStats.monthlyAvg)}</strong></div>
                      <div className="yl-exp-stat"><span className="yl-exp-stat-l">{t("exp.annual")}</span><strong className="yl-exp-stat-v">{fmtYen(expStats.annual)}</strong></div>
                    </div>
                    {expScope==="all"&&expStats.byMember.length>0&&(
                      <div className="yl-exp-block">
                        <p className="yl-exp-blocktitle">{t("exp.byMember")}</p>
                        <ul className="yl-exp-members">
                          {expStats.byMember.map(m=>(
                            <li key={m.space} className="yl-exp-member">
                              <span className="yl-exp-member-name">{m.name}</span>
                              <span className="yl-exp-member-track"><span className="yl-exp-member-fill" style={{width:Math.max(4,Math.round(m.total/expStats.byMember[0].total*100))+"%"}}/></span>
                              <span className="yl-exp-member-amt">{fmtYen(m.total)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="yl-exp-block">
                      <p className="yl-exp-blocktitle">{t("exp.byCategory")}</p>
                      <div className="yl-exp-donutrow">
                        <div className="yl-donut" style={{background:`conic-gradient(${(()=>{let acc=0;const stops=expStats.cats.map(c=>{const s=acc/expStats.total*100;acc+=c.amount;const e=acc/expStats.total*100;return `${c.color} ${s}% ${e}%`;});return stops.join(",")||"#E5DED4 0% 100%"})()})`}}>
                          <div className="yl-donut-hole"><span>{t("exp.total")}</span><strong>{fmtYen(expStats.total)}</strong></div>
                        </div>
                        <ul className="yl-exp-legend">
                          {expStats.cats.map(c=>(
                            <li key={c.key} className="yl-exp-leg"><span className="yl-exp-leg-dot" style={{background:c.color}}/><span className="yl-exp-leg-name">{expCatLabel(c)}</span><span className="yl-exp-leg-amt">{fmtYen(c.amount)}</span><span className="yl-exp-leg-pct">{Math.round(c.amount/expStats.total*100)}%</span></li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="yl-exp-block">
                      <p className="yl-exp-blocktitle">{t("exp.trend")}{expStats.trendReady?t("exp.trendRecent",{n:expStats.trendMonths}):""}</p>
                      {expStats.trendReady?(()=>{const mx=Math.max(1,...expStats.series.map(s=>s.total));const monLab=(m)=>lang==="ja"?m+"月":MON_EN[m-1];return(
                        <div className="yl-exp-trend">
                          {expStats.series.map((s,i)=>(
                            <div key={s.ym} className="yl-exp-trendcol" title={`${monLab(s.m)} ${fmtYen(s.total)}`}>
                              <span className="yl-exp-trendbar-wrap"><span className="yl-exp-trendbar" style={{height:s.total>0?Math.max(4,Math.round(s.total/mx*100))+"%":"0"}}/></span>
                              <span className="yl-exp-trendlab">{(i===0||s.m===1||i===expStats.series.length-1)?monLab(s.m):""}</span>
                            </div>
                          ))}
                        </div>
                      );})():(
                        <p className="yl-exp-trend-empty">{t("exp.trendEmpty")}</p>
                      )}
                    </div>
                  </>)}
                  {expScope==="this"&&expenseRecords.length>0&&(
                    <ul className="yl-exp-list">
                      {expenseRecords.slice(0,8).map(r=>(
                        <li key={r.id} className="yl-exp-item tap" onClick={()=>openExpEdit(r)}>
                          <span className="yl-exp-idate">{fmtDate(r.date)}</span>
                          <span className="yl-exp-icat" style={{color:expCatMeta(r.category).color}}><Icon name={guessIcon(expCatMeta(r.category).label,"wallet")} size={13}/> {expCatLabel(expCatMeta(r.category))}</span>
                          {r.note&&<span className="yl-exp-inote">{r.note}</span>}
                          <span className="yl-exp-iamt">{fmtYen(r.amount)}</span>
                          <button className="yl-health-del" onClick={e=>{e.stopPropagation();askDelete(t("exp.delLabel",{date:fmtDate(r.date)}),()=>removeExpense(r.id));}} aria-label={t("a11y.delete")}>×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )});
              if(isMemberTab||curKind==="me")defs.push({key:"certs",el:(
                <section className="yl-certs">
                  <div className="yl-routine-head">
                    <h2 className="yl-routine-title">{t("certs.title")}</h2>
                    {(certs.length>0||careNoPhoto.length>0)&&<button className="yl-album-add" onClick={()=>{if(!isMemberTab)setSelfCare(true);setInputSheet("schedule");}}>{t("common.plusAdd")}</button>}
                  </div>
                  {(certs.length>0||careNoPhoto.length>0)&&(()=>{
                    const allCare=[...certs,...careNoPhoto];
                    const chips=careKindsFor(activeMember).filter(k=>k.key!=="other"&&allCare.some(c=>c.careKind===k.key)).map(k=>({key:k.key,label:careLabel(k),icon:careIcon(k.key)}));
                    if(certs.length>0)chips.push({key:"__cert",label:t("certs.cert"),icon:"filetext"});
                    return chips.length>0?(<div className="yl-typerow" style={{marginBottom:12}}>{chips.map(c=><span key={c.key} className="yl-chip" style={{cursor:"default"}}><Icon name={c.icon} size={14}/> {c.label}</span>)}</div>):null;
                  })()}
                  {certs.length===0&&careNoPhoto.length===0?(
                    <div className="yl-cert-empty">
                      <button className="yl-quick-big" onClick={()=>{if(!isMemberTab)setSelfCare(true);setInputSheet("schedule");}}><Icon name="camera" size={18}/> {t("certs.addCert")}</button>
                      <p className="yl-routine-empty" style={{marginTop:10}}>{t("certs.empty")}</p>
                    </div>
                  ):(<>
                    {certs.length>0&&(<>
                      <p className="yl-set-desc" style={{margin:"0 0 8px",display:"flex",alignItems:"center",gap:5}}><Icon name="filetext" size={13}/> {t("certs.certHint")}</p>
                      {certsByYear.map(g=>(
                        <div key={g.year} className="yl-cert-year">
                          <span className="yl-cert-yearlabel">{g.year==="----"?t("certs.noDate"):t("certs.yearLabel",{y:g.year})}</span>
                          <div className="yl-certs-row">
                            {g.items.map(c=>{
                              const label=careLabel(careKindsFor(activeMember).find(k=>k.key===c.careKind))||c.title;
                              return(
                                <button key={c.id} className="yl-cert-cell" onClick={()=>viewPhoto(firstPhotoId(c))}>
                                  {firstPhotoId(c)&&photos[firstPhotoId(c)]?<img className="yl-cert-img" src={photos[firstPhotoId(c)]} alt=""/>:<span className="yl-cert-ph"><Icon name="filetext" size={20}/></span>}
                                  <span className="yl-cert-cap"><Icon name={careIcon(c.careKind)} size={12}/> {label}</span>
                                  {(()=>{const rl=renewLeft(c);return rl?<span className={"yl-cert-exp "+rl.tone}>{rl.txt}</span>:null;})()}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </>)}
                    {careNoPhoto.length>0&&(
                      <div className="yl-cert-addable" style={{marginTop:certs.length>0?12:0}}>
                        <p className="yl-set-desc" style={{margin:"0 0 8px",display:"flex",alignItems:"center",gap:5}}><Icon name="camera" size={13}/> {t("certs.addablePhoto")}</p>
                        <div className="yl-certs-row">
                          {careNoPhoto.map(c=>{
                            const label=careLabel(careKindsFor(activeMember).find(k=>k.key===c.careKind))||c.title;
                            return(
                              <label key={c.id} className="yl-cert-cell" style={{cursor:"pointer"}} title={t("certs.tapAddPhoto")} onClick={e=>e.stopPropagation()}>
                                <span className="yl-cert-ph"><Icon name="camera" size={20}/></span>
                                <span className="yl-cert-cap"><Icon name={careIcon(c.careKind)} size={12}/> {label}</span>
                                {(()=>{const rl=renewLeft(c);return rl?<span className={"yl-cert-exp "+rl.tone}>{rl.txt}</span>:null;})()}
                                <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>onFilePicked(e,c.id)}/>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>)}
                </section>
              )});
              defs.push({key:"health",el:(
                <section className="yl-health">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>{t("rec.healthTitle")}</h2>
                  {isMemberTab&&weightDiff!=null&&(<p className={"yl-diet-msg"+(Math.abs(weightDiff)<0.05?" ok":weightDiff>0?" over":" under")}>{Math.abs(weightDiff)<0.05?<><Icon name="sparkles" size={13}/> 目標達成中！この調子で</>:weightDiff>0?<>目標を <span className="yl-nowrap">{Math.abs(weightDiff).toFixed(1)}{weightUnit}</span> 超えています<span className="yl-nowrap">（食べすぎ・運動量に気をつけて）</span></>:<>目標まで あと <span className="yl-nowrap">{Math.abs(weightDiff).toFixed(1)}{weightUnit}</span></>}</p>)}
                  {weightPts.length>=2?<MiniChart points={weightPts} unit={weightPts[weightPts.length-1].unit} color="#E39A5C" label={t("chart.weight")}/>:<p className="yl-routine-empty">{weightPts.length===1?t("health.chartSoon"):t("health.emptyPlus")}</p>}
                  {isMemberTab&&heightPts.length>=2&&<MiniChart points={heightPts} unit="cm" color="#D98A4E" label={t("chart.height")}/>}
                  {bpPts.length>=2&&<MiniChart points={bpPts} unit="mmHg" color="#B23A48" label={t("chart.bpSys")}/>}
                  {healthRecords.length>0&&(
                    <ul className="yl-health-list">
                      {[...healthRecords].reverse().slice(0,6).map(r=>(
                        <li key={r.id} className="yl-health-item">
                          <span className="yl-health-date">{fmtDate(r.date)}</span>
                          <span className="yl-health-vals">{r.weight!=null&&<span>{r.weight}{r.wunit||"kg"}</span>}{r.height!=null&&<span>{r.height}cm</span>}{(r.bpSys!=null||r.bpDia!=null)&&<span>{t("health.bpPrefix")}{r.bpSys??"–"}/{r.bpDia??"–"}</span>}{r.temp!=null&&<span>{r.temp}℃</span>}{r.glucose!=null&&<span>血糖{r.glucose}</span>}{r.condition&&condMeta(r.condition)&&<span>{condMeta(r.condition).emoji}{condMeta(r.condition).label}</span>}</span>
                          <button className="yl-health-del" onClick={()=>askDelete(t("health.recordOf",{date:fmtDate(r.date)}),()=>removeHealth(r.id))} aria-label={t("a11y.delete")}>×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )});
              if(curKind==="me")defs.push({key:"meds",el:(
                <section className="yl-med-sec">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>{t("rec.medsTitle")}</h2>
                  {medCourses.length>0&&<ul className="yl-med-list">{medCourses.map(m=>{const dayNo=Math.min(m.days,Math.floor((new Date(todayIso)-new Date(m.startDate))/86400000)+1);const doneToday=(m.taken||[]).includes(todayIso);const left=Math.max(0,m.days-(m.taken||[]).length);const finished=(m.taken||[]).length>=m.days;return(<li key={m.id} className={"yl-med-item"+(finished?" done":"")}><span className="yl-med-body"><span className="yl-med-name"><Icon name="pill" size={14}/><span className="yl-med-nametext">{m.name}</span></span><span className="yl-med-meta">{finished?t("med.finished"):t("med.progress",{days:m.days,n:dayNo>0?dayNo:1,left})}</span></span>{!finished&&<button className={"yl-med-check"+(doneToday?" on":"")} onClick={()=>toggleMedToday(m.id)}>{doneToday?t("med.tookDone"):t("med.took")}</button>}<button className="yl-health-del" onClick={()=>askDelete(m.name,()=>removeMedCourse(m.id))} aria-label={t("a11y.delete")}>×</button></li>);})}</ul>}
                  <div className="yl-med-add"><input className="yl-input sm" value={medName} onChange={e=>setMedName(e.target.value)} placeholder={t("ph.medName")}/><span className="yl-med-days"><input type="number" inputMode="numeric" min="1" className="yl-health-num" value={medDays} onChange={e=>setMedDays(e.target.value)}/>{t("med.daysUnit")}</span><button className="yl-addbtn sm" onClick={addMedCourse}>{t("common.register")}</button></div>
                </section>
              )});
              if(curKind==="pet")defs.push({key:"vet",el:(
                <section className="yl-vetcard">
                  <h2 className="yl-routine-title" style={{marginBottom:8}}>{t("rec.sheetsTitle")}</h2>
                  <p className="yl-set-desc" style={{marginBottom:10}}>{t("rec.sheetsDescPet")}</p>
                  <button className="yl-quick-big" onClick={()=>setVetOpen(true)}><Icon name="filetext" size={18}/> {t("rec.vetSummary")}</button>
                  <button className="yl-quick-big" style={{marginTop:8}} onClick={()=>setHandoverOpen(true)}><Icon name="note" size={18}/> {t("rec.careSheet")}</button>
                  <button className="yl-quick-big" style={{marginTop:8}} onClick={()=>setLostOpen(true)}><Icon name="alert" size={18}/> {t("rec.lostPoster")}</button>
                </section>
              )});
              if(curKind==="person"||curKind==="me")defs.push({key:"sheet1",el:(
                <section className="yl-vetcard">
                  <h2 className="yl-routine-title" style={{marginBottom:8}}>{t("rec.sheetsTitle")}</h2>
                  <p className="yl-set-desc" style={{marginBottom:10}}>{t("rec.sheetsDescOther")}</p>
                  {curKind==="person"&&<button className="yl-quick-big" onClick={()=>setHandoverOpen(true)}><Icon name="note" size={18}/> {t("rec.handoverToday")}</button>}
                  <button className="yl-quick-big" style={curKind==="person"?{marginTop:8}:undefined} onClick={()=>setEmergencyCardOpen(true)}><Icon name="alert" size={18}/> {t("rec.emergencyCard")}</button>
                </section>
              )});
              if(curKind==="person"&&activeMember.personType==="baby")defs.push({key:"nursing",el:(
                <section className="yl-nursing">
                  <div className="yl-routine-head"><h2 className="yl-routine-title">授乳・ミルク</h2>{lastNursingTs&&!nursing&&<span className="yl-nursing-since">前回から {sinceLabel(lastNursingTs)}</span>}</div>
                  {nursing&&nursing.space===tab?(
                    <div className="yl-nursing-run">
                      <div className="yl-nursing-runinfo"><span className="yl-nursing-runside">{nursing.side==="left"?"◀ 左で授乳中":"右で授乳中 ▶"}</span><span className="yl-nursing-time">{fmtDur(Math.max(0,Math.round((nursingNow-nursing.start)/1000)))}</span></div>
                      <div className="yl-nursing-runbtns"><button className="yl-nursing-stop" onClick={stopNursing}><Icon name="check" size={16}/> 終了して記録</button><button className="yl-nursing-cancel" onClick={cancelNursing}>やめる</button></div>
                    </div>
                  ):(
                    <div className="yl-nursing-start"><button className="yl-nursing-btn" onClick={()=>startNursing("left")}>◀ 左で授乳</button><button className="yl-nursing-btn" onClick={()=>startNursing("right")}>右で授乳 ▶</button></div>
                  )}
                  <div className="yl-nursing-milk"><span className="yl-nursing-milklabel">🍼 ミルク</span><span className="yl-nursing-mlbox"><input type="number" inputMode="numeric" min="0" className="yl-health-num" value={milkMl} onChange={e=>setMilkMl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&logMilk()} placeholder="量"/><span className="yl-nursing-unit">ml</span></span><button className="yl-addbtn sm" onClick={logMilk}>＋ 記録</button></div>
                  {nursingToday.length>0&&<p className="yl-nursing-todaysub">今日 {nursingToday.length}回</p>}
                  {nursingRecords.length>0&&(
                    <ul className="yl-nursing-list">
                      {nursingRecords.slice(0,6).map(x=>(
                        <li key={x.id} className="yl-nursing-item">
                          <span className="yl-nursing-itime">{fmtClock(x.ts)}</span>
                          <span className="yl-nursing-ibody">{x.side==="milk"?<>🍼 ミルク {x.amountMl}ml</>:<>🤱 母乳 {x.side==="left"?"左":"右"}・{fmtDur(x.durationSec)}</>}</span>
                          <span className="yl-nursing-idate">{fmtDate(x.date)}</span>
                          <button className="yl-health-del" onClick={()=>askDelete("授乳の記録",()=>removeNursing(x.id))} aria-label="削除">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )});
              if(curKind==="pet"&&(activeMember.species==="dog"||items.some(x=>x.space===tab&&x.type==="walk")))defs.push({key:"walk",el:(
                <section className="yl-walkrec">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>{t("rec.walkTitle")}</h2>
                  {(()=>{const g=walkGoalFor(activeMember);if(!g)return null;const kmPct=Math.min(100,Math.round(walkMonthStats.km/g.monthlyKm*100));const cntPct=Math.min(100,Math.round(walkMonthStats.count/g.monthlyWalks*100));return(
                    <div className="yl-walkgoal">
                      <div className="yl-walkgoal-head"><span className="yl-walkgoal-title"><Icon name="paw" size={13}/> {t("walk.goalTitle")}</span><span className="yl-walkgoal-tag">{g.sizeLabel}・{g.stageLabel}</span></div>
                      <div className="yl-walkgoal-row"><span className="yl-walkgoal-lbl">{t("walk.distance")}</span><span className="yl-walkgoal-bar"><span className="yl-walkgoal-fill" style={{width:kmPct+"%"}}/></span><span className="yl-walkgoal-val">{walkMonthStats.km.toFixed(1)}<span className="yl-walkgoal-goal"> / {g.monthlyKm}km</span></span></div>
                      <div className="yl-walkgoal-row"><span className="yl-walkgoal-lbl">{t("walk.count")}</span><span className="yl-walkgoal-bar"><span className="yl-walkgoal-fill" style={{width:cntPct+"%"}}/></span><span className="yl-walkgoal-val">{walkMonthStats.count}<span className="yl-walkgoal-goal"> / {g.monthlyWalks}{t("walk.timesUnit")}</span></span></div>
                      <p className="yl-walkgoal-note">{t("walk.dcPre")}{g.knownBreed?"":t("walk.dcBreedUnset")}{t("walk.dcMid")}{g.knownAge?"":t("walk.dcAgeUnset")}{t("walk.dcPost1")}<b>{t("walk.dcBold")}</b>{t("walk.dcPost2")}</p>
                    </div>
                  );})()}
                  {walkRecords.length>0&&(()=>{const maxKm=Math.max(0.1,...walkMonthly.map(m=>m.km));const cur=walkMonthly[walkMonthly.length-1],prev=walkMonthly[walkMonthly.length-2]||{km:0,count:0};const dkm=cur.km-prev.km;const totalKm=walkMonthly.reduce((s,m)=>s+m.km,0);return(
                    <div className="yl-walkrev">
                      <div className="yl-walkrev-head"><span className="yl-walkrev-title"><Icon name="activity" size={14}/> {t("walk.reviewTitle")}</span>{prev.km>0&&<span className={"yl-walkrev-delta"+(dkm>=0?" up":" down")}>{t("walk.vsLast")}{dkm>=0?"+":""}{dkm.toFixed(1)}km</span>}</div>
                      <div className="yl-walkrev-bars">{walkMonthly.map((m,i)=>(
                        <div key={m.key} className={"yl-walkrev-col"+(i===walkMonthly.length-1?" on":"")}>
                          <span className="yl-walkrev-bar"><span className="yl-walkrev-fill" style={{height:Math.round(m.km/maxKm*100)+"%"}}/></span>
                          <span className="yl-walkrev-mlabel">{m.label}</span>
                        </div>
                      ))}</div>
                      <p className="yl-walkrev-sum">{t("walk.summaryThisMonth")}<b>{cur.km.toFixed(1)}km</b>・<b>{cur.count}{t("walk.walksUnit")}</b>{cur.sec>0?t("walk.summaryMin",{m:Math.round(cur.sec/60)}):""}{t("walk.summarySep")}{totalKm.toFixed(1)}km</p>
                    </div>
                  );})()}
                  {walk&&walk.space===tab?(
                    <div className="yl-walkrec-live">
                      <div className="yl-walkrec-stats">
                        <div className="yl-walkrec-stat"><span className="yl-walkrec-statv">{fmtDur(Math.max(0,Math.round((walkNow-walk.start)/1000)))}</span><span className="yl-walkrec-statl">{t("walk.time")}</span></div>
                        <div className="yl-walkrec-stat"><span className="yl-walkrec-statv">{fmtDist(walk.distanceM||0)}</span><span className="yl-walkrec-statl">{t("walk.distance")}</span></div>
                      </div>
                      {walk.route&&walk.route.length>=2&&<svg className="yl-walkrec-map live" viewBox="0 0 300 120" preserveAspectRatio="none"><polyline points={routePath(walk.route,300,120)} fill="none" stroke="#E39A5C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      <p className="yl-walkrec-hint">{walkGpsErr?walkGpsErr:(walk.route&&walk.route.length?t("walk.gpsRecording",{n:walk.route.length}):t("walk.gpsStart"))}</p>
                      <div className="yl-walkrec-livebtns"><button className="yl-walkrec-stop" onClick={stopWalk}><Icon name="check" size={16}/> {t("walk.stopSave")}</button><button className="yl-walkrec-cancel" onClick={cancelWalk}>{t("common.stop")}</button></div>
                    </div>
                  ):walk?(
                    <p className="yl-walkrec-other"><Icon name="paw" size={14}/> {t("walk.otherRunning")}</p>
                  ):(
                    <button className="yl-walkrec-start" onClick={startWalk}><Icon name="paw" size={18}/> {t("walk.startBtn")}</button>
                  )}
                  {walkRecords.length>0&&(
                    <ul className="yl-walkrec-list">
                      {walkRecords.slice(0,6).map(w=>{const rp=routePath(w.route,72,48);return(
                        <li key={w.id} className="yl-walkrec-item">
                          <span className="yl-walkrec-thumb">{rp?<svg viewBox="0 0 72 48" preserveAspectRatio="none"><polyline points={rp} fill="none" stroke="#E39A5C" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>:<Icon name="paw" size={16}/>}</span>
                          <span className="yl-walkrec-body"><span className="yl-walkrec-main">{fmtDist(w.distanceM)}・{fmtDur(w.durationSec)}</span><span className="yl-walkrec-sub">{fmtDate(w.date)} {fmtClock(w.start)}</span></span>
                          <button className="yl-walkrec-del" onClick={()=>askDelete(t("walk.delLabel"),()=>removeWalk(w.id))} aria-label={t("a11y.delete")}>×</button>
                        </li>
                      );})}
                    </ul>
                  )}
                </section>
              )});
              if(curKind==="pet")defs.push({key:"feed",el:(
                <section className="yl-feedsec">
                  <div className="yl-toilet-head">
                    <h2 className="yl-routine-title" style={{margin:0}}>{t("rec.feedTitle")}</h2>
                    {foodDefs.length>0&&<button className="yl-linkbtn" onClick={openFoodNew}>{t("food.registerLink")}</button>}
                  </div>
                  {feedToday.length>0?(
                    <div className="yl-meal-summary">
                      <span className="yl-meal-sumchip">{t("food.todayCount",{n:mealSummary.count})}</span>
                      {Object.entries(mealSummary.byUnit).map(([u,v])=><span key={u} className="yl-meal-sumchip">{Math.round(v*10)/10}{foodUnitLabel(u)}</span>)}
                      {mealSummary.kcal!=null&&<span className="yl-meal-sumchip kcal">{t("food.approxKcal",{kc:mealSummary.kcal})}</span>}
                    </div>
                  ):(
                    <p className="yl-routine-empty" style={{padding:"4px 0 0"}}>{t("food.pickToLog")}</p>
                  )}
                  {feedToday.length>0&&(
                    <div className="yl-meal-today">
                      {MEAL_SLOTS.map(s=>{const rows=feedToday.filter(x=>x.slot===s.k);if(rows.length===0)return null;return(
                        <div key={s.k} className="yl-meal-slot">
                          <span className="yl-meal-slotlabel">{t("mealslot."+s.k)}</span>
                          <div className="yl-meal-rows">{rows.map(x=>(
                            <div key={x.id} className="yl-meal-row"><span className="yl-meal-name">{x.foodName||t("food.defaultName")}</span><span className="yl-meal-amt">{x.amount}{foodUnitLabel(x.unit)}{x.kcal!=null?` ・ ${x.kcal}kcal`:""}</span><button className="yl-feed-del" onClick={()=>askDelete(t("food.delMeal"),()=>removeFeed(x.id))} aria-label={t("a11y.delete")}>×</button></div>
                          ))}</div>
                        </div>
                      );})}
                      {(()=>{const other=feedToday.filter(x=>!x.slot);if(other.length===0)return null;return(
                        <div className="yl-meal-slot"><span className="yl-meal-slotlabel">{t("food.recordLabel")}</span><div className="yl-meal-rows">{other.map(x=>(
                          <div key={x.id} className="yl-meal-row"><span className="yl-meal-name">{x.foodName||t("food.defaultName")}</span><span className="yl-meal-amt">{feedEntryText(x)}</span><button className="yl-feed-del" onClick={()=>askDelete(t("food.delRecord"),()=>removeFeed(x.id))} aria-label={t("a11y.delete")}>×</button></div>
                        ))}</div></div>
                      );})()}
                    </div>
                  )}
                  {foodDefs.length>0?(<>
                    <p className="yl-meal-pick-label">{t("food.tapToLog")}</p>
                    <div className="yl-meal-pick">{foodDefs.map(d=>(
                      <button key={d.id} className="yl-meal-chip" onClick={()=>openMeal(d.id)}><Icon name={foodTypeMeta(d.foodType).ic} size={13}/> <span className="yl-meal-chipname">{d.name}</span></button>
                    ))}</div>
                    <p className="yl-set-desc" style={{marginTop:8,fontSize:12}}>{t("food.todayMeal")}<button className="yl-linkbtn" onClick={openFeed}>{t("food.amountOnly")}</button></p>
                  </>):(
                    <button className="yl-quick-big" style={{marginTop:10}} onClick={openFoodNew}><Icon name="utensils" size={18}/> {t("food.registerBig")}</button>
                  )}
                </section>
              )});
              if(curKind==="pet"&&hasToilet)defs.push({key:"toilet",el:(
                <section className="yl-toiletstats">
                  <div className="yl-toilet-head">
                    <h2 className="yl-routine-title" style={{margin:0}}>{t("rec.toiletTitle")}</h2>
                    <span className="yl-toilet-ranges">{[7,14,30].map(d=><button key={d} className={"yl-toilet-range"+(toiletRange===d?" on":"")} onClick={()=>setToiletRange(d)}>{d}{t("unit.dShort")}</button>)}</span>
                  </div>
                  {(()=>{const st=toiletStats[toiletRange];const Row=({label,ico,s})=>(<div className="yl-toilet-stat"><span className="yl-toilet-stat-label"><Icon name={ico} size={14}/> {label}</span>{s.total===0?<span className="yl-toilet-stat-none">{t("toilet.none")}</span>:<><span className="yl-toilet-bar"><span className="yl-toilet-fill" style={{width:s.rate+"%"}}/></span><span className="yl-toilet-pct">{s.rate}%<span className="yl-toilet-cnt">{t("toilet.count",{success:s.success,total:s.total})}</span></span></>}</div>);return(<><Row label={t("toilet.peeRate")} ico="droplet" s={st.pee}/><Row label={t("toilet.poopRate")} ico="droplet" s={st.poop}/>{st.poop.avgBristol!=null&&<p className="yl-toilet-avg"><Icon name="droplet" size={13}/> うんちの硬さ平均 <b>{st.poop.avgBristol}／7</b>{bristolMeta(Math.round(st.poop.avgBristol))?`（${bristolMeta(Math.round(st.poop.avgBristol)).label}）`:""}・{st.poop.brCount}回</p>}</>);})()}
                  {poopTrend&&<p className={"yl-bristol-warn tone-"+poopTrend.tone} style={{marginTop:2}}><Icon name="alert" size={13}/> {poopTrend.txt}</p>}
                  <button className="yl-quick-big" style={{marginTop:10}} onClick={()=>setInputSheet("toilet")}><Icon name="paw" size={18}/> {t("toilet.logBtn")}</button>
                </section>
              )});
              defs.push({key:"diary",el:(
                <section className="yl-diary">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>{t("rec.diaryTitle")}</h2>
                  {todayHasCond(tab)?(
                    <button className="yl-quick-done tap" onClick={()=>setInputSheet("diary")}><Icon name="check" size={14}/> {t("diary.recordedDone")}<span className="yl-quick-edit">{t("diary.editMore")}</span></button>
                  ):(
                    <button className="yl-quick-big" onClick={()=>setInputSheet("diary")}><Icon name="note" size={18}/> {t("diary.recordBtn")}</button>
                  )}
                  {energyPts.length>1&&<MiniChart points={energyPts} unit="" color="#557E63" label={t("chart.energy")}/>}
                  {curKind!=="pet"&&sleepPts.length>1&&<MiniChart points={sleepPts} unit="h" color="#6F7BB3" label={t("chart.sleep")}/>}
                  {curKind!=="pet"&&appetitePts.length>1&&<MiniChart points={appetitePts} unit="" color="#C77A2E" label={t("chart.appetite")}/>}
                  {diaryRecords.length===0&&<p className="yl-routine-empty">{t("diary.empty")}</p>}
                  {diaryByDate.length>0&&(
                    <ul className="yl-daycards">
                      {diaryByDate.slice(0,31).map(({date,recs})=>{
                        const open=(date in diaryOpen)?diaryOpen[date]:date===todayIso;
                        const energyRecs=recs.filter(r=>r.energy&&diaryMeta(DIARY_ENERGY,r.energy));
                        const rep=energyRecs.length?diaryMeta(DIARY_ENERGY,energyRecs[energyRecs.length-1].energy):null;
                        const daySyms=[...new Set(recs.flatMap(r=>r.symptoms||[]))];
                        const sumLabel=recs.length===1?(rep?rep.label:(recs[0].note?recs[0].note.slice(0,14):"記録")):`${rep?rep.label:"記録"}・ほか${recs.length-1}件`;
                        return(
                          <li key={date} className={"yl-daycard"+(open?" open":"")}>
                            <div className="yl-daycard-head">
                              <button className="yl-daycard-toggle" onClick={()=>setDiaryOpen(o=>({...o,[date]:!open}))}>
                                <span className="yl-daycard-caret">{open?"▾":"▸"}</span>
                                <span className="yl-daycard-date">{fmtDate(date)}{date===todayIso?"（今日）":""}</span>
                                <span className="yl-daycard-rep"><Icon name={rep?(ENERGY_ICON[rep.key]||"note"):"note"} size={14}/> {sumLabel}</span>
                                {!open&&daySyms.length>0&&<span className="yl-daycard-symbadges">{daySyms.slice(0,3).map(sk=>symptomMeta(sk)&&<span key={sk} className={"yl-symbadge"+(sk==="period"?" period":"")}><Icon name={symIcon(sk)} size={13}/></span>)}</span>}
                              </button>
                              <button className="yl-daycard-del" onClick={()=>askDelete(`${fmtDate(date)}の記録すべて`,()=>removeDiaryDay(date))} aria-label="この日をすべて削除">×</button>
                            </div>
                            {open&&(
                              <ul className="yl-dayrecs">
                                {recs.map(r=>{const tod=recs.length>1&&r.createdAt?(()=>{const h=new Date(r.createdAt).getHours();return h<11?"朝":h<17?"昼":"夜";})():"";return(
                                  <li key={r.id} className="yl-dayrec">
                                    <span className="yl-dayrec-vals">
                                      {tod&&<span className="yl-dayrec-tod">{tod}</span>}
                                      {r.energy&&diaryMeta(DIARY_ENERGY,r.energy)&&<span className="yl-dayrec-chip"><Icon name={ENERGY_ICON[r.energy]} size={13}/> {lblOf(diaryMeta(DIARY_ENERGY,r.energy))}</span>}
                                      {r.appetite&&diaryMeta(DIARY_APPETITE,r.appetite)&&<span className="yl-dayrec-chip"><Icon name={appetiteIcon(r.appetite)} size={13}/> {lblOf(diaryMeta(DIARY_APPETITE,r.appetite))}</span>}
                                      {r.poop&&diaryMeta(DIARY_POOP,r.poop)&&<span className="yl-dayrec-chip"><Icon name={POOP_DIARY_ICON[r.poop]||"droplet"} size={13}/> {lblOf(diaryMeta(DIARY_POOP,r.poop))}</span>}
                                      {r.sleep&&<span className="yl-dayrec-chip"><Icon name="moon" size={13}/> 睡眠{r.sleep}h</span>}
                                      {r.walk&&<span className="yl-dayrec-chip"><Icon name="paw" size={13}/> さんぽ</span>}
                                      {r.hospital&&<span className="yl-dayrec-chip"><Icon name="stethoscope" size={13}/> 病院</span>}
                                      {(r.symptoms||[]).map(sk=>symptomMeta(sk)&&<span key={sk} className={"yl-dayrec-chip sym"+(sk==="period"?" period":"")}><Icon name={symIcon(sk)} size={13}/> {symptomMeta(sk).label}</span>)}
                                      {r.note&&<span className="yl-dayrec-note">{r.note}</span>}
                                      {firstPhotoId(r)&&photos[firstPhotoId(r)]&&<img className="yl-diary-rthumb" src={photos[firstPhotoId(r)]} alt="" onClick={()=>setViewer({id:firstPhotoId(r),src:photos[firstPhotoId(r)],isMemory:false})}/>}
                                    </span>
                                    <button className="yl-dayrec-del" onClick={()=>askDelete("この記録",()=>removeDiary(r.id))} aria-label="この記録を削除">×</button>
                                  </li>
                                );})}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )});
              if(curKind==="person"&&["child","baby"].includes(activeMember.personType||"child"))defs.push({key:"growth",el:(
                <section className="yl-growth">
                  <h2 className="yl-routine-title" style={{marginBottom:6}}>{t("growth.title")}</h2>
                  <p className="yl-set-desc" style={{marginBottom:10}}>{t("growth.desc")}</p>
                  <div className="yl-growth-cats">{MILESTONE_CATS.map(c=><button key={c.key} className={"yl-growth-cat"+(msCat===c.key?" on":"")} onClick={()=>setMsCat(c.key)}><Icon name={c.icon} size={14}/> {c.label}</button>)}</div>
                  <div className="yl-growth-presets">{MILESTONE_PRESETS[msCat].filter(p=>!growthRecords.some(g=>g.title===p)).map(p=><button key={p} className="yl-growth-preset" onClick={()=>addMilestone(msCat,p)}>＋ {p}</button>)}</div>
                  <div className="yl-growth-custom"><input className="yl-input sm" value={msDraft} onChange={e=>setMsDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMilestone(msCat,msDraft)} placeholder={t("growth.custom")}/><button className="yl-addbtn sm" onClick={()=>addMilestone(msCat,msDraft)}>{t("common.plusRecord")}</button></div>
                  {growthRecords.length>0&&(
                    <ul className="yl-growth-list">
                      {growthRecords.map(g=>{const cm=milestoneCatMeta(g.category);const at=activeMember.birthday?ageAtLabel(activeMember.birthday,g.date):"";const pid=firstPhotoId(g);return(
                        <li key={g.id} className="yl-growth-item">
                          {pid&&photos[pid]?<button className="yl-growth-thumbwrap" onClick={()=>viewPhoto(pid)}><img className="yl-growth-thumb" src={photos[pid]} alt=""/></button>:<span className={"yl-growth-badge cat-"+g.category}><Icon name={cm.icon} size={14}/></span>}
                          <span className="yl-growth-body"><span className="yl-growth-title">{g.title}</span><span className="yl-growth-meta">{cm.label}・{fmtDate(g.date)}{at?`・${at}`:""}</span></span>
                          {!pid&&<label className="yl-growth-cam" title={t("growth.camTitle")} onClick={e=>e.stopPropagation()}><Icon name="camera" size={15}/><input type="file" accept="image/*" style={{display:"none"}} onChange={e=>onFilePicked(e,g.id,t("growth.photoSaved"))}/></label>}
                          <button className="yl-health-del" onClick={()=>askDelete(g.title,()=>removeMilestone(g.id))} aria-label="削除">×</button>
                        </li>
                      );})}
                    </ul>
                  )}
                </section>
              )});
              if(selfReview)defs.push({key:"review",el:(()=>{const{cur,prev,openTasks}=selfReview;const dDays=cur.days-prev.days;const dLogs=cur.logs-prev.logs;const dSleep=(cur.sleep!=null&&prev.sleep!=null)?cur.sleep-prev.sleep:null;const parts=[];if(dDays!==0)parts.push(t("review.pDays",{v:(dDays>0?"+":"")+dDays}));if(dSleep!=null&&Math.abs(dSleep)>=0.1)parts.push(t("review.pSleep",{v:(dSleep>0?"+":"")+dSleep.toFixed(1)}));if(dLogs!==0)parts.push(t("review.pLogs",{v:(dLogs>0?"+":"")+dLogs}));return(
                <section className="yl-vetcard">
                  <div className="yl-walkrev-head" style={{marginBottom:10}}><span className="yl-walkrev-title"><Icon name="activity" size={14}/> {t("review.title")}</span></div>
                  <div className="yl-summary-row">
                    <div className="yl-stat"><span className="yl-stat-n">{cur.days}</span><span className="yl-stat-l">{t("review.daysLabel")}</span></div>
                    <div className="yl-stat"><span className="yl-stat-n">{cur.sleep!=null?cur.sleep.toFixed(1):"—"}</span><span className="yl-stat-l">{t("review.sleepLabel")}</span></div>
                    <div className="yl-stat"><span className="yl-stat-n">{curKind==="me"?cur.moves:cur.logs}</span><span className="yl-stat-l">{curKind==="me"?t("review.movesLabel"):t("review.logsLabel")}</span></div>
                  </div>
                  {parts.length>0&&<p className="yl-set-desc" style={{marginTop:10}}>{t("review.vsPrev",{parts:parts.join(lang==="ja"?"・":" · ")})}</p>}
                  {openTasks>0&&<p className="yl-set-desc" style={{marginTop:6}}>{t("review.openTasks",{n:openTasks})}</p>}
                  <p className="yl-vetsum-note" style={{borderTop:"none",marginTop:8,paddingTop:0}}>{t("review.note")}</p>
                </section>
              );})()});
              defs.push({key:"album",el:(
                <section className="yl-album">
                  <div className="yl-routine-head">
                    <h2 className="yl-routine-title">{t("album.title")}</h2>
                    <div className="yl-album-headacts">
                      {memories.length>0&&(albumSel?(
                        <button className="yl-album-selbtn" onClick={()=>setAlbumSel(null)}>{t("album.cancelSel")}</button>
                      ):(
                        <button className="yl-album-selbtn" onClick={()=>setAlbumSel([])}>{t("album.select")}</button>
                      ))}
                      {!albumSel&&<button className="yl-album-add" onClick={()=>openLifeNew(todayIso,tab)}>{t("common.plusAdd")}</button>}
                    </div>
                  </div>
                  {!albumSel&&(
                    <label className={"yl-album-bulk"+(bulkBusy?" busy":"")}>
                      <Icon name="calendar" size={15}/> {bulkBusy?t("album.loading"):t("album.bulkAdd")}
                      <input type="file" accept="image/*" multiple style={{display:"none"}} disabled={bulkBusy} onChange={bulkAddPhotos}/>
                    </label>
                  )}
                  {albumSel&&<p className="yl-album-selhint">{t("album.selHint",{n:ALBUM_SEL_MAX})}</p>}
                  {memories.length===0?(
                    <p className="yl-routine-empty">{t("album.empty")}</p>
                  ):(
                    <div className={"yl-album-grid"+(albumSel?" selecting":"")}>
                      {memories.map(mem=>{const on=albumSel&&albumSel.includes(mem.id);return(
                        <button key={mem.id} className={"yl-album-cell"+(on?" sel":"")} onClick={()=>albumSel?toggleAlbumSel(mem.id):openLifeEdit(mem)}>
                          {firstPhotoId(mem)&&photos[firstPhotoId(mem)]?<><img className="yl-album-img" src={photos[firstPhotoId(mem)]} alt=""/>{photoIdsOf(mem).length>1&&<span className="yl-photo-badge">+{photoIdsOf(mem).length-1}</span>}</>:<span className="yl-album-ph">{mem.note?"📝":(mem.emoji||"📸")}</span>}
                          {albumSel&&<span className={"yl-album-check"+(on?" on":"")}>{on?"✓":""}</span>}
                          <span className="yl-album-cap">{fmtDate(mem.date)}{mem.title&&mem.title!=="思い出"?`・${mem.title}`:""}</span>
                        </button>
                      );})}
                    </div>
                  )}
                  {albumSel&&(
                    <div className="yl-album-selbar">
                      <span className="yl-album-selcount">{t("album.selCount",{n:albumSel.length})}</span>
                      <button className="yl-album-movebtn" disabled={albumSel.length===0} onClick={()=>setAlbumMoveOpen(true)}><Icon name="users" size={15}/> {t("album.moveBtn")}</button>
                    </div>
                  )}
                </section>
              )});
              if(curKind==="person"&&(activeMember.personType||"child")==="child")defs.push({key:"help",el:(
                <section className="yl-help-sec">
                  <div className="yl-routine-head"><h2 className="yl-routine-title">{t("points.title")}</h2><span className="yl-point-total"><Icon name="sparkles" size={14}/> {t("points.total",{n:pointStats.total})}<span className="yl-point-week">{t("points.week",{n:pointStats.week})}</span></span></div>
                  <div className="yl-growth-presets">{HELP_PRESETS.map(h=><button key={h.task} className="yl-growth-preset" onClick={()=>addPoint(h.task,h.pt)}>＋ {h.task} <b>+{h.pt}</b></button>)}</div>
                  <div className="yl-growth-custom"><input className="yl-input sm" value={pointTask} onChange={e=>setPointTask(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPoint(pointTask,1)} placeholder={t("points.custom")}/><button className="yl-addbtn sm" onClick={()=>addPoint(pointTask,1)}>{t("common.plusRecord")}</button></div>
                  {pointRecords.length>0&&<ul className="yl-point-list">{pointRecords.slice(0,8).map(p=>(<li key={p.id} className="yl-point-item"><span className="yl-point-date">{fmtDate(p.date)}</span><span className="yl-point-task">{p.task}</span><span className="yl-point-pt">+{p.points}pt</span><button className="yl-health-del" onClick={()=>removePoint(p.id)} aria-label={t("a11y.delete")}>×</button></li>))}</ul>}
                </section>
              )});
              if(curKind==="person"&&(activeMember.personType||"child")==="child")defs.push({key:"allowance",el:(
                <section className="yl-allow-sec">
                  <div className="yl-routine-head"><h2 className="yl-routine-title">{t("allow.title")}</h2><span className="yl-allow-bal">{t("allow.balance")} <strong>{fmtYen(allowanceBalance)}</strong></span></div>
                  <div className="yl-allow-input">
                    <span className="yl-seg-mini">{ALLOWANCE_DIRS.map(o=><button key={o.k} className={"yl-seg-mini-btn"+(allowDir===o.k?" on":"")} onClick={()=>setAllowDir(o.k)}>{t("allowdir."+o.k)}</button>)}</span>
                    <div className="yl-allow-row"><span className="yl-exp-amt"><span className="yl-exp-yen">¥</span><input type="number" inputMode="numeric" className="yl-health-num" value={allowAmt} onChange={e=>setAllowAmt(e.target.value)} placeholder={t("common.amount")}/></span><input className="yl-input sm" value={allowReason} onChange={e=>setAllowReason(e.target.value)} placeholder={t("allow.memoPh")}/><button className="yl-addbtn sm" onClick={addAllowance}>＋</button></div>
                  </div>
                  {allowanceRecords.length>0&&<ul className="yl-allow-list">{allowanceRecords.slice(0,8).map(a=>{const dm=ALLOWANCE_DIRS.find(o=>o.k===a.dir)||ALLOWANCE_DIRS[0];return(<li key={a.id} className="yl-allow-item"><span className="yl-point-date">{fmtDate(a.date)}</span><span className={"yl-allow-tag dir-"+a.dir}>{t("allowdir."+dm.k)}</span>{a.reason&&<span className="yl-allow-reason">{a.reason}</span>}<span className={"yl-allow-amt"+(dm.sign<0?" out":dm.sign>0?" in":"")}>{dm.sign<0?"-":dm.sign>0?"+":""}{fmtYen(a.amount)}</span><button className="yl-health-del" onClick={()=>removeAllowance(a.id)} aria-label={t("a11y.delete")}>×</button></li>);})}</ul>}
                </section>
              )});
              if(curKind==="person"&&(["child","baby"].includes(activeMember.personType||"child")||activeMember.personType==="senior"))defs.push({key:"meds",el:(
                <section className="yl-med-sec">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>{t("rec.medsTitle")}</h2>
                  {medCourses.length>0&&<ul className="yl-med-list">{medCourses.map(m=>{const dayNo=Math.min(m.days,Math.floor((new Date(todayIso)-new Date(m.startDate))/86400000)+1);const doneToday=(m.taken||[]).includes(todayIso);const left=Math.max(0,m.days-(m.taken||[]).length);const finished=(m.taken||[]).length>=m.days;return(<li key={m.id} className={"yl-med-item"+(finished?" done":"")}><span className="yl-med-body"><span className="yl-med-name"><Icon name="pill" size={14}/><span className="yl-med-nametext">{m.name}</span></span><span className="yl-med-meta">{finished?t("med.finished"):t("med.progress",{days:m.days,n:dayNo>0?dayNo:1,left})}</span></span>{!finished&&<button className={"yl-med-check"+(doneToday?" on":"")} onClick={()=>toggleMedToday(m.id)}>{doneToday?t("med.tookDone"):t("med.took")}</button>}<button className="yl-health-del" onClick={()=>askDelete(m.name,()=>removeMedCourse(m.id))} aria-label={t("a11y.delete")}>×</button></li>);})}</ul>}
                  <div className="yl-med-add"><input className="yl-input sm" value={medName} onChange={e=>setMedName(e.target.value)} placeholder={t("meds.namePh")}/><span className="yl-med-days"><input type="number" inputMode="numeric" min="1" className="yl-health-num" value={medDays} onChange={e=>setMedDays(e.target.value)}/>{t("med.daysUnit")}</span><button className="yl-addbtn sm" onClick={addMedCourse}>{t("common.register")}</button></div>
                </section>
              )});
              if(curKind==="person")defs.push({key:"belong",el:(
                <section className="yl-belong">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>{t("belong.title")}</h2>
                  {belongings.length>0&&(
                    <div className="yl-belong-week">
                      {weekdaysShort.map((w,i)=>{const list=belongings.filter(b=>b.dow===i);if(!list.length)return null;return(
                        <div key={i} className="yl-belong-day">
                          <span className={"yl-belong-dow"+(i===0?" sun":i===6?" sat":"")}>{w}</span>
                          <span className="yl-belong-items">{list.map(b=><span key={b.id} className="yl-belong-chip">{b.title}<button className="yl-belong-del" onClick={()=>removeBelonging(b.id)} aria-label={t("a11y.delete")}>×</button></span>)}</span>
                        </div>
                      );})}
                    </div>
                  )}
                  {belongings.length===0&&<p className="yl-routine-empty">{t("belong.empty")}</p>}
                </section>
              )});
              if(curKind==="pet")defs.push({key:"foodreg",el:(
                <section className="yl-foodreg">
                  <div className="yl-toilet-head"><h2 className="yl-routine-title" style={{margin:0}}>{t("foodreg.title")}</h2></div>
                  <p className="yl-set-desc">{t("foodreg.desc")}</p>
                  {foodDefs.length>0&&<ul className="yl-foodlist">{foodDefs.map(d=>(
                    <li key={d.id} className="yl-fooditem">
                      <span className={"yl-food-badge t-"+d.foodType}><Icon name={foodTypeMeta(d.foodType).ic} size={12}/> {t("foodtype."+d.foodType)}</span>
                      <span className="yl-food-body"><span className="yl-food-name">{d.name}</span>{[d.brand,foodDefText(d)].filter(Boolean).length>0&&<span className="yl-food-meta">{[d.brand,foodDefText(d)].filter(Boolean).join(" ・ ")}</span>}</span>
                      <button className="yl-food-edit" onClick={()=>openFoodEdit(d)} aria-label={t("a11y.edit")}><Icon name="pencil" size={13}/></button>
                      <button className="yl-health-del" onClick={()=>askDelete(d.name,()=>removeFoodDef(d.id))} aria-label={t("a11y.delete")}>×</button>
                    </li>
                  ))}</ul>}
                  <button className="yl-addbtn sm" style={{marginTop:foodDefs.length?4:8}} onClick={openFoodNew}><Icon name="plus" size={14}/> {t("foodreg.addFood")}</button>
                  {(activeMember.species==="dog"||activeMember.species==="cat")&&<button className="yl-addbtn sm" style={{marginTop:8}} onClick={openFoodCalc}><Icon name="scale" size={14}/> {t("foodreg.calc")}</button>}
                </section>
              )});
              defs.push({key:"cards",el:(
                <section className="yl-tray">
                  <button className="yl-tray-head" onClick={()=>setTrayOpen(o=>!o)}>
                    <span className="yl-tray-title"><Icon name="pin" size={15}/> {t("rec.trayTitle")}{cards.length>0?t("rec.trayCount",{n:cards.length}):""}</span>
                    <span className="yl-tray-arrow">{trayOpen?"▲":"▼"}</span>
                  </button>
                  {trayOpen&&(
                    <div className="yl-tray-body">
                      <p className="yl-tray-hint">{t("rec.trayHint")}</p>
                      {cards.map(c=>(
                        <button key={c.id} className="yl-infocard" onClick={()=>openCardEdit(c)}>
                          <span className="yl-infocard-emoji"><Icon name={cardIcon(c.kind)} size={20}/></span>
                          <span className="yl-infocard-body"><span className="yl-infocard-title">{c.title}{c.night?<span className="yl-emg-tag">{t("card.nightTag")}</span>:null}</span>{c.body&&<span className="yl-infocard-text">{c.body}</span>}{(c.hours||c.addr)&&<span className="yl-infocard-meta">{[c.hours&&`🕐 ${c.hours}`,c.addr&&`📍 ${c.addr}`].filter(Boolean).join("　")}</span>}</span>
                          {firstPhotoId(c)&&photos[firstPhotoId(c)]&&<img className="yl-infocard-thumb" src={photos[firstPhotoId(c)]} alt=""/>}
                        </button>
                      ))}
                      <div className="yl-tray-add">{CARD_PRESETS.map(p=><button key={p.key} className="yl-tray-addbtn" onClick={()=>openCardNew(p.key)}><Icon name={cardIcon(p.key)} size={14}/> {t("cardkind."+p.key)}</button>)}</div>
                    </div>
                  )}
                </section>
              )});
              return renderSecs(personSeg,defs.filter(d=>(SECSEG[d.key]||"manage")===personSeg));
            })()}
          </>
        )}
        <p className="yl-foot">{t("common.foot")}</p>
      </div>

      {isPersonMode&&!hubOpen&&!inputSheet&&(
        <button className="yl-fab" data-tour="fab" onClick={()=>setHubOpen(true)} aria-label="記録を追加"><Icon name="plus" size={26} stroke={2.2}/></button>
      )}

      {/* 下部固定スタック：メンバーバー（上）＋タブナビ（下） */}
      <div className="yl-btmstack">

      {/* 下部タブナビゲーション（常時表示・行動で分類） */}
      {!onboarding&&(()=>{
        const items=[
          {key:"home",icon:"home",label:t("nav.home"),on:tab==="home"||isPersonMode,act:()=>setTab("home")},
          {key:"cal",icon:"calendar",label:t("nav.calendar"),on:tab==="cal",act:()=>setTab("cal")},
          {key:"settings",icon:"settings",label:t("nav.settings"),on:tab==="settings",act:()=>setTab("settings")},
        ];
        return(
          <nav className="yl-bottomnav">
            {items.map(it=>(
              <button key={it.key} data-tour={"nav-"+it.key} className={"yl-bnav-item"+(it.on?" on":"")} onClick={it.act}>
                <span className="yl-bnav-ico"><Icon name={it.icon} size={23}/></span>
                <span className="yl-bnav-label">{it.label}</span>
              </button>
            ))}
          </nav>
        );
      })()}
      </div>

      {menuOpen&&(
        <div className="yl-drawer-ov" onClick={()=>setMenuOpen(false)}>
          <div className="yl-drawer" onClick={e=>e.stopPropagation()}>
            <div className="yl-drawer-head"><span className="yl-drawer-title">メニュー</span><button className="yl-help-close" onClick={()=>setMenuOpen(false)}>×</button></div>
            <div className="yl-drawer-group">
              <button className="yl-drawer-item danger" onClick={()=>{setMenuOpen(false);setToxicSp("all");setToxicQ("");setToxicOpen(true);}}><Icon name="alert" size={19}/> 誤食・中毒 危険物リスト</button>
              <button className="yl-drawer-item danger" onClick={()=>{setMenuOpen(false);setEmergencyOpen(true);}}><Icon name="activity" size={19}/> 夜間・救急の備え</button>
              <button className="yl-drawer-item danger" onClick={()=>{setMenuOpen(false);setDisasterOpen(true);}}><Icon name="home" size={19}/> 防災・避難の備え</button>
            </div>
            <div className="yl-drawer-sep"/>
            <div className="yl-drawer-group">
              <button className="yl-drawer-item" onClick={()=>{setMenuOpen(false);setTab("home");}}><Icon name="home" size={19}/> ホーム</button>
              <button className="yl-drawer-item" onClick={()=>{setMenuOpen(false);setTab("cal");}}><Icon name="calendar" size={19}/> カレンダー</button>
              <button className="yl-drawer-item" onClick={()=>{setMenuOpen(false);const t=members.some(m=>m.id===memberSel)||memberSel==="me"?memberSel:"me";setTab(t);setPersonSeg("manage");}}><Icon name="wallet" size={19}/> 費用・管理</button>
              <button className="yl-drawer-item" onClick={()=>{setMenuOpen(false);setNotesOpen(true);}}><Icon name="heart" size={19}/> 家族ノート</button>
              {FB_READY&&<button className="yl-drawer-item" onClick={()=>{setMenuOpen(false);setShowShareModal(true);setShareStep("menu");setShareError("");}}><Icon name="users" size={19}/> 家族で共有</button>}
            </div>
            <div className="yl-drawer-sep"/>
            <div className="yl-drawer-group">
              <button className="yl-drawer-item" onClick={()=>{setMenuOpen(false);setHelpOpen(true);}}><Icon name="note" size={19}/> 使い方・機能紹介</button>
              <button className="yl-drawer-item" onClick={()=>{setMenuOpen(false);setTab("settings");}}><Icon name="settings" size={19}/> 設定</button>
            </div>
            <p className="yl-drawer-foot">LOALIFE β版</p>
          </div>
        </div>
      )}
      {notesOpen&&(
        <div className="yl-help-ov" onClick={()=>setNotesOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head"><h2 className="yl-help-title"><Icon name="heart" size={18}/> 家族ノート</h2><button className="yl-help-close" onClick={()=>setNotesOpen(false)}>×</button></div>
            <div className="yl-note-compose">
              <div className="yl-note-kinds">{NOTE_KINDS.map(k=><button key={k.k} className={"yl-note-kind"+(noteKind===k.k?" on":"")} onClick={()=>setNoteKind(k.k)}><Icon name={k.icon} size={14}/> {k.l}</button>)}</div>
              <div className="yl-note-inputrow"><input className="yl-input" value={noteText} onChange={e=>setNoteText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addFamilyNote()} placeholder="今日あったこと・ありがとう・きもち…"/><button className="yl-addbtn sm" onClick={addFamilyNote}>送る</button></div>
            </div>
            {familyNotes.length===0?<p className="yl-set-desc" style={{padding:"12px 4px"}}>今日のことや「ありがとう」をひとことで。</p>:(
              <ul className="yl-note-list">{familyNotes.map(n=>{const km=noteKindMeta(n.kind);return(
                <li key={n.id} className={"yl-note-item kind-"+n.kind}>
                  <span className="yl-note-ic"><Icon name={km.icon} size={15}/></span>
                  <span className="yl-note-body"><span className="yl-note-text">{n.text}</span><span className="yl-note-meta">{km.l}・{n.author}・{fmtDate(n.date)}</span></span>
                  <button className="yl-health-del" onClick={()=>removeFamilyNote(n.id)} aria-label="削除">×</button>
                </li>);})}</ul>
            )}
            <p className="yl-toxic-foot">※ この端末に保存されます。家族で同じ端末を使う「連絡帳」としてお使いください。</p>
          </div>
        </div>
      )}
      {emergencyOpen&&(()=>{
        const hospitals=items.filter(x=>x.type==="card"&&x.kind==="hospital");
        const persons=items.filter(x=>x.type==="card"&&x.kind==="emergency");
        const sortedH=[...hospitals].sort((a,b)=>(b.night?1:0)-(a.night?1:0));
        const primary=sortedH.find(h=>h.night&&extractTel(h.body))||sortedH.find(h=>extractTel(h.body))||sortedH[0]||null;
        const primaryTel=primary?extractTel(primary.body):null;
        const dog=(activeMember&&activeMember.kind==="pet")?activeMember:petMembers[0];
        const dogW=dog?(()=>{const wl=items.filter(x=>x.space===dog.id&&x.type==="health"&&x.weight!=null).sort((a,b)=>(a.date||"").localeCompare(b.date||"")).pop();return wl?`${wl.weight}${wl.wunit||"kg"}`:null;})():null;
        const dogMeta=dog?[dog.breed||"",ageLabel(dog.birthday),dogW].filter(Boolean).join("・"):"";
        const ti=toxicEmgInfo;
        const renderContact=(c)=>{const tel=extractTel(c.body);return(
          <li key={c.id} className="yl-emg-contact">
            <div className="yl-emg-cbody"><span className="yl-emg-cname">{c.title||(c.kind==="hospital"?t("emg.hospFallback"):t("emg.contactFallback"))}{c.night?<span className="yl-emg-tag">{t("card.nightTag")}</span>:null}</span>{c.body&&<span className="yl-emg-cnote">{c.body}</span>}{c.hours&&<span className="yl-emg-cmeta"><Icon name="bell" size={11}/> {c.hours}</span>}{c.addr&&<span className="yl-emg-cmeta"><Icon name="pin" size={11}/> {c.addr}</span>}<span className="yl-emg-cwho">{nameOf(c.space)}</span></div>
            {tel?<a className="yl-emg-call" href={`tel:${tel.replace(/-/g,"")}`}><Icon name="phone" size={14}/> {tel}</a>:<button className="yl-emg-call ghost" onClick={()=>{setEmergencyOpen(false);setTab(c.space);openCardEdit(c);}}>{t("emg.addNumber")}</button>}
          </li>
        );};
        return(
        <div className="yl-help-ov" onClick={()=>setEmergencyOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head">
              <h2 className="yl-help-title"><Icon name="activity" size={18}/> {t("emg.title")}</h2>
              <button className="yl-help-close" onClick={()=>setEmergencyOpen(false)}>×</button>
            </div>
            <p className="yl-emg-lead">{t("emg.lead")}</p>

            <div className="yl-emg-step">
              <div className="yl-emg-stephd"><span className="yl-emg-stepnum">1</span>{t("emg.step1")}</div>
              {primaryTel?(
                <a className="yl-emg-callbig" href={`tel:${primaryTel.replace(/-/g,"")}`}><Icon name="phone" size={22}/><span className="yl-emg-callbig-t"><b>{primary.title||t("emg.callDefault")}</b><span>{primaryTel}</span></span></a>
              ):(
                <button className="yl-emg-callbig ghost" onClick={()=>{setEmergencyOpen(false);setTab(dog?dog.id:(activeMember?activeMember.id:"me"));setPersonSeg&&setPersonSeg("manage");openCardNew("hospital");}}><Icon name="plus" size={22}/><span className="yl-emg-callbig-t"><b>{t("emg.registerHosp")}</b><span>{t("emg.registerHospSub")}</span></span></button>
              )}
              {primaryTel&&(primary.hours||primary.addr)&&<div className="yl-emg-callmeta">{primary.hours&&<span><Icon name="bell" size={12}/> {primary.hours}</span>}{primary.addr&&<span><Icon name="pin" size={12}/> {primary.addr}</span>}</div>}
              <p className="yl-emg-note">{t("emg.note1")}</p>
            </div>

            <div className="yl-emg-red">
              <div className="yl-emg-redhd"><Icon name="alert" size={15}/> {t("emg.redHead")}</div>
              <div className="yl-emg-redtags">{(lang==="ja"?EMERGENCY_REDFLAGS:EMERGENCY_REDFLAGS_EN).map((tg,i)=><span key={i} className="yl-emg-redtag">{tg}</span>)}</div>
            </div>

            <button className="yl-emg-dont" onClick={()=>setEmgDontOpen(o=>!o)}><span>⚠️ {t("emg.dontHead")}</span><Icon name="chevron" size={16} className={emgDontOpen?"yl-rot90":"yl-rot0"}/></button>
            {emgDontOpen&&<ul className="yl-emg-dontlist"><li>{t("emg.dont1")}</li><li>{t("emg.dont2")}</li><li>{t("emg.dont3")}</li></ul>}

            <div className="yl-emg-step">
              <div className="yl-emg-stephd"><span className="yl-emg-stepnum">2</span>{t("emg.step2")}</div>
              {dog&&<div className="yl-emg-dogcard"><span className="yl-emg-dogname">{dog.emoji||"🐕"} {dog.name}</span><span className="yl-emg-dogmeta">{dogMeta||t("emg.profNone")}</span></div>}
              {ti&&<div className="yl-emg-tox"><div className="yl-emg-toxhd"><Icon name="alert" size={13}/> {t("emg.toxHead")}</div><ul className="yl-emg-toxlist">{ti.what&&<li><span>{t("emg.toxWhat")}</span>{ti.what}</li>}{ti.amount&&<li><span>{t("emg.toxAmount")}</span>{ti.amount}</li>}{ti.when&&<li><span>{t("emg.toxWhen")}</span>{ti.when}</li>}{ti.weight&&<li><span>{t("emg.toxWeight")}</span>{ti.weight}</li>}{ti.symptom&&<li><span>{t("emg.toxSymptom")}</span>{ti.symptom}</li>}</ul></div>}
              <ul className="yl-emg-say"><li>{t("emg.say1")}</li><li>{t("emg.say2")}</li><li>{t("emg.say3")}</li></ul>
              <button className="yl-emg-tipshead" onClick={()=>setTipsOpen(o=>!o)}><span>{t("emg.tipsHead")}</span><Icon name="chevron" size={16} className={tipsOpen?"yl-rot90":"yl-rot0"}/></button>
              {tipsOpen&&<ul className="yl-emg-list">{(lang==="ja"?EMERGENCY_TIPS:EMERGENCY_TIPS_EN).map((tg,i)=><li key={i}><span className="yl-emg-num">{i+1}</span>{tg}</li>)}</ul>}
            </div>

            <div className="yl-emg-step">
              <div className="yl-emg-stephd"><span className="yl-emg-stepnum">3</span>{t("emg.step3")}</div>
              <div className="yl-emg-tiers">{(lang==="ja"?EMERGENCY_PREP_TIERS:EMERGENCY_PREP_TIERS_EN).map((g,i)=>(<div key={i} className="yl-emg-tier"><span className="yl-emg-tierlbl">{g.label}</span><ul>{g.items.map((it,j)=><li key={j}>{it}</li>)}</ul></div>))}</div>
              <p className="yl-emg-note">{t("emg.note2")}</p>
            </div>

            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="pin" size={15}/> {t("emg.contactsTitle")}</span><button className="yl-linkbtn" onClick={()=>{setEmergencyOpen(false);setTab(activeMember?activeMember.id:"me");setPersonSeg&&setPersonSeg("manage");openCardNew("hospital");}}>{t("emg.register")}</button></div>
              {(hospitals.length===0&&persons.length===0)?(
                <p className="yl-set-desc">{t("emg.contactsEmpty")}</p>
              ):(<>
                {hospitals.length>0&&<div className="yl-emg-cgroup"><div className="yl-emg-cglabel">{t("emg.groupHosp")}</div><ul className="yl-emg-contacts">{sortedH.map(renderContact)}</ul></div>}
                {persons.length>0&&<div className="yl-emg-cgroup"><div className="yl-emg-cglabel">{t("emg.groupPerson")}</div><ul className="yl-emg-contacts">{persons.map(renderContact)}</ul></div>}
              </>)}
            </div>

            <div className="yl-emg-sec">
              <button className="yl-emg-tipshead" onClick={()=>setEmgPrepOpen(o=>!o)}><span><Icon name="check" size={15}/> {t("emg.prepHead")}</span><Icon name="chevron" size={16} className={emgPrepOpen?"yl-rot90":"yl-rot0"}/></button>
              {emgPrepOpen&&<ul className="yl-emg-checklist">{(lang==="ja"?EMERGENCY_CHECKLIST:EMERGENCY_CHECKLIST_EN).map((tg,i)=><li key={i}><Icon name="check" size={13}/> {tg}</li>)}</ul>}
            </div>

            <p className="yl-toxic-foot">{t("emg.foot")}</p>
          </div>
        </div>
      );})()}
      {disasterOpen&&(()=>{
        const shelters=items.filter(x=>x.type==="card"&&x.kind==="shelter");
        return(
        <div className="yl-help-ov" onClick={()=>setDisasterOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head">
              <h2 className="yl-help-title"><Icon name="home" size={18}/> {t("disaster.title")}</h2>
              <button className="yl-help-close" onClick={()=>setDisasterOpen(false)}>×</button>
            </div>
            <div className="yl-emg-alert"><Icon name="alert" size={16}/><span>{t("disaster.alert")}</span></div>

            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="pin" size={15}/> {t("disaster.shelterTitle")}</span><button className="yl-linkbtn" onClick={()=>{setDisasterOpen(false);setTab(activeMember?activeMember.id:"me");setPersonSeg&&setPersonSeg("manage");openCardNew("shelter");}}>{t("disaster.registerShelter")}</button></div>
              {shelters.length===0?(
                <p className="yl-set-desc">{t("disaster.shelterEmpty")}</p>
              ):(
                <ul className="yl-emg-contacts">{shelters.map(c=>{const tel=extractTel(c.body);return(
                  <li key={c.id} className="yl-emg-contact">
                    <div className="yl-emg-cbody"><span className="yl-emg-cname">{c.title||t("disaster.shelterFallback")}</span>{c.body&&<span className="yl-emg-cnote">{c.body}</span>}<span className="yl-emg-cwho">{nameOf(c.space)}</span></div>
                    {tel?<a className="yl-emg-call" href={`tel:${tel.replace(/-/g,"")}`}><Icon name="phone" size={14}/> {tel}</a>:<button className="yl-emg-call ghost" onClick={()=>{setDisasterOpen(false);setTab(c.space);openCardEdit(c);}}>{t("a11y.edit")}</button>}
                  </li>
                );})}</ul>
              )}
            </div>

            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="bag" size={15}/> {t("disaster.prepTitle")}</span></div>
              <ul className="yl-emg-prep">{(lang==="ja"?DISASTER_PREP:DISASTER_PREP_EN).map((tg,i)=><li key={i}><Icon name="check" size={13}/> {tg}</li>)}</ul>
            </div>

            <div className="yl-emg-sec">
              <button className="yl-emg-tipshead" onClick={()=>setDisasterTipsOpen(o=>!o)}><span><Icon name="bell" size={15}/> {t("disaster.tipsHead")}</span><Icon name="chevron" size={16} className={disasterTipsOpen?"yl-rot90":"yl-rot0"}/></button>
              {disasterTipsOpen&&<ul className="yl-emg-list">{(lang==="ja"?DISASTER_TIPS:DISASTER_TIPS_EN).map((tg,i)=><li key={i}><span className="yl-emg-num">{i+1}</span>{tg}</li>)}</ul>}
            </div>

            <p className="yl-toxic-foot">{t("disaster.foot")}</p>
          </div>
        </div>
      );})()}
      {toxicOpen&&(()=>{
        const q=toxicQ.trim().toLowerCase();
        const list=TOXIC_ITEMS
          .filter(t=>toxicSp==="all"||t.species==="both"||t.species===toxicSp)
          .filter(t=>toxicCat==="all"||t.category===toxicCat)
          .filter(t=>{if(!q)return true;const hay=[t.name,...(t.aliases||[]),t.toxic,(t.symptoms||[]).join("")].join("").toLowerCase();return hay.includes(q);})
          .sort((a,b)=>TOX_RANK[a.risk]-TOX_RANK[b.risk]);
        const petW=(()=>{const m=(activeMember&&activeMember.kind==="pet")?activeMember:petMembers[0];if(!m)return null;const wl=items.filter(x=>x.space===m.id&&x.type==="health"&&x.weight!=null).sort((a,b)=>(a.date||"").localeCompare(b.date||"")).pop();return wl?`${wl.weight}${wl.wunit||"kg"}`:null;})();
        return(
        <div className="yl-help-ov" onClick={()=>setToxicOpen(false)}>
          <div className="yl-help-page yl-tox" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head">
              <h2 className="yl-help-title"><Icon name="alert" size={18}/> 誤食・中毒</h2>
              <button className="yl-help-close" onClick={()=>setToxicOpen(false)}>×</button>
            </div>
            <button className="yl-tox-emg" onClick={()=>{const m=(activeMember&&activeMember.kind==="pet")?activeMember:petMembers[0];let w="";if(m){const wl=items.filter(x=>x.space===m.id&&x.type==="health"&&x.weight!=null).sort((a,b)=>(a.date||"").localeCompare(b.date||"")).pop();if(wl)w=`${wl.weight}${wl.wunit||"kg"}`;}setToxicEmgForm({what:"",amount:"",when:"",weight:w,symptom:""});setToxicEmgOpen(true);}}><span className="yl-tox-emg-ico">🚑</span><span className="yl-tox-emg-txt"><b>今、食べたかも？</b><span>落ち着いて、順番に確認しましょう</span></span><Icon name="chevron" size={18}/></button>
            <p className="yl-tox-warn"><Icon name="alert" size={14}/> 症状がなくても後から出ることが。家庭で吐かせないで。</p>
            <div className="yl-tox-controls">
              <input className="yl-input sm yl-tox-search" value={toxicQ} onChange={e=>setToxicQ(e.target.value)} placeholder="例：チョコ ／ 玉ねぎ ／ ぶどう ／ キシリトール"/>
              <div className="yl-tox-cats">{TOX_CATS.map(c=><button key={c.k} className={"yl-tox-cat"+(toxicCat===c.k?" on":"")} onClick={()=>setToxicCat(c.k)}>{c.l}</button>)}</div>
              <div className="yl-tox-tabs">{[{k:"all",l:"犬・猫"},{k:"dog",l:"犬"},{k:"cat",l:"猫"}].map(o=><button key={o.k} className={"yl-tox-tab"+(toxicSp===o.k?" on":"")} onClick={()=>setToxicSp(o.k)}>{o.l}</button>)}</div>
            </div>
            <ul className="yl-tox-list">
              {list.map(t=>{const R=TOX_RISK[t.risk];const open=toxicExpanded===t.id;const donts=[...(t.dont||[]),...TOX_DONT_CORE];const vets=[...(t.vet||[]),...TOX_VET_CORE];return(
                <li key={t.id} className={"yl-tox-item r-"+t.risk}>
                  <button className="yl-tox-row" onClick={()=>setToxicExpanded(open?null:t.id)} aria-expanded={open}>
                    <span className={"yl-tox-badge r-"+t.risk}>{R.emoji} {R.label}</span>
                    <span className="yl-tox-name">{t.name}{t.species!=="both"&&<span className="yl-tox-sp">{t.species==="dog"?"犬":"猫"}</span>}</span>
                    <Icon name="chevron" size={16} className={open?"yl-rot90":""}/>
                  </button>
                  <p className="yl-tox-lead">{t.toxic}</p>
                  {open&&<div className="yl-tox-detail">
                    <div className="yl-tox-d"><h4>症状</h4><p>{t.symptoms.join("・")}</p></div>
                    <div className="yl-tox-d"><h4>発症の目安</h4><p>{t.onset}</p></div>
                    <div className="yl-tox-d urg"><h4><Icon name="activity" size={12}/> すぐ受診したいケース</h4><p>{t.urgency}</p></div>
                    <div className="yl-tox-d dont"><h4><Icon name="ban" size={12}/> やってはいけないこと</h4><ul>{donts.map((d,i)=><li key={i}>{d}</li>)}</ul></div>
                    <div className="yl-tox-d"><h4><Icon name="phone" size={12}/> 病院に伝える情報</h4><ul>{vets.map((v,i)=><li key={i}>{v}</li>)}</ul></div>
                    {t.variesBy&&<p className="yl-tox-varies">危険度は {t.variesBy.join("・")} で変わります。{petW?`（${(activeMember&&activeMember.kind==="pet")?activeMember.name:"登録"}の体重：${petW}）`:""}</p>}
                    <p className="yl-tox-src">{t.source||TOX_SOURCE}／最終確認 {t.lastReviewedAt||TOX_REVIEWED}</p>
                  </div>}
                </li>
              );})}
              {list.length===0&&<li className="yl-tox-empty">該当が見つかりませんでした。心当たりが無くても、食べた可能性があれば動物病院にご相談ください。</li>}
            </ul>
            <p className="yl-toxic-foot">※ これは診断ではありません。量・体重・部位・経過・個体差で判断が変わります。迷ったら動物病院・夜間救急へ。</p>
            <div className="yl-tox-srcbox">
              <button className="yl-tox-srchead" onClick={()=>setToxicSrcOpen(o=>!o)} aria-expanded={toxicSrcOpen}><Icon name="shield" size={13}/> 情報源について<Icon name="chevron" size={15} className={toxicSrcOpen?"yl-rot90":""}/></button>
              {toxicSrcOpen&&<div className="yl-tox-srcbody">
                <p>このリストは、ASPCA中毒管理センター・Pet Poison Helpline・Merck獣医マニュアル 等、一般に公開された獣医毒性の情報を参照して整理しています。</p>
                <p>具体的な毒性量・致死量・安全量は、量・体重・個体差で大きく変わり誤用の危険があるため、<b>意図的に掲載していません</b>。</p>
                <p>掲載は一般的な注意であり、<b>診断ではありません</b>。実際の判断は必ず動物病院・中毒専門の窓口にご確認ください。情報源が確認できない内容は断定的に載せていません。</p>
                <p className="yl-tox-src">最終確認：{TOX_REVIEWED}</p>
              </div>}
            </div>
          </div>
        </div>
        );})()}
      {toxicEmgOpen&&(()=>{
        const petW=(()=>{const m=(activeMember&&activeMember.kind==="pet")?activeMember:petMembers[0];if(!m)return null;const wl=items.filter(x=>x.space===m.id&&x.type==="health"&&x.weight!=null).sort((a,b)=>(a.date||"").localeCompare(b.date||"")).pop();return wl?`${m.name}：${wl.weight}${wl.wunit||"kg"}`:m.name;})();
        return(
        <div className="yl-help-ov" onClick={()=>setToxicEmgOpen(false)}>
          <div className="yl-modal vetmodal yl-tox-emgmodal" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title" style={{textAlign:"left"}}>🚑 落ち着いて、この5つを確認</h3>
            <p className="yl-tox-emg-sub">これは診断ではありません。この内容を持って、動物病院・夜間救急にご相談ください。</p>
            <ol className="yl-tox-emg-list">
              <li><span className="yl-tox-emg-q">何を食べた？</span><input className="yl-input sm" value={toxicEmgForm.what} onChange={e=>setToxicEmgForm(f=>({...f,what:e.target.value}))} placeholder="例：チョコ、玉ねぎ、薬 など"/></li>
              <li><span className="yl-tox-emg-q">どのくらい？</span><input className="yl-input sm" value={toxicEmgForm.amount} onChange={e=>setToxicEmgForm(f=>({...f,amount:e.target.value}))} placeholder="例：ひとかけ／1錠／量は不明"/></li>
              <li><span className="yl-tox-emg-q">いつ？</span><input className="yl-input sm" value={toxicEmgForm.when} onChange={e=>setToxicEmgForm(f=>({...f,when:e.target.value}))} placeholder="例：10分前／さっき／不明"/></li>
              <li><span className="yl-tox-emg-q">犬の体重{petW?<span className="yl-tox-emg-w">（{petW}）</span>:""}</span><input className="yl-input sm" value={toxicEmgForm.weight} onChange={e=>setToxicEmgForm(f=>({...f,weight:e.target.value}))} placeholder="例：8kg"/></li>
              <li><span className="yl-tox-emg-q">今の症状は？</span><input className="yl-input sm" value={toxicEmgForm.symptom} onChange={e=>setToxicEmgForm(f=>({...f,symptom:e.target.value}))} placeholder="例：元気／嘔吐／ふらつき／けいれん"/></li>
            </ol>
            <p className="yl-tox-warn"><Icon name="alert" size={14}/> 症状がなくても受診が必要なことが。様子見せず、吐かせないで。</p>
            <div className="yl-modal-btns">
              <button className="yl-modal-cancel" onClick={()=>setToxicEmgOpen(false)}>とじる</button>
              <button className="yl-addbtn modal" onClick={()=>{const f=toxicEmgForm;const has=f.what||f.amount||f.when||f.symptom;setToxicEmgInfo(has?{...f}:null);setToxicEmgOpen(false);setToxicOpen(false);setEmergencyOpen(true);}}><Icon name="phone" size={16}/> 病院に相談する</button>
            </div>
          </div>
        </div>
        );})()}
      {wxAddOpen&&(
        <div className="yl-help-ov" onClick={()=>{setWxAddOpen(false);setWxResults(null);setWxQuery("");}}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head"><h2 className="yl-help-title"><Icon name="thermometer" size={18}/> 地点を追加</h2><button className="yl-help-close" onClick={()=>{setWxAddOpen(false);setWxResults(null);setWxQuery("");}} aria-label="閉じる">×</button></div>
            <p className="yl-set-desc">自宅・実家・公園・旅行先などを登録。<br/>「現在地」は今いる場所。検索して登録もOK。</p>
            <button className="yl-addbtn sm" style={{marginTop:4}} onClick={useCurrentLoc} disabled={wxGeoLoading}><Icon name="pin" size={14}/> {wxGeoLoading?"現在地を取得中…":"現在地を使う"}</button>
            <div className="yl-wxsearch" style={{marginTop:12}}>
              <input className="yl-input sm" value={wxQuery} onChange={e=>setWxQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchPlace()} placeholder="地名で検索（例：横浜・軽井沢）"/>
              <button className="yl-addbtn sm" onClick={searchPlace} disabled={wxSearching}>{wxSearching?"検索中…":"検索"}</button>
            </div>
            {wxResults!=null&&(wxResults.length===0?<p className="yl-set-desc" style={{marginTop:8}}>見つかりませんでした。別の地名でお試しください。</p>:<ul className="yl-wxlist">{wxResults.map((r,i)=>{const sub=[...placeParts(r),r.country&&r.country!=="日本"?r.country:""].filter(Boolean).join(" ");return(<li key={i}><button className="yl-wxrow" onClick={()=>pickPlace(r)}><Icon name="pin" size={14}/><span className="yl-wxrow-body"><span className="yl-wxrow-name">{r.name}</span>{sub&&<span className="yl-wxrow-sub">{sub}</span>}</span>{r.population?<span className="yl-wxrow-pop">人口{r.population>=10000?`${Math.round(r.population/10000)}万`:r.population.toLocaleString()}</span>:null}</button></li>);})}</ul>)}
            <p className="yl-set-desc" style={{marginTop:8,fontSize:12}}>同名の地名に注意（例：新宿→東京都）。名前は後で変更できます。</p>
            <button className="yl-addbtn" style={{width:"100%",marginTop:10}} onClick={()=>{setWxAddOpen(false);setWxResults(null);setWxQuery("");}}>とじる</button>
          </div>
        </div>
      )}
      {noticesOpen&&(
        <div className="yl-help-ov" onClick={()=>setNoticesOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head"><h2 className="yl-help-title"><Icon name="paw" size={18}/> 今日のLOALIFE</h2><button className="yl-help-close" onClick={()=>setNoticesOpen(false)} aria-label="閉じる">×</button></div>
            {notices.length===0?(
              <p className="yl-notice-empty">今日はお知らせはありません。<br/>のんびり過ごせそうです。</p>
            ):(
              <ul className="yl-notice-list">
                {notices.map(n=>{const m=NOTICE_META[n.cat];return(
                  <li key={n.id} className={"yl-notice "+n.cat}>
                    <span className="yl-notice-cat"><Icon name={m.icon} size={13}/> {m.label}</span>
                    <span className="yl-notice-title">{n.title}</span>
                    {n.body&&<span className="yl-notice-body">{n.body}</span>}
                    {n.go&&<button className="yl-notice-act" onClick={()=>{setNoticesOpen(false);n.go();}}>{n.actionLabel} →</button>}
                  </li>
                );})}
              </ul>
            )}
            <p className="yl-notice-foot">大切な家族の毎日を見て、気づいたことをそっとお届けします。</p>
          </div>
        </div>
      )}
      {whatsNewOpen&&(
        <div className="yl-help-ov" onClick={()=>setWhatsNewOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head"><h2 className="yl-help-title"><Icon name="sparkles" size={18}/> 変更点・新機能</h2><button className="yl-help-close" onClick={()=>setWhatsNewOpen(false)} aria-label="閉じる">×</button></div>
            <p className="yl-set-desc" style={{marginBottom:2}}>バージョン：<strong>β版</strong></p>
            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="sparkles" size={15}/> 最近のアップデート</span></div>
              <ul className="yl-whatsnew-list">
                {[
                  ["🍚","フード・食事管理","種類・量・カロリー・今日の食事を記録"],
                  ["📋","「今日やること」を横断表示","自分・家族・ペットのやることを1か所で"],
                  ["💊","お薬の管理","登録して「のんだ」で飲み忘れ防止"],
                  ["🏥","通院・健診・証明書","通院・次回予定・証明書を写真で保存"],
                  ["🧼","お世話ログ","実施日と前回からの経過を色で表示"],
                  ["🐶🐱","まとめてお世話","複数のうちのこへ一括で記録"],
                  ["🌈","虹の橋（お別れの記録）","そっと思い出を振り返るモードに"],
                  ["📸","「1年前の今日」の思い出","過去の同じ日をホームでふりかえり"],
                  ["🌦","お散歩判定に気象庁の警報を反映","警報中は「お散歩は控えて」を表示"],
                  ["🌙","ダークモード","端末に合わせる／ライト／ダーク"],
                  ["🐶","家族・うちのこは登録数に上限なし","色を増やして大家族・多頭飼いも見分けやすく"],
                  ["🖼","思い出をまとめて別の子へ移動","写真を最大30枚選んで一括で移動"],
                  ["🗓","写真カレンダー","まとめて追加で、撮影日ごとに自動整理"],
                ].map((r,i)=>(
                  <li key={i} className="yl-whatsnew-item"><span className="yl-whatsnew-emoji">{r[0]}</span><span className="yl-whatsnew-body"><span className="yl-whatsnew-title">{r[1]}</span><span className="yl-whatsnew-desc">{r[2]}</span></span></li>
                ))}
              </ul>
            </div>
            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="clock" size={15}/> 近日対応予定</span></div>
              <p className="yl-set-desc" style={{marginTop:2}}>予定していた機能はひととおり公開ずみ 🎉<br/>「こんな機能がほしい」があれば、ぜひお聞かせください。</p>
            </div>
            <button className="yl-addbtn" style={{width:"100%",marginTop:6}} onClick={()=>{setWhatsNewOpen(false);setHelpOpen(true);}}><Icon name="note" size={15}/> 使い方・機能紹介を見る</button>
            <button className="yl-addbtn" style={{width:"100%",marginTop:8,background:"var(--line3)",color:"var(--ink2)"}} onClick={()=>setWhatsNewOpen(false)}>とじる</button>
          </div>
        </div>
      )}
      {aboutOpen&&(
        <div className="yl-help-ov" onClick={()=>setAboutOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head"><h2 className="yl-help-title"><Icon name="note" size={18}/> このアプリについて</h2><button className="yl-help-close" onClick={()=>setAboutOpen(false)} aria-label="閉じる">×</button></div>
            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="paw" size={15}/> LOALIFE</span></div>
              <p className="yl-set-desc">大切な家族（ペットも子どもも）の毎日の記録・予定・健康を、ひとつの場所に。<br/>もしものときの備え（迷子ポスター・緊急カード）まで、まるごと見守るアプリです。</p>
              <p className="yl-set-desc" style={{marginTop:6}}>バージョン：<strong>β版</strong></p>
            </div>
            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="download" size={15}/> データとプライバシー</span></div>
              <p className="yl-set-desc">記録・写真は<strong>この端末内だけ</strong>に保存され、外部には送信されません。機種変更・削除に備えて、設定の「バックアップ」から書き出せます。</p>
            </div>
            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="users" size={15}/> 家族での共有</span></div>
              <p className="yl-set-desc"><strong>現在はオフ</strong>（個人利用向け）。今後、家族と記録を共有できる機能を予定しています。</p>
            </div>
            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="alert" size={15}/> ご利用にあたって</span></div>
              <p className="yl-set-desc">記録や目安は<strong>参考情報</strong>で、診断・治療の代わりにはなりません。気になるとき・緊急時は、かかりつけや専門機関にご相談ください。</p>
            </div>
            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="note" size={15}/> 利用規約・お問い合わせ</span></div>
              <p className="yl-set-desc">利用規約・プライバシーポリシー・お問い合わせ窓口は準備中です。連絡先は追ってご案内します。</p>
            </div>
            <button className="yl-addbtn" style={{width:"100%",marginTop:6}} onClick={()=>setAboutOpen(false)}>とじる</button>
          </div>
        </div>
      )}
      {helpOpen&&(
        <div className="yl-help-ov" onClick={()=>setHelpOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head">
              <h2 className="yl-help-title"><Icon name="note" size={18}/> LOALIFE の使い方</h2>
              <button className="yl-help-close" onClick={()=>setHelpOpen(false)} aria-label="閉じる">×</button>
            </div>
            <p className="yl-help-lead">大切な家族の毎日と、もしもの備えを、ひとつに。</p>
            {[
              {group:"毎日のこと",items:[
                {emoji:"🏠",title:"ホーム",desc:"今日やること・うっかり忘れをまとめて。"},
                {emoji:"👨‍👩‍👧",title:"メンバー",desc:"うちの子も家族も自分も。写真や絵文字で。"},
                {emoji:"📅",title:"カレンダー",desc:"みんなの予定を色分けで見わたす。"},
                {emoji:"📝",title:"今日のようす",desc:"元気・食欲・うんち・写真をそのまま記録。"},
                {emoji:"📸",title:"思い出・はじめて",desc:"とっておきの一枚とタグで成長をたどる。"},
              ]},
              {group:"健康・予定の管理",items:[
                {emoji:"💉",title:"ケア・予定・投薬",desc:"ワクチン・通院・お薬を忘れずに。"},
                {emoji:"🧹",title:"毎日のお世話",desc:"「やった」をタップ。前回からの日数が色で。"},
                {emoji:"📈",title:"からだの記録",desc:"体重の変化をグラフで見守る。"},
                {emoji:"💰",title:"支出",desc:"病院代もフード代も、何にいくらか。"},
                {emoji:"🛍",title:"ストック・持ち物",desc:"切らす前にお知らせ。曜日の持ち物も。"},
              ]},
              {group:"もしもの備え",items:[
                {emoji:"📌",title:"大切な情報",desc:"かかりつけ・緊急連絡先を手元に。"},
                {emoji:"🆘",title:"迷子ポスター・緊急カード",desc:"いざという時、登録情報からすぐ作れる。"},
                {emoji:"🔔",title:"通知・リマインド",desc:"大事な予定を、そっとお知らせ。"},
              ]},
            ].map((g,gi)=>(
              <div key={gi} className="yl-help-group">
                <h3 className="yl-help-grouptitle">{g.group}</h3>
                {g.items.map((f,i)=>(
                  <div key={i} className="yl-help-item">
                    <span className="yl-help-emoji">{f.emoji}</span>
                    <div className="yl-help-body"><span className="yl-help-itemtitle">{f.title}</span><span className="yl-help-desc">{f.desc}</span></div>
                  </div>
                ))}
              </div>
            ))}
            <p className="yl-help-note">長押しで並び替えできます。データはこの端末に保存され、ホーム画面に追加するとより安心です。</p>
            <button className="yl-addbtn" style={{width:"100%",marginTop:6}} onClick={()=>setHelpOpen(false)}>とじる</button>
          </div>
        </div>
      )}
      {editItemId&&<div className="yl-overlay" onClick={()=>setEditItemId(null)}><div className="yl-modal edit" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">編集</h3><input className="yl-input" value={eTitle} onChange={e=>setETitle(e.target.value)} placeholder="タイトル"/><div className="yl-optrow"><label className="yl-opt">期限<input type="date" className="yl-date" value={eDate} onChange={e=>setEDate(e.target.value)}/></label><label className="yl-opt">時間<TimeInput value={eTime} onChange={setETime}/></label><label className="yl-opt">繰り返し<select className="yl-select" value={eRepeat} onChange={e=>setERepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div><div className="yl-notify"><span className="yl-notify-label"><Icon name="bell" size={14}/> 通知</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(eReminders.includes(o.key)?" on":"")} onClick={()=>toggleEReminder(o.key)}>{o.label}</button>)}</div>{eReminders.length>=4&&<p className="yl-notify-hint">🔔が多いと見落としがち。必要なぶんだけに。</p>}</div><div className="yl-detailfields"><label className="yl-detail-field"><span className="yl-detail-flabel"><Icon name="pin" size={13}/> 場所</span><input className="yl-input sm" value={ePlace} onChange={e=>setEPlace(e.target.value)} placeholder="例：〇〇病院 3F・△△公園"/></label><label className="yl-detail-field"><span className="yl-detail-flabel"><Icon name="link" size={13}/> URL</span><input className="yl-input sm" type="url" inputMode="url" value={eUrl} onChange={e=>setEUrl(e.target.value)} placeholder="予約ページ等のリンク"/></label><label className="yl-detail-field"><span className="yl-detail-flabel"><Icon name="note" size={13}/> メモ</span><textarea className="yl-input sm yl-detail-memo" value={eMemo} onChange={e=>setEMemo(e.target.value)} placeholder="持ち物・注意点など自由に" rows={3}/></label>{(items.find(x=>x.id===editItemId)||{}).type==="care"&&<label className="yl-detail-field"><span className="yl-detail-flabel"><Icon name="pill" size={13}/> 在庫（回分・任意）</span><input className="yl-input sm" type="number" inputMode="numeric" min="0" value={eStock} onChange={e=>setEStock(e.target.value)} placeholder="例：3（フィラリア等の買い足しめやすに）"/></label>}<div className="yl-detail-field"><span className="yl-detail-flabel"><Icon name="check" size={13}/> チェックリスト（持ち物など）</span>{eChecklist.length>0&&<ul className="yl-clist">{eChecklist.map(c=>(<li key={c.id} className="yl-clist-item"><button type="button" className={"yl-clist-box"+(c.done?" on":"")} onClick={()=>toggleECheck(c.id)} aria-label="チェック"><svg viewBox="0 0 24 24" width="12" height="12"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></button><span className={"yl-clist-text"+(c.done?" done":"")}>{c.text}</span><button type="button" className="yl-clist-del" onClick={()=>removeECheck(c.id)} aria-label="削除">×</button></li>))}</ul>}<div className="yl-clist-add"><input className="yl-input sm" value={eCheckDraft} onChange={e=>setECheckDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addECheck();}}} placeholder="項目を追加（例：保険証）"/><button type="button" className="yl-addbtn sm" onClick={addECheck}>＋</button></div></div></div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEditItemId(null)}>とじる</button><button className="yl-addbtn modal" onClick={saveEdit}>保存</button></div></div></div>}
      {viewer&&<div className="yl-overlay" onClick={()=>setViewer(null)}><div className="yl-modal photo" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">{viewer.isMemory?"思い出":"証明書"}</h3>{viewer.loading?<p className="yl-loading">読み込み中…</p>:viewer.src?<img className="yl-photo-img" src={viewer.src} alt={viewer.isMemory?"思い出":"証明書"}/>:<p className="yl-empty">画像が見つかりませんでした</p>}{viewer.confirming?<><p className="yl-modal-body" style={{margin:"0 0 12px"}}>この写真を削除しますか？元に戻せません。</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setViewer(v=>({...v,confirming:false}))}>やめる</button><button className="yl-modal-del" onClick={()=>viewer.isMemory?removeMemory(viewer.id):removePhoto(viewer.id)}>削除する</button></div></>:<div className="yl-modal-btns">{viewer.src&&<button className="yl-modal-cancel" onClick={()=>setViewer(v=>({...v,confirming:true}))}>削除</button>}<button className="yl-addbtn modal" onClick={()=>setViewer(null)}>とじる</button></div>}</div></div>}
      {albumMoveOpen&&(()=>{const targets=spaces.filter(s=>s.id!==tab);return(
        <div className="yl-overlay" onClick={()=>setAlbumMoveOpen(false)}><div className="yl-modal" onClick={e=>e.stopPropagation()}>
          <h3 className="yl-modal-title">どの子へ移動しますか？</h3>
          <p className="yl-modal-body" style={{margin:"0 0 14px"}}>{t("album.moveDesc",{n:(albumSel||[]).length})}</p>
          {targets.length===0?(
            <p className="yl-empty" style={{marginBottom:14}}>移動先がいません。先に家族・うちのこを登録してください。</p>
          ):(
            <div className="yl-album-movelist">{targets.map(s=>(
              <button key={s.id} className="yl-album-moverow" onClick={()=>moveMemoriesTo(s.id)}>
                <span className="yl-album-moveava" style={{background:colorOf(s.id)+"22"}}>{avatarNode(s,"xs")}</span>
                <span className="yl-album-movename">{s.name}</span>
                <span className="yl-album-movearrow">→</span>
              </button>
            ))}</div>
          )}
          <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setAlbumMoveOpen(false)}>やめる</button></div>
        </div></div>
      );})()}
      {pickerId&&<div className="yl-overlay" onClick={()=>setPickerId(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">絵文字を選ぶ</h3><div className="yl-emoji-grid">{PICKER_EMOJIS.map(e=><button key={e} className="yl-emoji-pick" onClick={()=>setEmoji(pickerId,e)}>{e}</button>)}</div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEmoji(pickerId,"")}>絵文字なし</button><button className="yl-modal-cancel" onClick={()=>setPickerId(null)}>とじる</button></div></div></div>}
      {mePicker&&<div className="yl-overlay" onClick={()=>{persistMeName(meNameDraft.trim());setMePicker(false);}}><div className="yl-modal edit" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">あなたのアイコン・名前</h3>
        <div className="yl-editavatar">
          {meAvatar&&photos[meAvatar]?<img className="yl-avatar lg" src={photos[meAvatar]} alt=""/>:<span className="yl-editavatar-emoji">{meEmoji}</span>}
          <label className="yl-editavatar-btn"><Icon name="camera" size={14}/> 写真にする<input type="file" accept="image/*" style={{display:"none"}} onChange={pickMeAvatar}/></label>
          {meAvatar&&<button className="yl-editavatar-clear" onClick={clearMeAvatar}>絵文字に戻す</button>}
        </div>
        <label className="yl-opt" style={{width:"100%",marginBottom:12}}>名前（任意）<input className="yl-input sm" style={{marginTop:4}} value={meNameDraft} onChange={e=>setMeNameDraft(e.target.value)} placeholder="わたし"/></label>
        {!meAvatar&&<><p className="yl-modal-body" style={{margin:"0 0 8px"}}>絵文字を選ぶ</p><div className="yl-emoji-grid">{ME_EMOJIS.map(e=><button key={e} className={"yl-emoji-pick"+(meEmoji===e?" on":"")} onClick={()=>{persistMeEmoji(e);}}>{e}</button>)}</div></>}
        <p className="yl-modal-body" style={{margin:"4px 0 8px"}}><Icon name="palette" size={14}/> カレンダーの色</p><div className="yl-colorrow" style={{justifyContent:"center",marginBottom:14}}>{MEMBER_COLORS.map(col=><button key={col} className={"yl-colordot"+(colorOf("me")===col?" on":"")} style={{background:col}} onClick={()=>persistMeColor(col)} aria-label="色を選ぶ"/>)}</div>
        <div className="yl-modal-btns"><button className="yl-addbtn modal" onClick={()=>{persistMeName(meNameDraft.trim());setMePicker(false);}}>保存して閉じる</button></div></div></div>}
      {confirmDel&&<div className="yl-overlay" onClick={()=>setConfirmDel(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji">{confirmDel.emoji}</div><h3 className="yl-modal-title">{confirmDel.name} を削除しますか？</h3><p className="yl-modal-body">{(()=>{const n=items.filter(x=>x.space===confirmDel.id).length;return n>0?`${confirmDel.name}のケア（${n}件）も一緒に消えます。この操作は元に戻せません。`:"この操作は元に戻せません。";})()}</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmDel(null)}>キャンセル</button><button className="yl-modal-del" onClick={()=>removeMember(confirmDel.id)}>削除する</button></div></div></div>}
      {lifeDraft&&(
        <div className="yl-overlay" onClick={()=>setLifeDraft(null)}>
          <div className="yl-modal edit life" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{lifeDraft.mode==="edit"?t("life.editTitle"):t("life.newTitle")}</h3>
            {/* カテゴリ */}
            <div className="yl-typerow" style={{marginBottom:10}}>{CAL_CATS.map(c=><button key={c.key} className={"yl-chip"+(lifeDraft.category===c.key?" on":"")} style={lifeDraft.category===c.key?{background:"#E39A5C",color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setLifeDraft(p=>({...p,category:c.key}))}>{c.emoji} {t("cat."+c.key)}</button>)}</div>
            {/* 誰の */}
            <div className="yl-typerow" style={{marginBottom:10}}>{spaces.map(s=><button key={s.id} className={"yl-chip yl-chip-person"+(lifeDraft.space===s.id?" on":"")} style={lifeDraft.space===s.id?{background:"#D98A4E",color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setLifeDraft(p=>({...p,space:s.id}))}>{avatarNode(s,"xs")} {s.name}</button>)}</div>
            <input className="yl-input" value={lifeDraft.title} onChange={e=>setLifeDraft(p=>({...p,title:e.target.value}))} placeholder={lifeDraft.category==="event"?t("ph.eventTitle"):t("ph.memoTitle")}/>
            {/* 写真（複数可・証明書/処方箋もここに） */}
            <div className="yl-life-photos">
              {lifeDraft.photos.map(p=>(
                <div key={p.id} className="yl-life-thumb">
                  <img src={p.dataUrl} alt=""/>
                  <button className="yl-life-thumb-del" onClick={()=>removeLifePhoto(p.id)} aria-label={t("a11y.delete")}>×</button>
                </div>
              ))}
              <label className="yl-life-addphoto">＋<span>{t("common.photo")}</span><input type="file" accept="image/*" multiple style={{display:"none"}} onChange={pickLifePhoto}/></label>
            </div>
            <textarea className="yl-life-note" value={lifeDraft.note} onChange={e=>setLifeDraft(p=>({...p,note:e.target.value}))} placeholder={t("ph.diary")} rows={3}/>
            {lifeDraft.category==="memory"&&(()=>{
              const tags=lifeDraft.tags||[];
              const addTag=(t)=>{const v=(t||"").replace(/^#/,"").trim();if(!v||tags.includes(v))return;setLifeDraft(p=>({...p,tags:[...(p.tags||[]),v]}));setTagInput("");};
              return(
                <div className="yl-tagedit">
                  <span className="yl-tagedit-label"><Icon name="tag" size={14}/> {t("life.tag")}</span>
                  <div className="yl-tagedit-chips">
                    {tags.map(tg=><span key={tg} className="yl-tagedit-chip">#{tg}<button onClick={()=>setLifeDraft(p=>({...p,tags:p.tags.filter(x=>x!==tg)}))} aria-label={t("a11y.delete")}>×</button></span>)}
                    {!tags.includes(FIRST_TAG)&&<button className="yl-tagedit-quick" onClick={()=>addTag(FIRST_TAG)}><Icon name="sparkles" size={13}/> {t("life.firstTag")}</button>}
                  </div>
                  <div className="yl-tagedit-add"><input className="yl-input sm" value={tagInput} onChange={e=>setTagInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addTag(tagInput);}}} placeholder={t("ph.tag")}/><button className="yl-addbtn sm" onClick={()=>addTag(tagInput)}>{t("common.add")}</button></div>
                </div>
              );
            })()}
            <div className="yl-optrow"><label className="yl-opt">{t("life.date")}<input type="date" className="yl-date" value={lifeDraft.date} onChange={e=>setLifeDraft(p=>({...p,date:e.target.value}))}/></label><label className="yl-opt">{t("life.time")}<TimeInput value={lifeDraft.time} onChange={tv=>setLifeDraft(p=>({...p,time:tv}))}/></label>{lifeDraft.category==="event"&&<label className="yl-opt">{t("life.repeat")}<select className="yl-select" value={lifeDraft.repeat} onChange={e=>setLifeDraft(p=>({...p,repeat:e.target.value}))}>{REPEATS.map(r=><option key={r.key} value={r.key}>{t("repeat."+r.key)}</option>)}</select></label>}</div>
            {/* 通知は「予定」のときだけ。思い出・日記は過去の記録なので事前通知は表示しない */}
            {lifeDraft.category==="event"&&<div className="yl-notify"><span className="yl-notify-label"><Icon name="bell" size={14}/> {t("life.notify")}{notifPerm==="default"&&<button className="yl-notif-small" onClick={handleNotifRequest}>{t("notif.allowShort")}</button>}</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(lifeDraft.reminders.includes(o.key)?" on":"")} onClick={()=>toggleLifeReminder(o.key)}>{t("remind."+o.key)}</button>)}</div>{lifeDraft.reminders.length>=4&&<p className="yl-notify-hint">{t("life.notifyHint")}</p>}</div>}
            <div className="yl-modal-btns">
              {lifeDraft.mode==="edit"&&<button className="yl-modal-cancel" onClick={()=>askDelete(lifeDraft.title,()=>removeLife(lifeDraft.id))}>{t("common.delete")}</button>}
              <button className="yl-modal-cancel" onClick={()=>setLifeDraft(null)}>{t("common.close")}</button>
              <button className="yl-addbtn modal" onClick={saveLife}>{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}
      {cardEdit&&(
        <div className="yl-overlay" onClick={()=>setCardEdit(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name={cardIcon(cardEdit.kind)} size={18}/> {cardEdit.id?t("card.editTitle"):t("card.newTitle")}</h3>
            <div className="yl-typerow" style={{marginBottom:10}}>{CARD_PRESETS.map(p=><button key={p.key} className={"yl-chip"+(cardEdit.kind===p.key?" on":"")} style={cardEdit.kind===p.key?{background:"#D98A4E",color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setCardEdit(c=>({...c,kind:p.key,title:c.title||cardMeta(p.key).label}))}><Icon name={cardIcon(p.key)} size={14}/> {t("cardkind."+p.key)}</button>)}</div>
            <input className="yl-input" value={cardEdit.title} onChange={e=>setCardEdit(c=>({...c,title:e.target.value}))} placeholder={t("ph.cardTitle")}/>
            <textarea className="yl-life-note" value={cardEdit.body} onChange={e=>setCardEdit(c=>({...c,body:e.target.value}))} placeholder={t("ph.cardBody")} rows={4}/>
            {cardEdit.kind==="hospital"&&(<>
              <input className="yl-input" value={cardEdit.hours||""} onChange={e=>setCardEdit(c=>({...c,hours:e.target.value}))} placeholder={t("card.hoursPh")}/>
              <input className="yl-input" value={cardEdit.addr||""} onChange={e=>setCardEdit(c=>({...c,addr:e.target.value}))} placeholder={t("card.addrPh")}/>
              <label className="yl-lost-foundtoggle"><input type="checkbox" checked={!!cardEdit.night} onChange={e=>setCardEdit(c=>({...c,night:e.target.checked}))}/> {t("card.nightToggle")}</label>
            </>)}
            <div className="yl-life-photos">
              {cardEdit.photo?<div className="yl-life-thumb"><img src={cardEdit.photo} alt=""/><button className="yl-life-thumb-del" onClick={()=>setCardEdit(c=>({...c,photo:null,photoNew:true}))} aria-label={t("a11y.delete")}>×</button></div>:<label className="yl-life-addphoto">＋<span>{t("common.photo")}</span><input type="file" accept="image/*" style={{display:"none"}} onChange={pickCardPhoto}/></label>}
            </div>
            <div className="yl-modal-btns">
              {cardEdit.id&&<button className="yl-modal-cancel" onClick={()=>askDelete(cardEdit.title,()=>removeCard(cardEdit.id))}>{t("common.delete")}</button>}
              <button className="yl-modal-cancel" onClick={()=>setCardEdit(null)}>{t("common.close")}</button>
              <button className="yl-addbtn modal" onClick={saveCard}>{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}
      {expEdit&&(
        <div className="yl-overlay" onClick={()=>setExpEdit(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{t("exp.editTitle")}</h3>
            <div className="yl-exp-input"><span className="yl-exp-amt"><span className="yl-exp-yen">¥</span><input type="number" inputMode="numeric" className="yl-health-num" value={expEdit.amount} onChange={e=>setExpEdit(x=>({...x,amount:e.target.value}))} placeholder={t("common.amount")}/></span><select className="yl-select" value={expEdit.category} onChange={e=>setExpEdit(x=>({...x,category:e.target.value}))}>{(()=>{const cats=expenseCatsFor(curKind);const has=cats.some(c=>c.key===expEdit.category);return(has?cats:[...cats,expCatMeta(expEdit.category)]).map(c=><option key={c.key} value={c.key}>{c.emoji} {expCatLabel(c)}</option>);})()}</select></div>
            <input className="yl-input" style={{marginTop:10}} value={expEdit.note} onChange={e=>setExpEdit(x=>({...x,note:e.target.value}))} placeholder={t("common.memoOpt")}/>
            <label className="yl-opt" style={{marginTop:10}}>{t("exp.dateLabel")}<input type="date" className="yl-date" value={expEdit.date} onChange={e=>setExpEdit(x=>({...x,date:e.target.value}))}/></label>
            <div className="yl-modal-btns">
              <button className="yl-modal-cancel" onClick={()=>askDelete(t("exp.delLabel",{date:fmtDate(expEdit.date)}),()=>{removeExpense(expEdit.id);setExpEdit(null);})}>{t("common.delete")}</button>
              <button className="yl-modal-cancel" onClick={()=>setExpEdit(null)}>{t("common.close")}</button>
              <button className="yl-addbtn modal" onClick={saveExpEdit}>{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}
      {/* ＝＝＝ ＋入力ハブから開く入力モーダル（全入力を集約） ＝＝＝ */}
      {inputSheet==="schedule"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{isMemberTab?t("sched.titlePet"):selfCare?t("sched.titleSelf"):t("sched.titleMe")}</h3>
            {!(isMemberTab||selfCare)?<div className="yl-typerow me4">{ME_TYPES.map(t=><button key={t} className={"yl-chip"+(draftType===t?" on":"")} style={draftType===t?{background:TYPE_META[t].fg,color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setDraftType(t)}><Icon name={TYPE_ICON[t]} size={15}/> {lblOf(TYPE_META[t])}</button>)}</div>:<div className="yl-typerow">{careKindsFor(activeMember).map(k=><button key={k.key} className={"yl-chip"+(draftKind===k.key?" on":"")} style={draftKind===k.key?{background:(KIND_STYLE[activeMember?activeMember.kind:"person"]||{}).fg,color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>pickCareKind(k)}><Icon name={careIcon(k.key)} size={15}/> {careLabel(k)}</button>)}</div>}
            {suggestions.length>0&&<div className="yl-suggest"><span className="yl-suggest-label">{t("sched.frequent")}</span><div className="yl-suggest-chips">{suggestions.map(s=><button key={s} className="yl-suggest-chip" onClick={()=>{setDraft(s);setDraftAuto(false);}}>{s}</button>)}</div></div>}
            <div className="yl-add"><input className="yl-input" value={draft} onChange={e=>{setDraft(e.target.value);setDraftAuto(false);}} onKeyDown={e=>e.key==="Enter"&&addItem()} placeholder={(isMemberTab||selfCare)?(draftKind==="other"?t("sched.contentPh"):t("sched.addLabelPh",{label:careLabel(careKindsFor(activeMember).find(k=>k.key===draftKind))||t("sched.content")})):t("sched.addLabelPh",{label:lblOf(TYPE_META[draftType])})}/><button className="yl-addbtn" onClick={addItem}>{t("common.add")}</button></div>
            <div className="yl-optrow"><label className="yl-opt">{(isMemberTab||selfCare)?careDateLabel(draftKind):t("sched.dateOptMe")}<input type="date" className="yl-date" value={draftDate} onChange={e=>setDraftDate(e.target.value)}/></label><label className="yl-opt">{t("sched.time")}<TimeInput value={draftTime} onChange={setDraftTime}/></label><label className="yl-opt">{t("life.repeat")}<select className="yl-select" value={draftRepeat} onChange={e=>setDraftRepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div>
            {!(isMemberTab||selfCare)&&<p className="yl-foot" style={{marginTop:2}}>{t("sched.dateHint")}</p>}
            {(isMemberTab||selfCare)&&(
              <div className="yl-optrow" style={{marginTop:4}}>
                <label className="yl-opt" style={{width:"100%"}}><Icon name="camera" size={14}/> {t("sched.certPhoto")}
                  <div style={{display:"flex",alignItems:"center",gap:10,marginTop:6}}>
                    {draftPhoto&&<img src={draftPhoto} alt="" style={{width:52,height:52,objectFit:"cover",borderRadius:8,border:"1px solid #e7dfd3"}}/>}
                    <label className="yl-addbtn sm" style={{cursor:"pointer"}}>{draftPhoto?t("sched.changePhoto"):t("sched.attachPhoto")}<input type="file" accept="image/*" style={{display:"none"}} onChange={pickDraftPhoto}/></label>
                    {draftPhoto&&<button className="yl-linkbtn" onClick={()=>setDraftPhoto(null)}>{t("a11y.delete")}</button>}
                  </div>
                </label>
              </div>
            )}
            <div className="yl-notify"><span className="yl-notify-label"><Icon name="bell" size={14}/> {t("sched.notify")}{notifPerm==="default"&&<button className="yl-notif-small" onClick={handleNotifRequest}>{t("notif.allowShort")}</button>}</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(draftReminders.includes(o.key)?" on":"")} onClick={()=>toggleReminder(o.key)}>{o.label}</button>)}</div>{draftReminders.length>=4&&<p className="yl-notify-hint">{t("life.notifyHint")}</p>}</div>
            {isMemberTab&&<div className="yl-quickbar" style={{marginTop:12}}><p className="yl-quickbar-label">{t("sched.quickAdd")}</p><div className="yl-quickbar-grid">{careKindsFor(activeMember).map(k=>{const prev=lastDates[k.key];return(<button key={k.key} className="yl-quickbar-item" onClick={()=>{openQuickAdd(k.key,k.emoji,careLabel(k),activeMember.id,prev?.dueDate,prev?.repeat);setInputSheet(null);}}><span className="yl-quickbar-ico"><Icon name={careIcon(k.key)} size={20}/></span><span className="yl-quickbar-info"><span className="yl-quickbar-name">{careLabel(k)}</span><span className="yl-quickbar-prev">{prev?t("sched.lastDate",{date:fmtDate(prev.dueDate)}):"─"}</span></span><span className="yl-quickbar-plus">＋</span></button>);})}</div></div>}
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>{t("common.close")}</button></div>
          </div>
        </div>
      )}
      {inputSheet==="health"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{t("health.addTitle")}</h3>
            <div className="yl-health-input">
              <label className="yl-opt">{t("chart.weight")}<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={healthW} onChange={e=>setHealthW(e.target.value)} placeholder={weightUnit==="g"?"25.3":"0.0"}/>{isMemberTab?<span className="yl-health-uswitch"><button className={"yl-health-ubtn"+(weightUnit==="kg"?" on":"")} onClick={()=>setMemberWeightUnit("kg")}>kg</button><button className={"yl-health-ubtn"+(weightUnit==="g"?" on":"")} onClick={()=>setMemberWeightUnit("g")}>g</button></span>:<span className="yl-health-unit">kg</span>}</span></label>
              {isMemberTab&&<label className="yl-opt">{t("chart.height")}<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={healthH} onChange={e=>setHealthH(e.target.value)} placeholder="0.0"/><span className="yl-health-unit">cm</span></span></label>}
            </div>
            {isMemberTab&&activeMember&&activeMember.personType==="senior"&&(
              <div className="yl-vital-input">
                <label className="yl-opt">{t("health.bp")}<span className="yl-health-field yl-bp-field"><input type="number" inputMode="numeric" className="yl-health-num" value={healthBpS} onChange={e=>setHealthBpS(e.target.value)} placeholder={t("health.bpHigh")}/><span className="yl-bp-sep">/</span><input type="number" inputMode="numeric" className="yl-health-num" value={healthBpD} onChange={e=>setHealthBpD(e.target.value)} placeholder={t("health.bpLow")}/><span className="yl-health-unit">mmHg</span></span></label>
                <label className="yl-opt">{t("health.temp")}<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={healthTemp} onChange={e=>setHealthTemp(e.target.value)} placeholder="36.5"/><span className="yl-health-unit">℃</span></span></label>
                <label className="yl-opt">{t("health.glucose")}<span className="yl-health-field"><input type="number" inputMode="numeric" className="yl-health-num" value={healthGlucose} onChange={e=>setHealthGlucose(e.target.value)} placeholder={t("health.optionalPh")}/><span className="yl-health-unit">mg/dL</span></span></label>
              </div>
            )}
            {isMemberTab&&weightUnit==="g"&&<p className="yl-health-hint">{t("health.smallAnimalHint")}</p>}
            {isMemberTab&&(<div className="yl-health-conds"><span className="yl-health-clabel">{t("health.condLabel")}</span>{HEALTH_CONDS.map(c=><button key={c.key} className={"yl-health-cond"+(healthCond===c.key?" on":"")} onClick={()=>setHealthCond(healthCond===c.key?"":c.key)}>{c.emoji} {lblOf(c)}</button>)}</div>)}
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:6}} onClick={saveHealth}><Icon name="scale" size={16}/> {t("health.saveBtn")}</button>
            {isMemberTab&&<label className="yl-opt" style={{flexDirection:"row",alignItems:"center",gap:8,marginTop:14}}><Icon name="target" size={14}/> {t("health.targetWeight")}<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={targetWeight} onChange={e=>setMemberTarget(e.target.value)} placeholder={weightUnit==="g"?"25.3":"0.0"}/><span className="yl-health-unit">{weightUnit}</span></span></label>}
            {isMemberTab&&<p className="yl-health-hint" style={{marginTop:4}}>{t("health.targetHint")}</p>}
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>{t("common.close")}</button></div>
          </div>
        </div>
      )}
      {inputSheet==="toilet"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="droplet" size={18}/> {t("hub.toilet")}</h3>
            <p className="yl-diary-hint">{t("toilet.hint")}</p>
            <div className="yl-toilet-row">
              <span className="yl-toilet-label"><Icon name="droplet" size={15}/> {t("toilet.pee")}</span>
              <button className="yl-toilet-btn ok" onClick={()=>logToilet("pee",true)}>{t("toilet.success")}</button>
              <button className="yl-toilet-btn ng" onClick={()=>logToilet("pee",false)}>{t("toilet.fail")}</button>
            </div>
            <div className="yl-toilet-row">
              <span className="yl-toilet-label"><Icon name="droplet" size={15}/> {t("diary.poop")}</span>
              <button className="yl-toilet-btn ok" onClick={()=>logToilet("poop",true,bristolScore)}>{t("toilet.success")}</button>
              <button className="yl-toilet-btn ng" onClick={()=>logToilet("poop",false)}>{t("toilet.fail")}</button>
            </div>
            <div className="yl-bristol">
              <span className="yl-toilet-condlabel">{t("toilet.hardness")}</span>
              <p className="yl-bristol-note">{t("toilet.bristolNote")}</p>
              <button className="yl-poop-alert" onClick={()=>{setInputSheet(null);setToxicSp("all");setToxicQ("");setToxicOpen(true);}}>
                <span className="yl-poop-alert-body"><Icon name="alert" size={14}/> {t("toilet.alertBody")}</span>
                <span className="yl-poop-alert-link">{t("toilet.alertLink")}<Icon name="chevron" size={14}/></span>
              </button>
              <ul className="yl-poop-scale">{BRISTOL.map(bb=>(
                <li key={bb.n}><button className={"yl-poop-card tone-"+bb.tone+(bristolScore===bb.n?" on":"")} onClick={()=>setBristolScore(bb.n)}>
                  <span className={"yl-poop-num tone-"+bb.tone}>{bb.n}</span>
                  <span className="yl-poop-illust"><PoopShape n={bb.n} size={34}/></span>
                  <span className="yl-poop-text"><span className="yl-poop-label">{bb.label}{bb.n===4?t("toilet.ideal"):""}</span><span className="yl-poop-desc">{bb.desc}</span></span>
                  {bristolScore===bb.n&&<span className="yl-poop-check"><Icon name="check" size={15}/></span>}
                </button></li>
              ))}</ul>
            </div>
            {poopTrend&&<p className={"yl-bristol-warn tone-"+poopTrend.tone}><Icon name="alert" size={13}/> {poopTrend.txt}</p>}
            <p className="yl-health-hint" style={{marginTop:10}}>{t("toilet.disclaimer")}</p>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>{t("common.close")}</button></div>
          </div>
        </div>
      )}
      {vetOpen&&activeMember&&vetSummary&&(()=>{
        const meds=medCourses.filter(m=>(m.taken||[]).length<m.days);
        const foods=foodDefs;
        const wChange=vetSummary.wLatest&&vetSummary.wFirst&&vetSummary.wFirst!==vetSummary.wLatest?Math.round((vetSummary.wLatest.weight-vetSummary.wFirst.weight)*10)/10:null;
        return(
        <div className="yl-overlay" onClick={()=>setVetOpen(false)}>
          <div className="yl-modal vetmodal" onClick={e=>e.stopPropagation()}>
            <div className="yl-noprint yl-vet-toolbar"><span className="yl-vet-range">{[7,30,90].map(d=><button key={d} className={"yl-toilet-range"+(vetDays===d?" on":"")} onClick={()=>setVetDays(d)}>{d}日</button>)}</span></div>
            <div className="yl-vetsum">
              <div className="yl-vetsum-head">
                <h2 className="yl-vetsum-title"><Icon name="paw" size={18}/> {activeMember.name} の記録サマリー</h2>
                <p className="yl-vetsum-period">{fmtDate(vetSummary.from)}〜{fmtDate(vetSummary.to)}（{vetDays}日間）／作成日 {fmtDate(todayIso)}</p>
              </div>
              <div className="yl-vetsum-grid">
                <div className="yl-vetsum-sec"><h3>基本情報</h3><ul>
                  <li><b>種別</b>：{activeMember.species==="cat"?"猫":activeMember.species==="other"?"その他":"犬"}</li>
                  {activeMember.birthday&&<li><b>誕生日</b>：{fmtBirthday(activeMember.birthday)}{ageLabel(activeMember.birthday)?`（${ageLabel(activeMember.birthday)}）`:""}</li>}
                  {activeMember.microchip&&<li><b>マイクロチップ</b>：{activeMember.microchip}</li>}
                </ul></div>
                <div className="yl-vetsum-sec wide"><h3>体重</h3>
                  {vetSummary.wSeries.length>=2&&<div className="yl-vetsum-chart"><MiniChart points={vetSummary.wSeries} unit={vetSummary.wUnit} color="#E39A5C" label="体重の推移"/></div>}
                  {vetSummary.wLatest?<ul>
                    <li><b>直近</b>：{vetSummary.wLatest.weight}{vetSummary.wUnit}（{fmtDate(vetSummary.wLatest.date)}）</li>
                    {wChange!=null&&<li><b>期間の増減</b>：{(wChange>=0?"+":"")}{wChange}{vetSummary.wUnit}（{fmtDate(vetSummary.wFirst.date)}比）</li>}
                  </ul>:<p className="yl-vetsum-none">記録なし（毎日の記録に体重を入れると推移が出ます）</p>}
                </div>
                <div className="yl-vetsum-sec"><h3>トイレ</h3><ul>
                  <li>おしっこ成功率：{vetSummary.pee.total?`${vetSummary.pee.rate}%（${vetSummary.pee.total}回）`:"記録なし"}</li>
                  <li>うんち成功率：{vetSummary.poop.total?`${vetSummary.poop.rate}%（${vetSummary.poop.total}回）`:"記録なし"}</li>
                  {vetSummary.brAvg!=null&&<li>うんちの硬さ平均：{vetSummary.brAvg}／7{bristolMeta(Math.round(vetSummary.brAvg))?`（${bristolMeta(Math.round(vetSummary.brAvg)).label}）`:""}</li>}
                </ul></div>
                <div className="yl-vetsum-sec"><h3>症状・体調</h3>{(vetSummary.energyAvg!=null||vetSummary.symList.length)?<ul>
                  {vetSummary.energyAvg!=null&&<li>元気の平均：{vetSummary.energyAvg}／5（{vetSummary.energyN}回）</li>}
                  {vetSummary.symList.map(s=><li key={s.k}>{s.label} × {s.n}回</li>)}
                </ul>:<p className="yl-vetsum-none">記録なし</p>}</div>
                <div className="yl-vetsum-sec"><h3>お薬・サプリ</h3>{meds.length?<ul>{meds.map(m=><li key={m.id}>💊 {m.name}：のこり{Math.max(0,m.days-(m.taken||[]).length)}日分</li>)}</ul>:<p className="yl-vetsum-none">なし</p>}</div>
                <div className={"yl-vetsum-sec"+(vetSummary.careNext.length?" highlight":"")}><h3><Icon name="syringe" size={13}/> 予防・ワクチン等の次回予定</h3>{vetSummary.careNext.length?<ul>{vetSummary.careNext.map((c,i)=><li key={i}>{c.emoji} {c.title}：{fmtDate(c.date)}</li>)}</ul>:<p className="yl-vetsum-none">予定なし</p>}</div>
                <div className="yl-vetsum-sec"><h3>最近のお世話</h3>{vetSummary.chores.length?<ul>{vetSummary.chores.map((c,i)=><li key={i}>{c.emoji} {c.title}：{fmtDate(c.date)}</li>)}</ul>:<p className="yl-vetsum-none">記録なし</p>}</div>
                {foods.length>0&&<div className="yl-vetsum-sec"><h3>フード・食事</h3><ul>{foods.map(d=><li key={d.id}>🍚 {d.name}{foodDefShareText(d)?`：${foodDefShareText(d)}`:""}</li>)}</ul></div>}
              </div>
              <p className="yl-vetsum-note">※本サマリーは飼い主の記録に基づくもので、診断ではありません。</p>
            </div>
            <div className="yl-modal-btns yl-noprint" style={{flexWrap:"wrap"}}>
              <button className="yl-modal-cancel" onClick={()=>setVetOpen(false)}>とじる</button>
              <button className="yl-addbtn modal" disabled={imgSaving} onClick={()=>saveSheetImage(".yl-vetsum",`${safeName(activeMember.name)}-記録サマリー-${todayIso}.png`,{sheet:true})}><Icon name="download" size={16}/> 画像で保存</button>
              <button className="yl-addbtn modal ghost" onClick={()=>window.print()}><Icon name="printer" size={16}/> 印刷</button>
            </div>
          </div>
        </div>
        );})()}
      {handoverOpen&&activeMember&&(()=>{
        const isPet=curKind==="pet";
        const foods=foodDefs;
        const meds=medCourses.filter(m=>(m.taken||[]).length<m.days);
        const allergy=cards.filter(c=>c.kind==="allergy");
        const hospitals=cards.filter(c=>c.kind==="hospital");
        const otherContacts=cards.filter(c=>c.kind==="emergency"||c.kind==="insurance");
        const contactLi=(c)=>{const ph=isPhoneLike(c.body);const hmeta=c.kind==="hospital"&&[c.hours&&`🕐 ${c.hours}`,c.addr&&`📍 ${c.addr}`].filter(Boolean).join("　");return(<li key={c.id} className={ph?"yl-vetsum-contactline":undefined}>{cardMeta(c.kind).emoji} <b>{c.title}</b>{c.night?<span className="yl-emg-tag" style={{marginLeft:6}}>夜間</span>:null}{ph?<a className="yl-vetsum-tel" href={`tel:${(c.body||"").replace(/[^0-9]/g,"")}`}>📞 {fmtJPPhone(c.body)}</a>:(c.body?`：${c.body}`:"")}{hmeta&&<span className="yl-vetsum-cmeta">{hmeta}</span>}</li>);};
        const notesCards=cards.filter(c=>c.kind==="other");
        const wl=items.filter(x=>x.space===tab&&x.type==="health"&&x.weight!=null).sort((a,b)=>(a.date||"").localeCompare(b.date||"")).pop();
        const bd=activeMember.birthday;
        // 子ども向け：今日のお世話ログ・今日のようす・家族への伝達を1枚に
        const todayChores=chores.filter(c=>c.lastDone===todayIso);
        const todayDiary=diaryRecords.filter(r=>r.date===todayIso);
        const diarySum=(r)=>[r.energy&&diaryMeta(DIARY_ENERGY,r.energy)&&diaryMeta(DIARY_ENERGY,r.energy).label,r.appetite&&diaryMeta(DIARY_APPETITE,r.appetite)&&`食欲：${lblOf(diaryMeta(DIARY_APPETITE,r.appetite))}`,r.poop&&diaryMeta(DIARY_POOP,r.poop)&&`排便：${lblOf(diaryMeta(DIARY_POOP,r.poop))}`,r.sleep&&`睡眠${r.sleep}h`,(r.symptoms||[]).map(sk=>symptomMeta(sk)&&symptomMeta(sk).label).filter(Boolean).join("・"),r.note].filter(Boolean).join(" / ");
        const notes=familyNotes.slice(0,5);
        return(
        <div className="yl-overlay" onClick={()=>setHandoverOpen(false)}>
          <div className="yl-modal vetmodal" onClick={e=>e.stopPropagation()}>
            <div className="yl-vetsum">
              <div className="yl-vetsum-head">
                <h2 className="yl-vetsum-title"><Icon name="note" size={18}/> {activeMember.name} の{isPet?"お世話シート":"引き継ぎシート"}</h2>
                <p className="yl-vetsum-period">{isPet?"お預け・お留守番の引き継ぎ用":"お預け・共有用（今日のようす）"}／作成日 {fmtDate(todayIso)}</p>
              </div>
              <div className="yl-vetsum-grid">
                <div className="yl-vetsum-sec"><h3>{isPet?"この子について":"プロフィール"}</h3><ul>
                  {isPet
                    ?<li><b>名前</b>：{activeMember.name}（{activeMember.species==="cat"?"猫":activeMember.species==="other"?"その他":"犬"}{activeMember.breed?`・${activeMember.breed}`:""}）</li>
                    :<li><b>名前</b>：{activeMember.name}{activeMember.nickname?`（${activeMember.nickname}）`:""}{activeMember.gender?`・${activeMember.gender}`:""}</li>}
                  {bd&&<li><b>誕生日</b>：{fmtBirthday(bd)}{ageLabel(bd)?`（${ageLabel(bd)}）`:""}</li>}
                  {wl&&<li><b>体重</b>：{wl.weight}{wl.wunit||"kg"}（{fmtDate(wl.date)}）</li>}
                  {activeMember.microchip&&<li><b>マイクロチップ</b>：{activeMember.microchip}</li>}
                </ul></div>
                {(isPet||foods.length>0)&&<div className="yl-vetsum-sec"><h3>ごはん</h3>{foods.length?<ul>{foods.map(d=><li key={d.id}>🍚 {d.name}{foodDefShareText(d)?`：${foodDefShareText(d)}`:""}{d.feedTime?`（${d.feedTime}）`:""}</li>)}</ul>:<p className="yl-vetsum-none">登録なし（口頭で共有してください）</p>}</div>}
                {!isPet&&<div className="yl-vetsum-sec"><h3>今日のお世話</h3>{todayChores.length?<ul>{todayChores.map(c=><li key={c.id}>{c.emoji||"✓"} {c.title}</li>)}</ul>:<p className="yl-vetsum-none">まだ記録がありません</p>}</div>}
                {!isPet&&<div className="yl-vetsum-sec"><h3>今日のようす（体調）</h3>{todayDiary.length?<ul>{todayDiary.map(r=><li key={r.id}>{diarySum(r)||"記録あり"}</li>)}</ul>:<p className="yl-vetsum-none">まだ記録がありません</p>}</div>}
                <div className="yl-vetsum-sec"><h3>お薬・サプリ</h3>{meds.length?<ul>{meds.map(m=><li key={m.id}>💊 {m.name}：のこり{Math.max(0,m.days-(m.taken||[]).length)}日分</li>)}</ul>:<p className="yl-vetsum-none">なし</p>}</div>
                <div className={"yl-vetsum-sec"+(allergy.length?" warn":"")}><h3>気をつけること（アレルギー・注意）</h3>{allergy.length?<ul>{allergy.map(c=><li key={c.id}><b>{c.title}</b>{c.body?`：${c.body}`:""}</li>)}</ul>:<p className="yl-vetsum-none">特になし</p>}</div>
                <div className="yl-vetsum-sec wide contact"><h3><Icon name="stethoscope" size={13}/> {isPet?"かかりつけ動物病院":"かかりつけ病院"}</h3>{hospitals.length?<ul>{hospitals.map(contactLi)}</ul>:<p className="yl-vetsum-none">未登録（「大切な情報」に病院名・電話・住所を登録できます）</p>}</div>
                <div className="yl-vetsum-sec wide contact"><h3><Icon name="phone" size={13}/> 緊急連絡先</h3>{otherContacts.length?<ul>{otherContacts.map(contactLi)}</ul>:<p className="yl-vetsum-none">未登録（「大切な情報」に登録できます）</p>}</div>
                {!isPet&&notes.length>0&&<div className="yl-vetsum-sec"><h3>家族からの伝達</h3><ul>{notes.map(n=><li key={n.id}>{n.text}{n.author?`（${n.author}）`:""}</li>)}</ul></div>}
                {notesCards.length>0&&<div className="yl-vetsum-sec wide memo"><h3>その他メモ</h3><ul>{notesCards.map(c=><li key={c.id}><b>{c.title}</b>{c.body?`：${c.body}`:""}</li>)}</ul></div>}
              </div>
              <p className="yl-vetsum-note">※{isPet?"飼い主":"ご家族"}の記録に基づく引き継ぎメモです。詳しいことはご家族にご確認ください。</p>
            </div>
            <div className="yl-modal-btns yl-noprint" style={{flexWrap:"wrap"}}>
              <button className="yl-modal-cancel" onClick={()=>setHandoverOpen(false)}>とじる</button>
              <button className="yl-addbtn modal" disabled={imgSaving} onClick={()=>saveSheetImage(".yl-vetsum",`${safeName(activeMember.name)}-${isPet?"お世話シート":"引き継ぎシート"}-${todayIso}.png`,{sheet:true})}><Icon name="download" size={16}/> 画像で保存</button>
              <button className="yl-addbtn modal ghost" onClick={()=>window.print()}><Icon name="printer" size={16}/> 印刷</button>
            </div>
          </div>
        </div>
      );})()}
      {emergencyCardOpen&&(activeMember||tab==="me")&&(()=>{
        const M=activeMember||{name:meName||t("ecard.meFallback"),nickname:"",birthday:meBirthday,avatar:meAvatar,emoji:meEmoji||"🙂"};
        const av=M.avatar&&photos[M.avatar];
        const bd=M.birthday;
        const allergy=cards.filter(c=>c.kind==="allergy");
        const notes=cards.filter(c=>c.kind==="other");
        const meds=medCourses.filter(m=>(m.taken||[]).length<m.days);
        const emerg=cards.filter(c=>c.kind==="emergency");
        const hosp=cards.filter(c=>c.kind==="hospital");
        const insur=cards.filter(c=>c.kind==="insurance");
        const contacts=[...emerg,...hosp,...insur];
        return(
        <div className="yl-overlay" onClick={()=>setEmergencyCardOpen(false)}>
          <div className="yl-modal vetmodal" onClick={e=>e.stopPropagation()}>
            <div className="yl-lost">
              <p className="yl-lost-head">{t("safety.emergencyCard")}</p>
              <div className="yl-lost-photo">{av?<img src={av} alt=""/>:<span className="yl-lost-emoji">{M.emoji||"👤"}</span>}</div>
              {activeMember&&(()=>{const pp=(activeMember.posterPhotos||[]).filter(pid=>photos[pid]);return pp.length>0&&<div className="yl-lost-photos">{pp.map(pid=><span key={pid} className="yl-lost-photo2"><img src={photos[pid]} alt=""/><button className="yl-lost-photodel yl-noprint" onClick={()=>removePosterPhoto(activeMember.id,pid)} aria-label={t("a11y.delete")}>×</button></span>)}</div>;})()}
              {activeMember&&<label className="yl-lost-addphoto yl-noprint"><Icon name="camera" size={14}/> {t("common.addPhotoMax4")}<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>addPosterPhoto(activeMember.id,e)}/></label>}
              <p className="yl-lost-name">{M.name}{M.nickname?`（${M.nickname}）`:""}</p>
              {bd&&<p className="yl-lost-feats">{fmtBirthday(bd)}{ageLabel(bd)?`（${ageLabel(bd)}）`:""}</p>}
              <div className="yl-lost-info">
                {allergy.length>0&&<p><b>{t("ecard.allergy")}</b> {allergy.map(c=>c.title+(c.body?`（${c.body}）`:"")).join("、")}</p>}
                {meds.length>0&&<p><b>{t("ecard.meds")}</b> {meds.map(m=>m.name).join("、")}</p>}
                {notes.map(c=><p key={c.id}><b>{c.title}</b> {c.body}</p>)}
              </div>
              <div className="yl-lost-contact">
                <p className="yl-lost-clabel">{t("ecard.contacts")}</p>
                {contacts.length?contacts.map(c=><p key={c.id} className="yl-lost-cnum">{c.title}：{c.body}</p>):<p className="yl-lost-cnum yl-noprint" style={{color:"var(--placeholder)"}}>{t("ecard.contactsEmpty")}</p>}
              </div>
              <button className="yl-lost-editlink yl-noprint" onClick={()=>{setEmergencyCardOpen(false);const tg=activeMember?activeMember.id:"me";setTab(tg);setMemberSel(tg);setPersonSeg("manage");setTrayOpen(true);}}><Icon name="plus" size={13}/> {t("ecard.addInfo")}</button>
              <p className="yl-lost-note">{t("ecard.note")}</p>
            </div>
            <div className="yl-modal-btns yl-noprint" style={{flexWrap:"wrap"}}>
              <button className="yl-modal-cancel" onClick={()=>setEmergencyCardOpen(false)}>{t("common.close")}</button>
              <button className="yl-addbtn modal" disabled={imgSaving} onClick={()=>saveSheetImage(".yl-lost",`${safeName(M.name)}-${t("ecard.fileSuffix")}.png`)}><Icon name="download" size={16}/> {t("common.saveImage")}</button>
              <button className="yl-addbtn modal ghost" onClick={()=>window.print()}><Icon name="printer" size={16}/> {t("common.print")}</button>
            </div>
          </div>
        </div>
        );})()}
      {lostOpen&&activeMember&&(()=>{
        const m=activeMember;const li=m.lostInfo||{};
        const av=m.avatar&&photos[m.avatar];
        const isDog=m.species==="dog";
        const wl=items.filter(x=>x.space===tab&&x.type==="health"&&x.weight!=null).sort((a,b)=>(a.date||"").localeCompare(b.date||"")).pop();
        // 特徴を「アイコン＋見出し＋内容」の縦リストに整理（値のあるものだけ）
        const featRows=[
          {ic:"paw",label:t("lost.featType"),value:[isDog?"犬":m.species==="cat"?"猫":"",m.breed].filter(Boolean).join("・")},
          {ic:"palette",label:t("lost.featCoat"),value:m.coat},
          {ic:"heart",label:t("lost.featGender"),value:m.gender},
          {ic:"cake",label:t("lost.featAge"),value:m.birthday&&ageLabel(m.birthday)},
          {ic:"scale",label:t("lost.featWeight"),value:wl&&`${wl.weight}${wl.wunit||"kg"}`},
          {ic:"tag",label:t("lost.featCollar"),value:li.collar},
        ].filter(r=>r.value);
        // メイン写真＋追加写真をまとめて横並びギャラリーに（実写を大きく見せる）
        const gallery=[];if(av)gallery.push({pid:m.avatar,src:av,poster:false});(m.posterPhotos||[]).forEach(pid=>{if(photos[pid])gallery.push({pid,src:photos[pid],poster:true});});
        const contacts=cards.filter(c=>c.kind==="emergency"||c.kind==="hospital");
        const notes=cards.filter(c=>c.kind==="other");
        const found=!!li.found;
        const stamp=(()=>{const n=new Date();return`${n.getFullYear()}/${n.getMonth()+1}/${n.getDate()} ${n.getHours()}:${String(n.getMinutes()).padStart(2,"0")}`;})();
        const posterHost=(()=>{try{return location.host||"";}catch(e){return"";}})();
        return(
        <div className="yl-overlay" onClick={()=>setLostOpen(false)}>
          <div className="yl-modal vetmodal yl-lostflow" onClick={e=>e.stopPropagation()}>
            <div className="yl-lostflow-steps yl-noprint">
              {[t("lost.step0"),t("lost.step1"),t("lost.step2")].map((lab,i)=><span key={i} className={"yl-lostflow-step"+(lostStep===i?" on":"")+(lostStep>i?" done":"")}>{t("lost.stepFmt",{n:i+1,lab})}</span>)}
            </div>
            {lostStep===0&&<div className="yl-lostflow-body yl-noprint">
              <p className="yl-lostflow-lead"><b>{t("lost.step0LeadBold")}</b>{t("lost.step0LeadRest")}</p>
              <label className="yl-opt">{t("lost.placeLabel")}<span className="yl-opt-hint">{t("lost.placeHint")}</span><input className="yl-input sm" autoFocus value={li.place||""} onChange={e=>setLostField(m.id,{place:e.target.value})} placeholder={t("lost.placePh")}/></label>
              <label className="yl-opt">{t("lost.placeNoteLabel")}<input className="yl-input sm" value={li.placeNote||""} onChange={e=>setLostField(m.id,{placeNote:e.target.value})} placeholder={t("lost.placeNotePh")}/></label>
              <label className="yl-opt">{t("lost.whenLabel")}<input className="yl-input sm" value={li.when||""} onChange={e=>setLostField(m.id,{when:e.target.value})} placeholder={t("lost.whenPh")}/></label>
            </div>}
            {lostStep===1&&<div className="yl-lostflow-body yl-noprint">
              <p className="yl-lostflow-lead">{t("lost.step1Lead")}</p>
              <div className="yl-lostflow-idcard">
                {gallery.length>0
                  ? <div className={"yl-lost-gallery n"+Math.min(gallery.length,4)}>{gallery.map(g=><span key={g.pid} className="yl-lost-gphoto"><img src={g.src} alt=""/>{g.poster&&<button className="yl-lost-photodel" onClick={()=>removePosterPhoto(m.id,g.pid)} aria-label="削除">×</button>}</span>)}</div>
                  : <div className="yl-lost-photo"><span className="yl-lost-emoji">{m.emoji||"🐶"}</span></div>}
                <label className="yl-lost-addphoto"><Icon name="camera" size={14}/> {t("common.addPhotoMax4")}<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>addPosterPhoto(m.id,e)}/></label>
                <p className="yl-lost-name">{m.name}{m.nickname?`（${m.nickname}）`:""}</p>
                {featRows.length>0&&<ul className="yl-lost-featlist">{featRows.map((f,i)=><li key={i} className="yl-lost-featitem"><span className="yl-lost-featic"><Icon name={f.ic} size={16}/></span><span className="yl-lost-featlabel">{f.label}</span><span className="yl-lost-featval">{f.value}</span></li>)}</ul>}
              </div>
              <label className="yl-opt">{t("lost.collarLabel")}<input className="yl-input sm" value={li.collar||""} onChange={e=>setLostField(m.id,{collar:e.target.value})} placeholder={t("lost.collarPh")}/></label>
              <label className="yl-opt">{t("lost.situationLabel")}<input className="yl-input sm" value={li.situation||""} onChange={e=>setLostField(m.id,{situation:e.target.value})} placeholder={t("lost.situationPh")}/></label>
              <div className="yl-opt">{t("lost.temperLabel")}<span className="yl-seg-mini">{TEMPER_OPTS.map(o=><button key={o.k} className={"yl-seg-mini-btn"+((li.temper||"")===o.k?" on":"")} onClick={()=>setLostField(m.id,{temper:o.k,pleaKey:o.k||"normal"})}>{t("temper."+(o.k||"unset"))}</button>)}</span></div>
              <label className="yl-opt">{t("lost.noteLabel")}<input className="yl-input sm" value={li.note||""} onChange={e=>setLostField(m.id,{note:e.target.value})} placeholder={t("lost.notePh")}/></label>
              {contacts.length===0&&<button className="yl-lost-editlink" onClick={()=>{setLostOpen(false);setTab(m.id);setMemberSel(m.id);setPersonSeg("manage");setTrayOpen(true);}}><Icon name="plus" size={13}/> {t("lost.registerContact")}</button>}
            </div>}
            {lostStep===2&&<>
            <div className={"yl-lost yl-lost-poster"+(found?" found":"")}>
              {found&&<p className="yl-lost-found"><Icon name="check" size={16}/> {t("lost.found")}</p>}
              <p className="yl-lost-head">{isDog?t("lost.headDog"):t("lost.headOther")}</p>
              {gallery.length>0
                ? <div className={"yl-lost-gallery n"+Math.min(gallery.length,4)}>{gallery.map(g=><span key={g.pid} className="yl-lost-gphoto"><img src={g.src} alt=""/>{g.poster&&<button className="yl-lost-photodel yl-noprint" onClick={()=>removePosterPhoto(m.id,g.pid)} aria-label={t("a11y.delete")}>×</button>}</span>)}</div>
                : <div className="yl-lost-photo"><span className="yl-lost-emoji">{m.emoji||"🐶"}</span></div>}
              <label className="yl-lost-addphoto yl-noprint"><Icon name="camera" size={14}/> {t("common.addPhotoMax4")}<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>addPosterPhoto(m.id,e)}/></label>
              <p className="yl-lost-name">{m.name}{m.nickname?`（${m.nickname}）`:""}</p>
              {featRows.length>0&&<ul className="yl-lost-featlist">{featRows.map((f,i)=><li key={i} className="yl-lost-featitem"><span className="yl-lost-featic"><Icon name={f.ic} size={16}/></span><span className="yl-lost-featlabel">{f.label}</span><span className="yl-lost-featval">{f.value}</span></li>)}</ul>}
              {(li.place||li.when)&&<div className="yl-lost-sighting">
                {li.place&&<div className="yl-lost-place">
                  <span className="yl-lost-place-label"><Icon name="pin" size={14}/> {t("lost.sightPlace")}</span>
                  <span className="yl-lost-place-main">{li.place}</span>
                  {li.placeNote&&<span className="yl-lost-place-note">{li.placeNote}</span>}
                </div>}
                {li.when&&<div className="yl-lost-place yl-lost-when">
                  <span className="yl-lost-place-label"><Icon name="clock" size={14}/> {t("lost.sightWhen")}</span>
                  <span className="yl-lost-place-main">{li.when}</span>
                </div>}
              </div>}
              {(li.situation||notes.length>0||li.note)&&<div className="yl-lost-info">
                {li.situation&&<p><b>{t("lost.situationTitle")}</b> {li.situation}</p>}
                {notes.map(c=><p key={c.id}><b>{c.title}</b> {c.body}</p>)}
                {li.note&&<p>{li.note}</p>}
              </div>}
              <div className="yl-lost-plea"><span className="yl-lost-plea-mark" aria-hidden="true">⚠️</span><span className="yl-lost-plea-txt">{pleaTextOf(m)}</span></div>
              <div className="yl-lost-contact">
                <p className="yl-lost-clabel">{t("lost.contactPlea")}</p>
                {contacts.length?contacts.map(c=>isPhoneLike(c.body)
                  ? <a key={c.id} className="yl-lost-telbtn" href={`tel:${(c.body||"").replace(/[^0-9]/g,"")}`}>{c.title&&<span className="yl-lost-tellabel">{c.title}</span>}<span className="yl-lost-telrow"><span className="yl-lost-telic" aria-hidden="true">📞</span><span className="yl-lost-telnum">{fmtJPPhone(c.body)}</span></span></a>
                  : <p key={c.id} className="yl-lost-cnum">{c.title}：{c.body}</p>
                ):<p className="yl-lost-cnum yl-noprint" style={{color:"var(--placeholder)"}}>{t("lost.contactEmpty")}</p>}
                {contacts.some(c=>isPhoneLike(c.body))&&<p className="yl-lost-action">{t("lost.action")}</p>}
              </div>
              <p className="yl-lost-foot"><span className="yl-lost-foot-note">{t("lost.footNote")}</span>{(posterHost||stamp)&&<span className="yl-lost-foot-meta">{posterHost}{posterHost&&" ・ "}{stamp}</span>}</p>
            </div>
            <div className="yl-lostflow-after yl-noprint">
              <p className="yl-lostflow-afterttl">{t("lost.afterTitle")}</p>
              <label className="yl-lost-foundtoggle"><input type="checkbox" checked={found} onChange={e=>setLostField(m.id,{found:e.target.checked})}/> {t("lost.foundToggle")}</label>
              <p className="yl-lost-privacy"><Icon name="shield" size={12}/> {t("lost.privacy")}</p>
            </div>
            </>}
            <div className="yl-modal-btns yl-noprint" style={{flexWrap:"wrap"}}>
              {lostStep===0&&<><button className="yl-modal-cancel" onClick={()=>setLostOpen(false)}>{t("common.close")}</button><button className="yl-addbtn modal" onClick={()=>setLostStep(1)}>{t("lost.nextPet")}</button></>}
              {lostStep===1&&<><button className="yl-modal-cancel" onClick={()=>setLostStep(0)}>{t("lost.back")}</button><button className="yl-addbtn modal" onClick={()=>setLostStep(2)}>{t("lost.makePoster")}</button></>}
              {lostStep===2&&<><button className="yl-modal-cancel" onClick={()=>setLostStep(1)}>{t("lost.back")}</button><button className="yl-addbtn modal" disabled={imgSaving} onClick={()=>saveSheetImage(".yl-lost-poster",`${t("lost.fileSuffix")}-${safeName(m.name)}.png`,{story:true})}><Icon name="download" size={16}/> {t("common.saveImage")}</button><button className="yl-addbtn modal ghost" onClick={()=>shareLost(m)}><Icon name="link" size={16}/> {t("lost.share")}</button><button className="yl-addbtn modal ghost" onClick={()=>window.print()}><Icon name="printer" size={16}/> {t("common.print")}</button></>}
            </div>
          </div>
        </div>
      );})()}
      {inputSheet==="feed"&&(()=>{
        const baseNow=feedServing.trim()!==""&&Number(feedServing)>0?Number(feedServing):servingG;
        const previewG=feedUnit==="serving"&&baseNow?Math.round(feedMult*baseNow):null;
        return(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{t("feed.addTitle")}</h3>
            <div className="yl-feed-units">{feedUnitsOrdered.map(u=><button key={u.k} className={"yl-feed-unit"+(feedUnit===u.k?" on":"")} onClick={()=>setFeedUnit(u.k)}>{u.l}</button>)}</div>
            {feedUnit==="serving"?(<>
              <label className="yl-opt" style={{marginTop:12}}>{t("feed.servingLabel")}<span className="yl-health-field"><input type="number" inputMode="numeric" className="yl-health-num" value={feedServing} onChange={e=>setFeedServing(e.target.value)} placeholder={t("feed.servingPh")}/><span className="yl-health-unit">g</span></span></label>
              <p className="yl-health-hint" style={{marginTop:4}}>{baseNow?t("feed.hintSet",{g:baseNow}):t("feed.hintUnset")}</p>
              <p className="yl-feed-mlabel">{t("feed.amount")}</p>
              <div className="yl-feed-mults">{[0.5,1,1.5,2].map(m=><button key={m} className={"yl-feed-mult"+(feedMult===m?" on":"")} onClick={()=>setFeedMult(m)}>×{m}</button>)}</div>
              {previewG!=null&&<p className="yl-feed-preview">{t("feed.previewPre")}<b>{previewG}g</b>{t("feed.previewPost",{n:feedMult})}</p>}
            </>):(
              <label className="yl-opt" style={{marginTop:12}}>{t("feed.amount")}<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={feedAmt} onChange={e=>setFeedAmt(e.target.value)} placeholder="0" autoFocus/><span className="yl-health-unit">{feedUnitLabel(feedUnit)}</span></span></label>
            )}
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:14}} onClick={saveFeed}><Icon name="utensils" size={16}/> {t("feed.saveBtn")}</button>
            {feedTodayG>0&&<p className="yl-feed-today">{t("feed.today",{g:feedTodayG,n:feedToday.length})}</p>}
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>{t("common.close")}</button></div>
          </div>
        </div>
        );})()}
      {inputSheet==="diary"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{t("rec.diaryTitle")}</h3>
            {!todayHasCond(tab)&&<button className="yl-quick-big" style={{marginBottom:12}} onClick={()=>{quickHealthy(tab);setInputSheet(null);}}><Icon name="check" size={18}/> {t("diary.quickHealthy")}</button>}
            <p className="yl-diary-hint">{t("diary.hint")}</p>
            {(()=>{const dcfg=diaryConfigFor(diaryTypeOf(tab));const has=k=>dcfg.rows.includes(k);return(<>
            {has("energy")&&<div className="yl-diary-row"><span className="yl-diary-label">{t("diary.energy")}</span><span className="yl-diary-chips">{DIARY_ENERGY.map(c=><button key={c.key} className={"yl-diary-chip"+(diaryDraft.energy===c.key?" on":"")} onClick={()=>setDiary({energy:diaryDraft.energy===c.key?"":c.key})}><Icon name={ENERGY_ICON[c.key]} size={15}/> {lblOf(c)}</button>)}</span></div>}
            {has("appetite")&&<div className="yl-diary-row"><span className="yl-diary-label">{t("diary.appetite")}</span><span className="yl-diary-chips">{DIARY_APPETITE.map(c=><button key={c.key} className={"yl-diary-chip"+(diaryDraft.appetite===c.key?" on":"")} onClick={()=>setDiary({appetite:diaryDraft.appetite===c.key?"":c.key})}><Icon name="utensils" size={15}/> {lblOf(c)}</button>)}</span></div>}
            {has("poop")&&<div className="yl-diary-row"><span className="yl-diary-label">{t("diary.poop")}</span><span className="yl-diary-chips">{DIARY_POOP.map(c=><button key={c.key} className={"yl-diary-chip"+(diaryDraft.poop===c.key?" on":"")} onClick={()=>setDiary({poop:diaryDraft.poop===c.key?"":c.key})}><Icon name={POOP_DIARY_ICON[c.key]} size={15}/> {lblOf(c)}</button>)}</span></div>}
            {has("sleep")&&<div className="yl-diary-row"><span className="yl-diary-label">{t("diary.sleep")}</span><span className="yl-diary-chips">{(diaryTypeOf(tab)==="adult"?["6","7","8"]:["9","10","11","12"]).map(h=><button key={h} className={"yl-diary-chip"+(diaryDraft.sleep===h?" on":"")} onClick={()=>setDiary({sleep:diaryDraft.sleep===h?"":h})}><Icon name="moon" size={15}/> {t("diary.hours",{h})}</button>)}<span className="yl-diary-sleepnum"><input type="number" inputMode="numeric" min="0" max="24" className="yl-health-num" value={diaryDraft.sleep} onChange={e=>setDiary({sleep:e.target.value})} placeholder={t("diary.hoursPh")}/>{t("diary.hoursSuffix")}</span></span></div>}
            {(has("walk")||has("hospital"))&&<div className="yl-diary-row"><span className="yl-diary-label">{t("diary.other")}</span><span className="yl-diary-chips">{has("walk")&&<button className={"yl-diary-chip"+(diaryDraft.walk?" on":"")} onClick={()=>setDiary({walk:!diaryDraft.walk})}><Icon name="paw" size={15}/> {t("diary.walk")}</button>}{has("hospital")&&<button className={"yl-diary-chip"+(diaryDraft.hospital?" on":"")} onClick={()=>setDiary({hospital:!diaryDraft.hospital})}><Icon name="activity" size={15}/> {t("diary.hospital")}</button>}</span></div>}
            {dcfg.symptoms.length>0&&<div className="yl-diary-row"><span className="yl-diary-label">{t("diary.symptoms")}</span><span className="yl-diary-chips">{dcfg.symptoms.map(sk=>{const s=SYMPTOMS[sk];return s&&<button key={sk} className={"yl-diary-chip"+((diaryDraft.symptoms||[]).includes(sk)?" on sym":"")} onClick={()=>toggleSymptom(sk)}><Icon name={symIcon(sk)} size={15}/> {lblOf(s)}</button>;})}</span></div>}
            {dcfg.symptoms.includes("period")&&(()=>{const periodSel=(diaryDraft.symptoms||[]).includes("period");const fc=periodForecast(tab);const showFc=fc&&fc.next;if(!periodSel&&!showFc)return null;return(<div className="yl-period-inline">
              {periodSel&&<p className="yl-period-priv"><Icon name="shield" size={13}/> {t("diary.periodPriv")}</p>}
              {showFc&&<p className="yl-period-note"><Icon name="heart" size={13}/> {t("diary.periodNote",{last:fmtDate(fc.last),next:fmtDate(fc.next),avg:fc.avg})}</p>}
            </div>);})()}
            </>);})()}
            <input className="yl-input sm" style={{width:"100%",boxSizing:"border-box",marginTop:4}} value={diaryDraft.note} onChange={e=>setDiary({note:e.target.value})} placeholder={t("diary.notePh")}/>
            <div className="yl-diary-photorow">{diaryDraft.photo?<span className="yl-diary-thumb"><img src={diaryDraft.photo} alt=""/><button className="yl-diary-thumbdel" onClick={()=>setDiary({photo:null})} aria-label={t("diary.delPhoto")}>×</button></span>:<label className="yl-diary-addphoto"><Icon name="camera" size={14}/> {t("diary.addPhoto")}<input type="file" accept="image/*" style={{display:"none"}} onChange={pickDiaryPhoto}/></label>}</div>
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:8}} onClick={saveDiary}>{t("diary.saveBtn")}</button>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>{t("common.close")}</button></div>
          </div>
        </div>
      )}
      {inputSheet==="expense"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{t("exp.addTitle")}</h3>
            <div className="yl-exp-input"><span className="yl-exp-amt"><span className="yl-exp-yen">¥</span><input type="number" inputMode="numeric" className="yl-health-num" value={expAmount} onChange={e=>setExpAmount(e.target.value)} placeholder={t("common.amount")}/></span><select className="yl-select" value={expenseCatsFor(curKind).some(c=>c.key===expCat)?expCat:expenseCatsFor(curKind)[0].key} onChange={e=>setExpCat(e.target.value)}>{expenseCatsFor(curKind).map(c=><option key={c.key} value={c.key}>{c.emoji} {expCatLabel(c)}</option>)}</select></div>
            <input className="yl-input sm" style={{width:"100%",boxSizing:"border-box",marginTop:6}} value={expNote} onChange={e=>setExpNote(e.target.value)} placeholder={t("exp.notePh")}/>
            <p className="yl-foot" style={{margin:"8px 0 0",textAlign:"left"}}>{t("exp.addHint")}</p>
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:8}} onClick={saveExpense}>{t("exp.addTitle")}</button>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>{t("common.close")}</button></div>
          </div>
        </div>
      )}
      {inputSheet==="belong"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="bag" size={18}/> {t("belong.addTitle")}</h3>
            <div className="yl-belong-add">
              <select className="yl-select" value={belongDow} onChange={e=>setBelongDow(Number(e.target.value))}>{weekdaysShort.map((w,i)=><option key={i} value={i}>{w}{t("belong.dowSuffix")}</option>)}</select>
              <input className="yl-input sm" value={belongDraft} onChange={e=>setBelongDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addBelonging()} placeholder={t("belong.addPh")}/>
              <button className="yl-addbtn sm" onClick={addBelonging}>{t("common.add")}</button>
            </div>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>{t("common.close")}</button></div>
          </div>
        </div>
      )}
      {foodCalc&&(()=>{const stages=LIFESTAGE[foodCalc.species]||LIFESTAGE.dog;const res=calcFoodAmount(foodCalc.species,foodCalc.bw,foodCalc.stage,foodCalc.bcs,foodCalc.me);return(
        <div className="yl-help-ov" onClick={()=>setFoodCalc(null)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head"><h2 className="yl-help-title"><Icon name="scale" size={18}/> 1日のフード量 計算</h2><button className="yl-help-close" onClick={()=>setFoodCalc(null)} aria-label="閉じる">×</button></div>
            <p className="yl-set-desc" style={{background:"#FBEEE2",color:"#8A5A3A",borderRadius:10,padding:"8px 10px"}}>⚠ こちらは<strong>参考値</strong>です。結果や給餌量について責任は負えません。急な食事量の変更は健康に影響します。必ずかかりつけの先生にご相談のうえご利用ください。</p>
            <div className="yl-opt" style={{marginTop:12,width:"100%"}}>動物種<span className="yl-seg-mini">{[{k:"dog",l:"犬"},{k:"cat",l:"猫"}].map(o=><button key={o.k} className={"yl-seg-mini-btn"+(foodCalc.species===o.k?" on":"")} onClick={()=>setFoodCalc(f=>({...f,species:o.k,stage:""}))}>{o.l}</button>)}</span></div>
            <div className="yl-opt" style={{marginTop:10,width:"100%"}}>現在の体重（BW）<div className="yl-food-amtrow"><input type="number" inputMode="decimal" className="yl-health-num" value={foodCalc.bw} onChange={e=>setFoodCalc(f=>({...f,bw:e.target.value}))} placeholder="体重"/><span className="yl-food-unit">kg</span></div></div>
            <label className="yl-opt" style={{marginTop:10,width:"100%"}}>ライフステージ・活動量<select className="yl-input sm" style={{marginTop:4}} value={foodCalc.stage} onChange={e=>setFoodCalc(f=>({...f,stage:e.target.value}))}><option value="">選択してください</option>{stages.map(s=><option key={s.k} value={s.k}>{s.l}（係数{s.f}）</option>)}</select></label>
            <div className="yl-opt" style={{marginTop:10,width:"100%"}}>BCS（体格）：<strong>{foodCalc.bcs}</strong> / 9　<span style={{color:"var(--text-sub)",fontSize:12}}>適正は{foodCalc.species==="cat"?"5":"4〜5"}</span>
              <span className="yl-bcs-row">{[1,2,3,4,5,6,7,8,9].map(n=><button key={n} className={"yl-bcs-btn"+(foodCalc.bcs===n?" on":"")+(bcsIdeal(foodCalc.species,n)?" ideal":"")} onClick={()=>setFoodCalc(f=>({...f,bcs:n}))}>{n}</button>)}</span>
              <button className="yl-linkbtn" onClick={()=>setFoodCalcGuide(g=>!g)}>{foodCalcGuide?"BCSの見かたを閉じる":`${foodCalc.species==="cat"?"猫":"犬"}のBCSの見かたを見る`}</button>
              {foodCalcGuide&&<ul className="yl-bcs-guide">{(BCS_GUIDE[foodCalc.species]||BCS_GUIDE.dog).map(g=><li key={g[0]} className={bcsIdeal(foodCalc.species,g[0])?"ideal":""}><b>{g[0]}：{g[1]}</b>{g[2]}</li>)}</ul>}
            </div>
            <div className="yl-opt" style={{marginTop:10,width:"100%"}}>フードの代謝エネルギー（ME）<div className="yl-food-amtrow"><input type="number" inputMode="decimal" className="yl-health-num" value={foodCalc.me} onChange={e=>setFoodCalc(f=>({...f,me:e.target.value}))} placeholder="kcal"/><span className="yl-food-unit">kcal / 100g</span></div><span className="yl-set-desc" style={{width:"100%",marginTop:4,fontSize:12}}>フードの100gあたりkcal（パッケージ記載）。未入力でも計算OK。</span>
              <button className="yl-linkbtn" onClick={()=>setFoodCalcMeGuide(g=>!g)}>{foodCalcMeGuide?"MEの目安を閉じる":`${foodCalc.species==="cat"?"猫":"犬"}のMEの目安を見る`}</button>
              {foodCalcMeGuide&&<><ul className="yl-me-guide">{(ME_GUIDE[foodCalc.species]||ME_GUIDE.dog).map((r,i)=><li key={i}><span>{r[0]}</span><b>{r[1]}</b></li>)}</ul><p className="yl-set-desc" style={{fontSize:11.5,marginTop:4}}>※ 目安です。実際はパッケージの「100gあたり」をご確認ください。</p></>}
            </div>
            <div className="yl-foodcalc-res">
              {res?(<>
                <div className="yl-fcr-row"><span className="yl-fcr-l">理想的な体重</span><span className="yl-fcr-v">{res.ideal} kg</span></div>
                <div className="yl-fcr-row"><span className="yl-fcr-l">1日に必要なカロリー（DER）</span><span className="yl-fcr-v">{res.der} kcal</span></div>
                {res.grams!=null?(<>
                  <div className="yl-fcr-row big"><span className="yl-fcr-l">1日のフード量</span><span className="yl-fcr-v">{res.grams} g</span></div>
                  <div className="yl-fcr-splits"><span>2回：{res.per2}g</span><span>3回：{res.per3}g</span><span>4回：{res.per4}g</span></div>
                  <p className="yl-fcr-apply-label">1回の量をフードに反映</p>
                  <div className="yl-fcr-apply">
                    <button className="yl-fcr-applybtn" onClick={()=>applyCalcToFood(res.grams,1)}>1回 {res.grams}g</button>
                    <button className="yl-fcr-applybtn" onClick={()=>applyCalcToFood(res.per2,2)}>2回 {res.per2}g</button>
                    <button className="yl-fcr-applybtn" onClick={()=>applyCalcToFood(res.per3,3)}>3回 {res.per3}g</button>
                    <button className="yl-fcr-applybtn" onClick={()=>applyCalcToFood(res.per4,4)}>4回 {res.per4}g</button>
                  </div>
                  <p className="yl-set-desc" style={{fontSize:11.5,marginTop:6}}>{foodDefs.some(f=>f.kcalBasis==="per100")?"登録フードの量・回数に設定。":"この分量で新しいフードを登録。"}</p>
                </>):(<p className="yl-set-desc" style={{marginTop:6}}>MEを入れると1日のフード量（g）も計算。</p>)}
              </>):(<p className="yl-set-desc">体重と BCS を入れると計算します。</p>)}
            </div>
            <button className="yl-addbtn" style={{width:"100%",marginTop:12,background:"#F3EFE8",color:"#6E6862"}} onClick={()=>setFoodCalc(null)}>とじる</button>
          </div>
        </div>
      );})()}
      {foodForm&&(
        <div className="yl-overlay" onClick={()=>setFoodForm(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="utensils" size={18}/> {foodForm.id?t("food.editTitle"):t("food.newTitle")}</h3>
            <input className="yl-input" value={foodForm.name} onChange={e=>setFoodForm(f=>({...f,name:e.target.value}))} placeholder={t("ph.foodName")} autoFocus/>
            <input className="yl-input sm" style={{marginTop:8}} value={foodForm.brand} onChange={e=>setFoodForm(f=>({...f,brand:e.target.value}))} placeholder={t("ph.brand")}/>
            <div className="yl-opt" style={{marginTop:10,width:"100%"}}>{t("food.type")}<span className="yl-seg-mini yl-food-typeseg">{FOOD_TYPES.map(ft=><button key={ft.k} className={"yl-seg-mini-btn"+(foodForm.foodType===ft.k?" on":"")} onClick={()=>setFoodForm(f=>({...f,foodType:ft.k}))}>{t("foodtype."+ft.k)}</button>)}</span></div>
            <div className="yl-opt" style={{marginTop:10,width:"100%"}}>{t("food.amountUnit")}<div className="yl-food-amtrow"><input type="number" inputMode="decimal" className="yl-health-num" value={foodForm.amount} onChange={e=>setFoodForm(f=>({...f,amount:e.target.value}))} placeholder={t("ph.amount")}/><span className="yl-seg-mini">{FOOD_UNITS.map(u=><button key={u.k} className={"yl-seg-mini-btn"+(foodForm.unit===u.k?" on":"")} onClick={()=>setFoodForm(f=>({...f,unit:u.k}))}>{t("foodunit."+u.k)}</button>)}</span></div></div>
            <div className="yl-opt" style={{marginTop:10,width:"100%"}}>{t("food.timesTime")}<div className="yl-food-amtrow"><input type="number" inputMode="numeric" className="yl-health-num" value={foodForm.times} onChange={e=>setFoodForm(f=>({...f,times:e.target.value}))} placeholder={t("ph.times")}/><input className="yl-input sm" style={{flex:1}} value={foodForm.feedTime} onChange={e=>setFoodForm(f=>({...f,feedTime:e.target.value}))} placeholder={t("ph.feedTime")}/></div></div>
            <div className="yl-opt" style={{marginTop:10,width:"100%"}}>{t("food.kcal")}<div className="yl-food-amtrow"><input type="number" inputMode="decimal" className="yl-health-num" value={foodForm.kcal} onChange={e=>setFoodForm(f=>({...f,kcal:e.target.value}))} placeholder="kcal"/><span className="yl-seg-mini">{[{k:"per100",l:"/100"+(foodForm.unit==="ml"?"ml":"g")},{k:"perUnit",l:"/"+foodUnitLabel(foodForm.unit)}].map(o=><button key={o.k} className={"yl-seg-mini-btn"+(foodForm.kcalBasis===o.k?" on":"")} onClick={()=>setFoodForm(f=>({...f,kcalBasis:o.k}))}>{o.l}</button>)}</span></div><span className="yl-set-desc" style={{width:"100%",marginTop:4}}>{t("food.kcalDesc")}</span></div>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setFoodForm(null)}>{t("common.close")}</button><button className="yl-addbtn modal" onClick={saveFoodDef}><Icon name="check" size={15}/> {t("common.save")}</button></div>
          </div>
        </div>
      )}
      {mealForm&&(()=>{const d=foodDefs.find(x=>x.id===mealForm.foodId);if(!d)return null;const kc=computeMealKcal(d,mealForm.amount);return(
        <div className="yl-overlay" onClick={()=>setMealForm(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name={foodTypeMeta(d.foodType).ic} size={18}/> {t("food.mealTitle")}</h3>
            {foodDefs.length>1&&<div className="yl-opt" style={{width:"100%"}}>{t("food.food")}<div className="yl-meal-pick" style={{marginTop:6}}>{foodDefs.map(fd=><button key={fd.id} className={"yl-meal-chip"+(fd.id===mealForm.foodId?" on":"")} onClick={()=>setMealForm(f=>({...f,foodId:fd.id,amount:(fd.amount!==""&&fd.amount!=null)?String(fd.amount):f.amount}))}><Icon name={foodTypeMeta(fd.foodType).ic} size={12}/> <span className="yl-meal-chipname">{fd.name}</span></button>)}</div></div>}
            <div className="yl-opt" style={{marginTop:foodDefs.length>1?10:0,width:"100%"}}>{t("food.when")}<span className="yl-seg-mini">{MEAL_SLOTS.map(s=><button key={s.k} className={"yl-seg-mini-btn"+(mealForm.slot===s.k?" on":"")} onClick={()=>setMealForm(f=>({...f,slot:s.k}))}>{t("mealslot."+s.k)}</button>)}</span></div>
            <div className="yl-opt" style={{marginTop:10,width:"100%"}}>{t("food.qty")}<div className="yl-food-amtrow"><input type="number" inputMode="decimal" className="yl-health-num" value={mealForm.amount} onChange={e=>setMealForm(f=>({...f,amount:e.target.value}))} placeholder={t("ph.amount")} autoFocus/><span className="yl-food-unit">{foodUnitLabel(d.unit)}</span>{kc!=null&&<span className="yl-food-kcal">{t("food.approxKcal",{kc})}</span>}</div></div>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setMealForm(null)}>{t("common.close")}</button><button className="yl-addbtn modal" onClick={saveMeal}><Icon name="check" size={15}/> {t("food.logBtn")}</button></div>
          </div>
        </div>
      );})()}
      {inputSheet==="bday"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="cake" size={18}/> {t("bday.addTitle")}</h3>
            <input className="yl-input" value={friendBdayName} onChange={e=>setFriendBdayName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addFriendBday()} placeholder={t("ph.bdayName")}/>
            <label className="yl-opt" style={{marginTop:10}}>{t("bday.dateYearOpt")}<BdayInput value={friendBdayDate} onChange={setFriendBdayDate}/></label>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>{t("common.close")}</button><button className="yl-addbtn modal" onClick={addFriendBday}><Icon name="cake" size={15}/> {t("common.add")}</button></div>
          </div>
        </div>
      )}
      {/* ＋入力ハブ：何を記録するか選ぶ。よく使う→たまに→まだ使っていない、の順 */}
      {hubOpen&&(()=>{
        const has=(t)=>items.some(x=>x.space===tab&&x.type===t);
        const open=(fn)=>{setHubOpen(false);fn();};
        const OPTS=[
          {key:"schedule",icon:"calendar",label:isMemberTab?t("hub.schedulePet"):t("hub.scheduleMe"),freq:1,used:isMemberTab?items.some(x=>x.space===tab&&x.type==="care"):items.some(x=>x.space==="me"&&ME_TYPES.includes(x.type)),act:()=>setInputSheet("schedule")},
          {key:"diary",icon:"note",label:t("rec.diaryTitle"),freq:1,used:has("diary"),act:()=>setInputSheet("diary")},
          ...(curKind==="pet"?[{key:"feed",icon:"utensils",label:t("rec.feedTitle"),freq:1,used:has("feed"),act:()=>openMeal(foodDefs[0]?.id)}]:[]),
          ...(curKind==="pet"?[{key:"toilet",icon:"paw",label:t("hub.toilet"),freq:1,used:has("toilet"),act:()=>setInputSheet("toilet")}]:[]),
          {key:"routine",icon:"repeat",label:t("hub.routine"),freq:1,used:has("routine"),act:openRoutineCustom},
          {key:"health",icon:"scale",label:t("hub.health"),freq:2,used:has("health"),act:()=>setInputSheet("health")},
          {key:"expense",icon:"wallet",label:t("exp.title"),freq:2,used:has("expense"),act:()=>setInputSheet("expense")},
          {key:"memory",icon:"camera",label:t("album.title"),freq:2,used:has("memory"),act:()=>openLifeNew(todayIso,tab)},
          {key:"supply",icon:"package",label:t("supply.title"),freq:3,used:has("supply"),act:openSupplyCustom},
          {key:"card",icon:"pin",label:t("rec.trayTitle"),freq:3,used:has("card"),act:()=>openCardNew("other")},
          ...(curKind==="person"?[{key:"belong",icon:"bag",label:t("hub.belong"),freq:3,used:has("belonging"),act:()=>setInputSheet("belong")}]:[]),
          ...(!isMemberTab?[{key:"bday",icon:"gift",label:t("hub.bday"),freq:3,used:items.some(x=>x.space==="me"&&x.type==="bday"),act:()=>setInputSheet("bday")}]:[]),
        ];
        // メイン表示は「よく使う機能」＋「ユーザーが明示的に追加した機能」のみ。
        // 「使ったかどうか」では並びが変わらない（安定性）。
        const pinned=new Set(menuAdded);
        const core=OPTS.filter(o=>o.freq===1||pinned.has(o.key));
        const addable=OPTS.filter(o=>o.freq!==1&&!pinned.has(o.key));
        const Grid=({list})=>(<div className="yl-hub-grid">{list.map(o=><button key={o.key} className="yl-hub-item" onClick={()=>open(o.act)}><span className="yl-hub-emoji"><Icon name={o.icon} size={24}/></span><span className="yl-hub-label">{o.label}</span></button>)}</div>);
        return(
          <div className="yl-overlay yl-hub-ov" onClick={()=>setHubOpen(false)}>
            <div className="yl-hub" onClick={e=>e.stopPropagation()}>
              <div className="yl-hub-head"><h3 className="yl-hub-title">{t("hub.title")}</h3><span className="yl-hub-who">{nameOf(tab)}</span></div>
              <Grid list={core}/>
              {addable.length>0&&(
                <div className="yl-hub-add">
                  <p className="yl-hub-add-label">{t("hub.addable")}</p>
                  <div className="yl-hub-grid">
                    {addable.map(o=><button key={o.key} className="yl-hub-item addable" onClick={()=>{addToMenu(o.key);open(o.act);}}><span className="yl-hub-addbadge"><Icon name="plus" size={12}/></span><span className="yl-hub-emoji"><Icon name={o.icon} size={24}/></span><span className="yl-hub-label">{o.label}</span></button>)}
                  </div>
                </div>
              )}
              <button className="yl-hub-close" onClick={()=>setHubOpen(false)}>{t("common.close")}</button>
            </div>
          </div>
        );
      })()}
      {confirmAct&&<div className="yl-overlay" onClick={()=>setConfirmAct(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji"><Icon name="trash" size={30}/></div><h3 className="yl-modal-title">{t("del.confirmTitle")}</h3>{confirmAct.label?<p className="yl-modal-body">{t("del.confirmBody",{label:confirmAct.label})}</p>:<p className="yl-modal-body">{t("del.confirmBodyPlain")}</p>}<div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmAct(null)}>{t("common.cancel")}</button><button className="yl-modal-del" onClick={()=>{const f=confirmAct.fn;setConfirmAct(null);f&&f();}}>{t("del.confirmBtn")}</button></div></div></div>}
      {profilePrompt&&(()=>{const m=members.find(x=>x.id===profilePrompt);return(
        <div className="yl-overlay" onClick={()=>setProfilePrompt(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}>
          <div className="yl-modal-emoji"><Icon name="sparkles" size={28}/></div>
          <h3 className="yl-modal-title">プロフィールを設定しませんか？</h3>
          <p className="yl-modal-body">{m&&m.kind==="pet"?"犬種やお迎え日も入れておくと、記録がもっと楽しく。":"色や誕生日も入れておくと、ぐっと見やすく。"}</p>
          <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setProfilePrompt(null)}>あとで</button><button className="yl-addbtn modal" onClick={()=>{const mm=members.find(x=>x.id===profilePrompt);setProfilePrompt(null);startMemberEdit(mm);}}>プロフィールを設定</button></div>
        </div></div>
      );})()}
      {confirmReset&&<div className="yl-overlay" onClick={()=>setConfirmReset(false)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji"><Icon name="alert" size={30}/></div><h3 className="yl-modal-title">本当に消して良いですか？</h3><p className="yl-modal-body">予定・ケア・消耗品・家族の情報がすべて消え、元に戻せません。</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmReset(false)}>キャンセル</button><button className="yl-modal-del" onClick={()=>{setConfirmReset(false);resetApp();}}>消して最初から</button></div></div></div>}
      {calPicker&&(()=>{
        const it=calPicker.item;
        const memberName=it?nameOf(it.space):"";
        const memberEmoji=it?(it.space==="me"?meEmoji:(members.find(m=>m.id===it.space)?.emoji||"")):"";
        const gcal=it?gcalLink(it,memberName,memberEmoji):null;
        const icsContent=it?generateIcal([it],members,meEmoji,meName):generateIcal(items,members,meEmoji,meName);
        const icsName=it?`${it.title}.ics`:"loalife-calendar.ics";
        return(
          <div className="yl-overlay" onClick={()=>setCalPicker(null)}>
            <div className="yl-modal cal-picker" onClick={e=>e.stopPropagation()}>
              <h3 className="yl-modal-title"><Icon name="calendar" size={18}/> カレンダーに追加</h3>
              {it?<p className="yl-cal-picker-sub">{it.emoji} {it.title}</p>:<p className="yl-cal-picker-sub">これからの予定をまとめて出力します</p>}
              {it&&gcal&&(
                <a className="yl-cal-choice-btn google" href={gcal} target="_blank" rel="noopener noreferrer" onClick={()=>setCalPicker(null)}>
                  <svg width="18" height="18" viewBox="0 0 48 48" style={{flexShrink:0}}><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.7 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.5 13.3l8 6.2C12.4 13 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.8-2.1 5.2-4.4 6.8l7 5.4C43.3 37.1 46.5 31.3 46.5 24.5z"/><path fill="#FBBC05" d="M10.5 28.5c-.5-1.5-.8-3-.8-4.5s.3-3 .8-4.5l-8-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l8-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7-5.4c-2 1.3-4.5 2.1-8.2 2.1-6.3 0-11.6-4.2-13.5-9.9l-8 6.2C6.6 42.6 14.6 48 24 48z"/></svg>
                  Googleカレンダー
                </a>
              )}
              <button className="yl-cal-choice-btn apple" onClick={()=>{downloadIcal(icsContent,icsName);setCalPicker(null);}}>
                🍎 {it?"Appleカレンダー（.ics）":"カレンダーアプリに出力（.ics）"}
              </button>
              <p className="yl-cal-note">
                💡 iPhoneでAppleカレンダーに追加するには：<br/>
                <strong>SafariブラウザでこのサイトをURL直接開く</strong> → 📅タップ → .icsをダウンロード → カレンダーで開く
              </p>
              <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setCalPicker(null)}>とじる</button></div>
            </div>
          </div>
        );
      })()}
      {quickAdd&&(
        <div className="yl-overlay" onClick={()=>setQuickAdd(null)}>
          <div className="yl-modal quickadd" onClick={e=>e.stopPropagation()}>
            <div className="yl-quickadd-head">
              <span className="yl-quickadd-ico">{quickAdd.emoji}</span>
              <div>
                <p className="yl-quickadd-name">{quickAdd.title}</p>
                {quickAdd.lastDate&&<p className="yl-quickadd-prev">前回: {fmtDate(quickAdd.lastDate)}</p>}
              </div>
            </div>
            <label className="yl-opt" style={{display:"block",marginBottom:14}}>
              日付
              <input type="date" className="yl-date" style={{display:"block",width:"100%",marginTop:6}} value={quickDate} onChange={e=>setQuickDate(e.target.value)} autoFocus/>
            </label>
            <div className="yl-modal-btns">
              <button className="yl-modal-cancel" onClick={()=>setQuickAdd(null)}>キャンセル</button>
              <button className="yl-addbtn modal" onClick={saveQuickAdd}>追加する</button>
            </div>
          </div>
        </div>
      )}
      {routineEdit&&(
        <div className="yl-overlay" onClick={()=>setRoutineEdit(null)}>
          <div className="yl-modal edit routine" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{routineEdit.id?"ルーティンを編集":"ルーティンを追加"}</h3>
            <div className="yl-routine-emojirow">{(ROUTINE_EMOJIS[normKind(routineEdit.space==="me"?"me":(members.find(m=>m.id===routineEdit.space)||{}).kind)]).map(e=><button key={e} className={"yl-emoji"+(routineEdit.emoji===e?" on":"")} onClick={()=>setRoutineEdit(p=>({...p,emoji:e}))}>{e}</button>)}</div>
            <input className="yl-input" value={routineEdit.title} onChange={e=>setRoutineEdit(p=>({...p,title:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&saveRoutine()} placeholder="やること（例：夜の散歩）" autoFocus/>
            <div className="yl-optrow"><label className="yl-opt">時間<TimeInput value={routineEdit.time} onChange={t=>setRoutineEdit(p=>({...p,time:t}))}/></label></div>
            <div className="yl-notify"><span className="yl-notify-label"><Icon name="bell" size={14}/> リマインド{notifPerm==="default"&&<button className="yl-notif-small" onClick={handleNotifRequest}>許可する</button>}</span><div className="yl-notify-chips">{REMINDER_OPTS.filter(o=>o.key!==1440).map(o=><button key={o.key} className={"yl-nchip"+(routineEdit.reminders.includes(o.key)?" on":"")} onClick={()=>toggleRoutineReminder(o.key)}>{o.label}</button>)}</div>{routineEdit.reminders.length>=4&&<p className="yl-notify-hint">🔔が多いと見落としがち。必要なぶんだけに。</p>}</div>
            <div className="yl-modal-btns">
              {routineEdit.id&&<button className="yl-modal-cancel" onClick={()=>askDelete(routineEdit.title,()=>removeRoutine(routineEdit.id))}>削除</button>}
              <button className="yl-modal-cancel" onClick={()=>setRoutineEdit(null)}>とじる</button>
              <button className="yl-addbtn modal" onClick={saveRoutine}>保存</button>
            </div>
          </div>
        </div>
      )}
      {supplyEdit&&(
        <div className="yl-overlay" onClick={()=>setSupplyEdit(null)}>
          <div className="yl-modal edit routine" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{supplyEdit.id?"ストックを編集":"ストックを追加"}</h3>
            <div className="yl-routine-emojirow">{SUPPLY_EMOJIS.map(e=><button key={e} className={"yl-emoji"+(supplyEdit.emoji===e?" on":"")} onClick={()=>setSupplyEdit(p=>({...p,emoji:e}))}>{e}</button>)}</div>
            <input className="yl-input" value={supplyEdit.title} onChange={e=>setSupplyEdit(p=>({...p,title:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&saveSupply()} placeholder="品名（例：フード）" autoFocus/>
            <div className="yl-optrow">
              <label className="yl-opt">最後に買った日<input type="date" className="yl-date" value={supplyEdit.lastBought} onChange={e=>setSupplyEdit(p=>({...p,lastBought:e.target.value}))}/></label>
              <label className="yl-opt">消費サイクル<select className="yl-select" value={supplyEdit.cycleDays} onChange={e=>setSupplyEdit(p=>({...p,cycleDays:Number(e.target.value)}))}>{SUPPLY_CYCLES.map(d=><option key={d} value={d}>{d}日</option>)}</select></label>
            </div>
            {supplyEdit.lastBought&&<p className="yl-supply-preview">{supplyLine({lastBought:supplyEdit.lastBought,cycleDays:Number(supplyEdit.cycleDays)})}</p>}
            <div className="yl-modal-btns">
              {supplyEdit.id&&<button className="yl-modal-cancel" onClick={()=>askDelete(supplyEdit.title,()=>removeSupply(supplyEdit.id))}>削除</button>}
              <button className="yl-modal-cancel" onClick={()=>setSupplyEdit(null)}>とじる</button>
              <button className="yl-addbtn modal" onClick={saveSupply}>保存</button>
            </div>
          </div>
        </div>
      )}
      {showShareModal&&<ShareModal/>}
      {flash&&<div className="yl-flash">{flash}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App/>);
