/* =========================================================================
   app.js — UI: routing, rendering, charts (v3 · app-grade)
   v3: hash routing / localStorage prefs / data cache (秒開) / PWA
       count-up 數字動畫 / 卡片進場 / 手機滑動換頁
       變動累計曲線 / 固定+變動堆疊月圖 / 月曆熱力圖 / 分類環比
   ========================================================================= */
'use strict';

const TABS = [
  { id:'overview', label:'總覽', icon:'dashboard' },
  { id:'settle',   label:'結算', icon:'swap_horiz' },
  { id:'category', label:'分類', icon:'donut_small' },
  { id:'split',    label:'分攤', icon:'group' },
  { id:'monthly',  label:'月份', icon:'bar_chart' },
  { id:'fresh',    label:'保鮮', icon:'kitchen' },
  { id:'list',     label:'明細', icon:'receipt_long' },
];

const S = {
  tx:[], people:[], months:[],
  tab:'overview', period:'all', exclude:true,   // 預設排除初期費用＋語言學校等大筆一次性支出
  search:'', fKinds:[], fCats:[], sortBy:'date', sortDir:'desc', splitView:'all',
  lastSync:null, loading:true, error:null, charts:[],
};

if(window.Chart){
  Chart.defaults.font.family="'Inter','Noto Sans TC','Noto Sans JP',system-ui,sans-serif";
  Chart.defaults.font.size=12;
  Chart.defaults.color='#5b5d57';
  Object.assign(Chart.defaults.plugins.tooltip,{backgroundColor:'#16170f',padding:10,cornerRadius:10,titleFont:{weight:'600',size:12},bodyFont:{size:12.5},displayColors:true,boxPadding:4});
}

/* ---------- persistence (prefs + data cache → instant open) ---------- */
const PREF_KEY='kakeibo.prefs', CACHE_KEY='kakeibo.cache';
function loadPrefs(){ try{ const p=JSON.parse(localStorage.getItem(PREF_KEY)||'{}'); ['exclude','splitView','sortBy','sortDir'].forEach(k=>{ if(p[k]!=null) S[k]=p[k]; }); }catch(e){} }
function savePrefs(){ try{ localStorage.setItem(PREF_KEY,JSON.stringify({exclude:S.exclude,splitView:S.splitView,sortBy:S.sortBy,sortDir:S.sortDir})); }catch(e){} }
function loadCache(){ try{ const c=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
  if(c&&Array.isArray(c.tx)&&c.tx.length){ S.tx=c.tx; S.people=derivePeople(c.tx); S.months=deriveMonths(c.tx); S.lastSync=c.t?new Date(c.t):null; S.loading=false; return true; } }catch(e){} return false; }
function saveCache(){ try{ localStorage.setItem(CACHE_KEY,JSON.stringify({t:S.lastSync?S.lastSync.getTime():Date.now(),tx:S.tx})); }catch(e){} }

/* ---------- helpers ---------- */
function ic(n,cls){ return `<span class="ms${cls?' '+cls:''}">${n}</span>`; }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function personBadge(p,i,lg){
  let style;
  if(i===1) style='background:#fff;color:#163300;box-shadow:0 1px 3px rgba(20,21,15,.16)';   // 乖：白底＋淡陰影（無邊框）
  else { const bg=PERSON_CHART[i]!=null?PERSON_CHART[i]:'#163300'; const dark=['#163300','#054d28','#2f5d22','#4e8c33'].includes(bg); style=`background:${bg};color:${dark?'#fff':'#163300'}`; }
  return `<span class="who${lg?' lg':''}" style="${style}">${esc(p[0])}</span>`; }
function personTag(p,i){ const av=personBadge(p,i); return p.length>1?`${av}<span>${esc(p)}</span>`:av; }
function pct(a,b){ return b?(a/b*100):0; }
function compact(n){ n=Math.abs(n); if(n>=1e6) return (n/1e6).toFixed(n>=1e7?0:1)+'M'; if(n>=1e3) return Math.round(n/1e3)+'k'; return ''+Math.round(n); }
function mLabel(ym){ return ym?(+ym.split('-')[1])+'月':''; }
function mLabelFull(ym){ if(!ym) return ''; const [y,m]=ym.split('-'); return `${y} 年 ${+m} 月`; }
function destroyCharts(){ S.charts.forEach(c=>{try{c.destroy()}catch(e){}}); S.charts=[]; }
function moneyTooltip(totalRef){ return {callbacks:{label(ctx){const v=ctx.parsed.y!=null?ctx.parsed.y:ctx.parsed;const tot=typeof totalRef==='function'?totalRef():totalRef;const p=tot?` · ${(v/tot*100).toFixed(1)}%`:'';const nm=ctx.label?ctx.label+': ':'';return `${nm}${fmtY(v)}${p}`;}}}; }
function setProgress(on){ const p=document.getElementById('progress'); if(p) p.classList.toggle('on',on); const rb=document.getElementById('refreshBtn'); if(rb) rb.classList.toggle('loading',on); }
/* count-up target：<span data-cnt="123" data-cur>¥123</span>（data-cur = 帶 ¥ 前綴） */
function cnt(n,withCur){ const v=Math.round(n); return withCur?`<span class="num" data-cnt="${v}" data-cur>${fmtY(v)}</span>`:`<span class="num" data-cnt="${v}">${fmt(v)}</span>`; }
function runCountUp(){
  if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('[data-cnt]').forEach(el=>{
    const target=+el.dataset.cnt; if(!isFinite(target)||target===0) return;
    const cur=el.dataset.cur!=null, t0=performance.now(), dur=620;
    (function step(now){ const t=Math.min(1,((now||performance.now())-t0)/dur), e=1-Math.pow(1-t,3);
      el.textContent=(cur?CONFIG.currency:'')+fmt(target*e);
      if(t<1) requestAnimationFrame(step); })(t0);
  });
}

/* ---------- boot ---------- */
async function boot(){
  loadPrefs();
  S.tab=tabFromHash();
  buildNav(); bindGlobal(); bindSwipe();
  if(loadCache()){ buildPeriod(); renderView(); renderSync(); loadData(false); } // 快取秒開，背景更新
  else await loadData(true);
  setInterval(()=>loadData(false),5*60*1000);
}
function dataSig(){ let s=0; for(const t of S.tx) s+=t.amt; return S.tx.length+'|'+Math.round(s); }
async function loadData(initial){
  setProgress(true);
  if(initial){ S.loading=true; renderView(); }
  const before=dataSig();
  try{
    const tx=await fetchTransactions();
    S.tx=tx; S.people=derivePeople(tx); S.months=deriveMonths(tx);
    S.error=null; S.lastSync=new Date(); saveCache();
  }catch(e){ S.error=e.message||String(e); console.error(e); }
  finally{
    S.loading=false;
    if(initial||dataSig()!==before){ buildPeriod(); buildNav(); renderView(); }  // 資料沒變就不重渲染（不打斷動畫、不閃爍）
    renderSync();
    setTimeout(()=>setProgress(false),550);
  }
}
function renderSync(){
  const el=document.getElementById('syncInfo'); if(!el) return;
  if(S.error&&S.tx.length){ el.innerHTML=`${ic('cloud_off')} 離線 · 顯示上次資料 · <a href="${CONFIG.sheetUrl}" target="_blank">原始表</a>`; return; }
  if(S.error){ el.innerHTML=`${ic('cloud_off')} 讀取失敗 · <a href="${CONFIG.sheetUrl}" target="_blank">開啟試算表</a>`; return; }
  if(!S.lastSync){ el.textContent=''; return; }
  const t=S.lastSync.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});
  el.innerHTML=`${ic('cloud_done')} 已同步 ${t} · <a href="${CONFIG.sheetUrl}" target="_blank">原始表</a>`;
}

