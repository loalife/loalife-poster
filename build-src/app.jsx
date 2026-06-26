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

const STORAGE_KEY = "patty-yaritai-v3";
const iso = (d) => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${da}`; };
const plusDays = (n) => { const d=new Date(); d.setDate(d.getDate()+n); return iso(d); };
const daysUntil = (s) => { if(!s)return null; const[y,m,d]=s.split("-").map(Number); const due=new Date(y,m-1,d),now=new Date(),t0=new Date(now.getFullYear(),now.getMonth(),now.getDate()); return Math.round((due-t0)/86400000); };
const addInterval = (s,rep) => { const[y,m,d]=s.split("-").map(Number); const dt=new Date(y,m-1,d); if(rep==="daily")dt.setDate(dt.getDate()+1); else if(rep==="weekly")dt.setDate(dt.getDate()+7); else if(rep==="monthly")dt.setMonth(dt.getMonth()+1); else if(rep==="yearly")dt.setFullYear(dt.getFullYear()+1); return iso(dt); };
const fmtDate = (s) => { if(!s)return""; const[,m,d]=s.split("-").map(Number); return`${m}/${d}`; };
const fmtBirthday = (s) => { if(!s)return""; const[,mo,d]=s.split("-").map(Number); return`${mo}月${d}日`; };

const TYPE_META={dream:{label:"夢",emoji:"🌈",bg:"#FFE0EC",fg:"#FF2D7E"},work:{label:"仕事",emoji:"💼",bg:"#E6E8FB",fg:"#4F5BD5"},event:{label:"予定",emoji:"📅",bg:"#ECE3FF",fg:"#7C4DFF"},social:{label:"飲み会",emoji:"🍻",bg:"#FFE7D6",fg:"#E8730C"},habit:{label:"習慣",emoji:"💪",bg:"#FFF4D6",fg:"#D99400"}};
const ME_TYPES=["dream","work","event","social","habit"];
const KIND_STYLE={pet:{bg:"#DBF6F1",fg:"#0E9E8E",word:"ケア"},person:{bg:"#E3EEFF",fg:"#3B7BF6",word:"予定"}};
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
const ROUTINE_TEMPLATES={
  pet:[{title:"散歩",emoji:"🦮",time:"07:00"},{title:"ごはん",emoji:"🍚",time:"08:00"},{title:"トイレ掃除",emoji:"🧹",time:"09:00"}],
  person:[{title:"歯みがき",emoji:"🪥",time:"08:00"},{title:"宿題",emoji:"📖",time:"17:00"},{title:"お風呂",emoji:"🛁",time:"19:00"},{title:"薬",emoji:"💊",time:"20:00"}],
};
const routineTemplatesFor=(m)=>ROUTINE_TEMPLATES[m&&m.kind==="person"?"person":"pet"];
const ROUTINE_EMOJIS={pet:["🦮","🍚","🧹","💊","🛁","🦴","🚽","🪥","🐾","💧"],person:["🪥","📖","🛁","💊","🍚","🌙","⏰","🎒","🧴","💧"]};
// 消耗品（ストック）テンプレ：買った日＋消費サイクルで「そろそろ切れそう」を自動表示
const SUPPLY_TEMPLATES={
  pet:[{title:"フード",emoji:"🍚",cycleDays:30},{title:"おやつ",emoji:"🦴",cycleDays:30},{title:"トイレシーツ",emoji:"🧻",cycleDays:30},{title:"薬・サプリ",emoji:"💊",cycleDays:30}],
  person:[{title:"おむつ",emoji:"🧷",cycleDays:30},{title:"ティッシュ",emoji:"🧻",cycleDays:30},{title:"洗剤",emoji:"🧴",cycleDays:45},{title:"薬・サプリ",emoji:"💊",cycleDays:30}],
};
const supplyTemplatesFor=(m)=>SUPPLY_TEMPLATES[m&&m.kind==="person"?"person":"pet"];
const SUPPLY_EMOJIS=["🍚","🦴","🧻","💊","🧷","🧴","🥫","🧼","🪥","🧂","☕","🍼"];
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

const EMOJI_RULES=[[["目","眼","ICL","メガネ","視力","レーシック"],"👁️"],[["マラソン","ラン","走","ジョギング","駅伝"],"🏃"],[["ジム","筋トレ","トレーニング","クロスフィット","crossfit","筋"],"🏋️"],[["自転車","サイクリング","ロングライド","ライド","ロード"],"🚴"],[["泳","スイミング","プール","水泳"],"🏊"],[["ヨガ","ストレッチ","瞑想"],"🧘"],[["ピアノ","ジャズ","鍵盤","セッション"],"🎹"],[["ギター","楽器","音楽","バンド"],"🎸"],[["ライブ","コンサート","歌","カラオケ"],"🎤"],[["映画","シネマ"],"🎬"],[["本","読書","読む"],"📚"],[["試験","資格","勉強","検定","TOEIC","G検定","学習"],"🎓"],[["面接","転職","仕事","キャリア","案件","副業"],"💼"],[["会議","打ち合わせ","打合せ","MTG","ミーティング","商談"],"📊"],[["飲み","飲み会","会食","宴会","パーティ","ランチ会","歓迎会","送別会","二次会"],"🍻"],[["旅","旅行","海外","ペルー","訪ね","観光","ステイ"],"✈️"],[["海","ビーチ","南国"],"🏖️"],[["山","登山","富士","ハイキング","トレッキング"],"⛰️"],[["語","スペイン語","英語","中国語","会話"],"🗣️"],[["写真","カメラ","撮"],"📷"],[["料理","ごはん","ご飯","レストラン","食","クッキング"],"🍳"],[["コーヒー","カフェ","珈琲"],"☕"],[["貯金","お金","投資","iDeCo","ふるさと納税","資産","NISA"],"💰"],[["病院","通院","受診","健診","健康診断","診察"],"🏥"],[["ワクチン","予防接種","注射","接種"],"💉"],[["フィラリア","蚊","ノミ","ダニ"],"🦟"],[["狂犬病"],"🐕"],[["歯","歯科","デンタル"],"🦷"],[["美容","トリミング","カット","ヘア","サロン"],"✂️"],[["散歩","お散歩","ウォーキング"],"🦮"],[["習い事","レッスン","塾","スクール"],"🎒"],[["誕生","記念","バースデー"],"🎂"],[["結婚","プロポーズ","婚"],"💍"],[["掃除","片付","そうじ"],"🧹"],[["引っ越","引越","移住"],"📦"],[["占い","星","運勢"],"✨"]];
const PICKER_EMOJIS=["✨","🌈","💪","🏃","🚴","🏋️","🧘","🎹","🎸","🎤","🎬","📚","🎓","💼","✈️","🏖️","⛰️","📷","🍳","☕","💰","🏥","💉","🦷","✂️","🦮","🐶","🐱","🎂","💍","🧸","🧹","📦","🗣️","👁️","🦟","❤️","⭐","🎯","🌷"];
function guessEmoji(title,fallback){const t=(title||"").toLowerCase();for(const[keys,emo]of EMOJI_RULES){if(keys.some(k=>t.includes(k.toLowerCase())))return emo;}return fallback;}

const storage={get:k=>Promise.resolve().then(()=>{const v=localStorage.getItem(k);return v!=null?{value:v}:null;}),set:(k,v)=>Promise.resolve().then(()=>localStorage.setItem(k,v)),delete:k=>Promise.resolve().then(()=>localStorage.removeItem(k))};

function makeSeed(){let c=Date.now();const next=()=>--c;const me=[{emoji:"👁️",type:"dream",title:"ICL手術でメガネを卒業する"},{emoji:"🏃",type:"dream",title:"フルマラソンを完走する"},{emoji:"💼",type:"event",title:"HR企画ポジションの面接",dueDate:plusDays(3)},{emoji:"💪",type:"habit",title:"ジムに行く",dueDate:plusDays(2),repeat:"weekly"},{emoji:"✈️",type:"dream",title:"ペルーの家族のルーツを訪ねる"},{emoji:"🎹",type:"dream",title:"ジャズピアノでステージに立つ"},{emoji:"💗",type:"dream",title:"LOALIFEをもっと多くの人に届ける"}].map((it,i)=>({id:"m"+i,space:"me",repeat:"none",done:false,createdAt:next(),...it}));const roa=[{emoji:"💉",title:"混合ワクチン",careKind:"vaccine",repeat:"yearly",dueDate:plusDays(18)},{emoji:"🦟",title:"フィラリア予防薬",careKind:"filaria",repeat:"monthly",dueDate:plusDays(4)},{emoji:"🐕",title:"狂犬病ワクチン",careKind:"rabies",repeat:"yearly",dueDate:plusDays(-5)},{emoji:"✂️",title:"トリミング",careKind:"trim",repeat:"monthly",dueDate:plusDays(25)}].map((it,i)=>({id:"r"+i,space:"roa",type:"care",done:false,createdAt:next(),...it}));return{members:[{id:"roa",name:"ロア",emoji:"🐶",kind:"pet",species:"dog",birthday:"",visibility:"household"}],items:[...me,...roa]};}

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
  const[editVisibility,setEditVisibility]=useState("household");
  const[confirmDel,setConfirmDel]=useState(null);
  const[pickerId,setPickerId]=useState(null);
  const[viewer,setViewer]=useState(null);
  const[photos,setPhotos]=useState({});
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
  useEffect(()=>{(async()=>{try{const res=await storage.get(STORAGE_KEY);if(res&&res.value){const v=JSON.parse(res.value);setMembers(v.members||[]);setItems(v.items||[]);setUsage(v.usage||{});if(v.meEmoji)setMeEmoji(v.meEmoji);if(v.meBirthday)setMeBirthday(v.meBirthday);setLoaded(true);return;}}catch(e){}setMembers([]);setItems([]);setOnboarding(true);setLoaded(true);})();},[]);

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
      const firestoreMembers=snap.docs
        .map(d=>({id:d.id,...d.data()}))
        .filter(m=>m.visibility==="household"||m.ownerUid===fireUser.uid);
      setMembers(firestoreMembers);
      // Also load items for each member from Firestore
      Promise.all(firestoreMembers.map(async m=>{
        const iSnap=await getDocs(collection(fbDb,"households",hid,"members",m.id,"items"));
        return iSnap.docs.map(d=>({id:d.id,...d.data(),space:m.id}));
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

  // Birthday notifications on load
  useEffect(()=>{
    if(!loaded||notifPerm!=="granted") return;
    members.forEach(m=>{
      const d=daysUntilBirthday(m.birthday);
      if(d===0) setTimeout(()=>fireNotif(`🎂 ${m.name}の誕生日！`,`今日は${m.name}の誕生日です`),1000);
      if(d===3) setTimeout(()=>fireNotif(`🎂 ${m.name}の誕生日まであと3日`,`お祝いの準備はできてますか？`),2000);
    });
  },[loaded,notifPerm]);

  // Local persist (used when no household)
  const persist=async(m,it,u=usage)=>{
    setMembers(m);setItems(it);setUsage(u);
    if(!household){
      try{await storage.set(STORAGE_KEY,JSON.stringify({members:m,items:it,usage:u,meEmoji,meBirthday}));}catch(e){}
    }
  };

  // Firestore: save member
  const saveMemberToFs=async(member)=>{
    if(!household||!fireUser)return;
    const hid=household.id;
    const{id,...rest}=member;
    await setDoc(doc(fbDb,"households",hid,"members",id),{...rest,ownerUid:fireUser.uid,updatedAt:serverTimestamp()},{merge:true});
  };

  // Firestore: save item
  const saveItemToFs=async(item)=>{
    if(!household||!fireUser)return;
    if(item.space==="me")return; // Me items stay local
    const hid=household.id;
    const{id,space,...rest}=item;
    await setDoc(doc(fbDb,"households",hid,"members",space,"items",id),{...rest,ownerUid:fireUser.uid,updatedAt:serverTimestamp()},{merge:true});
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
    try{storage.set(STORAGE_KEY,JSON.stringify({members,items,usage,meEmoji:emo,meBirthday})).catch(()=>{});}catch(e){}
    if(fireUser){try{setDoc(doc(fbDb,"users",fireUser.uid),{meEmoji:emo},{merge:true}).catch(()=>{});}catch(e){}}
  };
  const persistMeBirthday=(bday)=>{
    setMeBirthday(bday);
    try{storage.set(STORAGE_KEY,JSON.stringify({members,items,usage,meEmoji,meBirthday:bday})).catch(()=>{});}catch(e){}
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
      batch.set(doc(fbDb,"households",hid),{ownerUid:fireUser.uid,inviteCode:code,memberUids:[fireUser.uid],createdAt:serverTimestamp()});
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
    if(it&&it.photo){try{storage.delete(`photo:${id}`).catch(()=>{});}catch(e){}}
    deleteItemFromFs(it).catch(()=>{});
    persist(members,items.filter(x=>x.id!==id));
  };

  const onFilePicked=async(e,id)=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;
    if(file.size>20*1024*1024){showFlash("ファイルが大きすぎます（20MB以下）");return;}
    try{
      const dataUrl=await downscaleImage(file);
      try{localStorage.setItem("__test__",dataUrl);localStorage.removeItem("__test__");}
      catch(e){showFlash("ストレージ容量が不足しています");return;}
      setPhotos(p=>({...p,[id]:dataUrl}));
      try{storage.set(`photo:${id}`,dataUrl).catch(()=>{});}catch(er){}
      setItems(prev=>{const next=prev.map(x=>x.id===id?{...x,photo:true}:x);try{storage.set(STORAGE_KEY,JSON.stringify({members,items:next})).catch(()=>{});}catch(er){}return next;});
      showFlash("証明書を保存しました 📷");
    }catch(err){showFlash("保存できませんでした。別の画像でお試しください");}
  };

  const viewPhoto=async(id)=>{if(photos[id]){setViewer({id,src:photos[id]});return;}setViewer({id,loading:true});try{const res=await storage.get(`photo:${id}`);setViewer({id,src:res&&res.value});}catch(e){setViewer({id,src:null});}};
  const removePhoto=(id)=>{try{storage.delete(`photo:${id}`).catch(()=>{});}catch(e){}setPhotos(p=>{const n={...p};delete n[id];return n;});persist(members,items.map(x=>x.id===id?{...x,photo:false}:x));setViewer(null);showFlash("証明書を削除しました");};
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
    const next=members.map(m=>m.id===id?{...m,name,birthday:editBirthday,visibility:editVisibility}:m);
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
  const openRoutineTemplate=(t)=>setRoutineEdit({title:t.title,emoji:t.emoji,time:t.time,reminders:[0],space:activeMember.id});
  const openRoutineCustom=()=>setRoutineEdit({title:"",emoji:activeMember.kind==="person"?"⏰":"🐾",time:"08:00",reminders:[0],space:activeMember.id});
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
  const openSupplyTemplate=(t)=>setSupplyEdit({title:t.title,emoji:t.emoji,cycleDays:t.cycleDays,lastBought:todayIso,space:activeMember.id});
  const openSupplyCustom=()=>setSupplyEdit({title:"",emoji:"🥫",cycleDays:30,lastBought:todayIso,space:activeMember.id});
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

  const visible=useMemo(()=>{let arr=items.filter(x=>x.space===tab&&x.type!=="routine"&&x.type!=="supply");if(filter!=="all")arr=arr.filter(x=>isMemberTab?x.careKind===filter:x.type===filter);arr=[...arr].sort((a,b)=>{if(!a.dueDate&&!b.dueDate)return b.createdAt-a.createdAt;if(!a.dueDate)return 1;if(!b.dueDate)return -1;return a.dueDate.localeCompare(b.dueDate);});return arr.sort((a,b)=>a.done===b.done?0:a.done?1:-1);},[items,tab,filter,isMemberTab]);
  const filterChips=useMemo(()=>{const all={key:"all",label:"すべて"};if(isMemberTab)return[all,...careKindsFor(activeMember)];return[all,...ME_TYPES.map(t=>({key:t,label:TYPE_META[t].label}))];},[tab,isMemberTab]);
  const suggestions=useMemo(()=>{const prefix=tab+" ";return Object.entries(usage).filter(([k,c])=>k.startsWith(prefix)&&c>=2).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k.slice(prefix.length));},[usage,tab]);
  const meItems=items.filter(x=>x.space==="me");
  const doneCount=meItems.filter(x=>x.done).length;
  const pct=meItems.length?Math.round((doneCount/meItems.length)*100):0;
  const memberStats=useMemo(()=>{if(!isMemberTab)return null;const arr=items.filter(x=>x.space===tab);let soon=0,over=0;arr.forEach(x=>{const d=daysUntil(x.dueDate);if(d===null)return;if(d<0)over++;else if(d<=7)soon++;});return{soon,over};},[items,tab,isMemberTab]);
  const emojiSet=newKind==="person"?PERSON_EMOJIS:PET_EMOJIS;
  const spaces=useMemo(()=>[{id:"me",name:"わたし",emoji:meEmoji,kind:"me"},...members],[members,meEmoji]);
  const statusFor=(spaceId)=>{const arr=items.filter(x=>x.space===spaceId&&!x.done&&x.dueDate);let over=0,next=null,nextDays=Infinity;arr.forEach(x=>{const d=daysUntil(x.dueDate);if(d<0)over++;else if(d<nextDays){nextDays=d;next=x;}});return{over,next,nextDays};};
  const todayList=useMemo(()=>items.filter(x=>!x.done&&x.dueDate&&daysUntil(x.dueDate)<=0).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)),[items]);
  const summary=useMemo(()=>({dreams:items.filter(x=>x.type==="dream"&&x.done).length,careOverdue:items.filter(x=>x.type==="care"&&!x.done&&x.dueDate&&daysUntil(x.dueDate)<0).length,family:members.length}),[items,members]);
  const nameOf=(spaceId)=>spaceId==="me"?"わたし":(members.find(m=>m.id===spaceId)||{}).name||"";

  const upcomingBirthdays=useMemo(()=>{const all=[...members.filter(m=>m.birthday)];if(meBirthday)all.unshift({id:"me",name:"わたし",emoji:meEmoji,birthday:meBirthday});return all.map(m=>({...m,daysUntil:daysUntilBirthday(m.birthday)})).filter(m=>m.daysUntil!==null&&m.daysUntil<=7).sort((a,b)=>a.daysUntil-b.daysUntil);},[members,meBirthday,meEmoji]);

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
          {obStep===2&&<div className="yl-ob-inner"><p className="yl-ob-step">2 / 2</p><h2 className="yl-ob-h2">一緒に見守りたい家族はいますか？</h2>{!obKind?<div className="yl-ob-choices"><button className="yl-ob-choice" onClick={()=>{setObKind("pet");setObEmoji(PET_EMOJIS[0]);}}>🐶 ペット</button><button className="yl-ob-choice" onClick={()=>{setObKind("person");setObEmoji(PERSON_EMOJIS[0]);}}>👧 家族（人）</button><button className="yl-ob-link" onClick={finishOnboarding}>今は追加しない</button></div>:<div className="yl-ob-form">{obKind==="pet"&&<div className="yl-kindrow">{SPECIES.map(s=><button key={s.key} className={"yl-kindbtn sm"+(obSpecies===s.key?" on":"")} onClick={()=>{setObSpecies(s.key);setObEmoji(s.emoji);}}>{s.emoji} {s.label}</button>)}</div>}<div className="yl-emoji-row">{(obKind==="person"?PERSON_EMOJIS:PET_EMOJIS).map(e=><button key={e} className={"yl-emoji"+(obEmoji===e?" on":"")} onClick={()=>setObEmoji(e)}>{e}</button>)}</div><input className="yl-input" value={obName} onChange={e=>setObName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&finishOnboarding()} placeholder={obKind==="person"?"名前（例：ゆうと）":"名前（例：ロア）"} autoFocus/><label className="yl-opt" style={{width:"100%",marginTop:8}}>誕生日（任意）<input type="date" className="yl-date" style={{width:"100%"}} value={obBirthday} onChange={e=>setObBirthday(e.target.value)}/></label><button className="yl-ob-btn" onClick={finishOnboarding}>はじめる</button><button className="yl-ob-link" onClick={()=>setObKind(null)}>戻る</button></div>}</div>}
        </div>
      )}

      <div className="yl-wrap">
        <header className="yl-head">
          <h1 className="yl-title">🏠 ホーム</h1>
          <button
            className={"yl-share-btn"+(inHousehold?" active":"")}
            onClick={()=>{setShowShareModal(true);setShareStep(household?"menu":"menu");setShareError("");}}
            title="家族共有"
          >
            {inHousehold?"👨‍👩‍👧":"👤"}{fireUser?"":" 共有"}
          </button>
        </header>

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
            <div className="yl-petform-row"><input className="yl-input" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMember()} placeholder={newKind==="person"?"名前（例：ゆうと）":"名前（例：ロア）"}/><button className="yl-addbtn" onClick={addMember}>登録</button></div>
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

            {upcomingBirthdays.length>0&&(
              <section className="yl-bday-section">
                <h2 className="yl-sec-title">もうすぐ誕生日 🎂</h2>
                {upcomingBirthdays.map(m=>(
                  <div key={m.id} className="yl-bday-row">
                    <span className="yl-bday-emoji">{m.emoji}</span>
                    <span className="yl-bday-name">{m.name}</span>
                    <span className="yl-bday-date">{fmtBirthday(m.birthday)}</span>
                    <span className={"yl-bday-tag"+(m.daysUntil===0?" today":"")}>{m.daysUntil===0?"今日！":`あと${m.daysUntil}日`}</span>
                  </div>
                ))}
              </section>
            )}

            {/* Status dashboard grouped by person */}
            {groupedDashboard.length===0?(
              <section className="yl-hero">
                <div className="yl-hero-emoji">✨</div>
                <p className="yl-hero-title">今後1週間、予定はありません</p>
                <p className="yl-hero-sub">{members.length===0?"ゆっくり過ごせる一日を":members.length===1?`${members[0].emoji} ${members[0].name}は今日も元気です`:`${members.map(m=>m.emoji).join("")} みんな今日も元気です`}</p>
              </section>
            ):(
              <section className="yl-dashboard">
                <div className="yl-dash-head">
                  <h2 className="yl-sec-title" style={{marginBottom:0}}>今日やること</h2>
                  <button className="yl-cal-export" onClick={()=>setCalPicker({bulk:true})} title="カレンダーにエクスポート">📅 エクスポート</button>
                </div>
                {groupedDashboard.map(({space:s,items:gItems})=>(
                  <div key={s.id} className="yl-dash-group">
                    <button className="yl-dash-group-head" onClick={()=>setTab(s.id)}>
                      <span className="yl-dash-emoji">{s.emoji}</span>
                      <span className="yl-dash-name">{s.name}</span>
                    </button>
                    <ul className="yl-dash-list">
                      {gItems.map(it=>{
                        const d=daysUntil(it.dueDate);
                        const tag=d<0?"期限切れ":d===0?"今日":d===1?"明日":`あと${d}日`;
                        const tone=d<0?"over":d===0?"today":d<=2?"soon":"normal";
                        const calUrl=gcalLink(it,s.name,s.emoji);
                        return(
                          <li key={it.id} className="yl-dash-item">
                            <span className="yl-dash-item-emoji">{it.emoji||"•"}</span>
                            <span className="yl-dash-item-text">{it.title}{it.time&&<span className="yl-dash-item-time"> {it.time}</span>}</span>
                            <span className={"yl-dash-tag "+tone}>{tag}</span>
                            <button className="yl-cal-add" onClick={e=>{e.stopPropagation();setCalPicker({item:it});}} title="カレンダーに追加">📅</button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </section>
            )}

            <h2 className="yl-sec-title" style={{marginTop:18}}>みんなの状態</h2>
            <div className="yl-statusgrid">{spaces.map(s=>{const st=statusFor(s.id);const sup=lowSupplies.filter(o=>o.item.space===s.id).sort((a,b)=>a.st.left-b.st.left);const worst=sup[0];const alert=st.over>0||(worst&&worst.st.tone==="out");let line,sub=null;if(st.over>0)line=`🔴 期限切れ ${st.over}件`;else if(st.next){line=s.kind==="pet"?"今日は安心して過ごせます":"順調です";sub=`次の予定：${st.next.title}・${st.nextDays===0?"今日":"あと"+st.nextDays+"日"}`;}else line=s.kind==="pet"?"今日も元気です":"予定はありません";const supText=worst?`${worst.item.emoji} ${worst.item.title}：${worst.st.tone==="out"?"切れているかも":"あと"+worst.st.left+"日で切れそう"}`:null;return<button key={s.id} className={"yl-statuscard "+(alert?"alert":"")} onClick={()=>setTab(s.id)}><span className="yl-status-emoji">{s.emoji}</span><span className="yl-status-body"><span className="yl-status-name">{s.name}</span><span className="yl-status-line">{line}</span>{supText?<span className={"yl-status-supply "+worst.st.tone}>{supText}</span>:sub&&<span className="yl-status-sub">{sub}</span>}</span><span className="yl-status-dot" style={{background:alert?"#E5484D":"#2FC9A8"}}/></button>;})}
            </div>

            <section className="yl-summary"><h2 className="yl-sec-title light">これまでの記録</h2><div className="yl-summary-row"><div className="yl-stat"><span className="yl-stat-n">{summary.dreams}</span><span className="yl-stat-l">達成したこと</span></div><div className="yl-stat"><span className="yl-stat-n">{summary.careOverdue}</span><span className="yl-stat-l">対応が必要なこと</span></div><div className="yl-stat"><span className="yl-stat-n">{summary.family}</span><span className="yl-stat-l">家族メンバー</span></div></div></section>
            <button className="yl-reset" onClick={resetApp}>⟳ サンプルを消して最初から</button>
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
                      {inHousehold&&<div style={{marginTop:8}}><VisibilityToggle value={editVisibility} onChange={setEditVisibility}/></div>}
                      <button className="yl-addbtn sm" onClick={()=>saveRename(activeMember.id)}>保存</button>
                    </div>
                  ):(
                    <span className="yl-petstatus-title" style={{color:KIND_STYLE[activeMember.kind].fg}}>
                      {activeMember.emoji} {activeMember.name} の{KIND_STYLE[activeMember.kind].word}
                      <button className="yl-icon" onClick={()=>{setEditingId(activeMember.id);setEditName(activeMember.name);setEditBirthday(activeMember.birthday||"");setEditVisibility(activeMember.visibility||"household");}}>✏️</button>
                    </span>
                  )}
                </div>
                <div className="yl-petstatus-chips">
                  <span className="yl-pill soon">⏰ 近い {memberStats?.soon||0}</span>
                  <span className="yl-pill over">🔴 期限切れ {memberStats?.over||0}</span>
                  {activeMember.birthday&&<span className="yl-pill bday">🎂 {fmtBirthday(activeMember.birthday)}</span>}
                  {inHousehold&&<span className={"yl-pill vis"+(activeMember.visibility==="private"?" private":"")}>{activeMember.visibility==="private"?"🔒 非公開":"👨‍👩‍👧 共有中"}</span>}
                  <button className="yl-pet-del" onClick={()=>setConfirmDel(activeMember)}>削除</button>
                </div>
              </section>
            )}

            {/* 1日のタイムライン（ルーティン）メンバータブのみ */}
            {isMemberTab&&(
              <section className="yl-routine">
                <div className="yl-routine-head">
                  <h2 className="yl-routine-title">🗓 今日のタイムライン</h2>
                  {routines.length>0&&<span className="yl-routine-prog">{routineDone} / {routines.length}</span>}
                </div>
                {routines.length===0?(
                  <p className="yl-routine-empty">毎日くりかえすお世話を、下のテンプレから追加できます</p>
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
                          <button className={"yl-check"+(done?" on":"")} onClick={()=>toggleRoutine(r.id)} aria-label="完了"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="yl-routine-tpl">
                  {routineTemplatesFor(activeMember).map(t=><button key={t.title} className="yl-tpl-btn" onClick={()=>openRoutineTemplate(t)}>{t.emoji} {t.title}</button>)}
                  <button className="yl-tpl-btn custom" onClick={openRoutineCustom}>＋ 自由</button>
                </div>
              </section>
            )}

            {/* 消耗品ストック（メンバータブのみ）買った日だけ入れれば残量を自動表示 */}
            {isMemberTab&&(
              <section className="yl-supply">
                <div className="yl-routine-head">
                  <h2 className="yl-routine-title">📦 ストック</h2>
                  {supplies.length>0&&<span className="yl-supply-hint">買った時だけタップ</span>}
                </div>
                {supplies.length===0?(
                  <p className="yl-routine-empty">フードなどの消耗品を登録すると、残量を自動で見守ります</p>
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
                  {supplyTemplatesFor(activeMember).map(t=><button key={t.title} className="yl-tpl-btn" onClick={()=>openSupplyTemplate(t)}>{t.emoji} {t.title}</button>)}
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
          </>
        )}
        <p className="yl-foot">試作版・データはこの端末に保存されます</p>
      </div>

      {editItemId&&<div className="yl-overlay" onClick={()=>setEditItemId(null)}><div className="yl-modal edit" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">編集</h3><input className="yl-input" value={eTitle} onChange={e=>setETitle(e.target.value)} placeholder="タイトル"/><div className="yl-optrow"><label className="yl-opt">期限<input type="date" className="yl-date" value={eDate} onChange={e=>setEDate(e.target.value)}/></label><label className="yl-opt">時間<TimeInput value={eTime} onChange={setETime}/></label><label className="yl-opt">繰り返し<select className="yl-select" value={eRepeat} onChange={e=>setERepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div><div className="yl-notify"><span className="yl-notify-label">🔔 通知</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(eReminders.includes(o.key)?" on":"")} onClick={()=>toggleEReminder(o.key)}>{o.label}</button>)}</div></div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEditItemId(null)}>閉じる</button><button className="yl-addbtn modal" onClick={saveEdit}>保存</button></div></div></div>}
      {viewer&&<div className="yl-overlay" onClick={()=>setViewer(null)}><div className="yl-modal photo" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">証明書</h3>{viewer.loading?<p className="yl-loading">読み込み中…</p>:viewer.src?<img className="yl-photo-img" src={viewer.src} alt="証明書"/>:<p className="yl-empty">画像が見つかりませんでした</p>}<div className="yl-modal-btns">{viewer.src&&<button className="yl-modal-cancel" onClick={()=>removePhoto(viewer.id)}>削除</button>}<button className="yl-modal-cancel" onClick={()=>setViewer(null)}>閉じる</button></div></div></div>}
      {pickerId&&<div className="yl-overlay" onClick={()=>setPickerId(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">絵文字を選ぶ</h3><div className="yl-emoji-grid">{PICKER_EMOJIS.map(e=><button key={e} className="yl-emoji-pick" onClick={()=>setEmoji(pickerId,e)}>{e}</button>)}</div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEmoji(pickerId,"")}>絵文字なし</button><button className="yl-modal-cancel" onClick={()=>setPickerId(null)}>閉じる</button></div></div></div>}
      {mePicker&&<div className="yl-overlay" onClick={()=>setMePicker(false)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">あなたの絵文字を選ぶ</h3><div className="yl-emoji-grid">{ME_EMOJIS.map(e=><button key={e} className={"yl-emoji-pick"+(meEmoji===e?" on":"")} onClick={()=>{persistMeEmoji(e);setMePicker(false);}}>{e}</button>)}</div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setMePicker(false)}>閉じる</button></div></div></div>}
      {confirmDel&&<div className="yl-overlay" onClick={()=>setConfirmDel(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji">{confirmDel.emoji}</div><h3 className="yl-modal-title">{confirmDel.name} を削除しますか？</h3><p className="yl-modal-body">{(()=>{const n=items.filter(x=>x.space===confirmDel.id).length;return n>0?`${confirmDel.name}のケア（${n}件）も一緒に消えます。この操作は元に戻せません。`:"この操作は元に戻せません。";})()}</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmDel(null)}>キャンセル</button><button className="yl-modal-del" onClick={()=>removeMember(confirmDel.id)}>削除する</button></div></div></div>}
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
            <div className="yl-routine-emojirow">{(ROUTINE_EMOJIS[(members.find(m=>m.id===routineEdit.space)||{}).kind==="person"?"person":"pet"]).map(e=><button key={e} className={"yl-emoji"+(routineEdit.emoji===e?" on":"")} onClick={()=>setRoutineEdit(p=>({...p,emoji:e}))}>{e}</button>)}</div>
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
