/* =========================================================================
   app.js — UI: routing, rendering, charts (v4 · 三頁精簡版)
   總覽：一眼看完（總額、結算、本月配速、累計曲線、分類前五、最近 5 筆）
   結算：誰還誰＋共同墊付＋每個人花在哪（原「分攤」）
   明細：每月長條＋分類（兼篩選）＋交易清單／收據照片牆；點任一筆看大圖與品項
   ========================================================================= */
'use strict';

const TABS = [
  { id:'overview', label:'總覽', icon:'dashboard' },
  { id:'settle',   label:'結算', icon:'swap_horiz' },
  { id:'list',     label:'明細', icon:'receipt_long' },
];
const TAB_ALIAS = { split:'settle', category:'list', monthly:'list', analysis:'list', receipts:'list' };   // 舊網址/書籤照樣能開
const SORTS = [['date-desc','新→舊'],['date-asc','舊→新'],['amt-desc','金額高→低'],['amt-asc','金額低→高']];

const S = {
  tx:[], people:[], months:[],
  tab:'overview', period:'all', exclude:true,   // 預設排除初期費用＋語言學校等大筆一次性支出
  search:'', fKinds:[], fCats:[], sort:'date-desc', listView:'list', splitView:'all',
  lastSync:null, loading:true, error:null, charts:[],
};

if(window.Chart){
  Chart.defaults.font.family="'Inter','Noto Sans TC','Noto Sans JP',system-ui,sans-serif";
  Chart.defaults.font.size=12;
  Chart.defaults.color='#5b5d57';
  Object.assign(Chart.defaults.plugins.tooltip,{backgroundColor:'#16170f',padding:10,cornerRadius:10,titleFont:{weight:'600',size:12},bodyFont:{size:12.5},displayColors:true,boxPadding:4});
}

/* ---------- persistence (prefs + data cache → instant open) ---------- */
const PREF_KEY='kakeibo.prefs', CACHE_KEY='kakeibo.cache.v3';   // v3 = 多了收據網址 rc / id；版本號擋舊格式
try{ localStorage.removeItem('kakeibo.cache'); localStorage.removeItem('kakeibo.cache.v2'); }catch(e){}
function loadPrefs(){ try{ const p=JSON.parse(localStorage.getItem(PREF_KEY)||'{}');
  ['exclude','splitView','sort','listView'].forEach(k=>{ if(p[k]!=null) S[k]=p[k]; });
  if(!SORTS.some(s=>s[0]===S.sort)) S.sort='date-desc';
  if(!['list','photo'].includes(S.listView)) S.listView='list'; }catch(e){} }
function savePrefs(){ try{ localStorage.setItem(PREF_KEY,JSON.stringify({exclude:S.exclude,splitView:S.splitView,sort:S.sort,listView:S.listView})); }catch(e){} }
function loadCache(){ try{ const c=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');
  if(c&&Array.isArray(c.tx)&&c.tx.length){ S.tx=c.tx; S.people=derivePeople(c.tx); S.months=deriveMonths(c.tx); S.lastSync=c.t?new Date(c.t):null; S.loading=false; return true; } }catch(e){} return false; }
function saveCache(){ try{ localStorage.setItem(CACHE_KEY,JSON.stringify({t:S.lastSync?S.lastSync.getTime():Date.now(),tx:S.tx})); }catch(e){} }

/* ---------- helpers ---------- */
function ic(n,cls){ return `<span class="ms${cls?' '+cls:''}" aria-hidden="true">${n}</span>`; }
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function personBadge(p,i,lg){
  let style;
  if(i===1) style='background:#fff;color:#163300;box-shadow:0 1px 3px rgba(20,21,15,.16)';   // 乖：白底＋淡陰影（無邊框）
  else { const bg=PERSON_CHART[i]!=null?PERSON_CHART[i]:'#163300'; const dark=['#163300','#054d28','#2f5d22','#4e8c33'].includes(bg); style=`background:${bg};color:${dark?'#fff':'#163300'}`; }
  return `<span class="who${lg?' lg':''}" style="${style}">${esc(p[0])}</span>`; }