/* ---------- controls + nav + routing ---------- */
function buildPeriod(){
  const w=document.getElementById('periodChips'); if(!w) return;
  let h=`<button class="chip ${S.period==='all'?'active':''}" data-period="all">全部</button>`;
  for(const m of S.months) h+=`<button class="chip ${S.period===m?'active':''}" data-period="${m}">${mLabel(m)}</button>`;
  w.innerHTML=h;
  w.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{S.period=b.dataset.period;buildPeriod();renderView();});
  document.getElementById('excludeChip').classList.toggle('on',S.exclude);
}
function buildNav(){
  const top=document.getElementById('topTabs'), bot=document.getElementById('bottomNav');
  const mk=t=>`<button data-tab="${t.id}" class="${S.tab===t.id?'active':''}">${ic(t.icon)}<span>${t.label}</span></button>`;
  if(top) top.innerHTML=TABS.map(mk).join('');
  if(bot) bot.innerHTML=TABS.map(mk).join('');
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>go(b.dataset.tab));
}
function bindGlobal(){
  document.getElementById('refreshBtn').onclick=()=>loadData(false);
  document.getElementById('excludeChip').onclick=()=>{S.exclude=!S.exclude;savePrefs();buildPeriod();renderView();};
  document.getElementById('homeBtn').onclick=()=>go('overview');
  window.addEventListener('hashchange',()=>{ const t=tabFromHash(); if(t!==S.tab){ S.tab=t; window.scrollTo({top:0}); buildNav(); renderView(); } });
}
function tabFromHash(){ const m=location.hash.match(/^#\/([a-z]+)/); return (m&&TABS.some(t=>t.id===m[1]))?m[1]:'overview'; }
/* 手機左右滑切換分頁（避開可橫向捲動的元件） */
function bindSwipe(){
  const el=document.querySelector('main'); if(!el) return; let st=null;
  el.addEventListener('touchstart',e=>{ const t=e.target.closest('.filters,.period-scroll,.month-pick,.chart-scroll,.seg,canvas,input,.search,.hm'); st=t?null:{x:e.touches[0].clientX,y:e.touches[0].clientY}; },{passive:true});
  el.addEventListener('touchend',e=>{ if(!st) return; const dx=e.changedTouches[0].clientX-st.x, dy=e.changedTouches[0].clientY-st.y; st=null;
    if(Math.abs(dx)>70&&Math.abs(dx)>2.5*Math.abs(dy)){ const i=TABS.findIndex(t=>t.id===S.tab); const n=dx<0?i+1:i-1; if(n>=0&&n<TABS.length) go(TABS[n].id); } },{passive:true});
}

/* ---------- router ---------- */
let lastAnimKey=null;
function renderView(){
  destroyCharts();
  const v=document.getElementById('view');
  if(S.loading){ v.innerHTML=skeleton(); return; }
  if(S.error&&!S.tx.length){ v.innerHTML=errorState(); return; }
  const work=applyFilters(S.tx,{period:S.period,exclude:S.exclude});
  const c=compute(work,S.people);
  const allWork=applyFilters(S.tx,{period:'all',exclude:S.exclude});
  const cAll=compute(allWork,S.people);
  const r=({overview:viewOverview,settle:viewSettle,category:viewCategory,split:viewSplit,monthly:viewMonthly,fresh:viewFresh,list:viewList})[S.tab](c,work,cAll,allWork);
  const [html,after]=Array.isArray(r)?r:[r,()=>{}];
  const key=S.tab+'|'+S.period+'|'+S.exclude+'|'+S.splitView;
  const animate=key!==lastAnimKey; lastAnimKey=key;   // 背景更新不重播動畫
  v.innerHTML=`<div class="view${animate?' anim':''}">${html}</div>`;
  (after||(()=>{}))();
  if(animate) runCountUp();
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===S.tab));
}
function periodName(){ return S.period==='all'?'全部期間':mLabelFull(S.period); }
function focusMonth(){ return S.period!=='all'?S.period:(S.months[S.months.length-1]||null); }

/* pace — 固定費（房租/學費等，金額預先決定）不反映花費行為 → 從比較排除；
   只比「變動花費」：本月按已過天數推估整月 vs 上月實際。 */
