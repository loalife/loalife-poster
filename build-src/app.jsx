import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { DndContext, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
const daysBetween = (a,b) => { const[ay,am,ad]=a.split("-").map(Number),[by,bm,bd]=b.split("-").map(Number); return Math.round((new Date(by,bm-1,bd)-new Date(ay,am-1,ad))/86400000); };
const addDays = (s,n) => { const[y,m,d]=s.split("-").map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()+n); return iso(dt); };
const fmtBirthday = (s) => { if(!s)return""; const[,mo,d]=s.split("-").map(Number); return`${mo}月${d}日`; };

const TYPE_META={dream:{label:"夢",emoji:"🌈",bg:"#F5EAD8",fg:"#B23A48"},work:{label:"仕事",emoji:"💼",bg:"#E7E9EF",fg:"#5B6B9E"},event:{label:"予定",emoji:"📅",bg:"#ECE6F1",fg:"#8A6D9E"},social:{label:"飲み会",emoji:"🍻",bg:"#F3E7D6",fg:"#C77A2E"},habit:{label:"習慣",emoji:"💪",bg:"#F5EAD2",fg:"#C99A2E"}};
const ME_TYPES=["dream","work","event","social","habit"];
// 予定系（その日に起きる・カレンダー表示・日付が実質必須）。それ以外はToDo系＝期限は任意。
const isScheduleType=(t)=>t==="event"||t==="social";
const KIND_STYLE={pet:{bg:"#E4EEE7",fg:"#557E63",word:"ケア"},person:{bg:"#E3EEFF",fg:"#3B7BF6",word:"予定"}};
// 安心ステータスのレベル：OK / 注意 / 要対応
const LEVEL_META={ok:{label:"順調",dot:"#6FA382"},warn:{label:"注意",dot:"#D9A441"},alert:{label:"要対応",dot:"#B23A48"},none:{label:"記録なし",dot:"#B5ADA3"}};
const DOG_KINDS=[{key:"daycare",label:"保育園",emoji:"🏫"},{key:"vaccine",label:"ワクチン",emoji:"💉"},{key:"rabies",label:"狂犬病",emoji:"🐕"},{key:"filaria",label:"フィラリア",emoji:"🦟"},{key:"med",label:"投薬",emoji:"💊"},{key:"trim",label:"トリミング",emoji:"✂️"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const CAT_KINDS=[{key:"vaccine",label:"ワクチン",emoji:"💉"},{key:"filaria",label:"フィラリア",emoji:"🦟"},{key:"med",label:"投薬",emoji:"💊"},{key:"trim",label:"トリミング",emoji:"✂️"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const OTHER_PET_KINDS=[{key:"checkup",label:"健康診断",emoji:"🩺"},{key:"med",label:"投薬",emoji:"💊"},{key:"groom",label:"お手入れ",emoji:"🧼"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const PERSON_KINDS=[{key:"lesson",label:"習い事",emoji:"🎒"},{key:"event",label:"予定",emoji:"📅"},{key:"school",label:"学校行事",emoji:"🏫"},{key:"med",label:"投薬",emoji:"💊"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"dental",label:"歯科",emoji:"🦷"},{key:"checkup",label:"健康診断",emoji:"🩺"},{key:"vaccine",label:"予防接種",emoji:"💉"},{key:"other",label:"その他",emoji:"✨"}];
const SPECIES=[{key:"dog",label:"犬",emoji:"🐶"},{key:"cat",label:"猫",emoji:"🐱"},{key:"other",label:"その他",emoji:"🐹"}];
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

const careKindsFor=(m)=>{if(!m)return[];if(m.kind==="person")return PERSON_KINDS;if(m.species==="cat")return CAT_KINDS;if(m.species==="other")return OTHER_PET_KINDS;return DOG_KINDS;};

// ライフログ・カレンダー用：各アイテムが「どの日に紐づくか」を1つに正規化する。
//  予定/ケア=dueDate、ストック=購入日(lastBought)、思い出=date、ルーティン=実施日(doneDate)。
//  誕生日(bday)は毎年くりかえしなので日付軸では別扱い（null）。
function itemDate(it){
  if(!it)return null;
  if(it.type==="memory")return it.date||null;
  if(it.type==="supply")return it.lastBought||null;
  if(it.type==="routine")return it.doneDate||null;
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
// 前回実施日からの経過ラベル（前回いつ？をひと目で）
function elapsedLabel(dateStr){
  if(!dateStr)return{txt:"まだ記録なし",tone:"none"};
  const d=daysUntil(dateStr);if(d==null)return{txt:"—",tone:"none"};
  const ago=-d;
  if(ago<=0)return{txt:"今日やりました",tone:"fresh"};
  if(ago===1)return{txt:"昨日",tone:"fresh"};
  if(ago<7)return{txt:`${ago}日前`,tone:"ok"};
  if(ago<28){const w=Math.floor(ago/7);return{txt:`${w}週間前`,tone:ago>=21?"warn":"ok"};}
  const mo=Math.floor(ago/30);return{txt:`約${mo}か月前`,tone:"warn"};
}
// からだの記録（体重・身長・体調）
const HEALTH_CONDS=[{key:"good",label:"元気",emoji:"😊"},{key:"ok",label:"ふつう",emoji:"😐"},{key:"bad",label:"元気ない",emoji:"😟"}];
const condMeta=(k)=>HEALTH_CONDS.find(c=>c.key===k)||null;
// メンバーごとの色分け（カレンダーで色別管理。自分で選べる）
const MEMBER_COLORS=["#E39A5C","#B23A48","#557E63","#D9A441","#5B7A9E","#C77A2E","#8A6D9E","#3E8E8E","#7A8B4F","#8A8178"];
const DEFAULT_SPACE_COLOR="#D98A4E";
// 今日のようす（日記）の選択肢。元気は5段階（推移グラフ用に score を持つ。旧3段階キーも内包）
const DIARY_ENERGY=[{key:"great",label:"とても元気",emoji:"😄",score:5},{key:"genki",label:"元気",emoji:"😊",score:4},{key:"normal",label:"ふつう",emoji:"🙂",score:3},{key:"low",label:"低め",emoji:"😕",score:2},{key:"bad",label:"ぐったり",emoji:"😣",score:1}];
const DIARY_APPETITE=[{key:"lots",label:"もりもり",emoji:"🍽️",score:3},{key:"normal",label:"ふつう",emoji:"🍚",score:2},{key:"little",label:"すくなめ",emoji:"🥄",score:1}];
const DIARY_POOP=[{key:"good",label:"good",emoji:"💩"},{key:"loose",label:"ゆるい",emoji:"💧"},{key:"none",label:"なし",emoji:"🚫"}];
const diaryMeta=(group,k)=>group.find(c=>c.key===k)||null;
// 症状（お薬手帳・体調メモ用。複数選択可）
// 症状マスタ（キー→表示）。種別ごとの出し分けは DIARY_CONFIG で参照。sensitive はセンシティブ項目。
const SYMPTOMS={
  fever:{label:"熱",emoji:"🌡️"},cough:{label:"咳",emoji:"😮‍💨"},sneeze:{label:"くしゃみ",emoji:"🤧"},nose:{label:"鼻水",emoji:"💧"},throat:{label:"喉の痛み",emoji:"😷"},headache:{label:"頭痛",emoji:"🤕"},fatigue:{label:"だるさ",emoji:"🥱"},diarrhea:{label:"下痢",emoji:"🚽"},vomit:{label:"嘔吐",emoji:"🤮"},noappetite:{label:"食欲不振",emoji:"🥄"},itch:{label:"かゆがる",emoji:"🐾"},rash:{label:"発疹",emoji:"🔴"},mood:{label:"機嫌がわるい",emoji:"😤"},period:{label:"生理",emoji:"🩸",sensitive:true},limp:{label:"元気がない",emoji:"😣"}
};
const symptomMeta=(k)=>SYMPTOMS[k]||null;
// 種別 → 今日のようすの表示行・症状。ハードコードせずここで一元管理（将来項目を足しやすい）。
// rows: energy(元気) / appetite(食欲) / poop(うんち) / walk(さんぽ) / hospital(病院)
const DIARY_CONFIG={
  pet:{rows:["energy","appetite","poop","walk","hospital"],symptoms:["cough","sneeze","diarrhea","vomit","noappetite","itch"]},
  adult:{rows:["energy","hospital"],symptoms:["headache","fever","cough","nose","throat","fatigue","period"]},
  child:{rows:["energy","appetite","hospital"],symptoms:["fever","cough","nose","vomit","diarrhea","rash","mood"]},
};
const diaryConfigFor=(t)=>DIARY_CONFIG[t]||DIARY_CONFIG.adult;
// 大切な情報カード（緊急連絡先・アレルギー/禁忌・病院メモなど）
const CARD_PRESETS=[{key:"emergency",label:"緊急連絡先",emoji:"🚨"},{key:"allergy",label:"アレルギー・禁忌",emoji:"⚠️"},{key:"hospital",label:"かかりつけ・病院メモ",emoji:"🏥"},{key:"other",label:"メモ",emoji:"📝"}];
const cardMeta=(k)=>CARD_PRESETS.find(c=>c.key===k)||CARD_PRESETS[CARD_PRESETS.length-1];
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

const HOURS=Array.from({length:24},(_,i)=>i);
const MINS=[0,5,10,15,20,25,30,35,40,45,50,55];
function TimeInput({value,onChange}){
  const curH=value?Number(value.split(":")[0]):"";
  const curM=value?Math.round(Number(value.split(":")[1])/5)*5%60:0;
  const upd=(h,m)=>{if(h===""){onChange("");return;}const hh=String(h).padStart(2,"0"),mm=String(m).padStart(2,"0");onChange(hh+":"+mm);};
  return(<div className="yl-timepick"><select className="yl-tsel" value={curH} onChange={e=>upd(e.target.value===""?"":Number(e.target.value),curM)}><option value="">--</option>{HOURS.map(h=><option key={h} value={h}>{String(h).padStart(2,"0")}</option>)}</select><span className="yl-tcolon">:</span><select className="yl-tsel" value={curM} onChange={e=>upd(curH===""?9:curH,Number(e.target.value))}>{MINS.map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}</option>)}</select></div>);
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
  const[editGroup,setEditGroup]=useState(""); // フォルダ（多頭飼い向けの分類）
  const[editAvatar,setEditAvatar]=useState(""); // 写真アイコン（photo id）
  const[editVisibility,setEditVisibility]=useState("household");
  const[editPersonType,setEditPersonType]=useState("child"); // 人メンバーの大人/子ども区分
  const[confirmDel,setConfirmDel]=useState(null);
  const[confirmReset,setConfirmReset]=useState(false);
  const[confirmRestore,setConfirmRestore]=useState(false);
  const[choreDateEdit,setChoreDateEdit]=useState(null); // お世話ログの実施日を後から修正 {id,date}
  const[choreDraft,setChoreDraft]=useState(""); // お世話ログの自由追加入力
  const[a2hsHint,setA2hsHint]=useState(false); // 「ホーム画面に追加」データ保護の案内（1回だけ）
  const[confirmAct,setConfirmAct]=useState(null); // 汎用「本当に削除しますか？」 {label,fn}
  const askDelete=(label,fn)=>setConfirmAct({label,fn});
  const[memberSel,setMemberSel]=useState("me"); // メンバーモードで選択中の人
  const[friendBdayName,setFriendBdayName]=useState(""); // 友達の誕生日・記念日（わくわく）
  const[healthW,setHealthW]=useState("");const[healthH,setHealthH]=useState("");const[healthCond,setHealthCond]=useState(""); // からだの記録の入力
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
  const[diaryDraft,setDiaryDraft]=useState({energy:"",appetite:"",poop:"",walk:false,hospital:false,note:"",symptoms:[],photo:null});
  const[diaryOpen,setDiaryOpen]=useState({}); // 今日のようすカードの開閉（アプリ内state・localStorage非依存）。既定=今日開・過去閉
  const[profileOpen,setProfileOpen]=useState(false); // プロフィール詳細（顔写真・説明・誕生日・編集）の開閉。既定=畳む
  const[memListOpen,setMemListOpen]=useState(false); // メンバー切替のドロップアップ一覧の開閉
  // 支出入力（記録は常に今日の日付で即記録。日付変更は編集画面のみ＝例外用途）
  const[expAmount,setExpAmount]=useState("");
  const[expCat,setExpCat]=useState("hospital");
  const[expNote,setExpNote]=useState("");
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
  const[secOrder,setSecOrder]=useState(()=>{const DEF={record:["certs","health","diary","album"],manage:["routine","chore","list","prep","supply","expense","belong","cards"]};try{const s=JSON.parse(localStorage.getItem("loalife-secorder"));if(s&&typeof s==="object")return{...DEF,...s};}catch(e){}return DEF;});
  // ＋入力ハブ（全入力を1か所に集約）。hubOpen=チューザー、inputSheet=開いている入力フォーム
  const[hubOpen,setHubOpen]=useState(false);
  const[inputSheet,setInputSheet]=useState(null); // "schedule"|"health"|"diary"|"expense"|"belong"|"bday"|null
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
      try{await storage.set(STORAGE_KEY,serializeState({members:m,items:it,usage:u,meEmoji,meBirthday,meColor,meName,meAvatar}));}catch(e){}
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
      showFlash("アイコンを設定しました 📷");
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

  const onFilePicked=async(e,id)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash("ファイルが大きすぎます（20MB以下）");return;}
    try{
      const dataUrl=await downscaleImage(file);
      const ok=await photoStorage.set(`photo:${id}`,dataUrl);
      if(!ok){showFlash("ストレージ容量が不足しています");return;}
      setPhotos(p=>({...p,[id]:dataUrl}));
      setItems(prev=>{const next=prev.map(x=>x.id===id?{...x,photo:true}:x);try{storage.set(STORAGE_KEY,serializeState({members,items:next,usage,meEmoji,meBirthday,meColor,meName,meAvatar})).catch(()=>{});}catch(er){}return next;});
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
    setLifeDraft(null);showFlash("記録しました ✏️");
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
    if(!isMemberTab&&isScheduleType(draftType)&&!draftDate){showFlash("「"+TYPE_META[draftType].label+"」は日付を入れてください");return;}
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
    const next=members.map(m=>m.id===id?{...m,name,birthday:editBirthday,gotchaDay:editGotcha||"",group:editGroup.trim()||"",avatar:editAvatar||"",visibility:editVisibility,...(m.kind==="person"?{personType:editPersonType}:{})}:m);
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
    if(w==null&&h==null&&!healthCond){showFlash("体重などを入力してください");return;}
    if(w!=null&&(isNaN(w)||w<=0)){showFlash("体重は数字で入力してください");return;}
    if(h!=null&&(isNaN(h)||h<=0)){showFlash("身長は数字で入力してください");return;}
    const rec={id:"hl"+Date.now(),space:tab,type:"health",date:todayIso,createdAt:Date.now()};
    if(w!=null){rec.weight=w;rec.wunit=weightUnit;}if(h!=null)rec.height=h;if(healthCond)rec.condition=healthCond;
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    setHealthW("");setHealthH("");setHealthCond("");
    showFlash("からだの記録を保存しました 📈");
  };
  const removeHealth=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
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
    if(!d.energy&&!d.appetite&&!d.poop&&!d.walk&&!d.hospital&&!note&&!syms.length&&!d.photo){showFlash("ようすを選ぶか、ひとことを書いてください");return;}
    const id="dy"+Date.now();
    const rec={id,space:tab,type:"diary",date:todayIso,createdAt:Date.now()};
    if(d.energy)rec.energy=d.energy;if(d.appetite)rec.appetite=d.appetite;if(d.poop)rec.poop=d.poop;
    if(d.walk)rec.walk=true;if(d.hospital)rec.hospital=true;if(note)rec.note=note;if(syms.length)rec.symptoms=syms;
    if(syms.includes("period"))rec.private=true; // 生理を含む記録はセンシティブ＝本人のみ
    if(d.photo){const pid="dyp"+Date.now();const ok=await photoStorage.set(`photo:${pid}`,d.photo);if(ok){setPhotos(p=>({...p,[pid]:d.photo}));rec.photo=true;rec.photos=[pid];}}
    persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});
    setDiaryDraft({energy:"",appetite:"",poop:"",walk:false,hospital:false,note:"",symptoms:[],photo:null});
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
  // 証明書を年ごとにまとめる（何年度ぶん、が分かるように）
  const certsByYear=useMemo(()=>{const map={};certs.forEach(c=>{const d=itemDate(c)||(c.createdAt?iso(new Date(c.createdAt)):"");const y=d?d.slice(0,4):"----";(map[y]=map[y]||[]).push(c);});return Object.keys(map).sort((a,b)=>b.localeCompare(a)).map(y=>({year:y,items:map[y]}));},[certs]);
  // お世話ログ（トイレ掃除・シャンプー等）：やった履歴と前回からの経過
  const chores=useMemo(()=>items.filter(x=>x.space===tab&&x.type==="chore").sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)),[items,tab]);
  const addChore=(title,emoji)=>{if(chores.some(c=>c.title===title))return;const rec={id:"ch"+Date.now(),space:tab,type:"chore",title,emoji:emoji||"🧹",lastDone:null,history:[],createdAt:Date.now()};persist(members,[...items,rec]);saveItemToFs(rec).catch(()=>{});};
  // お世話ログの自由追加（テンプレ以外も自分で登録）。絵文字は内容から推定。
  const addCustomChore=()=>{const t=choreDraft.trim();if(!t)return;if(chores.some(c=>c.title===t)){showFlash("同じ項目があります");setChoreDraft("");return;}addChore(t,guessEmoji(t,"🧹"));setChoreDraft("");showFlash("追加しました ✓");};
  const logChore=(id)=>{const next=items.map(x=>{if(x.id!==id)return x;const hist=[todayIso,...(x.history||[]).filter(d=>d!==todayIso)].slice(0,30);return{...x,lastDone:todayIso,history:hist};});persist(members,next);const it=next.find(x=>x.id===id);if(it)saveItemToFs(it).catch(()=>{});showFlash("記録しました ✓");};
  const removeChore=(id)=>{deleteItemFromFs(items.find(x=>x.id===id)).catch(()=>{});persist(members,items.filter(x=>x.id!==id));};
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

  const visible=useMemo(()=>{let arr=items.filter(x=>x.space===tab&&x.type!=="routine"&&x.type!=="supply"&&x.type!=="memory"&&x.type!=="bday"&&x.type!=="health"&&x.type!=="diary"&&x.type!=="expense"&&x.type!=="card"&&x.type!=="belonging"&&x.type!=="chore");if(filter!=="all")arr=arr.filter(x=>isMemberTab?x.careKind===filter:x.type===filter);arr=[...arr].sort((a,b)=>{const ao=a.order,bo=b.order;if(ao!=null&&bo!=null&&ao!==bo)return ao-bo;if(ao!=null&&bo==null)return -1;if(ao==null&&bo!=null)return 1;if(!a.dueDate&&!b.dueDate)return b.createdAt-a.createdAt;if(!a.dueDate)return 1;if(!b.dueDate)return -1;return a.dueDate.localeCompare(b.dueDate);});return arr.sort((a,b)=>a.done===b.done?0:a.done?1:-1);},[items,tab,filter,isMemberTab]);
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
  const hasListItems=useMemo(()=>items.some(x=>x.space===tab&&x.type!=="routine"&&x.type!=="supply"&&x.type!=="memory"&&x.type!=="bday"&&x.type!=="health"&&x.type!=="diary"&&x.type!=="expense"&&x.type!=="card"&&x.type!=="belonging"&&x.type!=="chore"),[items,tab]);
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
      <button className="yl-bubble" style={{background:meta.bg,color:meta.fg}} onClick={()=>setPickerId(it.id)} onPointerDown={e=>e.stopPropagation()} title="タップで絵文字を変更">{it.emoji}</button>
      <div className="yl-body" onClick={()=>openEdit(it)}>
        <div className="yl-row1"><span className="yl-badge" style={{background:meta.bg,color:meta.fg}}>{label}</span><span className="yl-text">{it.title}</span></div>
        {(ds||cst||it.time||it.reminders||it.type==="care"||(it.repeat&&it.repeat!=="none"))&&(
          <div className="yl-meta">
            {cst?<span className={"yl-cstate "+cst.tone}>{cst.label}</span>:ds&&<span className={"yl-due "+ds.tone}>{ds.label}</span>}
            {it.time&&<span className="yl-time">🕐 {it.time}</span>}
            {it.repeat&&it.repeat!=="none"&&<span className="yl-repeat">🔁 {REPEATS.find(r=>r.key===it.repeat)?.label}</span>}
            {it.reminders&&it.reminders.length>0&&<span className="yl-notif-badge">🔔 {it.reminders.length<=2?it.reminders.map(reminderLabel).join("・"):it.reminders.length+"件"}</span>}
            {actionable&&<button className="yl-resolve" onClick={e=>{e.stopPropagation();toggle(it.id);}} title="記録すると次回予定へ自動で進みます">✓ 完了にして次回へ</button>}
            {!isCare&&!it.done&&it.dueDate&&daysUntil(it.dueDate)<=0&&<button className="yl-snooze" onClick={e=>{e.stopPropagation();snooze(it.id);}}>→ 明日へ</button>}
            {it.type==="care"&&<button className="yl-prev-copy" onClick={e=>{e.stopPropagation();openQuickCopy(it);}} title="前回と同じ内容で追加">↩ 前回コピー</button>}
            {it.dueDate&&<button className="yl-cal-item" onClick={e=>{e.stopPropagation();setCalPicker({item:it});}} title="カレンダーに追加">📅</button>}
            {it.type==="care"&&(it.photo?<button className="yl-photo" onClick={e=>{e.stopPropagation();viewPhoto(firstPhotoId(it));}}>📷 証明書</button>:<label className="yl-photo add" onClick={e=>e.stopPropagation()}>📎 証明書を追加<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>onFilePicked(e,it.id)}/></label>)}
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
  const colorOf=(spaceId)=>{if(spaceId==="me")return meColor||"#E39A5C";const m=members.find(x=>x.id===spaceId);return(m&&m.color)||DEFAULT_SPACE_COLOR;};
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
  const calGrid=useMemo(()=>{
    const{y,m}=calCursor;
    const startDow=new Date(y,m,1).getDay();
    const daysInMonth=new Date(y,m+1,0).getDate();
    const cells=[];
    for(let i=0;i<startDow;i++)cells.push(null);
    for(let d=1;d<=daysInMonth;d++){
      const dIso=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const di=calSpaceItems.filter(x=>itemDate(x)===dIso);
      const colors=[];const seenSp={};di.forEach(x=>{if(!seenSp[x.space]){seenSp[x.space]=1;colors.push(colorOf(x.space));}});
      cells.push({d,iso:dIso,count:di.length,ind:{
        photo:di.some(x=>x.photo),
        memory:di.some(x=>x.type==="memory"),
        care:di.some(x=>x.type==="care"),
        supply:di.some(x=>x.type==="supply"),
        event:di.filter(x=>x.type==="event"||x.type==="routine").length,
        anniv:annivOn(dIso).length>0,
        colors,
      }});
    }
    while(cells.length%7!==0)cells.push(null);
    return cells;
  },[calCursor,calSpaceItems,annivAll,calFilter]);
  const dayTimeline=useMemo(()=>{
    if(!calDay)return[];
    const list=calSpaceItems.filter(x=>itemDate(x)===calDay).map(x=>({item:x,time:x.time||""}));
    const anniv=annivOn(calDay).map(a=>({anniv:a,time:""}));
    return[...anniv,...list].sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));
  },[calDay,calSpaceItems,annivAll,calFilter]);
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
    const bombs=[];
    items.forEach(x=>{
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
    items.forEach(x=>{
      if(x.done)return;
      if(x.type==="routine"){if(x.doneDate!==todayIso)todos.push({key:x.id,emoji:x.emoji||"⏰",title:x.title,space:x.space,time:x.time,tag:x.time||"今日",pri:2});return;}
      if(x.dueDate&&!bombSet.has(x.id)){const d=daysUntil(x.dueDate);if(d<=0)todos.push({key:x.id,emoji:x.emoji||"•",title:x.title,space:x.space,time:x.time,tag:d<0?"やり残し":"今日",pri:d<0?0:1});}
    });
    todos.sort((a,b)=>a.pri-b.pri||((a.time||"99")<(b.time||"99")?-1:1));
    // 直近の予定（明日〜7日・爆弾/ルーティン除く）は別枠で薄く表示。今日リストには混ぜない。
    const upcoming=[];
    items.forEach(x=>{if(x.done||!x.dueDate||bombSet.has(x.id)||x.type==="routine")return;const d=daysUntil(x.dueDate);if(d>=1&&d<=7)upcoming.push({key:x.id,emoji:x.emoji||"•",title:x.title,space:x.space,d,tag:d===1?"明日":`あと${d}日`});});
    upcoming.sort((a,b)=>a.d-b.d);
    return{bombs,todos,upcoming};
  },[items,todayIso]);

  // ② 安心ステータス：各メンバーのレベルと一言
  // 「注意」は本当のケア漏れだけに絞る：期限切れ・在庫切れ＝要対応、重要ケアが迫る/在庫少＝注意。
  // 楽しみな予定（イベント等）は注意にしない（アラート疲れ防止）。
  // 見守るデータが1件も無い時は「順調(緑)」ではなく「記録なし(グレー)」＝偽の安心を出さない。
  const spaceTracked=(spaceId)=>items.some(x=>x.space===spaceId&&(x.type==="supply"||x.type==="routine"||x.type==="care"||!!x.dueDate));
  const spaceLevel=(spaceId)=>{
    let overdue=0,soonCare=0;
    items.forEach(x=>{if(x.space!==spaceId||x.done||!x.dueDate)return;const d=daysUntil(x.dueDate);if(isOverdue(x))overdue++;else if(x.careKind&&HIGH_KINDS.has(x.careKind)&&d>=0&&d<=3)soonCare++;});
    const sup=lowSupplies.filter(o=>o.item.space===spaceId);
    if(overdue>0||sup.some(o=>o.st.tone==="out"))return"alert";
    if(soonCare>0||sup.some(o=>o.st.tone==="low"))return"warn";
    if(!spaceTracked(spaceId))return"none";
    return"ok";
  };
  const spaceConcern=(spaceId)=>{
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
          {obStep===0&&<div className="yl-ob-inner"><div className="yl-ob-emoji">🏠</div><h1 className="yl-ob-title">家族の「今」が、ひと目でわかる。</h1><p className="yl-ob-sub">わたしと、大切な家族を、ひとつの場所で。</p><button className="yl-ob-btn" onClick={()=>setObStep(1)}>はじめる</button><button className="yl-ob-link" onClick={loadSample}>サンプルで試してみる</button></div>}
          {obStep===1&&<div className="yl-ob-inner"><p className="yl-ob-step">1 / 2</p><h2 className="yl-ob-h2">まず、あなたの「やりたいこと」を1つ</h2><p className="yl-ob-sub">あとから、いつでも追加できます</p><div className="yl-ob-chips">{["海外旅行に行く","副業・スキルアップ","毎日運動する","語学を身につける"].map(ex=><button key={ex} className="yl-ob-chip" onClick={()=>setObWish(ex)}>{ex}</button>)}</div><input className="yl-input" value={obWish} onChange={e=>setObWish(e.target.value)} onKeyDown={e=>e.key==="Enter"&&setObStep(2)} placeholder="やりたいこと…" autoFocus/><button className="yl-ob-btn" onClick={()=>setObStep(2)}>次へ</button><button className="yl-ob-link" onClick={()=>{setObWish("");setObStep(2);}}>スキップ</button></div>}
          {obStep===2&&<div className="yl-ob-inner"><p className="yl-ob-step">2 / 2</p><h2 className="yl-ob-h2">一緒に見守りたい家族はいますか？</h2>{!obKind?<div className="yl-ob-choices"><button className="yl-ob-choice" onClick={()=>{setObKind("pet");setObEmoji(PET_EMOJIS[0]);}}>🐶 ペット</button><button className="yl-ob-choice" onClick={()=>{setObKind("person");setObEmoji(PERSON_EMOJIS[0]);}}>👧 家族（人）</button><button className="yl-ob-link" onClick={finishOnboarding}>今は追加しない</button></div>:<div className="yl-ob-form">{obKind==="pet"&&<div className="yl-kindrow">{SPECIES.map(s=><button key={s.key} className={"yl-kindbtn sm"+(obSpecies===s.key?" on":"")} onClick={()=>{setObSpecies(s.key);setObEmoji(s.emoji);}}>{s.emoji} {s.label}</button>)}</div>}<div className="yl-emoji-row">{(obKind==="person"?PERSON_EMOJIS:PET_EMOJIS).map(e=><button key={e} className={"yl-emoji"+(obEmoji===e?" on":"")} onClick={()=>setObEmoji(e)}>{e}</button>)}</div><input className="yl-input" value={obName} onChange={e=>setObName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&finishOnboarding()} placeholder={obKind==="person"?"名前（例：ゆうと）":"名前（例：ぽち）"} autoFocus/><label className="yl-opt" style={{width:"100%",marginTop:8}}>誕生日（任意）<input type="date" className="yl-date" style={{width:"100%"}} value={obBirthday} onChange={e=>setObBirthday(e.target.value)}/></label><button className="yl-ob-btn" onClick={finishOnboarding}>はじめる</button><button className="yl-ob-link" onClick={()=>setObKind(null)}>戻る</button></div>}</div>}
        </div>
      )}

      <div className="yl-wrap">
        <header className="yl-head">
          <h1 className="yl-title">{tab==="home"?"🏠 ホーム":tab==="cal"?"📅 カレンダー":tab==="settings"?"⚙️ 設定":personSeg==="manage"?"🗂 管理":"📝 記録"}</h1>
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
                      <span className={"yl-bday-tag"+(a.daysUntil===0?" today":"")}>{a.daysUntil===0?(a.kind==="gotcha"&&a.years?`迎えて${a.years}年！`:"今日！"):`あと${a.daysUntil}日`}</span>
                    </div>
                  ))}
                </section>
              )}
              {/* 緊急（見逃せないこと）を先頭に */}
              {homeData.bombs.length>0&&(
                <section className="yl-bombs">
                  <h2 className="yl-sec-title alert">⚠️ 見逃せないこと</h2>
                  <ul className="yl-bomb-list">
                    {homeData.bombs.slice(0,3).map(({item,d})=>(
                      <li key={item.id} className={"yl-bomb-item"+(d<0?" over":"")} onClick={()=>setTab(item.space)}>
                        <span className="yl-bomb-emoji">{item.emoji||"⚠️"}</span>
                        <span className="yl-bomb-body"><span className="yl-bomb-text">{item.title}</span><span className="yl-bomb-who">{nameOf(item.space)}</span></span>
                        <span className={"yl-bomb-tag"+(d<0?" over":"")}>{d<0?`${-d}日超過`:d===0?"今日":d===1?"明日":`あと${d}日`}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {todayClear?(
                <section className="yl-hero calm">
                  <div className="yl-hero-emoji">☀️</div>
                  <p className="yl-hero-title">今日は安心です</p>
                  <p className="yl-hero-sub">{members.length===0?"ゆっくり過ごせる一日を":(()=>{const pets=members.filter(m=>m.kind==="pet");if(pets.length===1)return `${pets[0].emoji} ${pets[0].name}は穏やかです`;if(members.length===1)return `${members[0].emoji} ${members[0].name}も穏やかです`;return `${members.map(m=>m.emoji).join("")} みんな穏やかです`;})()}</p>
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
              {homeData.upcoming.length>0&&(
                <section className="yl-upcoming">
                  <p className="yl-upcoming-label">🗓 直近の予定</p>
                  <ul className="yl-upcoming-list">
                    {homeData.upcoming.slice(0,4).map(u=>(
                      <li key={u.key} className="yl-upcoming-item" onClick={()=>setTab(u.space)}>
                        <span className="yl-upcoming-emoji">{u.emoji}</span>
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
                  <p className="yl-quickcond-label">📝 今日のみんなの調子は？</p>
                  <ul className="yl-quickcond-list">
                    {need.map(s=>(
                      <li key={s.id} className="yl-quickcond-item">
                        <span className="yl-quickcond-emoji">{avatarNode(s,"sm")}</span>
                        <span className="yl-quickcond-name">{s.name}</span>
                        <button className="yl-quickcond-btn" onClick={()=>quickHealthy(s.id)}>👌 今日も元気</button>
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
                <h2 className="yl-sec-title">{spaces.some(s=>{const l=spaceLevel(s.id);return l==="warn"||l==="alert";})?"⚠️":"😊"} みんなの様子</h2>
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
                  <span className="yl-habit-label">🔁 今日の習慣</span>
                  <span className="yl-habit-bar"><span className="yl-habit-fill" style={{width:Math.round(routineDoneToday/allRoutines.length*100)+"%"}}/></span>
                  <span className="yl-habit-count">{routineDoneToday}/{allRoutines.length}</span>
                </section>
              )}
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
                      <div className="yl-hexp-top"><span className="yl-hexp-label">💰 今月の支出</span><span className="yl-hexp-total">{fmtYen(homeExpense.total)}</span></div>
                      {homeExpense.rows.length>1&&(
                        <ul className="yl-hexp-rows">
                          {homeExpense.rows.slice(0,4).map(r=>(
                            <li key={r.space}><button className="yl-hexp-row" onClick={()=>setTab(r.space)}>
                              <span className="yl-hexp-name">{r.name}{r.spike&&<span className="yl-hexp-spike">⚠️ 先月より増</span>}</span>
                              <span className="yl-hexp-amt">{fmtYen(r.amount)}</span>
                            </button></li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}
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
                  <section className="yl-summary"><h2 className="yl-sec-title light">小さなふりかえり</h2><div className="yl-summary-row"><div className="yl-stat"><span className="yl-stat-n">{weekDone}</span><span className="yl-stat-l">今週やったケア</span></div><div className="yl-stat"><span className="yl-stat-n">{allRoutines.length>0?`${routineDoneToday}/${allRoutines.length}`:"—"}</span><span className="yl-stat-l">今日のルーティン</span></div></div></section>
                  {homeExpense.total===0&&lowSupplies.length===0&&<p className="yl-routine-empty" style={{padding:"4px 0"}}>支出やストックを記録すると、ここにまとまります。</p>}
                </div>
              )}
            </div>
            <button className="yl-reset" onClick={()=>setConfirmReset(true)}>⟳ サンプルを消して最初から</button>
          </div>
        ):tab==="cal"?(
          <div className="yl-cal">
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
                  <span className="yl-cal-marks">
                    {c.ind.anniv&&<span className="yl-cal-em">🎂</span>}
                    {c.ind.photo?<span className="yl-cal-em">📷</span>:c.ind.memory?<span className="yl-cal-em">📝</span>:null}
                    <span className="yl-cal-dots">
                      {c.ind.colors.slice(0,4).map((col,ci)=><span key={ci} className="yl-cal-dot" style={{background:col}}/>)}
                    </span>
                  </span>
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
                        <span className="yl-tlday-time">🎉</span>
                        <span className="yl-tlday-emoji">{e.anniv.emoji}</span>
                        <span className="yl-tlday-body"><span className="yl-tlday-text">{e.anniv.label}</span></span>
                      </li>
                    ):(
                      <li key={e.item.id} className={"yl-tlday-item cat-"+calCategory(e.item)+(((e.item.type==="memory"||e.item.type==="event"||e.item.type==="care"))?" tap":"")} style={{borderLeftColor:colorOf(e.item.space)}} onClick={()=>(e.item.type==="memory"||e.item.type==="event"||e.item.type==="care")?openLifeEdit(e.item):null}>
                        <span className="yl-tlday-time">{e.item.time||"—"}</span>
                        {firstPhotoId(e.item)&&photos[firstPhotoId(e.item)]?<span className="yl-tlday-thumbwrap"><img className="yl-tlday-thumb" src={photos[firstPhotoId(e.item)]} alt=""/>{photoIdsOf(e.item).length>1&&<span className="yl-photo-badge">+{photoIdsOf(e.item).length-1}</span>}</span>:<span className="yl-tlday-emoji">{e.item.emoji||"•"}</span>}
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
            <button className="yl-cal-exportall" onClick={()=>setCalPicker({bulk:true})}>📅 予定をカレンダーアプリに出力（.ics）</button>
            <p className="yl-foot" style={{marginTop:8}}>日付をタップして、その日の暮らしを記録・ふりかえり</p>
          </div>
        ):tab==="settings"?(
          <div className="yl-settings">
            <h2 className="yl-sec-title" style={{marginBottom:12}}>⚙️ 設定</h2>
            <section className="yl-set-sec">
              <h3 className="yl-set-title">🔔 通知</h3>
              <p className="yl-set-desc">予定やリマインド・誕生日をお知らせします。</p>
              {notifPerm==="granted"?<p className="yl-set-ok">✓ 通知は許可されています</p>:notifPerm==="denied"?<p className="yl-set-warn">端末の設定で通知がオフになっています</p>:<button className="yl-addbtn sm" onClick={handleNotifRequest}>通知を許可する</button>}
            </section>
            <section className="yl-set-sec">
              <h3 className="yl-set-title">💾 バックアップ</h3>
              <p className="yl-set-desc">データはこの端末に保存されます。機種変更や端末の故障に備えて、ときどきバックアップ（.json）を書き出しておくと安心です。証明書・思い出・アイコンの写真も一緒に保存されます。</p>
              <button className="yl-addbtn sm" style={{marginBottom:10}} onClick={exportData}>💾 データを書き出す（写真ふくむ）</button>
              {confirmRestore?(
                <div className="yl-restore-confirm">
                  <p className="yl-set-warn" style={{margin:"0 0 8px"}}>読み込むと、いまのデータはバックアップの内容で上書きされます。よろしいですか？</p>
                  <label className="yl-addbtn sm" style={{display:"inline-block",cursor:"pointer"}}>📂 ファイルを選んで復元<input type="file" accept="application/json,.json" style={{display:"none"}} onChange={importData}/></label>
                  <button className="yl-modal-cancel" style={{marginLeft:8}} onClick={()=>setConfirmRestore(false)}>やめる</button>
                </div>
              ):(
                <button className="yl-reset" onClick={()=>setConfirmRestore(true)}>📂 バックアップから復元する</button>
              )}
            </section>
            {FB_READY&&(
              <section className="yl-set-sec">
                <h3 className="yl-set-title">👨‍👩‍👧 家族で共有</h3>
                <button className="yl-addbtn sm" onClick={()=>setShowShareModal(true)}>共有の設定</button>
              </section>
            )}
            <section className="yl-set-sec">
              <h3 className="yl-set-title">📖 アプリについて</h3>
              <button className="yl-addbtn sm" style={{marginBottom:10}} onClick={()=>setHelpOpen(true)}>つかい方・機能紹介</button>
              <button className="yl-reset" onClick={()=>setConfirmReset(true)}>⟳ データを消して最初から</button>
            </section>
            <p className="yl-foot">試作版・データはこの端末に保存されます</p>
          </div>
        ):(
          <>
            {/* プロフィールは畳む：細いバー＋ⓘで開閉。ケア状態だけは常時表示（見守りの安心） */}
            <div className="yl-profbar">
              {isMemberTab&&(()=>{const over=memberStats?.over||0,soon=memberStats?.soon||0;return over>0?<span className="yl-pill over">🔴 期限切れ {over}</span>:soon>0?<span className="yl-pill soon">⏰ 期限近 {soon}</span>:<span className="yl-pill ok">✅ ケアは順調</span>;})()}
              <button className="yl-profbar-toggle" onClick={()=>setProfileOpen(o=>!o)}>ⓘ {isMemberTab?activeMember.name:(meName||"わたし")}のプロフィール {profileOpen?"▲":"▼"}</button>
            </div>
            {(profileOpen||(isMemberTab&&editingId===activeMember.id))&&(<>
            {!isMemberTab?<section className="yl-melead"><div className="yl-melead-row"><button className="yl-melead-avatar" onClick={()=>{setMeNameDraft(meName);setMePicker(true);}} title="アイコン・名前を変更">{meAvatar&&photos[meAvatar]?<img className="yl-avatar lg" src={photos[meAvatar]} alt=""/>:meEmoji}</button><div className="yl-melead-body"><p className="yl-melead-title">{meName||"わたし"}</p><p className="yl-melead-sub">{personSeg==="manage"?"予定・ケア・ストック・支出などを管理":"体重・体調・日記・思い出などの記録"}</p></div></div><div className="yl-me-bday">{meBdayEdit?<div className="yl-me-bday-edit"><input type="date" className="yl-date" value={meBdayDraft} onChange={e=>setMeBdayDraft(e.target.value)} autoFocus/><button className="yl-addbtn sm" onClick={()=>{persistMeBirthday(meBdayDraft);setMeBdayEdit(false);}}>保存</button><button className="yl-modal-cancel" onClick={()=>setMeBdayEdit(false)}>キャンセル</button></div>:<button className="yl-me-bday-btn" onClick={()=>{setMeBdayDraft(meBirthday);setMeBdayEdit(true);}}>{meBirthday?`🎂 ${fmtBirthday(meBirthday)}`:"🎂 自分の誕生日を登録"}</button>}</div></section>:(
              <section className="yl-petstatus">
                <div className="yl-petstatus-head">
                  {editingId===activeMember.id?(
                    <div className="yl-rename">
                      <div className="yl-editavatar">
                        {editAvatar&&photos[editAvatar]?<img className="yl-avatar lg" src={photos[editAvatar]} alt=""/>:<span className="yl-editavatar-emoji">{activeMember.emoji}</span>}
                        <label className="yl-editavatar-btn">📷 写真にする<input type="file" accept="image/*" style={{display:"none"}} onChange={pickAvatar}/></label>
                        {editAvatar&&<button className="yl-editavatar-clear" onClick={()=>setEditAvatar("")}>絵文字に戻す</button>}
                      </div>
                      <input className="yl-input sm" value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveRename(activeMember.id)} placeholder="名前" autoFocus/>
                      <label className="yl-opt" style={{marginTop:6,width:"100%"}}>🗂 フォルダ（多頭飼いの分類・任意）<input className="yl-input sm" style={{marginTop:4}} value={editGroup} onChange={e=>setEditGroup(e.target.value)} placeholder="例：犬たち / ハムスター / 2階の子"/></label>
                      <div className="yl-opt" style={{marginTop:6,width:"100%"}}>🎨 カレンダーの色<span className="yl-colorrow">{MEMBER_COLORS.map(col=><button key={col} className={"yl-colordot"+((activeMember.color||DEFAULT_SPACE_COLOR)===col?" on":"")} style={{background:col}} onClick={()=>setMemberColor(col)} aria-label="色を選ぶ"/>)}</span></div>
                      <label className="yl-opt" style={{marginTop:6,width:"100%"}}>🎂 誕生日<input type="date" className="yl-date" style={{marginLeft:6}} value={editBirthday} onChange={e=>setEditBirthday(e.target.value)}/></label>
                      {activeMember.kind==="pet"&&<label className="yl-opt" style={{marginTop:6,width:"100%"}}>🎉 うちの子記念日<input type="date" className="yl-date" style={{marginLeft:6}} value={editGotcha} onChange={e=>setEditGotcha(e.target.value)}/></label>}
                      {activeMember.kind==="person"&&<div className="yl-opt" style={{marginTop:6,width:"100%"}}>🧑 種別（記録項目の出し分け）<span className="yl-seg-mini">{[{k:"adult",l:"大人"},{k:"child",l:"子ども"}].map(o=><button key={o.k} className={"yl-seg-mini-btn"+(editPersonType===o.k?" on":"")} onClick={()=>setEditPersonType(o.k)}>{o.l}</button>)}</span></div>}
                      {inHousehold&&<div style={{marginTop:8}}><VisibilityToggle value={editVisibility} onChange={setEditVisibility}/></div>}
                      <button className="yl-addbtn sm" onClick={()=>saveRename(activeMember.id)}>保存</button>
                      <button className="yl-member-del" onClick={()=>setConfirmDel(activeMember)}>🗑 このメンバーを削除</button>
                    </div>
                  ):(
                    <span className="yl-petstatus-title" style={{color:KIND_STYLE[activeMember.kind].fg}}>
                      {avatarNode(activeMember,"sm")} {activeMember.name} の{KIND_STYLE[activeMember.kind].word}
                      <button className="yl-icon" onClick={()=>{setEditingId(activeMember.id);setEditName(activeMember.name);setEditBirthday(activeMember.birthday||"");setEditGotcha(activeMember.gotchaDay||"");setEditGroup(activeMember.group||"");setEditAvatar(activeMember.avatar||"");setEditVisibility(activeMember.visibility||"household");setEditPersonType(activeMember.personType||"child");}}>✏️</button>
                    </span>
                  )}
                </div>
                {/* ケア帯＝緊急度。異常が無い時は「順調 ✅」1個に畳み、数字が立った時だけ目立たせる */}
                <div className="yl-petstatus-chips">
                  {(memberStats?.over||0)>0&&<span className="yl-pill over">🔴 期限切れ {memberStats.over}</span>}
                  {(memberStats?.soon||0)>0&&<span className="yl-pill soon">⏰ 期限近 {memberStats.soon}</span>}
                  {!(memberStats?.over)&&!(memberStats?.soon)&&<span className="yl-pill ok">✅ ケアは順調</span>}
                  {inHousehold&&<span className={"yl-pill vis"+(activeMember.visibility==="private"?" private":"")}>{activeMember.visibility==="private"?"🔒 非公開":"👨‍👩‍👧 共有中"}</span>}
                </div>
                {/* 誕生日・記念日＝お楽しみ。緊急度とは別の帯にして脳の使いどころを分ける */}
                {(activeMember.birthday||activeMember.gotchaDay)&&(
                  <div className="yl-petstatus-fun">
                    {activeMember.birthday&&<span className="yl-funchip">🎂 {fmtBirthday(activeMember.birthday)}</span>}
                    {activeMember.gotchaDay&&<span className="yl-funchip">🎉 {(()=>{const y=yearsSinceAnniv(activeMember.gotchaDay);const dd=daysUntilAnniv(activeMember.gotchaDay);return dd===0?(y?`迎えて${y}年！`:"うちの子記念日！"):`記念日 ${fmtBirthday(activeMember.gotchaDay)}`;})()}</span>}
                  </div>
                )}
              </section>
            )}</>)}

            {personSeg==="manage"&&(()=>{const defs=[];
              defs.push({key:"routine",el:(
                <section className="yl-routine">
                  <div className="yl-routine-head">
                    <h2 className="yl-routine-title">🔁 今日のルーティン</h2>
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
                </section>
              )});
              defs.push({key:"chore",el:(
                <section className="yl-chore">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>🧹 お世話ログ<span className="yl-chore-hint">前回いつ？がひと目で</span></h2>
                  {chores.length>0&&(
                    <ul className="yl-chore-list">
                      {chores.map(c=>{const el=elapsedLabel(c.lastDone);const editing=choreDateEdit&&choreDateEdit.id===c.id;return(
                        <li key={c.id} className="yl-chore-item">
                          <span className="yl-chore-emoji">{c.emoji}</span>
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
                    {choreTemplatesFor(curKind).filter(t=>!chores.some(c=>c.title===t.title)).map(t=><button key={t.title} className="yl-chore-add" onClick={()=>addChore(t.title,t.emoji)}>＋ {t.emoji} {t.title}</button>)}
                  </div>
                  <div className="yl-chore-custom">
                    <input className="yl-input sm" value={choreDraft} onChange={e=>setChoreDraft(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustomChore()} placeholder="自分で追加（例：水そうじ）"/>
                    <button className="yl-addbtn sm" onClick={addCustomChore}>＋ 追加</button>
                  </div>
                </section>
              )});
              defs.push({key:"list",el:(
                <section className="yl-listsec">
                  {hasListItems&&<div className="yl-sort">{filterChips.map(f=><button key={f.key} className={"yl-sortbtn"+(filter===f.key?" on":"")} onClick={()=>setFilter(f.key)}>{f.emoji?f.emoji+" ":""}{f.label}</button>)}</div>}
                  {!loaded?<p className="yl-loading">よみこみ中…</p>:visible.length===0?<p className="yl-empty">まだありません。右下の ＋ から追加できます。</p>:(()=>{
                    const actList=visible.filter(x=>!x.done);const doneList=visible.filter(x=>x.done);
                    return(
                      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onCardDragEnd}>
                        <SortableContext items={actList.map(x=>x.id)} strategy={verticalListSortingStrategy}>
                          <ul className="yl-list">
                            {actList.map(it=><SortableCard key={it.id} id={it.id} className="yl-card">{cardInner(it)}</SortableCard>)}
                            {doneList.map(it=><li key={it.id} className="yl-card is-done">{cardInner(it)}</li>)}
                          </ul>
                        </SortableContext>
                      </DndContext>
                    );
                  })()}
                  {visible.filter(x=>!x.done).length>1&&<p className="yl-foot" style={{marginTop:2}}>長押しでドラッグして並び替えできます</p>}
                </section>
              )});
              if(curKind==="person"&&tomorrowBelongings.length>0)defs.push({key:"prep",el:(
                <section className="yl-belong">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>📋 明日（{WEEKDAYS_JA[tomorrowDow]}）の準備</h2>
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
                    <h2 className="yl-routine-title">📦 ストック</h2>
                    {supplies.length>0&&<span className="yl-supply-hint">買った時だけタップ</span>}
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
                </section>
              )});
              defs.push({key:"expense",el:(
                <section className="yl-exp">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>💰 支出</h2>
                  {expenseMonth.total===0&&expenseRecords.length===0&&<p className="yl-routine-empty">右下の ＋ から、病院代・ごはん代などを記録できます。</p>}
                  {expenseMonth.total>0&&(
                    <div className="yl-exp-viz">
                      <div className="yl-exp-total"><span>今月（{Number(expenseMonth.ym.slice(5))}月）の合計</span><strong>{fmtYen(expenseMonth.total)}</strong></div>
                      <ul className="yl-exp-bars">
                        {expenseMonth.cats.map(c=>(
                          <li key={c.key} className="yl-exp-bar">
                            <span className="yl-exp-barlabel">{c.emoji} {c.label}</span>
                            <span className="yl-exp-bartrack"><span className="yl-exp-barfill" style={{width:Math.max(4,Math.round(c.amount/expenseMonth.total*100))+"%",background:c.color}}/></span>
                            <span className="yl-exp-baramt">{fmtYen(c.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {expenseRecords.length>0&&(
                    <ul className="yl-exp-list">
                      {expenseRecords.slice(0,8).map(r=>(
                        <li key={r.id} className="yl-exp-item tap" onClick={()=>openExpEdit(r)}>
                          <span className="yl-exp-idate">{fmtDate(r.date)}</span>
                          <span className="yl-exp-icat" style={{color:expCatMeta(r.category).color}}>{expCatMeta(r.category).emoji} {expCatMeta(r.category).label}</span>
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
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>📄 証明書</h2>
                  {certsByYear.map(g=>(
                    <div key={g.year} className="yl-cert-year">
                      <span className="yl-cert-yearlabel">{g.year==="----"?"日付なし":`${g.year}年`}</span>
                      <div className="yl-certs-row">
                        {g.items.map(c=>{
                          const label=(careKindsFor(activeMember).find(k=>k.key===c.careKind)||{}).label||c.title;
                          return(
                            <button key={c.id} className="yl-cert-cell" onClick={()=>viewPhoto(firstPhotoId(c))}>
                              {firstPhotoId(c)&&photos[firstPhotoId(c)]?<img className="yl-cert-img" src={photos[firstPhotoId(c)]} alt=""/>:<span className="yl-cert-ph">📄</span>}
                              <span className="yl-cert-cap">{c.emoji} {label}</span>
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
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>📈 からだの記録</h2>
                  {isMemberTab&&weightDiff!=null&&(<p className={"yl-diet-msg"+(Math.abs(weightDiff)<0.05?" ok":weightDiff>0?" over":" under")}>{Math.abs(weightDiff)<0.05?"🎉 目標達成中！この調子で":weightDiff>0?<>目標を <span className="yl-nowrap">{Math.abs(weightDiff).toFixed(1)}{weightUnit}</span> 超えています<span className="yl-nowrap">（食べすぎ・運動量に気をつけて）</span></>:<>目標まで あと <span className="yl-nowrap">{Math.abs(weightDiff).toFixed(1)}{weightUnit}</span></>}</p>)}
                  {weightPts.length>=2?<MiniChart points={weightPts} unit={weightPts[weightPts.length-1].unit} color="#E39A5C" label="体重"/>:<p className="yl-routine-empty">{weightPts.length===1?"あと1回記録すると、体重の推移グラフが出ます。":"右下の ＋ から体重などを記録できます。"}</p>}
                  {isMemberTab&&heightPts.length>=2&&<MiniChart points={heightPts} unit="cm" color="#D98A4E" label="身長"/>}
                  {healthRecords.length>0&&(
                    <ul className="yl-health-list">
                      {[...healthRecords].reverse().slice(0,6).map(r=>(
                        <li key={r.id} className="yl-health-item">
                          <span className="yl-health-date">{fmtDate(r.date)}</span>
                          <span className="yl-health-vals">{r.weight!=null&&<span>{r.weight}{r.wunit||"kg"}</span>}{r.height!=null&&<span>{r.height}cm</span>}{r.condition&&condMeta(r.condition)&&<span>{condMeta(r.condition).emoji}{condMeta(r.condition).label}</span>}</span>
                          <button className="yl-health-del" onClick={()=>askDelete(`${fmtDate(r.date)}の記録`,()=>removeHealth(r.id))} aria-label="削除">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )});
              defs.push({key:"diary",el:(
                <section className="yl-diary">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>📝 今日のようす</h2>
                  {todayHasCond(tab)?(
                    <button className="yl-quick-done tap" onClick={()=>setInputSheet("diary")}>✓ 今日の体調は記録ずみ 👌<span className="yl-quick-edit">追記・編集</span></button>
                  ):(
                    <button className="yl-quick-big" onClick={()=>setInputSheet("diary")}>📝 体調を記録</button>
                  )}
                  {energyPts.length>1&&<MiniChart points={energyPts} unit="" color="#557E63" label="元気の推移（5段階）"/>}
                  {diaryRecords.length===0&&<p className="yl-routine-empty">上の「体調を記録」から、元気・食欲・症状・写真などを残せます。</p>}
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
                                <span className="yl-daycard-rep">{rep?rep.emoji:"📝"} {sumLabel}</span>
                                {!open&&daySyms.length>0&&<span className="yl-daycard-symbadges">{daySyms.slice(0,3).map(sk=>symptomMeta(sk)&&<span key={sk} className={"yl-symbadge"+(sk==="period"?" period":"")}>{symptomMeta(sk).emoji}</span>)}</span>}
                              </button>
                              <button className="yl-daycard-del" onClick={()=>askDelete(`${fmtDate(date)}の記録すべて`,()=>removeDiaryDay(date))} aria-label="この日をすべて削除">×</button>
                            </div>
                            {open&&(
                              <ul className="yl-dayrecs">
                                {recs.map(r=>{const tod=recs.length>1&&r.createdAt?(()=>{const h=new Date(r.createdAt).getHours();return h<11?"朝":h<17?"昼":"夜";})():"";return(
                                  <li key={r.id} className="yl-dayrec">
                                    <span className="yl-dayrec-vals">
                                      {tod&&<span className="yl-dayrec-tod">{tod}</span>}
                                      {r.energy&&diaryMeta(DIARY_ENERGY,r.energy)&&<span className="yl-dayrec-chip">{diaryMeta(DIARY_ENERGY,r.energy).emoji} {diaryMeta(DIARY_ENERGY,r.energy).label}</span>}
                                      {r.appetite&&diaryMeta(DIARY_APPETITE,r.appetite)&&<span className="yl-dayrec-chip">{diaryMeta(DIARY_APPETITE,r.appetite).emoji} {diaryMeta(DIARY_APPETITE,r.appetite).label}</span>}
                                      {r.poop&&diaryMeta(DIARY_POOP,r.poop)&&<span className="yl-dayrec-chip">💩 {diaryMeta(DIARY_POOP,r.poop).label}</span>}
                                      {r.walk&&<span className="yl-dayrec-chip">🦮 さんぽ</span>}
                                      {r.hospital&&<span className="yl-dayrec-chip">🏥 病院</span>}
                                      {(r.symptoms||[]).map(sk=>symptomMeta(sk)&&<span key={sk} className={"yl-dayrec-chip sym"+(sk==="period"?" period":"")}>{symptomMeta(sk).emoji} {symptomMeta(sk).label}</span>)}
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
              defs.push({key:"album",el:(
                <section className="yl-album">
                  <div className="yl-routine-head">
                    <h2 className="yl-routine-title">📸 思い出</h2>
                    <button className="yl-album-add" onClick={()=>openLifeNew(todayIso,tab)}>＋ 追加</button>
                  </div>
                  {memories.length===0?(
                    <p className="yl-routine-empty">写真とひとことで、大切な思い出を残せます。</p>
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
              if(curKind==="person")defs.push({key:"belong",el:(
                <section className="yl-belong">
                  <h2 className="yl-routine-title" style={{marginBottom:10}}>🎒 持ち物（曜日ごと）</h2>
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
                  {belongings.length===0&&<p className="yl-routine-empty">右下の ＋ から曜日ごとの持ち物を登録すると、前日に「明日の準備」チェックリストが出ます。</p>}
                </section>
              )});
              defs.push({key:"cards",el:(
                <section className="yl-tray">
                  <button className="yl-tray-head" onClick={()=>setTrayOpen(o=>!o)}>
                    <span className="yl-tray-title">📌 大切な情報{cards.length>0?`（${cards.length}）`:""}</span>
                    <span className="yl-tray-arrow">{trayOpen?"▲":"▼"}</span>
                  </button>
                  {trayOpen&&(
                    <div className="yl-tray-body">
                      <p className="yl-tray-hint">緊急連絡先・アレルギー・かかりつけ病院など、いざという時の情報をカードで保存。写真も貼れます。</p>
                      {cards.map(c=>(
                        <button key={c.id} className="yl-infocard" onClick={()=>openCardEdit(c)}>
                          <span className="yl-infocard-emoji">{cardMeta(c.kind).emoji}</span>
                          <span className="yl-infocard-body"><span className="yl-infocard-title">{c.title}</span>{c.body&&<span className="yl-infocard-text">{c.body}</span>}</span>
                          {firstPhotoId(c)&&photos[firstPhotoId(c)]&&<img className="yl-infocard-thumb" src={photos[firstPhotoId(c)]} alt=""/>}
                        </button>
                      ))}
                      <div className="yl-tray-add">{CARD_PRESETS.map(p=><button key={p.key} className="yl-tray-addbtn" onClick={()=>openCardNew(p.key)}>{p.emoji} {p.label}</button>)}</div>
                    </div>
                  )}
                </section>
              )});
              return renderSecs("manage",defs);
            })()}
          </>
        )}
        <div className="yl-help-foot"><button className="yl-help-btn" onClick={()=>setHelpOpen(true)}>📖 つかい方・機能紹介</button></div>
        <p className="yl-foot">試作版・データはこの端末に保存されます</p>
      </div>

      {isPersonMode&&!hubOpen&&!inputSheet&&(
        <button className="yl-fab" onClick={()=>setHubOpen(true)} aria-label="記録を追加">＋</button>
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
              {tab==="cal"&&<button className={"yl-mrow"+(calFilter==="all"?" on":"")} onClick={()=>select("all")}><span className="yl-mrow-ico">👥</span><span className="yl-mrow-name">すべて（全員の予定を重ねる）</span>{calFilter==="all"&&<span className="yl-mrow-check">✓</span>}</button>}
              {memRow(meSpace)}
              {groupedMembers.map(g=>(
                <Fragment key={g.group||"__ungrouped"}>
                  {g.group&&<div className="yl-mgroup-h">🗂 {g.group}</div>}
                  {g.members.map(m=>memRow(m))}
                </Fragment>
              ))}
              <button className="yl-mrow add" onClick={()=>{setAdding(true);setMemListOpen(false);}}>＋ メンバーを追加</button>
            </div>
          )}
          <button className="yl-membar" onClick={()=>setMemListOpen(o=>!o)} aria-expanded={memListOpen} aria-label="メンバーを切り替え">
            {curId==="all"
              ?<><span className="yl-mrow-ico">👥</span><span className="yl-mbar-name">すべて</span></>
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
          {key:"home",icon:"🏠",label:"ホーム",on:tab==="home",act:()=>setTab("home")},
          {key:"cal",icon:"📅",label:"カレンダー",on:tab==="cal",act:()=>setTab("cal")},
          {key:"record",icon:"📝",label:"記録",on:isPersonMode&&personSeg==="record",act:()=>goSeg("record")},
          {key:"manage",icon:"🗂",label:"管理",on:isPersonMode&&personSeg==="manage",act:()=>goSeg("manage")},
          {key:"settings",icon:"⚙️",label:"設定",on:tab==="settings",act:()=>setTab("settings")},
        ];
        return(
          <nav className="yl-bottomnav">
            {items.map(it=>(
              <button key={it.key} className={"yl-bnav-item"+(it.on?" on":"")} onClick={it.act}>
                <span className="yl-bnav-ico">{it.icon}</span>
                <span className="yl-bnav-label">{it.label}</span>
              </button>
            ))}
          </nav>
        );
      })()}
      </div>

      {helpOpen&&(
        <div className="yl-help-ov" onClick={()=>setHelpOpen(false)}>
          <div className="yl-help-page" onClick={e=>e.stopPropagation()}>
            <div className="yl-help-head">
              <h2 className="yl-help-title">📖 LoaLife のつかい方</h2>
              <button className="yl-help-close" onClick={()=>setHelpOpen(false)} aria-label="閉じる">×</button>
            </div>
            <p className="yl-help-lead">家族みんな・ペット・自分の毎日を、ひとつのアプリでまとめて見守れます。主な機能を紹介します。</p>
            {[
              {emoji:"🏠",title:"ホーム",desc:"家族みんなの「今日やること」や、気にかけたいこと（期限切れ・もうすぐ）をひと目で確認できます。"},
              {emoji:"👨‍👩‍👧",title:"メンバー",desc:"自分・お子さま・ペットを追加して、それぞれの予定やケアをまとめられます。アイコンは絵文字でも写真でもOK。多頭飼いはフォルダで分類できます。"},
              {emoji:"📅",title:"カレンダー",desc:"家族みんなの予定やTodoを1か所に。メンバーごとに色を選べて、誰の予定かひと目でわかります。日付をタップしてふりかえりも。"},
              {emoji:"📝",title:"今日のようす（お薬手帳にも）",desc:"元気（5段階グラフ）・食欲・うんち・症状（熱/咳など）・写真・ひとことを残せます。お薬手帳や通院前のメモに。"},
              {emoji:"💉",title:"ケア・予定・投薬",desc:"ワクチン・フィラリア・トリミング・通院・投薬などを登録。周期のあるケアは、記録すると次回へ自動でスライドします。"},
              {emoji:"🧹",title:"お世話ログ",desc:"トイレ掃除やシャンプーなどを「やった」で記録。前回からの経過（○週間前など）がひと目で分かり、やり忘れを防げます。"},
              {emoji:"📈",title:"からだの記録・ダイエット手帳",desc:"体重・身長・体調をグラフでチェック。小動物は0.1g単位。目標体重を決めると差分の目安も表示します。"},
              {emoji:"📸",title:"思い出",desc:"カレンダーに残した写真や日記がアルバムとして並びます。記念日や「できた！」の瞬間を、あとからいつでも振り返れます。"},
              {emoji:"🏷",title:"思い出のタグ・はじめて",desc:"思い出に #発表会 などのタグや「はじめて」を付けて、成長をあとから振り返れます。"},
              {emoji:"💰",title:"支出",desc:"病院代や餌代などをカテゴリ別に記録。今月いくら使ったかをグラフで見える化します。"},
              {emoji:"🛍",title:"ストック管理",desc:"フード・トイレ用品・サプリなどの在庫を登録。なくなりそうな頃にお知らせします。"},
              {emoji:"🎒",title:"持ち物（曜日ごと）",desc:"曜日ごとの持ち物を登録すると、前日に「明日の準備」チェックリストが出て忘れ物を防ぎます。"},
              {emoji:"📌",title:"大切な情報カード",desc:"緊急連絡先・アレルギー/禁忌・かかりつけ病院などを、写真付きカードで保存（隠しトレイでスッキリ）。"},
              {emoji:"🔔",title:"通知・リマインド",desc:"予定ごとに通知を設定できます（何件でもOK）。"},
              {emoji:"↕️",title:"並び替え（長押し/ドラッグ）",desc:"項目は長押しでドラッグして並び替え。大項目（もうすぐ・楽しみ／タイムライン／からだの記録など）も右上の⠿ハンドルをドラッグして好きな順に並べ替えられます。"},
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
      {editItemId&&<div className="yl-overlay" onClick={()=>setEditItemId(null)}><div className="yl-modal edit" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">編集</h3><input className="yl-input" value={eTitle} onChange={e=>setETitle(e.target.value)} placeholder="タイトル"/><div className="yl-optrow"><label className="yl-opt">期限<input type="date" className="yl-date" value={eDate} onChange={e=>setEDate(e.target.value)}/></label><label className="yl-opt">時間<TimeInput value={eTime} onChange={setETime}/></label><label className="yl-opt">繰り返し<select className="yl-select" value={eRepeat} onChange={e=>setERepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div><div className="yl-notify"><span className="yl-notify-label">🔔 通知</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(eReminders.includes(o.key)?" on":"")} onClick={()=>toggleEReminder(o.key)}>{o.label}</button>)}</div>{eReminders.length>=4&&<p className="yl-notify-hint">🔔が多いと通知に慣れて見落としがち。本当に必要なぶんだけがおすすめです。</p>}</div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEditItemId(null)}>閉じる</button><button className="yl-addbtn modal" onClick={saveEdit}>保存</button></div></div></div>}
      {viewer&&<div className="yl-overlay" onClick={()=>setViewer(null)}><div className="yl-modal photo" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">{viewer.isMemory?"思い出":"証明書"}</h3>{viewer.loading?<p className="yl-loading">読み込み中…</p>:viewer.src?<img className="yl-photo-img" src={viewer.src} alt={viewer.isMemory?"思い出":"証明書"}/>:<p className="yl-empty">画像が見つかりませんでした</p>}{viewer.confirming?<><p className="yl-modal-body" style={{margin:"0 0 12px"}}>この写真を削除しますか？元に戻せません。</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setViewer(v=>({...v,confirming:false}))}>やめる</button><button className="yl-modal-del" onClick={()=>viewer.isMemory?removeMemory(viewer.id):removePhoto(viewer.id)}>削除する</button></div></>:<div className="yl-modal-btns">{viewer.src&&<button className="yl-modal-cancel" onClick={()=>setViewer(v=>({...v,confirming:true}))}>削除</button>}<button className="yl-addbtn modal" onClick={()=>setViewer(null)}>閉じる</button></div>}</div></div>}
      {pickerId&&<div className="yl-overlay" onClick={()=>setPickerId(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">絵文字を選ぶ</h3><div className="yl-emoji-grid">{PICKER_EMOJIS.map(e=><button key={e} className="yl-emoji-pick" onClick={()=>setEmoji(pickerId,e)}>{e}</button>)}</div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEmoji(pickerId,"")}>絵文字なし</button><button className="yl-modal-cancel" onClick={()=>setPickerId(null)}>閉じる</button></div></div></div>}
      {mePicker&&<div className="yl-overlay" onClick={()=>{persistMeName(meNameDraft.trim());setMePicker(false);}}><div className="yl-modal edit" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">あなたのアイコン・名前</h3>
        <div className="yl-editavatar">
          {meAvatar&&photos[meAvatar]?<img className="yl-avatar lg" src={photos[meAvatar]} alt=""/>:<span className="yl-editavatar-emoji">{meEmoji}</span>}
          <label className="yl-editavatar-btn">📷 写真にする<input type="file" accept="image/*" style={{display:"none"}} onChange={pickMeAvatar}/></label>
          {meAvatar&&<button className="yl-editavatar-clear" onClick={clearMeAvatar}>絵文字に戻す</button>}
        </div>
        <label className="yl-opt" style={{width:"100%",marginBottom:12}}>名前（任意）<input className="yl-input sm" style={{marginTop:4}} value={meNameDraft} onChange={e=>setMeNameDraft(e.target.value)} placeholder="わたし"/></label>
        {!meAvatar&&<><p className="yl-modal-body" style={{margin:"0 0 8px"}}>絵文字を選ぶ</p><div className="yl-emoji-grid">{ME_EMOJIS.map(e=><button key={e} className={"yl-emoji-pick"+(meEmoji===e?" on":"")} onClick={()=>{persistMeEmoji(e);}}>{e}</button>)}</div></>}
        <p className="yl-modal-body" style={{margin:"4px 0 8px"}}>🎨 カレンダーの色</p><div className="yl-colorrow" style={{justifyContent:"center",marginBottom:14}}>{MEMBER_COLORS.map(col=><button key={col} className={"yl-colordot"+((meColor||"#E39A5C")===col?" on":"")} style={{background:col}} onClick={()=>persistMeColor(col)} aria-label="色を選ぶ"/>)}</div>
        <div className="yl-modal-btns"><button className="yl-addbtn modal" onClick={()=>{persistMeName(meNameDraft.trim());setMePicker(false);}}>保存して閉じる</button></div></div></div>}
      {confirmDel&&<div className="yl-overlay" onClick={()=>setConfirmDel(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji">{confirmDel.emoji}</div><h3 className="yl-modal-title">{confirmDel.name} を削除しますか？</h3><p className="yl-modal-body">{(()=>{const n=items.filter(x=>x.space===confirmDel.id).length;return n>0?`${confirmDel.name}のケア（${n}件）も一緒に消えます。この操作は元に戻せません。`:"この操作は元に戻せません。";})()}</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmDel(null)}>キャンセル</button><button className="yl-modal-del" onClick={()=>removeMember(confirmDel.id)}>削除する</button></div></div></div>}
      {lifeDraft&&(
        <div className="yl-overlay" onClick={()=>setLifeDraft(null)}>
          <div className="yl-modal edit life" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">{lifeDraft.mode==="edit"?"記録を編集":"この日を記録"}</h3>
            {/* カテゴリ */}
            <div className="yl-typerow" style={{marginBottom:10}}>{CAL_CATS.map(c=><button key={c.key} className={"yl-chip"+(lifeDraft.category===c.key?" on":"")} style={lifeDraft.category===c.key?{background:"#E39A5C",color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setLifeDraft(p=>({...p,category:c.key}))}>{c.emoji} {c.label}</button>)}</div>
            {/* 誰の */}
            <div className="yl-typerow" style={{marginBottom:10}}>{spaces.map(s=><button key={s.id} className={"yl-chip"+(lifeDraft.space===s.id?" on":"")} style={lifeDraft.space===s.id?{background:"#D98A4E",color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setLifeDraft(p=>({...p,space:s.id}))}>{s.emoji} {s.name}</button>)}</div>
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
                  <span className="yl-tagedit-label">🏷 タグ（あとで振り返りやすく）</span>
                  <div className="yl-tagedit-chips">
                    {tags.map(t=><span key={t} className="yl-tagedit-chip">#{t}<button onClick={()=>setLifeDraft(p=>({...p,tags:p.tags.filter(x=>x!==t)}))} aria-label="削除">×</button></span>)}
                    {!tags.includes(FIRST_TAG)&&<button className="yl-tagedit-quick" onClick={()=>addTag(FIRST_TAG)}>✨ はじめて</button>}
                  </div>
                  <div className="yl-tagedit-add"><input className="yl-input sm" value={tagInput} onChange={e=>setTagInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addTag(tagInput);}}} placeholder="例：発表会 / お弁当 / 自転車"/><button className="yl-addbtn sm" onClick={()=>addTag(tagInput)}>追加</button></div>
                </div>
              );
            })()}
            <div className="yl-optrow"><label className="yl-opt">日付<input type="date" className="yl-date" value={lifeDraft.date} onChange={e=>setLifeDraft(p=>({...p,date:e.target.value}))}/></label><label className="yl-opt">時間<TimeInput value={lifeDraft.time} onChange={t=>setLifeDraft(p=>({...p,time:t}))}/></label>{lifeDraft.category==="event"&&<label className="yl-opt">繰り返し<select className="yl-select" value={lifeDraft.repeat} onChange={e=>setLifeDraft(p=>({...p,repeat:e.target.value}))}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label>}</div>
            <div className="yl-notify"><span className="yl-notify-label">🔔 通知（任意）{notifPerm==="default"&&<button className="yl-notif-small" onClick={handleNotifRequest}>許可する</button>}</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(lifeDraft.reminders.includes(o.key)?" on":"")} onClick={()=>toggleLifeReminder(o.key)}>{o.label}</button>)}</div>{lifeDraft.reminders.length>=4&&<p className="yl-notify-hint">🔔が多いと通知に慣れて見落としがち。本当に必要なぶんだけがおすすめです。</p>}</div>
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
            <h3 className="yl-modal-title">{cardMeta(cardEdit.kind).emoji} {cardEdit.id?"カードを編集":"カードを追加"}</h3>
            <div className="yl-typerow" style={{marginBottom:10}}>{CARD_PRESETS.map(p=><button key={p.key} className={"yl-chip"+(cardEdit.kind===p.key?" on":"")} style={cardEdit.kind===p.key?{background:"#D98A4E",color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setCardEdit(c=>({...c,kind:p.key,title:c.title||cardMeta(p.key).label}))}>{p.emoji} {p.label}</button>)}</div>
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
            <h3 className="yl-modal-title">💰 支出を編集</h3>
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
            {!isMemberTab?<div className="yl-typerow">{ME_TYPES.map(t=><button key={t} className={"yl-chip"+(draftType===t?" on":"")} style={draftType===t?{background:TYPE_META[t].fg,color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setDraftType(t)}>{TYPE_META[t].emoji} {TYPE_META[t].label}</button>)}</div>:<div className="yl-typerow">{careKindsFor(activeMember).map(k=><button key={k.key} className={"yl-chip"+(draftKind===k.key?" on":"")} style={draftKind===k.key?{background:KIND_STYLE[activeMember.kind].fg,color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>pickCareKind(k)}>{k.emoji} {k.label}</button>)}</div>}
            {suggestions.length>0&&<div className="yl-suggest"><span className="yl-suggest-label">よく使う</span><div className="yl-suggest-chips">{suggestions.map(s=><button key={s} className="yl-suggest-chip" onClick={()=>{setDraft(s);setDraftAuto(false);}}>{s}</button>)}</div></div>}
            <div className="yl-add"><input className="yl-input" value={draft} onChange={e=>{setDraft(e.target.value);setDraftAuto(false);}} onKeyDown={e=>e.key==="Enter"&&addItem()} placeholder={isMemberTab?(draftKind==="other"?"内容を入力…":`${(careKindsFor(activeMember).find(k=>k.key===draftKind)||{}).label||"内容"}を追加…`):`${TYPE_META[draftType].label}を追加…`}/><button className="yl-addbtn" onClick={addItem}>追加</button></div>
            <div className="yl-optrow"><label className="yl-opt">{isMemberTab?"期限":(isScheduleType(draftType)?"日付":"期限（任意）")}<input type="date" className="yl-date" value={draftDate} onChange={e=>setDraftDate(e.target.value)}/></label><label className="yl-opt">時間<TimeInput value={draftTime} onChange={setDraftTime}/></label><label className="yl-opt">繰り返し<select className="yl-select" value={draftRepeat} onChange={e=>setDraftRepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div>
            {!isMemberTab&&isScheduleType(draftType)&&<p className="yl-foot" style={{marginTop:2}}>その日に起きる予定です。日付を入れるとカレンダーに表示されます。</p>}
            <div className="yl-notify"><span className="yl-notify-label">🔔 通知（何件でも設定できます）{notifPerm==="default"&&<button className="yl-notif-small" onClick={handleNotifRequest}>許可する</button>}</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(draftReminders.includes(o.key)?" on":"")} onClick={()=>toggleReminder(o.key)}>{o.label}</button>)}</div>{draftReminders.length>=4&&<p className="yl-notify-hint">🔔が多いと通知に慣れて見落としがち。本当に必要なぶんだけがおすすめです。</p>}</div>
            {isMemberTab&&<div className="yl-quickbar" style={{marginTop:12}}><p className="yl-quickbar-label">1タップ追加（前回コピー）</p><div className="yl-quickbar-grid">{careKindsFor(activeMember).map(k=>{const prev=lastDates[k.key];return(<button key={k.key} className="yl-quickbar-item" onClick={()=>{openQuickAdd(k.key,k.emoji,k.label,activeMember.id,prev?.dueDate,prev?.repeat);setInputSheet(null);}}><span className="yl-quickbar-ico">{k.emoji}</span><span className="yl-quickbar-info"><span className="yl-quickbar-name">{k.label}</span><span className="yl-quickbar-prev">{prev?`前回 ${fmtDate(prev.dueDate)}`:"─"}</span></span><span className="yl-quickbar-plus">＋</span></button>);})}</div></div>}
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
      )}
      {inputSheet==="health"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">📈 からだの記録</h3>
            <div className="yl-health-input">
              <label className="yl-opt">体重<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={healthW} onChange={e=>setHealthW(e.target.value)} placeholder={weightUnit==="g"?"25.3":"0.0"}/>{isMemberTab?<span className="yl-health-uswitch"><button className={"yl-health-ubtn"+(weightUnit==="kg"?" on":"")} onClick={()=>setMemberWeightUnit("kg")}>kg</button><button className={"yl-health-ubtn"+(weightUnit==="g"?" on":"")} onClick={()=>setMemberWeightUnit("g")}>g</button></span>:<span className="yl-health-unit">kg</span>}</span></label>
              {isMemberTab&&<label className="yl-opt">身長<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={healthH} onChange={e=>setHealthH(e.target.value)} placeholder="0.0"/><span className="yl-health-unit">cm</span></span></label>}
            </div>
            {isMemberTab&&weightUnit==="g"&&<p className="yl-health-hint">小動物向け：0.1g単位で記録できます</p>}
            {isMemberTab&&(<div className="yl-health-conds"><span className="yl-health-clabel">体調</span>{HEALTH_CONDS.map(c=><button key={c.key} className={"yl-health-cond"+(healthCond===c.key?" on":"")} onClick={()=>setHealthCond(healthCond===c.key?"":c.key)}>{c.emoji} {c.label}</button>)}</div>)}
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:6}} onClick={saveHealth}>📈 からだを記録</button>
            {isMemberTab&&<label className="yl-opt" style={{flexDirection:"row",alignItems:"center",gap:8,marginTop:14}}>🎯 目標体重<span className="yl-health-field"><input type="number" inputMode="decimal" step="0.1" className="yl-health-num" value={targetWeight} onChange={e=>setMemberTarget(e.target.value)} placeholder={weightUnit==="g"?"25.3":"0.0"}/><span className="yl-health-unit">{weightUnit}</span></span></label>}
            {isMemberTab&&<p className="yl-health-hint" style={{marginTop:4}}>設定すると、目標との差（ダイエット手帳）を表示します。</p>}
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
      )}
      {inputSheet==="diary"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">📝 今日のようす</h3>
            {!todayHasCond(tab)&&<button className="yl-quick-big" style={{marginBottom:12}} onClick={()=>{quickHealthy(tab);setInputSheet(null);}}>👌 今日も元気（ワンタップで完了）</button>}
            <p className="yl-diary-hint">くわしく残したいときだけ、下から選べます（すべて任意）。</p>
            {(()=>{const dcfg=diaryConfigFor(diaryTypeOf(tab));const has=k=>dcfg.rows.includes(k);return(<>
            {has("energy")&&<div className="yl-diary-row"><span className="yl-diary-label">元気</span><span className="yl-diary-chips">{DIARY_ENERGY.map(c=><button key={c.key} className={"yl-diary-chip"+(diaryDraft.energy===c.key?" on":"")} onClick={()=>setDiary({energy:diaryDraft.energy===c.key?"":c.key})}>{c.emoji} {c.label}</button>)}</span></div>}
            {has("appetite")&&<div className="yl-diary-row"><span className="yl-diary-label">食欲</span><span className="yl-diary-chips">{DIARY_APPETITE.map(c=><button key={c.key} className={"yl-diary-chip"+(diaryDraft.appetite===c.key?" on":"")} onClick={()=>setDiary({appetite:diaryDraft.appetite===c.key?"":c.key})}>{c.emoji} {c.label}</button>)}</span></div>}
            {has("poop")&&<div className="yl-diary-row"><span className="yl-diary-label">うんち</span><span className="yl-diary-chips">{DIARY_POOP.map(c=><button key={c.key} className={"yl-diary-chip"+(diaryDraft.poop===c.key?" on":"")} onClick={()=>setDiary({poop:diaryDraft.poop===c.key?"":c.key})}>{c.emoji} {c.label}</button>)}</span></div>}
            {(has("walk")||has("hospital"))&&<div className="yl-diary-row"><span className="yl-diary-label">その他</span><span className="yl-diary-chips">{has("walk")&&<button className={"yl-diary-chip"+(diaryDraft.walk?" on":"")} onClick={()=>setDiary({walk:!diaryDraft.walk})}>🦮 さんぽ・おでかけ</button>}{has("hospital")&&<button className={"yl-diary-chip"+(diaryDraft.hospital?" on":"")} onClick={()=>setDiary({hospital:!diaryDraft.hospital})}>🏥 病院に行った</button>}</span></div>}
            {dcfg.symptoms.length>0&&<div className="yl-diary-row"><span className="yl-diary-label">症状</span><span className="yl-diary-chips">{dcfg.symptoms.map(sk=>{const s=SYMPTOMS[sk];return s&&<button key={sk} className={"yl-diary-chip"+((diaryDraft.symptoms||[]).includes(sk)?" on sym":"")} onClick={()=>toggleSymptom(sk)}>{s.emoji} {s.label}</button>;})}</span></div>}
            {dcfg.symptoms.includes("period")&&(()=>{const fc=periodForecast(tab);return(<div className="yl-period-inline">
              <p className="yl-period-priv">🔒 「🩸 生理」の記録は本人のみ（将来の共有でも対象外）</p>
              {fc&&fc.next&&<p className="yl-period-note">🩸 前回 {fmtDate(fc.last)}・次はそろそろ {fmtDate(fc.next)}ごろ（約{fc.avg}日周期）</p>}
            </div>);})()}
            </>);})()}
            <input className="yl-input sm" style={{width:"100%",boxSizing:"border-box",marginTop:4}} value={diaryDraft.note} onChange={e=>setDiary({note:e.target.value})} placeholder="日々の様子・病院でのこと・ひとこと…"/>
            <div className="yl-diary-photorow">{diaryDraft.photo?<span className="yl-diary-thumb"><img src={diaryDraft.photo} alt=""/><button className="yl-diary-thumbdel" onClick={()=>setDiary({photo:null})} aria-label="写真を削除">×</button></span>:<label className="yl-diary-addphoto">📷 写真を追加（お薬・症状など）<input type="file" accept="image/*" style={{display:"none"}} onChange={pickDiaryPhoto}/></label>}</div>
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:8}} onClick={saveDiary}>📝 今日のようすを記録</button>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
      )}
      {inputSheet==="expense"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">💰 支出を記録</h3>
            <div className="yl-exp-input"><span className="yl-exp-amt"><span className="yl-exp-yen">¥</span><input type="number" inputMode="numeric" className="yl-health-num" value={expAmount} onChange={e=>setExpAmount(e.target.value)} placeholder="金額"/></span><select className="yl-select" value={expenseCatsFor(curKind).some(c=>c.key===expCat)?expCat:expenseCatsFor(curKind)[0].key} onChange={e=>setExpCat(e.target.value)}>{expenseCatsFor(curKind).map(c=><option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}</select></div>
            <input className="yl-input sm" style={{width:"100%",boxSizing:"border-box",marginTop:6}} value={expNote} onChange={e=>setExpNote(e.target.value)} placeholder="メモ（任意）"/>
            <p className="yl-foot" style={{margin:"8px 0 0",textAlign:"left"}}>今日の日付で記録します。日付の修正は明細をタップ。</p>
            <button className="yl-addbtn" style={{width:"100%",padding:"13px",marginTop:8}} onClick={saveExpense}>💰 支出を記録</button>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button></div>
          </div>
        </div>
      )}
      {inputSheet==="belong"&&(
        <div className="yl-overlay" onClick={()=>setInputSheet(null)}>
          <div className="yl-modal edit" onClick={e=>e.stopPropagation()}>
            <h3 className="yl-modal-title">🎒 持ち物を追加</h3>
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
            <h3 className="yl-modal-title">🎂 誕生日・記念日を追加</h3>
            <input className="yl-input" value={friendBdayName} onChange={e=>setFriendBdayName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addFriendBday()} placeholder="名前・予定（例：ゆいの誕生日）"/>
            <label className="yl-opt" style={{marginTop:10}}>日付<input type="date" className="yl-date" value={friendBdayDate} onChange={e=>setFriendBdayDate(e.target.value)}/></label>
            <div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setInputSheet(null)}>とじる</button><button className="yl-addbtn modal" onClick={addFriendBday}>🎂 追加</button></div>
          </div>
        </div>
      )}
      {/* ＋入力ハブ：何を記録するか選ぶ。よく使う→たまに→まだ使っていない、の順 */}
      {hubOpen&&(()=>{
        const has=(t)=>items.some(x=>x.space===tab&&x.type===t);
        const open=(fn)=>{setHubOpen(false);fn();};
        const OPTS=[
          {key:"schedule",emoji:isMemberTab?"💉":"📅",label:isMemberTab?"ケア・予定":"予定・ToDo",freq:1,used:isMemberTab?items.some(x=>x.space===tab&&x.type==="care"):items.some(x=>x.space==="me"&&ME_TYPES.includes(x.type)),act:()=>setInputSheet("schedule")},
          {key:"diary",emoji:"📝",label:"今日のようす",freq:1,used:has("diary"),act:()=>setInputSheet("diary")},
          {key:"routine",emoji:"🗓",label:"ルーティン（習慣）",freq:1,used:has("routine"),act:openRoutineCustom},
          {key:"health",emoji:"📈",label:"体重・からだ",freq:2,used:has("health"),act:()=>setInputSheet("health")},
          {key:"expense",emoji:"💰",label:"支出",freq:2,used:has("expense"),act:()=>setInputSheet("expense")},
          {key:"memory",emoji:"📸",label:"思い出",freq:2,used:has("memory"),act:()=>openLifeNew(todayIso,tab)},
          {key:"supply",emoji:"📦",label:"ストック",freq:3,used:has("supply"),act:openSupplyCustom},
          {key:"card",emoji:"📌",label:"大切な情報",freq:3,used:has("card"),act:()=>openCardNew("other")},
          ...(curKind==="person"?[{key:"belong",emoji:"🎒",label:"持ち物（曜日）",freq:3,used:has("belonging"),act:()=>setInputSheet("belong")}]:[]),
          ...(!isMemberTab?[{key:"bday",emoji:"🎂",label:"誕生日・記念日",freq:3,used:items.some(x=>x.space==="me"&&x.type==="bday"),act:()=>setInputSheet("bday")}]:[]),
        ];
        const core=OPTS.filter(o=>o.freq===1||o.used);
        const unused=OPTS.filter(o=>o.freq!==1&&!o.used);
        const Grid=({list})=>(<div className="yl-hub-grid">{list.map(o=><button key={o.key} className="yl-hub-item" onClick={()=>open(o.act)}><span className="yl-hub-emoji">{o.emoji}</span><span className="yl-hub-label">{o.label}</span></button>)}</div>);
        return(
          <div className="yl-overlay yl-hub-ov" onClick={()=>setHubOpen(false)}>
            <div className="yl-hub" onClick={e=>e.stopPropagation()}>
              <div className="yl-hub-head"><h3 className="yl-hub-title">何を記録しますか？</h3><span className="yl-hub-who">{nameOf(tab)}</span></div>
              <Grid list={core}/>
              {unused.length>0&&(
                <div className="yl-hub-unused">
                  <p className="yl-hub-unused-label">まだ使っていない機能（{unused.length}）</p>
                  <Grid list={unused}/>
                </div>
              )}
              <button className="yl-hub-close" onClick={()=>setHubOpen(false)}>とじる</button>
            </div>
          </div>
        );
      })()}
      {confirmAct&&<div className="yl-overlay" onClick={()=>setConfirmAct(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji">🗑️</div><h3 className="yl-modal-title">本当に削除しますか？</h3>{confirmAct.label?<p className="yl-modal-body">「{confirmAct.label}」を削除します。この操作は元に戻せません。</p>:<p className="yl-modal-body">この操作は元に戻せません。</p>}<div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmAct(null)}>キャンセル</button><button className="yl-modal-del" onClick={()=>{const f=confirmAct.fn;setConfirmAct(null);f&&f();}}>削除する</button></div></div></div>}
      {confirmReset&&<div className="yl-overlay" onClick={()=>setConfirmReset(false)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji">⚠️</div><h3 className="yl-modal-title">本当に消して良いですか？</h3><p className="yl-modal-body">登録した予定・ケア・消耗品・家族の情報がすべて消えて、最初の状態に戻ります。この操作は元に戻せません。</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmReset(false)}>キャンセル</button><button className="yl-modal-del" onClick={()=>{setConfirmReset(false);resetApp();}}>消して最初から</button></div></div></div>}
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
              <h3 className="yl-modal-title">📅 カレンダーに追加</h3>
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
            <div className="yl-notify"><span className="yl-notify-label">🔔 リマインド（複数OK）{notifPerm==="default"&&<button className="yl-notif-small" onClick={handleNotifRequest}>許可する</button>}</span><div className="yl-notify-chips">{REMINDER_OPTS.filter(o=>o.key!==1440).map(o=><button key={o.key} className={"yl-nchip"+(routineEdit.reminders.includes(o.key)?" on":"")} onClick={()=>toggleRoutineReminder(o.key)}>{o.label}</button>)}</div>{routineEdit.reminders.length>=4&&<p className="yl-notify-hint">🔔が多いと通知に慣れて見落としがち。本当に必要なぶんだけがおすすめです。</p>}</div>
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
