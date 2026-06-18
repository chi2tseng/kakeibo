/* =========================================================================
   lib.js — config, fetch, parse & money math (pure logic) · v2
   ========================================================================= */
'use strict';

const CONFIG = {
  sheetId: '1e_0xtMLKy9EmZS8VU6kVHscXl0YzLMcbH_4Wfd5EzYc',
  currency: '¥',
  excludeCats: ['初期費用', '語言學校'],   // 「排除大筆」開關用：一次性大筆
  // 固定費：金額固定/預先決定、無法反映花費行為的支出 → 預估比較時排除，只比變動花費才有意義
  fixedCats: ['房租', '語言學校', '初期費用', '通訊', '國民健保', '保險', '管理費', '訂閱', '網路', '學費', '分期'],
  togetherLabel: '一起',
};
CONFIG.csvUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/export?format=csv`;
CONFIG.sheetUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/edit`;

/* category -> Material Symbols Rounded icon name (monochrome, no colours) */
const CAT_ICON = {
  '食物':'restaurant', '房租':'home', '日常':'shopping_basket', '語言學校':'school',
  '初期費用':'inventory_2', '通訊':'smartphone', '娛樂':'sports_esports', '交通':'tram',
  '居住':'chair', '電':'bolt', '水':'water_drop', '瓦斯':'gas_meter', '國民健保':'health_and_safety',
  '醫療':'medication', '保險':'shield', '購物':'shopping_bag', '旅遊':'flight', '禮物':'redeem',
  '美容':'content_cut', '衣服':'apparel', '寵物':'pets', '教育':'school',
};
function catIcon(name){ return CAT_ICON[name] || 'sell'; }

/* cohesive green→sage→neutral scale for charts (NO rainbow) */
const CHART_SCALE = ['#163300','#2f5d22','#4e8c33','#74b84b','#9fe870','#bfe4a1','#8a9282','#aab0a1','#c8ccc0','#dde0d6','#5b5d57','#e8ebe4'];
function chartColors(n){ const out=[]; for(let i=0;i<n;i++) out.push(CHART_SCALE[i % CHART_SCALE.length]); return out; }
const PERSON_CHART = ['#163300', '#9fe870', '#74b84b', '#bfe4a1']; // forest vs lime (on-brand)

/* formatting */
function fmt(n){ return Math.round(n).toLocaleString('en-US'); }
function fmtY(n){ return CONFIG.currency + fmt(n); }

/* parsing */
function parseAmount(s){
  if(s==null) return 0;
  if(typeof s==='number') return s;
  const c=String(s).replace(/[^0-9.\-]/g,'');
  return (c===''||c==='-'||c==='.')?0:(parseFloat(c)||0);
}
function parseDate(s){
  if(!s) return null;
  const m=String(s).trim().match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if(!m) return null;
  const y=+m[1],mo=+m[2],d=+m[3];
  return {y,m:mo,d,ym:`${y}-${String(mo).padStart(2,'0')}`,iso:`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`,sort:y*10000+mo*100+d};
}

/* date helpers — month length & elapsed days (for fair pace comparison) */
function monthDays(ym){ const [y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate(); }
function isCurrentMonth(ym){ const t=new Date(); const [y,m]=ym.split('-').map(Number); return y===t.getFullYear() && m===t.getMonth()+1; }
function elapsedDays(ym){ return isCurrentMonth(ym) ? Math.max(1,new Date().getDate()) : monthDays(ym); }

/* fetch + parse */
async function fetchTransactions(){
  const res=await fetch(CONFIG.csvUrl+'&_='+Date.now(),{cache:'no-store'});
  if(!res.ok) throw new Error('HTTP '+res.status);
  const rows=Papa.parse(await res.text(),{skipEmptyLines:'greedy'}).data;
  const tx=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i]; if(!r) continue;
    const cat=(r[0]||'').trim(), amtRaw=r[2];
    if(!cat||amtRaw==null||String(amtRaw).trim()==='') continue;
    const amt=parseAmount(amtRaw); if(!amt) continue;
    tx.push({cat,date:parseDate(r[1]),amt,desc:(r[3]||'').trim(),method:(r[4]||'').trim(),payer:(r[5]||'').trim(),kind:(r[6]||'').trim()});
  }
  tx.sort((a,b)=>(a.date?.sort||0)-(b.date?.sort||0));
  return tx;
}