function pace(){
  const fm=focusMonth(); if(!fm) return null;
  const dim=monthDays(fm), days=elapsedDays(fm), current=isCurrentMonth(fm);
  const ONE=CONFIG.excludeCats;                                  // 一次性大筆（初期費用/語言學校）— 永不投影
  const FIXREC=CONFIG.fixedCats.filter(x=>!ONE.includes(x));     // 經常性固定（房租/通訊/健保…）— 每月重複
  const sumMonth=(ym)=>{ let total=0,one=0,fixedRec=0,vari=0;
    for(const t of S.tx){ if(!t.date||t.date.ym!==ym) continue; total+=t.amt;
      if(ONE.includes(t.cat)) one+=t.amt; else if(FIXREC.includes(t.cat)) fixedRec+=t.amt; else vari+=t.amt; }
    return {total,one,fixedRec,vari}; };
  const cur=sumMonth(fm);
  const idx=S.months.indexOf(fm), prevYm=idx>0?S.months[idx-1]:null;
  const prev=prevYm?sumMonth(prevYm):null;
  const varProj=current?(cur.vari/days)*dim:cur.vari;            // 變動：按已過天數配速
  const prevVar=prev?prev.vari:null;
  const varDelta=(prevVar&&prevVar>0)?(varProj-prevVar)/prevVar*100:null;
  const fixedEst=prev?Math.max(cur.fixedRec,prev.fixedRec):cur.fixedRec;  // 經常性固定：沿用上月
  const projTotal=varProj+fixedEst+cur.one;                      // 一次性：本月已發生的照實計，不投影
  return {fm,current,days,dim,total:cur.total,fixed:cur.fixedRec,one:cur.one,vari:cur.vari,
    varProj,prevVar,varDelta,fixedEst,projTotal,prevYm,prevTotal:prev?prev.total:null};
}
function deltaBadge(d){
  if(d==null) return '';
  const up=d>0.5,down=d<-0.5,cls=up?'up':(down?'down':'flat');
  const icn=up?'trending_up':(down?'trending_down':'trending_flat');
  return `<span class="delta ${cls}">${ic(icn)}${Math.abs(d).toFixed(0)}%</span>`;
}
/* 每月固定/變動拆分（堆疊圖用） */
function monthFixVar(allWork,months){
  return months.map(m=>{ let f=0,v=0;
    for(const t of allWork){ if(!t.date||t.date.ym!==m) continue;
      if(CONFIG.fixedCats.includes(t.cat)) f+=t.amt; else v+=t.amt; }
    return {f,v}; });
}
/* 某月變動花費的逐日累計（累計曲線用；固定費天生排除 → 不受排除開關影響） */
function cumVar(ym,limitDays){
  if(!ym) return null;
  const FIX=CONFIG.fixedCats, dim=monthDays(ym), arr=Array(dim).fill(0);
  for(const t of S.tx){ if(!t.date||t.date.ym!==ym||FIX.includes(t.cat)) continue; arr[t.date.d-1]+=t.amt; }
  let run=0; const out=arr.map(x=>run+=x);
  return limitDays?out.slice(0,limitDays):out;
}
/* 近 14 天變動花費 sparkline（hero 裝飾） */
function heroSpark(){
  const FIX=CONFIG.fixedCats, by={}; let maxD=null;
  for(const t of S.tx){ if(!t.date||FIX.includes(t.cat)) continue; by[t.date.iso]=(by[t.date.iso]||0)+t.amt; if(!maxD||t.date.sort>maxD.sort) maxD=t.date; }
  if(!maxD) return '';
  const days=[]; const base=new Date(maxD.y,maxD.m-1,maxD.d);
  for(let i=13;i>=0;i--){ const d=new Date(base); d.setDate(base.getDate()-i);
    days.push(by[`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`]||0); }
  const mx=Math.max(...days,1), h=30, bw=6, gap=3, w=14*(bw+gap)-gap;
  const bars=days.map((v,i)=>{ const bh=Math.max(3,Math.round(v/mx*h));
    return `<rect x="${i*(bw+gap)}" y="${h-bh}" width="${bw}" height="${bh}" rx="2" fill="rgba(159,232,112,${v?.95:.25})"/>`; }).join('');
  return `<div class="spark-wrap"><svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${bars}</svg><span>近 14 天變動</span></div>`;
}

/* =========================================================================
   Overview
   ========================================================================= */
function viewOverview(c,work,cAll){
  const st=c.settlements[0];
  const settle=st
    ? `<div class="metric" style="cursor:pointer" onclick="go('settle')">
         <div class="label">${ic('swap_horiz')} 目前結算</div>
         <div class="value">${cnt(st.amount,true)}</div>
         <div class="foot" style="display:flex;align-items:center;gap:7px">${personBadge(st.from,c.people.indexOf(st.from))}${ic('arrow_forward')}${personBadge(st.to,c.people.indexOf(st.to))}</div>
       </div>`
    : `<div class="metric"><div class="label">${ic('swap_horiz')} 目前結算</div><div class="value" style="color:var(--down);display:flex;align-items:center;gap:8px">${ic('check_circle','fill')} 已結清</div></div>`;

  const p=pace();
  const paceCard=p?`<div class="metric">
      <div class="label">${ic('calendar_month')} ${mLabel(p.fm)}${p.current?` · ${p.days}/${p.dim} 天`:''} ${p.current&&p.varDelta!=null?deltaBadge(p.varDelta):''}</div>
      <div class="value">${cnt(p.total,true)}</div>
      <div class="foot">變動 ${fmtY(p.current?p.varProj:p.vari)}${p.current?'（估）':''}${p.prevVar!=null?` · 上月變動 ${fmtY(p.prevVar)}`:''}</div>
      <div class="foot" style="font-size:11.5px">固定 ${fmtY(p.fixed)}${p.one>0?` ＋ 一次性 ${fmtY(p.one)}`:''}（不計入比較）</div>
    </div>`:'';

  // 變動累計曲線：本月 vs 上月（一眼看配速）
  const lineCard=(p&&p.fm)?`
    <div class="card">
      <div class="card-head"><h3>${ic('show_chart')} 變動花費累計</h3>
        <span class="legend-mini"><i style="background:#163300"></i>${mLabel(p.fm)}${p.prevYm?`<i style="background:#c2c6bc"></i>${mLabel(p.prevYm)}`:''}</span></div>
      <div class="chart line"><canvas id="cumLine"></canvas></div>
    </div>`:'';

  const cats=Object.entries(c.byCat).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxCat=cats.length?cats[0][1]:1;
  const catRows=cats.map(([n,a])=>`<div class="row"><div class="ico">${ic(catIcon(n))}</div>
    <div class="main"><div class="l1"><span class="name">${esc(n)}</span><span class="amt">${fmtY(a)}</span></div>
    <div class="bar"><i style="width:${pct(a,maxCat).toFixed(1)}%"></i></div></div></div>`).join('')||emptyRow();

  const recent=work.slice().reverse().slice(0,5).map(txRow).join('')||emptyRow();
  const heroLabel=S.period==='all'?'全部支出':mLabelFull(S.period)+' 支出';

  const html=`
    <div class="card dark hero">
      <div class="eyebrow">${heroLabel}</div>
      <div class="big num"><span class="cur">¥</span>${cnt(c.total)}</div>
      <div class="legs">
        <div><div class="l">共同</div><div class="v num">${fmtY(c.totalCommon)}</div></div>
        <div><div class="l">個人</div><div class="v num">${fmtY(c.totalPersonal)}</div></div>
        <div><div class="l">筆數</div><div class="v num">${c.count}</div></div>
        ${heroSpark()}
      </div>
    </div>
    ${freshAlertCard(estimateInventory(S.tx),true)}
    <div class="grid g-2">
      <div class="card green">${settle}</div>
      <div class="card">${paceCard}</div>
    </div>
    ${lineCard}
    <div class="grid g-2">
      <div class="card">
        <div class="card-head"><h3>${ic('donut_small')} 主要分類</h3><a class="link" onclick="go('category')">全部${ic('chevron_right')}</a></div>
        <div class="rows">${catRows}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${ic('lightbulb')} 洞察</h3></div>
        ${insights(c,work)}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>${ic('receipt_long')} 最近交易</h3><a class="link" onclick="go('list')">全部${ic('chevron_right')}</a></div>
      <div class="rows-tx">${recent}</div>
    </div>`;
  const after=()=>{
    if(!p||!p.fm) return;
    const ctx=document.getElementById('cumLine'); if(!ctx) return;
    const cur=cumVar(p.fm, p.current?p.days:null)||[];
    const prv=p.prevYm?(cumVar(p.prevYm)||[]):[];
    const len=Math.max(cur.length,prv.length,1);
    const labels=Array.from({length:len},(_,i)=>i+1);
    const ds=[];
    if(prv.length) ds.push({label:mLabel(p.prevYm),data:prv,borderColor:'#c2c6bc',borderDash:[5,4],borderWidth:2,pointRadius:0,pointHoverRadius:3,tension:.25,fill:false});
    ds.push({label:mLabel(p.fm),data:cur,borderColor:'#163300',backgroundColor:'rgba(159,232,112,.16)',borderWidth:2.4,pointRadius:0,pointHoverRadius:3,tension:.25,fill:true});
    S.charts.push(new Chart(ctx,{type:'line',
      data:{labels,datasets:ds},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
        scales:{y:{beginAtZero:true,ticks:{callback:v=>'¥'+compact(v),maxTicksLimit:5},grid:{color:'#eceee9'},border:{display:false}},
                x:{ticks:{maxTicksLimit:8},grid:{display:false},border:{display:false}}},
        plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>`${i[0].label} 日`,label:c2=>`${c2.dataset.label}: ${fmtY(c2.parsed.y)}`}}}}}));
  };
  return [html,after];
}
function insights(c,work){
  const out=[];
  const dated=(work||[]).filter(t=>t.date).slice().sort((a,b)=>b.date.sort-a.date.sort);
  const last=dated[0];
  if(last) out.push([catIcon(last.cat),`最近一筆 <b>${esc(last.desc||last.cat)}</b> · ${fmtY(last.amt)} · ${last.date.iso.slice(5)}`]);
  if(last){
    const d=new Date(last.date.y,last.date.m-1,last.date.d); d.setDate(d.getDate()-6);
    const lo=d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate();
    const r7=dated.filter(t=>t.date.sort>=lo), sum=r7.reduce((a,b)=>a+b.amt,0);
    out.push(['date_range',`近 7 天 <b>${fmtY(sum)}</b> · ${r7.length} 筆`]);
  }
  const cntMap={}; (work||[]).forEach(t=>cntMap[t.cat]=(cntMap[t.cat]||0)+1);
  const tf=Object.entries(cntMap).sort((a,b)=>b[1]-a[1])[0];
  if(tf) out.push(['repeat',`最常買 <b>${esc(tf[0])}</b> · ${tf[1]} 筆`]);
  const cats=Object.entries(c.byCat).sort((a,b)=>b[1]-a[1]);
  if(cats.length){ const [n,a]=cats[0]; out.push([catIcon(n),`最大開銷 <b>${esc(n)}</b> · ${fmtY(a)} · ${pct(a,c.total).toFixed(0)}%`]); }
  if(c.biggest) out.push(['local_fire_department',`最大單筆 <b>${esc(c.biggest.desc||c.biggest.cat)}</b> · ${fmtY(c.biggest.amt)}`]);
  const cash=c.byMethod['現金']||0; if(c.total) out.push(['account_balance_wallet',`現金 <b>${pct(cash,c.total).toFixed(0)}%</b> · 刷卡 <b>${(100-pct(cash,c.total)).toFixed(0)}%</b>`]);
  if(c.people.length===2){ const [a,b]=c.people; const d=(c.commonByPerson[a]||0)-(c.commonByPerson[b]||0); if(Math.abs(d)>1){ const more=d>0?a:b,less=d>0?b:a; out.push(['balance',`<b>${esc(more)}</b> 比 <b>${esc(less)}</b> 多墊 <b>${fmtY(Math.abs(d))}</b>`]); } }
  return out.slice(0,6).map(([i,t])=>`<div class="insight"><div class="ico sm">${ic(i)}</div><div class="tx2">${t}</div></div>`).join('');
}

