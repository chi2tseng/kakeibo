/* =========================================================================
   app.js — UI: routing, rendering, charts (v2 · clean + visual)
   ========================================================================= */
'use strict';

const TABS = [
  { id:'overview', label:'總覽', icon:'dashboard' },
  { id:'settle',   label:'結算', icon:'swap_horiz' },
  { id:'category', label:'分類', icon:'donut_small' },
  { id:'split',    label:'分攤', icon:'group' },
  { id:'monthly',  label:'月份', icon:'bar_chart' },
  { id:'list',     label:'明細', icon:'receipt_long' },
];

const S = {
  tx:[], people:[], months:[],
  tab:'overview', period:'all', exclude:false,
  search:'', fKinds:[], fCats:[], sortBy:'date', sortDir:'desc',
  lastSync:null, loading:true, error:null, charts:[],
};

if(window.Chart){
  Chart.defaults.font.family="'Inter','Noto Sans TC','Noto Sans JP',system-ui,sans-serif";
  Chart.defaults.font.size=12;
  Chart.defaults.color='#5b5d57';
  Object.assign(Chart.defaults.plugins.tooltip,{backgroundColor:'#16170f',padding:10,cornerRadius:10,titleFont:{weight:'600',size:12},bodyFont:{size:12.5},displayColors:true,boxPadding:4});
}

/* helpers */
function ic(n,cls){ return `<span class="ms${cls?' '+cls:''}">${n}</span>`; }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function personBadge(p,i,lg){ const bg=PERSON_CHART[i]!=null?PERSON_CHART[i]:'#163300';
  const dark=['#163300','#054d28','#2f5d22','#4e8c33'].includes(bg);
  return `<span class="who${lg?' lg':''}" style="background:${bg};color:${dark?'#fff':'#163300'}">${esc(p[0])}</span>`; }
function personTag(p,i){ const av=personBadge(p,i); return p.length>1?`${av}<span>${esc(p)}</span>`:av; }
function pct(a,b){ return b?(a/b*100):0; }
function compact(n){ n=Math.abs(n); if(n>=1e6) return (n/1e6).toFixed(n>=1e7?0:1)+'M'; if(n>=1e3) return Math.round(n/1e3)+'k'; return ''+Math.round(n); }
function mLabel(ym){ return ym?(+ym.split('-')[1])+'月':''; }
function mLabelFull(ym){ if(!ym) return ''; const [y,m]=ym.split('-'); return `${y} 年 ${+m} 月`; }
function destroyCharts(){ S.charts.forEach(c=>{try{c.destroy()}catch(e){}}); S.charts=[]; }
function moneyTooltip(totalRef){ return {callbacks:{label(ctx){const v=ctx.parsed.y!=null?ctx.parsed.y:ctx.parsed;const tot=typeof totalRef==='function'?totalRef():totalRef;const p=tot?` · ${(v/tot*100).toFixed(1)}%`:'';const nm=ctx.label?ctx.label+': ':'';return `${nm}${fmtY(v)}${p}`;}}}; }
function setProgress(on){ const p=document.getElementById('progress'); if(p) p.classList.toggle('on',on); const rb=document.getElementById('refreshBtn'); if(rb) rb.classList.toggle('loading',on); }

/* boot */
async function boot(){
  buildNav(); bindGlobal();
  await loadData(true);
  setInterval(()=>loadData(false),5*60*1000);
}
async function loadData(initial){
  setProgress(true);
  if(initial){ S.loading=true; renderView(); }
  try{
    const tx=await fetchTransactions();
    S.tx=tx; S.people=derivePeople(tx); S.months=deriveMonths(tx);
    S.error=null; S.lastSync=new Date();
  }catch(e){ S.error=e.message||String(e); console.error(e); }
  finally{
    S.loading=false; buildPeriod(); buildNav(); renderView(); renderSync();
    setTimeout(()=>setProgress(false),550); // keep the refresh motion visible briefly
  }
}
function renderSync(){
  const el=document.getElementById('syncInfo'); if(!el) return;
  if(S.error){ el.innerHTML=`${ic('cloud_off')} 讀取失敗 · <a href="${CONFIG.sheetUrl}" target="_blank">開啟試算表</a>`; return; }
  if(!S.lastSync){ el.textContent=''; return; }
  const t=S.lastSync.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});
  el.innerHTML=`${ic('cloud_done')} 已同步 ${t} · <a href="${CONFIG.sheetUrl}" target="_blank">原始表</a>`;
}