function personTag(p,i){ const av=personBadge(p,i); return p.length>1?`${av}<span>${esc(p)}</span>`:av; }
function pct(a,b){ return b?(a/b*100):0; }
function compact(n){ n=Math.abs(n); if(n>=1e6) return (n/1e6).toFixed(n>=1e7?0:1)+'M'; if(n>=1e3) return Math.round(n/1e3)+'k'; return ''+Math.round(n); }
function mLabel(ym){ if(!ym) return ''; const [y,m]=ym.split('-'); const multiYear=S.months.length>0&&new Set(S.months.map(x=>x.slice(0,4))).size>1; return multiYear?`${y.slice(2)}年${+m}月`:`${+m}月`; } /* 跨年資料自動帶年份 */
function mLabelFull(ym){ if(!ym) return ''; const [y,m]=ym.split('-'); return `${y} 年 ${+m} 月`; }
function dayLabel(dt){ const w='日一二三四五六'[new Date(dt.y,dt.m-1,dt.d).getDay()]; return `${dt.y!==new Date().getFullYear()?dt.y+' 年 ':''}${dt.m} 月 ${dt.d} 日 · 週${w}`; }
function destroyCharts(){ S.charts.forEach(c=>{try{c.destroy()}catch(e){}}); S.charts=[]; }
/* 圖表第一次畫時 Inter 可能還沒載完 → 軸標籤寬度量錯被切；字型好了再重排一次 */
function redrawAfterFonts(ch){ if(document.fonts&&document.fonts.status!=='loaded') document.fonts.ready.then(()=>{ try{ if(ch.canvas) ch.update('none'); }catch(e){} }); }
function setProgress(on){ const p=document.getElementById('progress'); if(p) p.classList.toggle('on',on); const rb=document.getElementById('refreshBtn'); if(rb) rb.classList.toggle('loading',on); }
/* 收據縮圖：bot 另存 320px 小圖在 t/<同路徑>；沒有就退回原圖 */
function thumbOf(u){ return u.replace(/^(https:\/\/storage\.googleapis\.com\/[^/]+\/)/,'$1t/'); }
function thumbErr(img){ if(img.dataset.full&&img.getAttribute('src')!==img.dataset.full) img.src=img.dataset.full; else { img.onerror=null; const b=img.closest('.thumb,.rc'); if(b) b.classList.add('err'); } }
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
/* 量測 topbar 實高 → --headH（sticky dayhead 依此定位，修遮擋 bug） */
function syncHeadH(){ const tb=document.querySelector('.topbar'); if(tb) document.documentElement.style.setProperty('--headH', tb.offsetHeight+'px'); }
async function boot(){
  loadPrefs();
  S.tab=tabFromHash();
  const old=location.hash.match(/^#\/([a-z]+)/); if(old&&TAB_ALIAS[old[1]]) history.replaceState(null,'','#/'+S.tab);   // 舊網址改寫成新分頁
  buildNav(); bindGlobal(); bindSwipe(); bindDetail();
  syncHeadH();
  let rT; addEventListener('resize',()=>{clearTimeout(rT);rT=setTimeout(syncHeadH,150);});
  // 回到 App/分頁時，資料超過 2 分鐘就靜默更新（背景分頁不浪費請求）
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&S.lastSync&&Date.now()-S.lastSync.getTime()>2*60*1000) loadData(false); });
  if(loadCache()){ buildPeriod(); renderView(); renderSync(); loadData(false); } // 快取秒開，背景更新
  else await loadData(true);
  setInterval(()=>loadData(false),5*60*1000);
}
function dataSig(){ let s=0; for(const t of S.tx) s+=t.amt; return S.tx.length+'|'+Math.round(s)+'|'+S.tx.filter(t=>t.rc).length; }
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
    if(initial||dataSig()!==before){ closeDetail(); buildPeriod(); buildNav(); renderView(); }  // 資料沒變就不重渲染（不打斷動畫、不閃爍）；有變先關詳情（id 會重排）
    renderSync();
    setTimeout(()=>setProgress(false),550);
  }
}
function renderSync(){
  const el=document.getElementById('syncInfo'); if(!el) return;
  if(S.error&&S.tx.length){ el.innerHTML=`${ic('cloud_off')} 離線 · 顯示上次資料 · <a href="${CONFIG.sheetUrl}" target="_blank" rel="noopener">原始表</a>`; return; }
  if(S.error){ el.innerHTML=`${ic('cloud_off')} 讀取失敗 · <a href="${CONFIG.sheetUrl}" target="_blank" rel="noopener">開啟試算表</a>`; return; }
  if(!S.lastSync){ el.textContent=''; return; }
  const t=S.lastSync.toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'});
  el.innerHTML=`${ic('cloud_done')} 已同步 ${t} · <a href="${CONFIG.sheetUrl}" target="_blank" rel="noopener">原始表</a>`;
}