/* =========================================================================
   Settlement
   ========================================================================= */
function viewSettle(c){
  const incl=compute(applyFilters(S.tx,{period:S.period,exclude:false}),S.people);
  const excl=compute(applyFilters(S.tx,{period:S.period,exclude:true}),S.people);
  const active=S.exclude?excl:incl;
  const st=active.settlements[0];

  let hero;
  if(!st){ hero=`<div class="settle zero">${ic('check_circle','fill')}<div class="cap" style="margin-top:8px">這段期間已結清</div></div>`; }
  else{
    hero=`<div class="settle">
      <div class="flow">
        <div class="who lg">${esc(st.from[0])}</div>
        <div class="ar">${ic('arrow_forward')}</div>
        <div class="who lg alt">${esc(st.to[0])}</div>
      </div>
      <div class="amt num"><span class="cur">¥</span>${cnt(st.amount)}</div>
      <div class="cap"><b>${esc(st.from)}</b> 要還給 <b>${esc(st.to)}</b></div>
    </div>`;
  }

  const maxC=Math.max(...active.people.map(p=>active.commonByPerson[p]||0),1);
  const bars=active.people.map((p,i)=>{
    const v=active.commonByPerson[p]||0,diff=v-active.fairShare;
    return `<div class="ctrack"><div class="top"><b>${personTag(p,i)}</b><span class="num">${fmtY(v)}</span></div>
      <div class="line"><i style="width:${pct(v,maxC)}%;background:${PERSON_CHART[i]}"></i></div>
      <div class="foot" style="margin-top:6px;font-size:12px;color:var(--mute)">${diff>=0?'多墊':'少墊'} ${fmtY(Math.abs(diff))}</div></div>`;
  }).join('');

  const personSpend=active.people.map((p,i)=>{
    const cats=Object.entries(active.payerCat[p]||{}).sort((a,b)=>b[1]-a[1]).slice(0,7);
    const mx=cats.length?cats[0][1]:1;
    const rows=cats.map(([n,a])=>`<div class="row"><div class="ico sm">${ic(catIcon(n))}</div>
      <div class="main"><div class="l1"><span class="name">${esc(n)}</span><span class="amt">${fmtY(a)}</span></div>
      <div class="bar thin"><i style="width:${pct(a,mx).toFixed(1)}%;background:${PERSON_CHART[i]}"></i></div></div></div>`).join('')||emptyRow();
    return `<div class="card">
      <div class="card-head"><h3>${personTag(p,i)} 花在哪</h3><span class="num" style="font-weight:700">${fmtY(active.paidByPerson[p]||0)}</span></div>
      <div class="rows">${rows}</div></div>`;
  }).join('');

  const html=`
    <div class="page-head"><h2>結算</h2><div class="sub">${periodName()}${S.exclude?' · 排除大筆':''}</div></div>
    <div class="card green">${hero}</div>
    <div class="card">
      <div class="card-head"><h3>${ic('account_balance_wallet')} 共同支出墊付</h3><span class="foot" style="font-size:12px;color:var(--mute)">每人應分攤 ${fmtY(active.fairShare)}</span></div>
      <div class="contrib">${bars}</div>
    </div>
    <div class="grid g-2">${personSpend}</div>`;
  return [html,()=>{}];
}