function derivePeople(tx){
  const seen=[];
  for(const t of tx) if(t.payer && t.payer!==CONFIG.togetherLabel && !seen.includes(t.payer)) seen.push(t.payer);
  return seen;
}
function deriveMonths(tx){
  const s=new Set(); for(const t of tx) if(t.date) s.add(t.date.ym);
  return [...s].sort();
}
function applyFilters(tx,{period='all',exclude=false}={}){
  return tx.filter(t=>{
    if(period!=='all' && (!t.date||t.date.ym!==period)) return false;
    if(exclude && CONFIG.excludeCats.includes(t.cat)) return false;
    return true;
  });
}

/* =========================================================================
   compute — all figures from a working set
   ========================================================================= */
function compute(tx,people){
  people=people&&people.length?people:derivePeople(tx);
  const TOG=CONFIG.togetherLabel;
  let total=0,totalCommon=0,totalPersonal=0;
  const byCat={},byMonth={},byMethod={},catCount={};
  const commonByPerson={},personalByPerson={},catByPerson={},paidByPerson={},payerCat={},commonCatByPerson={};
  people.forEach(p=>{commonByPerson[p]=0;personalByPerson[p]=0;catByPerson[p]={};paidByPerson[p]=0;payerCat[p]={};commonCatByPerson[p]={};});
  let biggest=null;

  const addPayer=(p,cat,amt)=>{ if(paidByPerson[p]==null) return; paidByPerson[p]+=amt; payerCat[p][cat]=(payerCat[p][cat]||0)+amt; };

  for(const t of tx){
    total+=t.amt;
    byCat[t.cat]=(byCat[t.cat]||0)+t.amt;
    catCount[t.cat]=(catCount[t.cat]||0)+1;
    if(t.date) byMonth[t.date.ym]=(byMonth[t.date.ym]||0)+t.amt;
    if(t.method) byMethod[t.method]=(byMethod[t.method]||0)+t.amt;
    if(!biggest||t.amt>biggest.amt) biggest=t;

    // actual outlay by payer (一起 split equally) — "每個人花多少在哪裡"
    if(t.payer===TOG){ const sh=t.amt/people.length; people.forEach(p=>addPayer(p,t.cat,sh)); }
    else addPayer(t.payer,t.cat,t.amt);

    if(t.kind==='個人'){
      totalPersonal+=t.amt;
      if(personalByPerson[t.payer]!=null){ personalByPerson[t.payer]+=t.amt; catByPerson[t.payer][t.cat]=(catByPerson[t.payer][t.cat]||0)+t.amt; }
    } else {
      totalCommon+=t.amt;
      const addCommon=(p,amt)=>{ if(commonByPerson[p]==null) return; commonByPerson[p]+=amt; commonCatByPerson[p][t.cat]=(commonCatByPerson[p][t.cat]||0)+amt; };
      if(t.payer===TOG){ const sh=t.amt/people.length; people.forEach(p=>addCommon(p,sh)); }
      else if(commonByPerson[t.payer]!=null) addCommon(t.payer,t.amt);
      else { const sh=t.amt/people.length; people.forEach(p=>addCommon(p,sh)); }
    }
  }
  const fairShare=people.length?totalCommon/people.length:0;
  const balance={}; people.forEach(p=>balance[p]=(commonByPerson[p]||0)-fairShare);
  const settlements=minCashFlow(balance);

  return {people,total,totalCommon,totalPersonal,byCat,byMonth,byMethod,catCount,
    commonByPerson,personalByPerson,catByPerson,paidByPerson,payerCat,commonCatByPerson,
    fairShare,balance,settlements,biggest,count:tx.length};
}