/* ---------- controls + nav + routing ---------- */
function buildPeriod(){
  const w=document.getElementById('periodChips'); if(!w) return;
  let h=`<button class="chip ${S.period==='all'?'active':''}" data-period="all" aria-pressed="${S.period==='all'}">全部</button>`;
  for(const m of S.months) h+=`<button class="chip ${S.period===m?'active':''}" data-period="${m}" aria-pressed="${S.period===m}">${mLabel(m)}</button>`;
  w.innerHTML=h;
  w.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{S.period=b.dataset.period;buildPeriod();renderView();});
  const a=w.querySelector('.chip.active'); if(a&&w.scrollWidth>w.clientWidth) w.scrollLeft=Math.max(0,a.offsetLeft-w.clientWidth/2+a.offsetWidth/2);   // 選中的月份捲進畫面
  const ex=document.getElementById('excludeChip');
  ex.classList.toggle('on',S.exclude);
  ex.setAttribute('aria-pressed',S.exclude?'true':'false');   // 開關狀態播報給螢幕閱讀器
  syncHeadH();                                                 // chips 重建後 topbar 高度可能變
}
function buildNav(){
  const top=document.getElementById('topTabs'), bot=document.getElementById('bottomNav');
  const mk=t=>`<button data-tab="${t.id}" class="${S.tab===t.id?'active':''}"${S.tab===t.id?' aria-current="page"':''}>${ic(t.icon)}<span>${t.label}</span></button>`;
  if(top) top.innerHTML=TABS.map(mk).join('');
  if(bot) bot.innerHTML=TABS.map(mk).join('');
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>go(b.dataset.tab));
}
function bindGlobal(){
  document.getElementById('refreshBtn').onclick=()=>loadData(false);
  document.getElementById('excludeChip').onclick=()=>{S.exclude=!S.exclude;savePrefs();buildPeriod();renderView();};
  document.getElementById('homeBtn').onclick=()=>go('overview');
  window.addEventListener('hashchange',()=>{ const t=tabFromHash(); if(t!==S.tab){ S.tab=t; window.scrollTo({top:0}); buildNav(); renderView();
    const v=document.getElementById('view'); if(v) v.focus({preventScroll:true});   // 切頁後焦點移到主內容（螢幕閱讀器/鍵盤）
  } });
  // 可點的卡片／分類列：data-go="分頁"、data-catgo="分類"（鍵盤 Enter/Space 同點擊）
  const v=document.getElementById('view');
  v.addEventListener('click',e=>{
    const g=e.target.closest('[data-go]'); if(g){ go(g.dataset.go); return; }
    const c=e.target.closest('[data-catgo]'); if(c) showCategory(c.dataset.catgo);
  });
  v.addEventListener('keydown',e=>{
    if(e.key!=='Enter'&&e.key!==' ') return;
    if(e.target.matches('[data-go],[data-catgo]')){ e.preventDefault(); e.target.click(); }
  });
}
function tabFromHash(){ const m=location.hash.match(/^#\/([a-z]+)/); const id=m&&(TAB_ALIAS[m[1]]||m[1]); return (id&&TABS.some(t=>t.id===id))?id:'overview'; }
/* 手機左右滑切換分頁（避開可橫向捲動的元件） */
function bindSwipe(){
  const el=document.querySelector('main'); if(!el) return; let st=null;
  el.addEventListener('touchstart',e=>{ const t=e.target.closest('.filters,.period-scroll,.chart-scroll,.seg,canvas,input,.search'); st=t?null:{x:e.touches[0].clientX,y:e.touches[0].clientY}; },{passive:true});
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
  const r=({overview:viewOverview,settle:viewSettle,list:viewList})[S.tab](c,work);
  const [html,after]=Array.isArray(r)?r:[r,()=>{}];
  const key=S.tab+'|'+S.period+'|'+S.exclude+'|'+S.splitView;
  const animate=key!==lastAnimKey; lastAnimKey=key;   // 背景更新不重播動畫
  v.innerHTML=`<div class="view${animate?' anim':''}">${html}</div>`;
  (after||(()=>{}))();
  if(animate) runCountUp();
  document.querySelectorAll('[data-tab]').forEach(b=>{ const on=b.dataset.tab===S.tab; b.classList.toggle('active',on); if(on) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
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
  return `<span class="delta ${cls}" aria-label="比上月${up?'多':down?'少':'持平'} ${Math.abs(d).toFixed(0)}%">${ic(icn)}${Math.abs(d).toFixed(0)}%</span>`;
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

/* =========================================================================
   總覽 — 一眼看完，細節點進去看
   ========================================================================= */
function viewOverview(c,work){
  const st=c.settlements[0];
  const settleCard=st
    ? `<div class="card green tap" data-go="settle" role="link" tabindex="0" aria-label="結算：${esc(st.from)} 要還給 ${esc(st.to)} ${fmtY(st.amount)}">
        <div class="metric">
          <div class="label">${ic('swap_horiz')} 結算</div>
          <div class="value">${cnt(st.amount,true)}</div>
          <div class="flow-mini">${personBadge(st.from,c.people.indexOf(st.from))}${ic('arrow_forward')}${personBadge(st.to,c.people.indexOf(st.to))}</div>
        </div></div>`
    : `<div class="card green"><div class="metric"><div class="label">${ic('swap_horiz')} 結算</div><div class="value settled">${ic('check_circle','fill')} 已結清</div></div></div>`;

  const p=pace();
  const paceCard=p?`<div class="card"><div class="metric">
      <div class="label">${ic('calendar_month')} ${mLabel(p.fm)}${p.current?` · 第 ${p.days} 天`:''}${p.current&&p.varDelta!=null?deltaBadge(p.varDelta):''}</div>
      <div class="value">${cnt(p.total,true)}</div>
      <div class="foot">${p.current?'變動估':'變動'} ${fmtY(p.current?p.varProj:p.vari)}${p.prevVar!=null?` · 上月 ${fmtY(p.prevVar)}`:''}</div>
    </div></div>`:'';

  // 變動累計曲線：本月 vs 上月（一眼看配速）
  const lineCard=(p&&p.fm)?`
    <div class="card">
      <div class="card-head"><h3>${ic('show_chart')} 變動花費累計</h3>
        <span class="legend-mini"><i style="background:#163300"></i>${mLabel(p.fm)}${p.prevYm?`<i style="background:#c2c6bc"></i>${mLabel(p.prevYm)}`:''}</span></div>
      <div class="chart line" role="img" aria-label="變動花費累計折線圖：${mLabel(p.fm)}與${p.prevYm?mLabel(p.prevYm):'上月'}逐日累計比較"><canvas id="cumLine"></canvas></div>
    </div>`:'';

  const cats=Object.entries(c.byCat).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxCat=cats.length?cats[0][1]:1;
  const catRows=cats.map(([n,a])=>`<div class="row tap" data-catgo="${esc(n)}" role="link" tabindex="0" aria-label="${esc(n)} ${fmtY(a)}，看這類明細"><div class="ico sm">${ic(catIcon(n))}</div>
    <div class="main"><div class="l1"><span class="name">${esc(n)}</span><span class="amt">${fmtY(a)}</span></div>
    <div class="bar"><i style="width:${pct(a,maxCat).toFixed(1)}%"></i></div></div></div>`).join('')||emptyRow();

  const recent=work.slice().reverse().slice(0,5).map(t=>txRow(t,true)).join('')||emptyRow();   // 注意：不可 .map(txRow)，index 會被當成 showDate
  const heroLabel=S.period==='all'?'全部支出':mLabelFull(S.period)+' 支出';

  const html=`
    <div class="card dark hero">
      <div class="eyebrow">${heroLabel}</div>
      <div class="big num"><span class="cur">¥</span>${cnt(c.total)}</div>
      <div class="legs">
        <div><div class="l">共同</div><div class="v num">${fmtY(c.totalCommon)}</div></div>
        <div><div class="l">個人</div><div class="v num">${fmtY(c.totalPersonal)}</div></div>
        <div><div class="l">筆數</div><div class="v num">${c.count}</div></div>
      </div>
    </div>
    <div class="grid g-2">${settleCard}${paceCard}</div>
    ${lineCard}
    <div class="grid g-2">
      <div class="card">
        <div class="card-head"><h3>${ic('donut_small')} 分類</h3><a class="link" href="#/list">明細${ic('chevron_right')}</a></div>
        <div class="rows">${catRows}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${ic('schedule')} 最近</h3><a class="link" href="#/list">全部${ic('chevron_right')}</a></div>
        <div class="rows-tx" data-seq="recent">${recent}</div>
      </div>
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
    const ch=new Chart(ctx,{type:'line',
      data:{labels,datasets:ds},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},layout:{padding:{left:4}},
        scales:{y:{beginAtZero:true,ticks:{callback:v=>'¥'+compact(v),maxTicksLimit:5},grid:{color:'#eceee9'},border:{display:false}},
                x:{ticks:{maxTicksLimit:8},grid:{display:false},border:{display:false}}},
        plugins:{legend:{display:false},tooltip:{callbacks:{title:i=>`${i[0].label} 日`,label:c2=>`${c2.dataset.label}: ${fmtY(c2.parsed.y)}`}}}}});
    S.charts.push(ch); redrawAfterFonts(ch);
  };
  return [html,after];
}

/* =========================================================================
   結算（含原「分攤」）
   ========================================================================= */
function viewSettle(c){
  const st=c.settlements[0];
  const hero=!st
    ? `<div class="settle zero">${ic('check_circle','fill')}<div class="cap" style="margin-top:8px">這段期間已結清</div></div>`
    : `<div class="settle">
      <div class="flow">
        <div class="who lg">${esc(st.from[0])}</div>
        <div class="ar">${ic('arrow_forward')}</div>
        <div class="who lg alt">${esc(st.to[0])}</div>
      </div>
      <div class="amt num"><span class="cur">¥</span>${cnt(st.amount)}</div>
      <div class="cap"><b>${esc(st.from)}</b> 要還給 <b>${esc(st.to)}</b></div>
    </div>`;

  // 共同支出誰墊得多（結算的依據）
  const maxC=Math.max(...c.people.map(p=>c.commonByPerson[p]||0),1);
  const bars=c.people.map((p,i)=>{
    const v=c.commonByPerson[p]||0,diff=v-c.fairShare;
    return `<div class="ctrack"><div class="top"><b>${personTag(p,i)}</b><span class="num">${fmtY(v)}</span></div>
      <div class="line"><i style="width:${pct(v,maxC)}%;background:${PERSON_CHART[i]}"></i></div>
      <div class="foot">${diff>=0?'多墊':'少墊'} ${fmtY(Math.abs(diff))}</div></div>`;
  }).join('');

  // 每個人花在哪：全部 / 共同 / 個人
  const mode=S.splitView||'all', showC=mode!=='personal', showP=mode!=='common';
  // 每段只列前 5 類，其餘合併一列（避免一個人十幾列、頁面過長）
  const mkRows=(entries,col)=>{ if(!entries.length) return emptyRow();
    const mx=entries[0][1], top=entries.slice(0,5), rest=entries.slice(5);
    const row=(n,a,icn,cls)=>`<div class="row${cls?' '+cls:''}"><div class="ico sm">${ic(icn)}</div>
      <div class="main"><div class="l1"><span class="name">${esc(n)}</span><span class="amt">${fmtY(a)}</span></div>
      <div class="bar thin"><i style="width:${pct(a,mx).toFixed(1)}%;background:${col}"></i></div></div></div>`;
    return top.map(([n,a])=>row(n,a,catIcon(n))).join('')
      +(rest.length?row(`其他 ${rest.length} 類`,rest.reduce((s,x)=>s+x[1],0),'more_horiz','more'):''); };
  const personCards=c.people.map((p,i)=>{
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
  const seg=`<div class="seg" role="group" aria-label="顯示範圍">${[['all','全部'],['common','共同'],['personal','個人']].map(([k,l])=>`<button class="${mode===k?'active':''}" aria-pressed="${mode===k}" onclick="setSplitView('${k}')">${l}</button>`).join('')}</div>`;

  const html=`
    <div class="page-head"><h2>結算</h2><div class="sub">${periodName()}${S.exclude?' · 排除大筆':''}</div></div>
    <div class="card green">${hero}</div>
    <div class="card">
      <div class="card-head"><h3>${ic('account_balance_wallet')} 共同支出誰墊的</h3><span class="foot">每人應付 ${fmtY(c.fairShare)}</span></div>
      <div class="contrib">${bars}</div>
    </div>
    <div class="sec-head"><h3>每個人花在哪</h3>${seg}</div>
    <div class="grid g-2">${personCards}</div>`;
  return [html,()=>{}];
}

/* =========================================================================
   明細（含原「月份」「分類」與收據照片）
   ========================================================================= */
function viewList(c){ return [listShell(c), mountList]; }
function listShell(c){
  const cats=Object.entries(c.byCat).sort((a,b)=>b[1]-a[1]), colors=chartColors(cats.length);
  const comp=`<div class="pay-bar" role="img" aria-label="分類組成：${esc(cats.slice(0,5).map(([n,a])=>`${n} ${pct(a,c.total).toFixed(0)}%`).join('、'))}">${cats.map(([n,a],i)=>`<i style="width:${pct(a,c.total)}%;background:${colors[i]}" title="${esc(n)} ${fmtY(a)}"></i>`).join('')}</div>`;
  const catChips=cats.map(([n,a],i)=>`<button class="fchip ${S.fCats.includes(n)?'active':''}" data-cat="${esc(n)}" aria-pressed="${S.fCats.includes(n)}"><span class="dot" style="background:${colors[i]}"></span>${esc(n)}<span class="fa num">¥${compact(a)}</span></button>`).join('');
  const trend=S.months.length>1?`
    <div class="card pad-sm">
      <div class="card-head"><h3>${ic('bar_chart')} 每月</h3><span class="legend-mini"><i style="background:#163300"></i>固定<i style="background:#9fe870"></i>變動</span></div>
      <div class="chart-scroll" id="monthScroll"><div class="chart bars" role="img" aria-label="每月支出（固定＋變動），點長條切換月份" style="min-width:${S.months.length*40}px"><canvas id="monthBars"></canvas></div></div>
    </div>`:'';
  const noFilter=!S.fKinds.length&&!S.fCats.length;
  const kindChips=`<button class="fchip ${noFilter?'active':''}" data-all="1">全部</button>`
    +[['共同','group'],['個人','person']].map(([k,i])=>`<button class="fchip ${S.fKinds.includes(k)?'active':''}" data-kind="${k}" aria-pressed="${S.fKinds.includes(k)}">${ic(i)}${k}</button>`).join('');
  const views=[['list','view_agenda','清單'],['photo','photo_library','收據照片']].map(([k,i,l])=>`<button data-view="${k}" class="${S.listView===k?'active':''}" aria-pressed="${S.listView===k}" aria-label="${l}" title="${l}">${ic(i)}</button>`).join('');
  return `
    <div class="page-head"><h2>明細</h2><div class="sub">${periodName()} · ${fmtY(c.total)}${S.exclude?' · 排除大筆':''}</div></div>
    ${trend}
    ${cats.length?`<div class="card pad-sm"><div class="card-head"><h3>${ic('donut_small')} 分類</h3></div>${comp}<div class="filters cats">${catChips}</div></div>`:''}
    <div class="toolbar">
      <div class="tool-row">
        <label class="search">${ic('search')}<input id="searchInput" type="search" enterkeyhint="search" aria-label="搜尋店名、品項、付款人" placeholder="搜尋店名、品項" value="${esc(S.search)}"/></label>
        <div class="seg icon" role="group" aria-label="顯示方式">${views}</div>
      </div>
      <div class="tool-row">
        <div class="filters kinds">${kindChips}</div>
        <button class="sortbtn" id="sortBtn">${ic('swap_vert')}<span></span></button>
      </div>
    </div>
    <div id="listBody"></div>`;
}
function mountList(){
  drawMonthBars();
  refreshListControls();
  const inp=document.getElementById('searchInput');
  if(inp){ let t; inp.oninput=()=>{ clearTimeout(t); t=setTimeout(()=>{ S.search=inp.value; renderListBody(); },120); }; }
  document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{toggleIn(S.fCats,b.dataset.cat);refreshListControls();});
  const allB=document.querySelector('[data-all]'); if(allB) allB.onclick=()=>{S.fKinds=[];S.fCats=[];refreshListControls();};
  document.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{toggleIn(S.fKinds,b.dataset.kind);refreshListControls();});
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{S.listView=b.dataset.view;savePrefs();refreshListControls();});
  const sb=document.getElementById('sortBtn'); if(sb) sb.onclick=()=>{ const i=SORTS.findIndex(s=>s[0]===S.sort); S.sort=SORTS[(i+1)%SORTS.length][0]; savePrefs(); refreshListControls(); };
}
function drawMonthBars(){
  const ctx=document.getElementById('monthBars'); if(!ctx) return;
  const months=S.months, fm=S.period!=='all'?S.period:null, hi=m=>!fm||m===fm;
  const fv=monthFixVar(applyFilters(S.tx,{period:'all',exclude:S.exclude}),months);
  const ch=new Chart(ctx,{type:'bar',
    data:{labels:months.map(mLabel),datasets:[
      {label:'固定',data:fv.map(x=>x.f),backgroundColor:months.map(m=>hi(m)?'#163300':'rgba(22,51,0,.22)'),stack:'s',maxBarThickness:44,borderRadius:{topLeft:0,topRight:0,bottomLeft:6,bottomRight:6},borderSkipped:false},
      {label:'變動',data:fv.map(x=>x.v),backgroundColor:months.map(m=>hi(m)?'#9fe870':'rgba(159,232,112,.35)'),stack:'s',maxBarThickness:44,borderRadius:{topLeft:6,topRight:6,bottomLeft:0,bottomRight:0},borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,layout:{padding:{left:4}},
      onClick:(e,el)=>{ if(el.length){ const m=months[el[0].index]; setPeriod(S.period===m?'all':m); } },   // 再點一次 = 回到全部
      onHover:(e,el)=>{ if(e.native&&e.native.target) e.native.target.style.cursor=el.length?'pointer':'default'; },
      scales:{y:{stacked:true,beginAtZero:true,ticks:{callback:v=>'¥'+compact(v),maxTicksLimit:4},grid:{color:'#eceee9'},border:{display:false}},
              x:{stacked:true,grid:{display:false},border:{display:false}}},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c2=>`${c2.dataset.label}: ${fmtY(c2.parsed.y)}`,footer:items=>'合計 '+fmtY(items.reduce((a,b)=>a+b.parsed.y,0))}}}}});
  S.charts.push(ch); redrawAfterFonts(ch);
  // 月份多到要橫捲時，把選中（或最新）的月份捲進畫面
  const sc=document.getElementById('monthScroll');
  if(sc&&sc.scrollWidth>sc.clientWidth){ const i=fm?months.indexOf(fm):months.length-1; sc.scrollLeft=Math.max(0,(i+.5)/months.length*sc.scrollWidth-sc.clientWidth/2); }
}
function toggleIn(arr,v){ const i=arr.indexOf(v); if(i>=0) arr.splice(i,1); else arr.push(v); }
function refreshListControls(){
  const noFilter=!S.fKinds.length&&!S.fCats.length;
  const set=(b,on)=>{ b.classList.toggle('active',on); b.setAttribute('aria-pressed',on); };
  const allB=document.querySelector('[data-all]'); if(allB) allB.classList.toggle('active',noFilter);
  document.querySelectorAll('[data-kind]').forEach(b=>set(b,S.fKinds.includes(b.dataset.kind)));
  document.querySelectorAll('[data-cat]').forEach(b=>set(b,S.fCats.includes(b.dataset.cat)));
  document.querySelectorAll('[data-view]').forEach(b=>set(b,S.listView===b.dataset.view));
  const sb=document.getElementById('sortBtn'); if(sb){ const l=(SORTS.find(s=>s[0]===S.sort)||SORTS[0])[1]; sb.querySelector('span:last-child').textContent=l; sb.setAttribute('aria-label',`排序：${l}，點一下換排序`); }
  renderListBody();
}
function filteredRows(){
  let rows=applyFilters(S.tx,{period:S.period,exclude:S.exclude}).slice();
  if(S.fKinds.length) rows=rows.filter(t=>S.fKinds.includes(t.kind));
  if(S.fCats.length) rows=rows.filter(t=>S.fCats.includes(t.cat));
  const q=S.search.trim().toLowerCase();
  if(q) rows=rows.filter(t=>`${t.desc} ${t.cat} ${t.payer} ${t.method}`.toLowerCase().includes(q));
  const [k,d]=S.sort.split('-'), dir=d==='desc'?-1:1;
  const cmp=(a,b)=>(k==='amt'?a.amt-b.amt:(a.date?.sort||0)-(b.date?.sort||0))||(a.id-b.id);
  return rows.sort((a,b)=>cmp(a,b)*dir);
}
function listRows(){
  const rows=filteredRows();
  if(!rows.length) return emptyState('search_off','找不到符合的交易','換個關鍵字，或點「全部」清除篩選');
  const sum=rows.reduce((a,b)=>a+b.amt,0), photos=rows.filter(t=>t.rc);
  const head=summaryCard(rows,sum,photos.length);
  if(S.listView==='photo')
    return head+(photos.length?`<div class="rc-grid" data-seq="photo">${photos.map(rcTile).join('')}</div>`
      :emptyState('photo_library','沒有收據照片','在 LINE 傳收據給記帳機器人，照片會自動出現在這裡'));
  if(S.sort.startsWith('date')){
    const g=new Map(); for(const t of rows){ const k=t.date?t.date.iso:'—'; if(!g.has(k)) g.set(k,[]); g.get(k).push(t); }
    const groups=[...g.values()].map(ts=>`<div class="daygroup"><div class="dayhead"><span class="d">${ts[0].date?dayLabel(ts[0].date):'無日期'}</span><span class="t num">${fmtY(ts.reduce((a,b)=>a+b.amt,0))}</span></div>${ts.map(t=>txRow(t,false)).join('')}</div>`).join('');
    return head+`<div class="card pad-sm" data-seq="list">${groups}</div>`;
  }
  return head+`<div class="card pad-sm" data-seq="list">${rows.map(t=>txRow(t,true)).join('')}</div>`;
}
function renderListBody(){ const el=document.getElementById('listBody'); if(el) el.innerHTML=listRows(); }

const PAY_META={'現金':{ic:'payments',c:'#9fe870'},'信用卡':{ic:'credit_card',c:'#163300'},'SUICA':{ic:'contactless',c:'#74b84b'},'銀行轉帳':{ic:'account_balance',c:'#8a9282'},'轉帳':{ic:'account_balance',c:'#8a9282'},'電子支付':{ic:'qr_code_2',c:'#bfe4a1'}};
function payMeta(m){ return PAY_META[m]||{ic:'more_horiz',c:'#c2c6bc'}; }
/* 筆數＋總額＋付款方式，一張精簡卡 */
function summaryCard(rows,sum,nPhoto){
  const by={}; for(const t of rows){ const m=t.method||'其他'; by[m]=(by[m]||0)+t.amt; }
  const order=Object.entries(by).sort((a,b)=>b[1]-a[1]);
  const segs=order.map(([m,v])=>`<i style="width:${pct(v,sum)}%;background:${payMeta(m).c}" title="${esc(m)} ${fmtY(v)}"></i>`).join('');
  const legend=order.map(([m,v])=>{ const md=payMeta(m); return `<span class="pl"><span class="pay-ic" style="color:${md.c}">${ic(md.ic,'fill')}</span>${esc(m)} <b class="num">${fmtY(v)}</b></span>`; }).join('');
  return `<div class="card pad-sm pay-card">
    <div class="pay-head"><span class="num"><b>${rows.length}</b> 筆${nPhoto?` · <b>${nPhoto}</b> 張照片`:''}</span><span class="num pay-sum">${fmtY(sum)}</span></div>
    <div class="pay-bar" role="img" aria-label="付款方式比例：${esc(order.map(([m,v])=>`${m} ${pct(v,sum).toFixed(0)}%`).join('、'))}">${segs}</div>
    <div class="pay-legend">${legend}</div>
  </div>`;
}

/* =========================================================================
   Shared rows / tiles
   ========================================================================= */
/* 交易列：標題只放店名（品項在詳情裡）；有收據就用照片縮圖當頭像；整列可點開詳情 */
function txRow(t,showDate){
  const lead=t.rc
    ?`<span class="thumb"><img src="${esc(thumbOf(t.rc))}" data-full="${esc(t.rc)}" alt="" loading="lazy" decoding="async" onerror="thumbErr(this)"></span>`
    :`<span class="ico">${ic(catIcon(t.cat))}</span>`;
  return `<div class="tx" data-tx="${t.id}" role="button" tabindex="0" aria-label="${esc(`${storeOf(t)} ${fmtY(t.amt)}${t.rc?'，有收據照片':''}`)}">${lead}
    <div class="body"><div class="t1">${esc(storeOf(t))}</div>
    <div class="t2"><span class="tag ${t.kind==='共同'?'c':''}">${esc(t.kind||'—')}</span><span>${esc(t.cat)}</span><span>·</span><span>${esc(t.payer||'—')}</span>${showDate&&t.date?`<span>·</span><span>${t.date.m}/${t.date.d}</span>`:''}</div></div>
    <div class="amt num">${fmtY(t.amt)}</div></div>`;
}
function rcTile(t){
  return `<button class="rc" data-tx="${t.id}" aria-label="${esc(`${storeOf(t)} ${fmtY(t.amt)} ${t.date?t.date.iso:''}，收據照片`)}">
    <img src="${esc(thumbOf(t.rc))}" data-full="${esc(t.rc)}" alt="" loading="lazy" decoding="async" onerror="thumbErr(this)">
    <span class="rc-cap"><b class="num">${fmtY(t.amt)}</b><span>${esc(storeOf(t))}</span></span></button>`;
}
function emptyRow(){ return `<div class="empty">沒有資料</div>`; }
function emptyState(icn,title,hint){ return `<div class="card"><div class="empty-state">${ic(icn)}<b>${title}</b>${hint?`<span>${hint}</span>`:''}</div></div>`; }
function skeleton(){ return `<div class="card dark" style="height:140px"></div>
  <div class="grid g-2"><div class="card"><div class="skel" style="height:70px"></div></div><div class="card"><div class="skel" style="height:70px"></div></div></div>
  <div class="card"><div class="skel" style="height:18px;margin:6px 0;width:60%"></div><div class="skel" style="height:18px;margin:6px 0"></div><div class="skel" style="height:18px;margin:6px 0;width:75%"></div></div>`; }
function errorState(){ return `<div class="card" style="text-align:center;padding:40px 20px">
  <div class="ico" style="margin:0 auto 12px;width:52px;height:52px">${ic('cloud_off')}</div>
  <h2>讀不到試算表</h2><p class="sub" style="margin-top:6px">${esc(S.error||'')}</p>
  <p style="color:var(--mute);font-size:12.5px;margin-top:10px">請確認試算表共用為「知道連結的任何人 → 檢視者」</p>
  <div style="margin-top:16px"><button class="chip active" onclick="loadData(true)">重新嘗試</button> <a class="chip" href="${CONFIG.sheetUrl}" target="_blank" rel="noopener">開啟試算表</a></div></div>`; }

/* =========================================================================
   詳情 — 點任何一筆：收據大圖（左右切換）＋金額、店名、日期、品項
   ========================================================================= */
const DT={el:null,open:false,seq:[],i:0,ret:null};
function bindDetail(){
  const v=document.getElementById('view');
  const openFrom=el=>{
    const box=el.closest('[data-seq]');
    const ids=box?[...document.querySelectorAll(`#view [data-seq="${box.dataset.seq}"] [data-tx]`)].map(x=>+x.dataset.tx):[+el.dataset.tx];
    openDetail(+el.dataset.tx,ids);
  };
  v.addEventListener('click',e=>{ const el=e.target.closest('[data-tx]'); if(el) openFrom(el); });
  v.addEventListener('keydown',e=>{ if((e.key==='Enter'||e.key===' ')&&e.target.matches('.tx[data-tx]')){ e.preventDefault(); openFrom(e.target); } });
  addEventListener('popstate',()=>{ if(DT.open) closeDetail(true); });   // 手機返回鍵／返回手勢 = 關閉詳情，不離開頁面
  document.addEventListener('keydown',e=>{
    if(!DT.open) return;
    if(e.key==='Escape'){ e.preventDefault(); closeDetail(); }
    else if(e.key==='ArrowLeft') stepDetail(-1);
    else if(e.key==='ArrowRight') stepDetail(1);
    else if(e.key==='Tab'){   // 焦點留在視窗內
      const f=[...DT.el.querySelectorAll('button:not([disabled]),a[href]')].filter(x=>x.offsetParent);
      if(!f.length) return; const a=f[0], z=f[f.length-1];
      if(e.shiftKey&&document.activeElement===a){ e.preventDefault(); z.focus(); }
      else if(!e.shiftKey&&document.activeElement===z){ e.preventDefault(); a.focus(); }
    }
  });
}
function buildDetailEl(){
  const el=document.createElement('div');
  el.className='dt'; el.hidden=true;
  el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-labelledby','dtTitle');
  el.innerHTML=`
    <div class="dt-top">
      <span class="dt-count num"></span>
      <a class="dt-btn dt-orig" target="_blank" rel="noopener" aria-label="開啟原圖">${ic('open_in_new')}</a>
      <button class="dt-btn dt-close" aria-label="關閉">${ic('close')}</button>
    </div>
    <div class="dt-stage">
      <div class="dt-img"></div>
      <button class="dt-nav prev" aria-label="上一筆">${ic('chevron_left')}</button>
      <button class="dt-nav next" aria-label="下一筆">${ic('chevron_right')}</button>
    </div>
    <div class="dt-info"></div>`;
  el.querySelector('.dt-close').onclick=()=>closeDetail();
  el.querySelector('.prev').onclick=()=>stepDetail(-1);
  el.querySelector('.next').onclick=()=>stepDetail(1);
  el.querySelector('.dt-stage').addEventListener('click',e=>{ if(e.target.classList.contains('dt-stage')||e.target.classList.contains('dt-img')||e.target.closest('.dt-noimg')) closeDetail(); });   // 點照片外的暗處 = 關閉
  // 手機：左右滑換一筆、往下滑關閉
  let st=null; const stage=el.querySelector('.dt-stage');
  stage.addEventListener('touchstart',e=>{ st=e.touches.length===1?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null; },{passive:true});
  stage.addEventListener('touchend',e=>{ if(!st) return; const dx=e.changedTouches[0].clientX-st.x, dy=e.changedTouches[0].clientY-st.y; st=null;
    if(Math.abs(dx)>50&&Math.abs(dx)>1.5*Math.abs(dy)) stepDetail(dx<0?1:-1);
    else if(dy>90&&dy>1.5*Math.abs(dx)) closeDetail(); },{passive:true});
  document.body.appendChild(el);
  return el;
}
function openDetail(id,seq){
  if(!S.tx[id]) return;
  DT.el=DT.el||buildDetailEl();
  DT.seq=(seq&&seq.includes(id))?seq:[id]; DT.i=DT.seq.indexOf(id);
  if(!DT.open){
    DT.ret=document.activeElement; DT.open=true;
    history.pushState({dt:1},'');
    DT.el.hidden=false; document.body.classList.add('dt-lock');
    requestAnimationFrame(()=>DT.el.classList.add('on'));
  }
  renderDetail();
  DT.el.querySelector('.dt-close').focus({preventScroll:true});
}
function closeDetail(fromPop){
  if(!DT.open) return;
  DT.open=false;
  DT.el.classList.remove('on'); document.body.classList.remove('dt-lock');
  setTimeout(()=>{ if(!DT.open) DT.el.hidden=true; },160);
  if(!fromPop&&history.state&&history.state.dt) history.back();
  if(DT.ret&&document.contains(DT.ret)) DT.ret.focus({preventScroll:true});
}
function stepDetail(d){ const n=DT.i+d; if(!DT.open||n<0||n>=DT.seq.length) return; DT.i=n; renderDetail(); }
function itemRow(s){
  const m=s.match(/^(.*?)\s*[:：]?\s*[¥￥]\s*([\d,]+(?:\.\d+)?)\s*$/);
  return m?`<li><span>${esc(m[1]||'—')}</span><span class="num">¥${esc(m[2])}</span></li>`:`<li><span>${esc(s)}</span></li>`;
}
function renderDetail(){
  const t=S.tx[DT.seq[DT.i]]; if(!t) return closeDetail();
  const el=DT.el, items=itemsOf(t), n=DT.seq.length;
  el.classList.toggle('no-img',!t.rc);
  el.querySelector('.dt-count').textContent=n>1?`${DT.i+1} / ${n}`:'';
  const orig=el.querySelector('.dt-orig'); if(t.rc){ orig.href=t.rc; orig.hidden=false; } else { orig.removeAttribute('href'); orig.hidden=true; }
  el.querySelector('.prev').disabled=DT.i<=0;
  el.querySelector('.next').disabled=DT.i>=n-1;
  el.querySelectorAll('.dt-nav').forEach(b=>b.hidden=n<2);
  const box=el.querySelector('.dt-img');
  box.style.backgroundImage=t.rc?`url("${thumbOf(t.rc)}")`:'none';   // 先顯示縮圖，原圖載好再蓋上
  box.innerHTML=t.rc
    ?`<img src="${esc(t.rc)}" alt="${esc(storeOf(t))} 收據照片" onload="this.classList.add('ok')" onerror="this.parentNode.style.backgroundImage='none';this.outerHTML='<div class=&quot;dt-noimg&quot;><span class=&quot;ms&quot;>broken_image</span>照片載入失敗</div>'">`
    :`<div class="dt-noimg">${ic('hide_image')}<span>沒有收據照片</span></div>`;
  el.querySelector('.dt-info').innerHTML=`
    <div class="dt-amt num">${fmtY(t.amt)}</div>
    <div class="dt-store" id="dtTitle">${esc(storeOf(t))}</div>
    <div class="dt-meta">
      ${t.date?`<span>${ic('event')}${t.date.iso}</span>`:''}
      <span>${ic(catIcon(t.cat))}${esc(t.cat)}</span>
      <span>${ic('person')}${esc(t.payer||'—')}</span>
      <span>${ic(payMeta(t.method||'其他').ic)}${esc(t.method||'—')}</span>
      <span class="${t.kind==='共同'?'c':''}">${ic(t.kind==='共同'?'group':'person_outline')}${esc(t.kind||'—')}</span>
    </div>
    ${items.length?`<ul class="dt-items">${items.map(itemRow).join('')}</ul>`:''}`;
  el.querySelector('.dt-info').scrollTop=0;
  // 預載前後一筆的原圖，左右切換不用等
  [DT.seq[DT.i-1],DT.seq[DT.i+1]].forEach(j=>{ const x=S.tx[j]; if(x&&x.rc){ const im=new Image(); im.decoding='async'; im.src=x.rc; } });
}

/* global handlers */
function go(tab){
  if(S.tab===tab){ window.scrollTo({top:0,behavior:'smooth'}); return; }
  location.hash='#/'+tab;   // hashchange 觸發 render；瀏覽器返回鍵可用
}
function setPeriod(m){ S.period=m; buildPeriod(); renderView(); }
function setSplitView(m){ S.splitView=m; savePrefs(); renderView(); }
function showCategory(n){ S.fCats=[n]; S.fKinds=[]; S.search=''; S.listView='list'; if(S.tab==='list') renderView(); else go('list'); }

document.addEventListener('DOMContentLoaded',boot);