/* controls + nav */
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
  const mk=(t,m)=>`<button data-tab="${t.id}" class="${S.tab===t.id?'active':''}">${ic(t.icon)}<span>${t.label}</span></button>`;
  if(top) top.innerHTML=TABS.map(t=>mk(t,0)).join('');
  if(bot) bot.innerHTML=TABS.map(t=>mk(t,1)).join('');
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>go(b.dataset.tab));
}
function bindGlobal(){
  document.getElementById('refreshBtn').onclick=()=>loadData(false);
  document.getElementById('excludeChip').onclick=()=>{S.exclude=!S.exclude;buildPeriod();renderView();};
  document.getElementById('homeBtn').onclick=()=>go('overview');
}

/* router */
function renderView(){
  destroyCharts();
  const v=document.getElementById('view');
  if(S.loading){ v.innerHTML=skeleton(); return; }
  if(S.error&&!S.tx.length){ v.innerHTML=errorState(); return; }
  const work=applyFilters(S.tx,{period:S.period,exclude:S.exclude});
  const c=compute(work,S.people);
  const allWork=applyFilters(S.tx,{period:'all',exclude:S.exclude});
  const cAll=compute(allWork,S.people);
  const r=({overview:viewOverview,settle:viewSettle,category:viewCategory,split:viewSplit,monthly:viewMonthly,list:viewList})[S.tab](c,work,cAll,allWork);
  const [html,after]=Array.isArray(r)?r:[r,()=>{}];
  v.innerHTML=`<div class="view">${html}</div>`;
  (after||(()=>{}))();
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===S.tab));
}
function periodName(){ return S.period==='all'?'全部期間':mLabelFull(S.period); }
function focusMonth(){ return S.period!=='all'?S.period:(S.months[S.months.length-1]||null); }

/* pace — smart month projection: recurring fixed costs don't prorate, variable prorate by
   elapsed days, one-time big costs counted as-is. Always compared to last month's total. */
function pace(){
  const fm=focusMonth(); if(!fm) return null;
  const dim=monthDays(fm), days=elapsedDays(fm), current=isCurrentMonth(fm);
  const FIX=CONFIG.fixedCats;
  const sumMonth=(ym)=>{ let total=0,fixed=0,vari=0;
    for(const t of S.tx){ if(!t.date||t.date.ym!==ym) continue; total+=t.amt;
      if(FIX.includes(t.cat)) fixed+=t.amt; else vari+=t.amt; }
    return {total,fixed,vari}; };
  const cur=sumMonth(fm);
  const idx=S.months.indexOf(fm), prevYm=idx>0?S.months[idx-1]:null;
  const prev=prevYm?sumMonth(prevYm):null;
  const varProj=current?(cur.vari/days)*dim:cur.vari;                       // 變動估整月：按已過天數配速
  const prevVar=prev?prev.vari:null;
  const varDelta=(prevVar&&prevVar>0)?(varProj-prevVar)/prevVar*100:null;   // 變動 vs 上月 → 真正「多花/少花」
  const fixedEst=prev?Math.max(cur.fixed,prev.fixed):cur.fixed;            // 固定費估計沿用上月
  const projTotal=varProj+fixedEst;
  return {fm,current,days,dim,total:cur.total,fixed:cur.fixed,vari:cur.vari,
    varProj,prevVar,varDelta,fixedEst,projTotal,prevYm,prevTotal:prev?prev.total:null};
}
function deltaBadge(d){
  if(d==null) return '';
  const up=d>0.5,down=d<-0.5,cls=up?'up':(down?'down':'flat');
  const icn=up?'trending_up':(down?'trending_down':'trending_flat');
  return `<span class="delta ${cls}">${ic(icn)}${Math.abs(d).toFixed(0)}%</span>`;
}

/* =========================================================================
   Overview
   ========================================================================= */