/* =========================================================================
   Category（特定月份時顯示 vs 上月環比）
   ========================================================================= */
function viewCategory(c){
  const cats=Object.entries(c.byCat).sort((a,b)=>b[1]-a[1]);
  if(!cats.length) return [`<div class="page-head"><h2>分類</h2></div><div class="card"><div class="empty">沒有資料</div></div>`];
  const labels=cats.map(x=>x[0]), data=cats.map(x=>x[1]), colors=chartColors(cats.length);
  // 環比：選了特定月份且有上月 → 每類 vs 上月
  let prevCat=null, prevYmLbl='';
  if(S.period!=='all'){
    const idx=S.months.indexOf(S.period), prevYm=idx>0?S.months[idx-1]:null;
    if(prevYm){ prevCat=compute(applyFilters(S.tx,{period:prevYm,exclude:S.exclude}),S.people).byCat; prevYmLbl=mLabel(prevYm); }
  }
  const legend=cats.map(([n,a],i)=>`<div class="lg"><span class="sw" style="background:${colors[i]}"></span><span class="nm">${esc(n)}</span><span class="vl num">${fmtY(a)}</span><span class="pc">${pct(a,c.total).toFixed(0)}%</span></div>`).join('');
  const mx=cats[0][1];
  const rank=cats.map(([n,a],i)=>{
    const pv=prevCat?prevCat[n]:null;
    const chip=(pv>0)?deltaBadge((a-pv)/pv*100):'';
    return `<div class="row"><div class="ico">${ic(catIcon(n))}</div>
    <div class="main"><div class="l1"><span class="name">${esc(n)}</span><span class="amt">${fmtY(a)}</span></div>
    <div class="sub"><span>${pct(a,c.total).toFixed(1)}%</span><span>${c.catCount[n]} 筆</span>${chip?`<span style="margin-left:auto">${chip}</span>`:''}</div>
    <div class="bar"><i style="width:${pct(a,mx).toFixed(1)}%;background:${colors[i]}"></i></div></div></div>`;
  }).join('');
  const html=`
    <div class="page-head"><h2>分類</h2><div class="sub">${periodName()} · ${fmtY(c.total)}${prevCat?` · 環比 vs ${prevYmLbl}`:''}</div></div>
    <div class="grid g-2">
      <div class="card">
        <div class="chart donut"><canvas id="catDonut"></canvas><div class="dc"><div><div class="l">${periodName()}</div><div class="v num">${fmtY(c.total)}</div></div></div></div>
        <div class="legend">${legend}</div>
      </div>
      <div class="card"><div class="card-head"><h3>${ic('leaderboard')} 排行</h3></div><div class="rows">${rank}</div></div>
    </div>`;
  const after=()=>{ const ctx=document.getElementById('catDonut'); if(ctx) S.charts.push(new Chart(ctx,{type:'doughnut',
    data:{labels,datasets:[{data,backgroundColor:colors,borderColor:'#fff',borderWidth:2,hoverOffset:6}]},
    options:{cutout:'72%',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:moneyTooltip(()=>c.total)}}})); };
  return [html,after];
}

/* =========================================================================
   Split (共同 / 個人)
   ========================================================================= */
function viewSplit(c){
  const people=c.people;
  const mode=S.splitView||'all';            // all | common | personal
  const showC=mode!=='personal', showP=mode!=='common';
  const mkRows=(entries,col)=>{ const mx=entries.length?entries[0][1]:1; return entries.map(([n,a])=>`<div class="row"><div class="ico sm">${ic(catIcon(n))}</div>
      <div class="main"><div class="l1"><span class="name">${esc(n)}</span><span class="amt">${fmtY(a)}</span></div>
      <div class="bar thin"><i style="width:${pct(a,mx).toFixed(1)}%;background:${col}"></i></div></div></div>`).join('')||emptyRow(); };
  const personCards=people.map((p,i)=>{
    const col=PERSON_CHART[i];
    const common=Object.entries(c.commonCatByPerson[p]||{}).sort((a,b)=>b[1]-a[1]);
    const personal=Object.entries(c.catByPerson[p]||{}).sort((a,b)=>b[1]-a[1]);
    const cTot=c.commonByPerson[p]||0, pTot=c.personalByPerson[p]||0;
    let inner='';
    if(showC) inner+=`<div class="subhead"><span>${ic('group')} 共同墊付</span><b>${fmtY(cTot)}</b></div><div class="rows">${mkRows(common,col)}</div>`;
    if(showP) inner+=`<div class="subhead"${showC?' style="margin-top:14px"':''}><span>${ic('person')} 個人</span><b>${fmtY(pTot)}</b></div><div class="rows">${mkRows(personal,col)}</div>`;
    return `<div class="card">
      <div class="card-head"><h3>${personTag(p,i)}</h3><span class="num" style="font-weight:700">${fmtY((showC?cTot:0)+(showP?pTot:0))}</span></div>
      ${inner}</div>`;
  }).join('');
  const maxC=Math.max(...people.map(p=>c.commonByPerson[p]||0),1);
  const commonBars=people.map((p,i)=>`<div class="ctrack"><div class="top"><b>${personTag(p,i)}</b><span class="num">${fmtY(c.commonByPerson[p]||0)}</span></div><div class="line"><i style="width:${pct(c.commonByPerson[p]||0,maxC)}%;background:${PERSON_CHART[i]}"></i></div></div>`).join('');
  const seg=`<div class="seg">${[['all','全部'],['common','共同'],['personal','個人']].map(([k,l])=>`<button class="${mode===k?'active':''}" onclick="setSplitView('${k}')">${l}</button>`).join('')}</div>`;
  const cCard=`<div class="card green"><div class="metric"><div class="label" style="color:var(--forest-2)">${ic('group')} 共同支出</div><div class="value">${cnt(c.totalCommon,true)}</div><div class="foot" style="color:var(--forest-2)">佔 ${pct(c.totalCommon,c.total).toFixed(0)}%</div></div></div>`;
  const pCard=`<div class="card dark"><div class="metric"><div class="label" style="color:rgba(255,255,255,.65)">${ic('person')} 個人支出</div><div class="value">${cnt(c.totalPersonal,true)}</div><div class="foot" style="color:rgba(255,255,255,.6)">佔 ${pct(c.totalPersonal,c.total).toFixed(0)}%</div></div></div>`;
  const barsCard=`<div class="card"><div class="card-head"><h3>${ic('account_balance_wallet')} 共同墊付</h3><span class="foot" style="font-size:12px;color:var(--mute)">「一起」付已平分</span></div><div class="contrib">${commonBars}</div></div>`;
  const html=`
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap"><div><h2>共同 / 個人</h2><div class="sub">${periodName()}${S.exclude?' · 排除大筆':''}</div></div>${seg}</div>
    <div class="grid ${showC&&showP?'g-2':''}">${showC?cCard:''}${showP?pCard:''}</div>
    ${mode==='all'
      ? `<div class="grid g-2"><div class="card"><div class="chart donut"><canvas id="splitDonut"></canvas><div class="dc"><div><div class="l">共同佔</div><div class="v num">${pct(c.totalCommon,c.total).toFixed(0)}%</div></div></div></div></div>${barsCard}</div>`
      : (showC?barsCard:'')}
    <div class="grid g-2">${personCards}</div>`;
  const after=()=>{ if(mode!=='all') return; const ctx=document.getElementById('splitDonut'); if(ctx) S.charts.push(new Chart(ctx,{type:'doughnut',
    data:{labels:['共同','個人'],datasets:[{data:[c.totalCommon,c.totalPersonal],backgroundColor:['#9fe870','#163300'],borderColor:'#fff',borderWidth:2,hoverOffset:6}]},
    options:{cutout:'72%',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:moneyTooltip(()=>c.total)}}})); };
  return [html,after];
}

