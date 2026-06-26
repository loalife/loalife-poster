import { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";

const STORAGE_KEY = "patty-yaritai-v3";
const iso = (d) => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${da}`; };
const plusDays = (n) => { const d=new Date(); d.setDate(d.getDate()+n); return iso(d); };
const daysUntil = (s) => { if(!s)return null; const[y,m,d]=s.split("-").map(Number); const due=new Date(y,m-1,d),now=new Date(),t0=new Date(now.getFullYear(),now.getMonth(),now.getDate()); return Math.round((due-t0)/86400000); };
const addInterval = (s,rep) => { const[y,m,d]=s.split("-").map(Number); const dt=new Date(y,m-1,d); if(rep==="daily")dt.setDate(dt.getDate()+1); else if(rep==="weekly")dt.setDate(dt.getDate()+7); else if(rep==="monthly")dt.setMonth(dt.getMonth()+1); else if(rep==="yearly")dt.setFullYear(dt.getFullYear()+1); return iso(dt); };
const fmtDate = (s) => { if(!s)return""; const[,m,d]=s.split("-").map(Number); return`${m}/${d}`; };

const TYPE_META={dream:{label:"夢",emoji:"🌈",bg:"#FFE0EC",fg:"#FF2D7E"},work:{label:"仕事",emoji:"💼",bg:"#E6E8FB",fg:"#4F5BD5"},event:{label:"予定",emoji:"📅",bg:"#ECE3FF",fg:"#7C4DFF"},social:{label:"飲み会",emoji:"🍻",bg:"#FFE7D6",fg:"#E8730C"},habit:{label:"習慣",emoji:"💪",bg:"#FFF4D6",fg:"#D99400"}};
const ME_TYPES=["dream","work","event","social","habit"];
const KIND_STYLE={pet:{bg:"#DBF6F1",fg:"#0E9E8E",word:"ケア"},person:{bg:"#E3EEFF",fg:"#3B7BF6",word:"予定"}};
const DOG_KINDS=[{key:"vaccine",label:"ワクチン",emoji:"💉"},{key:"rabies",label:"狂犬病",emoji:"🐕"},{key:"filaria",label:"フィラリア",emoji:"🦟"},{key:"trim",label:"トリミング",emoji:"✂️"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const CAT_KINDS=[{key:"vaccine",label:"ワクチン",emoji:"💉"},{key:"filaria",label:"フィラリア",emoji:"🦟"},{key:"trim",label:"トリミング",emoji:"✂️"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const OTHER_PET_KINDS=[{key:"checkup",label:"健康診断",emoji:"🩺"},{key:"groom",label:"お手入れ",emoji:"🧼"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"other",label:"その他",emoji:"🐾"}];
const PERSON_KINDS=[{key:"vaccine",label:"予防接種",emoji:"💉"},{key:"checkup",label:"健康診断",emoji:"🩺"},{key:"lesson",label:"習い事",emoji:"🎒"},{key:"hospital",label:"通院",emoji:"🏥"},{key:"event",label:"予定",emoji:"📅"},{key:"other",label:"その他",emoji:"✨"}];
const SPECIES=[{key:"dog",label:"犬",emoji:"🐶"},{key:"cat",label:"猫",emoji:"🐱"},{key:"other",label:"その他",emoji:"🐹"}];
const HIGH_KINDS=new Set(["vaccine","filaria","rabies","hospital","checkup"]);
const PET_EMOJIS=["🐶","🐱","🐰","🐹","🐦","🐢"];
const PERSON_EMOJIS=["👧","🧒","👦","👶","👩","👨"];
const REPEATS=[{key:"none",label:"なし"},{key:"daily",label:"毎日"},{key:"weekly",label:"毎週"},{key:"monthly",label:"毎月"},{key:"yearly",label:"毎年"}];
const REMINDER_OPTS=[{key:0,label:"開始時"},{key:5,label:"5分前"},{key:30,label:"30分前"},{key:60,label:"1時間前"},{key:1440,label:"前日"}];
const reminderLabel=(mins)=>(REMINDER_OPTS.find(o=>o.key===mins)||{}).label||`${mins}分前`;

function downscaleImage(file,maxDim=1100,quality=0.7){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{let{width,height}=img;if(width>height&&width>maxDim){height=(height*maxDim)/width;width=maxDim;}else if(height>=width&&height>maxDim){width=(width*maxDim)/height;height=maxDim;}const c=document.createElement("canvas");c.width=Math.round(width);c.height=Math.round(height);c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);try{resolve(c.toDataURL("image/jpeg",quality));}catch(e){reject(e);}};img.onerror=reject;img.src=url;});}
const careKindsFor=(m)=>{if(!m)return[];if(m.kind==="person")return PERSON_KINDS;if(m.species==="cat")return CAT_KINDS;if(m.species==="other")return OTHER_PET_KINDS;return DOG_KINDS;};
const EMOJI_RULES=[[["目","眼","ICL","メガネ","視力","レーシック"],"👁️"],[["マラソン","ラン","走","ジョギング","駅伝"],"🏃"],[["ジム","筋トレ","トレーニング","クロスフィット","crossfit","筋"],"🏋️"],[["自転車","サイクリング","ロングライド","ライド","ロード"],"🚴"],[["泳","スイミング","プール","水泳"],"🏊"],[["ヨガ","ストレッチ","瞑想"],"🧘"],[["ピアノ","ジャズ","鍵盤","セッション"],"🎹"],[["ギター","楽器","音楽","バンド"],"🎸"],[["ライブ","コンサート","歌","カラオケ"],"🎤"],[["映画","シネマ"],"🎬"],[["本","読書","読む"],"📚"],[["試験","資格","勉強","検定","TOEIC","G検定","学習"],"🎓"],[["面接","転職","仕事","キャリア","案件","副業"],"💼"],[["会議","打ち合わせ","打合せ","MTG","ミーティング","商談"],"📊"],[["飲み","飲み会","会食","宴会","パーティ","ランチ会","歓迎会","送別会","二次会"],"🍻"],[["旅","旅行","海外","ペルー","訪ね","観光","ステイ"],"✈️"],[["海","ビーチ","南国"],"🏖️"],[["山","登山","富士","ハイキング","トレッキング"],"⛰️"],[["語","スペイン語","英語","中国語","会話"],"🗣️"],[["写真","カメラ","撮"],"📷"],[["料理","ごはん","ご飯","レストラン","食","クッキング"],"🍳"],[["コーヒー","カフェ","珈琲"],"☕"],[["貯金","お金","投資","iDeCo","ふるさと納税","資産","NISA"],"💰"],[["病院","通院","受診","健診","健康診断","診察"],"🏥"],[["ワクチン","予防接種","注射","接種"],"💉"],[["フィラリア","蚊","ノミ","ダニ"],"🦟"],[["狂犬病"],"🐕"],[["歯","歯科","デンタル"],"🦷"],[["美容","トリミング","カット","ヘア","サロン"],"✂️"],[["散歩","お散歩","ウォーキング"],"🦮"],[["習い事","レッスン","塾","スクール"],"🎒"],[["誕生","記念","バースデー"],"🎂"],[["結婚","プロポーズ","婚"],"💍"],[["掃除","片付","そうじ"],"🧹"],[["引っ越","引越","移住"],"📦"],[["占い","星","運勢"],"✨"]];
const PICKER_EMOJIS=["✨","🌈","💪","🏃","🚴","🏋️","🧘","🎹","🎸","🎤","🎬","📚","🎓","💼","✈️","🏖️","⛰️","📷","🍳","☕","💰","🏥","💉","🦷","✂️","🦮","🐶","🐱","🎂","💍","🧸","🧹","📦","🗣️","👁️","🦟","❤️","⭐","🎯","🌷"];
function guessEmoji(title,fallback){const t=(title||"").toLowerCase();for(const[keys,emo]of EMOJI_RULES){if(keys.some(k=>t.includes(k.toLowerCase())))return emo;}return fallback;}

const storage={get:k=>Promise.resolve().then(()=>{const v=localStorage.getItem(k);return v!=null?{value:v}:null;}),set:(k,v)=>Promise.resolve().then(()=>localStorage.setItem(k,v)),delete:k=>Promise.resolve().then(()=>localStorage.removeItem(k))};

function makeSeed(){let c=Date.now();const next=()=>--c;const me=[{emoji:"👁️",type:"dream",title:"ICL手術でメガネを卒業する"},{emoji:"🏃",type:"dream",title:"フルマラソンを完走する"},{emoji:"💼",type:"event",title:"HR企画ポジションの面接",dueDate:plusDays(3)},{emoji:"💪",type:"habit",title:"ジムに行く",dueDate:plusDays(2),repeat:"weekly"},{emoji:"✈️",type:"dream",title:"ペルーの家族のルーツを訪ねる"},{emoji:"🎹",type:"dream",title:"ジャズピアノでステージに立つ"},{emoji:"💗",type:"dream",title:"LOALIFEをもっと多くの人に届ける"}].map((it,i)=>({id:"m"+i,space:"me",repeat:"none",done:false,createdAt:next(),...it}));const roa=[{emoji:"💉",title:"混合ワクチン",careKind:"vaccine",repeat:"yearly",dueDate:plusDays(18)},{emoji:"🦟",title:"フィラリア予防薬",careKind:"filaria",repeat:"monthly",dueDate:plusDays(4)},{emoji:"🐕",title:"狂犬病ワクチン",careKind:"rabies",repeat:"yearly",dueDate:plusDays(-5)},{emoji:"✂️",title:"トリミング",careKind:"trim",repeat:"monthly",dueDate:plusDays(25)}].map((it,i)=>({id:"r"+i,space:"roa",type:"care",done:false,createdAt:next(),...it}));return{members:[{id:"roa",name:"ロア",emoji:"🐶",kind:"pet",species:"dog"}],items:[...me,...roa]};}

function dueStatus(item){if(!item.dueDate)return null;const d=daysUntil(item.dueDate);if(d>3)return{label:fmtDate(item.dueDate),tone:"normal"};if(d>0)return{label:`あと${d}日`,tone:"soon"};if(d===0)return{label:"今日",tone:"today"};if(item.type==="dream")return{label:"また今度でも大丈夫",tone:"gentleOver"};if(item.careKind&&HIGH_KINDS.has(item.careKind))return{label:"期限を過ぎています",tone:"careOver"};return{label:`${-d}日すぎてます`,tone:"gentleOver"};}

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
  const[editingId,setEditingId]=useState(null);
  const[editName,setEditName]=useState("");
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

  useEffect(()=>{(async()=>{try{const res=await storage.get(STORAGE_KEY);if(res&&res.value){const v=JSON.parse(res.value);setMembers(v.members||[]);setItems(v.items||[]);setUsage(v.usage||{});setLoaded(true);return;}}catch(e){}setMembers([]);setItems([]);setOnboarding(true);setLoaded(true);})();},[]);

  const persist=async(m,it,u=usage)=>{setMembers(m);setItems(it);setUsage(u);try{await storage.set(STORAGE_KEY,JSON.stringify({members:m,items:it,usage:u}));}catch(e){}};
  const showFlash=(msg)=>{setFlash(msg);setTimeout(()=>setFlash(""),2200);};
  const loadSample=()=>{const seed=makeSeed();persist(seed.members,seed.items);setOnboarding(false);setTab("home");};
  const finishOnboarding=()=>{const nm=[];const ni=[];if(obWish.trim())ni.push({id:"x"+Date.now(),space:"me",type:"dream",title:obWish.trim(),emoji:guessEmoji(obWish.trim(),"🌈"),repeat:"none",done:false,createdAt:Date.now()});if(obKind&&obName.trim()){const m={id:"f"+Date.now(),name:obName.trim(),emoji:obEmoji,kind:obKind};if(obKind==="pet")m.species=obSpecies;nm.push(m);}persist(nm,ni);setOnboarding(false);setObStep(0);setTab("home");};
  const resetApp=()=>{try{storage.delete(STORAGE_KEY).catch(()=>{});}catch(e){}setMembers([]);setItems([]);setPhotos({});setConfirmDel(null);setObStep(0);setObWish("");setObKind(null);setObSpecies("dog");setObName("");setObEmoji("🐶");setOnboarding(true);setTab("home");};

  const activeMember=members.find(m=>m.id===tab);
  const isMemberTab=!!activeMember;

  useEffect(()=>{setFilter("all");if(activeMember){const list=careKindsFor(activeMember);const kind=list.find(k=>k.key===draftKind)?draftKind:list[0].key;if(kind!==draftKind)setDraftKind(kind);const label=(list.find(k=>k.key===kind)||{}).label||"";if(kind!=="other"&&(draft===""||draftAuto)){setDraft(label);setDraftAuto(true);}else if(kind==="other"&&draftAuto){setDraft("");setDraftAuto(false);}}else if(draftAuto){setDraft("");setDraftAuto(false);}},[tab]);

  const toggle=(id)=>{const it=items.find(x=>x.id===id);if(!it)return;let next;if(!it.done&&it.repeat&&it.repeat!=="none"){const base=it.dueDate||iso(new Date());const newDue=addInterval(base,it.repeat);next=items.map(x=>x.id===id?{...x,dueDate:newDue,done:false}:x);showFlash(`完了！次回 ${fmtDate(newDue)} に更新`);}else{next=items.map(x=>x.id===id?{...x,done:!x.done,completedAt:!x.done?Date.now():null}:x);}persist(members,next);};
  const remove=(id)=>{const it=items.find(x=>x.id===id);if(it&&it.photo){try{storage.delete(`photo:${id}`).catch(()=>{});}catch(e){}}persist(members,items.filter(x=>x.id!==id));};
  const onFilePicked=async(e,id)=>{const file=e.target.files&&e.target.files[0];e.target.value="";if(!file)return;try{const dataUrl=await downscaleImage(file);setPhotos(p=>({...p,[id]:dataUrl}));try{storage.set(`photo:${id}`,dataUrl).catch(()=>{});}catch(er){}setItems(prev=>{const next=prev.map(x=>x.id===id?{...x,photo:true}:x);try{storage.set(STORAGE_KEY,JSON.stringify({members,items:next})).catch(()=>{});}catch(er){}return next;});showFlash("証明書を保存しました 📷");}catch(err){showFlash("保存できませんでした");}};
  const viewPhoto=async(id)=>{if(photos[id]){setViewer({id,src:photos[id]});return;}setViewer({id,loading:true});try{const res=await storage.get(`photo:${id}`);setViewer({id,src:res&&res.value});}catch(e){setViewer({id,src:null});}};
  const removePhoto=(id)=>{try{storage.delete(`photo:${id}`).catch(()=>{});}catch(e){}setPhotos(p=>{const n={...p};delete n[id];return n;});persist(members,items.map(x=>x.id===id?{...x,photo:false}:x));setViewer(null);showFlash("証明書を削除しました");};
  const snooze=(id)=>{persist(members,items.map(x=>x.id===id?{...x,dueDate:plusDays(1)}:x));showFlash("明日へ送りました");};
  const setEmoji=(id,emo)=>{persist(members,items.map(x=>x.id===id?{...x,emoji:emo}:x));setPickerId(null);};
  const openEdit=(it)=>{setEditItemId(it.id);setETitle(it.title);setEDate(it.dueDate||"");setETime(it.time||"");setERepeat(it.repeat||"none");setEReminders(it.reminders||[]);};
  const saveEdit=()=>{persist(members,items.map(x=>x.id===editItemId?{...x,title:eTitle.trim()||x.title,dueDate:eDate||undefined,time:eTime||undefined,repeat:eRepeat,reminders:eReminders.length?eReminders:undefined}:x));setEditItemId(null);};
  const toggleEReminder=(mins)=>setEReminders(prev=>prev.includes(mins)?prev.filter(m=>m!==mins):[...prev,mins].sort((a,b)=>a-b));
  const toggleReminder=(mins)=>setDraftReminders(prev=>prev.includes(mins)?prev.filter(m=>m!==mins):[...prev,mins].sort((a,b)=>a-b));
  const pickCareKind=(k)=>{setDraftKind(k.key);if(k.key==="other"){if(draftAuto){setDraft("");setDraftAuto(false);}return;}if(draft===""||draftAuto){setDraft(k.label);setDraftAuto(true);}};
  const addItem=()=>{let title=draft.trim();let careMeta=null;if(isMemberTab){careMeta=careKindsFor(activeMember).find(x=>x.key===draftKind);if(!title&&draftKind!=="other")title=(careMeta||{}).label||"";}if(!title)return;let base={id:"x"+Date.now(),space:tab,title,done:false,createdAt:Date.now(),dueDate:draftDate||undefined,time:draftTime||undefined,repeat:draftRepeat,reminders:draftReminders.length?draftReminders:undefined};if(isMemberTab){base={...base,type:"care",careKind:draftKind,emoji:guessEmoji(title,careMeta.emoji)};}else{base={...base,type:draftType,emoji:guessEmoji(title,TYPE_META[draftType].emoji)};}const uKey=tab+" "+title;persist(members,[...items,base],{...usage,[uKey]:(usage[uKey]||0)+1});setDraftDate("");setDraftTime("");setDraftRepeat("none");setDraftReminders([]);if(isMemberTab&&careMeta&&draftKind!=="other"){setDraft(careMeta.label);setDraftAuto(true);}else{setDraft("");setDraftAuto(false);}};
  const addMember=()=>{const name=newName.trim();if(!name)return;const id="f"+Date.now();const member={id,name,emoji:newEmoji,kind:newKind};if(newKind==="pet")member.species=newSpecies;persist([...members,member],items);setNewName("");setAdding(false);setTab(id);};
  const removeMember=(id)=>{const m=members.find(x=>x.id===id);persist(members.filter(x=>x.id!==id),items.filter(x=>x.space!==id));setTab("me");setConfirmDel(null);if(m)showFlash(`${m.name} を削除しました`);};
  const saveRename=(id)=>{const name=editName.trim();if(name)persist(members.map(m=>m.id===id?{...m,name}:m),items);setEditingId(null);};

  const visible=useMemo(()=>{let arr=items.filter(x=>x.space===tab);if(filter!=="all")arr=arr.filter(x=>isMemberTab?x.careKind===filter:x.type===filter);arr=[...arr].sort((a,b)=>{if(!a.dueDate&&!b.dueDate)return b.createdAt-a.createdAt;if(!a.dueDate)return 1;if(!b.dueDate)return -1;return a.dueDate.localeCompare(b.dueDate);});return arr.sort((a,b)=>a.done===b.done?0:a.done?1:-1);},[items,tab,filter,isMemberTab]);
  const filterChips=useMemo(()=>{const all={key:"all",label:"すべて"};if(isMemberTab)return[all,...careKindsFor(activeMember)];return[all,...ME_TYPES.map(t=>({key:t,label:TYPE_META[t].label}))];},[tab,isMemberTab]);
  const suggestions=useMemo(()=>{const prefix=tab+" ";return Object.entries(usage).filter(([k,c])=>k.startsWith(prefix)&&c>=2).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k])=>k.slice(prefix.length));},[usage,tab]);
  const meItems=items.filter(x=>x.space==="me");
  const doneCount=meItems.filter(x=>x.done).length;
  const pct=meItems.length?Math.round((doneCount/meItems.length)*100):0;
  const memberStats=useMemo(()=>{if(!isMemberTab)return null;const arr=items.filter(x=>x.space===tab);let soon=0,over=0;arr.forEach(x=>{const d=daysUntil(x.dueDate);if(d===null)return;if(d<0)over++;else if(d<=7)soon++;});return{soon,over};},[items,tab,isMemberTab]);
  const emojiSet=newKind==="person"?PERSON_EMOJIS:PET_EMOJIS;
  const spaces=useMemo(()=>[{id:"me",name:"わたし",emoji:"🙂",kind:"me"},...members],[members]);
  const statusFor=(spaceId)=>{const arr=items.filter(x=>x.space===spaceId&&!x.done&&x.dueDate);let over=0,next=null,nextDays=Infinity;arr.forEach(x=>{const d=daysUntil(x.dueDate);if(d<0)over++;else if(d<nextDays){nextDays=d;next=x;}});return{over,next,nextDays};};
  const todayList=useMemo(()=>items.filter(x=>!x.done&&x.dueDate&&daysUntil(x.dueDate)<=0).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)),[items]);
  const summary=useMemo(()=>({dreams:items.filter(x=>x.type==="dream"&&x.done).length,careOverdue:items.filter(x=>x.type==="care"&&!x.done&&x.dueDate&&daysUntil(x.dueDate)<0).length,family:members.length}),[items,members]);
  const nameOf=(spaceId)=>spaceId==="me"?"わたし":(members.find(m=>m.id===spaceId)||{}).name||"";

  return(
    <div className="yl-root">
      {onboarding&&(
        <div className="yl-ob">
          {obStep===0&&<div className="yl-ob-inner"><div className="yl-ob-emoji">🏠</div><h1 className="yl-ob-title">わたしと、大切な家族を、ひとつの場所で。</h1><p className="yl-ob-sub">家族みんなの"状態"が、ひと目でわかる。</p><button className="yl-ob-btn" onClick={()=>setObStep(1)}>はじめる</button><button className="yl-ob-link" onClick={loadSample}>サンプルで試してみる</button></div>}
          {obStep===1&&<div className="yl-ob-inner"><p className="yl-ob-step">1 / 2</p><h2 className="yl-ob-h2">まず、あなたの「やりたいこと」を1つ</h2><p className="yl-ob-sub">あとから、いつでも追加できます</p><div className="yl-ob-chips">{["旅行に行く","資格をとる","カフェ巡り","運動を習慣に"].map(ex=><button key={ex} className="yl-ob-chip" onClick={()=>setObWish(ex)}>{ex}</button>)}</div><input className="yl-input" value={obWish} onChange={e=>setObWish(e.target.value)} onKeyDown={e=>e.key==="Enter"&&setObStep(2)} placeholder="やりたいこと…" autoFocus/><button className="yl-ob-btn" onClick={()=>setObStep(2)}>次へ</button><button className="yl-ob-link" onClick={()=>{setObWish("");setObStep(2);}}>スキップ</button></div>}
          {obStep===2&&<div className="yl-ob-inner"><p className="yl-ob-step">2 / 2</p><h2 className="yl-ob-h2">一緒に見守りたい家族はいますか？</h2>{!obKind?<div className="yl-ob-choices"><button className="yl-ob-choice" onClick={()=>{setObKind("pet");setObEmoji(PET_EMOJIS[0]);}}>🐶 ペット</button><button className="yl-ob-choice" onClick={()=>{setObKind("person");setObEmoji(PERSON_EMOJIS[0]);}}>👧 家族（人）</button><button className="yl-ob-link" onClick={finishOnboarding}>今は追加しない</button></div>:<div className="yl-ob-form">{obKind==="pet"&&<div className="yl-kindrow">{SPECIES.map(s=><button key={s.key} className={"yl-kindbtn sm"+(obSpecies===s.key?" on":"")} onClick={()=>{setObSpecies(s.key);setObEmoji(s.emoji);}}>{s.emoji} {s.label}</button>)}</div>}<div className="yl-emoji-row">{(obKind==="person"?PERSON_EMOJIS:PET_EMOJIS).map(e=><button key={e} className={"yl-emoji"+(obEmoji===e?" on":"")} onClick={()=>setObEmoji(e)}>{e}</button>)}</div><input className="yl-input" value={obName} onChange={e=>setObName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&finishOnboarding()} placeholder={obKind==="person"?"名前（例：ゆうと）":"名前（例：ロア）"} autoFocus/><button className="yl-ob-btn" onClick={finishOnboarding}>はじめる</button><button className="yl-ob-link" onClick={()=>setObKind(null)}>戻る</button></div>}</div>}
        </div>
      )}
      <div className="yl-wrap">
        <header className="yl-head"><h1 className="yl-title">わたしと家族のリスト</h1></header>
        <nav className="yl-tabs">
          <button className={"yl-tab"+(tab==="home"?" on":"")} onClick={()=>setTab("home")}>ホーム</button>
          <button className={"yl-tab"+(tab==="me"?" on":"")} onClick={()=>setTab("me")}>わたし</button>
          {members.map(m=><button key={m.id} className={"yl-tab"+(tab===m.id?" on":"")} onClick={()=>setTab(m.id)}>{m.emoji} {m.name}</button>)}
          <button className="yl-tab add" onClick={()=>setAdding(v=>!v)}>＋追加</button>
        </nav>
        {adding&&<div className="yl-petform"><div className="yl-kindrow"><button className={"yl-kindbtn"+(newKind==="pet"?" on":"")} onClick={()=>{setNewKind("pet");setNewEmoji(PET_EMOJIS[0]);}}>🐶 ペット</button><button className={"yl-kindbtn"+(newKind==="person"?" on":"")} onClick={()=>{setNewKind("person");setNewEmoji(PERSON_EMOJIS[0]);}}>👤 家族（人）</button></div>{newKind==="pet"&&<div className="yl-kindrow">{SPECIES.map(s=><button key={s.key} className={"yl-kindbtn sm"+(newSpecies===s.key?" on":"")} onClick={()=>{setNewSpecies(s.key);setNewEmoji(s.emoji);}}>{s.emoji} {s.label}</button>)}</div>}<div className="yl-emoji-row">{emojiSet.map(e=><button key={e} className={"yl-emoji"+(newEmoji===e?" on":"")} onClick={()=>setNewEmoji(e)}>{e}</button>)}</div><div className="yl-petform-row"><input className="yl-input" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMember()} placeholder={newKind==="person"?"名前（例：ゆうと）":"名前（例：ロア）"}/><button className="yl-addbtn" onClick={addMember}>登録</button></div></div>}
        {tab==="home"?(
          <div className="yl-home">
            {todayList.length===0?<section className="yl-hero"><div className="yl-hero-emoji">✨</div><p className="yl-hero-title">今日やることはありません</p><p className="yl-hero-sub">{members.some(m=>m.kind==="pet")?`${members.find(m=>m.kind==="pet").emoji} ${members.find(m=>m.kind==="pet").name}は今日も元気です`:"ゆっくり過ごせる一日を"}</p></section>:<section className="yl-today"><h2 className="yl-sec-title">今日のこと</h2>{todayList.map(it=>{const od=daysUntil(it.dueDate)<0;return<button key={it.id} className="yl-today-row" onClick={()=>setTab(it.space)}><span className="yl-today-emoji">{it.emoji||"•"}</span><span className="yl-today-body"><span className="yl-today-text">{it.title}</span><span className="yl-today-who">{nameOf(it.space)}{it.time?" ・ "+it.time:""}</span></span><span className={"yl-today-tag"+(od?" over":"")}>{od?"期限切れ":"今日"}</span></button>;})}</section>}
            <h2 className="yl-sec-title">みんなの状態</h2>
            <div className="yl-statusgrid">{spaces.map(s=>{const st=statusFor(s.id);let line,sub=null;if(st.over>0)line=`🔴 期限切れ ${st.over}件`;else if(st.next){line=s.kind==="pet"?"今日は安心して過ごせます":"順調です";sub=`次の予定：${st.next.title}・${st.nextDays===0?"今日":"あと"+st.nextDays+"日"}`;}else line=s.kind==="pet"?"今日も元気です":"予定はありません";return<button key={s.id} className={"yl-statuscard "+(st.over>0?"alert":"")} onClick={()=>setTab(s.id)}><span className="yl-status-emoji">{s.emoji}</span><span className="yl-status-body"><span className="yl-status-name">{s.name}</span><span className="yl-status-line">{line}</span>{sub&&<span className="yl-status-sub">{sub}</span>}</span><span className="yl-status-dot" style={{background:st.over>0?"#E5484D":"#2FC9A8"}}/></button>;})}</div>
            <section className="yl-summary"><h2 className="yl-sec-title light">これまでの見守り</h2><div className="yl-summary-row"><div className="yl-stat"><span className="yl-stat-n">{summary.dreams}</span><span className="yl-stat-l">叶えた夢</span></div><div className="yl-stat"><span className="yl-stat-n">{summary.careOverdue}</span><span className="yl-stat-l">ケアの取りこぼし</span></div><div className="yl-stat"><span className="yl-stat-n">{summary.family}</span><span className="yl-stat-l">見守る家族</span></div></div></section>
            <button className="yl-reset" onClick={resetApp}>⟳ サンプルを消して最初から</button>
          </div>
        ):(
          <>
            {!isMemberTab?<section className="yl-meter"><div className="yl-meter-top"><span className="yl-meter-label">わくわくメーター</span><span className="yl-meter-count">{doneCount} / {meItems.length}</span></div><div className="yl-bar"><div className="yl-fill" style={{width:pct+"%"}}/></div></section>:<section className="yl-petstatus"><div className="yl-petstatus-head">{editingId===activeMember.id?<div className="yl-rename"><input className="yl-input sm" value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&saveRename(activeMember.id)} autoFocus/><button className="yl-addbtn sm" onClick={()=>saveRename(activeMember.id)}>保存</button></div>:<span className="yl-petstatus-title" style={{color:KIND_STYLE[activeMember.kind].fg}}>{activeMember.emoji} {activeMember.name} の{KIND_STYLE[activeMember.kind].word}<button className="yl-icon" onClick={()=>{setEditingId(activeMember.id);setEditName(activeMember.name);}}>✏️</button></span>}</div><div className="yl-petstatus-chips"><span className="yl-pill soon">⏰ 近い {memberStats?.soon||0}</span><span className="yl-pill over">🔴 期限切れ {memberStats?.over||0}</span><button className="yl-pet-del" onClick={()=>setConfirmDel(activeMember)}>削除</button></div></section>}
            <div className="yl-addbox">{!isMemberTab?<div className="yl-typerow">{ME_TYPES.map(t=><button key={t} className={"yl-chip"+(draftType===t?" on":"")} style={draftType===t?{background:TYPE_META[t].fg,color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>setDraftType(t)}>{TYPE_META[t].emoji} {TYPE_META[t].label}</button>)}</div>:<div className="yl-typerow">{careKindsFor(activeMember).map(k=><button key={k.key} className={"yl-chip"+(draftKind===k.key?" on":"")} style={draftKind===k.key?{background:KIND_STYLE[activeMember.kind].fg,color:"#fff",borderColor:"transparent"}:undefined} onClick={()=>pickCareKind(k)}>{k.emoji} {k.label}</button>)}</div>}{suggestions.length>0&&<div className="yl-suggest"><span className="yl-suggest-label">よく使う</span><div className="yl-suggest-chips">{suggestions.map(s=><button key={s} className="yl-suggest-chip" onClick={()=>{setDraft(s);setDraftAuto(false);}}>{s}</button>)}</div></div>}<div className="yl-add"><input className="yl-input" value={draft} onChange={e=>{setDraft(e.target.value);setDraftAuto(false);}} onKeyDown={e=>e.key==="Enter"&&addItem()} placeholder={isMemberTab?(draftKind==="other"?"内容を入力…":`${(careKindsFor(activeMember).find(k=>k.key===draftKind)||{}).label||"内容"}を追加…`):`${TYPE_META[draftType].label}を追加…`}/><button className="yl-addbtn" onClick={addItem}>追加</button></div><div className="yl-optrow"><label className="yl-opt">期限<input type="date" className="yl-date" value={draftDate} onChange={e=>setDraftDate(e.target.value)}/></label><label className="yl-opt">時間<input type="time" className="yl-date" value={draftTime} onChange={e=>setDraftTime(e.target.value)}/></label><label className="yl-opt">繰り返し<select className="yl-select" value={draftRepeat} onChange={e=>setDraftRepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div><div className="yl-notify"><span className="yl-notify-label">🔔 通知（任意・複数OK）</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(draftReminders.includes(o.key)?" on":"")} onClick={()=>toggleReminder(o.key)}>{o.label}</button>)}</div></div></div>
            <div className="yl-sort">{filterChips.map(f=><button key={f.key} className={"yl-sortbtn"+(filter===f.key?" on":"")} onClick={()=>setFilter(f.key)}>{f.emoji?f.emoji+" ":""}{f.label}</button>)}</div>
            {!loaded?<p className="yl-loading">よみこみ中…</p>:visible.length===0?<p className="yl-empty">まだありません。上のフォームから追加できます。</p>:<ul className="yl-list">{visible.map(it=>{let meta,label;if(isMemberTab){meta=KIND_STYLE[activeMember.kind];label=(careKindsFor(activeMember).find(k=>k.key===it.careKind)||{}).label||"ケア";}else{meta=TYPE_META[it.type]||TYPE_META.dream;label=meta.label;}const ds=dueStatus(it);return<li key={it.id} className={"yl-card"+(it.done?" is-done":"")}><button className="yl-bubble" style={{background:meta.bg,color:meta.fg}} onClick={()=>setPickerId(it.id)}>{it.emoji}</button><div className="yl-body" onClick={()=>openEdit(it)}><div className="yl-row1"><span className="yl-badge" style={{background:meta.bg,color:meta.fg}}>{label}</span><span className="yl-text">{it.title}</span></div>{(ds||it.time||it.reminders||it.type==="care"||(it.repeat&&it.repeat!=="none"))&&<div className="yl-meta">{ds&&<span className={"yl-due "+ds.tone}>{ds.label}</span>}{it.time&&<span className="yl-time">🕐 {it.time}</span>}{it.repeat&&it.repeat!=="none"&&<span className="yl-repeat">🔁 {REPEATS.find(r=>r.key===it.repeat)?.label}</span>}{it.reminders&&it.reminders.length>0&&<span className="yl-notif">🔔 {it.reminders.length<=2?it.reminders.map(reminderLabel).join("・"):it.reminders.length+"件"}</span>}{!it.done&&it.dueDate&&daysUntil(it.dueDate)<=0&&<button className="yl-snooze" onClick={e=>{e.stopPropagation();snooze(it.id);}}>→ 明日へ</button>}{it.type==="care"&&(it.photo?<button className="yl-photo" onClick={e=>{e.stopPropagation();viewPhoto(it.id);}}>📷 証明書</button>:<label className="yl-photo add" onClick={e=>e.stopPropagation()}>📎 証明書を追加<input type="file" accept="image/*" style={{display:"none"}} onChange={e=>onFilePicked(e,it.id)}/></label>)}</div>}</div><button className={"yl-check"+(it.done?" on":"")} onClick={()=>toggle(it.id)}><svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg></button><button className="yl-del" onClick={()=>remove(it.id)}>×</button></li>})}</ul>}
          </>
        )}
        <p className="yl-foot">試作版・データはこの端末に保存されます</p>
      </div>
      {editItemId&&<div className="yl-overlay" onClick={()=>setEditItemId(null)}><div className="yl-modal edit" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">編集</h3><input className="yl-input" value={eTitle} onChange={e=>setETitle(e.target.value)} placeholder="タイトル"/><div className="yl-optrow"><label className="yl-opt">期限<input type="date" className="yl-date" value={eDate} onChange={e=>setEDate(e.target.value)}/></label><label className="yl-opt">時間<input type="time" className="yl-date" value={eTime} onChange={e=>setETime(e.target.value)}/></label><label className="yl-opt">繰り返し<select className="yl-select" value={eRepeat} onChange={e=>setERepeat(e.target.value)}>{REPEATS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label></div><div className="yl-notify"><span className="yl-notify-label">🔔 通知</span><div className="yl-notify-chips">{REMINDER_OPTS.map(o=><button key={o.key} className={"yl-nchip"+(eReminders.includes(o.key)?" on":"")} onClick={()=>toggleEReminder(o.key)}>{o.label}</button>)}</div></div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEditItemId(null)}>閉じる</button><button className="yl-addbtn modal" onClick={saveEdit}>保存</button></div></div></div>}
      {viewer&&<div className="yl-overlay" onClick={()=>setViewer(null)}><div className="yl-modal photo" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">証明書</h3>{viewer.loading?<p className="yl-loading">読み込み中…</p>:viewer.src?<img className="yl-photo-img" src={viewer.src} alt="証明書"/>:<p className="yl-empty">画像が見つかりませんでした</p>}<div className="yl-modal-btns">{viewer.src&&<button className="yl-modal-cancel" onClick={()=>removePhoto(viewer.id)}>削除</button>}<button className="yl-modal-cancel" onClick={()=>setViewer(null)}>閉じる</button></div></div></div>}
      {pickerId&&<div className="yl-overlay" onClick={()=>setPickerId(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><h3 className="yl-modal-title">絵文字を選ぶ</h3><div className="yl-emoji-grid">{PICKER_EMOJIS.map(e=><button key={e} className="yl-emoji-pick" onClick={()=>setEmoji(pickerId,e)}>{e}</button>)}</div><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setEmoji(pickerId,"")}>絵文字なし</button><button className="yl-modal-cancel" onClick={()=>setPickerId(null)}>閉じる</button></div></div></div>}
      {confirmDel&&<div className="yl-overlay" onClick={()=>setConfirmDel(null)}><div className="yl-modal" onClick={e=>e.stopPropagation()}><div className="yl-modal-emoji">{confirmDel.emoji}</div><h3 className="yl-modal-title">{confirmDel.name} を削除しますか？</h3><p className="yl-modal-body">{(()=>{const n=items.filter(x=>x.space===confirmDel.id).length;return n>0?`${confirmDel.name}のケア（${n}件）も一緒に消えます。この操作は元に戻せません。`:"この操作は元に戻せません。";})()}</p><div className="yl-modal-btns"><button className="yl-modal-cancel" onClick={()=>setConfirmDel(null)}>キャンセル</button><button className="yl-modal-del" onClick={()=>removeMember(confirmDel.id)}>削除する</button></div></div></div>}
      {flash&&<div className="yl-flash">{flash}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App/>);