function minCashFlow(balance){
  const cred=[],deb=[];
  for(const [p,v] of Object.entries(balance)){ if(v>0.5) cred.push({p,v}); else if(v<-0.5) deb.push({p,v:-v}); }
  cred.sort((a,b)=>b.v-a.v); deb.sort((a,b)=>b.v-a.v);
  const out=[]; let i=0,j=0;
  while(i<deb.length&&j<cred.length){
    const pay=Math.min(deb[i].v,cred[j].v);
    out.push({from:deb[i].p,to:cred[j].p,amount:pay});
    deb[i].v-=pay; cred[j].v-=pay;
    if(deb[i].v<0.5)i++; if(cred[j].v<0.5)j++;
  }
  return out;
}
function daySpan(tx){ const d=new Set(); for(const t of tx) if(t.date) d.add(t.date.iso); return d.size||1; }

/* =========================================================================
   保鮮估算 — 從交易品項說明抓生鮮、依「典型保存天數」估到期日
   ⚠ 只是粗估（買日 + 一般冷藏壽命），不是真的有效期限
   ========================================================================= */
/* 規則「由先到後」第一個命中的關鍵字決定分類；故順序避開撞字（先乳製品再肉類，
   才不會「牛乳」被當成「牛肉」） */
const SHELF_RULES = [
  // 特例覆蓋（要先攔）
  { group:'加工肉', days:7, icon:'lunch_dining', kw:['サラダチキン'] },
  // 熟食 / 即食 1 天
  { group:'熟食', days:1, icon:'fastfood', kw:['弁当','便當','便当','惣菜','おにぎり','飯糰','飯団','サンドイッチ','サンド','サラダ','唐揚げ','から揚げ','カラアゲ','炒飯','チャーハン','グラタン','コロッケ','メンチ','丼','弁當','總菜'] },
  // 生鮮海鮮 2 天
  { group:'海鮮', days:2, icon:'set_meal', kw:['刺身','生魚片','サシミ','寿司','壽司','握り','握壽司','サーモン','鮭','マグロ','鮪','えび','エビ','蝦','いか','イカ','たこ','タコ','さば','サバ','鯖','ホタテ','帆立','牡蠣','あさり','しらす','ぶり','ブリ','たい','鯛','魚介','海鮮','貝'] },
  // 加工肉 7 天（先於生肉，火腿培根不含生肉關鍵字但語意上歸這）
  { group:'加工肉', days:7, icon:'lunch_dining', kw:['ベーコン','ハム','ウインナー','ウィンナー','ソーセージ','香腸','培根','火腿','チョリソ'] },
  // 乳製品 8 天（先於肉類，避免「牛乳」撞「牛」）
  { group:'乳製品', days:8, icon:'local_drink', kw:['牛乳','牛奶','ミルク','ぎゅうにゅう','ギュウニュウ','ニュウギュウ','ヨーグルト','優格','ヨーグ','チーズ','起司','モッツァレラ','生クリーム','鮮奶油','純生','純乳脂','ラクノウ'] },
  // 生肉 3 天
  { group:'肉類', days:3, icon:'kebab_dining', kw:['牛肉','和牛','黒毛和牛','牛バラ','牛もも','ぎゅう肉','豚','ぶた','ブタ','ポーク','鶏','とり肉','とりにく','チキン','モモ肉','もも肉','モモニク','挽肉','ひき肉','絞肉','バラ','ロース','カルビ','ステーキ','火鍋肉','肉片','ラム','ささみ','手羽','ワカドリ','若鶏'] },
  // 豆製品 5 天
  { group:'豆製品', days:5, icon:'spa', kw:['豆腐','とうふ','トウフ','キヌ','木綿','納豆','なっとう','厚揚げ','油揚げ','がんも'] },
  // 麵包 4 天
  { group:'麵包', days:4, icon:'bakery_dining', kw:['食パン','トースト','マフィン','ベーグル','クロワッサン','ブレッド','ロールパン','メロンパン','バウム','デニッシュ','フランスパン','パン'] },
  // 易壞水果 4 天
  { group:'水果', days:4, icon:'nutrition', kw:['いちご','苺','あまおう','バナナ','ばなな','ぶどう','葡萄','ブルーベリー','メロン','すいか','西瓜','さくらんぼ','いちじく','マンゴー','桃'] },
  // 耐放水果 12 天
  { group:'水果', days:12, icon:'nutrition', kw:['りんご','林檎','サンふじ','ふじ','キウイ','みかん','オレンジ','レモン','檸檬','グレープフルーツ','なし','梨','柿'] },
  // 蔬菜 6 天
  { group:'蔬菜', days:6, icon:'eco', kw:['レタス','萵苣','キャベツ','高麗菜','きゅうり','キュウリ','胡瓜','小黃瓜','ズッキーニ','節瓜','玉ねぎ','玉葱','タマネギ','洋蔥','ねぎ','ネギ','青蔥','ニラ','韭','なす','茄','もやし','豆芽','にんにく','ニンニク','蒜','ほうれん','小松菜','ブロッコリー','きのこ','しめじ','えのき','まいたけ','マッシュルーム','しいたけ','菇','白菜','大根','にんじん','人参','紅蘿蔔','ピーマン','パプリカ','トマト','番茄','アボカド','かぼちゃ','ごぼう','れんこん','セロリ','リーフ'] },
  // 蛋 18 天
  { group:'蛋', days:18, icon:'egg', kw:['卵','たまご','玉子','赤たまご','エッグ'] },
];