/* =========================================================================
   Monthly — 固定+變動堆疊 + 月曆熱力圖
   ========================================================================= */
function heatmapHtml(fm,fmWork){
  if(!fm) return '';
  const dim=monthDays(fm), [y,mo]=fm.split('-').map(Number);
  const by={}; fmWork.forEach(t=>{ if(t.date) by[t.date.d]=(by[t.date.d]||0)+t.amt; });
  const first=new Date(y,mo-1,1).getDay();
  const mx=Math.max(...Object.values(by),1), smx=Math.sqrt(mx);
  const head=['日','一','二','三','四','五','六'].map(x=>`<div class="hm-h">${x}</div>`).join('');
  let cells=''; for(let i=0;i<first;i++) cells+='<div class="hm-c empty"></div>';
  for(let d=1;d<=dim;d++){
    const v=by[d]||0;
    const k=v?Math.min(4,Math.max(1,Math.ceil(Math.sqrt(v)/smx*4))):0;
    cells+=`<div class="hm-c l${k}" title="${fm}-${String(d).padStart(2,'0')}：${v?fmtY(v):'—'}"><span class="d">${d}</span>${v?`<span class="v">${compact(v)}</span>`:''}</div>`;
  }
  return `<div class="hm">${head}${cells}</div>`;
}
function viewMonthly(c,work,cAll,allWork){
  const months=S.months.slice(), labels=months.map(mLabel);
  const fm=focusMonth();
  const fmWork=applyFilters(S.tx,{period:fm,exclude:S.exclude}), fmC=compute(fmWork,S.people);
  const p=pace();
  const fv=monthFixVar(allWork,months);
  const fmCats=Object.entries(fmC.byCat).sort((a,b)=>b[1]-a[1]);
  const mx=fmCats.length?fmCats[0][1]:1;
  const detail=fmCats.map(([n,a])=>`<div class="row"><div class="ico sm">${ic(catIcon(n))}</div>
    <div class="main"><div class="l1"><span class="name">${esc(n)}</span><span class="amt">${fmtY(a)}</span></div>
    <div class="bar thin"><i style="width:${pct(a,mx).toFixed(1)}%"></i></div></div></div>`).join('')||emptyRow();
  const chips=months.map(m=>`<button class="chip ${fm===m?'active':''}" onclick="setPeriod('${m}')">${mLabel(m)}</button>`).join('');
  const html=`
    <div class="page-head"><h2>月份趨勢</h2><div class="sub">每月固定＋變動${S.exclude?' · 排除大筆':''}</div></div>
    <div class="card">
      <div class="card-head"><h3>${ic('bar_chart')} 每月支出</h3>
        <span class="legend-mini"><i style="background:#163300"></i>固定<i style="background:#9fe870"></i>變動</span></div>
      <div class="chart-scroll"><div class="chart bars" style="min-width:${Math.max(0,months.length*52)}px"><canvas id="monthBars"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>${ic('calendar_month')} ${mLabelFull(fm)} ${p&&p.current&&p.varDelta!=null?deltaBadge(p.varDelta):''}</h3></div>
      <div class="month-pick">${chips}</div>
      <div class="metric" style="margin-bottom:6px">
        <div class="value">${cnt(fmC.total,true)}</div>
        <div class="foot">${fmC.count} 筆 · 共同 ${fmtY(fmC.totalCommon)} / 個人 ${fmtY(fmC.totalPersonal)}${p&&p.prevTotal!=null&&p.fm===fm?` · 上月 ${fmtY(p.prevTotal)}`:''}${p&&p.current&&p.fm===fm?` · 估整月 ${fmtY(p.projTotal)}`:''}</div>
      </div>
      ${heatmapHtml(fm,fmWork)}
      <div class="rows">${detail}</div>
    </div>`;
  const after=()=>{ const ctx=document.getElementById('monthBars'); if(!ctx) return;
    S.charts.push(new Chart(ctx,{type:'bar',
      data:{labels,datasets:[
        {label:'固定',data:fv.map(x=>x.f),backgroundColor:months.map(m=>m===fm?'#163300':'rgba(22,51,0,.4)'),stack:'s',maxBarThickness:56,borderRadius:{topLeft:0,topRight:0,bottomLeft:8,bottomRight:8},borderSkipped:false},
        {label:'變動',data:fv.map(x=>x.v),backgroundColor:months.map(m=>m===fm?'#9fe870':'rgba(159,232,112,.45)'),stack:'s',maxBarThickness:56,borderRadius:{topLeft:8,topRight:8,bottomLeft:0,bottomRight:0},borderSkipped:false}]},
      options:{responsive:true,maintainAspectRatio:false,onClick:(e,el)=>{if(el.length)setPeriod(months[el[0].index]);},
        scales:{y:{stacked:true,beginAtZero:true,ticks:{callback:v=>'¥'+compact(v)},grid:{color:'#eceee9'},border:{display:false}},
                x:{stacked:true,grid:{display:false},border:{display:false}}},
        plugins:{legend:{display:false},tooltip:{callbacks:{
          label:c2=>`${c2.dataset.label}: ${fmtY(c2.parsed.y)}`,
          footer:items=>'合計 '+fmtY(items.reduce((a,b)=>a+b.parsed.y,0))}}}}}));
  };
  return [html,after];
}

/* =========================================================================
   保鮮 — 從品項估算生鮮保存期限、提示快壞掉
   ========================================================================= */
