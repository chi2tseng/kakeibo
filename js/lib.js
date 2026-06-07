/* =========================================================================
   lib.js — config, fetch, parse & money math (pure logic) · v2
   ========================================================================= */
'use strict';

const CONFIG = {
  sheetId: '1e_0xtMLKy9EmZS8VU6kVHscXl0YzLMcbH_4Wfd5EzYc',
  currency: '¥',
  excludeCats: ['初期費用', '語言學校'],
  togetherLabel: '一起',
};
CONFIG.csvUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/export?format=csv`;
CONFIG.sheetUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/edit`;

/* category -> Material Symbols Rounded icon name (monochrome, no colours) */
const CAT_ICON = {
  '食物':'restaurant', '房租':'home', '日常':'shopping_basket', '語言學校':'school',
  '初期費用':'inventory_2', '通訊':'smartphone', '娛樂':'sports_esports', '交通':'tram',
  '居住':'chair', '電':'bolt', '水':'water_drop', '國民健保':'health_and_safety',
  '醫療':'medication', '購物':'shopping_bag', '旅遊':'flight', '禮物':'redeem',
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
  const commonByPerson={},personalByPerson={},catByPerson={},paidByPerson={},payerCat={};
  people.forEach(p=>{commonByPerson[p]=0;personalByPerson[p]=0;catByPerson[p]={};paidByPerson[p]=0;payerCat[p]={};});
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
      if(t.payer===TOG){ const sh=t.amt/people.length; people.forEach(p=>commonByPerson[p]+=sh); }
      else if(commonByPerson[t.payer]!=null) commonByPerson[t.payer]+=t.amt;
      else { const sh=t.amt/people.length; people.forEach(p=>commonByPerson[p]+=sh); }
    }
  }
  const fairShare=people.length?totalCommon/people.length:0;
  const balance={}; people.forEach(p=>balance[p]=(commonByPerson[p]||0)-fairShare);
  const settlements=minCashFlow(balance);

  return {people,total,totalCommon,totalPersonal,byCat,byMonth,byMethod,catCount,
    commonByPerson,personalByPerson,catByPerson,paidByPerson,payerCat,
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
