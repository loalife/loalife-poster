import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
const daysBetween = (a,b) => { const[ay,am,ad]=a.split("-").map(Number),[by,bm,bd]=b.split("-").map(Number); return Math.round((new Date(by,bm-1,bd)-new Date(ay,am-1,ad))/86400000); };
const addDays = (s,n) => { const[y,m,d]=s.split("-").map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+n); return iso(dt); };
const fmtBirthday = (s) => { if(!s)return""; const[,mo,d]=s.split("-").map(Number); return`${mo}月${d}日`; };

// dream は選択カテゴリから廃止。既存データ（過去に作成された「夢」項目）の表示互換のため定義のみ残す。
const TYPE_META={work:{label:"仕事",emoji:"💼",bg:"#E7E9EF",fg:"#5B6B9E"},event:{label:"予定",emoji:"📅",bg:"#ECE6F1",fg:"#8A6D9E"},social:{label:"飲み会",emoji:"🍻",bg:"#F3E7D6",fg:"#C77A2E"},habit:{label:"習慣",emoji:"💪",bg:"#F5EAD2",fg:"#C99A2E"},dream:{label:"夢",emoji:"🌈",bg:"#F5EAD8",fg:"#B23A48"}};
const ME_TYPES=["work","event","social","habit"];
// 予定系（その日に起きる・カレンダー表示・日付が実質必須）。それ以外はToDo系＝期限は任意。
const KIND_STYLE={pet:{bg:"#E4EEE7",fg:"#557E63",word:"ケア"},person:{bg:"#E3EEFF",fg:"#3B7BF6",word:"予定"}};
// 安心ステータスのレベル：OK / 注意 / 要対応
const LEVEL_META={ok:{label:"順調",dot:"#6FA382"},warn:{label:"注意",dot:"#D9A441"},alert:{label:"要対応",dot:"#B23A48"},none:{label:"記録なし",dot:"#B5ADA3"},memorial:{label:"追悼",dot:"#A98BC9"}};
const DOG_KINDS=[{key:"daycare",label:"保育園",emoji:"🏫"},{key:"vaccine",label:"ワクチン",emoji:"💉"},{key:"rabies",label:"狂犬病",emoji:"🐕"},{key:"filaria",label:"フィラリア",emoji:"🦟"},{key:"med",label:"投薬",emoji:"💊"},{key:"trim",label:"トリミング",emoji:"✂️"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const CAT_KINDS=[{key:"vaccine",label:"ワクチン",emoji:"💉"},{key:"filaria",label:"フィラリア",emoji:"🦟"},{key:"med",label:"投薬",emoji:"💊"},{key:"trim",label:"トリミング",emoji:"✂️"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const OTHER_PET_KINDS=[{key:"checkup",label:"健康診断",emoji:"🩺"},{key:"med",label:"投薬",emoji:"💊"},{key:"groom",label:"お手入れ",emoji:"🧼"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const PERSON_KINDS=[{key:"lesson",label:"習い事",emoji:"🎒"},{key:"event",label:"予定",emoji:"📅"},{key:"school",label:"学校行事",emoji:"🏫"},{key:"med",label:"投薬",emoji:"💊"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"dental",label:"歯科",emoji:"🦷"},{key:"checkup",label:"健康診断",emoji:"🩺"},{key:"vaccine",label:"予防接種",emoji:"💉"},{key:"other",label:"その他",emoji:"✨"}];
const SPECIES=[{key:"dog",label:"犬",emoji:"🐶"},{key:"cat",label:"猫",emoji:"🐱"},{key:"other",label:"その他",emoji:"🐹"}];
// 犬種・猫種・毛色の候補（選択リスト。リストにない場合は自由入力も可＝datalist）。
const DOG_BREEDS=["柴犬","豆柴","トイプードル","チワワ","ミニチュアダックスフンド","ポメラニアン","ミニチュアシュナウザー","ヨークシャーテリア","フレンチブルドッグ","シーズー","マルチーズ","ゴールデンレトリバー","ラブラドールレトリバー","ウェルシュコーギー","ボーダーコリー","パグ","ジャックラッセルテリア","ビーグル","キャバリア","ペキニーズ","パピヨン","ミニチュアピンシャー","ボストンテリア","秋田犬","ミックス（雑種）","その他"];
const CAT_BREEDS=["スコティッシュフォールド","アメリカンショートヘア","マンチカン","ラグドール","ノルウェージャンフォレストキャット","ブリティッシュショートヘア","ペルシャ","ロシアンブルー","メインクーン","ベンガル","アビシニアン","ソマリ","シャム","ヒマラヤン","日本猫（雑種）","ミックス（雑種）","その他"];
const COAT_COLORS=["黒","白","茶（レッド）","クリーム","グレー","ブラウン","ブラック＆タン","三毛","キジトラ","茶トラ","サバトラ","サビ","ハチワレ","白黒（ハチワレ）","シルバー","ブルー","その他"];
const breedOptionsFor=(species)=>species==="cat"?CAT_BREEDS:species==="dog"?DOG_BREEDS:[];

// 誤食・中毒の危険物リスト（犬・猫向けの一般的な注意。獣医の診断に代わるものではない）。
// sp: 対象種（"dog"/"cat"/"both"）, lv: "danger"(絶対NG)/"caution"(要注意)
const TOXIC_ITEMS=[
  {name:"チョコレート・ココア",sp:"both",lv:"danger",sym:"嘔吐・下痢・興奮・けいれん・不整脈",note:"カカオのテオブロミンが中毒源。ビター/製菓用ほど危険。"},
  {name:"ねぎ類（玉ねぎ・長ねぎ・にら・にんにく）",sp:"both",lv:"danger",sym:"貧血・血尿・元気消失・食欲不振",note:"加熱・スープでも危険。猫は特に感受性が高い。"},
  {name:"ぶどう・レーズン",sp:"both",lv:"danger",sym:"嘔吐・下痢・急性腎不全",note:"少量でも腎障害の報告あり。皮・ジュースも避ける。"},
  {name:"キシリトール（ガム・お菓子）",sp:"dog",lv:"danger",sym:"低血糖・ふらつき・けいれん・肝障害",note:"犬でごく少量でも急激な低血糖。無糖商品に注意。"},
  {name:"アルコール",sp:"both",lv:"danger",sym:"ふらつき・嘔吐・呼吸抑制・昏睡",note:"飲み物だけでなく、パン生地・消毒液にも。"},
  {name:"カフェイン（コーヒー・お茶・エナジー飲料）",sp:"both",lv:"danger",sym:"興奮・頻脈・けいれん",note:"茶葉やコーヒーかすの誤食にも注意。"},
  {name:"ユリ科の植物（花・葉・花粉・生けた水）",sp:"cat",lv:"danger",sym:"急性腎不全・嘔吐・無尿",note:"猫はごく微量で致死的。切り花にも要注意。"},
  {name:"マカダミアナッツ",sp:"dog",lv:"danger",sym:"後ろ足の脱力・発熱・震え・嘔吐",note:"少量でも神経症状が出ることがある。"},
  {name:"生のパン生地",sp:"both",lv:"danger",sym:"胃の膨張・アルコール中毒",note:"胃内で発酵・膨張して危険。"},
  {name:"アボカド",sp:"both",lv:"caution",sym:"嘔吐・下痢",note:"ペルシンを含む。種による誤飲・閉塞にも注意。"},
  {name:"鶏・魚の加熱した骨",sp:"both",lv:"caution",sym:"口・のど・消化管の裂傷や閉塞",note:"加熱骨は鋭く割れやすい。"},
  {name:"牛乳・乳製品",sp:"both",lv:"caution",sym:"下痢・お腹のゆるみ",note:"乳糖不耐の子が多い。少量でも合わないことがある。"},
  {name:"生卵の白身・生肉",sp:"both",lv:"caution",sym:"食中毒・皮膚や被毛の不調",note:"サルモネラ等のリスク。加熱が無難。"},
  {name:"塩分・味付けの濃い人の食べ物",sp:"both",lv:"caution",sym:"嘔吐・多飲多尿・ふらつき",note:"ハム・スナック・出汁の効いた料理など。"},
  {name:"果物の種・芯（りんご・さくらんぼ等）",sp:"both",lv:"caution",sym:"閉塞・微量の有害成分",note:"果肉は少量可でも種・芯は避ける。"},
  {name:"観葉植物（ポトス・アイビー・サゴヤシ等）",sp:"both",lv:"caution",sym:"口内の痛み・よだれ・嘔吐",note:"かじれる場所に置かない。サゴヤシは特に危険。"},
];
// 夜間・救急で電話するときに伝えたいこと（安全な備えガイド。病院データは各自で登録）。
const EMERGENCY_TIPS=[
  "子の種類・年齢・体重（例：柴犬・5歳・8kg）",
  "何が起きたか（いつ・何を・どれくらい）",
  "今の様子（意識・呼吸・嘔吐や下痢・出血・けいれんの有無）",
  "誤食なら、食べたもの・量・時間（できれば現物やパッケージを手元に）",
  "持病・飲んでいる薬・かかりつけの有無",
  "向かうまでの目安時間",
];
const EMERGENCY_PREP=[
  "キャリー／タオル（保温・保定に）",
  "現物・パッケージ（誤食のとき）",
  "お薬手帳・ワクチン証明（このアプリのサマリーでもOK）",
  "支払い手段（カードのみの病院もあります）",
];
// 文字列から電話番号らしき部分を抽出（tel: リンク用）。無ければ null。
const extractTel=(str)=>{const m=(str||"").match(/0\d{1,4}[-(]?\d{1,4}[-)]?\d{3,4}/);return m?m[0].replace(/[()]/g,"-").replace(/--/g,"-"):null;};
const HIGH_KINDS=new Set(["vaccine","filaria","rabies","hospital","checkup"]);
// ケア種別ごとの「周期」。記録すると次回がこの間隔で自動セットされる。
// none＝単発（保育園・通院など）。単発は「期限切れ」にしない。
const CARE_CYCLE={vaccine:"yearly",rabies:"yearly",filaria:"monthly",trim:"monthly",groom:"monthly",checkup:"yearly",dental:"yearly",lesson:"weekly",med:"daily",hospital:"none",daycare:"none",event:"none",school:"none",other:"none"};
// 実効周期：明示の repeat を優先、無ければケア種別の既定周期。
function effRepeat(x){if(!x)return"none";if(x.repeat&&x.repeat!=="none")return x.repeat;if(x.type==="care")return CARE_CYCLE[x.careKind]||"none";return"none";}
const isCyclic=(x)=>effRepeat(x)!=="none";
// 「期限切れ(赤)」は、周期があり・未完了・前回(期限)を過ぎたものだけ。状態として持たず毎回計算する。
function isOverdue(x){return !!(x&&!x.done&&isCyclic(x)&&x.dueDate&&daysUntil(x.dueDate)<0);}
const PET_EMOJIS=["🐶","🐱","🐰","🐹","🐦","🐢"];
const PERSON_EMOJIS=["👧","🧒","👦","👶","👩","👨"];
const ME_EMOJIS=["🙂","😊","😄","🥰","😎","🤓","🧑","👩","👨","🧑‍💻","👩‍💻","👨‍💻","🧑‍🎤","🦊","🐱","🌸","🌺","🌈","⭐","✨","🍀","🎯","🔥","💫"];
const REPEATS=[{key:"none",label:"なし"},{key:"daily",label:"毎日"},{key:"weekly",label:"毎週"},{key:"monthly",label:"毎月"},{key:"yearly",label:"毎年"}];
// 1日のルーティン（タスクテンプレ）
// ルーティン（1日のタスク）テンプレ：相手によって内容を変える
// kind は "pet" / "person" / "me"（自分）。相手によってテンプレを出し分ける。
const ROUTINE_TEMPLATES={
  pet:[{title:"散歩",emoji:"🦮",time:"07:00"},{title:"ごはん",emoji:"🍚",time:"08:00"},{title:"トイレ掃除",emoji:"🧹",time:"09:00"}],
  person:[{title:"歯みがき",emoji:"🪥",time:"08:00"},{title:"宿題",emoji:"📖",time:"17:00"},{title:"お風呂",emoji:"🛁",time:"19:00"},{title:"薬",emoji:"💊",time:"20:00"}],
  me:[{title:"薬・サプリ",emoji:"💊",time:"08:00"},{title:"ストレッチ",emoji:"🧘",time:"07:00"},{title:"水を飲む",emoji:"💧",time:"12:00"},{title:"早く寝る",emoji:"🌙",time:"23:00"}],
};
const normKind=(k)=>k==="person"?"person":k==="me"?"me":"pet";
const routineTemplatesFor=(kind)=>ROUTINE_TEMPLATES[normKind(kind)];
const ROUTINE_EMOJIS={pet:["🦮","🍚","🧹","💊","🛁","🦴","🚽","🪥","🐾","💧"],person:["🪥","📖","🛁","💊","🍚","🌙","⏰","🎒","🧴","💧"],me:["💊","🧘","💧","🌙","☕","📖","🏃","🧴","⏰","🍵"]};
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
  if(s.tone==="out")return"切れているかも・買い足しを";
  if(s.tone==="low")return`あと${s.left}日で切れそう`;
  return`在庫OK（あと${s.left}日分）`;
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
      // 期限切れは「周期あり」のみ通知。直近(0〜3日)はそのまま
      if(isHigh&&d!==null&&d<=CARE_NOTIFY_DAYS&&(d>=0||isCyclic(x)))
        urgent.push({emoji:x.emoji||"⚠️",text:`${x.title}：${d<0?"期限切れ":d===0?"今日":"あと"+d+"日"}`,sort:d});
    }
  });
  return urgent.sort((a,b)=>a.sort-b.sort);
}
const REMINDER_OPTS=[{key:0,label:"開始時"},{key:5,label:"5分前"},{key:30,label:"30分前"},{key:60,label:"1時間前"},{key:1440,label:"前日"}];
const reminderLabel=(mins)=>(REMINDER_OPTS.find(o=>o.key===mins)||{}).label||`${mins}分前`;

// --- Notification helpers ---
const notifSupported = typeof window !== "undefined" && "Notification" in window;

async function requestNotifPermission() {
  if (!notifSupported) return "denied";
  const p = await Notification.requestPermission();
  return p;
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

// 高齢者向けのケア・予定の種別（通院・介護サポート）。
const SENIOR_KINDS=[{key:"hospital",label:"通院",emoji:"🏥"},{key:"med",label:"服薬",emoji:"💊"},{key:"pickup",label:"薬の受け取り",emoji:"💊"},{key:"care",label:"介護サービス",emoji:"🧑"},{key:"daycare",label:"デイサービス",emoji:"🏫"},{key:"rehab",label:"リハビリ",emoji:"🩹"},{key:"nurse",label:"訪問看護",emoji:"🩺"},{key:"checkup",label:"健診",emoji:"🩺"},{key:"vaccine",label:"予防接種",emoji:"💉"},{key:"other",label:"その他",emoji:"✨"}];
const careKindsFor=(m)=>{if(!m)return[];if(m.kind==="person")return m.personType==="senior"?SENIOR_KINDS:PERSON_KINDS;if(m.species==="cat")return CAT_KINDS;if(m.species==="other")return OTHER_PET_KINDS;return DOG_KINDS;};
// ケア種別 → ラインアイコン名（SF Symbols相当）
const CARE_ICON={daycare:"building",vaccine:"syringe",rabies:"paw",filaria:"bug",med:"pill",trim:"scissors",hospital:"activity",other:"paw",checkup:"stethoscope",groom:"sparkles",lesson:"bag",event:"calendar",school:"building",dental:"tooth",pickup:"pill",care:"users",rehab:"activity",nurse:"stethoscope"};
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
const fmtMonthDay=(s)=>{if(!s)return"";const[,m,d]=s.split("-").map(Number);return`${m}月${d}日`;};
const mmdd=(s)=>s?s.slice(5):""; // "MM-DD"
const dowOf=(iso)=>{if(!iso)return 0;const[y,m,d]=iso.split("-").map(Number);return new Date(y,m-1,d).getDay();};
// 写真は複数可。新形式は item.photos=[id...]、旧形式は photo:true（IDBキーは photo:<item.id>）。
const photoIdsOf=(it)=>it&&Array.isArray(it.photos)&&it.photos.length?it.photos:(it&&it.photo?[it.id]:[]);
const firstPhotoId=(it)=>{const a=photoIdsOf(it);return a.length?a[0]:null;};
// お世話ログ（やった履歴・前回からの経過）。対象（自分/ペット/家族）で出し分け
const CHORE_TPL_PET=[{title:"トイレ掃除",emoji:"🧹"},{title:"シャンプー",emoji:"🛁"},{title:"爪切り",emoji:"✂️"},{title:"ブラッシング",emoji:"🪮"},{title:"耳そうじ",emoji:"👂"},{title:"歯みがき",emoji:"🦷"},{title:"トイレ砂替え",emoji:"🐾"}];
const CHORE_TPL_PERSON=[{title:"歯みがき仕上げ",emoji:"🦷"},{title:"爪切り",emoji:"✂️"},{title:"髪カット",emoji:"💇"},{title:"耳そうじ",emoji:"👂"},{title:"上履き洗い",emoji:"👟"},{title:"シーツ交換",emoji:"🛏️"}];
const CHORE_TPL_ME=[{title:"掃除",emoji:"🧹"},{title:"洗濯",emoji:"🧺"},{title:"シーツ交換",emoji:"🛏️"},{title:"換気",emoji:"🪟"},{title:"水やり",emoji:"🪴"},{title:"ゴミ出し",emoji:"🗑️"}];
const choreTemplatesFor=(kind)=>kind==="pet"?CHORE_TPL_PET:kind==="person"?CHORE_TPL_PERSON:CHORE_TPL_ME;
// まとめて記録（多頭飼い向け）：選んだ子にワンタップで一括記録する日課
const BATCH_ACTIONS=[{title:"ご飯",emoji:"🍚"},{title:"お薬",emoji:"💊"},{title:"散歩",emoji:"🦮"},{title:"トイレ",emoji:"🚽"}];
// 前回実施日からの経過ラベル（前回いつ？をひと目で）
// 前回からの経過ラベル。warn 日以上で黄、alert 日以上で赤（しきい値は設定で変更可）。
function elapsedLabel(dateStr,warn=7,alert=14){
  if(!dateStr)return{txt:"まだ記録なし",tone:"none"};
  const d=daysUntil(dateStr);if(d==null)return{txt:"—",tone:"none"};
  const ago=-d;
  const tone=ago<=0?"fresh":(ago>=alert?"over":(ago>=warn?"warn":"ok"));
  // 経過表記の統一ルール：当日→「今日」／7日未満→「◯日前」／
  // 7日以上〜1か月(30日)未満→「◯週間前」／1か月以上→「約◯か月前」。
  // Math.max(1,…) で「0か月前」「0週間前」などの0始まり表記を必ず防ぐ。
  let txt;
  if(ago<=0)txt="今日";
  else if(ago<7)txt=`${ago}日前`;
  else if(ago<30)txt=`${Math.max(1,Math.floor(ago/7))}週間前`;
  else txt=`約${Math.max(1,Math.floor(ago/30))}か月前`;
  return{txt,tone};
}
// からだの記録（体重・身長・体調）
const HEALTH_CONDS=[{key:"good",label:"元気",emoji:"😊"},{key:"ok",label:"ふつう",emoji:"😐"},{key:"bad",label:"元気ない",emoji:"😟"}];
const condMeta=(k)=>HEALTH_CONDS.find(c=>c.key===k)||null;
// 登録ユーザーごとの色（色定義はここ1箇所）。フィルターチップ・カレンダーのドット・
// メンバーバー等はすべて colorOf() 経由でこの配列を参照する。登録順で自動割り当て、
// 設定でユーザーが個別に選ぶことも可能。
const MEMBER_COLORS=["#E39A5C","#B23A48","#557E63","#D9A441","#5B7A9E","#C77A2E","#8A6D9E","#3E8E8E","#7A8B4F","#8A8178"];
// 今日のようす（日記）の選択肢。元気は5段階（推移グラフ用に score を持つ。旧3段階キーも内包）
const DIARY_ENERGY=[{key:"great",label:"とても元気",emoji:"😄",score:5},{key:"genki",label:"元気",emoji:"😊",score:4},{key:"normal",label:"ふつう",emoji:"🙂",score:3},{key:"low",label:"低め",emoji:"😕",score:2},{key:"bad",label:"ぐったり",emoji:"😣",score:1}];
const DIARY_APPETITE=[{key:"lots",label:"もりもり",emoji:"🍽️",score:3},{key:"normal",label:"ふつう",emoji:"🍚",score:2},{key:"little",label:"すくなめ",emoji:"🥄",score:1}];
const DIARY_POOP=[{key:"good",label:"good",emoji:"💩"},{key:"loose",label:"ゆるい",emoji:"💧"},{key:"none",label:"なし",emoji:"🚫"}];
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
// お散歩の目安：気温・湿度・体感・路面(地表)温度から、いま散歩に出てよいかを3段階で判定。
function walkAdvice(w){
  if(!w||w.error||typeof w.temp!=="number")return null;
  const t=w.temp,h=w.humidity,road=(typeof w.roadTemp==="number")?w.roadTemp:null,app=(typeof w.apparent==="number")?w.apparent:t;
  if((road!=null&&road>=50)||app>=35||t>=35)
    return{level:"danger",emoji:"🚫",label:"いまは控えて",msg:"熱中症・肉球やけどの危険。朝夕の涼しい時間帯に。"};
  if((road!=null&&road>=40)||app>=28||t>26||(typeof h==="number"&&h>=85))
    return{level:"warn",emoji:"⚠️",label:"注意して",msg:"地面が熱め。短めに・日陰を選び、水分を持って。"};
  if(t<=0||(road!=null&&road<=0))
    return{level:"warn",emoji:"❄️",label:"寒さ注意",msg:"路面凍結や冷えに注意。防寒して短めに。"};
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
  // 雨・雪・雷・霧
  let wx=0,wxl="雨",wxi="cloudrain";
  if([51,53,55,56,57].includes(code)){wx=22;wxl="霧雨";wxi="cloudrain";}
  else if([61,63,65,66,67,80,81,82].includes(code)){wx=45;wxl="雨";wxi="cloudrain";}
  else if([71,73,75,77,85,86].includes(code)){wx=42;wxl="雪";wxi="snow";}
  else if([95,96,99].includes(code)){wx=70;wxl="雷雨";wxi="cloudrain";}
  else if([45,48].includes(code)){wx=14;wxl="霧";wxi="cloudrain";}
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
// 1時間ぶんの散歩レベル判定（体感温度ベース。雨・雷・寒さも考慮）。good/caution/avoid。
function walkHourLevel(hr){
  if(!hr)return"good";
  const t=typeof hr.app==="number"?hr.app:hr.temp;
  const pop=hr.pop,code=hr.code;
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
  fever:{label:"熱",emoji:"🌡️"},cough:{label:"咳",emoji:"😮‍💨"},sneeze:{label:"くしゃみ",emoji:"🤧"},nose:{label:"鼻水",emoji:"💧"},throat:{label:"喉の痛み",emoji:"😷"},headache:{label:"頭痛",emoji:"🤕"},fatigue:{label:"だるさ",emoji:"🥱"},diarrhea:{label:"下痢",emoji:"🚽"},vomit:{label:"嘔吐",emoji:"🤮"},noappetite:{label:"食欲不振",emoji:"🥄"},itch:{label:"かゆがる",emoji:"🐾"},rash:{label:"発疹",emoji:"🔴"},mood:{label:"機嫌がわるい",emoji:"😤"},period:{label:"生理",emoji:"🩸",sensitive:true},limp:{label:"元気がない",emoji:"😣"}
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
  adult:{rows:["energy","hospital"],symptoms:["headache","fever","cough","nose","throat","fatigue","period"]},
  child:{rows:["energy","appetite","sleep","hospital"],symptoms:["fever","cough","nose","vomit","diarrhea","rash","mood"]},
  senior:{rows:["energy","appetite","sleep","hospital"],symptoms:["headache","fever","cough","fatigue","nose","throat"]},
};
const diaryConfigFor=(t)=>DIARY_CONFIG[t]||DIARY_CONFIG.adult;
// 家族台帳（人）：性別・血液型の選択肢。
const GENDER_OPTS=[{k:"boy",l:"男の子"},{k:"girl",l:"女の子"},{k:"other",l:"その他"}];
const BLOOD_OPTS=["A","B","O","AB"];
const genderLabel=(k)=>(GENDER_OPTS.find(o=>o.k===k)||{}).l||"";
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
  body:["歯が生えた","トイレでできた","ひとりで着替えできた","くつが履けた"],
  can:["スプーンで食べられた","自転車に乗れた","泳げた","ボタンがとめられた"],
  learn:["ひらがなが読めた","数を数えられた","自分の名前が書けた","時計が読めた"],
};
// 大切な情報カード（緊急連絡先・アレルギー/禁忌・病院メモなど）
const CARD_PRESETS=[{key:"emergency",label:"緊急連絡先",emoji:"🚨"},{key:"allergy",label:"アレルギー・禁忌",emoji:"⚠️"},{key:"hospital",label:"かかりつけ・病院メモ",emoji:"🏥"},{key:"insurance",label:"保険証・保険情報",emoji:"🪪"},{key:"other",label:"メモ",emoji:"📝"}];
const cardMeta=(k)=>CARD_PRESETS.find(c=>c.key===k)||CARD_PRESETS[CARD_PRESETS.length-1];
// 大切な情報カードの種別 → ラインアイコン名。
const CARD_ICON={emergency:"alert",allergy:"alert",hospital:"activity",insurance:"shield",other:"note"};
const cardIcon=(k)=>CARD_ICON[k]||"note";
// 思い出の「はじめて」タグ
const FIRST_TAG="はじめて";
// 支出カテゴリー（対象によって出し分け：ペットと人で項目が変わる）
const EXPENSE_CATS_PET=[{key:"hospital",label:"病院代",emoji:"🏥",color:"#B23A48"},{key:"food",label:"ごはん・おやつ",emoji:"🍚",color:"#C77A2E"},{key:"hygiene",label:"トイレ・衛生",emoji:"🧻",color:"#557E63"},{key:"grooming",label:"トリミング・美容",emoji:"✂️",color:"#B23A48"},{key:"goods",label:"おもちゃ・用品",emoji:"🧸",color:"#C77A2E"},{key:"insurance",label:"ペット保険",emoji:"🛡️",color:"#3B7BF6"},{key:"other",label:"その他",emoji:"📦",color:"#8A8178"}];
const EXPENSE_CATS_PERSON=[{key:"medical",label:"医療費",emoji:"🏥",color:"#B23A48"},{key:"food",label:"食費",emoji:"🍚",color:"#C77A2E"},{key:"education",label:"学費・習い事",emoji:"🎒",color:"#3B7BF6"},{key:"clothing",label:"衣類",emoji:"👕",color:"#B23A48"},{key:"daily",label:"日用品",emoji:"🧴",color:"#557E63"},{key:"transport",label:"交通費",emoji:"🚃",color:"#557E63"},{key:"leisure",label:"レジャー・娯楽",emoji:"🎟️",color:"#C77A2E"},{key:"other",label:"その他",emoji:"📦",color:"#8A8178"}];
const expenseCatsFor=(kind)=>kind==="pet"?EXPENSE_CATS_PET:EXPENSE_CATS_PERSON;
const ALL_EXPENSE_CATS=[...EXPENSE_CATS_PET,...EXPENSE_CATS_PERSON.filter(p=>!EXPENSE_CATS_PET.some(q=>q.key===p.key))];
const expCatMeta=(k)=>ALL_EXPENSE_CATS.find(c=>c.key===k)||ALL_EXPENSE_CATS[ALL_EXPENSE_CATS.length-1];
const fmtYen=(n)=>"¥"+Math.round(n||0).toLocaleString("ja-JP");

const EMOJI_RULES=[[["目","眼","メガネ","視力","コンタクト"],"👁️"],[["マラソン","ラン","走","ジョギング","駅伝"],"🏃"],[["ジム","筋トレ","トレーニング","クロスフィット","crossfit","筋"],"🏋️"],[["自転車","サイクリング","ロングライド","ライド","ロード"],"🚴"],[["泳","スイミング","プール","水泳"],"🏊"],[["ヨガ","ストレッチ","瞑想"],"🧘"],[["ピアノ","ジャズ","鍵盤","セッション"],"🎹"],[["ギター","楽器","音楽","バンド"],"🎸"],[["ライブ","コンサート","歌","カラオケ"],"🎤"],[["映画","シネマ"],"🎬"],[["本","読書","読む"],"📚"],[["試験","資格","勉強","検定","TOEIC","G検定","学習"],"🎓"],[["面接","転職","仕事","キャリア","案件","副業"],"💼"],[["会議","打ち合わせ","打合せ","MTG","ミーティング","商談"],"📊"],[["飲み","飲み会","会食","宴会","パーティ","ランチ会","歓迎会","送別会","二次会"],"🍻"],[["旅","旅行","海外","訪ね","観光","ステイ"],"✈️"],[["海","ビーチ","南国"],"🏖️"],[["山","登山","富士","ハイキング","トレッキング"],"⛰️"],[["語","スペイン語","英語","中国語","会話"],"🗣️"],[["写真","カメラ","撮"],"📷"],[["料理","ごはん","ご飯","レストラン","食","クッキング"],"🍳"],[["コーヒー","カフェ","珈琲"],"☕"],[["貯金","お金","投資","iDeCo","ふるさと納税","資産","NISA"],"💰"],[["病院","通院","受診","健診","健康診断","診察"],"🏥"],[["ワクチン","予防接種","注射","接種"],"💉"],[["フィラリア","蚊","ノミ","ダニ"],"🦟"],[["狂犬病"],"🐕"],[["歯","歯科","デンタル"],"🦷"],[["美容","トリミング","カット","ヘア","サロン"],"✂️"],[["散歩","お散歩","ウォーキング"],"🦮"],[["習い事","レッスン","塾","スクール"],"🎒"],[["誕生","記念","バースデー"],"🎂"],[["結婚","プロポーズ","婚"],"💍"],[["掃除","片付","そうじ"],"🧹"],[["引っ越","引越","移住"],"📦"],[["占い","星","運勢"],"✨"]];
const PICKER_EMOJIS=["✨","🌈","💪","🏃","🚴","🏋️","🧘","🎹","🎸","🎤","🎬","📚","🎓","💼","✈️","🏖️","⛰️","📷","🍳","☕","💰","🏥","💉","🦷","✂️","🦮","🐶","🐱","🎂","💍","🧸","🧹","📦","🗣️","👁️","🦟","❤️","⭐","🎯","🌷"];
function guessEmoji(title,fallback){const t=(title||"").toLowerCase();for(const[keys,emo]of EMOJI_RULES){if(keys.some(k=>t.includes(k.toLowerCase())))return emo;}return fallback;}
// タイトル文字列 → ラインアイコン名。お世話ログ・ストック・ルーティン等の自由入力項目を
// 絵文字に頼らずアイコン表示するための推定表（データは温存、表示のみ）。
const ICON_RULES=[
  [["散歩","おさんぽ","お散歩","ウォーキング","さんぽ"],"paw"],
  [["ごはん","ご飯","フード","餌","えさ","おやつ","食事","ミルク","ふりかけ"],"utensils"],
  [["水","お水","飲水","給水"],"droplet"],
  [["トイレ","うんち","おしっこ"],"droplet"],
  [["掃除","そうじ","片付","かたづけ","ゴミ","ごみ"],"sparkles"],
  [["洗濯","洗剤","せんたく"],"droplet"],
  [["シャンプー","お風呂","風呂","入浴","バス","沐浴"],"droplet"],
  [["ブラッシング","ブラシ","毛づくろい","コーミング"],"paw"],
  [["爪","つめ","カット","トリミング","美容","サロン","ヘア","髪"],"scissors"],
  [["歯","はみがき","歯みがき","歯磨き","デンタル"],"tooth"],
  [["耳","目薬","点眼"],"paw"],
  [["薬","くすり","サプリ","投薬","服薬"],"pill"],
  [["ワクチン","予防接種","注射","接種"],"syringe"],
  [["フィラリア","蚊","ノミ","ダニ","駆虫"],"bug"],
  [["病院","通院","受診","健診","健康診断","診察","動物病院"],"stethoscope"],
  [["換気","窓"],"wind"],
  [["ストレッチ","ヨガ","瞑想","運動","ジム","筋トレ","ラン","走","散歩以外"],"activity"],
  [["コーヒー","カフェ","珈琲","お茶","ティー"],"coffee"],
  [["夜","寝る","就寝","睡眠","おやすみ","ねんね"],"moon"],
  [["朝","起床","起きる"],"sun"],
  [["習い事","レッスン","塾","スクール","保育園","幼稚園","学校","授業","宿題","勉強"],"bag"],
  [["写真","カメラ","撮影"],"camera"],
  [["お金","貯金","支出","費用","会計"],"wallet"],
  [["フード在庫","ストック","シーツ","おむつ","ティッシュ","詰め替え","買い"],"package"],
  [["コンタクト","眼鏡","メガネ","視力"],"glasses"],
  [["予定","イベント","記念","誕生"],"calendar"],
];
function guessIcon(title,fallback="paw"){const t=(title||"").toLowerCase();for(const[keys,ic]of ICON_RULES){if(keys.some(k=>t.includes(k.toLowerCase())))return ic;}return fallback;}

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
  if(isOverdue(item)){const d=-daysUntil(item.dueDate);return{label:`🔴 未対応・${d}日超過`,tone:"todo"};}
  if(item.dueDate){const d=daysUntil(item.dueDate);if(d<0)return{label:`予定日 ${fmtDate(item.dueDate)}`,tone:"planned"};return{label:d===0?"🟡 今日やる":`🟡 予定・あと${d}日`,tone:"planned"};}
  return{label:"🟡 予定済み",tone:"planned"};
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
// CSV 1セルのエスケープ（カンマ・改行・引用符を含む場合は "" で囲む）。
const csvCell=(v)=>{const s=v==null?"":String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};

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
  coffee:'<path d="M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v2M10 2v2M14 2v2"/>',
  trash:'<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/>',
  chevron:'<path d="M9 6l6 6-6 6"/>',
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  tag:'<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.8 12V4a1.2 1.2 0 0 1 1.2-1.2h8a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.8z"/><path d="M7 7h.01"/>',
};
const TYPE_ICON={work:"briefcase",event:"calendar",social:"users",habit:"repeat",dream:"sparkles"};
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
    <select className="yl-bsel" value={m} onChange={onMonth}><option value="">月</option>{BMONTHS.map(mm=><option key={mm} value={mm}>{mm}月</option>)}</select>
    <select className="yl-bsel" value={d} onChange={onDay}><option value="">日</option>{Array.from({length:dimOf(m)},(_,i)=>i+1).map(dd=><option key={dd} value={dd}>{dd}日</option>)}</select>
    <input className="yl-byear" type="text" inputMode="numeric" maxLength={4} placeholder="年（任意）" value={y} onChange={onYear}/>
  </span>);
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
  const[draftTime,setDraftTime]=useState("");
  const[draftRepeat,setDraftRepeat]=useState("none");
  const[draftReminders,setDraftReminders]=useState([]);
  const[draftAuto,setDraftAuto]=useState(false);
  const[adding,setAdding]=useState(false);
  const[newKind,setNewKind]=useState("pet");
  const[newSpecies,setNewSpecies]=useState("dog");
  const[newName,setNewName]=useState("");
  const[newEmoji,setNewEmoji]=useState("🐶");
  const[newBirthday,setNewBirthday]=useState("");
  const[newVisibility,setNewVisibility]=useState("household");
  const[editingId,setEditingId]=useState(null);
  const[editName,setEditName]=useState("");
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
  const[vetDays,setVetDays]=useState(30); // サマリーの対象期間（日）
  const[a2hsHint,setA2hsHint]=useState(false); // 「ホーム画面に追加」データ保護の案内（1回だけ）
  const[confirmAct,setConfirmAct]=useState(null); // 汎用「本当に削除しますか？」 {label,fn}
  const askDelete=(label,fn)=>setConfirmAct({label,fn});
  const[memberSel,setMemberSel]=useState("me"); // メンバーモードで選択中の人
  const[friendBdayName,setFriendBdayName]=useState(""); // 友達の誕生日・記念日（わくわく）
  const[healthW,setHealthW]=useState("");const[healthH,setHealthH]=useState("");const[healthCond,setHealthCond]=useState(""); // からだの記録の入力
  const[healthBpS,setHealthBpS]=useState("");const[healthBpD,setHealthBpD]=useState("");const[healthTemp,setHealthTemp]=useState("");const[healthGlucose,setHealthGlucose]=useState(""); // 高齢者バイタル（血圧上/下・体温・血糖値）
  const[feedUnit,setFeedUnit]=useState("serving");const[feedAmt,setFeedAmt]=useState("");const[feedMult,setFeedMult]=useState(1);const[feedServing,setFeedServing]=useState(""); // ごはん記録（回/g/ml/粒・1回分基準g・倍率）
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
  const[onboarding,setOnboarding]=useState(false);
  const[obStep,setObStep]=useState(0);
  const[obWish,setObWish]=useState("");
  const[obKind,setObKind]=useState(null);
  const[obSpecies,setObSpecies]=useState("dog");
  const[obName,setObName]=useState("");
  const[obEmoji,setObEmoji]=useState("🐶");
  const[obBirthday,setObBirthday]=useState("");
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
  const[memListOpen,setMemListOpen]=useState(false); // メンバー切替のドロップアップ一覧の開閉
  // 支出入力（記録は常に今日の日付で即記録。日付変更は編集画面のみ＝例外用途）
  const[expAmount,setExpAmount]=useState("");
  const[expCat,setExpCat]=useState("hospital");
  const[expNote,setExpNote]=useState("");
  const[expScope,setExpScope]=useState("this"); // this=このコ / all=みんな（全体）
  const[expEdit,setExpEdit]=useState(null); // {id,amount,category,note,date}
  // 使い方・機能紹介ページ
  const[helpOpen,setHelpOpen]=useState(false);
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
  const[personSeg,setPersonSeg]=useState("record");
  // 大項目（セクション）の並び順（タブごと）。UI設定なので別キーに保存し本体データから分離。
  const[secOrder,setSecOrder]=useState(()=>{const DEF={record:["certs","toilet","health","diary","vet","album"],manage:["routine","chore","list","prep","supply","expense","belong","cards"]};try{const s=JSON.parse(localStorage.getItem("loalife-secorder"));if(s&&typeof s==="object"){const merged={...DEF,...s};for(const seg of Object.keys(DEF)){const cur=Array.isArray(merged[seg])?[...merged[seg]]:[];DEF[seg].forEach(k=>{if(!cur.includes(k))cur.push(k);});merged[seg]=cur;}return merged;}}catch(e){}return DEF;});
  // 天気（登録地域の気温・湿度／熱中症注意）。位置は端末ローカルに保存。データ元＝Open-Meteo（APIキー不要）。
  const[weatherLoc,setWeatherLoc]=useState(()=>{try{return JSON.parse(localStorage.getItem("loalife-weatherloc"))||null;}catch(e){return null;}});
  const[weather,setWeather]=useState(null); // {temp,humidity,time}|{error:true}
  const[weatherLoading,setWeatherLoading]=useState(false);
  const[wxQuery,setWxQuery]=useState("");
  const[wxResults,setWxResults]=useState(null); // null=未検索, []=該当なし
  const[wxSearching,setWxSearching]=useState(false);
  const[walkOpen,setWalkOpen]=useState(false); // お散歩指数の内訳の開閉
  const[wxDetail,setWxDetail]=useState(false); // 天気カードの詳細の開閉（初期は要点だけ）
  const[toxicOpen,setToxicOpen]=useState(false); // 誤食・中毒の危険物リスト
  const[toxicSp,setToxicSp]=useState("all"); // dog/cat/all
  const[toxicQ,setToxicQ]=useState("");
  const[emergencyOpen,setEmergencyOpen]=useState(false); // 夜間・救急の備え
  const[tipsOpen,setTipsOpen]=useState(false); // 電話でうまく伝えるコツの開閉
  const[menuOpen,setMenuOpen]=useState(false); // まとめメニュー（右からのドロワー）
  const[authTab,setAuthTab]=useState("google"); // 家族共有のサインイン方式：google/email
  const[authEmail,setAuthEmail]=useState("");
  const[authPw,setAuthPw]=useState("");
  const[authIsSignup,setAuthIsSignup]=useState(false);
  // ＋入力ハブ（全入力を1か所に集約）。hubOpen=チューザー、inputSheet=開いている入力フォーム
  const[hubOpen,setHubOpen]=useState(false);
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
      const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,cloud_cover,weather_code,wind_speed_10m,uv_index&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,uv_index,soil_temperature_0cm&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max&wind_speed_unit=ms&forecast_days=1&timezone=auto`);
      if(!r.ok)throw new Error("bad");
      const j=await r.json();const c=j.current||{};const d=j.daily||{};const H=j.hourly||{};
      // 路面（地表）温度：Open-Meteo の地表温度(0cm)を現在の時刻で取得。無ければ日射モデルで推定。
      let road=null,roadEstimated=false;
      const ht=H.time,hs=H.soil_temperature_0cm;
      if(Array.isArray(ht)&&Array.isArray(hs)&&c.time){const idx=ht.findIndex(t=>t.slice(0,13)===c.time.slice(0,13));if(idx>=0&&typeof hs[idx]==="number")road=hs[idx];}
      if(road==null&&typeof c.temperature_2m==="number"){const isDay=c.is_day===1;const cloud=typeof c.cloud_cover==="number"?c.cloud_cover:50;const delta=!isDay?2:(cloud<30?25:cloud<70?15:8);road=c.temperature_2m+delta;roadEstimated=true;}
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
      setWeather({temp:c.temperature_2m,humidity:c.relative_humidity_2m,apparent:c.apparent_temperature,isDay:c.is_day===1,cloud:c.cloud_cover,wind:c.wind_speed_10m,uv,roadTemp:road==null?null:Math.round(road*10)/10,roadEstimated,hi,lo,code,hours,time:c.time,fetchedAt:Date.now()});
    }catch(e){setWeather({error:true});}
    setWeatherLoading(false);
  },[]);
  useEffect(()=>{if(weatherLoc)fetchWeather(weatherLoc);},[weatherLoc,fetchWeather]);
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
  const pickPlace=(res)=>{const nm=res.name+(res.admin1&&res.admin1!==res.name?`・${res.admin1}`:"");const loc={name:nm,lat:res.latitude,lon:res.longitude};setWeatherLoc(loc);try{localStorage.setItem("loalife-weatherloc",JSON.stringify(loc));}catch(e){}setWxResults(null);setWxQuery("");};
  const clearWeatherLoc=()=>{setWeatherLoc(null);setWeather(null);try{localStorage.removeItem("loalife-weatherloc");}catch(e){}};

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
    if(file.size>20*1024*1024){showFlash("ファイルが大きすぎます（20MB以下）");return;}
    try{
      const dataUrl=await downscaleImage(file,400,0.8);
      const pid="meav"+Date.now();
      const ok=await photoStorage.set(`photo:${pid}`,dataUrl);
      if(!ok){showFlash("ストレージ容量が不足しています");return;}
      setPhotos(p=>({...p,[pid]:dataUrl}));
      if(meAvatar){try{photoStorage.delete(`photo:${meAvatar}`);}catch(er){}}
      persistMeAvatar(pid);
      showFlash("アイコンを設定しました");
    }catch(err){showFlash("画像を読み込めませんでした");}
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
    const nm=[];const ni=[];
    if(obWish.trim())ni.push({id:"x"+Date.now(),space:"me",type:"dream",title:obWish.trim(),emoji:guessEmoji(obWish.trim(),"🌈"),repeat:"none",done:false,createdAt:Date.now()});
    if(obKind&&obName.trim()){const m={id:"f"+Date.now(),name:obName.trim(),emoji:obEmoji,kind:obKind,birthday:obBirthday||"",visibility:"household"};if(obKind==="pet")m.species=obSpecies;nm.push(m);}
    persist(nm,ni);setOnboarding(false);setObStep(0);setTab("home");
  };

  const resetApp=()=>{try{storage.delete(STORAGE_KEY).catch(()=>{});}catch(e){}setMembers([]);setItems([]);setPhotos({});setConfirmDel(null);setObStep(0);setObWish("");setObKind(null);setObSpecies("dog");setObName("");setObEmoji("🐶");setObBirthday("");setMeEmoji("🙂");setMeBirthday("");setMeColor("");setMeName("");setMeAvatar("");setHousehold(null);setFireUser(null);setOnboarding(true);setTab("home");};

  const handleNotifRequest=async()=>{const p=await requestNotifPermission();setNotifPerm(p);if(p==="granted")showFlash("通知を許可しました 🔔");};

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
  // ルーティン/ストックは「わたし」タブでも使える。space=tab、kind は me/person/pet。
  const isPersonalTab=tab!=="home";          // わたし＋各メンバー（ホーム以外）
  const curKind=activeMember?activeMember.kind:"me";
  // 今日のようすの種別：自分=大人／ペット=pet／人=personType(既定child)。生理は大人のみに出す安全側。
  const diaryTypeOf=(space)=>{if(space==="me")return"adult";const m=members.find(x=>x.id===space);if(!m)return"adult";if(m.kind==="pet")return"pet";return m.personType||"child";};
  const nameOf=(spaceId)=>spaceId==="me"?(meName||"わたし"):(members.find(m=>m.id===spaceId)||{}).name||"";

  useEffect(()=>{setFilter("all");if(activeMember){const list=careKindsFor(activeMember);const kind=list.find(k=>k.key===draftKind)?draftKind:list[0].key;if(kind!==draftKind)setDraftKind(kind);const label=(list.find(k=>k.key===kind)||{}).label||"";if(kind!=="other"&&(draft===""||draftAuto)){setDraft(label);setDraftAuto(true);}else if(kind==="other"&&draftAuto){setDraft("");setDraftAuto(false);}}else if(draftAuto){setDraft("");setDraftAuto(false);}},[tab]);

  const toggle=(id)=>{
    const it=items.find(x=>x.id===id);if(!it)return;let next;
    const cyc=effRepeat(it); // ケア種別の既定周期も含めて判定
    if(!it.done&&cyc!=="none"){
      // 記録＝前回を今日に更新し、次回を周期ぶん先へ自動セット（赤が消えて静かに次へ）
      const today=iso(new Date());const newDue=addInterval(today,cyc);
      next=items.map(x=>x.id===id?{...x,dueDate:newDue,lastDone:today,repeat:x.repeat&&x.repeat!=="none"?x.repeat:cyc,done:false}:x);
      showFlash(`✓ 記録しました。次は ${fmtDate(newDue)} ごろ 🗓`);
    }
    else{next=items.map(x=>x.id===id?{...x,done:!x.done,completedAt:!x.done?Date.now():null}:x);}
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
    if(file.size>20*1024*1024){showFlash("ファイルが大きすぎます（20MB以下）");return;}
    try{
      const dataUrl=await downscaleImage(file);
      const ok=await photoStorage.set(`photo:${id}`,dataUrl);
      if(!ok){showFlash("ストレージ容量が不足しています");return;}
      setPhotos(p=>({...p,[id]:dataUrl}));
      const next=items.map(x=>x.id===id?{...x,photo:true}:x);
      persist(members,next);saveItemToFs(next.find(x=>x.id===id)).catch(()=>{});
      showFlash(okMsg);
    }catch(err){showFlash("保存できませんでした。別の画像でお試しください");}
  };

  const viewPhoto=async(id)=>{if(photos[id]){setViewer({id,src:photos[id]});return;}setViewer({id,loading:true});try{const src=await photoStorage.get(`photo:${id}`);setViewer({id,src});}catch(e){setViewer({id,src:null});}};
  const removePhoto=(id)=>{try{photoStorage.delete(`photo:${id}`);}catch(e){}setPhotos(p=>{const n={...p};delete n[id];return n;});persist(members,items.map(x=>x.id===id?{...x,photo:false}:x));setViewer(null);showFlash("証明書を削除しました");};

  // --- 思い出（記録を思い出に変える）---
  // 既存アクション（散歩などのルーティン）から写真1枚で思い出を残す。入力は写真選択だけ。
  // type:"memory" の追記型ログ（上書きしない）。写真は IndexedDB(photo:<id>) に保存。
  const addMemory=async(e,{space,title,emoji})=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash("ファイルが大きすぎます（20MB以下）");return;}
    try{
      const dataUrl=await downscaleImage(file);
      const id="mem"+Date.now();
      const ok=await photoStorage.set(`photo:${id}`,dataUrl);
      if(!ok){showFlash("ストレージ容量が不足しています");return;}
      setPhotos(p=>({...p,[id]:dataUrl}));
      const mem={id,space,type:"memory",date:todayIso,title:title||"思い出",emoji:emoji||"📸",photo:true,createdAt:Date.now()};
      persist(members,[...items,mem]);
      saveItemToFs(mem).catch(()=>{});
      showFlash("思い出に残しました 📸");
    }catch(err){showFlash("保存できませんでした。別の画像でお試しください");}
  };
  const viewMemory=async(id)=>{
    const cached=photos[id];
    if(cached){setViewer({id,src:cached,isMemory:true});return;}
    setViewer({id,loading:true,isMemory:true});
    try{const src=await photoStorage.get(`photo:${id}`);setViewer({id,src,isMemory:true});}catch(e){setViewer({id,src:null,isMemory:true});}
  };
  const removeMemory=(id)=>{try{photoStorage.delete(`photo:${id}`);}catch(e){}setPhotos(p=>{const n={...p};delete n[id];return n;});deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));setViewer(null);showFlash("思い出を削除しました");};

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
      if(file.size>20*1024*1024){showFlash("ファイルが大きすぎます（20MB以下）");continue;}
      try{const dataUrl=await downscaleImage(file);const pid="p"+Date.now()+Math.random().toString(36).slice(2,6);setLifeDraft(p=>p?{...p,photos:[...p.photos,{id:pid,dataUrl,isNew:true}]}:p);}
      catch(er){showFlash("画像を読み込めませんでした");}
    }
  };
  const removeLifePhoto=(pid)=>setLifeDraft(p=>p?{...p,photos:p.photos.filter(x=>x.id!==pid)}:p);
  const toggleLifeReminder=(mins)=>setLifeDraft(p=>p?{...p,reminders:p.reminders.includes(mins)?p.reminders.filter(m=>m!==mins):[...p.reminders,mins].sort((a,b)=>a-b)}:p);
  const saveLife=async()=>{
    if(!lifeDraft)return;
    const d=lifeDraft;const title=(d.title||"").trim(),note=(d.note||"").trim();const ph=d.photos||[];const hasPhoto=ph.length>0;
    if(d.category==="event"&&!title){showFlash("タイトルを入力してください");return;}
    if(d.category==="memory"&&!title&&!note&&!hasPhoto){showFlash("写真・ひとこと・日記のどれかを入れてください");return;}
    const id=d.id||((d.category==="memory"?"mem":"x")+Date.now());
    // 新規写真をIDBへ保存
    for(const p of ph){if(p.isNew&&p.dataUrl){const ok=await photoStorage.set(`photo:${p.id}`,p.dataUrl);if(!ok){showFlash("ストレージ容量が不足しています");return;}setPhotos(prev=>({...prev,[p.id]:p.dataUrl}));}}
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
    setLifeDraft(null);showFlash("記録しました ✓");
  };
  const removeLife=(id)=>{const it=items.find(x=>x.id===id);if(it)photoIdsOf(it).forEach(pid=>{try{photoStorage.delete(`photo:${pid}`);}catch(e){}});deleteItemFromFs(it).catch(()=>{});persist(members,items.filter(x=>x.id!==id));setLifeDraft(null);showFlash("削除しました");};
  const snooze=(id)=>{const next=items.map(x=>x.id===id?{...x,dueDate:plusDays(1)}:x);persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});showFlash("明日へ送りました");};
  const setEmoji=(id,emo)=>{const next=items.map(x=>x.id===id?{...x,emoji:emo}:x);persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});setPickerId(null);};
  const openEdit=(it)=>{setEditItemId(it.id);setETitle(it.title);setEDate(it.dueDate||"");setETime(it.time||"");setERepeat(it.repeat||"none");setEReminders(it.reminders||[]);};
  const saveEdit=()=>{const next=items.map(x=>x.id===editItemId?{...x,title:eTitle.trim()||x.title,dueDate:eDate||undefined,time:eTime||undefined,repeat:eRepeat,reminders:eReminders.length?eReminders:undefined}:x);persist(members,next);const it=next.find(x=>x.id===editItemId);if(it)saveItemToFs(it).catch(()=>{});setEditItemId(null);};
  const toggleEReminder=(mins)=>setEReminders(prev=>prev.includes(mins)?prev.filter(m=>m!==mins):[...prev,mins].sort((a,b)=>a-b));
  const toggleReminder=(mins)=>setDraftReminders(prev=>prev.includes(mins)?prev.filter(m=>m!==mins):[...prev,mins].sort((a,b)=>a-b));
  const pickCareKind=(k)=>{setDraftKind(k.key);if(k.key==="other"){if(draftAuto){setDraft("");setDraftAuto(false);}return;}if(draft===""||draftAuto){setDraft(k.label);setDraftAuto(true);}};

  const addItem=()=>{
    let title=draft.trim();let careMeta=null;
    if(isMemberTab){careMeta=careKindsFor(activeMember).find(x=>x.key===draftKind);if(!title&&draftKind!=="other")title=(careMeta||{}).label||"";}
    if(!title)return;
    let base={id:"x"+Date.now(),space:tab,title,done:false,createdAt:Date.now(),dueDate:draftDate||undefined,time:draftTime||undefined,repeat:draftRepeat,reminders:draftReminders.length?draftReminders:undefined};
    if(isMemberTab){base={...base,type:"care",careKind:draftKind,emoji:guessEmoji(title,careMeta.emoji)};}
    else{base={...base,type:draftType,emoji:guessEmoji(title,TYPE_META[draftType].emoji)};}
    const uKey=tab+" "+title;
    persist(members,[...items,base],{...usage,[uKey]:(usage[uKey]||0)+1});
    saveItemToFs(base).catch(()=>{});
    setDraftDate("");setDraftTime("");setDraftRepeat("none");setDraftReminders([]);
    if(isMemberTab&&careMeta&&draftKind!=="other"){setDraft(careMeta.label);setDraftAuto(true);}else{setDraft("");setDraftAuto(false);}
  };

  const addMember=()=>{
    const name=newName.trim();if(!name){showFlash("名前を入力してください");return;}
    const id="f"+Date.now();
    // 登録時に固定色を自動割り当て（既に使われている色を避けて MEMBER_COLORS から選ぶ）
    const used=new Set([meColor||MEMBER_COLORS[0],...members.map(m=>m.color).filter(Boolean)]);
    const color=MEMBER_COLORS.find(c=>!used.has(c))||MEMBER_COLORS[(members.length+1)%MEMBER_COLORS.length];
    const member={id,name,emoji:newEmoji,kind:newKind,birthday:newBirthday||"",visibility:newVisibility,color};
    if(newKind==="pet")member.species=newSpecies;
    persist([...members,member],items);
    saveMemberToFs(member).catch(()=>{});
    setNewName("");setNewBirthday("");setNewVisibility("household");setAdding(false);setTab(id);setMemberSel(id);
  };

  const removeMember=(id)=>{
    const m=members.find(x=>x.id===id);
    persist(members.filter(x=>x.id!==id),items.filter(x=>x.space!==id));
    deleteMemberFromFs(id).catch(()=>{});
    setTab("me");setMemberSel("me");setConfirmDel(null);
    if(m)showFlash(`${m.name} を削除しました`);
  };

  const saveRename=(id)=>{
    const name=editName.trim();if(!name)return;
    const next=members.map(m=>m.id===id?{...m,name,birthday:editBirthday,gotchaDay:editGotcha||"",group:editGroup.trim()||"",microchip:editMicrochip.trim()||"",breed:editBreed.trim()||"",coat:editCoat.trim()||"",neuter:editNeuter||"",memorial:(m.kind==="pet"?(editMemorial||""):""),avatar:editAvatar||"",visibility:editVisibility,...(m.kind==="person"?{personType:editPersonType,gender:editGender||"",blood:editBlood||""}:{})}:m);
    persist(next,items);
    const updated=next.find(m=>m.id===id);
    if(updated)saveMemberToFs(updated).catch(()=>{});
    setEditingId(null);
  };
  // 写真アイコンを選ぶ（編集フォーム内）。IDBに保存して editAvatar にセット
  const pickAvatar=async(e)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash("ファイルが大きすぎます（20MB以下）");return;}
    try{const dataUrl=await downscaleImage(file,400,0.8);const pid="av"+Date.now();const ok=await photoStorage.set(`photo:${pid}`,dataUrl);if(!ok){showFlash("ストレージ容量が不足しています");return;}setPhotos(p=>({...p,[pid]:dataUrl}));setEditAvatar(pid);}
    catch(er){showFlash("画像を読み込めませんでした");}
  };
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
    const saved=next.find(x=>x.id===savedId);
    if(saved)saveItemToFs(saved).catch(()=>{});
    setRoutineEdit(null);showFlash("ルーティンを保存しました 🗓");
  };
  const toggleRoutine=(id)=>{
    const r=items.find(x=>x.id===id);if(!r)return;
    const done=r.doneDate===todayIso;
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
    setSupplyEdit(null);showFlash("ストックを保存しました 📦");
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
    if(w==null&&h==null&&!healthCond&&!hasVital){showFlash("体重などを入力してください");return;}
    if(w!=null&&(isNaN(w)||w<=0)){showFlash("体重は数字で入力してください");return;}
    if(h!=null&&(isNaN(h)||h<=0)){showFlash("身長は数字で入力してください");return;}
    const rec={id:"hl"+Date.now(),space:tab,type:"health",date:todayIso,createdAt:Date.now()};
    if(w!=null){rec.weight=w;rec.wunit=weightUnit;}if(h!=null)rec.height=h;if(healthCond)rec.condition=healthCond;
    if(bpS!=null)rec.bpSys=bpS;if(bpD!=null)rec.bpDia=bpD;if(temp!=null)rec.temp=temp;if(glu!=null)rec.glucose=glu;
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    setHealthW("");setHealthH("");setHealthCond("");setHealthBpS("");setHealthBpD("");setHealthTemp("");setHealthGlucose("");
    showFlash("からだの記録を保存しました 📈");
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
      const n=Number(feedAmt);if(feedAmt.trim()===""||isNaN(n)||n<=0){showFlash("分量を入力してください");return;}
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
  // --- 今日のようす（日記）：元気・食欲・うんち・さんぽ・病院・症状・写真・ひとことを追記型で記録 ---
  const diaryRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="diary").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  // 1日=1カード：同じ日付でグルーピング（日降順、カード内は時系列昇順）。レコードは束ねるだけで消さない。
  const diaryByDate=useMemo(()=>{const map={};diaryRecords.forEach(r=>{(map[r.date]=map[r.date]||[]).push(r);});return Object.keys(map).sort((a,b)=>b.localeCompare(a)).map(date=>({date,recs:map[date].slice().sort((a,b)=>(a.createdAt||0)-(b.createdAt||0))}));},[diaryRecords]);
  // その日のカードをまるごと削除（写真も掃除）
  const removeDiaryDay=(date)=>{const del=diaryRecords.filter(r=>r.date===date);del.forEach(r=>{photoIdsOf(r).forEach(pid=>{try{photoStorage.delete(`photo:${pid}`);}catch(e){}});deleteItemFromFs(r).catch(()=>{});});persist(members,items.filter(r=>!(r.type==="diary"&&r.space===tab&&r.date===date)));};
  // 元気の推移グラフ（5段階を score 化。古い順）
  const energyPts=useMemo(()=>[...diaryRecords].reverse().filter(r=>r.energy&&diaryMeta(DIARY_ENERGY,r.energy)).map(r=>({date:r.date,value:diaryMeta(DIARY_ENERGY,r.energy).score})),[diaryRecords]);
  const setDiary=(patch)=>setDiaryDraft(d=>({...d,...patch}));
  const toggleSymptom=(k)=>setDiaryDraft(d=>({...d,symptoms:(d.symptoms||[]).includes(k)?d.symptoms.filter(s=>s!==k):[...(d.symptoms||[]),k]}));
  const pickDiaryPhoto=async(e)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash("ファイルが大きすぎます（20MB以下）");return;}
    try{const dataUrl=await downscaleImage(file);setDiaryDraft(d=>({...d,photo:dataUrl}));}catch(er){showFlash("画像を読み込めませんでした");}
  };
  const saveDiary=async()=>{
    const d=diaryDraft;const note=(d.note||"").trim();const syms=d.symptoms||[];
    if(!d.energy&&!d.appetite&&!d.poop&&!d.walk&&!d.hospital&&!d.sleep&&!note&&!syms.length&&!d.photo){showFlash("ようすを選ぶか、ひとことを書いてください");return;}
    const id="dy"+Date.now();
    const rec={id,space:tab,type:"diary",date:todayIso,createdAt:Date.now()};
    if(d.energy)rec.energy=d.energy;if(d.appetite)rec.appetite=d.appetite;if(d.poop)rec.poop=d.poop;if(d.sleep)rec.sleep=d.sleep;
    if(d.walk)rec.walk=true;if(d.hospital)rec.hospital=true;if(note)rec.note=note;if(syms.length)rec.symptoms=syms;
    if(syms.includes("period"))rec.private=true; // 生理を含む記録はセンシティブ＝本人のみ
    if(d.photo){const pid="dyp"+Date.now();const ok=await photoStorage.set(`photo:${pid}`,d.photo);if(ok){setPhotos(p=>({...p,[pid]:d.photo}));rec.photo=true;rec.photos=[pid];}}
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    setDiaryDraft({energy:"",appetite:"",poop:"",walk:false,hospital:false,sleep:"",note:"",symptoms:[],photo:null});
    showFlash("今日のようすを記録しました 📝");
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
    if(todayHasCond(sp)){showFlash("今日はもう記録ずみです 👌");return;}
    const rec={id:"dy"+Date.now(),space:sp,type:"diary",date:todayIso,energy:"genki",createdAt:Date.now()};
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    showFlash("今日も元気、記録しました 👌");
  };
  // --- 大切な情報カード（緊急連絡先・アレルギー/禁忌・病院メモ）。写真も保存可 ---
  const cards=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="card").sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)),[items,tab]);
  const openCardNew=(kind)=>{const m=cardMeta(kind);setCardEdit({space:tab,kind,title:m.label,body:"",photo:null,photoId:null});};
  const openCardEdit=async(c)=>{let photo=null;const pid=firstPhotoId(c);if(pid){photo=photos[pid]||null;if(!photo){try{photo=await photoStorage.get(`photo:${pid}`);}catch(e){}}}setCardEdit({id:c.id,space:c.space,kind:c.kind||"other",title:c.title||"",body:c.body||"",photo,photoId:pid||null});};
  const pickCardPhoto=async(e)=>{const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;if(file.size>20*1024*1024){showFlash("ファイルが大きすぎます（20MB以下）");return;}try{const dataUrl=await downscaleImage(file);setCardEdit(c=>c?{...c,photo:dataUrl,photoNew:true}:c);}catch(er){showFlash("画像を読み込めませんでした");}};
  const saveCard=async()=>{
    if(!cardEdit)return;const c=cardEdit;const title=(c.title||"").trim()||cardMeta(c.kind).label;const body=(c.body||"").trim();
    if(!body&&!c.photo){showFlash("内容か写真を入れてください");return;}
    const id=c.id||("cd"+Date.now());let photoId=c.photoId||null;
    if(c.photoNew&&c.photo){const pid="cdp"+Date.now();const ok=await photoStorage.set(`photo:${pid}`,c.photo);if(ok){setPhotos(p=>({...p,[pid]:c.photo}));photoId=pid;}}
    else if(!c.photo&&c.photoId){try{photoStorage.delete(`photo:${c.photoId}`);}catch(e){}photoId=null;}
    const rec={id,space:c.space,type:"card",kind:c.kind,title,body:body||undefined,photo:photoId?true:undefined,photos:photoId?[photoId]:undefined,createdAt:c.id?(items.find(x=>x.id===c.id)||{}).createdAt||Date.now():Date.now()};
    const next=c.id?items.map(x=>x.id===c.id?{...x,...rec}:x):[...items,rec];
    persist(members,next);saveItemToFs(rec).catch(()=>{});setCardEdit(null);showFlash("カードを保存しました 📌");
  };
  const removeCard=(id)=>{const it=items.find(x=>x.id===id);if(it)photoIdsOf(it).forEach(pid=>{try{photoStorage.delete(`photo:${pid}`);}catch(e){}});deleteItemFromFs(it).catch(()=>{});persist(members,items.filter(x=>x.id!==id));setCardEdit(null);};
  // --- 持ち物（曜日ごと）：明日の準備チェックリスト。学校の忘れ物防止 ---
  const belongings=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="belonging"),[items,tab]);
  const addBelonging=()=>{const t=belongDraft.trim();if(!t){showFlash("持ち物を入力してください");return;}const rec={id:"bl"+Date.now(),space:tab,type:"belonging",title:t,dow:belongDow,createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});setBelongDraft("");showFlash("持ち物を追加しました 🎒");};
  const removeBelonging=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // 成長記録（育児日記）：はじめて・できたこと等のマイルストーンを記録。
  const growthRecords=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="milestone").sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  const addMilestone=(cat,title)=>{const t=(title||"").trim();if(!t)return;const rec={id:"ms"+Date.now(),space:tab,type:"milestone",date:todayIso,category:cat||"first",title:t,createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});setMsDraft("");showFlash("成長記録に残しました");};
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
  const addMedCourse=()=>{const n=(medName||"").trim();if(!n){showFlash("お薬の名前を入力してください");return;}const days=Math.max(1,parseInt(medDays||"1",10));const rec={id:"md"+Date.now(),space:tab,type:"medcourse",name:n,days,startDate:todayIso,taken:[],createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});setMedName("");showFlash("お薬を登録しました");};
  const toggleMedToday=(id)=>{const next=items.map(x=>{if(x.id!==id)return x;const taken=x.taken||[];const has=taken.includes(todayIso);const nt=has?taken.filter(d=>d!==todayIso):[...taken,todayIso];return{...x,taken:nt};});persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});};
  const removeMedCourse=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // 家族ノート（メッセージ・感謝・きもち）。端末内で家族が書き込める簡易ボード。
  const familyNotes=useMemo(()=>items.filter(x=>x.type==="familynote").sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)),[items]);
  const addFamilyNote=()=>{const t=(noteText||"").trim();if(!t)return;const author=(meName||"わたし");const rec={id:"fn"+Date.now(),space:"me",type:"familynote",kind:noteKind,text:t,author,date:todayIso,createdAt:Date.now()};persist(members,[...items,rec]);setNoteText("");showFlash("ノートに残しました");};
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
    members.forEach(m=>{if(m.avatar&&!photos[m.avatar]&&!seen[m.avatar]){seen[m.avatar]=1;missing.push(m.avatar);}});
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
  // お世話ログ（トイレ掃除・シャンプー等）：やった履歴と前回からの経過
  const chores=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="chore").sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)),[items,tab]);
  const petMembers=useMemo(()=>members.filter(m=>m.kind==="pet"),[members]);
  const addChore=(title,emoji)=>{if(chores.some(c=>c.title===title))return;const rec={id:"ch"+Date.now(),space:tab,type:"chore",title,emoji:emoji||"🧹",lastDone:null,history:[],createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});};
  // お世話ログの自由追加（テンプレ以外も自分で登録）。絵文字は内容から推定。
  const addCustomChore=()=>{const t=choreDraft.trim();if(!t)return;if(chores.some(c=>c.title===t)){showFlash("同じ項目があります");setChoreDraft("");return;}addChore(t,guessEmoji(t,"🧹"));setChoreDraft("");showFlash("追加しました ✓");};
  const logChore=(id)=>{const next=items.map(x=>{if(x.id!==id)return x;const hist=[todayIso,...(x.history||[]).filter(d=>d!==todayIso)].slice(0,30);return{...x,lastDone:todayIso,history:hist};});persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});showFlash("記録しました ✓");};
  // まとめて記録：選択中の子（複数）に、日課（ご飯/お薬/散歩/トイレ）を一括でお世話ログに記録。
  const batchLog=(action,ids)=>{
    const sel=ids.filter(id=>members.some(m=>m.id===id&&m.kind==="pet"));
    if(sel.length===0){showFlash("記録する子を選んでください");return;}
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
    showFlash(`${emoji} ${title} を記録 ✓`);
  };
  const removeToilet=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
  // うんちの傾向：直近のブリストルスコアが極端（1-2硬い/6-7ゆるい）に偏っていれば受診の目安を出す。
  const poopTrend=useMemo(()=>{
    const rs=items.filter(x=>x.space===tab&&x.type==="toilet"&&x.tkind==="poop"&&x.bristol).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||0)-(a.createdAt||0)).slice(0,3);
    if(rs.length<3)return null;
    if(rs.every(r=>r.bristol>=6))return{txt:"ゆるいうんちが続いています。長引くようなら受診の目安です。",tone:"loose"};
    if(rs.every(r=>r.bristol<=2))return{txt:"硬いうんちが続いています。水分や食事、気になるときは受診を。",tone:"hard"};
    return null;
  },[items,tab]);
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
    const syms={};items.filter(x=>x.space===sp&&x.type==="diary"&&inRange(x.date)).forEach(r=>(r.symptoms||[]).forEach(s=>{syms[s]=(syms[s]||0)+1;}));
    const symList=Object.keys(syms).map(k=>({k,label:(symptomMeta(k)||{}).label||k,n:syms[k]})).sort((a,b)=>b.n-a.n);
    const careNext=items.filter(x=>x.space===sp&&x.type==="care"&&x.dueDate&&!x.done).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,8).map(x=>({title:x.title,date:x.dueDate,emoji:x.emoji||"💉"}));
    const chores=items.filter(x=>x.space===sp&&x.type==="chore"&&x.lastDone).sort((a,b)=>(b.lastDone||"").localeCompare(a.lastDone||"")).slice(0,8).map(x=>({title:x.title,date:x.lastDone,emoji:x.emoji||"🧹"}));
    return{from,to:todayIso,pee:trate("pee"),poop:trate("poop"),brAvg,brCount:br.length,wLatest,wFirst,symList,careNext,chores};
  },[items,activeMember,vetDays,todayIso]);
  // お世話ログの実施日（前回やった日）を後から修正。履歴の最新分を置き換え、最新日をlastDoneに。
  const saveChoreDate=(id,newDate)=>{
    if(!newDate){setChoreDateEdit(null);return;}
    const next=items.map(x=>{if(x.id!==id)return x;const rest=(x.history||[]).slice(1);const hist=[...new Set([newDate,...rest])].sort((a,b)=>b.localeCompare(a)).slice(0,30);return{...x,history:hist,lastDone:hist[0]||newDate};});
    persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});
    setChoreDateEdit(null);showFlash("日付を修正しました ✓");
  };
  // 全メンバーの「そろそろ/切れた」ストック（ホーム表示用）
  const lowSupplies=useMemo(()=>items.filter(x=>x.type==="supply").map(x=>({item:x,st:supplyStatus(x)})).filter(o=>o.st&&o.st.tone!=="ok"),[items]);
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

  const visible=useMemo(()=>{let arr=items.filter(x=>x.space===tab&&x.type!=="routine"&&x.type!=="supply"&&x.type!=="memory"&&x.type!=="bday"&&x.type!=="health"&&x.type!=="diary"&&x.type!=="expense"&&x.type!=="card"&&x.type!=="belonging"&&x.type!=="chore"&&x.type!=="toilet"&&x.type!=="feed");if(filter!=="all")arr=arr.filter(x=>isMemberTab?x.careKind===filter:x.type===filter);arr=[...arr].sort((a,b)=>{const ao=a.order,bo=b.order;if(ao!=null&&bo!=null&&ao!==bo)return ao-bo;if(ao!=null&&bo==null)return -1;if(ao==null&&bo!=null)return 1;if(!a.dueDate&&!b.dueDate)return b.createdAt-a.createdAt;if(!a.dueDate)return 1;if(!b.dueDate)return -1;return a.dueDate.localeCompare(b.dueDate);});return arr.sort((a,b)=>a.done===b.done?0:a.done?1:-1);},[items,tab,filter,isMemberTab]);
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
  const reorderSec=(seg,e)=>{const{active,over}=e;if(!over||active.id===over.id)return;setSecOrder(prev=>{const cur=prev[seg]||[];const oi=cur.indexOf(active.id),ni=cur.indexOf(over.id);if(oi<0||ni<0)return prev;const next={...prev,[seg]:arrayMove(cur,oi,ni)};try{localStorage.setItem("loalife-secorder",JSON.stringify(next));}catch(_){}return next;});};
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
  const filterChips=useMemo(()=>{const all={key:"all",label:"すべて"};if(isMemberTab)return[all,...careKindsFor(activeMember)];return[all,...ME_TYPES.map(t=>({key:t,label:TYPE_META[t].label}))];},[tab,isMemberTab]);
  // 絞り込みチップは中身がある時だけ出す（空なら押しても変わらず不要なので隠す。追加は右下＋）
  const hasListItems=useMemo(()=>items.some(x=>x.space===tab&&x.type!=="routine"&&x.type!=="supply"&&x.type!=="memory"&&x.type!=="bday"&&x.type!=="health"&&x.type!=="diary"&&x.type!=="expense"&&x.type!=="card"&&x.type!=="belonging"&&x.type!=="chore"&&x.type!=="toilet"&&x.type!=="feed"),[items,tab]);
  const suggestions=useMemo(()=>{const prefix=tab+" ";return Object.entries(usage).filter(([k,c])=>k.startsWith(prefix)&&c>=2).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k.slice(prefix.length));},[usage,tab]);
  // 1件分のカード中身（D&D用に <li> から分離）。並び替えボタンは廃止し長押し/ドラッグへ。
  const cardInner=(it)=>{
    let meta,label;
    if(isMemberTab){meta=KIND_STYLE[activeMember.kind];label=(careKindsFor(activeMember).find(k=>k.key===it.careKind)||{}).label||"ケア";}
    else{meta=TYPE_META[it.type]||TYPE_META.dream;label=meta.label;}
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
            {it.repeat&&it.repeat!=="none"&&<span className="yl-repeat"><Icon name="repeat" size={12}/> {REPEATS.find(r=>r.key===it.repeat)?.label}</span>}
            {it.reminders&&it.reminders.length>0&&<span className="yl-notif-badge"><Icon name="bell" size={12}/> {it.reminders.length<=2?it.reminders.map(reminderLabel).join("・"):it.reminders.length+"件"}</span>}
            {actionable&&<button className="yl-resolve" onClick={e=>{e.stopPropagation();toggle(it.id);}} title="記録すると次回予定へ自動で進みます">✓ 完了にして次回へ</button>}
            {!isCare&&!it.done&&it.dueDate&&daysUntil(it.dueDate)<=0&&<button className="yl-snooze" onClick={e=>{e.stopPropagation();snooze(it.id);}}>→ 明日へ</button>}
            {it.type==="care"&&<button className="yl-prev-copy" onClick={e=>{e.stopPropagation();openQuickCopy(it);}} title="前回と同じ内容で追加">↩ 前回コピー</button>}
            {it.dueDate&&<button className="yl-cal-item" onClick={e=>{e.stopPropagation();setCalPicker({item:it});}} title="カレンダーに追加"><Icon name="calendar" size={14}/></button>}
            {it.type==="care"&&(it.photo?<button className="yl-photo" onClick={e=>{e.stopPropagation();viewPhoto(firstPhotoId(it));}}><Icon name="camera" size={14}/> 証明書</button>:<label className="yl-photo add" onClick={e=>e.stopPropagation()}><Icon name="camera" size={14}/> 証明書を追加<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>onFilePicked(e,it.id)}/></label>)}
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
  const emojiSet=newKind==="person"?PERSON_EMOJIS:PET_EMOJIS;
  const spaces=useMemo(()=>[{id:"me",name:meName||"わたし",emoji:meEmoji,avatar:meAvatar||"",kind:"me"},...members],[members,meEmoji,meName,meAvatar]);
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
  const monthLabel=`${calCursor.y}年${calCursor.m+1}月`;
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
    live.forEach(x=>{if(x.done||!x.dueDate||bombSet.has(x.id)||x.type==="routine")return;const d=daysUntil(x.dueDate);if(d>=1&&d<=7)upcoming.push({key:x.id,emoji:x.emoji||"•",title:x.title,space:x.space,d,tag:d===1?"明日":`あと${d}日`});});
    upcoming.sort((a,b)=>a.d-b.d);
    return{bombs,todos,upcoming};
  },[items,todayIso,memorialIds]);

  // AIサマリー：今日の要点を1〜3行で。あいさつ＋やること件数＋お散歩おすすめ＋直近の締切。
  const aiSummary=useMemo(()=>{
    const hr=new Date().getHours();
    const greet=hr<4?"こんばんは":hr<11?"おはよう":hr<18?"こんにちは":"こんばんは";
    const lines=[];
    const cnt=homeData.todos.length+homeData.bombs.length;
    lines.push(cnt>0?`今日は ${cnt}件 やることがあります。`:"今日はゆっくり過ごせそうです。");
    if(hasWalker&&weather&&!weather.error&&weather.hours){
      const wt=walkTimeline(weather.hours);
      const pet=petMembers.find(m=>m.species==="dog"&&!m.memorial);
      if(wt&&wt.best&&pet)lines.push(`${pet.name}のお散歩は ${wt.best.from===wt.best.to?wt.best.from+"時ごろ":wt.best.from+"〜"+wt.best.to+"時"} がおすすめです。`);
      else if(wt&&!wt.best)lines.push("今日はお散歩を控えめにすると安心です。");
    }
    const nb=homeData.bombs[0];
    if(nb&&lines.length<3){const d=nb.d;const w=nameOf(nb.item.space);const who=w?w+"の":"";lines.push(d<0?`${who}${nb.item.title} が ${-d}日 過ぎています。`:d===0?`${who}${nb.item.title} は今日です。`:`${who}${nb.item.title} まで あと${d}日 です。`);}
    return{greet,name:meName||"",lines:lines.slice(0,3)};
  },[homeData,hasWalker,weather,petMembers,meName]);

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
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setShowShareModal(false)}>閉じる</button></div>
          </div>
        </div>
      );
    }
    if(!fireUser){
      return(
        <div className="yl-overlay" onClick={()=>setShowShareModal(false)}>
          <div className="yl-modal share" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="users" size={18}/> 家族共有</h3>
            <p className="yl-share-desc">サインインすると、家族とデータを共有できます。</p>
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
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setShowShareModal(false)}>閉じる</button></div>
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
                <p className="yl-share-desc">今のデータをFirestoreに移行して、家族スペースを作ります。</p>
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
              <button className="yl-modal-cancel" onClick={()=>setShowShareModal(false)}>閉じる</button>
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
            <button className="yl-modal-cancel" onClick={()=>setShowShareModal(false)}>閉じる</button>
            <button className="yl-modal-cancel" style={{color:"#B23A48"}} onClick={signOutUser}>サインアウト</button>
          </div>
        </div>
      </div>
    );
  };

  return(
    <div className="yl-root">
      {onboarding&&(
        <div className="yl-ob">
          {obStep===0&&<div className="yl-ob-inner"><div className="yl-ob-emoji">🏠</div><h1 className="yl-ob-title">家族の「今」が、ひと目でわかる。</h1><p className="yl-ob-sub">家族もペットも、ひとつの場所で。</p><button className="yl-ob-btn" onClick={()=>setObStep(1)}>はじめる</button><button className="yl-ob-link" onClick={loadSample}>サンプルで試してみる</button></div>}
          {obStep===1&&<div className="yl-ob-inner"><p className="yl-ob-step">1 / 2</p><h2 className="yl-ob-h2">まず、あなたの「やりたいこと」を1つ</h2><p className="yl-ob-sub">あとから追加できます</p><div className="yl-ob-chips">{["海外旅行に行く","副業・スキルアップ","毎日運動する","語学を身につける"].map(ex=><button key={ex} className="yl-ob-chip" onClick={()=>setObWish(ex)}>{ex}</button>)}</div><input className="yl-input" value={obWish} onChange={e=>setObWish(e.target.value)} onKeyDown={e=>e.key==="Enter"&&setObStep(2)} placeholder="やりたいこと…" autoFocus/><button className="yl-ob-btn" onClick={()=>setObStep(2)}>次へ</button><button className="yl-ob-link" onClick={()=>{setObWish("");setObStep(2);}}>スキップ</button></div>}
          {obStep===2&&<div className="yl-ob-inner"><p className="yl-ob-step">2 / 2</p><h2 className="yl-ob-h2">一緒に見守りたい家族はいますか？</h2>{!obKind?<div className="yl-ob-choices"><button className="yl-ob-choice" onClick={()=>{setObKind("pet");setObEmoji(PET_EMOJIS[0]);}}>🐶 ペット</button><button className="yl-ob-choice" onClick={()=>{setObKind("person");setObEmoji(PERSON_EMOJIS[0]);}}>👧 家族（人）</button><button className="yl-ob-link" onClick={finishOnboarding}>今は追加しない</button></div>:<div className="yl-ob-form">{obKind==="pet"&&<div className="yl-kindrow">{SPECIES.map(s=><button key={s.key} className={"yl-kindbtn sm"+(obSpecies===s.key?" on":"")} onClick={()=>{setObSpecies(s.key);setObEmoji(s.emoji);}}>{s.emoji} {s.label}</button>)}</div>}<div className="yl-emoji-row">{(obKind==="person"?PERSON_EMOJIS:PET_EMOJIS).map(e=><button key={e} className={"yl-emoji"+(obEmoji===e?" on":"")} onClick={()=>setObEmoji(e)}>{e}</button>)}</div><IMEInput className="yl-input" value={obName} onChange={setObName} onKeyDown={e=>e.key==="Enter"&&finishOnboarding()} placeholder={obKind==="person"?"名前（例：ゆうと）":"名前（例：ぽち）"} autoFocus/><label className="yl-opt" style={{width:"100%",marginTop:8}}>誕生日（年は任意）<BdayInput value={obBirthday} onChange={setObBirthday}/></label><button className="yl-ob-btn" onClick={finishOnboarding}>はじめる</button><button className="yl-ob-link" onClick={()=>setObKind(null)}>戻る</button></div>}</div>}
        </div>
      )}

      <div className="yl-wrap">
        <header className="yl-head">
          <h1 className="yl-title">{tab==="home"?"ホーム":tab==="cal"?"カレンダー":tab==="settings"?"設定":personSeg==="manage"?"家族":"記録"}</h1>
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
            <button className="yl-menu-btn" onClick={()=>setMenuOpen(true)} aria-label="メニュー"><Icon name="menu" size={22}/></button>
          </div>
        </header>

        {a2hsHint&&(
          <div className="yl-notif-banner">
            <span>ホーム画面に追加すると、データが消えにくく安心です</span>
            <button className="yl-notif-allow" onClick={()=>{setA2hsHint(false);try{localStorage.setItem("loalife-a2hs-snooze",String(Date.now()+3*86400000));}catch(e){}}}>あとで</button>
          </div>
        )}

        {adding&&(
          <div className="yl-petform">
            <div className="yl-kindrow"><button className={"yl-kindbtn"+(newKind==="pet"?" on":"")} onClick={()=>{setNewKind("pet");setNewEmoji(PET_EMOJIS[0]);}}>🐶 ペット</button><button className={"yl-kindbtn"+(newKind==="person"?" on":"")} onClick={()=>{setNewKind("person");setNewEmoji(PERSON_EMOJIS[0]);}}>👤 家族（人）</button></div>
            {newKind==="pet"&&<div className="yl-kindrow">{SPECIES.map(s=><button key={s.key} className={"yl-kindbtn sm"+(newSpecies===s.key?" on":"")} onClick={()=>{setNewSpecies(s.key);setNewEmoji(s.emoji);}}>{s.emoji} {s.label}</button>)}</div>}
            <div className="yl-emoji-row">{emojiSet.map(e=><button key={e} className={"yl-emoji"+(newEmoji===e?" on":"")} onClick={()=>setNewEmoji(e)}>{e}</button>)}</div>
            <div className="yl-petform-row"><IMEInput className="yl-input" value={newName} onChange={setNewName} onKeyDown={e=>e.key==="Enter"&&addMember()} placeholder={newKind==="person"?"名前（例：ゆうと）":"名前（例：ぽち）"}/><button className="yl-addbtn" onClick={addMember}>登録</button></div>
            <label className="yl-opt" style={{marginTop:10}}>誕生日（年は任意）<BdayInput value={newBirthday} onChange={setNewBirthday}/></label>
            {inHousehold&&<div style={{marginTop:10}}><VisibilityToggle value={newVisibility} onChange={setNewVisibility}/></div>}
          </div>
        )}

        {tab==="home"?(
          <div className="yl-home">
            {showNotifBanner&&(hasReminders||members.some(m=>m.birthday))&&(
              <div className="yl-notif-banner">
                <span>通知を許可すると、リマインダーや誕生日をお知らせします</span>
                <button className="yl-notif-allow" onClick={handleNotifRequest}>許可する</button>
              </div>
            )}

            {members.length>0&&(
              <section className="yl-ai">
                <p className="yl-ai-greet"><Icon name={new Date().getHours()<11?"sun":new Date().getHours()<18?"sun":"moon"} size={18}/> {aiSummary.greet}{aiSummary.name?`、${aiSummary.name}`:""}</p>
                {aiSummary.lines.map((l,i)=><p key={i} className="yl-ai-line">{l}</p>)}
              </section>
            )}

            {weatherLoc?(()=>{const wi=hasWalker?walkIndex(weather):null;const wa=hasWalker?walkAdvice(weather):null;const wt=hasWalker&&weather&&!weather.error&&weather.hours?walkTimeline(weather.hours):null;const wc=weather&&!weather.error&&weather.code!=null?weatherCodeMeta(weather.code):null;const cardLv=(wa&&wa.level==="danger")?"danger":(wi?wi.level:null);return(
              <div className={"yl-weather"+(cardLv?" lv-"+cardLv:"")}>
                {weather&&weather.error?(<>
                  <div className="yl-wx-top"><span className="yl-wx-loc"><Icon name="pin" size={13}/> {weatherLoc.name}</span><button className="yl-weather-refresh" onClick={()=>fetchWeather(weatherLoc)} aria-label="更新">↻</button></div>
                  <span className="yl-weather-err">取得できませんでした <button className="yl-weather-refresh" onClick={()=>fetchWeather(weatherLoc)}>再試行</button></span>
                </>):weather?(()=>{const advShort=wi?(wi.level==="danger"?"今日はお散歩を控えめに":wi.level==="warn"?"短めのお散歩がおすすめ":"お散歩日和です"):null;return(<>
                  <div className="yl-wx-top"><span className="yl-wx-loc"><Icon name="pin" size={13}/> {weatherLoc.name}</span><button className="yl-weather-refresh" onClick={()=>fetchWeather(weatherLoc)} aria-label="更新" disabled={weatherLoading}>↻</button></div>
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
                      {wt&&(<div className="yl-walktime">
                        <div className="yl-walktime-head">
                          <span className="yl-walktime-title"><Icon name="paw" size={15}/> きょうのおすすめ散歩タイム</span>
                          {wt.best?<span className="yl-walktime-badge"><Icon name="paw" size={12}/> おすすめ {wt.best.from===wt.best.to?`${wt.best.from}時ごろ`:`${wt.best.from}-${wt.best.to}時`}</span>:<span className="yl-walktime-badge none">今日はお休みが安心</span>}
                        </div>
                        <div className="yl-walktime-bar">{wt.segs.map(s=><span key={s.h} className={"yl-wt-seg lv-"+s.level} title={`${s.h}時`}/>)}</div>
                        <div className="yl-walktime-axis"><span>5時</span><span>9時</span><span>13時</span><span>17時</span><span>22時</span></div>
                        <div className="yl-walktime-legend"><span className="yl-wt-lg"><span className="yl-wt-dot good"/> おすすめ</span><span className="yl-wt-lg"><span className="yl-wt-dot caution"/> ようすを見て</span><span className="yl-wt-lg"><span className="yl-wt-dot avoid"/> さけて</span></div>
                      </div>)}
                    </div>)}
                  </div>)}
                </>);})():(<><div className="yl-wx-top"><span className="yl-wx-loc"><Icon name="pin" size={13}/> {weatherLoc.name}</span></div><span className="yl-weather-load">{weatherLoading?"読み込み中…":"—"}</span></>)}
              </div>
            );})():(
              <button className="yl-weather-setup" onClick={()=>setTab("settings")}><Icon name="thermometer" size={16}/> 地域を登録して天気・お散歩判定を表示</button>
            )}

            {/* 毎日いちばん使う「まとめてお世話記録」を天気のすぐ下に置き、開いてすぐ記録できるように */}
            {(()=>{const livePets=petMembers.filter(m=>!m.memorial);if(livePets.length===0)return null;const selIds=batchSel===null?livePets.map(m=>m.id):batchSel.filter(id=>livePets.some(m=>m.id===id));const toggle=(id)=>setBatchSel(()=>{const base=batchSel===null?livePets.map(m=>m.id):batchSel;return base.includes(id)?base.filter(x=>x!==id):[...base,id];});return(
              <section className="yl-batch">
                <div className="yl-batch-head"><span className="yl-batch-title">まとめてお世話記録</span></div>
                <div className="yl-batch-pets">{livePets.map(m=>{const on=selIds.includes(m.id);return(
                  <button key={m.id} className={"yl-batch-pet"+(on?" on":"")} onClick={()=>toggle(m.id)}>{avatarNode(m,"xs")}<span className="yl-batch-petname">{m.name}</span>{on&&<span className="yl-batch-check">✓</span>}</button>);})}
                </div>
                <div className="yl-batch-acts">{BATCH_ACTIONS.map(a=><button key={a.title} className="yl-batch-act" disabled={selIds.length===0} onClick={()=>batchLog(a,selIds)}><span className="yl-batch-act-emoji"><Icon name={guessIcon(a.title)} size={18}/></span>{a.title}</button>)}</div>
              </section>);})()}

            {/* ━━ 第1層「今日」：3秒で今日やることが分かる場 ━━ */}
            {(()=>{const todayClear=homeData.todos.length===0&&homeData.bombs.length===0;return(
            <div className="yl-layer">
              <span className="yl-layer-label">今日</span>
              {upcomingAnniv.length>0&&(
                <section className="yl-bday-section compact">
                  {upcomingAnniv.slice(0,3).map(a=>(
                    <div key={a.key} className="yl-bday-row">
                      <span className="yl-bday-emoji">{a.emoji}</span>
                      <span className="yl-bday-name">{a.name}<span className="yl-bday-kind">{a.kind==="gotcha"?"・うちの子記念日":a.kind==="self"?"":"・誕生日"}</span></span>
                      <span className={"yl-bday-tag"+(a.daysUntil===0?" today":"")}>{a.daysUntil===0?(a.years?(a.kind==="gotcha"?`迎えて${a.years}年！`:`${a.years}歳！`):"今日！"):`あと${a.daysUntil}日`}</span>
                    </div>
                  ))}
                </section>
              )}
              {/* 今日やること（毎日使う）を先に。見逃せないことはその下に。 */}
              {todayClear?(
                <section className="yl-hero calm">
                  <div className="yl-hero-emoji"><Icon name="sun" size={40} stroke={1.7}/></div>
                  <p className="yl-hero-title">今日は安心です</p>
                  <p className="yl-hero-sub">{members.length===0?"ゆっくり過ごせる一日を":(()=>{const pets=members.filter(m=>m.kind==="pet");if(pets.length===1)return `${pets[0].emoji} ${pets[0].name}は穏やかです`;if(members.length===1)return `${members[0].emoji} ${members[0].name}も穏やかです`;return `${members.map(m=>m.emoji).join("")} みんな穏やかです`;})()}</p>
                </section>
              ):homeData.todos.length>0&&(
                <section className="yl-todo">
                  <div className="yl-dash-head">
                    <h2 className="yl-sec-title" style={{marginBottom:0}}>今日やること</h2>
                    <button className="yl-cal-export" onClick={()=>setCalPicker({bulk:true})} title="カレンダーにエクスポート"><Icon name="calendar" size={14}/> 出力</button>
                  </div>
                  <ul className="yl-todo-list">
                    {homeData.todos.slice(0,3).map(t=>(
                      <li key={t.key} className="yl-todo-item" onClick={()=>setTab(t.space)}>
                        <span className="yl-todo-emoji"><Icon name={guessIcon(t.title)} size={18}/></span>
                        <span className="yl-todo-body"><span className="yl-todo-text">{t.title}{t.time&&<span className="yl-todo-time"> {t.time}</span>}</span><span className="yl-todo-who">{nameOf(t.space)}</span></span>
                        <span className={"yl-todo-tag"+(t.pri===0?" over":"")}>{t.tag}</span>
                      </li>
                    ))}
                  </ul>
                  {homeData.todos.length>3&&<p className="yl-todo-more">ほかに {homeData.todos.length-3} 件</p>}
                </section>
              )}
              {homeData.bombs.length>0&&(
                <section className="yl-bombs">
                  <h2 className="yl-sec-title alert">見逃せないこと</h2>
                  <ul className="yl-bomb-list">
                    {homeData.bombs.slice(0,3).map(({item,d})=>(
                      <li key={item.id} className={"yl-bomb-item"+(d<0?" over":"")} onClick={()=>setTab(item.space)}>
                        <span className="yl-bomb-emoji"><Icon name={guessIcon(item.title,"alert")} size={20}/></span>
                        <span className="yl-bomb-body"><span className="yl-bomb-text">{item.title}</span><span className="yl-bomb-who">{nameOf(item.space)}</span></span>
                        <span className={"yl-bomb-tag"+(d<0?" over":"")}>{d<0?`${-d}日超過`:d===0?"今日":d===1?"明日":`あと${d}日`}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {homeData.upcoming.length>0&&(
                <section className="yl-upcoming">
                  <p className="yl-upcoming-label"><Icon name="calendar" size={14}/> 直近の予定</p>
                  <ul className="yl-upcoming-list">
                    {homeData.upcoming.slice(0,4).map(u=>(
                      <li key={u.key} className="yl-upcoming-item" onClick={()=>setTab(u.space)}>
                        <span className="yl-upcoming-emoji"><Icon name={guessIcon(u.title,"calendar")} size={18}/></span>
                        <span className="yl-upcoming-text">{u.title}<span className="yl-upcoming-who"> ・{nameOf(u.space)}</span></span>
                        <span className="yl-upcoming-tag">{u.tag}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {/* ワンタップ記録：今日まだ体調記録が無いメンバーを、押すだけで完了できる導線 */}
              {(()=>{const need=spaces.filter(s=>!todayHasCond(s.id));return need.length>0&&(
                <section className="yl-quickcond">
                  <p className="yl-quickcond-label">今日のみんなの調子は？</p>
                  <ul className="yl-quickcond-list">
                    {need.map(s=>(
                      <li key={s.id} className="yl-quickcond-item">
                        <span className="yl-quickcond-emoji">{avatarNode(s,"sm")}</span>
                        <span className="yl-quickcond-name">{s.name}</span>
                        <button className="yl-quickcond-btn" onClick={()=>quickHealthy(s.id)}><Icon name="check" size={15}/> 今日も元気</button>
                      </li>
                    ))}
                  </ul>
                </section>
              );})()}
            </div>
            );})()}

            {/* ━━ 第2層「コンディション」：みんなの様子と習慣の軽チェック ━━ */}
            <div className="yl-layer">
              <section>
                <h2 className="yl-sec-title">みんなの様子</h2>
                <div className="yl-statusgrid">{spaces.map(s=>{
                  const lv=spaceLevel(s.id);const meta=LEVEL_META[lv];const concern=spaceConcern(s.id);
                  const okMsg=lv==="none"?"まだ記録がありません":(s.kind==="pet"?`${s.name}は順調です`:"順調です");
                  return(
                    <button key={s.id} className={"yl-statuscard lv-"+lv} onClick={()=>setTab(s.id)}>
                      <span className="yl-status-emoji">{avatarNode(s,"md")}</span>
                      <span className="yl-status-body">
                        <span className="yl-status-name">{s.name}</span>
                        <span className={"yl-status-line lv-"+lv}>{concern||okMsg}</span>
                      </span>
                      <span className={"yl-level-badge lv-"+lv}>{meta.label}</span>
                    </button>
                  );
                })}</div>
              </section>
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

            {/* ━━ 第3層「記録」：低頻度。既定で畳んで安心の場を守る ━━ */}
            <div className="yl-layer">
              <button className="yl-layer-toggle" onClick={()=>setRecOpen(o=>!o)}>
                <span className="yl-layer-label rec">記録</span>
                {lowSupplies.length>0&&<span className="yl-layer-badge">買い足し {lowSupplies.length}</span>}
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
                  {lowSupplies.length>0&&(
                    <section className="yl-supply">
                      <h2 className="yl-sec-title">そろそろ買い足し</h2>
                      <ul className="yl-supply-list">
                        {[...lowSupplies].sort((a,b)=>a.st.left-b.st.left).map(({item,st})=>(
                          <li key={item.id} className={"yl-supply-item "+st.tone}>
                            <button className="yl-supply-main" onClick={()=>setTab(item.space)}>
                              <span className="yl-supply-emoji"><Icon name={guessIcon(item.title,"package")} size={18}/></span>
                              <span className="yl-supply-info">
                                <span className="yl-supply-name">{item.title}<span className="yl-supply-who"> ・{nameOf(item.space)}</span></span>
                                <span className={"yl-supply-line "+st.tone}>{supplyLine(item)}</span>
                              </span>
                            </button>
                            <button className="yl-supply-bought" onClick={()=>markBought(item.id)}>買った</button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <section className="yl-summary"><h2 className="yl-sec-title light">小さなふりかえり</h2><div className="yl-summary-row"><div className="yl-stat"><span className="yl-stat-n">{weekDone}</span><span className="yl-stat-l">今週やったケア</span></div><div className="yl-stat"><span className="yl-stat-n">{allRoutines.length>0?`${routineDoneToday}/${allRoutines.length}`:"—"}</span><span className="yl-stat-l">今日のルーティン</span></div></div></section>
                  {homeExpense.total===0&&lowSupplies.length===0&&<p className="yl-routine-empty" style={{padding:"4px 0"}}>まだありません</p>}
                </div>
              )}
            </div>
            <button className="yl-reset" onClick={()=>setConfirmReset(true)}>⟳ サンプルを消して最初から</button>
          </div>
        ):tab==="cal"?(
          <div className="yl-cal">
            <div className="yl-cal-filter">
              <button className={"yl-cal-fchip"+(calFilter==="all"?" on":"")} onClick={()=>setCalFilter("all")}><Icon name="users" size={14}/> すべて</button>
              {spaces.map(s=><button key={s.id} className={"yl-cal-fchip"+(calFilter===s.id?" on":"")} onClick={()=>{setCalFilter(s.id);setMemberSel(s.id);}}><span className="yl-cal-fdot" style={{background:colorOf(s.id)}}/>{s.name}</button>)}
            </div>
            <div className="yl-cal-head">
              <button className="yl-cal-nav" onClick={()=>moveMonth(-1)} aria-label="前の月">‹</button>
              <span className="yl-cal-month">{monthLabel}</span>
              <button className="yl-cal-nav" onClick={()=>moveMonth(1)} aria-label="次の月">›</button>
            </div>
            <div className="yl-cal-dow">{WEEKDAYS_JA.map((w,i)=><span key={w} className={"yl-cal-dowc"+(i===0?" sun":i===6?" sat":"")}>{w}</span>)}</div>
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
                  <h3 className="yl-cal-day-title">{fmtMonthDay(calDay)}（{WEEKDAYS_JA[dowOf(calDay)]}）</h3>
                  <button className="yl-cal-add" onClick={()=>openLifeNew(calDay,calFilter==="all"?"me":calFilter)}>＋ 記録</button>
                </div>
                {dayTimeline.length===0?(
                  <p className="yl-routine-empty" style={{padding:"8px 0 4px"}}>この日の記録はまだありません</p>
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
            <button className="yl-cal-exportall" onClick={()=>setCalPicker({bulk:true})}><Icon name="download" size={16}/> 予定をカレンダーアプリに出力（.ics）</button>
            <p className="yl-foot" style={{marginTop:8}}>日付をタップで記録・ふりかえり</p>
          </div>
        ):tab==="settings"?(
          <div className="yl-settings">
            <h2 className="yl-sec-title" style={{marginBottom:12}}>設定</h2>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="bell" size={16}/> 通知</h3>
              <p className="yl-set-desc">予定やリマインド・誕生日をお知らせします。</p>
              {notifPerm==="granted"?<p className="yl-set-ok"><Icon name="check" size={13}/> 通知は許可されています</p>:notifPerm==="denied"?<p className="yl-set-warn">端末の設定で通知がオフになっています</p>:<button className="yl-addbtn sm" onClick={handleNotifRequest}>通知を許可する</button>}
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="thermometer" size={16}/> 天気の地域</h3>
              <p className="yl-set-desc">登録地域の天気・お散歩指数をホームに表示します。</p>
              {weatherLoc&&<p className="yl-set-ok"><Icon name="pin" size={13}/> {weatherLoc.name} <button className="yl-linkbtn" onClick={clearWeatherLoc}>解除</button></p>}
              <div className="yl-wxsearch">
                <input className="yl-input sm" value={wxQuery} onChange={e=>setWxQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchPlace()} placeholder="市区町村名で検索（例：横浜）"/>
                <button className="yl-addbtn sm" onClick={searchPlace} disabled={wxSearching}>{wxSearching?"検索中…":"検索"}</button>
              </div>
              {wxResults!=null&&(wxResults.length===0?<p className="yl-set-desc" style={{marginTop:8}}>見つかりませんでした。別の地名でお試しください。</p>:<ul className="yl-wxlist">{wxResults.map((r,i)=>{const sub=[...placeParts(r),r.country&&r.country!=="日本"?r.country:""].filter(Boolean).join(" ");return(<li key={i}><button className="yl-wxrow" onClick={()=>pickPlace(r)}><Icon name="pin" size={14}/><span className="yl-wxrow-body"><span className="yl-wxrow-name">{r.name}</span>{sub&&<span className="yl-wxrow-sub">{sub}</span>}</span>{r.population?<span className="yl-wxrow-pop">人口{r.population>=10000?`${Math.round(r.population/10000)}万`:r.population.toLocaleString()}</span>:null}</button></li>);})}</ul>)}
              <p className="yl-set-desc" style={{marginTop:8,fontSize:12}}>同じ地名が各地にあります。都道府県名を確かめて選んでください（例：新宿→東京都）。</p>
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="clock" size={16}/> 色が変わる時間（お世話・やることログ）</h3>
              <p className="yl-set-desc">色が<span className="yl-legend-dot warn"/>→<span className="yl-legend-dot alert"/>に変わる日数を設定します。</p>
              <div className="yl-colordays">
                <label className="yl-colordays-field"><span className="yl-legend-dot warn"/> 黄色になるまで<span className="yl-colordays-inp"><input type="number" inputMode="numeric" min="1" className="yl-health-num" value={colorDays.warn} onChange={e=>{const w=Math.max(1,parseInt(e.target.value||"1",10));persistColorDays({warn:w,alert:Math.max(w+1,colorDays.alert)});}}/>日</span></label>
                <label className="yl-colordays-field"><span className="yl-legend-dot alert"/> 赤になるまで<span className="yl-colordays-inp"><input type="number" inputMode="numeric" min="2" className="yl-health-num" value={colorDays.alert} onChange={e=>{const a=Math.max(2,parseInt(e.target.value||"2",10));persistColorDays({warn:Math.min(colorDays.warn,a-1),alert:a});}}/>日</span></label>
              </div>
              <p className="yl-set-desc" style={{marginTop:6}}>現在：{colorDays.warn}日で<span className="yl-legend-dot warn"/>・{colorDays.alert}日で<span className="yl-legend-dot alert"/></p>
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="alert" size={16}/> ペットの安全</h3>
              <p className="yl-set-desc">犬・猫が食べてはいけないもの・危険なもの、いざという時の備えを確認できます。</p>
              <button className="yl-addbtn sm" style={{marginBottom:10}} onClick={()=>{setToxicSp("all");setToxicQ("");setToxicOpen(true);}}><Icon name="alert" size={14}/> 誤食・中毒の危険物リスト</button>
              <button className="yl-addbtn sm" style={{marginBottom:10,marginLeft:8}} onClick={()=>setEmergencyOpen(true)}><Icon name="activity" size={14}/> 夜間・救急の備え</button>
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="download" size={16}/> バックアップ</h3>
              <p className="yl-set-desc">データは端末内に保存。バックアップ（.json）で写真ごと書き出せます。記録は CSV でも書き出せます。</p>
              <button className="yl-addbtn sm" style={{marginBottom:10}} onClick={exportData}><Icon name="download" size={14}/> データを書き出す（写真ふくむ）</button>
              <button className="yl-addbtn sm" style={{marginBottom:10,marginLeft:8}} onClick={exportCSV}><Icon name="filetext" size={14}/> 記録をCSVで書き出す</button>
              {confirmRestore?(
                <div className="yl-restore-confirm">
                  <p className="yl-set-warn" style={{margin:"0 0 8px"}}>読み込むと、いまのデータはバックアップの内容で上書きされます。よろしいですか？</p>
                  <label className="yl-addbtn sm" style={{display:"inline-block",cursor:"pointer"}}><Icon name="folder" size={14}/> ファイルを選んで復元<input type="file" accept="application/json,.json" style={{display:"none"}} onChange={importData}/></label>
                  <button className="yl-modal-cancel" style={{marginLeft:8}} onClick={()=>setConfirmRestore(false)}>やめる</button>
                </div>
              ):(
                <button className="yl-reset" onClick={()=>setConfirmRestore(true)}><Icon name="folder" size={14}/> バックアップから復元する</button>
              )}
            </section>
            {FB_READY&&(
              <section className="yl-set-sec">
                <h3 className="yl-set-title"><Icon name="users" size={16}/> 家族で共有</h3>
                <button className="yl-addbtn sm" onClick={()=>setShowShareModal(true)}>共有の設定</button>
              </section>
            )}
            <section className="yl-set-sec">
              <h3 className="yl-set-title"><Icon name="note" size={16}/> アプリについて</h3>
              <button className="yl-addbtn sm" style={{marginBottom:10}} onClick={()=>setHelpOpen(true)}>つかい方・機能紹介</button>
              <button className="yl-reset" onClick={()=>setConfirmReset(true)}>⟳ データを消して最初から</button>
            </section>
            <p className="yl-foot">試作版・データはこの端末に保存されます</p>
          </div>
        ):(
          <>
            {/* ペットのヒーロー：写真を主役に、名前・年齢・今日の状態を大きく */}
            {isMemberTab&&activeMember.kind==="pet"&&(()=>{
              const lv=spaceLevel(activeMember.id);const concern=spaceConcern(activeMember.id);
              const statusText=concern||(lv==="none"?"まだ記録がありません":`${activeMember.name}は順調です`);
              const photo=activeMember.avatar&&photos[activeMember.avatar];
              const memo=!!activeMember.memorial;
              const together=activeMember.gotchaDay?daysTogether(activeMember.gotchaDay,activeMember.memorial):null;
              const sub=[activeMember.breed,activeMember.birthday&&ageLabel(activeMember.birthday)].filter(Boolean).join(" · ")||(activeMember.species==="cat"?"ねこ":activeMember.species==="dog"?"いぬ":"ペット");
              const openEdit=()=>{setEditingId(activeMember.id);setEditName(activeMember.name);setEditBirthday(activeMember.birthday||"");setEditGotcha(activeMember.gotchaDay||"");setEditGroup(activeMember.group||"");setEditMicrochip(activeMember.microchip||"");setEditBreed(activeMember.breed||"");setEditCoat(activeMember.coat||"");setEditNeuter(activeMember.neuter||"");setEditMemorial(activeMember.memorial||"");setEditAvatar(activeMember.avatar||"");setEditVisibility(activeMember.visibility||"household");setEditPersonType(activeMember.personType||"child");setEditGender(activeMember.gender||"");setEditBlood(activeMember.blood||"");setProfileOpen(true);};
              return(
                <section className={"yl-hero"+(memo?" memorial":"")}>
                  <button className="yl-hero-photo" onClick={openEdit} aria-label="写真・プロフィールを編集">
                    {photo?<img src={photo} alt=""/>:<span className="yl-hero-ph"><Icon name="camera" size={26}/><span>写真を追加</span></span>}
                  </button>
                  <div className="yl-hero-body">
                    <h2 className="yl-hero-name">{activeMember.name}</h2>
                    <p className="yl-hero-sub">{sub}</p>
                    {memo?<span className="yl-hero-memorial"><Icon name="sparkles" size={13}/> 虹の橋へ {fmtBirthday(activeMember.memorial)}{together?`・${together}日間ありがとう`:""}</span>:<span className={"yl-hero-status lv-"+lv}><span className="yl-hero-dot"/>{statusText}</span>}
                  </div>
                  <button className="yl-hero-edit" onClick={openEdit} aria-label="プロフィールを編集"><Icon name="pencil" size={17}/></button>
                </section>
              );
            })()}
            {/* プロフィールは畳む：細いバー＋ⓘで開閉。ケア状態だけは常時表示（見守りの安心） */}
            <div className="yl-profbar">
              {isMemberTab&&activeMember.kind!=="pet"&&(()=>{const over=memberStats?.over||0,soon=memberStats?.soon||0;return over>0?<span className="yl-pill over"><Icon name="alert" size={13}/> 期限切れ {over}</span>:soon>0?<span className="yl-pill soon"><Icon name="clock" size={13}/> 期限近 {soon}</span>:<span className="yl-pill ok"><Icon name="check" size={13}/> ケアは順調</span>;})()}
              <button className="yl-profbar-toggle" onClick={()=>setProfileOpen(o=>!o)}>{isMemberTab?activeMember.name:(meName||"わたし")}のプロフィール {profileOpen?"▲":"▼"}</button>
            </div>
            {(profileOpen||(isMemberTab&&editingId===activeMember.id))&&(<>
            {!isMemberTab?<section className="yl-melead"><div className="yl-melead-row"><button className="yl-melead-avatar" onClick={()=>{setMeNameDraft(meName);setMePicker(true);}} title="アイコン・名前を変更">{meAvatar&&photos[meAvatar]?<img className="yl-avatar lg" src={photos[meAvatar]} alt=""/>:meEmoji}</button><div className="yl-melead-body"><p className="yl-melead-title">{meName||"わたし"}</p><p className="yl-melead-sub">{personSeg==="manage"?"予定・ケア・ストック・支出などを管理":"体重・体調・日記・思い出などの記録"}</p></div></div><div className="yl-me-bday">{meBdayEdit?<div className="yl-me-bday-edit"><BdayInput value={meBdayDraft} onChange={setMeBdayDraft}/><button className="yl-addbtn sm" onClick={()=>{persistMeBirthday(meBdayDraft);setMeBdayEdit(false);}}>保存</button><button className="yl-modal-cancel" onClick={()=>setMeBdayEdit(false)}>キャンセル</button></div>:<button className="yl-me-bday-btn" onClick={()=>{setMeBdayDraft(meBirthday);setMeBdayEdit(true);}}><Icon name="cake" size={13}/> {meBirthday?`${fmtBirthday(meBirthday)}${ageLabel(meBirthday)?`（${ageLabel(meBirthday)}）`:""}`:"自分の誕生日を登録"}</button>}</div></section>:(
              <section className="yl-petstatus">
                <div className="yl-petstatus-head">
                  {editingId===activeMember.id?(
                    <div className="yl-rename">
                      <div className="yl-editavatar">
                        {editAvatar&&photos[editAvatar]?<img className="yl-avatar lg" src={photos[editAvatar]} alt=""/>:<span className="yl-editavatar-emoji">{activeMember.emoji}</span>}
                        <label className="yl-editavatar-btn"><Icon name="camera" size={14}/> 写真にする<input type="file" accept="image/*" style={{display:"none"}} onChange={pickAvatar}/></label>
                        {editAvatar&&<button className="yl-editavatar-clear" onClick={()=>setEditAvatar("")}>絵文字に戻す</button>}
                      </div>
                      <IMEInput className="yl-input sm" value={editName} onChange={setEditName} onKeyDown={e=>e.key==="Enter"&&saveRename(activeMember.id)} placeholder="名前" autoFocus/>
                      <label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="folder" size={14}/> フォルダ（多頭飼いの分類・任意）<input className="yl-input sm" style={{marginTop:4}} value={editGroup} onChange={e=>setEditGroup(e.target.value)} placeholder="例：犬たち / ハムスター / 2階の子"/></label>
                      <div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="palette" size={14}/> カレンダーの色<span className="yl-colorrow">{MEMBER_COLORS.map(col=><button key={col} className={"yl-colordot"+(colorOf(activeMember.id)===col?" on":"")} style={{background:col}} onClick={()=>setMemberColor(col)} aria-label="色を選ぶ"/>)}</span></div>
                      <label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="cake" size={14}/> 誕生日（年は任意）<BdayInput value={editBirthday} onChange={setEditBirthday}/></label>
                      {activeMember.kind==="pet"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="gift" size={14}/> うちの子記念日（年は任意）<BdayInput value={editGotcha} onChange={setEditGotcha}/></label>}
                      {activeMember.kind==="pet"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="paw" size={14}/> {activeMember.species==="cat"?"猫種":activeMember.species==="dog"?"犬種":"種類"}（任意）<input className="yl-input sm" style={{marginTop:4}} list="yl-breed-list" value={editBreed} onChange={e=>setEditBreed(e.target.value)} placeholder="タップして選択（自由入力も可）"/><datalist id="yl-breed-list">{breedOptionsFor(activeMember.species).map(b=><option key={b} value={b}/>)}</datalist></label>}
                      {activeMember.kind==="pet"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="palette" size={14}/> 毛の色（任意）<input className="yl-input sm" style={{marginTop:4}} list="yl-coat-list" value={editCoat} onChange={e=>setEditCoat(e.target.value)} placeholder="タップして選択（自由入力も可）"/><datalist id="yl-coat-list">{COAT_COLORS.map(c=><option key={c} value={c}/>)}</datalist></label>}
                      {activeMember.kind==="pet"&&<div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="scissors" size={14}/> 避妊・去勢<span className="yl-seg-mini">{[{k:"done",l:"済み"},{k:"not",l:"まだ"}].map(o=><button key={o.k} className={"yl-seg-mini-btn"+(editNeuter===o.k?" on":"")} onClick={()=>setEditNeuter(editNeuter===o.k?"":o.k)}>{o.l}</button>)}</span></div>}
                      {activeMember.kind==="pet"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="hash" size={14}/> マイクロチップ番号（任意）<input className="yl-input sm" style={{marginTop:4}} inputMode="numeric" value={editMicrochip} onChange={e=>setEditMicrochip(e.target.value)} placeholder="15桁の番号（例：392...）"/></label>}
                      {activeMember.kind==="person"&&<div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="users" size={14}/> 種別（記録項目の出し分け）<span className="yl-seg-mini">{[{k:"adult",l:"大人"},{k:"child",l:"子ども"},{k:"senior",l:"高齢者"}].map(o=><button key={o.k} className={"yl-seg-mini-btn"+(editPersonType===o.k?" on":"")} onClick={()=>setEditPersonType(o.k)}>{o.l}</button>)}</span></div>}
                      {activeMember.kind==="person"&&<div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="smile" size={14}/> 性別（任意）<span className="yl-seg-mini">{GENDER_OPTS.map(o=><button key={o.k} className={"yl-seg-mini-btn"+(editGender===o.k?" on":"")} onClick={()=>setEditGender(editGender===o.k?"":o.k)}>{o.l}</button>)}</span></div>}
                      {activeMember.kind==="person"&&<div className="yl-opt" style={{marginTop:6,width:"100%"}}><Icon name="droplet" size={14}/> 血液型（任意）<span className="yl-seg-mini">{BLOOD_OPTS.map(o=><button key={o} className={"yl-seg-mini-btn"+(editBlood===o?" on":"")} onClick={()=>setEditBlood(editBlood===o?"":o)}>{o}</button>)}</span></div>}
                      {activeMember.kind==="pet"&&<div className="yl-opt yl-memorial-opt" style={{marginTop:10,width:"100%"}}><Icon name="sparkles" size={14}/> 虹の橋（お別れの記録・任意）
                        {editMemorial?<span className="yl-memorial-set"><span className="yl-memorial-date"><BdayInput value={editMemorial} onChange={setEditMemorial}/></span><button className="yl-linkbtn" onClick={()=>setEditMemorial("")}>解除</button></span>:<button className="yl-memorial-btn" onClick={()=>setEditMemorial(todayIso)}>お別れを記録して追悼モードにする</button>}
                        <span className="yl-set-desc" style={{marginTop:4}}>追悼モードにすると、予定・ケアのお知らせを止め、そっと思い出を振り返れる表示になります。</span>
                      </div>}
                      {inHousehold&&<div style={{marginTop:8}}><VisibilityToggle value={editVisibility} onChange={setEditVisibility}/></div>}
                      <button className="yl-addbtn sm" onClick={()=>saveRename(activeMember.id)}>保存</button>
                      <button className="yl-member-del" onClick={()=>setConfirmDel(activeMember)}><Icon name="trash" size={14}/> このメンバーを削除</button>
                    </div>
                  ):(
                    <span className="yl-petstatus-title" style={{color:KIND_STYLE[activeMember.kind].fg}}>
                      {avatarNode(activeMember,"sm")} {activeMember.name} の{KIND_STYLE[activeMember.kind].word}
                      <button className="yl-icon" onClick={()=>{setEditingId(activeMember.id);setEditName(activeMember.name);setEditBirthday(activeMember.birthday||"");setEditGotcha(activeMember.gotchaDay||"");setEditGroup(activeMember.group||"");setEditMicrochip(activeMember.microchip||"");setEditBreed(activeMember.breed||"");setEditCoat(activeMember.coat||"");setEditNeuter(activeMember.neuter||"");setEditMemorial(activeMember.memorial||"");setEditAvatar(activeMember.avatar||"");setEditVisibility(activeMember.visibility||"household");setEditPersonType(activeMember.personType||"child");setEditGender(activeMember.gender||"");setEditBlood(activeMember.blood||"");}}><Icon name="pencil" size={15}/></button>
                    </span>
                  )}
                </div>
                {/* ケア帯＝緊急度。異常が無い時は「順調 ✅」1個に畳み、数字が立った時だけ目立たせる */}
                <div className="yl-petstatus-chips">
                  {(memberStats?.over||0)>0&&<span className="yl-pill over"><Icon name="alert" size={13}/> 期限切れ {memberStats.over}</span>}
                  {(memberStats?.soon||0)>0&&<span className="yl-pill soon"><Icon name="clock" size={13}/> 期限近 {memberStats.soon}</span>}
                  {!(memberStats?.over)&&!(memberStats?.soon)&&<span className="yl-pill ok"><Icon name="check" size={13}/> ケアは順調</span>}
                  {inHousehold&&<span className={"yl-pill vis"+(activeMember.visibility==="private"?" private":"")}>{activeMember.visibility==="private"?<><Icon name="shield" size={11}/> 非公開</>:<><Icon name="users" size={11}/> 共有中</>}</span>}
                </div>
                {/* 誕生日・記念日＝お楽しみ。緊急度とは別の帯にして脳の使いどころを分ける */}
                {(activeMember.birthday||activeMember.gotchaDay||activeMember.microchip||activeMember.breed||activeMember.coat||activeMember.neuter||activeMember.gender||activeMember.blood)&&(
                  <div className="yl-petstatus-fun">
                    {activeMember.gender&&<span className="yl-funchip"><Icon name="smile" size={13}/>{genderLabel(activeMember.gender)}</span>}
                    {activeMember.blood&&<span className="yl-funchip"><Icon name="droplet" size={13}/>{activeMember.blood}型</span>}
                    {activeMember.breed&&<span className="yl-funchip"><Icon name="paw" size={13}/>{activeMember.breed}</span>}
                    {activeMember.birthday&&<span className="yl-funchip"><Icon name="cake" size={13}/>{fmtBirthday(activeMember.birthday)}{ageLabel(activeMember.birthday)?`（${ageLabel(activeMember.birthday)}）`:""}</span>}
                    {activeMember.gotchaDay&&<span className="yl-funchip"><Icon name="heart" size={13}/>{(()=>{const y=yearsSinceAnniv(activeMember.gotchaDay);const dd=daysUntilAnniv(activeMember.gotchaDay);const an=ageNow(activeMember.gotchaDay);return dd===0?(y?`迎えて${y}年！`:"うちの子記念日！"):`記念日 ${fmtBirthday(activeMember.gotchaDay)}${an!=null?`（${an}周年）`:""}`;})()}</span>}
                    {activeMember.gotchaDay&&daysTogether(activeMember.gotchaDay)!=null&&<span className="yl-funchip"><Icon name="home" size={13}/>お迎えから{daysTogether(activeMember.gotchaDay).toLocaleString()}日</span>}
                    {activeMember.coat&&<span className="yl-funchip"><Icon name="palette" size={13}/>{activeMember.coat}</span>}
                    {activeMember.neuter&&<span className="yl-funchip"><Icon name="scissors" size={13}/>避妊・去勢{activeMember.neuter==="done"?"済み":"まだ"}</span>}
                    {activeMember.microchip&&<span className="yl-funchip"><Icon name="hash" size={13}/>{activeMember.microchip}</span>}
                  </div>
                )}
              </section>
            )}</>)}

            {personSeg==="manage"&&(()=>{const defs=[];
              defs.push({key:"routine",el:(
                <section className="yl-routine">
                  <div className="yl-routine-head">
                    <h2 className="yl-routine-title">今日のルーティン</h2>
                    {routines.length>0&&<span className="yl-routine-prog">{routineDone} / {routines.length}</span>}
                  </div>
                  {routines.length===0?(
                    <p className="yl-routine-empty">{curKind==="pet"?"毎日くりかえすお世話を、右下の ＋ から追加できます":curKind==="me"?"毎日の予定や習慣を、右下の ＋ から追加できます":"毎日くりかえすことを、右下の ＋ から追加できます"}</p>
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
                </section>
              )});
              defs.push({key:"chore",el:(
                <section className="yl-chore">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>{curKind==="pet"?"お世話ログ":"やることログ"}</h2>
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
                                <button className="yl-addbtn sm" onClick={()=>saveChoreDate(c.id,choreDateEdit.date)}>保存</button>
                                <button className="yl-chore-cancel" onClick={()=>setChoreDateEdit(null)}>やめる</button>
                              </span>
                            ):(
                              <button className={"yl-chore-since "+el.tone} onClick={()=>c.lastDone&&setChoreDateEdit({id:c.id,date:c.lastDone})} title={c.lastDone?"タップで日付を修正":""}>{c.lastDone?`前回 ${fmtDate(c.lastDone)}・${el.txt}`:el.txt}{(c.history||[]).length>1?`（計${c.history.length}回）`:""}{c.lastDone?" ✎":""}</button>
                            )}
                          </span>
                          <button className="yl-chore-did" onClick={()=>logChore(c.id)}>やった</button>
                          <button className="yl-chore-del" onClick={()=>askDelete(c.title,()=>removeChore(c.id))} aria-label="削除">×</button>
                        </li>
                      );})}
                    </ul>
                  )}
                  <div className="yl-chore-tpl">
                    {choreTemplatesFor(curKind).filter(t=>!chores.some(c=>c.title===t.title)).map(t=><button key={t.title} className="yl-chore-add" onClick={()=>addChore(t.title,t.emoji)}>＋ <Icon name={guessIcon(t.title)} size={14}/> {t.title}</button>)}
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
                  {!loaded?<p className="yl-loading">よみこみ中…</p>:visible.length===0?<p className="yl-empty">まだありません。右下の ＋ から追加できます。</p>:(()=>{
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
                    <h2 className="yl-routine-title">ストック</h2>
                  </div>
                  {supplies.length===0?(
                    <p className="yl-routine-empty">{tab==="me"?"サプリや日用品などのストックを管理できます。":"フードなどの消耗品を登録すると、残りを自動でお知らせします"}</p>
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
                            <button className="yl-supply-bought" onClick={()=>markBought(s.id)}>買った</button>
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
                    <h2 className="yl-routine-title" style={{margin:0}}>支出</h2>
                    <span className="yl-exp-scope">{[{k:"this",l:nameOf(tab)||"このコ"},{k:"all",l:"みんな"}].map(o=><button key={o.k} className={"yl-exp-scopebtn"+(expScope===o.k?" on":"")} onClick={()=>setExpScope(o.k)}><span className="yl-exp-scopelab">{o.l}</span></button>)}</span>
                  </div>
                  {expStats.total===0?<p className="yl-routine-empty">{expScope==="all"?"まだ支出の記録がありません。":"右下の ＋ から追加"}</p>:(<>
                    <div className="yl-exp-stats">
                      <div className="yl-exp-stat"><span className="yl-exp-stat-l">合計</span><strong className="yl-exp-stat-v">{fmtYen(expStats.total)}</strong></div>
                      <div className="yl-exp-stat"><span className="yl-exp-stat-l">{expStats.year}年</span><strong className="yl-exp-stat-v">{fmtYen(expStats.thisYear)}</strong></div>
                      <div className="yl-exp-stat"><span className="yl-exp-stat-l">月平均</span><strong className="yl-exp-stat-v">{fmtYen(expStats.monthlyAvg)}</strong></div>
                      <div className="yl-exp-stat"><span className="yl-exp-stat-l">年間見込み</span><strong className="yl-exp-stat-v">{fmtYen(expStats.annual)}</strong></div>
                    </div>
                    {expScope==="all"&&expStats.byMember.length>0&&(
                      <div className="yl-exp-block">
                        <p className="yl-exp-blocktitle">メンバー別</p>
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
                      <p className="yl-exp-blocktitle">カテゴリ別</p>
                      <div className="yl-exp-donutrow">
                        <div className="yl-donut" style={{background:`conic-gradient(${(()=>{let acc=0;const stops=expStats.cats.map(c=>{const s=acc/expStats.total*100;acc+=c.amount;const e=acc/expStats.total*100;return `${c.color} ${s}% ${e}%`;});return stops.join(",")||"#E5DED4 0% 100%"})()})`}}>
                          <div className="yl-donut-hole"><span>合計</span><strong>{fmtYen(expStats.total)}</strong></div>
                        </div>
                        <ul className="yl-exp-legend">
                          {expStats.cats.map(c=>(
                            <li key={c.key} className="yl-exp-leg"><span className="yl-exp-leg-dot" style={{background:c.color}}/><span className="yl-exp-leg-name">{c.label}</span><span className="yl-exp-leg-amt">{fmtYen(c.amount)}</span><span className="yl-exp-leg-pct">{Math.round(c.amount/expStats.total*100)}%</span></li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="yl-exp-block">
                      <p className="yl-exp-blocktitle">月ごとの推移{expStats.trendReady?`（直近${expStats.trendMonths}ヶ月）`:""}</p>
                      {expStats.trendReady?(()=>{const mx=Math.max(1,...expStats.series.map(s=>s.total));return(
                        <div className="yl-exp-trend">
                          {expStats.series.map((s,i)=>(
                            <div key={s.ym} className="yl-exp-trendcol" title={`${s.m}月 ${fmtYen(s.total)}`}>
                              <span className="yl-exp-trendbar-wrap"><span className="yl-exp-trendbar" style={{height:s.total>0?Math.max(4,Math.round(s.total/mx*100))+"%":"0"}}/></span>
                              <span className="yl-exp-trendlab">{(i===0||s.m===1||i===expStats.series.length-1)?s.m+"月":""}</span>
                            </div>
                          ))}
                        </div>
                      );})():(
                        <p className="yl-exp-trend-empty">データが増えると、月ごとの推移が表示されます。</p>
                      )}
                    </div>
                  </>)}
                  {expScope==="this"&&expenseRecords.length>0&&(
                    <ul className="yl-exp-list">
                      {expenseRecords.slice(0,8).map(r=>(
                        <li key={r.id} className="yl-exp-item tap" onClick={()=>openExpEdit(r)}>
                          <span className="yl-exp-idate">{fmtDate(r.date)}</span>
                          <span className="yl-exp-icat" style={{color:expCatMeta(r.category).color}}><Icon name={guessIcon(expCatMeta(r.category).label,"wallet")} size={13}/> {expCatMeta(r.category).label}</span>
                          {r.note&&<span className="yl-exp-inote">{r.note}</span>}
                          <span className="yl-exp-iamt">{fmtYen(r.amount)}</span>
                          <button className="yl-health-del" onClick={e=>{e.stopPropagation();askDelete(`${fmtDate(r.date)}の支出`,()=>removeExpense(r.id));}} aria-label="削除">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )});
              return renderSecs("manage",defs);
            })()}

            {personSeg==="record"&&(()=>{const defs=[];
              if(isMemberTab&&certs.length>0)defs.push({key:"certs",el:(
                <section className="yl-certs">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>証明書</h2>
                  {certsByYear.map(g=>(
                    <div key={g.year} className="yl-cert-year">
                      <span className="yl-cert-yearlabel">{g.year==="----"?"日付なし":`${g.year}年`}</span>
                      <div className="yl-certs-row">
                        {g.items.map(c=>{
                          const label=(careKindsFor(activeMember).find(k=>k.key===c.careKind)||{}).label||c.title;
                          return(
                            <button key={c.id} className="yl-cert-cell" onClick={()=>viewPhoto(firstPhotoId(c))}>
                              {firstPhotoId(c)&&photos[firstPhotoId(c)]?<img className="yl-cert-img" src={photos[firstPhotoId(c)]} alt=""/>:<span className="yl-cert-ph"><Icon name="filetext" size={20}/></span>}
                              <span className="yl-cert-cap"><Icon name={careIcon(c.careKind)} size={12}/> {label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              )});
              defs.push({key:"health",el:(
                <section className="yl-health">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>からだの記録</h2>
                  {isMemberTab&&weightDiff!=null&&(<p className={"yl-diet-msg"+(Math.abs(weightDiff)<0.05?" ok":weightDiff>0?" over":" under")}>{Math.abs(weightDiff)<0.05?<><Icon name="sparkles" size={13}/> 目標達成中！この調子で</>:weightDiff>0?<>目標を <span className="yl-nowrap">{Math.abs(weightDiff).toFixed(1)}{weightUnit}</span> 超えています<span className="yl-nowrap">（食べすぎ・運動量に気をつけて）</span></>:<>目標まで あと <span className="yl-nowrap">{Math.abs(weightDiff).toFixed(1)}{weightUnit}</span></>}</p>)}
                  {weightPts.length>=2?<MiniChart points={weightPts} unit={weightPts[weightPts.length-1].unit} color="#E39A5C" label="体重"/>:<p className="yl-routine-empty">{weightPts.length===1?"あと1回記録すると、体重の推移グラフが出ます。":"右下の ＋ から体重などを記録できます。"}</p>}
                  {isMemberTab&&heightPts.length>=2&&<MiniChart points={heightPts} unit="cm" color="#D98A4E" label="身長"/>}
                  {bpPts.length>=2&&<MiniChart points={bpPts} unit="mmHg" color="#B23A48" label="血圧（上）"/>}
                  {healthRecords.length>0&&(
                    <ul className="yl-health-list">
                      {[...healthRecords].reverse().slice(0,6).map(r=>(
                        <li key={r.id} className="yl-health-item">
                          <span className="yl-health-date">{fmtDate(r.date)}</span>
                          <span className="yl-health-vals">{r.weight!=null&&<span>{r.weight}{r.wunit||"kg"}</span>}{r.height!=null&&<span>{r.height}cm</span>}{(r.bpSys!=null||r.bpDia!=null)&&<span>血圧 {r.bpSys??"–"}/{r.bpDia??"–"}</span>}{r.temp!=null&&<span>{r.temp}℃</span>}{r.glucose!=null&&<span>血糖{r.glucose}</span>}{r.condition&&condMeta(r.condition)&&<span>{condMeta(r.condition).emoji}{condMeta(r.condition).label}</span>}</span>
                          <button className="yl-health-del" onClick={()=>askDelete(`${fmtDate(r.date)}の記録`,()=>removeHealth(r.id))} aria-label="削除">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )});
              if(curKind==="pet")defs.push({key:"vet",el:(
                <section className="yl-vetcard">
                  <h2 className="yl-routine-title" style={{marginBottom:8}}>獣医さん用サマリー</h2>
                  <p className="yl-set-desc" style={{marginBottom:10}}>記録を1枚にまとめて印刷・PDF保存。</p>
                  <button className="yl-quick-big" onClick={()=>setVetOpen(true)}><Icon name="filetext" size={18}/> サマリーを作成</button>
                </section>
              )});
              if(curKind==="pet")defs.push({key:"feed",el:(
                <section className="yl-feedsec">
                  <div className="yl-toilet-head">
                    <h2 className="yl-routine-title" style={{margin:0}}>ごはん</h2>
                    {feedTodayG>0&&<span className="yl-feed-todaytotal">今日 合計 約{feedTodayG}g</span>}
                  </div>
                  {feedToday.length>0?(
                    <p className="yl-feed-todaysub">今日 {feedToday.length}回{servingG!=null?` ・ 1回分=${servingG}g`:""}</p>
                  ):(
                    <p className="yl-routine-empty" style={{padding:"4px 0 0"}}>「回」でワンタップ記録。1回分＝◯g を設定すると総量に反映されます。</p>
                  )}
                  {feedRecords.length>0&&(
                    <ul className="yl-feed-list">
                      {feedRecords.slice(0,5).map(x=>(
                        <li key={x.id} className="yl-feed-item">
                          <span className="yl-feed-emoji"><Icon name="utensils" size={16}/></span>
                          <span className="yl-feed-body"><span className="yl-feed-amt">{feedEntryText(x)}</span><span className="yl-feed-date">{fmtDate(x.date)}</span></span>
                          <button className="yl-feed-del" onClick={()=>askDelete("ごはんの記録",()=>removeFeed(x.id))} aria-label="削除">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button className="yl-quick-big" style={{marginTop:10}} onClick={openFeed}><Icon name="utensils" size={18}/> ごはんを記録する</button>
                </section>
              )});
              if(curKind==="pet"&&hasToilet)defs.push({key:"toilet",el:(
                <section className="yl-toiletstats">
                  <div className="yl-toilet-head">
                    <h2 className="yl-routine-title" style={{margin:0}}>トイレ成功率</h2>
                    <span className="yl-toilet-ranges">{[7,14,30].map(d=><button key={d} className={"yl-toilet-range"+(toiletRange===d?" on":"")} onClick={()=>setToiletRange(d)}>{d}日</button>)}</span>
                  </div>
                  {(()=>{const st=toiletStats[toiletRange];const Row=({label,ico,s})=>(<div className="yl-toilet-stat"><span className="yl-toilet-stat-label"><Icon name={ico} size={14}/> {label}</span>{s.total===0?<span className="yl-toilet-stat-none">記録なし</span>:<><span className="yl-toilet-bar"><span className="yl-toilet-fill" style={{width:s.rate+"%"}}/></span><span className="yl-toilet-pct">{s.rate}%<span className="yl-toilet-cnt"> ({s.success}/{s.total}回)</span></span></>}</div>);return(<><Row label="おしっこ成功率" ico="droplet" s={st.pee}/><Row label="うんち成功率" ico="droplet" s={st.poop}/>{st.poop.avgBristol!=null&&<p className="yl-toilet-avg"><Icon name="droplet" size={13}/> うんちの硬さ平均 <b>{st.poop.avgBristol}／7</b>{bristolMeta(Math.round(st.poop.avgBristol))?`（${bristolMeta(Math.round(st.poop.avgBristol)).label}）`:""}・{st.poop.brCount}回</p>}</>);})()}
                  {poopTrend&&<p className={"yl-bristol-warn tone-"+poopTrend.tone} style={{marginTop:2}}><Icon name="alert" size={13}/> {poopTrend.txt}</p>}
                  <button className="yl-quick-big" style={{marginTop:10}} onClick={()=>setInputSheet("toilet")}><Icon name="paw" size={18}/> トイレを記録する</button>
                </section>
              )});
              defs.push({key:"diary",el:(
                <section className="yl-diary">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>今日のようす</h2>
                  {todayHasCond(tab)?(
                    <button className="yl-quick-done tap" onClick={()=>setInputSheet("diary")}><Icon name="check" size={14}/> 今日の体調は記録ずみ<span className="yl-quick-edit">追記・編集</span></button>
                  ):(
                    <button className="yl-quick-big" onClick={()=>setInputSheet("diary")}><Icon name="note" size={18}/> 体調を記録</button>
                  )}
                  {energyPts.length>1&&<MiniChart points={energyPts} unit="" color="#557E63" label="元気の推移（5段階）"/>}
                  {diaryRecords.length===0&&<p className="yl-routine-empty">「体調を記録」から残せます</p>}
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
                                      {r.energy&&diaryMeta(DIARY_ENERGY,r.energy)&&<span className="yl-dayrec-chip"><Icon name={ENERGY_ICON[r.energy]} size={13}/> {diaryMeta(DIARY_ENERGY,r.energy).label}</span>}
                                      {r.appetite&&diaryMeta(DIARY_APPETITE,r.appetite)&&<span className="yl-dayrec-chip"><Icon name={appetiteIcon(r.appetite)} size={13}/> {diaryMeta(DIARY_APPETITE,r.appetite).label}</span>}
                                      {r.poop&&diaryMeta(DIARY_POOP,r.poop)&&<span className="yl-dayrec-chip"><Icon name={POOP_DIARY_ICON[r.poop]||"droplet"} size={13}/> {diaryMeta(DIARY_POOP,r.poop).label}</span>}
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
              if(curKind==="person"&&(activeMember.personType||"child")==="child")defs.push({key:"growth",el:(
                <section className="yl-growth">
                  <h2 className="yl-routine-title" style={{marginBottom:6}}>成長の記録</h2>
                  <p className="yl-set-desc" style={{marginBottom:10}}>はじめて・できたこと・作品を残せます（写真も添付OK）。あとから育児日記として振り返れます。</p>
                  <div className="yl-growth-cats">{MILESTONE_CATS.map(c=><button key={c.key} className={"yl-growth-cat"+(msCat===c.key?" on":"")} onClick={()=>setMsCat(c.key)}><Icon name={c.icon} size={14}/> {c.label}</button>)}</div>
                  <div className="yl-growth-presets">{MILESTONE_PRESETS[msCat].filter(p=>!growthRecords.some(g=>g.title===p)).map(p=><button key={p} className="yl-growth-preset" onClick={()=>addMilestone(msCat,p)}>＋ {p}</button>)}</div>
                  <div className="yl-growth-custom"><input className="yl-input sm" value={msDraft} onChange={e=>setMsDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMilestone(msCat,msDraft)} placeholder="自分で追加（例：逆上がりができた）"/><button className="yl-addbtn sm" onClick={()=>addMilestone(msCat,msDraft)}>＋ 記録</button></div>
                  {growthRecords.length>0&&(
                    <ul className="yl-growth-list">
                      {growthRecords.map(g=>{const cm=milestoneCatMeta(g.category);const at=activeMember.birthday?ageAtLabel(activeMember.birthday,g.date):"";const pid=firstPhotoId(g);return(
                        <li key={g.id} className="yl-growth-item">
                          {pid&&photos[pid]?<button className="yl-growth-thumbwrap" onClick={()=>viewPhoto(pid)}><img className="yl-growth-thumb" src={photos[pid]} alt=""/></button>:<span className={"yl-growth-badge cat-"+g.category}><Icon name={cm.icon} size={14}/></span>}
                          <span className="yl-growth-body"><span className="yl-growth-title">{g.title}</span><span className="yl-growth-meta">{cm.label}・{fmtDate(g.date)}{at?`・${at}`:""}</span></span>
                          {!pid&&<label className="yl-growth-cam" title="作品・写真を追加" onClick={e=>e.stopPropagation()}><Icon name="camera" size={15}/><input type="file" accept="image/*" style={{display:"none"}} onChange={e=>onFilePicked(e,g.id,"作品・写真を保存しました")}/></label>}
                          <button className="yl-health-del" onClick={()=>askDelete(g.title,()=>removeMilestone(g.id))} aria-label="削除">×</button>
                        </li>
                      );})}
                    </ul>
                  )}
                </section>
              )});
              defs.push({key:"album",el:(
                <section className="yl-album">
                  <div className="yl-routine-head">
                    <h2 className="yl-routine-title">思い出</h2>
                    <button className="yl-album-add" onClick={()=>openLifeNew(todayIso,tab)}>＋ 追加</button>
                  </div>
                  {memories.length===0?(
                    <p className="yl-routine-empty">写真とひとことで残せます</p>
                  ):(
                    <div className="yl-album-grid">
                      {memories.map(mem=>(
                        <button key={mem.id} className="yl-album-cell" onClick={()=>openLifeEdit(mem)}>
                          {firstPhotoId(mem)&&photos[firstPhotoId(mem)]?<><img className="yl-album-img" src={photos[firstPhotoId(mem)]} alt=""/>{photoIdsOf(mem).length>1&&<span className="yl-photo-badge">+{photoIdsOf(mem).length-1}</span>}</>:<span className="yl-album-ph">{mem.note?"📝":(mem.emoji||"📸")}</span>}
                          <span className="yl-album-cap">{fmtDate(mem.date)}{mem.title&&mem.title!=="思い出"?`・${mem.title}`:""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )});
              return renderSecs("record",defs);
            })()}

            {personSeg==="manage"&&(()=>{const defs=[];
              if(curKind==="person"&&(activeMember.personType||"child")==="child")defs.push({key:"help",el:(
                <section className="yl-help-sec">
                  <div className="yl-routine-head"><h2 className="yl-routine-title">お手伝いポイント</h2><span className="yl-point-total"><Icon name="sparkles" size={14}/> 合計 {pointStats.total}pt<span className="yl-point-week">（今週 {pointStats.week}）</span></span></div>
                  <div className="yl-growth-presets">{HELP_PRESETS.map(h=><button key={h.task} className="yl-growth-preset" onClick={()=>addPoint(h.task,h.pt)}>＋ {h.task} <b>+{h.pt}</b></button>)}</div>
                  <div className="yl-growth-custom"><input className="yl-input sm" value={pointTask} onChange={e=>setPointTask(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPoint(pointTask,1)} placeholder="自分で追加（+1pt）"/><button className="yl-addbtn sm" onClick={()=>addPoint(pointTask,1)}>＋ 記録</button></div>
                  {pointRecords.length>0&&<ul className="yl-point-list">{pointRecords.slice(0,8).map(p=>(<li key={p.id} className="yl-point-item"><span className="yl-point-date">{fmtDate(p.date)}</span><span className="yl-point-task">{p.task}</span><span className="yl-point-pt">+{p.points}pt</span><button className="yl-health-del" onClick={()=>removePoint(p.id)} aria-label="削除">×</button></li>))}</ul>}
                </section>
              )});
              if(curKind==="person"&&(activeMember.personType||"child")==="child")defs.push({key:"allowance",el:(
                <section className="yl-allow-sec">
                  <div className="yl-routine-head"><h2 className="yl-routine-title">おこづかい帳</h2><span className="yl-allow-bal">のこり <strong>{fmtYen(allowanceBalance)}</strong></span></div>
                  <div className="yl-allow-input">
                    <span className="yl-seg-mini">{ALLOWANCE_DIRS.map(o=><button key={o.k} className={"yl-seg-mini-btn"+(allowDir===o.k?" on":"")} onClick={()=>setAllowDir(o.k)}>{o.l}</button>)}</span>
                    <div className="yl-allow-row"><span className="yl-exp-amt"><span className="yl-exp-yen">¥</span><input type="number" inputMode="numeric" className="yl-health-num" value={allowAmt} onChange={e=>setAllowAmt(e.target.value)} placeholder="金額"/></span><input className="yl-input sm" value={allowReason} onChange={e=>setAllowReason(e.target.value)} placeholder="メモ（おかし 等・任意）"/><button className="yl-addbtn sm" onClick={addAllowance}>＋</button></div>
                  </div>
                  {allowanceRecords.length>0&&<ul className="yl-allow-list">{allowanceRecords.slice(0,8).map(a=>{const dm=ALLOWANCE_DIRS.find(o=>o.k===a.dir)||ALLOWANCE_DIRS[0];return(<li key={a.id} className="yl-allow-item"><span className="yl-point-date">{fmtDate(a.date)}</span><span className={"yl-allow-tag dir-"+a.dir}>{dm.l}</span>{a.reason&&<span className="yl-allow-reason">{a.reason}</span>}<span className={"yl-allow-amt"+(dm.sign<0?" out":dm.sign>0?" in":"")}>{dm.sign<0?"-":dm.sign>0?"+":""}{fmtYen(a.amount)}</span><button className="yl-health-del" onClick={()=>removeAllowance(a.id)} aria-label="削除">×</button></li>);})}</ul>}
                </section>
              )});
              if(curKind==="person"&&((activeMember.personType||"child")==="child"||activeMember.personType==="senior"))defs.push({key:"meds",el:(
                <section className="yl-med-sec">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>お薬の服用</h2>
                  {medCourses.length>0&&<ul className="yl-med-list">{medCourses.map(m=>{const dayNo=Math.min(m.days,Math.floor((new Date(todayIso)-new Date(m.startDate))/86400000)+1);const doneToday=(m.taken||[]).includes(todayIso);const left=Math.max(0,m.days-(m.taken||[]).length);const finished=(m.taken||[]).length>=m.days;return(<li key={m.id} className={"yl-med-item"+(finished?" done":"")}><span className="yl-med-body"><span className="yl-med-name"><Icon name="pill" size={14}/> {m.name}</span><span className="yl-med-meta">{finished?"のみ終わりました":`${m.days}日間・${dayNo>0?dayNo:1}日目・のこり${left}日`}</span></span>{!finished&&<button className={"yl-med-check"+(doneToday?" on":"")} onClick={()=>toggleMedToday(m.id)}>{doneToday?"のんだ✓":"のんだ"}</button>}<button className="yl-health-del" onClick={()=>askDelete(m.name,()=>removeMedCourse(m.id))} aria-label="削除">×</button></li>);})}</ul>}
                  <div className="yl-med-add"><input className="yl-input sm" value={medName} onChange={e=>setMedName(e.target.value)} placeholder="お薬の名前（例：抗生剤）"/><span className="yl-med-days"><input type="number" inputMode="numeric" min="1" className="yl-health-num" value={medDays} onChange={e=>setMedDays(e.target.value)}/>日間</span><button className="yl-addbtn sm" onClick={addMedCourse}>＋ 登録</button></div>
                </section>
              )});
              if(curKind==="person")defs.push({key:"belong",el:(
                <section className="yl-belong">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>持ち物（曜日ごと）</h2>
                  {belongings.length>0&&(
                    <div className="yl-belong-week">
                      {WEEKDAYS_JA.map((w,i)=>{const list=belongings.filter(b=>b.dow===i);if(!list.length)return null;return(
                        <div key={i} className="yl-belong-day">
                          <span className={"yl-belong-dow"+(i===0?" sun":i===6?" sat":"")}>{w}</span>
                          <span className="yl-belong-items">{list.map(b=><span key={b.id} className="yl-belong-chip">{b.title}<button className="yl-belong-del" onClick={()=>removeBelonging(b.id)} aria-label="削除">×</button></span>)}</span>
                        </div>
                      );})}
                    </div>
                  )}
                  {belongings.length===0&&<p className="yl-routine-empty">右下の ＋ から持ち物を登録</p>}
                </section>
              )});
              defs.push({key:"cards",el:(
                <section className="yl-tray">
                  <button className="yl-tray-head" onClick={()=>setTrayOpen(o=>!o)}>
                    <span className="yl-tray-title"><Icon name="pin" size={15}/> 大切な情報{cards.length>0?`（${cards.length}）`:""}</span>
                    <span className="yl-tray-arrow">{trayOpen?"▲":"▼"}</span>
                  </button>
                  {trayOpen&&(
                    <div className="yl-tray-body">
                      <p className="yl-tray-hint">緊急連絡先・アレルギー・かかりつけ等をカードで保存。</p>
                      {cards.map(c=>(
                        <button key={c.id} className="yl-infocard" onClick={()=>openCardEdit(c)}>
                          <span className="yl-infocard-emoji"><Icon name={cardIcon(c.kind)} size={20}/></span>
                          <span className="yl-infocard-body"><span className="yl-infocard-title">{c.title}</span>{c.body&&<span className="yl-infocard-text">{c.body}</span>}</span>
                          {firstPhotoId(c)&&photos[firstPhotoId(c)]&&<img className="yl-infocard-thumb" src={photos[firstPhotoId(c)]} alt=""/>}
                        </button>
                      ))}
                      <div className="yl-tray-add">{CARD_PRESETS.map(p=><button key={p.key} className="yl-tray-addbtn" onClick={()=>openCardNew(p.key)}><Icon name={cardIcon(p.key)} size={14}/> {p.label}</button>)}</div>
                    </div>
                  )}
                </section>
              )});
              return renderSecs("manage",defs);
            })()}
          </>
        )}
        <div className="yl-help-foot"><button className="yl-help-btn" onClick={()=>setHelpOpen(true)}><Icon name="note" size={15}/> つかい方・機能紹介</button></div>
        <p className="yl-foot">試作版・データはこの端末に保存されます</p>
      </div>

      {isPersonMode&&!hubOpen&&!inputSheet&&(
        <button className="yl-fab" onClick={()=>setHubOpen(true)} aria-label="記録を追加"><Icon name="plus" size={26} stroke={2.2}/></button>
      )}

      {/* 下部固定スタック：メンバーバー（上）＋タブナビ（下） */}
      <div className="yl-btmstack">
      {/* 共通メンバー切り替え：ドロップアップ（通常は選択中1件、タップで上方向に一覧を展開）。すべてはカレンダーのみ。 */}
      {!onboarding&&(tab==="cal"||isPersonMode)&&(()=>{
        const curId=tab==="cal"?calFilter:tab;
        const cur=curId==="all"?null:(spaces.find(s=>s.id===curId)||spaces[0]);
        const select=(id)=>{setAdding(false);if(tab==="cal"){setCalFilter(id);if(id!=="all")setMemberSel(id);}else{setTab(id);setMemberSel(id);}setMemListOpen(false);};
        const meSpace=spaces[0];
        const memRow=(s)=>{const sel=curId===s.id;return(
          <button key={s.id} className={"yl-mrow"+(sel?" on":"")} onClick={()=>select(s.id)}>
            <span className="yl-mchip-dot" style={{background:colorOf(s.id)}}/>{avatarNode(s,"xs")}<span className="yl-mrow-name">{s.name}</span>{sel&&<span className="yl-mrow-check">✓</span>}
          </button>);};
        return(<>
          {memListOpen&&<div className="yl-mscrim" onClick={()=>setMemListOpen(false)}/>}
          {memListOpen&&(
            <div className="yl-mdropup" role="listbox">
              {tab==="cal"&&<button className={"yl-mrow"+(calFilter==="all"?" on":"")} onClick={()=>select("all")}><span className="yl-mrow-ico"><Icon name="users" size={16}/></span><span className="yl-mrow-name">すべて（全員の予定を重ねる）</span>{calFilter==="all"&&<span className="yl-mrow-check">✓</span>}</button>}
              {memRow(meSpace)}
              {groupedMembers.map(g=>(
                <Fragment key={g.group||"__ungrouped"}>
                  {g.group&&<div className="yl-mgroup-h"><Icon name="folder" size={13}/> {g.group}</div>}
                  {g.members.map(m=>memRow(m))}
                </Fragment>
              ))}
              <button className="yl-mrow add" onClick={()=>{setAdding(true);setMemListOpen(false);}}>＋ メンバーを追加</button>
            </div>
          )}
          <button className="yl-membar" onClick={()=>setMemListOpen(o=>!o)} aria-expanded={memListOpen} aria-label="メンバーを切り替え">
            {curId==="all"
              ?<><span className="yl-mrow-ico"><Icon name="users" size={16}/></span><span className="yl-mbar-name">すべて</span></>
              :<><span className="yl-mchip-dot" style={{background:colorOf(cur.id)}}/>{avatarNode(cur,"xs")}<span className="yl-mbar-name">{cur.name}</span></>}
            <span className="yl-mbar-caret">{memListOpen?"▼":"▲"}</span>
          </button>
        </>);
      })()}

      {/* 下部タブナビゲーション（常時表示・行動で分類） */}
      {!onboarding&&(()=>{
        const personTarget=members.some(m=>m.id===memberSel)||memberSel==="me"?memberSel:"me";
        const goSeg=(seg)=>{setTab(personTarget);setPersonSeg(seg);};
        const items=[
          {key:"home",icon:"home",label:"ホーム",on:tab==="home",act:()=>setTab("home")},
          {key:"cal",icon:"calendar",label:"カレンダー",on:tab==="cal",act:()=>setTab("cal")},
          {key:"record",icon:"record",label:"記録",on:isPersonMode&&personSeg==="record",act:()=>goSeg("record")},
          {key:"manage",icon:"users",label:"家族",on:isPersonMode&&personSeg==="manage",act:()=>goSeg("manage")},
          {key:"settings",icon:"settings",label:"設定",on:tab==="settings",act:()=>setTab("settings")},
        ];
        return(
          <nav className="yl-bottomnav">
            {items.map(it=>(
              <button key={it.key} className={"yl-bnav-item"+(it.on?" on":"")} onClick={it.act}>
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
              <button className="yl-drawer-item" onClick={()=>{setMenuOpen(false);setHelpOpen(true);}}><Icon name="note" size={19}/> つかい方・機能紹介</button>
              <button className="yl-drawer-item" onClick={()=>{setMenuOpen(false);setTab("settings");}}><Icon name="settings" size={19}/> 設定</button>
            </div>
            <p className="yl-drawer-foot">LoaLife・試作版</p>
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
            {familyNotes.length===0?<p className="yl-set-desc" style={{padding:"12px 4px"}}>家族みんなで、今日のことや「ありがとう」「きもち」を残せます。</p>:(
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
        const contacts=items.filter(x=>x.type==="card"&&(x.kind==="hospital"||x.kind==="emergency")).sort((a,b)=>(a.kind==="emergency"?-1:0)-(b.kind==="emergency"?-1:0));
        return(
        <div className="yl-help-ov" onClick={()=>setEmergencyOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head">
              <h2 className="yl-help-title"><Icon name="activity" size={18}/> 夜間・救急の備え</h2>
              <button className="yl-help-close" onClick={()=>setEmergencyOpen(false)}>×</button>
            </div>
            <div className="yl-emg-alert"><Icon name="alert" size={16}/><span>受診の前に、必ずお電話を。多くの病院が事前連絡・予約制です。診療時間や番号は変わることがあります。</span></div>

            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="pin" size={15}/> あなたの緊急連絡先</span><button className="yl-linkbtn" onClick={()=>{setEmergencyOpen(false);setTab(activeMember?activeMember.id:"me");setPersonSeg&&setPersonSeg("manage");openCardNew("hospital");}}>＋ 登録</button></div>
              {contacts.length===0?(
                <p className="yl-set-desc">かかりつけ・夜間救急の病院を登録しておくと、いざという時にすぐ電話できます。「大切な情報カード」に病院メモとして保存されます。</p>
              ):(
                <ul className="yl-emg-contacts">{contacts.map(c=>{const tel=extractTel(c.body);return(
                  <li key={c.id} className="yl-emg-contact">
                    <div className="yl-emg-cbody"><span className="yl-emg-cname">{c.title||"病院"}{c.kind==="emergency"?<span className="yl-emg-tag">緊急</span>:null}</span>{c.body&&<span className="yl-emg-cnote">{c.body}</span>}<span className="yl-emg-cwho">{nameOf(c.space)}</span></div>
                    {tel?<a className="yl-emg-call" href={`tel:${tel.replace(/-/g,"")}`}><Icon name="phone" size={14}/> {tel}</a>:<button className="yl-emg-call ghost" onClick={()=>{setEmergencyOpen(false);setTab(c.space);openCardEdit(c);}}>番号を追加</button>}
                  </li>
                );})}</ul>
              )}
            </div>

            <div className="yl-emg-sec">
              <button className="yl-emg-tipshead" onClick={()=>setTipsOpen(o=>!o)}><span><Icon name="bell" size={15}/> 電話でうまく伝えるコツ</span><Icon name={tipsOpen?"chevron":"chevron"} size={16} className={tipsOpen?"yl-rot90":"yl-rot0"}/></button>
              {tipsOpen&&<ul className="yl-emg-list">{EMERGENCY_TIPS.map((t,i)=><li key={i}><span className="yl-emg-num">{i+1}</span>{t}</li>)}</ul>}
            </div>

            <div className="yl-emg-sec">
              <div className="yl-emg-sectitle"><span><Icon name="bag" size={15}/> 持っていくと安心</span></div>
              <ul className="yl-emg-prep">{EMERGENCY_PREP.map((t,i)=><li key={i}><Icon name="check" size={13}/> {t}</li>)}</ul>
            </div>

            <p className="yl-toxic-foot">※ 具体的な病院・電話番号はご自身で登録・ご確認ください。緊急時はためらわず、かかりつけや近隣の夜間救急にご連絡を。</p>
          </div>
        </div>
      );})()}
      {toxicOpen&&(
        <div className="yl-help-ov" onClick={()=>setToxicOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head">
              <h2 className="yl-help-title"><Icon name="alert" size={18}/> 誤食・中毒の危険物</h2>
              <button className="yl-help-close" onClick={()=>setToxicOpen(false)}>×</button>
            </div>
            <div className="yl-toxic-controls">
              <div className="yl-toxic-tabs">{[{k:"all",l:"すべて"},{k:"dog",l:"犬"},{k:"cat",l:"猫"}].map(o=><button key={o.k} className={"yl-toxic-tab"+(toxicSp===o.k?" on":"")} onClick={()=>setToxicSp(o.k)}>{o.l}</button>)}</div>
              <input className="yl-input sm" value={toxicQ} onChange={e=>setToxicQ(e.target.value)} placeholder="名前・症状で検索"/>
            </div>
            <ul className="yl-toxic-list">
              {TOXIC_ITEMS.filter(t=>(toxicSp==="all"||t.sp==="both"||t.sp===toxicSp)).filter(t=>{const q=toxicQ.trim();return !q||t.name.includes(q)||t.sym.includes(q)||(t.note||"").includes(q);}).map((t,i)=>(
                <li key={i} className={"yl-toxic-item lv-"+t.lv}>
                  <div className="yl-toxic-top"><span className={"yl-toxic-badge lv-"+t.lv}><Icon name={t.lv==="danger"?"ban":"alert"} size={12}/> {t.lv==="danger"?"絶対NG":"要注意"}</span><span className="yl-toxic-name">{t.name}</span>{t.sp!=="both"&&<span className="yl-toxic-sp">{t.sp==="dog"?"犬":"猫"}</span>}</div>
                  <p className="yl-toxic-sym">症状：{t.sym}</p>
                  {t.note&&<p className="yl-toxic-note">{t.note}</p>}
                </li>
              ))}
            </ul>
            <p className="yl-toxic-foot">※ 一般的な注意です。食べてしまった時は量にかかわらず、早めにかかりつけ・救急にご相談ください。</p>
          </div>
        </div>
      )}
      {helpOpen&&(
        <div className="yl-help-ov" onClick={()=>setHelpOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head">
              <h2 className="yl-help-title"><Icon name="note" size={18}/> LoaLife のつかい方</h2>
              <button className="yl-help-close" onClick={()=>setHelpOpen(false)} aria-label="閉じる">×</button>
            </div>
            <p className="yl-help-lead">家族みんな・ペット・自分の毎日を、ひとつのアプリでまとめて見守れます。主な機能を紹介します。</p>
            {[
              {emoji:"🏠",title:"ホーム",desc:"家族みんなの「今日やること」や、気にかけたいこと（期限切れ・もうすぐ）をひと目で確認できます。"},
              {emoji:"👨‍👩‍👧",title:"メンバー",desc:"自分・お子さま・ペットを追加して、それぞれの予定やケアをまとめられます。アイコンは絵文字でも写真でもOK。多頭飼いはフォルダで分類できます。"},
              {emoji:"📅",title:"カレンダー",desc:"家族みんなの予定やTodoを1か所に。メンバーごとに色を選べて、誰の予定かひと目でわかります。日付をタップしてふりかえりも。"},
              {emoji:"📝",title:"今日のようす（お薬手帳にも）",desc:"元気（5段階グラフ）・食欲・うんち・症状（熱/咳など）・写真・ひとことを残せます。お薬手帳や通院前のメモに。"},
              {emoji:"💉",title:"ケア・予定・投薬",desc:"ワクチン・投薬・通院などを登録。周期ケアは記録で次回へ自動更新。"},
              {emoji:"🧹",title:"お世話ログ",desc:"「やった」で記録。前回からの経過がひと目で分かります。"},
              {emoji:"📈",title:"からだの記録・ダイエット手帳",desc:"体重・体調をグラフで管理。目標体重の差分も表示。"},
              {emoji:"📸",title:"思い出",desc:"写真や日記がアルバムに並び、あとから振り返れます。"},
              {emoji:"🏷",title:"思い出のタグ・はじめて",desc:"思い出に #発表会 などのタグや「はじめて」を付けて、成長をあとから振り返れます。"},
              {emoji:"💰",title:"支出",desc:"病院代・餌代などをカテゴリ別に記録・グラフ化。"},
              {emoji:"🛍",title:"ストック管理",desc:"フード・トイレ用品・サプリなどの在庫を登録。なくなりそうな頃にお知らせします。"},
              {emoji:"🎒",title:"持ち物（曜日ごと）",desc:"曜日ごとの持ち物を前日にチェックリスト表示。"},
              {emoji:"📌",title:"大切な情報カード",desc:"緊急連絡先・アレルギー・かかりつけ等を写真付きカードで保存。"},
              {emoji:"🔔",title:"通知・リマインド",desc:"予定ごとに通知を設定できます（何件でもOK）。"},
              {emoji:"↕️",title:"並び替え（長押し/ドラッグ）",desc:"項目も大項目（⠿ハンドル）も長押しドラッグで並び替え。"},
            ].map((f,i)=>(
              <div key={i} className="yl-help-item">
                <span className="yl-help-emoji">{f.emoji}</span>
                <div className="yl-help-body"><span className="yl-help-itemtitle">{f.title}</span><span className="yl-help-desc">{f.desc}</span></div>
              </div>
            ))}
            <p className="yl-help-note">データはこの端末に保存されます。ホーム画面に追加して使うと、より快適で安心です。</p>
            <button className="yl-addbtn" style={{width:"100%",marginTop:6}} onClick={()=>setHelpOpen(false)}>とじる</button>
          </div>
        </div>
      )}
      {editItemId&&<div className="yl-overlay" onClick={()=>setEditItemId(null)}><div className="yl-modal edit" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">編集</h3><input className="yl-input" value={eTitle} onChange={e=>setETitle(e.target.value)} placeholder="タイトル"/><div className="yl-optrow"><label className="yl-opt">期限<input type="date" className="yl-date" value={eDate} onChange={e=>setEDate(e.target.value)}/></label><label className="yl-opt">時間<TimeInput value={eTime} onChange={setETime}/></label><label className="yl-opt">繰り返し<select className="yl-select" value={eRepeat} onChange={e=>setERepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div><div className="yl-notify"><span className="yl-notify-label"><Icon name="bell" size={14}/> 通知</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(eReminders.includes(o.key)?" on":"")} onClick={()=>toggleEReminder(o.key)}>{o.label}</button>)}</div>{eReminders.length>=4&&<p className="yl-notify-hint">🔔が多いと見落としがち。必要なぶんだけに。</p>}</div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEditItemId(null)}>閉じる</button><button className="yl-addbtn modal" onClick={saveEdit}>保存</button></div></div></div>}
      {viewer&&<div className="yl-overlay" onClick={()=>setViewer(null)}><div className="yl-modal photo" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">{viewer.isMemory?"思い出":"証明書"}</h3>{viewer.loading?<p className="yl-loading">読み込み中…</p>:viewer.src?<img className="yl-photo-img" src={viewer.src} alt={viewer.isMemory?"思い出":"証明書"}/>:<p className="yl-empty">画像が見つかりませんでした</p>}{viewer.confirming?<><p className="yl-modal-body" style={{margin:"0 0 12px"}}>この写真を削除しますか？元に戻せません。</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setViewer(v=>({...v,confirming:false}))}>やめる</button><button className="yl-modal-del" onClick={()=>viewer.isMemory?removeMemory(viewer.id):removePhoto(viewer.id)}>削除する</button></div></>:<div className="yl-modal-btns">{viewer.src&&<button className="yl-modal-cancel" onClick={()=>setViewer(v=>({...v,confirming:true}))}>削除</button>}<button className="yl-addbtn modal" onClick={()=>setViewer(null)}>閉じる</button></div>}</div></div>}
      {pickerId&&<div className="yl-overlay" onClick={()=>setPickerId(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">絵文字を選ぶ</h3><div className="yl-emoji-grid">{PICKER_EMOJIS.map(e=><button key={e} className="yl-emoji-pick" onClick={()=>setEmoji(pickerId,e)}>{e}</button>)}</div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEmoji(pickerId,"")}>絵文字なし</button><button className="yl-modal-cancel" onClick={()=>setPickerId(null)}>閉じる</button></div></div></div>}
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
            <h3 className="yl-modal-title">{lifeDraft.mode==="edit"?"記録を編集":"この日を記録"}</h3>
            {/* カテゴリ */}
            <div className="yl-typerow" style={{marginBottom:10}}>{CAL_CATS.map(c=><button key={c.key} className={"yl-chip"+(lifeDraft.category===c.key?" on":"")} style={lifeDraft.category===c.key?{background:"#E39A5C",color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setLifeDraft(p=>({...p,category:c.key}))}>{c.emoji} {c.label}</button>)}</div>
            {/* 誰の */}
            <div className="yl-typerow" style={{marginBottom:10}}>{spaces.map(s=><button key={s.id} className={"yl-chip yl-chip-person"+(lifeDraft.space===s.id?" on":"")} style={lifeDraft.space===s.id?{background:"#D98A4E",color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setLifeDraft(p=>({...p,space:s.id}))}>{avatarNode(s,"xs")} {s.name}</button>)}</div>
            <input className="yl-input" value={lifeDraft.title} onChange={e=>setLifeDraft(p=>({...p,title:e.target.value}))} placeholder={lifeDraft.category==="event"?"予定のタイトル（例：病院）":"ひとこと（任意・例：はじめて海へ）"}/>
            {/* 写真（複数可・証明書/処方箋もここに） */}
            <div className="yl-life-photos">
              {lifeDraft.photos.map(p=>(
                <div key={p.id} className="yl-life-thumb">
                  <img src={p.dataUrl} alt=""/>
                  <button className="yl-life-thumb-del" onClick={()=>removeLifePhoto(p.id)} aria-label="削除">×</button>
                </div>
              ))}
              <label className="yl-life-addphoto">＋<span>写真</span><input type="file" accept="image/*" multiple style={{display:"none"}} onChange={pickLifePhoto}/></label>
            </div>
            <textarea className="yl-life-note" value={lifeDraft.note} onChange={e=>setLifeDraft(p=>({...p,note:e.target.value}))} placeholder="日記（長文・任意）" rows={3}/>
            {lifeDraft.category==="memory"&&(()=>{
              const tags=lifeDraft.tags||[];
              const addTag=(t)=>{const v=(t||"").replace(/^#/,"").trim();if(!v||tags.includes(v))return;setLifeDraft(p=>({...p,tags:[...(p.tags||[]),v]}));setTagInput("");};
              return(
                <div className="yl-tagedit">
                  <span className="yl-tagedit-label"><Icon name="tag" size={14}/> タグ</span>
                  <div className="yl-tagedit-chips">
                    {tags.map(t=><span key={t} className="yl-tagedit-chip">#{t}<button onClick={()=>setLifeDraft(p=>({...p,tags:p.tags.filter(x=>x!==t)}))} aria-label="削除">×</button></span>)}
                    {!tags.includes(FIRST_TAG)&&<button className="yl-tagedit-quick" onClick={()=>addTag(FIRST_TAG)}><Icon name="sparkles" size={13}/> はじめて</button>}
                  </div>
                  <div className="yl-tagedit-add"><input className="yl-input sm" value={tagInput} onChange={e=>setTagInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addTag(tagInput);}}} placeholder="例：発表会 / お弁当 / 自転車"/><button className="yl-addbtn sm" onClick={()=>addTag(tagInput)}>追加</button></div>
                </div>
              );
            })()}
            <div className="yl-optrow"><label className="yl-opt">日付<input type="date" className="yl-date" value={lifeDraft.date} onChange={e=>setLifeDraft(p=>({...p,date:e.target.value}))}/></label><label className="yl-opt">時間<TimeInput value={lifeDraft.time} onChange={t=>setLifeDraft(p=>({...p,time:t}))}/></label>{lifeDraft.category==="event"&&<label className="yl-opt">繰り返し<select className="yl-select" value={lifeDraft.repeat} onChange={e=>setLifeDraft(p=>({...p,repeat:e.target.value}))}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label>}</div>
            {/* 通知は「予定」のときだけ。思い出・日記は過去の記録なので事前通知は表示しない */}
            {lifeDraft.category==="event"&&<div className="yl-notify"><span className="yl-notify-label"><Icon name="bell" size={14}/> 通知（任意）{notifPerm==="default"&&<button className="yl-notif-small" onClick={handleNotifRequest}>許可する</button>}</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(lifeDraft.reminders.includes(o.key)?" on":"")} onClick={()=>toggleLifeReminder(o.key)}>{o.label}</button>)}</div>{lifeDraft.reminders.length>=4&&<p className="yl-notify-hint">🔔が多いと見落としがち。必要なぶんだけに。</p>}</div>}
            <div className="yl-modal-btns">
              {lifeDraft.mode==="edit"&&<button className="yl-modal-cancel" onClick={()=>askDelete(lifeDraft.title,()=>removeLife(lifeDraft.id))}>削除</button>}
              <button className="yl-modal-cancel" onClick={()=>setLifeDraft(null)}>閉じる</button>
              <button className="yl-addbtn modal" onClick={saveLife}>保存</button>
            </div>
          </div>
        </div>
      )}
      {cardEdit&&(
        <div className="yl-overlay" onClick={()=>setCardEdit(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name={cardIcon(cardEdit.kind)} size={18}/> {cardEdit.id?"カードを編集":"カードを追加"}</h3>
            <div className="yl-typerow" style={{marginBottom:10}}>{CARD_PRESETS.map(p=><button key={p.key} className={"yl-chip"+(cardEdit.kind===p.key?" on":"")} style={cardEdit.kind===p.key?{background:"#D98A4E",color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setCardEdit(c=>({...c,kind:p.key,title:c.title||cardMeta(p.key).label}))}><Icon name={cardIcon(p.key)} size={14}/> {p.label}</button>)}</div>
            <input className="yl-input" value={cardEdit.title} onChange={e=>setCardEdit(c=>({...c,title:e.target.value}))} placeholder="タイトル（例：かかりつけ病院）"/>
            <textarea className="yl-life-note" value={cardEdit.body} onChange={e=>setCardEdit(c=>({...c,body:e.target.value}))} placeholder="連絡先・アレルギー・注意点・お薬の残り期間など" rows={4}/>
            <div className="yl-life-photos">
              {cardEdit.photo?<div className="yl-life-thumb"><img src={cardEdit.photo} alt=""/><button className="yl-life-thumb-del" onClick={()=>setCardEdit(c=>({...c,photo:null,photoNew:true}))} aria-label="削除">×</button></div>:<label className="yl-life-addphoto">＋<span>写真</span><input type="file" accept="image/*" style={{display:"none"}} onChange={pickCardPhoto}/></label>}
            </div>
            <div className="yl-modal-btns">
              {cardEdit.id&&<button className="yl-modal-cancel" onClick={()=>askDelete(cardEdit.title,()=>removeCard(cardEdit.id))}>削除</button>}
              <button className="yl-modal-cancel" onClick={()=>setCardEdit(null)}>閉じる</button>
              <button className="yl-addbtn modal" onClick={saveCard}>保存</button>
            </div>
          </div>
        </div>
      )}
      {expEdit&&(
        <div className="yl-overlay" onClick={()=>setExpEdit(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">支出を編集</h3>
            <div className="yl-exp-input"><span className="yl-exp-amt"><span className="yl-exp-yen">¥</span><input type="number" inputMode="numeric" className="yl-health-num" value={expEdit.amount} onChange={e=>setExpEdit(x=>({...x,amount:e.target.value}))} placeholder="金額"/></span><select className="yl-select" value={expEdit.category} onChange={e=>setExpEdit(x=>({...x,category:e.target.value}))}>{(()=>{const cats=expenseCatsFor(curKind);const has=cats.some(c=>c.key===expEdit.category);return(has?cats:[...cats,expCatMeta(expEdit.category)]).map(c=><option key={c.key} value={c.key}>{c.emoji} {c.label}</option>);})()}</select></div>
            <input className="yl-input" style={{marginTop:10}} value={expEdit.note} onChange={e=>setExpEdit(x=>({...x,note:e.target.value}))} placeholder="メモ（任意）"/>
            <label className="yl-opt" style={{marginTop:10}}>日付（レシート遅れ・代理入力などの修正用）<input type="date" className="yl-date" value={expEdit.date} onChange={e=>setExpEdit(x=>({...x,date:e.target.value}))}/></label>
            <div className="yl-modal-btns">
              <button className="yl-modal-cancel" onClick={()=>askDelete(`${fmtDate(expEdit.date)}の支出`,()=>{removeExpense(expEdit.id);setExpEdit(null);})}>削除</button>
              <button className="yl-modal-cancel" onClick={()=>setExpEdit(null)}>閉じる</button>
              <button className="yl-addbtn modal" onClick={saveExpEdit}>保存</button>
            </div>
          </div>
        </div>
      )}
      {/* ＝＝＝ ＋入力ハブから開く入力モーダル（全入力を集約） ＝＝＝ */}
      {inputSheet==="schedule"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{isMemberTab?"ケア・予定を追加":"予定・ToDoを追加"}</h3>
            {!isMemberTab?<div className="yl-typerow me4">{ME_TYPES.map(t=><button key={t} className={"yl-chip"+(draftType===t?" on":"")} style={draftType===t?{background:TYPE_META[t].fg,color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setDraftType(t)}><Icon name={TYPE_ICON[t]} size={15}/> {TYPE_META[t].label}</button>)}</div>:<div className="yl-typerow">{careKindsFor(activeMember).map(k=><button key={k.key} className={"yl-chip"+(draftKind===k.key?" on":"")} style={draftKind===k.key?{background:KIND_STYLE[activeMember.kind].fg,color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>pickCareKind(k)}><Icon name={careIcon(k.key)} size={15}/> {k.label}</button>)}</div>}
            {suggestions.length>0&&<div className="yl-suggest"><span className="yl-suggest-label">よく使う</span><div className="yl-suggest-chips">{suggestions.map(s=><button key={s} className="yl-suggest-chip" onClick={()=>{setDraft(s);setDraftAuto(false);}}>{s}</button>)}</div></div>}
            <div className="yl-add"><input className="yl-input" value={draft} onChange={e=>{setDraft(e.target.value);setDraftAuto(false);}} onKeyDown={e=>e.key==="Enter"&&addItem()} placeholder={isMemberTab?(draftKind==="other"?"内容を入力…":`${(careKindsFor(activeMember).find(k=>k.key===draftKind)||{}).label||"内容"}を追加…`):`${TYPE_META[draftType].label}を追加…`}/><button className="yl-addbtn" onClick={addItem}>追加</button></div>
            <div className="yl-optrow"><label className="yl-opt">{isMemberTab?"期限":"日付・期限（任意）"}<input type="date" className="yl-date" value={draftDate} onChange={e=>setDraftDate(e.target.value)}/></label><label className="yl-opt">時間<TimeInput value={draftTime} onChange={setDraftTime}/></label><label className="yl-opt">繰り返し<select className="yl-select" value={draftRepeat} onChange={e=>setDraftRepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div>
            {!isMemberTab&&<p className="yl-foot" style={{marginTop:2}}>日付・期限を入れると、その日のカレンダーに表示されます。</p>}
            <div className="yl-notify"><span className="yl-notify-label"><Icon name="bell" size={14}/> 通知{notifPerm==="default"&&<button className="yl-notif-small" onClick={handleNotifRequest}>許可する</button>}</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(draftReminders.includes(o.key)?" on":"")} onClick={()=>toggleReminder(o.key)}>{o.label}</button>)}</div>{draftReminders.length>=4&&<p className="yl-notify-hint">🔔が多いと見落としがち。必要なぶんだけに。</p>}</div>
            {isMemberTab&&<div className="yl-quickbar" style={{marginTop:12}}><p className="yl-quickbar-label">1タップ追加（前回コピー）</p><div className="yl-quickbar-grid">{careKindsFor(activeMember).map(k=>{const prev=lastDates[k.key];return(<button key={k.key} className="yl-quickbar-item" onClick={()=>{openQuickAdd(k.key,k.emoji,k.label,activeMember.id,prev?.dueDate,prev?.repeat);setInputSheet(null);}}><span className="yl-quickbar-ico"><Icon name={careIcon(k.key)} size={20}/></span><span className="yl-quickbar-info"><span className="yl-quickbar-name">{k.label}</span><span className="yl-quickbar-prev">{prev?`前回 ${fmtDate(prev.dueDate)}`:"─"}</span></span><span className="yl-quickbar-plus">＋</span></button>);})}</div></div>}
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
      )}
      {inputSheet==="health"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">からだの記録</h3>
            <div className="yl-health-input">
              <label className="yl-opt">体重<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={healthW} onChange={e=>setHealthW(e.target.value)} placeholder={weightUnit==="g"?"25.3":"0.0"}/>{isMemberTab?<span className="yl-health-uswitch"><button className={"yl-health-ubtn"+(weightUnit==="kg"?" on":"")} onClick={()=>setMemberWeightUnit("kg")}>kg</button><button className={"yl-health-ubtn"+(weightUnit==="g"?" on":"")} onClick={()=>setMemberWeightUnit("g")}>g</button></span>:<span className="yl-health-unit">kg</span>}</span></label>
              {isMemberTab&&<label className="yl-opt">身長<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={healthH} onChange={e=>setHealthH(e.target.value)} placeholder="0.0"/><span className="yl-health-unit">cm</span></span></label>}
            </div>
            {isMemberTab&&activeMember&&activeMember.personType==="senior"&&(
              <div className="yl-vital-input">
                <label className="yl-opt">血圧<span className="yl-health-field yl-bp-field"><input type="number" inputMode="numeric" className="yl-health-num" value={healthBpS} onChange={e=>setHealthBpS(e.target.value)} placeholder="上"/><span className="yl-bp-sep">/</span><input type="number" inputMode="numeric" className="yl-health-num" value={healthBpD} onChange={e=>setHealthBpD(e.target.value)} placeholder="下"/><span className="yl-health-unit">mmHg</span></span></label>
                <label className="yl-opt">体温<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={healthTemp} onChange={e=>setHealthTemp(e.target.value)} placeholder="36.5"/><span className="yl-health-unit">℃</span></span></label>
                <label className="yl-opt">血糖値<span className="yl-health-field"><input type="number" inputMode="numeric" className="yl-health-num" value={healthGlucose} onChange={e=>setHealthGlucose(e.target.value)} placeholder="任意"/><span className="yl-health-unit">mg/dL</span></span></label>
              </div>
            )}
            {isMemberTab&&weightUnit==="g"&&<p className="yl-health-hint">小動物は0.1g単位</p>}
            {isMemberTab&&(<div className="yl-health-conds"><span className="yl-health-clabel">体調</span>{HEALTH_CONDS.map(c=><button key={c.key} className={"yl-health-cond"+(healthCond===c.key?" on":"")} onClick={()=>setHealthCond(healthCond===c.key?"":c.key)}>{c.emoji} {c.label}</button>)}</div>)}
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:6}} onClick={saveHealth}><Icon name="scale" size={16}/> からだを記録</button>
            {isMemberTab&&<label className="yl-opt" style={{flexDirection:"row",alignItems:"center",gap:8,marginTop:14}}><Icon name="target" size={14}/> 目標体重<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={targetWeight} onChange={e=>setMemberTarget(e.target.value)} placeholder={weightUnit==="g"?"25.3":"0.0"}/><span className="yl-health-unit">{weightUnit}</span></span></label>}
            {isMemberTab&&<p className="yl-health-hint" style={{marginTop:4}}>目標との差（ダイエット手帳）を表示。</p>}
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
      )}
      {inputSheet==="toilet"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="droplet" size={18}/> トイレ記録</h3>
            <p className="yl-diary-hint">タップで記録（今日・現在時刻）。</p>
            <div className="yl-toilet-row">
              <span className="yl-toilet-label"><Icon name="droplet" size={15}/> おしっこ</span>
              <button className="yl-toilet-btn ok" onClick={()=>logToilet("pee",true)}>✓ 成功</button>
              <button className="yl-toilet-btn ng" onClick={()=>logToilet("pee",false)}>✕ 失敗</button>
            </div>
            <div className="yl-toilet-row">
              <span className="yl-toilet-label"><Icon name="droplet" size={15}/> うんち</span>
              <button className="yl-toilet-btn ok" onClick={()=>logToilet("poop",true,bristolScore)}>✓ 成功</button>
              <button className="yl-toilet-btn ng" onClick={()=>logToilet("poop",false)}>✕ 失敗</button>
            </div>
            <div className="yl-bristol">
              <span className="yl-toilet-condlabel">うんちの硬さ（7段階）</span>
              <p className="yl-bristol-note">4がいちばん健康的（形があり、なめらか）。1や7に近い状態が続くときは、獣医さんに相談を。</p>
              <button className="yl-poop-alert" onClick={()=>{setInputSheet(null);setToxicSp("all");setToxicQ("");setToxicOpen(true);}}>
                <span className="yl-poop-alert-body"><Icon name="alert" size={14}/> 気をつけたいこと：消化管異物・腸閉塞・中毒</span>
                <span className="yl-poop-alert-link">危険物リストで詳しく<Icon name="chevron" size={14}/></span>
              </button>
              <ul className="yl-poop-scale">{BRISTOL.map(bb=>(
                <li key={bb.n}><button className={"yl-poop-card tone-"+bb.tone+(bristolScore===bb.n?" on":"")} onClick={()=>setBristolScore(bb.n)}>
                  <span className={"yl-poop-num tone-"+bb.tone}>{bb.n}</span>
                  <span className="yl-poop-illust"><PoopShape n={bb.n} size={34}/></span>
                  <span className="yl-poop-text"><span className="yl-poop-label">{bb.label}{bb.n===4?"（理想的）":""}</span><span className="yl-poop-desc">{bb.desc}</span></span>
                  {bristolScore===bb.n&&<span className="yl-poop-check"><Icon name="check" size={15}/></span>}
                </button></li>
              ))}</ul>
            </div>
            {poopTrend&&<p className={"yl-bristol-warn tone-"+poopTrend.tone}><Icon name="alert" size={13}/> {poopTrend.txt}</p>}
            <p className="yl-health-hint" style={{marginTop:10}}>便の硬さは受診目安の一次情報です（診断ではありません）。</p>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
      )}
      {vetOpen&&activeMember&&vetSummary&&(
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
                  <li>種別：{activeMember.species==="cat"?"猫":activeMember.species==="other"?"その他":"犬"}</li>
                  {activeMember.birthday&&<li>誕生日：{fmtBirthday(activeMember.birthday)}{ageLabel(activeMember.birthday)?`（${ageLabel(activeMember.birthday)}）`:""}</li>}
                  {activeMember.microchip&&<li>マイクロチップ：{activeMember.microchip}</li>}
                </ul></div>
                <div className="yl-vetsum-sec"><h3>体重</h3>{vetSummary.wLatest?<ul>
                  <li>最新：{vetSummary.wLatest.weight}{vetSummary.wLatest.wunit||"kg"}（{fmtDate(vetSummary.wLatest.date)}）</li>
                  {vetSummary.wFirst&&vetSummary.wFirst!==vetSummary.wLatest&&<li>期間の変化：{(vetSummary.wLatest.weight-vetSummary.wFirst.weight>=0?"+":"")}{Math.round((vetSummary.wLatest.weight-vetSummary.wFirst.weight)*10)/10}{vetSummary.wLatest.wunit||"kg"}（{fmtDate(vetSummary.wFirst.date)}比）</li>}
                </ul>:<p className="yl-vetsum-none">記録なし</p>}</div>
                <div className="yl-vetsum-sec"><h3>トイレ</h3><ul>
                  <li>おしっこ成功率：{vetSummary.pee.total?`${vetSummary.pee.rate}%（${vetSummary.pee.total}回）`:"記録なし"}</li>
                  <li>うんち成功率：{vetSummary.poop.total?`${vetSummary.poop.rate}%（${vetSummary.poop.total}回）`:"記録なし"}</li>
                  {vetSummary.brAvg!=null&&<li>うんちの硬さ平均：{vetSummary.brAvg}／7{bristolMeta(Math.round(vetSummary.brAvg))?`（${bristolMeta(Math.round(vetSummary.brAvg)).label}）`:""}</li>}
                </ul></div>
                <div className="yl-vetsum-sec"><h3>症状</h3>{vetSummary.symList.length?<ul>{vetSummary.symList.map(s=><li key={s.k}>{s.label} × {s.n}回</li>)}</ul>:<p className="yl-vetsum-none">記録なし</p>}</div>
                <div className="yl-vetsum-sec"><h3>予防・ワクチン等の次回予定</h3>{vetSummary.careNext.length?<ul>{vetSummary.careNext.map((c,i)=><li key={i}>{c.emoji} {c.title}：{fmtDate(c.date)}</li>)}</ul>:<p className="yl-vetsum-none">予定なし</p>}</div>
                <div className="yl-vetsum-sec"><h3>最近のお世話</h3>{vetSummary.chores.length?<ul>{vetSummary.chores.map((c,i)=><li key={i}>{c.emoji} {c.title}：{fmtDate(c.date)}</li>)}</ul>:<p className="yl-vetsum-none">記録なし</p>}</div>
              </div>
              <p className="yl-vetsum-note">※本サマリーは飼い主の記録に基づくもので、診断ではありません。</p>
            </div>
            <div className="yl-modal-btns yl-noprint">
              <button className="yl-modal-cancel" onClick={()=>setVetOpen(false)}>とじる</button>
              <button className="yl-addbtn modal" onClick={()=>window.print()}><Icon name="printer" size={17}/> 印刷・PDF保存</button>
            </div>
          </div>
        </div>
      )}
      {inputSheet==="feed"&&(()=>{
        const baseNow=feedServing.trim()!==""&&Number(feedServing)>0?Number(feedServing):servingG;
        const previewG=feedUnit==="serving"&&baseNow?Math.round(feedMult*baseNow):null;
        return(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">ごはんの記録</h3>
            <div className="yl-feed-units">{feedUnitsOrdered.map(u=><button key={u.k} className={"yl-feed-unit"+(feedUnit===u.k?" on":"")} onClick={()=>setFeedUnit(u.k)}>{u.l}</button>)}</div>
            {feedUnit==="serving"?(<>
              <label className="yl-opt" style={{marginTop:12}}>1回分の量<span className="yl-health-field"><input type="number" inputMode="numeric" className="yl-health-num" value={feedServing} onChange={e=>setFeedServing(e.target.value)} placeholder="例：100"/><span className="yl-health-unit">g</span></span></label>
              <p className="yl-health-hint" style={{marginTop:4}}>{baseNow?`1回分＝${baseNow}g として総量に反映します（初回だけ設定すればOK）`:"未設定でも記録できます（設定すると総量に反映）"}</p>
              <p className="yl-feed-mlabel">分量</p>
              <div className="yl-feed-mults">{[0.5,1,1.5,2].map(m=><button key={m} className={"yl-feed-mult"+(feedMult===m?" on":"")} onClick={()=>setFeedMult(m)}>×{m}</button>)}</div>
              {previewG!=null&&<p className="yl-feed-preview">＝ 約 <b>{previewG}g</b>（{feedMult}回分）</p>}
            </>):(
              <label className="yl-opt" style={{marginTop:12}}>分量<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={feedAmt} onChange={e=>setFeedAmt(e.target.value)} placeholder="0" autoFocus/><span className="yl-health-unit">{feedUnitLabel(feedUnit)}</span></span></label>
            )}
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:14}} onClick={saveFeed}><Icon name="utensils" size={16}/> ごはんを記録</button>
            {feedTodayG>0&&<p className="yl-feed-today">今日の合計 約{feedTodayG}g（{feedToday.length}回）</p>}
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
        );})()}
      {inputSheet==="diary"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">今日のようす</h3>
            {!todayHasCond(tab)&&<button className="yl-quick-big" style={{marginBottom:12}} onClick={()=>{quickHealthy(tab);setInputSheet(null);}}><Icon name="check" size={18}/> 今日も元気（ワンタップで完了）</button>}
            <p className="yl-diary-hint">くわしく残すときだけ（任意）。</p>
            {(()=>{const dcfg=diaryConfigFor(diaryTypeOf(tab));const has=k=>dcfg.rows.includes(k);return(<>
            {has("energy")&&<div className="yl-diary-row"><span className="yl-diary-label">元気</span><span className="yl-diary-chips">{DIARY_ENERGY.map(c=><button key={c.key} className={"yl-diary-chip"+(diaryDraft.energy===c.key?" on":"")} onClick={()=>setDiary({energy:diaryDraft.energy===c.key?"":c.key})}><Icon name={ENERGY_ICON[c.key]} size={15}/> {c.label}</button>)}</span></div>}
            {has("appetite")&&<div className="yl-diary-row"><span className="yl-diary-label">食欲</span><span className="yl-diary-chips">{DIARY_APPETITE.map(c=><button key={c.key} className={"yl-diary-chip"+(diaryDraft.appetite===c.key?" on":"")} onClick={()=>setDiary({appetite:diaryDraft.appetite===c.key?"":c.key})}><Icon name="utensils" size={15}/> {c.label}</button>)}</span></div>}
            {has("poop")&&<div className="yl-diary-row"><span className="yl-diary-label">うんち</span><span className="yl-diary-chips">{DIARY_POOP.map(c=><button key={c.key} className={"yl-diary-chip"+(diaryDraft.poop===c.key?" on":"")} onClick={()=>setDiary({poop:diaryDraft.poop===c.key?"":c.key})}><Icon name={POOP_DIARY_ICON[c.key]} size={15}/> {c.label}</button>)}</span></div>}
            {has("sleep")&&<div className="yl-diary-row"><span className="yl-diary-label">睡眠</span><span className="yl-diary-chips">{["9","10","11","12"].map(h=><button key={h} className={"yl-diary-chip"+(diaryDraft.sleep===h?" on":"")} onClick={()=>setDiary({sleep:diaryDraft.sleep===h?"":h})}><Icon name="moon" size={15}/> {h}時間</button>)}<span className="yl-diary-sleepnum"><input type="number" inputMode="numeric" min="0" max="24" className="yl-health-num" value={diaryDraft.sleep} onChange={e=>setDiary({sleep:e.target.value})} placeholder="時間"/>時間</span></span></div>}
            {(has("walk")||has("hospital"))&&<div className="yl-diary-row"><span className="yl-diary-label">その他</span><span className="yl-diary-chips">{has("walk")&&<button className={"yl-diary-chip"+(diaryDraft.walk?" on":"")} onClick={()=>setDiary({walk:!diaryDraft.walk})}><Icon name="paw" size={15}/> さんぽ・おでかけ</button>}{has("hospital")&&<button className={"yl-diary-chip"+(diaryDraft.hospital?" on":"")} onClick={()=>setDiary({hospital:!diaryDraft.hospital})}><Icon name="activity" size={15}/> 病院に行った</button>}</span></div>}
            {dcfg.symptoms.length>0&&<div className="yl-diary-row"><span className="yl-diary-label">症状</span><span className="yl-diary-chips">{dcfg.symptoms.map(sk=>{const s=SYMPTOMS[sk];return s&&<button key={sk} className={"yl-diary-chip"+((diaryDraft.symptoms||[]).includes(sk)?" on sym":"")} onClick={()=>toggleSymptom(sk)}><Icon name={symIcon(sk)} size={15}/> {s.label}</button>;})}</span></div>}
            {dcfg.symptoms.includes("period")&&(()=>{const periodSel=(diaryDraft.symptoms||[]).includes("period");const fc=periodForecast(tab);const showFc=fc&&fc.next;if(!periodSel&&!showFc)return null;return(<div className="yl-period-inline">
              {periodSel&&<p className="yl-period-priv"><Icon name="shield" size={13}/> 本人だけの記録です</p>}
              {showFc&&<p className="yl-period-note"><Icon name="heart" size={13}/> 前回 {fmtDate(fc.last)}・次はそろそろ {fmtDate(fc.next)}ごろ（約{fc.avg}日周期）</p>}
            </div>);})()}
            </>);})()}
            <input className="yl-input sm" style={{width:"100%",boxSizing:"border-box",marginTop:4}} value={diaryDraft.note} onChange={e=>setDiary({note:e.target.value})} placeholder="日々の様子・病院でのこと・ひとこと…"/>
            <div className="yl-diary-photorow">{diaryDraft.photo?<span className="yl-diary-thumb"><img src={diaryDraft.photo} alt=""/><button className="yl-diary-thumbdel" onClick={()=>setDiary({photo:null})} aria-label="写真を削除">×</button></span>:<label className="yl-diary-addphoto"><Icon name="camera" size={14}/> 写真を追加（お薬・症状など）<input type="file" accept="image/*" style={{display:"none"}} onChange={pickDiaryPhoto}/></label>}</div>
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:8}} onClick={saveDiary}>今日のようすを記録</button>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
      )}
      {inputSheet==="expense"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">支出を記録</h3>
            <div className="yl-exp-input"><span className="yl-exp-amt"><span className="yl-exp-yen">¥</span><input type="number" inputMode="numeric" className="yl-health-num" value={expAmount} onChange={e=>setExpAmount(e.target.value)} placeholder="金額"/></span><select className="yl-select" value={expenseCatsFor(curKind).some(c=>c.key===expCat)?expCat:expenseCatsFor(curKind)[0].key} onChange={e=>setExpCat(e.target.value)}>{expenseCatsFor(curKind).map(c=><option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}</select></div>
            <input className="yl-input sm" style={{width:"100%",boxSizing:"border-box",marginTop:6}} value={expNote} onChange={e=>setExpNote(e.target.value)} placeholder="メモ（任意）"/>
            <p className="yl-foot" style={{margin:"8px 0 0",textAlign:"left"}}>今日の日付で記録。修正は明細をタップ。</p>
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:8}} onClick={saveExpense}>支出を記録</button>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
      )}
      {inputSheet==="belong"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="bag" size={18}/> 持ち物を追加</h3>
            <div className="yl-belong-add">
              <select className="yl-select" value={belongDow} onChange={e=>setBelongDow(Number(e.target.value))}>{WEEKDAYS_JA.map((w,i)=><option key={i} value={i}>{w}曜</option>)}</select>
              <input className="yl-input sm" value={belongDraft} onChange={e=>setBelongDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addBelonging()} placeholder="例：体操服 / 図書の本 / 習字道具"/>
              <button className="yl-addbtn sm" onClick={addBelonging}>追加</button>
            </div>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
      )}
      {inputSheet==="bday"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title"><Icon name="cake" size={18}/> 誕生日・記念日を追加</h3>
            <input className="yl-input" value={friendBdayName} onChange={e=>setFriendBdayName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addFriendBday()} placeholder="名前・予定（例：ゆいの誕生日）"/>
            <label className="yl-opt" style={{marginTop:10}}>日付（年は任意）<BdayInput value={friendBdayDate} onChange={setFriendBdayDate}/></label>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button><button className="yl-addbtn modal" onClick={addFriendBday}><Icon name="cake" size={15}/> 追加</button></div>
          </div>
        </div>
      )}
      {/* ＋入力ハブ：何を記録するか選ぶ。よく使う→たまに→まだ使っていない、の順 */}
      {hubOpen&&(()=>{
        const has=(t)=>items.some(x=>x.space===tab&&x.type===t);
        const open=(fn)=>{setHubOpen(false);fn();};
        const OPTS=[
          {key:"schedule",icon:"calendar",label:isMemberTab?"ケア・予定":"予定・ToDo",freq:1,used:isMemberTab?items.some(x=>x.space===tab&&x.type==="care"):items.some(x=>x.space==="me"&&ME_TYPES.includes(x.type)),act:()=>setInputSheet("schedule")},
          {key:"diary",icon:"note",label:"今日のようす",freq:1,used:has("diary"),act:()=>setInputSheet("diary")},
          ...(curKind==="pet"?[{key:"feed",icon:"utensils",label:"ごはん",freq:1,used:has("feed"),act:openFeed}]:[]),
          ...(curKind==="pet"?[{key:"toilet",icon:"paw",label:"トイレ記録",freq:1,used:has("toilet"),act:()=>setInputSheet("toilet")}]:[]),
          {key:"routine",icon:"repeat",label:"ルーティン（習慣）",freq:1,used:has("routine"),act:openRoutineCustom},
          {key:"health",icon:"scale",label:"体重・からだ",freq:2,used:has("health"),act:()=>setInputSheet("health")},
          {key:"expense",icon:"wallet",label:"支出",freq:2,used:has("expense"),act:()=>setInputSheet("expense")},
          {key:"memory",icon:"camera",label:"思い出",freq:2,used:has("memory"),act:()=>openLifeNew(todayIso,tab)},
          {key:"supply",icon:"package",label:"ストック",freq:3,used:has("supply"),act:openSupplyCustom},
          {key:"card",icon:"pin",label:"大切な情報",freq:3,used:has("card"),act:()=>openCardNew("other")},
          ...(curKind==="person"?[{key:"belong",icon:"bag",label:"持ち物（曜日）",freq:3,used:has("belonging"),act:()=>setInputSheet("belong")}]:[]),
          ...(!isMemberTab?[{key:"bday",icon:"gift",label:"誕生日・記念日",freq:3,used:items.some(x=>x.space==="me"&&x.type==="bday"),act:()=>setInputSheet("bday")}]:[]),
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
              <div className="yl-hub-head"><h3 className="yl-hub-title">何を記録しますか？</h3><span className="yl-hub-who">{nameOf(tab)}</span></div>
              <Grid list={core}/>
              {addable.length>0&&(
                <div className="yl-hub-add">
                  <p className="yl-hub-add-label">追加できる機能</p>
                  <div className="yl-hub-grid">
                    {addable.map(o=><button key={o.key} className="yl-hub-item addable" onClick={()=>{addToMenu(o.key);open(o.act);}}><span className="yl-hub-addbadge"><Icon name="plus" size={12}/></span><span className="yl-hub-emoji"><Icon name={o.icon} size={24}/></span><span className="yl-hub-label">{o.label}</span></button>)}
                  </div>
                </div>
              )}
              <button className="yl-hub-close" onClick={()=>setHubOpen(false)}>とじる</button>
            </div>
          </div>
        );
      })()}
      {confirmAct&&<div className="yl-overlay" onClick={()=>setConfirmAct(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji"><Icon name="trash" size={30}/></div><h3 className="yl-modal-title">本当に削除しますか？</h3>{confirmAct.label?<p className="yl-modal-body">「{confirmAct.label}」を削除します。この操作は元に戻せません。</p>:<p className="yl-modal-body">この操作は元に戻せません。</p>}<div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmAct(null)}>キャンセル</button><button className="yl-modal-del" onClick={()=>{const f=confirmAct.fn;setConfirmAct(null);f&&f();}}>削除する</button></div></div></div>}
      {confirmReset&&<div className="yl-overlay" onClick={()=>setConfirmReset(false)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji"><Icon name="alert" size={30}/></div><h3 className="yl-modal-title">本当に消して良いですか？</h3><p className="yl-modal-body">登録した予定・ケア・消耗品・家族の情報がすべて消えて、最初の状態に戻ります。この操作は元に戻せません。</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmReset(false)}>キャンセル</button><button className="yl-modal-del" onClick={()=>{setConfirmReset(false);resetApp();}}>消して最初から</button></div></div></div>}
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
              <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setCalPicker(null)}>閉じる</button></div>
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
              <button className="yl-modal-cancel" onClick={()=>setRoutineEdit(null)}>閉じる</button>
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
              <button className="yl-modal-cancel" onClick={()=>setSupplyEdit(null)}>閉じる</button>
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