function freshItemRow(it){
  const lv=freshLevel(it.left), ratio=Math.max(0,Math.min(100,it.left/it.shelf*100));
  return `<div class="fresh-item lv-${lv}"><span class="fresh-dot"></span>
    <div class="fi-main">
      <div class="fi-l1"><span class="fi-name">${esc(it.name)}</span><span class="fi-days">${freshText(it.left)}</span></div>
      <div class="fresh-bar"><i style="width:${ratio.toFixed(0)}%"></i></div>
      <div class="fi-sub">${it.date.iso.slice(5)} 買 · 估 ${it.shelf} 天</div>
    </div></div>`;
}
function freshAlertCard(inv,compact){
  const urgent=inv.filter(x=>x.left<=(compact?2:3));
  if(!urgent.length) return compact?'':`<div class="card fresh-ok"><div class="fa-head ok">${ic('check_circle','fill')} 冰箱裡的生鮮都還新鮮</div></div>`;
  const rows=(compact?urgent.slice(0,4):urgent).map(it=>`<div class="fa-row lv-${freshLevel(it.left)}"><span class="fresh-dot"></span><span class="fa-nm">${esc(it.name)}</span><span class="fa-tag">${esc(it.group)}</span><span class="fa-d">${freshText(it.left)}</span></div>`).join('');
  const more=compact?`<div class="fa-more">${urgent.length>4?`還有 ${urgent.length-4} 樣 · `:''}查看保鮮${ic('chevron_right')}</div>`:'';
  return `<div class="card fresh-alert${compact?' tappable':''}"${compact?` onclick="go('fresh')"`:''}>
    <div class="fa-head">${ic('warning','fill')} ${urgent.length} 樣${compact?'快壞掉':'要快點吃'}</div>
    <div class="fa-list">${rows}</div>${more}</div>`;
}
function viewFresh(){
  const inv=estimateInventory(S.tx);
  if(!inv.length) return [`<div class="page-head"><h2>保鮮</h2><div class="sub">估算 ロピア 採購的生鮮保存期限</div></div>
    <div class="card"><div class="empty">${ic('kitchen')}<div style="margin-top:8px">最近沒有 ロピア 生鮮採購紀錄</div><div style="font-size:12px;margin-top:4px">在 ロピア 買菜後記下品項，這裡就會自動抓出生鮮並估算保存期限</div></div></div>`,()=>{}];
  const d=inv.filter(x=>x.left<=1).length, w=inv.filter(x=>x.left>1&&x.left<=3).length, f=inv.filter(x=>x.left>3).length;
  const groups={}; for(const it of inv) (groups[it.group]=groups[it.group]||[]).push(it);
  const groupCards=Object.entries(groups)
    .sort((a,b)=>Math.min(...a[1].map(x=>x.left))-Math.min(...b[1].map(x=>x.left)))
    .map(([g,items])=>`<div class="card"><div class="card-head"><h3>${ic(items[0].icon)} ${esc(g)} · ${items.length}</h3><span class="foot" style="font-size:12px;color:var(--mute)">最快 ${freshText(Math.min(...items.map(x=>x.left)))}</span></div>
      <div class="fresh-list">${items.map(freshItemRow).join('')}</div></div>`).join('');
  const html=`
    <div class="page-head"><h2>保鮮</h2><div class="sub">ロピア 採購 ${inv.length} 樣生鮮 · <span class="cdot danger"></span>${d} <span class="cdot warn"></span>${w} <span class="cdot fresh"></span>${f}</div></div>
    ${freshAlertCard(inv,false)}
    ${groupCards}
    <div class="card soft" style="font-size:12px;color:var(--mute);line-height:1.65;display:flex;gap:8px;align-items:flex-start">${ic('info')}<span>保存期限是依「購買日 ＋ 一般冷藏壽命」粗估，實際以包裝標示與保存狀況為準；只抓得到記在品項說明裡的生鮮（生肉/海鮮/蔬果/乳製品/麵包/熟食…）。</span></div>`;
  return [html,()=>{}];
}

/* =========================================================================
   List — sort + filter + search
   ========================================================================= */