/* 排除：含生鮮關鍵字但其實不是食物（玩具/雜貨…） */
const SHELF_BLOCK = ['たまごっち','タマゴッチ','びっくらたまご','びっくらタマゴ','フライパン','パンツ','パンプス','パンスト','ぱんつ','バナナクリップ','クレンジング','シャンプー','タオル','まな板','スポンジ'];
function matchShelf(seg){
  const s=seg.toLowerCase();
  for(const b of SHELF_BLOCK) if(s.includes(b.toLowerCase())) return null;
  for(const r of SHELF_RULES) for(const k of r.kw) if(s.includes(k.toLowerCase())) return r;
  return null;
}
function cleanItem(seg){
  let s=seg.replace(/[¥￥][\d,]+/g,'').replace(/\b\d[\d.,]*\b/g,'').replace(/[()（）]/g,'').trim();
  s=s.replace(/^(7p[gl]?|7プレミアム|7premium|lw[p]?|ff|pb|p\b)\s*/i,'').trim();
  return s.length>22 ? s.slice(0,22)+'…' : s;
}
function diffDays(date, today){ const a=new Date(date.y,date.m-1,date.d); const t0=new Date(today.getFullYear(),today.getMonth(),today.getDate()); return Math.round((t0-a)/86400000); }

/* 回傳「估算還在冰箱裡」的生鮮清單（依剩餘天數升冪）；today 預設今天 */
function estimateInventory(tx, today){
  today=today||new Date();
  const raw=[];
  for(const t of tx){
    if(!t.date) continue;
    const age=diffDays(t.date, today);
    if(age<-1 || age>45) continue;                 // 太久以前/未來太遠都跳過
    const segs=(t.desc||'').split(/[,，、()（）/]+|\s{1,}/).map(x=>x.trim()).filter(Boolean);
    if(!segs.length && t.cat) segs.push(t.cat);
    for(const seg of segs){
      const r=matchShelf(seg); if(!r) continue;
      let shelf=r.days;
      if(/冷凍|冷冻|frozen|アイス|氷|冰/.test(seg)) shelf=Math.max(shelf,60);  // 冷凍延長
      const left=shelf-age;
      if(left<-1) continue;                          // 過期 1 天以上 → 視為已吃掉/丟掉
      raw.push({ name:cleanItem(seg)||r.group, group:r.group, icon:r.icon, date:t.date, payer:t.payer, shelf, left });
    }
  }
  // 同品項只留最近一次採購（重買=補貨）
  const map={};
  for(const it of raw){ const k=it.group+'|'+it.name; if(!map[k]||it.date.sort>map[k].date.sort) map[k]=it; }
  return Object.values(map).sort((a,b)=>a.left-b.left || b.date.sort-a.date.sort);
}
function freshLevel(left){ return left<=1?'danger':(left<=3?'warn':'fresh'); }
function freshText(left){
  if(left<0) return `過期 ${-left} 天`;
  if(left===0) return '今天到期';
  if(left===1) return '明天到期';
  return `還剩 ${left} 天`;
}
