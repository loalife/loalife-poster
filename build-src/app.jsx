import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { FB_READY, fbAuth, fbDb } from "./firebase";
import {
  GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged
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
const fmtBirthday = (s) => { if(!s)return""; const[,mo,d]=s.split("-").map(Number); return`${mo}月${d}日`; };

const TYPE_META={dream:{label:"夢",emoji:"🌈",bg:"#FFE0EC",fg:"#FF2D7E"},work:{label:"仕事",emoji:"💼",bg:"#E6E8FB",fg:"#4F5BD5"},event:{label:"予定",emoji:"📅",bg:"#ECE3FF",fg:"#7C4DFF"},social:{label:"飲み会",emoji:"🍻",bg:"#FFE7D6",fg:"#E8730C"},habit:{label:"習慣",emoji:"💪",bg:"#FFF4D6",fg:"#D99400"}};
const ME_TYPES=["dream","work","event","social","habit"];
const KIND_STYLE={pet:{bg:"#DBF6F1",fg:"#0E9E8E",word:"ケア"},person:{bg:"#E3EEFF",fg:"#3B7BF6",word:"予定"}};
// 安心ステータスのレベル：OK / 注意 / 要対応
const LEVEL_META={ok:{label:"OK",dot:"#2FC9A8"},warn:{label:"注意",dot:"#F0A500"},alert:{label:"要対応",dot:"#E5484D"}};
const DOG_KINDS=[{key:"daycare",label:"保育園",emoji:"🏫"},{key:"vaccine",label:"ワクチン",emoji:"💉"},{key:"rabies",label:"狂犬病",emoji:"🐕"},{key:"filaria",label:"フィラリア",emoji:"🦟"},{key:"trim",label:"トリミング",emoji:"✂️"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const CAT_KINDS=[{key:"vaccine",label:"ワクチン",emoji:"💉"},{key:"filaria",label:"フィラリア",emoji:"🦟"},{key:"trim",label:"トリミング",emoji:"✂️"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const OTHER_PET_KINDS=[{key:"checkup",label:"健康診断",emoji:"🩺"},{key:"groom",label:"お手入れ",emoji:"🧼"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const PERSON_KINDS=[{key:"lesson",label:"習い事",emoji:"🎒"},{key:"event",label:"予定",emoji:"📅"},{key:"school",label:"学校行事",emoji:"🏫"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"dental",label:"歯科",emoji:"🦷"},{key:"checkup",label:"健康診断",emoji:"🩺"},{key:"vaccine",label:"予防接種",emoji:"💉"},{key:"other",label:"その他",emoji:"✨"}];
const SPECIES=[{key:"dog",label:"犬",emoji:"🐶"},{key:"cat",label:"猫",emoji:"🐱"},{key:"other",label:"その他",emoji:"🐹"}];
const HIGH_KINDS=new Set(["vaccine","filaria","rabies","hospital","checkup"]);
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
      if(isHigh&&d!==null&&d<=CARE_NOTIFY_DAYS)
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

const careKindsFor=(m)=>{if(!m)return[];if(m.kind==="person")return PERSON_KINDS;if(m.species==="cat")return CAT_KINDS;if(m.species==="other")return OTHER_PET_KINDS;return DOG_KINDS;};

const EMOJI_RULES=[[["目","眼","メガネ","視力","コンタクト"],"👁️"],[["マラソン","ラン","走","ジョギング","駅伝"],"🏃"],[["ジム","筋トレ","トレーニング","クロスフィット","crossfit","筋"],"🏋️"],[["自転車","サイクリング","ロングライド","ライド","ロード"],"🚴"],[["泳","スイミング","プール","水泳"],"🏊"],[["ヨガ","ストレッチ","瞑想"],"🧘"],[["ピアノ","ジャズ","鍵盤","セッション"],"🎹"],[["ギター","楽器","音楽","バンド"],"🎸"],[["ライブ","コンサート","歌","カラオケ"],"🎤"],[["映画","シネマ"],"🎬"],[["本","読書","読む"],"📚"],[["試験","資格","勉強","検定","TOEIC","G検定","学習"],"🎓"],[["面接","転職","仕事","キャリア","案件","副業"],"💼"],[["会議","打ち合わせ","打合せ","MTG","ミーティング","商談"],"📊"],[["飲み","飲み会","会食","宴会","パーティ","ランチ会","歓迎会","送別会","二次会"],"🍻"],[["旅","旅行","海外","訪ね","観光","ステイ"],"✈️"],[["海","ビーチ","南国"],"🏖️"],[["山","登山","富士","ハイキング","トレッキング"],"⛰️"],[["語","スペイン語","英語","中国語","会話"],"🗣️"],[["写真","カメラ","撮"],"📷"],[["料理","ごはん","ご飯","レストラン","食","クッキング"],"🍳"],[["コーヒー","カフェ","珈琲"],"☕"],[["貯金","お金","投資","iDeCo","ふるさと納税","資産","NISA"],"💰"],[["病院","通院","受診","健診","健康診断","診察"],"🏥"],[["ワクチン","予防接種","注射","接種"],"💉"],[["フィラリア","蚊","ノミ","ダニ"],"🦟"],[["狂犬病"],"🐕"],[["歯","歯科","デンタル"],"🦷"],[["美容","トリミング","カット","ヘア","サロン"],"✂️"],[["散歩","お散歩","ウォーキング"],"🦮"],[["習い事","レッスン","塾","スクール"],"🎒"],[["誕生","記念","バースデー"],"🎂"],[["結婚","プロポーズ","婚"],"💍"],[["掃除","片付","そうじ"],"🧹"],[["引っ越","引越","移住"],"📦"],[["占い","星","運勢"],"✨"]];
const PICKER_EMOJIS=["✨","🌈","💪","🏃","🚴","🏋️","🧘","🎹","🎸","🎤","🎬","📚","🎓","💼","✈️","🏖️","⛰️","📷","🍳","☕","💰","🏥","💉","🦷","✂️","🦮","🐶","🐱","🎂","💍","🧸","🧹","📦","🗣️","👁️","🦟","❤️","⭐","🎯","🌷"];
function guessEmoji(title,fallback){const t=(title||"").toLowerCase();for(const[keys,emo]of EMOJI_RULES){if(keys.some(k=>t.includes(k.toLowerCase())))return emo;}return fallback;}

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

function dueStatus(item){if(!item.dueDate)return null;const d=daysUntil(item.dueDate);if(d>3)return{label:fmtDate(item.dueDate),tone:"normal"};if(d>0)return{label:`あと${d}日`,tone:"soon"};if(d===0)return{label:"今日",tone:"today"};if(item.type==="dream")return{label:"また今度でも大丈夫",tone:"gentleOver"};if(item.careKind&&HIGH_KINDS.has(item.careKind))return{label:"期限を過ぎています",tone:"careOver"};return{label:`${-d}日すぎてます`,tone:"gentleOver"};}

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

function generateIcal(items, members, meEmoji) {
  const nameOf=(sid)=>sid==="me"?"わたし":(members.find(m=>m.id===sid)?.name||"");
  const emojiOf=(sid)=>sid==="me"?meEmoji:(members.find(m=>m.id===sid)?.emoji||"");
  const now=new Date();
  const stamp=`${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}T${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}00Z`;
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//LOALIFE//Family//JA","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:LOALIFE家族カレンダー"];
  items.filter(it=>it.dueDate&&!it.done).forEach(item=>{
    const [y,m,d]=item.dueDate.split("-").map(Number);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:loalife-${item.id}@loalife`);
    lines.push(`SUMMARY:${item.emoji||""} ${item.title} [${emojiOf(item.space)}${nameOf(item.space)}]`);
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
  const isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent);
  if(isIOS){
    // iOS: フォームをPOSTで/api/icalに送り、サーバーがtext/calendarで返す
    // → iOSがHTTPヘッダーを見てAppleカレンダーに渡す
    const form=document.createElement("form");
    form.method="POST";
    form.action="/api/ical";
    form.target="_blank"; // 新しいSafariタブで開く → iOSがカレンダーと認識
    const input=document.createElement("input");
    input.type="hidden";input.name="content";
    input.value=encodeURIComponent(content);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }else{
    // PC/Android: 通常のblob URLダウンロード
    const blob=new Blob([content],{type:"text/calendar;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=filename;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
}

const HOURS=Array.from({length:24},(_,i)=>i);
const MINS=[0,5,10,15,20,25,30,35,40,45,50,55];
function TimeInput({value,onChange}){
  const curH=value?Number(value.split(":")[0]):"";
  const curM=value?Math.round(Number(value.split(":")[1])/5)*5%60:0;
  const upd=(h,m)=>{if(h===""){onChange("");return;}const hh=String(h).padStart(2,"0"),mm=String(m).padStart(2,"0");onChange(hh+":"+mm);};
  return(<div className="yl-timepick"><select className="yl-tsel" value={curH} onChange={e=>upd(e.target.value===""?"":Number(e.target.value),curM)}><option value="">--</option>{HOURS.map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}</option>)}</select><span className="yl-tcolon">:</span><select className="yl-tsel" value={curM} onChange={e=>upd(curH===""?9:curH,Number(e.target.value))}>{MINS.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}</select></div>);
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

function App(){
  const[members,setMembers]=useState([]);
  const[items,setItems]=useState([]);
  const[loaded,setLoaded]=useState(false);
  const[tab,setTab]=useState("home");
  const[filter,setFilter]=useState("all");
  const[flash,setFlash]=useState("");
  const[draft,setDraft]=useState("");
  const[draftType,setDraftType]=useState("dream");
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
  const[editVisibility,setEditVisibility]=useState("household");
  const[confirmDel,setConfirmDel]=useState(null);
  const[confirmReset,setConfirmReset]=useState(false);
  const[a2hsHint,setA2hsHint]=useState(false); // 「ホーム画面に追加」データ保護の案内（1回だけ）
  const[friendBdayName,setFriendBdayName]=useState(""); // 友達の誕生日・記念日（わくわく）
  const[friendBdayDate,setFriendBdayDate]=useState("");
  const[pickerId,setPickerId]=useState(null);
  const[viewer,setViewer]=useState(null);
  const[photos,setPhotos]=useState({});
  const[memoryDraft,setMemoryDraft]=useState(null); // {space,title} 思い出追加モーダル
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
      setLoaded(true);
      // 旧キー由来 / バージョンが古い場合のみ現行キーへ保存（旧キーは残す＝バックアップ）。
      try{
        const needWrite=fromLegacy||parsed.version!==SCHEMA_VERSION;
        if(needWrite){
          if(!fromLegacy)await storage.set(STORAGE_KEY+".bak",raw); // 念のため移行前の生データを退避
          await storage.set(STORAGE_KEY,serializeState({members:state.members,items:state.items,usage:state.usage,meEmoji:state.meEmoji,meBirthday:state.meBirthday}));
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

  // Birthday & うちの子記念日 notifications on load
  useEffect(()=>{
    if(!loaded||notifPerm!=="granted") return;
    members.forEach(m=>{
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
    const urgent=buildDigest(items);
    if(urgent.length===0)return;
    const body=urgent.slice(0,3).map(u=>`${u.emoji} ${u.text}`).join(" / ")+(urgent.length>3?` ほか${urgent.length-3}件`:"");
    const id=setTimeout(()=>{
      fireNotif("🔔 今日の見守り",body);
      try{localStorage.setItem(DIGEST_KEY,today);}catch(e){}
    },1800);
    return()=>clearTimeout(id);
  },[loaded,notifPerm,items]);

  // Local persist (used when no household)
  const persist=async(m,it,u=usage)=>{
    setMembers(m);setItems(it);setUsage(u);
    if(!household){
      try{await storage.set(STORAGE_KEY,serializeState({members:m,items:it,usage:u,meEmoji,meBirthday}));}catch(e){}
    }
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
    try{storage.set(STORAGE_KEY,serializeState({members,items,usage,meEmoji:emo,meBirthday})).catch(()=>{});}catch(e){}
    if(fireUser){try{setDoc(doc(fbDb,"users",fireUser.uid),{meEmoji:emo},{merge:true}).catch(()=>{});}catch(e){}}
  };
  const persistMeBirthday=(bday)=>{
    setMeBirthday(bday);
    try{storage.set(STORAGE_KEY,serializeState({members,items,usage,meEmoji,meBirthday:bday})).catch(()=>{});}catch(e){}
    if(fireUser){try{setDoc(doc(fbDb,"users",fireUser.uid),{meBirthday:bday},{merge:true}).catch(()=>{});}catch(e){}}
  };
  const showFlash=(msg)=>{setFlash(msg);setTimeout(()=>setFlash(""),2200);};
  const loadSample=()=>{const seed=makeSeed();persist(seed.members,seed.items);setOnboarding(false);setTab("home");};

  const finishOnboarding=()=>{
    const nm=[];const ni=[];
    if(obWish.trim())ni.push({id:"x"+Date.now(),space:"me",type:"dream",title:obWish.trim(),emoji:guessEmoji(obWish.trim(),"🌈"),repeat:"none",done:false,createdAt:Date.now()});
    if(obKind&&obName.trim()){const m={id:"f"+Date.now(),name:obName.trim(),emoji:obEmoji,kind:obKind,birthday:obBirthday||"",visibility:"household"};if(obKind==="pet")m.species=obSpecies;nm.push(m);}
    persist(nm,ni);setOnboarding(false);setObStep(0);setTab("home");
  };

  const resetApp=()=>{try{storage.delete(STORAGE_KEY).catch(()=>{});}catch(e){}setMembers([]);setItems([]);setPhotos({});setConfirmDel(null);setObStep(0);setObWish("");setObKind(null);setObSpecies("dog");setObName("");setObEmoji("🐶");setObBirthday("");setMeEmoji("🙂");setMeBirthday("");setHousehold(null);setFireUser(null);setOnboarding(true);setTab("home");};

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
  // ルーティン/ストックは「わたし」タブでも使える。space=tab、kind は me/person/pet。
  const isPersonalTab=tab!=="home";          // わたし＋各メンバー（ホーム以外）
  const curKind=activeMember?activeMember.kind:"me";

  useEffect(()=>{setFilter("all");if(activeMember){const list=careKindsFor(activeMember);const kind=list.find(k=>k.key===draftKind)?draftKind:list[0].key;if(kind!==draftKind)setDraftKind(kind);const label=(list.find(k=>k.key===kind)||{}).label||"";if(kind!=="other"&&(draft===""||draftAuto)){setDraft(label);setDraftAuto(true);}else if(kind==="other"&&draftAuto){setDraft("");setDraftAuto(false);}}else if(draftAuto){setDraft("");setDraftAuto(false);}},[tab]);

  const toggle=(id)=>{
    const it=items.find(x=>x.id===id);if(!it)return;let next;
    if(!it.done&&it.repeat&&it.repeat!=="none"){const base=it.dueDate||iso(new Date());const newDue=addInterval(base,it.repeat);next=items.map(x=>x.id===id?{...x,dueDate:newDue,done:false}:x);showFlash(`完了！次回 ${fmtDate(newDue)} に更新`);}
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

  const onFilePicked=async(e,id)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash("ファイルが大きすぎます（20MB以下）");return;}
    try{
      const dataUrl=await downscaleImage(file);
      const ok=await photoStorage.set(`photo:${id}`,dataUrl);
      if(!ok){showFlash("ストレージ容量が不足しています");return;}
      setPhotos(p=>({...p,[id]:dataUrl}));
      setItems(prev=>{const next=prev.map(x=>x.id===id?{...x,photo:true}:x);try{storage.set(STORAGE_KEY,serializeState({members,items:next,usage,meEmoji,meBirthday})).catch(()=>{});}catch(er){}return next;});
      showFlash("証明書を保存しました 📷");
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
    const name=newName.trim();if(!name)return;
    const id="f"+Date.now();
    const member={id,name,emoji:newEmoji,kind:newKind,birthday:newBirthday||"",visibility:newVisibility};
    if(newKind==="pet")member.species=newSpecies;
    persist([...members,member],items);
    saveMemberToFs(member).catch(()=>{});
    setNewName("");setNewBirthday("");setNewVisibility("household");setAdding(false);setTab(id);
  };

  const removeMember=(id)=>{
    const m=members.find(x=>x.id===id);
    persist(members.filter(x=>x.id!==id),items.filter(x=>x.space!==id));
    deleteMemberFromFs(id).catch(()=>{});
    setTab("me");setConfirmDel(null);
    if(m)showFlash(`${m.name} を削除しました`);
  };

  const saveRename=(id)=>{
    const name=editName.trim();if(!name)return;
    const next=members.map(m=>m.id===id?{...m,name,birthday:editBirthday,gotchaDay:editGotcha||"",visibility:editVisibility}:m);
    persist(next,items);
    const updated=next.find(m=>m.id===id);
    if(updated)saveMemberToFs(updated).catch(()=>{});
    setEditingId(null);
  };

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
  // サムネイルの遅延読み込み（思い出・証明書など写真を持つ全アイテム。未ロードのみ取得）
  useEffect(()=>{
    const missing=items.filter(x=>x.photo&&!photos[x.id]);
    if(missing.length===0)return;
    let cancelled=false;
    (async()=>{for(const m of missing){try{const v=await photoStorage.get(`photo:${m.id}`);if(!cancelled&&v)setPhotos(p=>({...p,[m.id]:v}));}catch(e){}}})();
    return()=>{cancelled=true;};
  },[items]);
  // 証明書（ワクチン等）：写真付きのケアを上部に出してすぐ見られるように
  const certs=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="care"&&x.photo).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)),[items,tab]);
  // 全メンバーの「そろそろ/切れた」ストック（ホーム表示用）
  const lowSupplies=useMemo(()=>items.filter(x=>x.type==="supply").map(x=>({item:x,st:supplyStatus(x)})).filter(o=>o.st&&o.st.tone!=="ok"),[items]);

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

  const visible=useMemo(()=>{let arr=items.filter(x=>x.space===tab&&x.type!=="routine"&&x.type!=="supply"&&x.type!=="memory"&&x.type!=="bday");if(filter!=="all")arr=arr.filter(x=>isMemberTab?x.careKind===filter:x.type===filter);arr=[...arr].sort((a,b)=>{if(!a.dueDate&&!b.dueDate)return b.createdAt-a.createdAt;if(!a.dueDate)return 1;if(!b.dueDate)return -1;return a.dueDate.localeCompare(b.dueDate);});return arr.sort((a,b)=>a.done===b.done?0:a.done?1:-1);},[items,tab,filter,isMemberTab]);
  const filterChips=useMemo(()=>{const all={key:"all",label:"すべて"};if(isMemberTab)return[all,...careKindsFor(activeMember)];return[all,...ME_TYPES.map(t=>({key:t,label:TYPE_META[t].label}))];},[tab,isMemberTab]);
  const suggestions=useMemo(()=>{const prefix=tab+" ";return Object.entries(usage).filter(([k,c])=>k.startsWith(prefix)&&c>=2).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k.slice(prefix.length));},[usage,tab]);
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
  const memberStats=useMemo(()=>{if(!isMemberTab)return null;const arr=items.filter(x=>x.space===tab);let soon=0,over=0;arr.forEach(x=>{const d=daysUntil(x.dueDate);if(d===null)return;if(d<0)over++;else if(d<=7)soon++;});return{soon,over};},[items,tab,isMemberTab]);
  const emojiSet=newKind==="person"?PERSON_EMOJIS:PET_EMOJIS;
  const spaces=useMemo(()=>[{id:"me",name:"わたし",emoji:meEmoji,kind:"me"},...members],[members,meEmoji]);
  const statusFor=(spaceId)=>{const arr=items.filter(x=>x.space===spaceId&&!x.done&&x.dueDate);let over=0,next=null,nextDays=Infinity;arr.forEach(x=>{const d=daysUntil(x.dueDate);if(d<0)over++;else if(d<nextDays){nextDays=d;next=x;}});return{over,next,nextDays};};
  const todayList=useMemo(()=>items.filter(x=>!x.done&&x.dueDate&&daysUntil(x.dueDate)<=0).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)),[items]);
  const summary=useMemo(()=>({dreams:items.filter(x=>x.type==="dream"&&x.done).length,careOverdue:items.filter(x=>x.type==="care"&&!x.done&&x.dueDate&&daysUntil(x.dueDate)<0).length,family:members.length}),[items,members]);
  const nameOf=(spaceId)=>spaceId==="me"?"わたし":(members.find(m=>m.id===spaceId)||{}).name||"";

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
    const bombs=[];
    items.forEach(x=>{
      if(x.done||!x.dueDate)return;
      const d=daysUntil(x.dueDate);
      const isHigh=x.careKind&&HIGH_KINDS.has(x.careKind);          // ワクチン・薬・通院など
      const isBigEvent=x.type==="event"||x.careKind==="event"||x.careKind==="school";
      if((isHigh&&d<=7)||(isBigEvent&&d>=0&&d<=2))bombs.push({item:x,d});
    });
    bombs.sort((a,b)=>a.d-b.d);
    const bombSet=new Set(bombs.map(b=>b.item.id));
    // ① 今日やること：今日のケア/予定（爆弾以外）＋未完了の今日のルーティン＋直近の予定1つ
    const todos=[];
    items.forEach(x=>{
      if(x.done)return;
      if(x.type==="routine"){if(x.doneDate!==todayIso)todos.push({key:x.id,emoji:x.emoji||"⏰",title:x.title,space:x.space,time:x.time,tag:x.time||"今日",pri:2});return;}
      if(x.dueDate&&!bombSet.has(x.id)){const d=daysUntil(x.dueDate);if(d<=0)todos.push({key:x.id,emoji:x.emoji||"•",title:x.title,space:x.space,time:x.time,tag:d<0?"やり残し":"今日",pri:d<0?0:1});}
    });
    // 期限が近いもの1つ（今日以降・爆弾以外）
    let nearest=null;
    items.forEach(x=>{if(x.done||!x.dueDate||bombSet.has(x.id))return;const d=daysUntil(x.dueDate);if(d>0&&d<=7&&(!nearest||d<nearest.d))nearest={item:x,d};});
    if(nearest)todos.push({key:nearest.item.id,emoji:nearest.item.emoji||"•",title:nearest.item.title,space:nearest.item.space,time:nearest.item.time,tag:nearest.d===1?"明日":`あと${nearest.d}日`,pri:3});
    todos.sort((a,b)=>a.pri-b.pri||((a.time||"99")<(b.time||"99")?-1:1));
    return{bombs,todos};
  },[items,todayIso]);

  // ② 安心ステータス：各メンバーのレベルと一言
  const spaceLevel=(spaceId)=>{
    let overdue=0,soon=0;
    items.forEach(x=>{if(x.space!==spaceId||x.done||!x.dueDate)return;const d=daysUntil(x.dueDate);if(d<0)overdue++;else if(d<=3)soon++;});
    const sup=lowSupplies.filter(o=>o.item.space===spaceId);
    if(overdue>0||sup.some(o=>o.st.tone==="out"))return"alert";
    if(soon>0||sup.some(o=>o.st.tone==="low"))return"warn";
    return"ok";
  };
  const spaceConcern=(spaceId)=>{
    let overdue=null,soon=null;
    items.forEach(x=>{if(x.space!==spaceId||x.done||!x.dueDate)return;const d=daysUntil(x.dueDate);if(d<0){if(!overdue||d<overdue.d)overdue={item:x,d};}else if(d<=3){if(!soon||d<soon.d)soon={item:x,d};}});
    const sup=lowSupplies.filter(o=>o.item.space===spaceId).sort((a,b)=>a.st.left-b.st.left)[0];
    if(sup&&sup.st.tone==="out")return`${sup.item.title}が切れているかも`;
    if(overdue)return`${overdue.item.title}が期限切れ`;
    if(sup&&sup.st.tone==="low")return`${sup.item.title} 残りわずか`;
    if(soon)return`${soon.item.title}・${soon.d===0?"今日":"あと"+soon.d+"日"}`;
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
            <h3 className="yl-modal-title">👨‍👩‍👧 家族共有</h3>
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
            <h3 className="yl-modal-title">👨‍👩‍👧 家族共有</h3>
            <p className="yl-share-desc">Googleアカウントでサインインすると、家族とデータを共有できます。</p>
            {shareError&&<p className="yl-share-error">{shareError}</p>}
            <button className="yl-google-btn" onClick={signInWithGoogle} disabled={shareLoading}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.7 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.5 13.3l8 6.2C12.4 13 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.8-2.1 5.2-4.4 6.8l7 5.4C43.3 37.1 46.5 31.3 46.5 24.5z"/><path fill="#FBBC05" d="M10.5 28.5c-.5-1.5-.8-3-.8-4.5s.3-3 .8-4.5l-8-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l8-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7-5.4c-2 1.3-4.5 2.1-8.2 2.1-6.3 0-11.6-4.2-13.5-9.9l-8 6.2C6.6 42.6 14.6 48 24 48z"/></svg>
              Googleでサインイン
            </button>
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
            <h3 className="yl-modal-title">👨‍👩‍👧 家族共有</h3>
            <p className="yl-share-desc">{fireUser.displayName||fireUser.email} でサインイン中</p>
            {shareStep==="menu"&&(
              <>
                <button className="yl-share-choice" onClick={()=>setShareStep("create")}>＋ 新しい家族スペースを作る</button>
                <button className="yl-share-choice" onClick={()=>setShareStep("join")}>🔗 招待コードで参加する</button>
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
              <button className="yl-modal-cancel" style={{color:"#E5484D"}} onClick={signOutUser}>サインアウト</button>
            </div>
          </div>
        </div>
      );
    }
    // In a household
    return(
      <div className="yl-overlay" onClick={()=>setShowShareModal(false)}>
        <div className="yl-modal share" onClick={e=>e.stopPropagation()}>
          <h3 className="yl-modal-title">👨‍👩‍👧 家族共有</h3>
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
            <button className="yl-modal-cancel" style={{color:"#E5484D"}} onClick={signOutUser}>サインアウト</button>
          </div>
        </div>
      </div>
    );
  };

  return(
    <div className="yl-root">
      {onboarding&&(
        <div className="yl-ob">
          {obStep===0&&<div className="yl-ob-inner"><div className="yl-ob-emoji">🏠</div><h1 className="yl-ob-title">家族の「今」が、ひと目でわかる。</h1><p className="yl-ob-sub">わたしと、大切な家族を、ひとつの場所で。</p><button className="yl-ob-btn" onClick={()=>setObStep(1)}>はじめる</button><button className="yl-ob-link" onClick={loadSample}>サンプルで試してみる</button></div>}
          {obStep===1&&<div className="yl-ob-inner"><p className="yl-ob-step">1 / 2</p><h2 className="yl-ob-h2">まず、あなたの「やりたいこと」を1つ</h2><p className="yl-ob-sub">あとから、いつでも追加できます</p><div className="yl-ob-chips">{["海外旅行に行く","副業・スキルアップ","毎日運動する","語学を身につける"].map(ex=><button key={ex} className="yl-ob-chip" onClick={()=>setObWish(ex)}>{ex}</button>)}</div><input className="yl-input" value={obWish} onChange={e=>setObWish(e.target.value)} onKeyDown={e=>e.key==="Enter"&&setObStep(2)} placeholder="やりたいこと…" autoFocus/><button className="yl-ob-btn" onClick={()=>setObStep(2)}>次へ</button><button className="yl-ob-link" onClick={()=>{setObWish("");setObStep(2);}}>スキップ</button></div>}
          {obStep===2&&<div className="yl-ob-inner"><p className="yl-ob-step">2 / 2</p><h2 className="yl-ob-h2">一緒に見守りたい家族はいますか？</h2>{!obKind?<div className="yl-ob-choices"><button className="yl-ob-choice" onClick={()=>{setObKind("pet");setObEmoji(PET_EMOJIS[0]);}}>🐶 ペット</button><button className="yl-ob-choice" onClick={()=>{setObKind("person");setObEmoji(PERSON_EMOJIS[0]);}}>👧 家族（人）</button><button className="yl-ob-link" onClick={finishOnboarding}>今は追加しない</button></div>:<div className="yl-ob-form">{obKind==="pet"&&<div className="yl-kindrow">{SPECIES.map(s=><button key={s.key} className={"yl-kindbtn sm"+(obSpecies===s.key?" on":"")} onClick={()=>{setObSpecies(s.key);setObEmoji(s.emoji);}}>{s.emoji} {s.label}</button>)}</div>}<div className="yl-emoji-row">{(obKind==="person"?PERSON_EMOJIS:PET_EMOJIS).map(e=><button key={e} className={"yl-emoji"+(obEmoji===e?" on":"")} onClick={()=>setObEmoji(e)}>{e}</button>)}</div><input className="yl-input" value={obName} onChange={e=>setObName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&finishOnboarding()} placeholder={obKind==="person"?"名前（例：ゆうと）":"名前（例：ぽち）"} autoFocus/><label className="yl-opt" style={{width:"100%",marginTop:8}}>誕生日（任意）<input type="date" className="yl-date" style={{width:"100%"}} value={obBirthday} onChange={e=>setObBirthday(e.target.value)}/></label><button className="yl-ob-btn" onClick={finishOnboarding}>はじめる</button><button className="yl-ob-link" onClick={()=>setObKind(null)}>戻る</button></div>}</div>}
        </div>
      )}

      <div className="yl-wrap">
        <header className="yl-head">
          <h1 className="yl-title">🏠 ホーム</h1>
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
        </header>

        {a2hsHint&&(
          <div className="yl-notif-banner">
            <span>📲 ホーム画面に追加すると、データが消えにくく安心です</span>
            <button className="yl-notif-allow" onClick={()=>{setA2hsHint(false);try{localStorage.setItem("loalife-a2hs-snooze",String(Date.now()+3*86400000));}catch(e){}}}>あとで</button>
          </div>
        )}

        <nav className="yl-tabs">
          <button className={"yl-tab"+(tab==="home"?" on":"")} onClick={()=>setTab("home")}>ホーム</button>
          <button className={"yl-tab"+(tab==="me"?" on":"")} onClick={()=>setTab("me")}>{meEmoji} わたし</button>
          {members.map(m=>{const bd=daysUntilBirthday(m.birthday);return<button key={m.id} className={"yl-tab"+(tab===m.id?" on":"")} onClick={()=>setTab(m.id)}>{m.emoji} {m.name}{bd===0?" 🎂":bd===1?" 🎂":""}{m.visibility==="private"&&inHousehold?" 🔒":""}</button>;})}
          <button className="yl-tab add" onClick={()=>setAdding(v=>!v)}>＋追加</button>
        </nav>

        {adding&&(
          <div className="yl-petform">
            <div className="yl-kindrow"><button className={"yl-kindbtn"+(newKind==="pet"?" on":"")} onClick={()=>{setNewKind("pet");setNewEmoji(PET_EMOJIS[0]);}}>🐶 ペット</button><button className={"yl-kindbtn"+(newKind==="person"?" on":"")} onClick={()=>{setNewKind("person");setNewEmoji(PERSON_EMOJIS[0]);}}>👤 家族（人）</button></div>
            {newKind==="pet"&&<div className="yl-kindrow">{SPECIES.map(s=><button key={s.key} className={"yl-kindbtn sm"+(newSpecies===s.key?" on":"")} onClick={()=>{setNewSpecies(s.key);setNewEmoji(s.emoji);}}>{s.emoji} {s.label}</button>)}</div>}
            <div className="yl-emoji-row">{emojiSet.map(e=><button key={e} className={"yl-emoji"+(newEmoji===e?" on":"")} onClick={()=>setNewEmoji(e)}>{e}</button>)}</div>
            <div className="yl-petform-row"><input className="yl-input" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMember()} placeholder={newKind==="person"?"名前（例：ゆうと）":"名前（例：ぽち）"}/><button className="yl-addbtn" onClick={addMember}>登録</button></div>
            <label className="yl-opt" style={{marginTop:10}}>誕生日（任意）<input type="date" className="yl-date" value={newBirthday} onChange={e=>setNewBirthday(e.target.value)}/></label>
            {inHousehold&&<div style={{marginTop:10}}><VisibilityToggle value={newVisibility} onChange={setNewVisibility}/></div>}
          </div>
        )}

        {tab==="home"?(
          <div className="yl-home">
            {showNotifBanner&&(hasReminders||members.some(m=>m.birthday))&&(
              <div className="yl-notif-banner">
                <span>🔔 通知を許可すると、リマインダーや誕生日をお知らせします</span>
                <button className="yl-notif-allow" onClick={handleNotifRequest}>許可する</button>
              </div>
            )}

            {upcomingAnniv.length>0&&(
              <section className="yl-bday-section">
                <h2 className="yl-sec-title">もうすぐの記念日 🎉</h2>
                {upcomingAnniv.map(a=>(
                  <div key={a.key} className="yl-bday-row">
                    <span className="yl-bday-emoji">{a.emoji}</span>
                    <span className="yl-bday-name">{a.name}<span className="yl-bday-kind">{a.kind==="gotcha"?"・うちの子記念日":a.kind==="self"?"":"・誕生日"}</span></span>
                    <span className="yl-bday-date">{fmtBirthday(a.date)}</span>
                    <span className={"yl-bday-tag"+(a.daysUntil===0?" today":"")}>{a.daysUntil===0?(a.kind==="gotcha"&&a.years?`迎えて${a.years}年！`:"今日！"):`あと${a.daysUntil}日`}</span>
                  </div>
                ))}
              </section>
            )}

            {/* ① 今日やること（最大3件）／⑥ 何もない日 */}
            {allClear?(
              <section className="yl-hero calm">
                <div className="yl-hero-emoji">☀️</div>
                <p className="yl-hero-title">今日は安心です</p>
                <p className="yl-hero-sub">{members.length===0?"ゆっくり過ごせる一日を":(()=>{const pets=members.filter(m=>m.kind==="pet");if(pets.length===1)return `${pets[0].emoji} ${pets[0].name}は平和です`;if(members.length===1)return `${members[0].emoji} ${members[0].name}も穏やかです`;return `${members.map(m=>m.emoji).join("")} みんな穏やかです`;})()}</p>
              </section>
            ):homeData.todos.length>0&&(
              <section className="yl-todo">
                <div className="yl-dash-head">
                  <h2 className="yl-sec-title" style={{marginBottom:0}}>☑️ 今日やること</h2>
                  <button className="yl-cal-export" onClick={()=>setCalPicker({bulk:true})} title="カレンダーにエクスポート">📅 出力</button>
                </div>
                <ul className="yl-todo-list">
                  {homeData.todos.slice(0,3).map(t=>(
                    <li key={t.key} className="yl-todo-item" onClick={()=>setTab(t.space)}>
                      <span className="yl-todo-emoji">{t.emoji}</span>
                      <span className="yl-todo-body"><span className="yl-todo-text">{t.title}{t.time&&<span className="yl-todo-time"> {t.time}</span>}</span><span className="yl-todo-who">{nameOf(t.space)}</span></span>
                      <span className={"yl-todo-tag"+(t.pri===0?" over":"")}>{t.tag}</span>
                    </li>
                  ))}
                </ul>
                {homeData.todos.length>3&&<p className="yl-todo-more">ほかに {homeData.todos.length-3} 件</p>}
              </section>
            )}

            {/* ② 見逃せないこと（"爆弾"）── 放置の損害が最大なので最上位に近い位置へ */}
            {homeData.bombs.length>0&&(
              <section className="yl-bombs">
                <h2 className="yl-sec-title alert">⚠️ 見逃せないこと</h2>
                <ul className="yl-bomb-list">
                  {homeData.bombs.slice(0,4).map(({item,d})=>(
                    <li key={item.id} className={"yl-bomb-item"+(d<0?" over":"")} onClick={()=>setTab(item.space)}>
                      <span className="yl-bomb-emoji">{item.emoji||"⚠️"}</span>
                      <span className="yl-bomb-body"><span className="yl-bomb-text">{item.title}</span><span className="yl-bomb-who">{nameOf(item.space)}</span></span>
                      <span className={"yl-bomb-tag"+(d<0?" over":"")}>{d<0?`${-d}日超過`:d===0?"今日":d===1?"明日":`あと${d}日`}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* ③ 安心ステータス */}
            <section>
              <h2 className="yl-sec-title">😊 安心ステータス</h2>
              <div className="yl-statusgrid">{spaces.map(s=>{
                const lv=spaceLevel(s.id);const meta=LEVEL_META[lv];const concern=spaceConcern(s.id);
                const okMsg=s.kind==="pet"?`${s.name}は平和です`:s.kind==="me"?"順調です":"順調です";
                return(
                  <button key={s.id} className={"yl-statuscard lv-"+lv} onClick={()=>setTab(s.id)}>
                    <span className="yl-status-emoji">{s.emoji}</span>
                    <span className="yl-status-body">
                      <span className="yl-status-name">{s.name}</span>
                      <span className={"yl-status-line lv-"+lv}>{concern||okMsg}</span>
                    </span>
                    <span className={"yl-level-badge lv-"+lv}>{meta.label}</span>
                  </button>
                );
              })}</div>
            </section>

            {/* ④ フード・消耗品の残量 */}
            {lowSupplies.length>0&&(
              <section className="yl-supply">
                <h2 className="yl-sec-title">📦 そろそろ買い足し</h2>
                <ul className="yl-supply-list">
                  {[...lowSupplies].sort((a,b)=>a.st.left-b.st.left).map(({item,st})=>(
                    <li key={item.id} className={"yl-supply-item "+st.tone}>
                      <button className="yl-supply-main" onClick={()=>setTab(item.space)}>
                        <span className="yl-supply-emoji">{item.emoji}</span>
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

            {/* ⑤ 小さなふりかえり（操作実績だけに純化：達成演出はしない） */}
            <section className="yl-summary"><h2 className="yl-sec-title light">小さなふりかえり</h2><div className="yl-summary-row"><div className="yl-stat"><span className="yl-stat-n">{weekDone}</span><span className="yl-stat-l">今週やったケア</span></div><div className="yl-stat"><span className="yl-stat-n">{allRoutines.length>0?`${routineDoneToday}/${allRoutines.length}`:"—"}</span><span className="yl-stat-l">今日のルーティン</span></div></div></section>
            <button className="yl-reset" onClick={()=>setConfirmReset(true)}>⟳ サンプルを消して最初から</button>
          </div>
        ):(
          <>
            {!isMemberTab?<section className="yl-meter"><div className="yl-meter-top"><span className="yl-meter-label"><button className="yl-me-emoji-btn" onClick={()=>setMePicker(true)} title="絵文字を変更">{meEmoji}</button>わくわくメーター</span><span className="yl-meter-count">{doneCount} / {meItems.length}</span></div><div className="yl-bar"><div className="yl-fill" style={{width:pct+"%"}}/></div><div className="yl-me-bday">{meBdayEdit?<div className="yl-me-bday-edit"><input type="date" className="yl-date" value={meBdayDraft} onChange={e=>setMeBdayDraft(e.target.value)} autoFocus/><button className="yl-addbtn sm" onClick={()=>{persistMeBirthday(meBdayDraft);setMeBdayEdit(false);}}>保存</button><button className="yl-modal-cancel" onClick={()=>setMeBdayEdit(false)}>キャンセル</button></div>:<button className="yl-me-bday-btn" onClick={()=>{setMeBdayDraft(meBirthday);setMeBdayEdit(true);}}>{meBirthday?`🎂 ${fmtBirthday(meBirthday)}`:"🎂 誕生日を登録する"}</button>}</div></section>:(
              <section className="yl-petstatus">
                <div className="yl-petstatus-head">
                  {editingId===activeMember.id?(
                    <div className="yl-rename">
                      <input className="yl-input sm" value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveRename(activeMember.id)} autoFocus/>
                      <label className="yl-opt" style={{marginTop:6,width:"100%"}}>🎂 誕生日<input type="date" className="yl-date" style={{marginLeft:6}} value={editBirthday} onChange={e=>setEditBirthday(e.target.value)}/></label>
                      {activeMember.kind==="pet"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}>🎉 うちの子記念日<input type="date" className="yl-date" style={{marginLeft:6}} value={editGotcha} onChange={e=>setEditGotcha(e.target.value)}/></label>}
                      {inHousehold&&<div style={{marginTop:8}}><VisibilityToggle value={editVisibility} onChange={setEditVisibility}/></div>}
                      <button className="yl-addbtn sm" onClick={()=>saveRename(activeMember.id)}>保存</button>
                    </div>
                  ):(
                    <span className="yl-petstatus-title" style={{color:KIND_STYLE[activeMember.kind].fg}}>
                      {activeMember.emoji} {activeMember.name} の{KIND_STYLE[activeMember.kind].word}
                      <button className="yl-icon" onClick={()=>{setEditingId(activeMember.id);setEditName(activeMember.name);setEditBirthday(activeMember.birthday||"");setEditGotcha(activeMember.gotchaDay||"");setEditVisibility(activeMember.visibility||"household");}}>✏️</button>
                    </span>
                  )}
                </div>
                <div className="yl-petstatus-chips">
                  <span className="yl-pill soon">⏰ 近い {memberStats?.soon||0}</span>
                  <span className="yl-pill over">🔴 期限切れ {memberStats?.over||0}</span>
                  {activeMember.birthday&&<span className="yl-pill bday">🎂 {fmtBirthday(activeMember.birthday)}</span>}
                  {activeMember.gotchaDay&&<span className="yl-pill gotcha">🎉 {(()=>{const y=yearsSinceAnniv(activeMember.gotchaDay);const dd=daysUntilAnniv(activeMember.gotchaDay);return dd===0?(y?`迎えて${y}年！`:"うちの子記念日！"):`記念日 ${fmtBirthday(activeMember.gotchaDay)}`;})()}</span>}
                  {inHousehold&&<span className={"yl-pill vis"+(activeMember.visibility==="private"?" private":"")}>{activeMember.visibility==="private"?"🔒 非公開":"👨‍👩‍👧 共有中"}</span>}
                  <button className="yl-pet-del" onClick={()=>setConfirmDel(activeMember)}>削除</button>
                </div>
              </section>
            )}

            {/* 🎉 もうすぐ・楽しみ（自分タブ）：友達の誕生日・記念日・イベントを見える化 */}
            {!isMemberTab&&(
              <section className="yl-meup">
                <h2 className="yl-routine-title" style={{marginBottom:10}}>🎉 もうすぐ・楽しみ</h2>
                {meUpcoming.length>0?(
                  <ul className="yl-meup-list">
                    {meUpcoming.map(u=>(
                      <li key={u.id} className="yl-meup-item">
                        <span className="yl-meup-emoji">{u.emoji}</span>
                        <span className="yl-meup-text">{u.title}</span>
                        <span className={"yl-meup-tag"+(u.daysUntil===0?" today":"")}>{u.daysUntil===0?(u.kind==="bday"?"今日 🎂":"今日"):u.daysUntil===1?"明日":`あと${u.daysUntil}日`}</span>
                        {u.kind==="bday"&&<button className="yl-meup-del" onClick={()=>remove(u.id)} aria-label="削除">×</button>}
                      </li>
                    ))}
                  </ul>
                ):(
                  <p className="yl-routine-empty" style={{padding:"4px 0 12px"}}>友達の誕生日やイベントを入れると、楽しみが見える化されます</p>
                )}
                <div className="yl-bday-add">
                  <input className="yl-input sm" value={friendBdayName} onChange={e=>setFriendBdayName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addFriendBday()} placeholder="名前・予定（例：ゆいの誕生日）"/>
                  <input type="date" className="yl-date" value={friendBdayDate} onChange={e=>setFriendBdayDate(e.target.value)}/>
                  <button className="yl-addbtn sm" onClick={addFriendBday}>🎂 追加</button>
                </div>
              </section>
            )}

            {/* 📄 証明書：ワクチン等の写真を一番上ですぐ見られるように */}
            {isMemberTab&&certs.length>0&&(
              <section className="yl-certs">
                <h2 className="yl-routine-title" style={{marginBottom:10}}>📄 証明書</h2>
                <div className="yl-certs-row">
                  {certs.map(c=>{
                    const label=(careKindsFor(activeMember).find(k=>k.key===c.careKind)||{}).label||c.title;
                    return(
                      <button key={c.id} className="yl-cert-cell" onClick={()=>viewPhoto(c.id)}>
                        {photos[c.id]?<img className="yl-cert-img" src={photos[c.id]} alt=""/>:<span className="yl-cert-ph">📄</span>}
                        <span className="yl-cert-cap">{c.emoji} {label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 1日のタイムライン（ルーティン）わたし＋各メンバー */}
            {isPersonalTab&&(
              <section className="yl-routine">
                <div className="yl-routine-head">
                  <h2 className="yl-routine-title">🗓 今日のタイムライン</h2>
                  {routines.length>0&&<span className="yl-routine-prog">{routineDone} / {routines.length}</span>}
                </div>
                {routines.length===0?(
                  <p className="yl-routine-empty">{curKind==="pet"?"毎日くりかえすお世話を、下のテンプレから追加できます":curKind==="me"?"毎日の習慣を、下のテンプレから追加できます":"毎日くりかえすことを、下のテンプレから追加できます"}</p>
                ):(
                  <ul className="yl-timeline">
                    {routines.map(r=>{
                      const done=r.doneDate===todayIso;
                      return(
                        <li key={r.id} className={"yl-tl-item"+(done?" done":"")}>
                          <span className="yl-tl-time">{r.time||"--:--"}</span>
                          <span className="yl-tl-dot"/>
                          <button className="yl-tl-body" onClick={()=>openRoutineEdit(r)}>
                            <span className="yl-tl-emoji">{r.emoji}</span>
                            <span className="yl-tl-text">{r.title}</span>
                            {r.reminders&&r.reminders.length>0&&<span className="yl-tl-bell">🔔</span>}
                          </button>
                          <label className="yl-tl-photo" title="写真で思い出に残す" onClick={e=>e.stopPropagation()}>📷<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>addMemory(e,{space:r.space,title:r.title,emoji:r.emoji})}/></label>
                          <button className={"yl-check"+(done?" on":"")} onClick={()=>toggleRoutine(r.id)} aria-label="完了"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="yl-routine-tpl">
                  {routineTemplatesFor(curKind).map(t=><button key={t.title} className="yl-tpl-btn" onClick={()=>openRoutineTemplate(t)}>{t.emoji} {t.title}</button>)}
                  <button className="yl-tpl-btn custom" onClick={openRoutineCustom}>＋ 自由</button>
                </div>
              </section>
            )}

            {/* 消耗品ストック（わたし＋各メンバー）買った日だけ入れれば残量を自動表示 */}
            {isPersonalTab&&(
              <section className="yl-supply">
                <div className="yl-routine-head">
                  <h2 className="yl-routine-title">📦 ストック</h2>
                  {supplies.length>0&&<span className="yl-supply-hint">買った時だけタップ</span>}
                </div>
                {supplies.length===0?(
                  <p className="yl-routine-empty">{tab==="me"?"サプリ・コンタクト・日用品など、自分の消耗品を登録できます":"フードなどの消耗品を登録すると、残量を自動で見守ります"}</p>
                ):(
                  <ul className="yl-supply-list">
                    {supplies.map(s=>{
                      const st=supplyStatus(s)||{tone:"ok",left:0};
                      return(
                        <li key={s.id} className={"yl-supply-item "+st.tone}>
                          <button className="yl-supply-main" onClick={()=>openSupplyEdit(s)}>
                            <span className="yl-supply-emoji">{s.emoji}</span>
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
                <div className="yl-routine-tpl">
                  {supplyTemplatesFor(curKind).map(t=><button key={t.title} className="yl-tpl-btn" onClick={()=>openSupplyTemplate(t)}>{t.emoji} {t.title}</button>)}
                  <button className="yl-tpl-btn custom" onClick={openSupplyCustom}>＋ 自由</button>
                </div>
              </section>
            )}

            {/* 1タップ追加パネル（メンバータブのみ） */}
            {isMemberTab&&(
              <div className="yl-quickbar">
                <p className="yl-quickbar-label">1タップ追加</p>
                <div className="yl-quickbar-grid">
                  {careKindsFor(activeMember).map(k=>{
                    const prev=lastDates[k.key];
                    return(
                      <button key={k.key} className="yl-quickbar-item" onClick={()=>openQuickAdd(k.key,k.emoji,k.label,activeMember.id,prev?.dueDate,prev?.repeat)}>
                        <span className="yl-quickbar-ico">{k.emoji}</span>
                        <span className="yl-quickbar-info">
                          <span className="yl-quickbar-name">{k.label}</span>
                          <span className="yl-quickbar-prev">{prev?`前回 ${fmtDate(prev.dueDate)}`:"─"}</span>
                        </span>
                        <span className="yl-quickbar-plus">＋</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="yl-addbox">
              {!isMemberTab?<div className="yl-typerow">{ME_TYPES.map(t=><button key={t} className={"yl-chip"+(draftType===t?" on":"")} style={draftType===t?{background:TYPE_META[t].fg,color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setDraftType(t)}>{TYPE_META[t].emoji} {TYPE_META[t].label}</button>)}</div>:<div className="yl-typerow">{careKindsFor(activeMember).map(k=><button key={k.key} className={"yl-chip"+(draftKind===k.key?" on":"")} style={draftKind===k.key?{background:KIND_STYLE[activeMember.kind].fg,color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>pickCareKind(k)}>{k.emoji} {k.label}</button>)}</div>}
              {suggestions.length>0&&<div className="yl-suggest"><span className="yl-suggest-label">よく使う</span><div className="yl-suggest-chips">{suggestions.map(s=><button key={s} className="yl-suggest-chip" onClick={()=>{setDraft(s);setDraftAuto(false);}}>{s}</button>)}</div></div>}
              <div className="yl-add"><input className="yl-input" value={draft} onChange={e=>{setDraft(e.target.value);setDraftAuto(false);}} onKeyDown={e=>e.key==="Enter"&&addItem()} placeholder={isMemberTab?(draftKind==="other"?"内容を入力…":`${(careKindsFor(activeMember).find(k=>k.key===draftKind)||{}).label||"内容"}を追加…`):`${TYPE_META[draftType].label}を追加…`}/><button className="yl-addbtn" onClick={addItem}>追加</button></div>
              <div className="yl-optrow"><label className="yl-opt">期限<input type="date" className="yl-date" value={draftDate} onChange={e=>setDraftDate(e.target.value)}/></label><label className="yl-opt">時間<TimeInput value={draftTime} onChange={setDraftTime}/></label><label className="yl-opt">繰り返し<select className="yl-select" value={draftRepeat} onChange={e=>setDraftRepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div>
              <div className="yl-notify"><span className="yl-notify-label">🔔 通知（任意・複数OK）{notifPerm==="denied"&&<span style={{color:"#E5484D",marginLeft:6,fontWeight:600,fontSize:10}}>端末の設定で通知がオフです</span>}{notifPerm==="default"&&<button className="yl-notif-small" onClick={handleNotifRequest}>許可する</button>}</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(draftReminders.includes(o.key)?" on":"")} onClick={()=>toggleReminder(o.key)}>{o.label}</button>)}</div></div>
            </div>

            <div className="yl-sort">{filterChips.map(f=><button key={f.key} className={"yl-sortbtn"+(filter===f.key?" on":"")} onClick={()=>setFilter(f.key)}>{f.emoji?f.emoji+" ":""}{f.label}</button>)}</div>

            {!loaded?<p className="yl-loading">よみこみ中…</p>:visible.length===0?<p className="yl-empty">まだありません。上のフォームから追加できます。</p>:(
              <ul className="yl-list">
                {visible.map(it=>{
                  let meta,label;
                  if(isMemberTab){meta=KIND_STYLE[activeMember.kind];label=(careKindsFor(activeMember).find(k=>k.key===it.careKind)||{}).label||"ケア";}
                  else{meta=TYPE_META[it.type]||TYPE_META.dream;label=meta.label;}
                  const ds=dueStatus(it);
                  return(
                    <li key={it.id} className={"yl-card"+(it.done?" is-done":"")}>
                      <button className="yl-bubble" style={{background:meta.bg,color:meta.fg}} onClick={()=>setPickerId(it.id)} title="タップで絵文字を変更">{it.emoji}</button>
                      <div className="yl-body" onClick={()=>openEdit(it)}>
                        <div className="yl-row1"><span className="yl-badge" style={{background:meta.bg,color:meta.fg}}>{label}</span><span className="yl-text">{it.title}</span></div>
                        {(ds||it.time||it.reminders||it.type==="care"||(it.repeat&&it.repeat!=="none"))&&(
                          <div className="yl-meta">
                            {ds&&<span className={"yl-due "+ds.tone}>{ds.label}</span>}
                            {it.time&&<span className="yl-time">🕐 {it.time}</span>}
                            {it.repeat&&it.repeat!=="none"&&<span className="yl-repeat">🔁 {REPEATS.find(r=>r.key===it.repeat)?.label}</span>}
                            {it.reminders&&it.reminders.length>0&&<span className="yl-notif-badge">🔔 {it.reminders.length<=2?it.reminders.map(reminderLabel).join("・"):it.reminders.length+"件"}</span>}
                            {!it.done&&it.dueDate&&daysUntil(it.dueDate)<=0&&<button className="yl-snooze" onClick={e=>{e.stopPropagation();snooze(it.id);}}>→ 明日へ</button>}
                            {it.type==="care"&&<button className="yl-prev-copy" onClick={e=>{e.stopPropagation();openQuickCopy(it);}} title="前回と同じ内容で追加">↩ 前回コピー</button>}
                            {it.dueDate&&<button className="yl-cal-item" onClick={e=>{e.stopPropagation();setCalPicker({item:it});}} title="カレンダーに追加">📅</button>}
                            {it.type==="care"&&(it.photo?<button className="yl-photo" onClick={e=>{e.stopPropagation();viewPhoto(it.id);}}>📷 証明書</button>:<label className="yl-photo add" onClick={e=>e.stopPropagation()}>📎 証明書を追加<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>onFilePicked(e,it.id)}/></label>)}
                          </div>
                        )}
                      </div>
                      <button className={"yl-check"+(it.done?" on":"")} onClick={()=>toggle(it.id)} aria-label="完了"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                      <button className="yl-del" onClick={e=>{e.stopPropagation();remove(it.id);}} aria-label="削除">×</button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 📸 思い出：記録を思い出に変える。書かせず、写真1枚で残す（わたし＋家族＋ペット） */}
            {isPersonalTab&&(
              <section className="yl-album">
                <div className="yl-routine-head">
                  <h2 className="yl-routine-title">📸 思い出</h2>
                  <button className="yl-album-add" onClick={()=>setMemoryDraft({space:tab,title:""})}>＋ 追加</button>
                </div>
                {memories.length===0?(
                  <p className="yl-routine-empty">{curKind==="pet"?"散歩などの📷ボタンや「＋追加」で、写真の思い出を残せます":"「＋追加」で、できた記念日や日々の写真を残せます"}</p>
                ):(
                  <div className="yl-album-grid">
                    {memories.map(mem=>(
                      <button key={mem.id} className="yl-album-cell" onClick={()=>viewMemory(mem.id)}>
                        {photos[mem.id]?<img className="yl-album-img" src={photos[mem.id]} alt=""/>:<span className="yl-album-ph">{mem.emoji||"📸"}</span>}
                        <span className="yl-album-cap">{fmtDate(mem.date)}{mem.title&&mem.title!=="思い出"?`・${mem.title}`:""}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
        <p className="yl-foot">試作版・データはこの端末に保存されます</p>
      </div>

      {editItemId&&<div className="yl-overlay" onClick={()=>setEditItemId(null)}><div className="yl-modal edit" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">編集</h3><input className="yl-input" value={eTitle} onChange={e=>setETitle(e.target.value)} placeholder="タイトル"/><div className="yl-optrow"><label className="yl-opt">期限<input type="date" className="yl-date" value={eDate} onChange={e=>setEDate(e.target.value)}/></label><label className="yl-opt">時間<TimeInput value={eTime} onChange={setETime}/></label><label className="yl-opt">繰り返し<select className="yl-select" value={eRepeat} onChange={e=>setERepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div><div className="yl-notify"><span className="yl-notify-label">🔔 通知</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(eReminders.includes(o.key)?" on":"")} onClick={()=>toggleEReminder(o.key)}>{o.label}</button>)}</div></div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEditItemId(null)}>閉じる</button><button className="yl-addbtn modal" onClick={saveEdit}>保存</button></div></div></div>}
      {viewer&&<div className="yl-overlay" onClick={()=>setViewer(null)}><div className="yl-modal photo" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">{viewer.isMemory?"思い出":"証明書"}</h3>{viewer.loading?<p className="yl-loading">読み込み中…</p>:viewer.src?<img className="yl-photo-img" src={viewer.src} alt={viewer.isMemory?"思い出":"証明書"}/>:<p className="yl-empty">画像が見つかりませんでした</p>}{viewer.confirming?<><p className="yl-modal-body" style={{margin:"0 0 12px"}}>この写真を削除しますか？元に戻せません。</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setViewer(v=>({...v,confirming:false}))}>やめる</button><button className="yl-modal-del" onClick={()=>viewer.isMemory?removeMemory(viewer.id):removePhoto(viewer.id)}>削除する</button></div></>:<div className="yl-modal-btns">{viewer.src&&<button className="yl-modal-cancel" onClick={()=>setViewer(v=>({...v,confirming:true}))}>削除</button>}<button className="yl-addbtn modal" onClick={()=>setViewer(null)}>閉じる</button></div>}</div></div>}
      {pickerId&&<div className="yl-overlay" onClick={()=>setPickerId(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">絵文字を選ぶ</h3><div className="yl-emoji-grid">{PICKER_EMOJIS.map(e=><button key={e} className="yl-emoji-pick" onClick={()=>setEmoji(pickerId,e)}>{e}</button>)}</div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEmoji(pickerId,"")}>絵文字なし</button><button className="yl-modal-cancel" onClick={()=>setPickerId(null)}>閉じる</button></div></div></div>}
      {mePicker&&<div className="yl-overlay" onClick={()=>setMePicker(false)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">あなたの絵文字を選ぶ</h3><div className="yl-emoji-grid">{ME_EMOJIS.map(e=><button key={e} className={"yl-emoji-pick"+(meEmoji===e?" on":"")} onClick={()=>{persistMeEmoji(e);setMePicker(false);}}>{e}</button>)}</div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setMePicker(false)}>閉じる</button></div></div></div>}
      {confirmDel&&<div className="yl-overlay" onClick={()=>setConfirmDel(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji">{confirmDel.emoji}</div><h3 className="yl-modal-title">{confirmDel.name} を削除しますか？</h3><p className="yl-modal-body">{(()=>{const n=items.filter(x=>x.space===confirmDel.id).length;return n>0?`${confirmDel.name}のケア（${n}件）も一緒に消えます。この操作は元に戻せません。`:"この操作は元に戻せません。";})()}</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmDel(null)}>キャンセル</button><button className="yl-modal-del" onClick={()=>removeMember(confirmDel.id)}>削除する</button></div></div></div>}
      {memoryDraft&&<div className="yl-overlay" onClick={()=>setMemoryDraft(null)}><div className="yl-modal edit routine" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">📸 思い出を残す</h3><input className="yl-input" value={memoryDraft.title} onChange={e=>setMemoryDraft(p=>({...p,title:e.target.value}))} placeholder="ひとこと（例：はじめてのトリミング／逆上がりできた！）" autoFocus/><label className="yl-addbtn modal" style={{display:"block",textAlign:"center",marginTop:12,cursor:"pointer"}}>📷 写真を選んで保存<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const d=memoryDraft;setMemoryDraft(null);addMemory(e,{space:d.space,title:d.title.trim(),emoji:"📸"});}}/></label><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setMemoryDraft(null)}>キャンセル</button></div></div></div>}
      {confirmReset&&<div className="yl-overlay" onClick={()=>setConfirmReset(false)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji">⚠️</div><h3 className="yl-modal-title">本当に消して良いですか？</h3><p className="yl-modal-body">登録した予定・ケア・消耗品・家族の情報がすべて消えて、最初の状態に戻ります。この操作は元に戻せません。</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmReset(false)}>キャンセル</button><button className="yl-modal-del" onClick={()=>{setConfirmReset(false);resetApp();}}>消して最初から</button></div></div></div>}
      {calPicker&&(()=>{
        const it=calPicker.item;
        const memberName=it?nameOf(it.space):"";
        const memberEmoji=it?(it.space==="me"?meEmoji:(members.find(m=>m.id===it.space)?.emoji||"")):"";
        const gcal=it?gcalLink(it,memberName,memberEmoji):null;
        const icsContent=it?generateIcal([it],members,meEmoji):generateIcal(items,members,meEmoji);
        const icsName=it?`${it.title}.ics`:"loalife-calendar.ics";
        return(
          <div className="yl-overlay" onClick={()=>setCalPicker(null)}>
            <div className="yl-modal cal-picker" onClick={e=>e.stopPropagation()}>
              <h3 className="yl-modal-title">📅 カレンダーに追加</h3>
              {it&&<p className="yl-cal-picker-sub">{it.emoji} {it.title}</p>}
              <a className="yl-cal-choice-btn google" href={gcal||"#"} target="_blank" rel="noopener noreferrer" onClick={()=>setCalPicker(null)}>
                <svg width="18" height="18" viewBox="0 0 48 48" style={{flexShrink:0}}><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.7 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.5 13.3l8 6.2C12.4 13 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.8-2.1 5.2-4.4 6.8l7 5.4C43.3 37.1 46.5 31.3 46.5 24.5z"/><path fill="#FBBC05" d="M10.5 28.5c-.5-1.5-.8-3-.8-4.5s.3-3 .8-4.5l-8-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l8-6.2z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7-5.4c-2 1.3-4.5 2.1-8.2 2.1-6.3 0-11.6-4.2-13.5-9.9l-8 6.2C6.6 42.6 14.6 48 24 48z"/></svg>
                Googleカレンダー
              </a>
              <button className="yl-cal-choice-btn apple" onClick={()=>{downloadIcal(icsContent,icsName);setCalPicker(null);}}>
                🍎 Appleカレンダー（.ics）
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
            <div className="yl-notify"><span className="yl-notify-label">🔔 リマインド（複数OK）{notifPerm==="default"&&<button className="yl-notif-small" onClick={handleNotifRequest}>許可する</button>}</span><div className="yl-notify-chips">{REMINDER_OPTS.filter(o=>o.key!==1440).map(o=><button key={o.key} className={"yl-nchip"+(routineEdit.reminders.includes(o.key)?" on":"")} onClick={()=>toggleRoutineReminder(o.key)}>{o.label}</button>)}</div></div>
            <div className="yl-modal-btns">
              {routineEdit.id&&<button className="yl-modal-cancel" onClick={()=>removeRoutine(routineEdit.id)}>削除</button>}
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
              {supplyEdit.id&&<button className="yl-modal-cancel" onClick={()=>removeSupply(supplyEdit.id)}>削除</button>}
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