function viewList(c,work){
  return [listShell(), mountList];
}
function listShell(){
  const cc=compute(applyFilters(S.tx,{period:S.period,exclude:S.exclude}));
  const cats=Object.keys(cc.byCat).sort((a,b)=>(cc.catCount[b]||0)-(cc.catCount[a]||0));
  const noFilter=!S.fKinds.length && !S.fCats.length;
  const allChip=`<button class="fchip ${noFilter?'active':''}" data-all="1">${ic('apps')}全部</button>`;
  const kindChips=[['共同','group'],['個人','person']].map(([k,i])=>`<button class="fchip kind ${S.fKinds.includes(k)?'active':''}" data-kind="${k}">${ic(i)}${k}</button>`).join('');
  const catChips=cats.map(k=>`<button class="fchip ${S.fCats.includes(k)?'active':''}" data-cat="${esc(k)}">${ic(catIcon(k))}${esc(k)}</button>`).join('');
  const sorts=[['date','日期','event'],['amount','金額','payments'],['cat','類型','category']];
  const sortBtns=sorts.map(([k,l,i])=>`<button class="${S.sortBy===k?'active':''}" data-sort="${k}">${ic(i)}${l}</button>`).join('');
  return `
    <div class="page-head"><h2>明細</h2></div>
    <div class="toolbar">
      <div class="search">${ic('search')}<input id="searchInput" placeholder="搜尋品項、店名、付款人" value="${esc(S.search)}"/></div>
      <div class="sortbar">
        <span class="lbl">排序</span>
        <div class="seg">${sortBtns}</div>
        <button class="iconbtn" id="dirBtn" title="排序方向" style="width:36px;height:36px">${ic(S.sortDir==='desc'?'arrow_downward':'arrow_upward')}</button>
      </div>
      <div class="filters kindrow">${allChip}${kindChips}</div>
      <div class="filters catrow">${catChips}</div>
    </div>
    <div id="listBody"></div>`;
}
function listRows(){
  let rows=applyFilters(S.tx,{period:S.period,exclude:S.exclude}).slice();
  if(S.fKinds.length) rows=rows.filter(t=>S.fKinds.includes(t.kind));
  if(S.fCats.length) rows=rows.filter(t=>S.fCats.includes(t.cat));
  if(S.search.trim()){ const q=S.search.trim().toLowerCase(); rows=rows.filter(t=>(t.desc+t.cat+t.payer+t.method).toLowerCase().includes(q)); }
  const dir=S.sortDir==='desc'?-1:1;
  rows.sort((a,b)=>{
    let r=0;
    if(S.sortBy==='amount') r=a.amt-b.amt;
    else if(S.sortBy==='cat') r=a.cat.localeCompare(b.cat)|| (a.date?.sort||0)-(b.date?.sort||0);
    else r=(a.date?.sort||0)-(b.date?.sort||0);
    return r*dir;
  });
  const sum=rows.reduce((a,b)=>a+b.amt,0);
  let body;
  if(S.sortBy==='date'){
    const g={}; for(const t of rows){ const k=t.date?t.date.iso:'—'; (g[k]=g[k]||[]).push(t); }
    const groups=Object.entries(g).map(([day,ts])=>`<div class="daygroup"><div class="dayhead"><span class="d">${day}</span><span class="t num">${fmtY(ts.reduce((a,b)=>a+b.amt,0))}</span></div>${ts.map(txRow).join('')}</div>`).join('');
    body=`<div class="card pad-sm">${groups||emptyRow()}</div>`;
  } else {
    body=`<div class="card pad-sm">${rows.map(t=>txRow(t,true)).join('')||emptyRow()}</div>`;
  }
  return `<div class="sub" style="color:var(--mute);font-size:13px;margin:4px 2px 8px">${rows.length} 筆 · ${fmtY(sum)}</div>${paymentSummary(rows)}${body||`<div class="card"><div class="empty">找不到符合的交易</div></div>`}`;
}
const PAY_META={'現金':{ic:'payments',c:'#9fe870'},'信用卡':{ic:'credit_card',c:'#163300'},'SUICA':{ic:'contactless',c:'#74b84b'},'銀行轉帳':{ic:'account_balance',c:'#8a9282'},'轉帳':{ic:'account_balance',c:'#8a9282'},'電子支付':{ic:'qr_code_2',c:'#bfe4a1'}};
function payMeta(m){ return PAY_META[m]||{ic:'more_horiz',c:'#c2c6bc'}; }
function paymentSummary(rows){
  const by={}; let total=0;
  for(const t of rows){ const m=t.method||'其他'; by[m]=(by[m]||0)+t.amt; total+=t.amt; }
  if(!total) return '';
  const order=Object.entries(by).sort((a,b)=>b[1]-a[1]);
  const segs=order.map(([m,v])=>{ const md=payMeta(m); return `<i style="width:${pct(v,total)}%;background:${md.c}" title="${esc(m)} ${fmtY(v)}"></i>`; }).join('');
  const list=order.map(([m,v])=>{ const md=payMeta(m); return `<div class="pay-row"><span class="pay-ic" style="color:${md.c}">${ic(md.ic,'fill')}</span><span class="pay-nm">${esc(m)}</span><span class="pay-vl num">${fmtY(v)}</span><span class="pay-pc">${pct(v,total).toFixed(0)}%</span></div>`; }).join('');
  return `<div class="card pad-sm pay-card">
    <div class="card-head" style="margin-bottom:10px"><h3>${ic('account_balance_wallet')} 付款方式</h3><span class="num" style="font-weight:700">${fmtY(total)}</span></div>
    <div class="pay-bar">${segs}</div>
    <div class="pay-list">${list}</div>
  </div>`;
}
function mountList(){
  renderListBody();
  const inp=document.getElementById('searchInput');
  if(inp) inp.oninput=()=>{S.search=inp.value;renderListBody();};
  document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{S.sortBy=b.dataset.sort;savePrefs();refreshListControls();});
  const allB=document.querySelector('[data-all]'); if(allB) allB.onclick=()=>{S.fKinds=[];S.fCats=[];refreshListControls();};
  document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{toggleIn(S.fKinds,b.dataset.kind);refreshListControls();});
  document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{toggleIn(S.fCats,b.dataset.cat);refreshListControls();});
  const dir=document.getElementById('dirBtn'); if(dir) dir.onclick=()=>{S.sortDir=S.sortDir==='desc'?'asc':'desc';savePrefs();refreshListControls();};
}
function toggleIn(arr,v){ const i=arr.indexOf(v); if(i>=0) arr.splice(i,1); else arr.push(v); }
function refreshListControls(){
  document.querySelectorAll('[data-sort]').forEach(b=>b.classList.toggle('active',b.dataset.sort===S.sortBy));
  const dir=document.getElementById('dirBtn'); if(dir) dir.innerHTML=ic(S.sortDir==='desc'?'arrow_downward':'arrow_upward');
  const noFilter=!S.fKinds.length&&!S.fCats.length;
  const allB=document.querySelector('[data-all]'); if(allB) allB.classList.toggle('active',noFilter);
  document.querySelectorAll('[data-kind]').forEach(b=>b.classList.toggle('active',S.fKinds.includes(b.dataset.kind)));
  document.querySelectorAll('[data-cat]').forEach(b=>b.classList.toggle('active',S.fCats.includes(b.dataset.cat)));
  renderListBody();
}
function renderListBody(){ const el=document.getElementById('listBody'); if(el) el.innerHTML=listRows(); }

/* =========================================================================
   Shared
   ========================================================================= */
function txRow(t,showDate){
  return `<div class="tx"><div class="ico sm">${ic(catIcon(t.cat))}</div>
    <div class="body"><div class="t1">${esc(t.desc||t.cat)}</div>
    <div class="t2"><span class="tag ${t.kind==='共同'?'c':''}">${esc(t.kind||'—')}</span><span>${esc(t.cat)}</span><span>·</span><span>${esc(t.payer||'—')}</span>${showDate&&t.date?`<span>·</span><span>${t.date.iso.slice(5)}</span>`:''}</div></div>
    <div class="amt num">${fmtY(t.amt)}</div></div>`;
}
function emptyRow(){ return `<div class="empty">沒有資料</div>`; }
function skeleton(){ return `<div class="card dark" style="height:140px"></div>
  <div class="grid g-2"><div class="card"><div class="skel" style="height:70px"></div></div><div class="card"><div class="skel" style="height:70px"></div></div></div>
  <div class="card"><div class="skel" style="height:18px;margin:6px 0;width:60%"></div><div class="skel" style="height:18px;margin:6px 0"></div><div class="skel" style="height:18px;margin:6px 0;width:75%"></div></div>`; }
function errorState(){ return `<div class="card" style="text-align:center;padding:40px 20px">
  <div class="ico" style="margin:0 auto 12px;width:52px;height:52px">${ic('cloud_off')}</div>
  <h2>讀不到試算表</h2><p class="sub" style="margin-top:6px">${esc(S.error||'')}</p>
  <p style="color:var(--mute);font-size:12.5px;margin-top:10px">請確認試算表共用為「知道連結的任何人 → 檢視者」</p>
  <div style="margin-top:16px"><button class="chip active" onclick="loadData(true)">重新嘗試</button> <a class="chip" href="${CONFIG.sheetUrl}" target="_blank">開啟試算表</a></div></div>`; }

/* global handlers */
function go(tab){
  if(S.tab===tab){ window.scrollTo({top:0,behavior:'smooth'}); return; }
  location.hash='#/'+tab;   // hashchange 觸發 render；瀏覽器返回鍵可用
}
function setPeriod(m){ S.period=m; buildPeriod(); renderView(); window.scrollTo({top:0,behavior:'smooth'}); }
function setSplitView(m){ S.splitView=m; savePrefs(); renderView(); }

document.addEventListener('DOMContentLoaded',boot);