function viewOverview(c,work,cAll){
  const st=c.settlements[0];
  const settle=st
    ? `<div class="metric" style="cursor:pointer" onclick="go('settle')">
         <div class="label">${ic('swap_horiz')} 目前結算</div>
         <div class="value">${fmtY(st.amount)}</div>
         <div class="foot" style="display:flex;align-items:center;gap:7px">${personBadge(st.from,c.people.indexOf(st.from))}${ic('arrow_forward')}${personBadge(st.to,c.people.indexOf(st.to))}</div>
       </div>`
    : `<div class="metric"><div class="label">${ic('swap_horiz')} 目前結算</div><div class="value" style="color:var(--down);display:flex;align-items:center;gap:8px">${ic('check_circle','fill')} 已結清</div></div>`;

  const p=pace();
  const paceCard=p?`<div class="metric">
      <div class="label">${ic('calendar_month')} ${mLabel(p.fm)}${p.current?` · ${p.days}/${p.dim} 天`:''} ${p.current&&p.varDelta!=null?deltaBadge(p.varDelta):''}</div>
      <div class="value">${fmtY(p.total)}</div>
      <div class="foot">變動 ${fmtY(p.current?p.varProj:p.vari)}${p.current?'（估）':''}${p.prevVar!=null?` · 上月變動 ${fmtY(p.prevVar)}`:''}</div>
      <div class="foot" style="font-size:11.5px">固定 ${fmtY(p.fixed)}（房租·學費等不計入比較）</div>
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
      <div class="big num"><span class="cur">¥</span>${fmt(c.total)}</div>
      <div class="legs">
        <div><div class="l">共同</div><div class="v num">${fmtY(c.totalCommon)}</div></div>
        <div><div class="l">個人</div><div class="v num">${fmtY(c.totalPersonal)}</div></div>
        <div><div class="l">筆數</div><div class="v num">${c.count}</div></div>
      </div>
    </div>
    <div class="grid g-2">
      <div class="card green">${settle}</div>
      <div class="card">${paceCard}</div>
    </div>
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
  return [html,()=>{}];
}
function insights(c,work){
  const out=[];
  const dated=(work||[]).filter(t=>t.date).slice().sort((a,b)=>b.date.sort-a.date.sort);
  const last=dated[0];
  // 近期：最近一筆
  if(last) out.push([catIcon(last.cat),`最近一筆 <b>${esc(last.desc||last.cat)}</b> · ${fmtY(last.amt)} · ${last.date.iso.slice(5)}`]);
  // 近期：近 7 天（相對最新日期）
  if(last){
    const d=new Date(last.date.y,last.date.m-1,last.date.d); d.setDate(d.getDate()-6);
    const lo=d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate();
    const r7=dated.filter(t=>t.date.sort>=lo), sum=r7.reduce((a,b)=>a+b.amt,0);
    out.push(['date_range',`近 7 天 <b>${fmtY(sum)}</b> · ${r7.length} 筆`]);
  }
  // 習慣：最常買（筆數）
  const cnt={}; (work||[]).forEach(t=>cnt[t.cat]=(cnt[t.cat]||0)+1);
  const tf=Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
  if(tf) out.push(['repeat',`最常買 <b>${esc(tf[0])}</b> · ${tf[1]} 筆`]);
  // 最大開銷類別
  const cats=Object.entries(c.byCat).sort((a,b)=>b[1]-a[1]);
  if(cats.length){ const [n,a]=cats[0]; out.push([catIcon(n),`最大開銷 <b>${esc(n)}</b> · ${fmtY(a)} · ${pct(a,c.total).toFixed(0)}%`]); }
  // 最大單筆
  if(c.biggest) out.push(['local_fire_department',`最大單筆 <b>${esc(c.biggest.desc||c.biggest.cat)}</b> · ${fmtY(c.biggest.amt)}`]);
  // 現金 vs 刷卡
  const cash=c.byMethod['現金']||0; if(c.total) out.push(['account_balance_wallet',`現金 <b>${pct(cash,c.total).toFixed(0)}%</b> · 刷卡 <b>${(100-pct(cash,c.total)).toFixed(0)}%</b>`]);
  // 共同墊付差
  if(c.people.length===2){ const [a,b]=c.people; const d=(c.commonByPerson[a]||0)-(c.commonByPerson[b]||0); if(Math.abs(d)>1){ const more=d>0?a:b,less=d>0?b:a; out.push(['balance',`<b>${esc(more)}</b> 比 <b>${esc(less)}</b> 多墊 <b>${fmtY(Math.abs(d))}</b>`]); } }
  return out.slice(0,6).map(([i,t])=>`<div class="insight"><div class="ico sm">${ic(i)}</div><div class="tx2">${t}</div></div>`).join('');
}

/* =========================================================================
   Settlement
   ========================================================================= */
function viewSettle(c){
  const incl=compute(applyFilters(S.tx,{period:S.period,exclude:false}),S.people);
  const excl=compute(applyFilters(S.tx,{period:S.period,exclude:true}),S.people);
  const active=S.exclude?excl:incl, other=S.exclude?incl:excl;
  const st=active.settlements[0], ost=other.settlements[0];

  let hero;
  if(!st){ hero=`<div class="settle zero">${ic('check_circle','fill')}<div class="cap" style="margin-top:8px">這段期間已結清</div></div>`; }
  else{
    hero=`<div class="settle">
      <div class="flow">
        <div class="who lg">${esc(st.from[0])}</div>
        <div class="ar">${ic('arrow_forward')}</div>
        <div class="who lg alt">${esc(st.to[0])}</div>
      </div>
      <div class="amt num"><span class="cur">¥</span>${fmt(st.amount)}</div>
      <div class="cap"><b>${esc(st.from)}</b> 要還給 <b>${esc(st.to)}</b></div>
    </div>`;
  }

  // contribution vs fair share
  const maxC=Math.max(...active.people.map(p=>active.commonByPerson[p]||0),1);
  const bars=active.people.map((p,i)=>{
    const v=active.commonByPerson[p]||0,diff=v-active.fairShare;
    return `<div class="ctrack"><div class="top"><b>${personTag(p,i)}</b><span class="num">${fmtY(v)}</span></div>
      <div class="line"><i style="width:${pct(v,maxC)}%;background:${PERSON_CHART[i]}"></i></div>
      <div class="foot" style="margin-top:6px;font-size:12px;color:var(--mute)">${diff>=0?'多墊':'少墊'} ${fmtY(Math.abs(diff))}</div></div>`;
  }).join('');

  // per-person spending by category (NEW · sorted, visual)
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
   Category
   ========================================================================= */
function viewCategory(c){
  const cats=Object.entries(c.byCat).sort((a,b)=>b[1]-a[1]);
  if(!cats.length) return [`<div class="page-head"><h2>分類</h2></div><div class="card"><div class="empty">沒有資料</div></div>`];
  const labels=cats.map(x=>x[0]), data=cats.map(x=>x[1]), colors=chartColors(cats.length);
  const legend=cats.map(([n,a],i)=>`<div class="lg"><span class="sw" style="background:${colors[i]}"></span><span class="nm">${esc(n)}</span><span class="vl num">${fmtY(a)}</span><span class="pc">${pct(a,c.total).toFixed(0)}%</span></div>`).join('');
  const mx=cats[0][1];
  const rank=cats.map(([n,a],i)=>`<div class="row"><div class="ico">${ic(catIcon(n))}</div>
    <div class="main"><div class="l1"><span class="name">${esc(n)}</span><span class="amt">${fmtY(a)}</span></div>
    <div class="sub"><span>${pct(a,c.total).toFixed(1)}%</span><span>${c.catCount[n]} 筆</span></div>
    <div class="bar"><i style="width:${pct(a,mx).toFixed(1)}%;background:${colors[i]}"></i></div></div></div>`).join('');
  const html=`
    <div class="page-head"><h2>分類</h2><div class="sub">${periodName()} · ${fmtY(c.total)}</div></div>
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
  const mkRows=(entries,col)=>{ const mx=entries.length?entries[0][1]:1; return entries.map(([n,a])=>`<div class="row"><div class="ico sm">${ic(catIcon(n))}</div>
      <div class="main"><div class="l1"><span class="name">${esc(n)}</span><span class="amt">${fmtY(a)}</span></div>
      <div class="bar thin"><i style="width:${pct(a,mx).toFixed(1)}%;background:${col}"></i></div></div></div>`).join('')||emptyRow(); };
  const personCards=people.map((p,i)=>{
    const col=PERSON_CHART[i];
    const common=Object.entries(c.commonCatByPerson[p]||{}).sort((a,b)=>b[1]-a[1]);
    const personal=Object.entries(c.catByPerson[p]||{}).sort((a,b)=>b[1]-a[1]);
    const cTot=c.commonByPerson[p]||0, pTot=c.personalByPerson[p]||0;
    return `<div class="card">
      <div class="card-head"><h3>${personTag(p,i)}</h3><span class="num" style="font-weight:700">${fmtY(cTot+pTot)}</span></div>
      <div class="subhead"><span>${ic('group')} 共同墊付</span><b>${fmtY(cTot)}</b></div>
      <div class="rows">${mkRows(common,col)}</div>
      <div class="subhead" style="margin-top:14px"><span>${ic('person')} 個人</span><b>${fmtY(pTot)}</b></div>
      <div class="rows">${mkRows(personal,col)}</div>
    </div>`;
  }).join('');
  const maxC=Math.max(...people.map(p=>c.commonByPerson[p]||0),1);
  const commonBars=people.map((p,i)=>`<div class="ctrack"><div class="top"><b>${personTag(p,i)}</b><span class="num">${fmtY(c.commonByPerson[p]||0)}</span></div><div class="line"><i style="width:${pct(c.commonByPerson[p]||0,maxC)}%;background:${PERSON_CHART[i]}"></i></div></div>`).join('');
  const html=`
    <div class="page-head"><h2>共同 / 個人</h2><div class="sub">${periodName()}${S.exclude?' · 排除大筆':''}</div></div>
    <div class="grid g-2">
      <div class="card green"><div class="metric"><div class="label" style="color:var(--forest-2)">${ic('group')} 共同支出</div><div class="value">${fmtY(c.totalCommon)}</div><div class="foot" style="color:var(--forest-2)">佔 ${pct(c.totalCommon,c.total).toFixed(0)}%</div></div></div>
      <div class="card dark"><div class="metric"><div class="label" style="color:rgba(255,255,255,.65)">${ic('person')} 個人支出</div><div class="value">${fmtY(c.totalPersonal)}</div><div class="foot" style="color:rgba(255,255,255,.6)">佔 ${pct(c.totalPersonal,c.total).toFixed(0)}%</div></div></div>
    </div>
    <div class="grid g-2">
      <div class="card"><div class="chart donut"><canvas id="splitDonut"></canvas><div class="dc"><div><div class="l">共同佔</div><div class="v num">${pct(c.totalCommon,c.total).toFixed(0)}%</div></div></div></div></div>
      <div class="card"><div class="card-head"><h3>${ic('account_balance_wallet')} 共同墊付</h3></div><div class="contrib">${commonBars}</div></div>
    </div>
    <div class="grid g-2">${personCards}</div>`;
  const after=()=>{ const ctx=document.getElementById('splitDonut'); if(ctx) S.charts.push(new Chart(ctx,{type:'doughnut',
    data:{labels:['共同','個人'],datasets:[{data:[c.totalCommon,c.totalPersonal],backgroundColor:['#9fe870','#163300'],borderColor:'#fff',borderWidth:2,hoverOffset:6}]},
    options:{cutout:'72%',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:moneyTooltip(()=>c.total)}}})); };
  return [html,after];
}

/* =========================================================================
   Monthly
   ========================================================================= */
function viewMonthly(c,work,cAll){
  const months=S.months.slice(), data=months.map(m=>cAll.byMonth[m]||0), labels=months.map(mLabel);
  const fm=focusMonth();
  const fmWork=applyFilters(S.tx,{period:fm,exclude:S.exclude}), fmC=compute(fmWork,S.people);
  const p=pace();
  const fmCats=Object.entries(fmC.byCat).sort((a,b)=>b[1]-a[1]);
  const mx=fmCats.length?fmCats[0][1]:1;
  const detail=fmCats.map(([n,a])=>`<div class="row"><div class="ico sm">${ic(catIcon(n))}</div>
    <div class="main"><div class="l1"><span class="name">${esc(n)}</span><span class="amt">${fmtY(a)}</span></div>
    <div class="bar thin"><i style="width:${pct(a,mx).toFixed(1)}%"></i></div></div></div>`).join('')||emptyRow();
  const chips=months.map(m=>`<button class="chip ${fm===m?'active':''}" onclick="setPeriod('${m}')">${mLabel(m)}</button>`).join('');
  const html=`
    <div class="page-head"><h2>月份趨勢</h2><div class="sub">每月總支出${S.exclude?' · 排除大筆':''}</div></div>
    <div class="card"><div class="chart-scroll"><div class="chart bars" style="min-width:${Math.max(0,months.length*52)}px"><canvas id="monthBars"></canvas></div></div></div>
    <div class="card">
      <div class="card-head"><h3>${ic('calendar_month')} ${mLabelFull(fm)} ${p&&p.current&&p.varDelta!=null?deltaBadge(p.varDelta):''}</h3></div>
      <div class="month-pick">${chips}</div>
      <div class="metric" style="margin-bottom:6px">
        <div class="value">${fmtY(fmC.total)}</div>
        <div class="foot">${fmC.count} 筆 · 共同 ${fmtY(fmC.totalCommon)} / 個人 ${fmtY(fmC.totalPersonal)}${p&&p.prevTotal!=null&&p.fm===fm?` · 上月 ${fmtY(p.prevTotal)}`:''}${p&&p.current&&p.fm===fm?` · 估整月 ${fmtY(p.projTotal)}`:''}</div>
      </div>
      <div class="rows">${detail}</div>
    </div>`;
  const after=()=>{ const ctx=document.getElementById('monthBars'); if(!ctx) return;
    const colors=months.map(m=>m===fm?'#163300':'#9fe870');
    S.charts.push(new Chart(ctx,{type:'bar',
      data:{labels,datasets:[{data,backgroundColor:colors,borderRadius:8,maxBarThickness:56}]},
      options:{responsive:true,maintainAspectRatio:false,onClick:(e,el)=>{if(el.length)setPeriod(months[el[0].index]);},
        scales:{y:{beginAtZero:true,ticks:{callback:v=>'¥'+compact(v)},grid:{color:'#eceee9'},border:{display:false}},x:{grid:{display:false},border:{display:false}}},
        plugins:{legend:{display:false},tooltip:moneyTooltip(null)}}})); };
  return [html,after];
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
  return `<div class="sub" style="color:var(--mute);font-size:13px;margin:4px 2px 8px">${rows.length} 筆 · ${fmtY(sum)}</div>${body||`<div class="card"><div class="empty">找不到符合的交易</div></div>`}`;
}
function mountList(){
  renderListBody();
  const inp=document.getElementById('searchInput');
  if(inp) inp.oninput=()=>{S.search=inp.value;renderListBody();};
  document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{S.sortBy=b.dataset.sort;refreshListControls();});
  const allB=document.querySelector('[data-all]'); if(allB) allB.onclick=()=>{S.fKinds=[];S.fCats=[];refreshListControls();};
  document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{toggleIn(S.fKinds,b.dataset.kind);refreshListControls();});
  document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{toggleIn(S.fCats,b.dataset.cat);refreshListControls();});
  const dir=document.getElementById('dirBtn'); if(dir) dir.onclick=()=>{S.sortDir=S.sortDir==='desc'?'asc':'desc';refreshListControls();};
}
function toggleIn(arr,v){ const i=arr.indexOf(v); if(i>=0) arr.splice(i,1); else arr.push(v); }
function refreshListControls(){
  // update control active-states in place (keeps filter scroll + search focus), re-render body only
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
function go(tab){ S.tab=tab; window.scrollTo({top:0,behavior:'smooth'}); buildNav(); renderView(); }
function setPeriod(m){ S.period=m; buildPeriod(); renderView(); window.scrollTo({top:0,behavior:'smooth'}); }

document.addEventListener('DOMContentLoaded',boot);
