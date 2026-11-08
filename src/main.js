import { upload } from '@vercel/blob/client';
import { zipSync, unzipSync, strFromU8 } from 'fflate';
import './style.css';

const ROLES=[
  {key:'super_admin',label:'Super Admin',tok:'--role-sa'},
  {key:'graphic_designer',label:'Graphic Designer',tok:'--role-gd'},
  {key:'media_buyer',label:'Media Buyer',tok:'--role-mb'},
  {key:'content_creator',label:'Content Creator',tok:'--role-cc'},
  {key:'moderator',label:'Moderator',tok:'--role-mo'},
  {key:'pr',label:'PR',tok:'--role-pr'},
  {key:'ecommerce',label:'E-Commerce',tok:'--role-ec'},
  {key:'ceo',label:'CEO',tok:'--role-ceo'},
];
const ROLE=Object.fromEntries(ROLES.map(r=>[r.key,r]));
const TYPES={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',mp4:'video/mp4',webm:'video/webm',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',md:'text/markdown',json:'application/json'};

const S={ov:{role:'',period:'all',open:'',q:'',f:'',who:'',d:'',sk:'',sd:'asc'},reads:new Set(),seenUnread:null,comments:[],revs:[],thr:{},draft:{},amend:null,amendFiles:[],shop:{month:'',metric:'revenue',best:'units',geo:'countries',data:null,loading:false,err:'',syncing:false,syncMsg:''},sel:new Set(),assets:true,lastJson:'',users:[],instructions:[],subs:[],usersReady:false,screen:null,me:null,route:'hub',param:null,
  sendRoles:new Set(),sendUsers:new Set(),fRole:'',fUser:'',fKind:'',pwOpen:null,picked:{}};

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const isAdmin=()=>S.me&&S.me.role==='super_admin';
const isCeo=()=>S.me&&S.me.role==='ceo';
const roleChip=k=>{const r=ROLE[k]||{label:k,tok:'--muted'};return `<span class="chip" style="--rc:var(${r.tok})">${esc(r.label)}</span>`};
const fmtDate=ms=>{if(!ms)return'';const d=new Date(ms);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+', '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})};
const fmtSize=b=>b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB';
const userById=id=>S.users.find(u=>u.id===id);
let toastT;function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,3200)}

/* ---------- data ---------- */
async function api(method,url,body,ms){
  let r,ac=ms?new AbortController():null,tm=ac&&setTimeout(()=>ac.abort(),ms);
  try{r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,credentials:'same-origin',signal:ac?ac.signal:undefined})}
  catch(e){throw new Error(e&&e.name==='AbortError'?'This is taking longer than '+Math.round(ms/1000)+' seconds.':'Cannot reach the server. Check your connection.')}
  finally{if(tm)clearTimeout(tm)}
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok){const err=new Error(j.error||'Something went wrong.');err.status=r.status;throw err}
  return j;
}
async function refresh(){
  const j=await api('GET','/api/data');
  const key=JSON.stringify(j);
  if(key===S.lastJson&&S.usersReady)return;
  S.lastJson=key;
  if(j.setup){S.users=[];S.me=null;S.instructions=[];S.subs=[];S.usersReady=true;S.mode='setup';return onData()}
  if(!j.me){S.me=null;S.users=[];S.mode='login';S.usersReady=true;return onData()}
  S.mode='app';
  S.users=j.users;S.instructions=j.instructions;S.subs=j.submissions;S.speeds=j.speeds||[];S.comments=j.comments||[];S.revs=j.revisions||[];S.reads=new Set(j.reads||[]);S.usersReady=true;
  const roleChanged=!S.me||S.me.role!==j.me.role||S.me.id!==j.me.id;
  const wasNull=!S.me;S.me=j.me;
  if(wasNull||roleChanged){if(roleChanged&&!wasNull){S.route='hub';S.param=null}showApp()}
  else if(S.screen==='app')update();
}
async function sync(){try{await refresh()}catch(e){if(S.screen==='boot')fatal(e.message)}}
async function boot(){
  S.screen='boot';
  await sync();
  setInterval(()=>{if(!document.hidden&&S.screen!=='boot')sync()},8000);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&S.act.open){S.act.open='';renderAct()}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});
}
function fatal(msg){S.screen='fatal';$('#app').innerHTML=`<div class="loading"><div style="display:grid;gap:8px;max-width:420px"><h2>Team hub unavailable</h2><p>${esc(msg)}</p></div></div>`}

function onData(){
  if(S.mode==='setup'){if(S.screen!=='setup')showSetup();return}
  if(S.mode==='login'){
    if(S.screen==='app'){toast('You were signed out. Sign in again.')}
    if(S.screen!=='login')showLogin();
    return;
  }
}
async function logout(msg){try{await api('POST','/api/auth?action=logout')}catch(e){}S.lastJson='';S.me=null;S.shop.data=null;S.meta.data=null;S.meta.cache={};S.speeds=[];S.sel.clear();renderSelBar();S.mode='login';showLogin();if(msg)toast(msg)}

/* ---------- auth screens ---------- */
const brandHTML=`<div class="brand"><img class="logo" src="/bless-logo.png" alt="Bless" width="116" height="44"><small>Team Hub</small></div>`;
function showSetup(){
  S.screen='setup';
  $('#app').innerHTML=`<div class="auth"><form class="auth-card" data-form="setup">${brandHTML}
    <div><h1 style="font-size:1.4rem">Create the Super Admin</h1><p class="muted" style="margin-top:6px">No accounts exist yet. This first account controls the hub: it sends instructions, sees every upload and manages users.</p></div>
    <div class="field"><label for="su-u">Username</label><input class="input" id="su-u" autocomplete="username" required></div>
    <div class="field"><label for="su-p">Password</label><input class="input" id="su-p" type="password" autocomplete="new-password" minlength="4" required></div>
    <div class="field"><label for="su-p2">Confirm password</label><input class="input" id="su-p2" type="password" autocomplete="new-password" required></div>
    <div class="err" id="su-err"></div>
    <button class="btn primary" type="submit">Create account and sign in</button></form></div>`;
}
function showLogin(){
  S.screen='login';
  $('#app').innerHTML=`<div class="auth"><form class="auth-card" data-form="login">${brandHTML}
    <div><h1 style="font-size:1.4rem">Sign in</h1><p class="muted" style="margin-top:6px">Use the username and password your Super Admin gave you.</p></div>
    <div class="field"><label for="li-u">Username</label><input class="input" id="li-u" autocomplete="username" required></div>
    <div class="field"><label for="li-p">Password</label><input class="input" id="li-p" type="password" autocomplete="current-password" required></div>
    <div class="err" id="li-err"></div>
    <button class="btn primary" type="submit">Sign in</button></form></div>`;
  setTimeout(()=>$('#li-u')?.focus(),0);
}
const validName=u=>u.length>=2&&u.length<=40;

/* ---------- app shell ---------- */
const NAV_ICON={
  hub:'<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  dash:'<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  home:'<rect x="4" y="4" width="7" height="7" rx="1.500"/><rect x="13" y="4" width="7" height="7" rx="1.500"/><rect x="4" y="13" width="7" height="7" rx="1.500"/><rect x="13" y="13" width="7" height="7" rx="1.500"/>',
  send:'<path d="M21 4 3 10.5l7 3 3 7L21 4Z"/><path d="m10 13.5 5-5"/>',
  content:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 11h18"/>',
  eval:'<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>',
  shop:'<path d="M5 8h14l-1.1 12H6.1L5 8Z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/><path d="M9.5 12.5c.6 1 1.4 1.5 2.5 1.5s1.9-.5 2.5-1.5"/>',
  odoo:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 3.5v5.5M12 15v5.5M3.5 12H9M15 12h5.5"/>',
  meta:'<path d="M4 14V10l11-5v14L4 14Z"/><path d="M7 14.5 8.2 19h2.6L9.6 15"/><path d="M18.5 9.5a3.5 3.5 0 0 1 0 5"/>',
  team:'<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 6a3 3 0 0 1 0 5.5M18.5 14.3c1.7.7 2.5 2.200 2.5 4.700"/>',
  notes:'<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.500a2.200 2.200 0 0 0 4 0"/>',
  users:'<circle cx="12" cy="8" r="3.500"/><path d="M5 20c0-3.500 3-6 7-6s7 2.500 7 6"/>',
  act:'<path d="M3 12h3.500l2-6 4 12 2.500-8 1.500 2H21"/>',
  uploads:'<path d="M12 16V5M7.500 9.500 12 5l4.500 4.500"/><path d="M5 15v3.500a1.500 1.500 0 0 0 1.500 1.500h11a1.500 1.500 0 0 0 1.500-1.500V15"/>',
  ins:'<rect x="6" y="4.500" width="12" height="16" rx="2"/><path d="M9.500 4.500h5v2.500h-5zM9 11h6M9 14.500h6M9 18h3.500"/>'
};
const navIco=k=>`<svg class="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICON[k]||NAV_ICON.home}</svg>`;
const DASH_TABS=[['dash','All together'],['shop','Shopify'],['odoo','Odoo'],['meta','Meta Ads']];
const dashSys=()=>!!S.inDash&&['shop','odoo','meta'].includes(S.route);
function dashTabs(){const cur=S.route;return `<div class="dtbar"><div class="dtabs" role="tablist" aria-label="Dashboards sections">${DASH_TABS.map(([k,l])=>`<button class="dtab${cur===k?' on':''}" role="tab" aria-selected="${cur===k}" data-act="dtab" data-t="${k}">${l}</button>`).join('')}</div><button class="btn sm ghost" data-act="go" data-route="hub">← All reports</button></div>`}
const SIDE_MIN_KEY='hub_side_min';
const THEME_KEY='bless-theme';
function theme(){try{return localStorage.getItem(THEME_KEY)==='light'?'light':'dark'}catch(e){return document.documentElement.dataset.theme==='light'?'light':'dark'}}
function applyTheme(){document.documentElement.dataset.theme=theme()}
function toggleTheme(){const n=theme()==='light'?'dark':'light';try{localStorage.setItem(THEME_KEY,n)}catch(e){document.documentElement.dataset.theme=n}applyTheme();try{renderNav()}catch(e){}}
applyTheme();
function sideMin(){try{return localStorage.getItem(SIDE_MIN_KEY)==='1'}catch(e){return false}}
function applySideMin(){document.body.classList.toggle('side-min',sideMin())}
function toggleSide(){try{localStorage.setItem(SIDE_MIN_KEY,sideMin()?'0':'1')}catch(e){document.body.classList.toggle('side-min')}applySideMin()}
function navItems(){
  const nu=unreadNotes().length;
  if(isAdmin())return [['hub','Home'],['dash','Dashboards'],['home','Team overview'],['send','Send instruction'],['content','All content'],['eval','Evaluation'],['shop','Shopify'],['odoo','Odoo'],['meta','Meta Ads'],['team','Team by role'],['notes','Notifications',nu],['act','Activity'],['users','Users']];
  if(isCeo())return [['hub','Home'],['dash','Dashboards'],['shop','Shopify'],['odoo','Odoo'],['meta','Meta Ads']];
  const pending=myInstructions().filter(i=>!responded(i.id)).length;
  return [['home','Instructions',pending],['uploads','My uploads'],['notes','Notifications',nu],['team','Team by role']];
}
function showApp(){
  S.screen='app';applySideMin();
  $('#app').innerHTML=`<div class="shell"><aside class="side">${brandHTML}<nav class="nav" id="nav" aria-label="Pages"></nav>
    <div class="me"><div class="who"><b>${esc(S.me.username)}</b>${roleChip(S.me.role)}</div><button class="btn sm so" data-act="logout" title="Sign out"><svg class="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/></svg><span class="nl">Sign out</span></button></div><button class="sidetog" data-act="theme-toggle" title="Switch between dark and light" aria-label="Switch theme"><svg class="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.800A9 9 0 1 1 11.200 3a7 7 0 0 0 9.800 9.800z"/></svg><span class="nl">${theme()==='light'?'Dark mode':'Light mode'}</span></button><button class="sidetog" data-act="side-toggle" title="Make the menu smaller or larger" aria-label="Toggle menu size"><svg class="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m14.500 7-5 5 5 5"/></svg><span class="nl">Make smaller</span></button></aside>
    <main class="main"><div class="wrap" id="view"></div></main></div>`;
  mount();
}
function renderNav(){
  document.body.classList.toggle('on-hub',S.route==='hub');
  $('#nav').innerHTML=navItems().map(([k,l,c])=>`<button data-act="go" data-route="${k}" title="${esc(l)}" ${(dashSys()?k==='dash':S.route===k||(S.route==='ins'&&k===(isAdmin()?'send':'home')))?'aria-current="page"':''}>${navIco(k==='home'&&!isAdmin()?'ins':k)}<span class="nl">${l}</span>${c?`<span class="count">${c}</span>`:''}</button>`).join('');
}
function go(route,param,inDash){S.route=route;S.param=param||null;S.inDash=!!inDash;mount();window.scrollTo(0,0);try{history.replaceState(null,'','#'+(route==='ins'?'ins-'+param:route))}catch(e){}}

/* ---------- derived ---------- */
function myInstructions(){return S.instructions.filter(i=>(i.roles||[]).includes(S.me.role)||(i.userIds||[]).includes(S.me.id))}
function responded(insId,uid){uid=uid||S.me.id;return S.subs.some(s=>s.instructionId===insId&&s.userId===uid)}
function recipients(ins){return S.users.filter(u=>u.role!=='super_admin'&&((ins.roles||[]).includes(u.role)||(ins.userIds||[]).includes(u.id)))}
function targetChips(ins){
  const r=(ins.roles||[]).map(roleChip);
  const u=(ins.userIds||[]).map(id=>{const x=userById(id);return `<span class="mono">${esc(x?x.username:'removed')}</span>`});
  return [...r,...u].join(' ');
}

/* ---------- views: mount builds static parts (forms), update fills live parts ---------- */
function mount(){
  const v=$('#view');const r=S.route;
  if(isCeo()){if(!['hub','dash','shop','odoo','meta'].includes(S.route))S.route='hub'}
  else if(!isAdmin()&&['hub','dash','send','content','users','shop','eval','odoo','meta','act'].includes(r)){S.route='home'}
  if(S.route==='hub')v.innerHTML=`<div id="live"></div>`;
  else if(S.route==='dash'){v.innerHTML=`<div id="live"></div>`;if(!S.dash.d.shop&&!S.dash.busy)loadDash(false,true)}
  else if(S.route==='home')v.innerHTML=isAdmin()?`<div id="live"></div>`
    :`<div class="head"><div><h1>Instructions</h1><p>Briefs from your Super Admin. Open one to send back your files.</p></div><button class="btn" data-act="go" data-route="uploads">Upload without an instruction</button></div><div id="live"></div>`;
  else if(S.route==='ins')v.innerHTML=`<button class="btn ghost back" data-act="go" data-route="${isAdmin()?'send':'home'}">← Back</button><div id="live"></div>${isAdmin()?'':`<div class="panel"><div><h2>Respond</h2><p class="muted">Attach your files and add a note if needed.</p></div>${uploadForm('resp')}</div>`}<div id="live2"></div>`;
  else if(S.route==='uploads')v.innerHTML=`<div class="head"><div><h1>My uploads</h1><p>Everything you have sent. Add files here even when there is no instruction.</p></div></div><div class="panel"><h2>Upload files</h2>${uploadForm('free')}</div><div id="live"></div>`;
  else if(S.route==='notes')v.innerHTML=`<div class="head"><div><h1>Notifications</h1><p>Comments on tasks. Click one to open the conversation.</p></div></div><div id="live"></div>`;
  else if(S.route==='team')v.innerHTML=`<div class="head"><div><h1>Team by role</h1><p>Every username, grouped by role.</p></div></div><div id="live"></div>`;
  else if(S.route==='send')v.innerHTML=`<div class="head"><div><h1>Send instruction</h1><p>Write the brief, then choose whole roles, specific people, or both.</p></div></div>
    <form class="panel" data-form="send">
      <div class="field"><label for="in-t">Title</label><input class="input" id="in-t" maxlength="120" placeholder="Do the post for Friday's offer" required></div>
      <div class="field"><label for="in-b">Instructions</label><textarea class="textarea" id="in-b" placeholder="Sizes, copy, deadline, references…" required></textarea></div>
      <div class="field"><label>Send to roles</label><div class="checks" id="in-roles">${ROLES.filter(r=>r.key!=='super_admin'&&r.key!=='ceo').map(r=>`<label class="check"><input type="checkbox" id="role-${r.key}" value="${r.key}" data-act="pick-role" ${S.sendRoles.has(r.key)?'checked':''}>${roleChip(r.key)}</label>`).join('')}</div></div>
      <div class="field"><label>Or send to specific people</label><div id="in-people"></div></div>
      <div class="row" style="justify-content:space-between"><span class="muted" id="in-count"></span><button class="btn primary" type="submit">Send instruction</button></div>
      <div class="err" id="in-err"></div>
    </form><div id="live"></div>`;
  else if(S.route==='content')v.innerHTML=`<div class="head"><div><h1>All content</h1><p>Every file and note your team has added.</p></div></div>
    <div class="row"><select class="select" id="f-role" style="width:auto" aria-label="Filter by role"><option value="">All roles</option>${ROLES.filter(r=>r.key!=='super_admin').map(r=>`<option value="${r.key}" ${S.fRole===r.key?'selected':''}>${r.label}</option>`).join('')}</select>
    <select class="select" id="f-user" style="width:auto" aria-label="Filter by person"></select>
    <select class="select" id="f-kind" style="width:auto" aria-label="Filter by type"><option value="">Responses and uploads</option><option value="resp" ${S.fKind==='resp'?'selected':''}>Responses to instructions</option><option value="free" ${S.fKind==='free'?'selected':''}>Uploads without instruction</option></select></div><div id="live"></div>`;
  else if(S.route==='eval'){v.innerHTML=`<div class="head"><div><h1>Team evaluation</h1><p>Monthly KPIs and ranking. You enter the speed and accuracy percentages; HR gives behaviour once a month.</p></div></div><div id="live"></div>`;if(!S.ev.data&&!S.ev.loading)loadEval();else renderEval(true)}
  else if(S.route==='odoo'){v.innerHTML=`<div class="head"><div><h1>Odoo</h1><p>Supply, sales and finance, read live from Odoo.</p></div></div><div id="live"></div>`;if(!S.od.cache[S.od.tab+'|'+(S.od.month||'')]&&!S.od.loading)loadOdoo();else renderOdoo()}
  else if(S.route==='meta'){v.innerHTML=`<div class="head"><div><h1>Meta Ads</h1><p>Facebook and Instagram advertising, read live from Meta. Pause campaigns and change budgets from here.</p></div></div><div id="live"></div>`;if(!S.meta.cache[S.meta.tab+'|'+(S.meta.month||'')]&&!S.meta.loading)loadMeta();else renderMeta()}
  else if(S.route==='shop'){v.innerHTML=`<div class="head"><div><h1>Shopify</h1><p>Sales, funnel, products, customer experience and retention, one tab each.</p></div></div><div id="live"></div>`;if(S.an.tab==='overview'){if(!S.shop.data&&!S.shop.loading)loadShop()}else loadAn();}
  else if(S.route==='act')v.innerHTML=`<div id="live"></div>`;
  else if(S.route==='users')v.innerHTML=`<div class="head"><div><h1>Users</h1><p>Add people, change their role, or set a new password.</p></div></div>
    <form class="panel" data-form="adduser"><h2>Add a user</h2><div class="grid2">
      <div class="field"><label for="nu-u">Username</label><input class="input" id="nu-u" autocomplete="off" required></div>
      <div class="field"><label for="nu-p">Password</label><input class="input" id="nu-p" type="text" autocomplete="off" minlength="4" required></div>
      <div class="field"><label for="nu-r">Role</label><select class="select" id="nu-r">${ROLES.map(r=>`<option value="${r.key}" ${r.key==='graphic_designer'?'selected':''}>${r.label}</option>`).join('')}</select></div></div>
      <div class="row" style="justify-content:space-between"><span class="err" id="nu-err"></span><button class="btn primary" type="submit">Add user</button></div></form><div id="live"></div>`;
  v.classList.toggle('indash',dashSys());
  if(dashSys())v.insertAdjacentHTML('afterbegin',dashTabs());
  update();
}

function update(){
  if(S.screen!=='app')return;renderNav();notifyNew();
  const L=$('#live');if(!L)return;const r=S.route;
  if(r==='hub')L.innerHTML=hubHTML();
  else if(r==='dash')dashFill();
  else if(r==='home'&&isAdmin()){L.innerHTML=overviewHTML();ovSpy();loadPulse()}
  else if(r==='home')L.innerHTML=inboxHTML();
  else if(r==='ins')updateIns();
  else if(r==='uploads')L.innerHTML=listOrEmpty(S.subs.filter(s=>s.userId===S.me.id),'Nothing uploaded yet','Files you upload, with or without an instruction, appear here.');
  else if(r==='notes')L.innerHTML=notesHTML();
  else if(r==='team')L.innerHTML=teamHTML();
  else if(r==='send')updateSend();
  else if(r==='content')updateContent();
  else if(r==='users')L.innerHTML=usersHTML();
  else if(r==='act')renderAct();
  else if(r==='shop')renderShop();
  else if(r==='odoo')renderOdoo();
  else if(r==='meta')renderMeta();
  else if(r==='eval')renderEval();
  syncUploadAvail();renderSelBar();
}

function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening'}
const OV_PERIODS=[['all','All time',0],['7','Last 7 days',7],['30','Last 30 days',30],['month','This month',-1]];
function ovCut(){const p=S.ov.period;if(p==='all')return 0;if(p==='month'){const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1).getTime()}return Date.now()-Number(p)*864e5}
function ovFilters(){
  const o=S.ov,sel=(k,opts)=>`<select class="input" data-ov="${k}" aria-label="${k}">${opts.map(([v,l])=>`<option value="${esc(v)}"${o[k]===v?' selected':''}>${esc(l)}</option>`).join('')}</select>`;
  return `<div class="ovfilters"><span class="eyebrow">Filter</span>${sel('role',[['','All roles'],...ROLES.filter(r=>r.key!=='super_admin').map(r=>[r.key,r.label])])}${sel('period',OV_PERIODS.map(p=>[p[0],p[1]]))}${(o.role||o.period!=='all')?'<button class="btn sm" data-act="ov-reset">Clear filters</button>':''}<span class="muted" style="font-size:.85rem">Click a card to open its report.</span></div>`;
}
function ovCtx(){
  const cut=ovCut(),fr=S.ov.role;
  return {team:S.users.filter(u=>u.role!=='super_admin'&&(!fr||u.role===fr)),ins:S.instructions.filter(i=>i.createdAt>=cut&&(!fr||recipients(i).some(u=>u.role===fr))),subs:S.subs.filter(x=>x.createdAt>=cut&&(!fr||x.role===fr))};
}
const OV_STATUS={team:[['','All statuses'],['waiting','Has waiting items'],['clear','All answered']],sent:[['','All statuses'],['full','Fully answered'],['part','Partly answered'],['none','No response yet']],waiting:[['','Any waiting time'],['3','Waiting 3+ days'],['7','Waiting 7+ days'],['14','Waiting 14+ days']],files:[['','All file types'],['image','Images'],['video','Videos'],['doc','Documents'],['other','Other']]};
const OV_SEARCH={team:'Search people or roles',sent:'Search instructions',waiting:'Search people or instructions',files:'Search people or instructions'};
const OV_DATES=[['','Any date'],['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days']];
const ovPlural=(n,w)=>n+' '+w+(n===1?'':'s');
const ovPlain=h=>String(h).replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
function ovTable(k,team,ins,subs){
  const days=t=>Math.max(0,Math.floor((Date.now()-t)/864e5)),o=S.ov;
  const rl=r=>(ROLES.find(x=>x.key===r)||{label:r}).label,rec=i=>recipients(i).filter(u=>!o.role||u.role===o.role);
  const q=(o.q||'').trim().toLowerCase(),st=o.f||'',who=o.who||'',dd=o.d?Date.now()-Number(o.d)*864e5:0,has=(...a)=>!q||a.some(x=>String(x||'').toLowerCase().includes(q));
  const kind=f=>{const t=String(f.type||'');return t.startsWith('image/')?'image':t.startsWith('video/')?'video':/pdf|word|sheet|excel|powerpoint|presentation|text|csv|document/.test(t)?'doc':'other'};
  const titleOf=id=>{const i=S.instructions.find(z=>z.id===id);return i?i.title:'No instruction'};
  let cols,rows=[];
  const push=(cells,vals,attr)=>rows.push({cells,vals,attr:attr||''});
  if(k==='team'){cols=[['Person'],['Role'],['Instructions received',1],['Responded',1],['Waiting',1]];
    team.forEach(u=>{const mine=ins.filter(i=>rec(i).some(x=>x.id===u.id)),done=mine.filter(i=>responded(i.id,u.id)).length,wait=mine.length-done;
      if(!has(u.username,rl(u.role))||(who&&u.id!==who)||(st&&(st==='waiting'?wait<=0:wait!==0)))return;
      push([`<b>${esc(u.username)}</b>`,esc(rl(u.role)),mine.length,done,wait?`<b style="color:var(--warn)">${wait}</b>`:'0'],[u.username.toLowerCase(),rl(u.role),mine.length,done,wait])})}
  else if(k==='sent'){cols=[['Instruction'],['Sent'],['To'],['Responded',1],['Progress']];
    ins.forEach(i=>{const r=rec(i),d=r.filter(u=>responded(i.id,u.id)).length,state=r.length&&d===r.length?'full':d?'part':'none';
      if(!has(i.title)||(st&&state!==st)||(dd&&i.createdAt<dd)||(who&&!r.some(u=>u.id===who)))return;
      const pc=r.length?Math.round(d/r.length*100):0;
      push([`<b>${esc(i.title)}</b>`,fmtDate(i.createdAt),esc(ovPlural(r.length,'person').replace('persons','people')),d+'/'+r.length,`<span class="ovprog"><i style="width:${pc}%"></i></span><span class="ovpct">${pc}%</span>`],[i.title.toLowerCase(),i.createdAt,r.length,d,pc],`data-act="go" data-route="ins" data-param="${i.id}"`)})}
  else if(k==='waiting'){cols=[['Person'],['Role'],['Instruction'],['Sent'],['Waiting',1]];
    ins.forEach(i=>rec(i).filter(u=>!responded(i.id,u.id)).forEach(u=>{const d=days(i.createdAt);
      if(!has(u.username,i.title,rl(u.role))||(who&&u.id!==who)||(st&&d<Number(st))||(dd&&i.createdAt<dd))return;
      push([`<b>${esc(u.username)}</b>`,esc(rl(u.role)),esc(i.title),fmtDate(i.createdAt),ovPlural(d,'day')],[u.username.toLowerCase(),rl(u.role),i.title.toLowerCase(),i.createdAt,d],`data-act="go" data-route="ins" data-param="${i.id}"`)}))}
  else{cols=[['Person'],['Role'],['For instruction'],['Files',1],['Received']];
    subs.forEach(x=>{const t=titleOf(x.instructionId);
      if(!has(x.username,t,rl(x.role))||(who&&x.userId!==who)||(st&&!(x.files||[]).some(f=>kind(f)===st))||(dd&&x.createdAt<dd))return;
      push([`<b>${esc(x.username)}</b>`,esc(rl(x.role)),esc(t),(x.files||[]).length,fmtDate(x.createdAt)],[x.username.toLowerCase(),rl(x.role),t.toLowerCase(),(x.files||[]).length,x.createdAt],'data-act="go" data-route="content"')})}
  if(o.sk!==undefined&&o.sk!==''&&o.sk<cols.length){const i=Number(o.sk),dir=o.sd==='asc'?1:-1;rows.sort((a,b)=>(a.vals[i]>b.vals[i]?1:a.vals[i]<b.vals[i]?-1:0)*dir)}
  else if(k==='waiting')rows.sort((a,b)=>b.vals[4]-a.vals[4]);
  const arrow=i=>Number(o.sk)===i&&o.sk!==''?(o.sd==='asc'?' ▲':' ▼'):'';
  S.ovLast={name:k,head:cols.map(c=>c[0]),rows:rows.map(r=>r.cells.map(c=>ovPlain(c)))};
  return {n:rows.length,html:rows.length?`<div class="tablewrap"><table class="dt ovt"><thead><tr>${cols.map((c,i)=>`<th class="${c[1]?'num ':''}srt${Number(o.sk)===i&&o.sk!==''?' on':''}" data-act="ov-sort" data-i="${i}" role="button" tabindex="0">${c[0]}<em>${arrow(i)}</em></th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr class="${r.attr?'clk':''}" ${r.attr}>${r.cells.map((c,i)=>`<td class="${cols[i][1]?'num':''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="ovnone"><b>Nothing matches these filters</b><span class="muted">Try a different search or clear the filters.</span></div>'};
}
function ovDetail(k,team,ins,subs){
  const title={team:'Team members',sent:'Instructions sent',waiting:'Still waiting for a response',files:'Files received'}[k],t=ovTable(k,team,ins,subs),o=S.ov;
  const people=k==='sent'?team:(k==='files'?[...new Map(subs.map(x=>[x.userId,{id:x.userId,username:x.username}])).values()]:team).slice().sort((a,b)=>a.username.localeCompare(b.username));
  const sel=(key,attr,opts)=>`<select class="ovsel" ${attr}="1" aria-label="${key}">${opts.map(([v,l])=>`<option value="${esc(v)}"${(o[key]||'')===v?' selected':''}>${esc(l)}</option>`).join('')}</select>`;
  const active=!!(o.q||o.f||o.who||o.d||(o.sk!==undefined&&o.sk!==''));
  return `<section class="panel ovdet"><div class="item-top"><div><h2>${title}</h2><p class="muted ovcount" style="font-size:.85rem">${t.n} result${t.n===1?'':'s'}</p></div><div class="row" style="gap:8px"><button class="btn sm" data-act="ov-export">Export CSV</button><button class="btn sm" data-act="ov-kpi" data-k="${k}">Close</button></div></div>
    <div class="ovtool"><label class="ovsr"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.500"/><path d="m20 20-4-4"/></svg><input type="search" data-ovq="1" placeholder="${OV_SEARCH[k]}" value="${esc(o.q||'')}"></label>
      ${sel('f','data-ovf',OV_STATUS[k])}${sel('who','data-ovw',[['','All people'],...people.map(u=>[u.id,u.username])])}${k==='team'?'':sel('d','data-ovd',OV_DATES)}${active?'<button class="btn sm ghost" data-act="ov-clear-sub">Clear all</button>':''}</div>
    <div class="ovtbl">${t.html}</div></section>`;
}

/* ---------- Overview command center: the most important report from each area ---------- */
S.pulse={at:0,loading:false,shop:null,odoo:null,stock:null,meta:null,ev:null,act:null,err:{},done:{}};
const pvDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());
function pvRange(){const t=pvDay();return {from:t.slice(0,8)+'01',to:t}}
function pvCur(n,c){n=Number(n)||0;try{return new Intl.NumberFormat('en-US',c?{style:'currency',currency:c,notation:Math.abs(n)>=1e5?'compact':'standard',maximumFractionDigits:Math.abs(n)>=1e5?1:0}:{maximumFractionDigits:0}).format(n)}catch(e){return Math.round(n).toLocaleString()}}
const pvPct=(a,b)=>b?Math.round((a-b)/Math.abs(b)*1000)/10:null;
const pvTile=(d,sec,labels)=>{const t=((((d&&d.sections)||[]).find(x=>x.id===sec)||{}).tiles)||[];for(const l of [].concat(labels)){const x=t.find(y=>y.label===l);if(x)return x}return null};
function pvSpark(vals,color){
  vals=(vals||[]).map(Number);if(vals.length<2||!vals.some(v=>v))return '<div class="pv-spark empty"></div>';
  const W=240,H=56,P=3,mx=Math.max(...vals),mn=Math.min(0,...vals),n=vals.length,x=i=>P+(W-2*P)*i/(n-1),y=v=>H-P-(H-2*P)*((v-mn)/((mx-mn)||1));
  const pts=vals.map((v,i)=>x(i).toFixed(1)+','+y(v).toFixed(1)).join(' ');
  return `<svg class="pv-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="pvg${color.replace(/\W/g,'')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><polygon points="${P},${H} ${pts} ${W-P},${H}" fill="url(#pvg${color.replace(/\W/g,'')})"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
const PV_KEY='bless-pulse-v2';
function pvSave(){try{const P=S.pulse;localStorage.setItem(PV_KEY,JSON.stringify({day:pvDay(),at:P.at,shop:P.shop&&{currency:P.shop.currency,summary:P.shop.summary,months:(P.shop.months||[]).map(m=>({revenue:m.revenue}))},odoo:P.odoo,stock:P.stock,meta:P.meta,trend:P.trend,upd:P.upd||{}}))}catch(e){}}
function pvHydrate(){
  const P=S.pulse;if(P.hydrated)return 0;P.hydrated=1;
  try{const c=JSON.parse(localStorage.getItem(PV_KEY)||'null');if(!c||c.day!==pvDay())return 0;
    P.upd=c.upd||{};['shop','odoo','stock','meta','trend'].forEach(k=>{if(c[k]){P[k]=c[k];P.done[k]=1;if(!P.upd[k])P.upd[k]=c.at}});P.cachedAt=c.at;return Date.now()-c.at}catch(e){return 0}
}
function pvJob(key){
  const P=S.pulse,r=pvRange(),q='from='+r.from+'&to='+r.to+'&kind=month';
  return {shop:['/api/shopify?only=summary&'+q,d=>P.shop=d,1],odoo:['/api/odoo?tab=profit&only=kpi&'+q,d=>P.odoo=d,1],stock:['/api/odoo?tab=finished&only=kpi&'+q,d=>P.stock=d,1],
    meta:['/api/meta?tab=overview&only=kpi&'+q,d=>P.meta=d,1],ev:['/api/evaluation',d=>P.ev=d,0],act:['/api/auth?action=activity&days=7',d=>P.act=d,0],
    trend:['/api/odoo?tab=profit&only=trend&'+q,d=>P.trend=d,1]}[key];
}
const pvAgo=t=>{if(!t)return '';const m=Math.round((Date.now()-t)/6e4);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'};
/** Show whatever was saved last (instantly), then refresh it behind the scenes when it is older than 10 minutes. */
async function pvRun(key,force){
  const P=S.pulse,[url,set,cacheable]=pvJob(key);delete P.err[key];P.upd=P.upd||{};P.busy=P.busy||{};
  const get=async(suffix,retry)=>{
    try{const d=await api('GET',url+suffix,null,65000);if(d&&d.configured===false)throw new Error('Not connected yet. Add its keys in Vercel, then reload.');return d}
    catch(e){
      // The server keeps working after we stop waiting and saves its answer, so one more try a few seconds later is usually instant.
      if(!retry&&/taking longer|Server error|went wrong|reach the server/i.test(e.message||'')){await new Promise(r=>setTimeout(r,4000));return get(suffix,true)}
      throw e}
  };
  let at=force?0:(P.upd[key]||0);
  if(!P[key]&&cacheable&&!force){
    try{const d=await get('&stale=1');set(d);at=P.upd[key]=d._cachedAt||Date.now();P.done[key]=1;pvFill()}
    catch(e){P.err[key]=e.message||'Could not load';P.done[key]=1;pvFill();return}
  }
  if(at&&Date.now()-at<10*60e3){P.done[key]=1;pvFill();return}
  P.busy[key]=1;pvFill();
  try{const d=await get(force?'&refresh=1':'');set(d);P.upd[key]=Date.now()}
  catch(e){if(!P[key])P.err[key]=e.message||'Could not load'}
  delete P.busy[key];P.done[key]=1;pvFill();
}
const PV_KEYS=['shop','odoo','stock','meta','ev','act','trend'];
async function loadPulse(force){
  const P=S.pulse;if(P.loading)return;
  pvHydrate();
  if(!force&&Date.now()-P.at<60e3){pvFill();return}
  P.loading=true;P.at=Date.now();P.err={};
  const iv=setInterval(pvFill,1000);
  // Odoo answers one thing at a time and Meta rate-limits, so its three requests go in a row instead of all at once
  await Promise.all([pvRun('shop',force),pvRun('meta',force),pvRun('ev',force),pvRun('act',force),(async()=>{await pvRun('odoo',force);await pvRun('stock',force);await pvRun('trend',force)})()]);
  clearInterval(iv);P.loading=false;pvSave();pvFill();
}
function pvFill(){
  if(S.route!=='home'||!isAdmin())return;
  const a=$('#ov-priority'),b=$('#ov-business'),c=$('#ov-perf');
  if(a)a.innerHTML=pvAttention();if(b)b.innerHTML=pvBusiness();if(c)c.innerHTML=pvPerf();
}
function pvOverdue(){
  const out=[];S.instructions.forEach(i=>{const age=(Date.now()-i.createdAt)/864e5;if(age<3)return;recipients(i).forEach(u=>{if(!responded(i.id,u.id))out.push({i,u,age})})});
  return out.sort((a,b)=>b.age-a.age);
}
function pvAttention(){
  const P=S.pulse,items=[],od=pvOverdue();
  const add=(sev,ico,n,text,attrs)=>items.push({sev,ico,n,text,attrs});
  if(od.length)add(od.length>=5?'bad':'warn','alert',od.length,`overdue response${od.length===1?'':'s'}`,`data-act="ov-kpi" data-k="waiting"`);
  const unrev=S.subs.filter(x=>x.instructionId&&(x.rating===null||x.rating===undefined)).length;
  if(unrev)add('warn','eye',unrev,`submission${unrev===1?'':'s'} to rate`,`data-act="go" data-route="eval"`);
  const un=unreadNotes().length;if(un)add('info','chat',un,`unread comment${un===1?'':'s'}`,`data-act="go" data-route="notes"`);
  const cut14=Date.now()-14*864e5,team=S.users.filter(u=>u.role!=='super_admin'&&u.role!=='ceo');
  const quiet=team.filter(u=>!S.subs.some(x=>x.userId===u.id&&x.createdAt>=cut14)&&S.instructions.some(i=>recipients(i).some(r=>r.id===u.id)));
  if(quiet.length)add('info','moon',quiet.length,`people with no upload in 14 days`,`data-act="ov-kpi" data-k="team"`);
  const oos=pvTile(P.stock,'kpi','Out of stock'),low=pvTile(P.stock,'kpi','Running low');
  if(oos&&oos.value)add('bad','box',oos.value,`product${oos.value===1?'':'s'} out of stock`,`data-act="go" data-route="odoo"`);
  if(low&&low.value)add('warn','box',low.value,`product${low.value===1?'':'s'} running low`,`data-act="go" data-route="odoo"`);
  const roas=pvTile(P.meta,'kpi','Return on ad spend');if(roas&&roas.value>0&&roas.value<1.5)add(roas.value<1?'bad':'warn','trend',roas.value.toFixed(1)+'×','return on ad spend this month',`data-act="go" data-route="meta"`);
  const sc=P.shop&&P.shop.summary&&P.shop.summary.change;if(sc&&sc.revenue!==null&&sc.revenue<=-20)add('bad','trend',sc.revenue+'%','Shopify revenue vs previous period',`data-act="go" data-route="shop"`);
  const loading=Object.keys(P.done).length<6&&P.loading;
  const body=items.length?items.map(x=>`<button type="button" class="pv-al ${x.sev}" ${x.attrs}><span class="pv-ai"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[x.ico]||ICON.alert}</svg></span><b>${x.n}</b><span>${x.text}</span><svg class="pv-ar" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>`).join(''):`<div class="pv-ok"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON.check}</svg>${loading?'Checking everything…':'All clear. Nothing needs your attention right now.'}</div>`;
  return `<div class="pv-head"><div><h2>Needs your attention</h2><p class="muted">Sorted by what is most urgent. Click one to go straight to it.</p></div></div><div class="pv-alerts">${body}</div>`;
}
function pvCard(o){
  const {key,ico,color,name,route,hero,heroLabel,delta,goodDown,spark,sub,note,dep}=o,P=S.pulse;
  const head=`<div class="pv-top"><span class="kico" style="--kc:${color}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[ico]||NAV_ICON[ico]||''}</svg></span><b>${name}</b><span class="eyebrow">${note||''}</span></div>`;
  const keys=[].concat(dep||key);
  if(P.err[key])return `<section class="pv-card err">${head}<p class="pv-msg"><b>Could not load ${name}.</b><br><span class="muted">${esc(P.err[key])}</span></p><div class="row"><button class="btn sm primary" data-act="pv-retry" data-k="${keys.join(',')}">Try again</button><button class="btn sm" data-act="go" data-route="${route}">Open ${name}</button></div></section>`;
  if(!P.done[key]||!P[key]){const w=Math.round((Date.now()-P.at)/1000);return `<section class="pv-card">${head}<div class="pv-sk"><i></i><i></i><i></i></div>${w>=3?`<p class="muted pv-foot">Waiting for ${name}… ${w}s${w>=15?'. The first time can take up to a minute. After that it is saved.':''}</p>`:''}</section>`}
  const upd=Math.min(...keys.map(k=>(P.upd||{})[k]||Date.now())),busy=keys.some(k=>(P.busy||{})[k]);
  return `<section class="pv-card" style="--pc:${color}">${head}<div class="pv-hero"><div><span class="eyebrow">${heroLabel}</span><div class="pv-n">${hero}</div></div>${delta===null||delta===undefined?'':chip(delta,goodDown)}</div>${spark}<p class="pv-sub">${sub}</p><div class="pv-foot2"><button class="pv-open" data-act="go" data-route="${route}">Open full report <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button><span class="muted pv-upd">${busy?'<i class="pv-spin"></i> refreshing…':'updated '+pvAgo(upd)}</span></div></section>`;
}
function pvBusiness(){
  const P=S.pulse,r=pvRange(),rng=new Date(r.to+'T12:00:00Z').toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'}),per='1–'+Number(r.to.slice(8))+' '+rng;
  const sh=P.shop,ss=sh&&sh.summary,cur=sh&&sh.currency;
  const shop=pvCard({key:'shop',ico:'bag',color:'#2DD4BF',name:'Shopify',route:'shop',note:per,heroLabel:'Revenue',
    hero:ss?pvCur(ss.revenue,cur):'',delta:ss&&ss.change.revenue,spark:ss?pvSpark((sh.months||[]).map(m=>m.revenue),'#2DD4BF'):'',
    sub:ss?`${ss.orders.toLocaleString()} orders · ${pvCur(ss.aov,cur)} average order`:''});
  const od=P.odoo,pt=pvTile(od,'kpi',['Profit after ads','Profit after delivery','Gross profit']),rev=pvTile(od,'kpi','Net revenue'),oc=od&&od.currency;
  const trend=(P.trend&&(P.trend.sections||[]).find(x=>x.id==='trend'))||(od&&(od.sections||[]).find(x=>x.id==='trend'));
  const odoo=pvCard({key:'odoo',ico:'odoo',color:'#A78BFA',name:'Odoo',route:'odoo',note:per,heroLabel:pt?pt.label:'Profit',
    hero:pt?pvCur(pt.value,oc):'–',delta:pt?pvPct(pt.value,pt.prev):null,spark:trend?pvSpark(trend.rows.map(x=>x.values.profit),'#A78BFA'):'',
    sub:rev?`${pvCur(rev.value,oc)} net revenue this month`:''});
  const mt=P.meta,sp=pvTile(mt,'kpi','Amount spent'),pu=pvTile(mt,'kpi','Purchases'),ro=pvTile(mt,'kpi','Return on ad spend'),mc=mt&&mt.currency;
  const meta=pvCard({key:'meta',ico:'meta',color:'#FF8A3D',name:'Meta Ads',route:'meta',note:per,heroLabel:'Ad spend',
    hero:sp?pvCur(sp.value,mc):'–',delta:sp?pvPct(sp.value,sp.prev):null,goodDown:true,spark:sp&&sp.daily?pvSpark(sp.daily,'#FF8A3D'):'',
    sub:`${ro?ro.value.toFixed(2)+'× return on ad spend':'–'}${pu?' · '+pu.value.toLocaleString()+' purchases':''}`});
  return `<div class="pv-head"><div><h2>Business today</h2><p class="muted">This month so far. One number per area, with the change against the previous period.</p></div><button class="btn sm ghost" data-act="pv-refresh">${S.pulse.loading?'Refreshing…':'↻ Refresh'}</button></div><div class="pv-grid">${shop}${odoo}${meta}</div>`;
}
function pvPerf(){
  const P=S.pulse,e=P.ev,a=P.act;
  // Evaluation
  let evb;
  if(P.err.ev)evb=`<p class="muted">${esc(P.err.ev)}</p>`;
  else if(!P.done.ev)evb='<div class="pv-sk"><i></i><i></i><i></i></div>';
  else{const rows=(e.rows||[]).filter(r=>r.final!==null).slice(0,5),mx=100;
    evb=rows.length?`<div class="pv-rank">${rows.map((r,i)=>`<div class="pv-rr"><span class="pv-rk r${i+1}">${r.rank||i+1}</span><span class="pv-rn"><b>${esc(r.username)}</b>${roleChip(r.role)}</span><span class="oi-ht"><i style="width:${Math.min(100,r.final/mx*100)}%;background:${i===0?'var(--accent)':'var(--cmp)'}"></i></span><b class="pv-rs">${Math.round(r.final)}</b></div>`).join('')}</div>${(e.rows||[]).some(r=>r.unrated)?`<p class="muted pv-foot">${(e.rows||[]).reduce((n,r)=>n+r.unrated,0)} submission(s) still need a rating.</p>`:''}`:'<p class="muted">No scores yet. Rate submissions on the Evaluation page.</p>';}
  const evc=`<section class="pv-card"><div class="pv-top"><span class="kico" style="--kc:#FBBF24"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${NAV_ICON.eval}</svg></span><b>Team ranking</b><span class="eyebrow">${e&&e.month?esc(e.month):''}</span></div>${evb}<button class="pv-open" data-act="go" data-route="eval">Open evaluation <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button></section>`;
  // Activity
  let acb;
  if(P.err.act)acb=`<p class="muted">${esc(P.err.act)}</p>`;
  else if(!P.done.act)acb='<div class="pv-sk"><i></i><i></i><i></i></div>';
  else{const today=pvDay(),td=(a.daily||[]).find(x=>x.day===today)||{users:0,visits:0,secs:0},on=a.users.filter(u=>u.online),pg=(a.pages||[])[0];
    acb=`<div class="pv-mini three"><div><span class="eyebrow">Online now</span><b>${on.length}</b></div><div><span class="eyebrow">Active today</span><b>${td.users}</b></div><div><span class="eyebrow">Page views today</span><b>${td.visits}</b></div></div>
    ${on.length?`<div class="pv-who">${on.slice(0,6).map(u=>`<span class="pv-pp"><i class="act-dot on"></i>${esc(u.username)}</span>`).join('')}</div>`:'<p class="muted pv-foot">Nobody is using the hub at the moment.</p>'}
    ${pg?`<p class="muted pv-foot">Most opened page this week: <b>${esc(actPage(pg.page))}</b> (${pg.visits} views)</p>`:''}`}
  const acc=`<section class="pv-card"><div class="pv-top"><span class="kico" style="--kc:#4ADE9A"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${NAV_ICON.act}</svg></span><b>Hub usage</b><span class="eyebrow">last 7 days</span></div>${acb}<button class="pv-open" data-act="go" data-route="act">Open activity <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button></section>`;
  return `<div class="pv-head"><div><h2>Top performers</h2><p class="muted">The best scores this month, and who is using the hub right now.</p></div></div><div class="pv-grid two">${evc}${acc}</div>`;
}

function ovTeamStats(team,ins,subs){
  const fr=S.ov.role,rec=i=>recipients(i).filter(u=>!fr||u.role===fr),roles=ROLES.filter(r=>r.key!=='super_admin'&&r.key!=='ceo'&&team.some(u=>u.role===r.key));
  const first=new Map();S.subs.forEach(x=>{if(!x.instructionId)return;const k=x.instructionId+'|'+x.userId,c=first.get(k);if(c===undefined||x.createdAt<c)first.set(k,x.createdAt)});
  const by={},all=[];roles.forEach(r=>by[r.key]={label:r.label,ms:[]});let sent=0,done=0;
  ins.forEach(i=>rec(i).forEach(u=>{sent++;const f=first.get(i.id+'|'+u.id);if(f!==undefined){done++;const d=Math.max(0,f-i.createdAt);all.push(d);if(by[u.role])by[u.role].ms.push(d)}}));
  const med=a=>{if(!a.length)return null;const q=[...a].sort((x,y)=>x-y),m=q.length>>1;return q.length%2?q[m]:(q[m-1]+q[m])/2};
  const teams=Object.values(by).filter(t=>t.ms.length).map(t=>({label:t.label,avg:t.ms.reduce((x,y)=>x+y,0)/t.ms.length})).sort((a,b)=>a.avg-b.avg);
  const W=7*864e5,now=Date.now(),thisW=S.subs.filter(x=>x.createdAt>=now-W&&(!fr||x.role===fr)).length,lastW=S.subs.filter(x=>x.createdAt>=now-2*W&&x.createdAt<now-W&&(!fr||x.role===fr)).length;
  return {sent,done,rate:sent?Math.round(done/sent*100):null,mid:med(all),fast:teams[0],slow:teams.length>1?teams[teams.length-1]:null,thisW,lastW};
}
function overviewHTML(){
  const cut=ovCut(),fr=S.ov.role;
  const team=S.users.filter(u=>u.role!=='super_admin'&&(!fr||u.role===fr));
  const insAll=S.instructions.filter(i=>i.createdAt>=cut&&(!fr||recipients(i).some(u=>u.role===fr))),subsF=S.subs.filter(x=>x.createdAt>=cut&&(!fr||x.role===fr));
  let open=0,total=0;insAll.forEach(i=>recipients(i).filter(u=>!fr||u.role===fr).forEach(u=>{total++;if(!responded(i.id,u.id))open++}));
  const today=new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'});
  const hero=`<section class="hero"><div class="hero-top"><div><span class="eyebrow">${esc(today)}</span><div class="hero-n sm">${greeting()}, ${esc(S.me.username)}</div>
    <p class="hero-sub">${open?`<b>${open}</b> response${open===1?'':'s'} still waiting from your team.`:(S.instructions.length?'Everyone has responded. Nothing is waiting on you.':'Send your first instruction to get the team moving.')}</p></div>
    <div class="hero-actions"><button class="btn dark" data-act="go" data-route="send">New instruction</button><button class="btn light" data-act="go" data-route="content">All content</button></div></div></section>`;
  const st=ovTeamStats(team,insAll,subsF);
  const kpi=(k,c,l,v,sub,key)=>`<button type="button" class="kcard kbtn${S.ov.open===key?' on':''}" style="--kc:${c}" data-act="ov-kpi" data-k="${key}" aria-expanded="${S.ov.open===key}">${ico(k,c)}<div><span class="eyebrow">${l}</span><div class="kn">${v}</div><small class="muted">${sub}</small></div><svg class="kcaret" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>`;
  const plain=(k,c,l,v,sub,chipHTML)=>`<div class="kcard" style="--kc:${c}">${ico(k,c)}<div><span class="eyebrow">${l}</span><div class="kn">${v}</div><small class="muted">${sub}</small></div>${chipHTML||''}</div>`;
  const wk=pvPct(st.thisW,st.lastW);
  const kpis=`<div class="kgrid k3">
    ${kpi('clock',open?'#C2410C':'#2C7A4B','Awaiting response',open,open?'people still to respond':'all caught up','waiting')}
    ${plain('check','#F28D3A','Response rate',st.rate===null?'–':st.rate+'%',st.sent?`${st.done} of ${st.sent} requests answered`:'no instructions yet')}
    ${plain('clock','#7B4FA0','Typical response time',st.mid===null?'–':ovcDur(st.mid),'median, instruction to first response')}
    ${kpi('file','#0F766E','Uploads this week',st.thisW,st.lastW?`${st.lastW} the week before`:'files and responses','files')}
    ${plain('trend','#2C7A4B','Fastest team',st.fast?esc(st.fast.label):'–',st.fast?'about '+ovcDur(st.fast.avg)+' on average':'no responses yet')}
    ${plain('alert','#C2410C','Slowest team',st.slow?esc(st.slow.label):'–',st.slow?'about '+ovcDur(st.slow.avg)+' on average':'not enough data')}</div>${S.ov.open?ovDetail(S.ov.open,team,insAll,subsF):''}`;
  const secs=[['ov-priority','Needs attention'],['ov-business','Business today'],['ov-summary','Team pulse'],['ov-perf','Top performers']];
  const tabs=`<nav class="ovtabs" aria-label="Sections">${secs.map(([id,l])=>`<button type="button" data-act="ov-tab" data-sec="${id}"${S.ovSec===id?' class="on" aria-current="true"':''}>${l}</button>`).join('')}</nav>`;
  return `<div style="display:grid;gap:22px">${hero}${tabs}<div id="ov-priority" class="ovsec pv-sec">${pvAttention()}</div><div id="ov-business" class="ovsec pv-sec">${pvBusiness()}</div><div id="ov-summary" class="ovsec pv-sec"><div class="pv-head"><div><h2>Team pulse</h2><p class="muted">How fast the team responds and how much it sends in.</p></div></div>${ovFilters()}${kpis}</div><div id="ov-perf" class="ovsec pv-sec">${pvPerf()}</div></div>`;
}

/* ---------- Overview insights: charts from the team's own activity ---------- */
const OVC={orange:'#F28D3A',purple:'#7B4FA0',teal:'#0F766E',soft:'#CBB7D8',red:'#C2410C'};
function ovcDur(ms){const h=ms/36e5;return h<1?Math.max(1,Math.round(ms/6e4))+' min':h<48?(h<10?h.toFixed(1):Math.round(h))+' h':(h/24<10?(h/24).toFixed(1):Math.round(h/24))+' days'}
function ovcWeeks(n){const out=[],d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));for(let i=n-1;i>=0;i--){const a=new Date(d);a.setDate(a.getDate()-i*7);out.push({t:a.getTime(),label:a.toLocaleDateString(undefined,{day:'numeric',month:'short'}),subs:0,ins:0})}return out}
function ovcActivity(ins,subs){
  const W=ovcWeeks(12),idx=t=>{for(let i=W.length-1;i>=0;i--)if(t>=W[i].t)return i;return -1};
  subs.forEach(x=>{const i=idx(x.createdAt);if(i>=0)W[i].subs++});ins.forEach(x=>{const i=idx(x.createdAt);if(i>=0)W[i].ins++});
  const max=Math.max(4,...W.map(w=>Math.max(w.subs,w.ins))),top=Math.ceil(max/4)*4,w=900,h=270,L=36,B=30,T=12,pw=w-L-8,ph=h-B-T,bw=pw/W.length;
  const y=v=>T+ph-v/top*ph,grid=[0,1,2,3,4].map(g=>{const v=top/4*g;return `<line x1="${L}" x2="${w-8}" y1="${y(v)}" y2="${y(v)}" class="oi-gl"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end" class="oi-axis">${Math.round(v)}</text>`}).join('');
  const bars=W.map((k,i)=>{const x=L+i*bw+bw*.2,bh=k.subs/top*ph;return `<rect x="${x}" y="${y(k.subs)}" width="${bw*.6}" height="${Math.max(bh,k.subs?2:0)}" rx="3" fill="${OVC.orange}" class="oi-bar" data-tip="Week of ${k.label}: ${k.subs} response${k.subs===1?'':'s'}, ${k.ins} instruction${k.ins===1?'':'s'} sent"/>`}).join('');
  const pts=W.map((k,i)=>[L+i*bw+bw/2,y(k.ins)]),line=pts.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join(' ');
  const labels=W.map((k,i)=>i%2===(W.length-1)%2?`<text x="${L+i*bw+bw/2}" y="${h-9}" text-anchor="middle" class="oi-axis">${esc(k.label)}</text>`:'').join('');
  return `<svg class="oi-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Weekly activity, last 12 weeks">${grid}${bars}<path d="${line}" fill="none" stroke="${OVC.purple}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>${pts.map((q,i)=>`<circle cx="${q[0]}" cy="${q[1]}" r="3.4" fill="var(--surface)" stroke="${OVC.purple}" stroke-width="2"><title>${W[i].ins} sent</title></circle>`).join('')}${labels}</svg>
  <div class="oi-legend"><span><i style="background:${OVC.orange}"></i>Responses received</span><span><i class="ln" style="background:${OVC.purple}"></i>Instructions sent</span></div>`;
}
function ovcRows(rows,fmt){
  const max=Math.max(1e-9,...rows.map(r=>r.v));
  return `<div class="oi-hbs">${rows.map(r=>`<div class="oi-hb"${r.tip?` data-tip="${esc(r.tip)}"`:''}><span class="oi-hl"><i style="background:${r.c}"></i>${esc(r.l)}</span><span class="oi-ht"><b style="width:${Math.max(r.v?3:0,r.v/max*100)}%;background:${r.c}"></b></span><span class="oi-hv">${esc(fmt?fmt(r):r.v)}</span></div>`).join('')}</div>`;
}
function ovInsights(team,ins,subs){
  const fr=S.ov.role,rec=i=>recipients(i).filter(u=>!fr||u.role===fr),roles=ROLES.filter(r=>r.key!=='super_admin'&&team.some(u=>u.role===r.key));
  const first=new Map();S.subs.forEach(x=>{if(!x.instructionId)return;const k=x.instructionId+'|'+x.userId,c=first.get(k);if(c===undefined||x.createdAt<c)first.set(k,x.createdAt)});
  const byRole={},all=[];
  roles.forEach(r=>byRole[r.key]={sent:0,done:0,ms:[]});
  ins.forEach(i=>rec(i).forEach(u=>{const b=byRole[u.role];if(!b)return;b.sent++;const f=first.get(i.id+'|'+u.id);if(f!==undefined){b.done++;const d=Math.max(0,f-i.createdAt);b.ms.push(d);all.push(d)}}));
  const med=a=>{if(!a.length)return null;const q=[...a].sort((x,y)=>x-y),m=q.length>>1;return q.length%2?q[m]:(q[m-1]+q[m])/2},avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const rateRows=roles.map(r=>{const b=byRole[r.key],p=b.sent?Math.round(b.done/b.sent*100):0;return {l:r.label,v:p,c:`var(${r.tok})`,done:b.done,sent:b.sent,tip:`${r.label}: ${b.done} of ${b.sent} responded`}}).filter(r=>r.sent).sort((a,b)=>b.v-a.v);
  const timeRows=roles.map(r=>({l:r.label,v:avg(byRole[r.key].ms),c:`var(${r.tok})`})).filter(r=>r.v!==null).sort((a,b)=>a.v-b.v).map(r=>({...r,tip:r.l+': average '+ovcDur(r.v)}));
  let full=0,part=0,none=0;ins.forEach(i=>{const r=rec(i);if(!r.length)return;const d=r.filter(u=>responded(i.id,u.id)).length;d===r.length?full++:d?part++:none++});
  const kinds={Images:0,Videos:0,Documents:0,Other:0};subs.forEach(x=>(x.files||[]).forEach(f=>{const t=String(f.type||'');kinds[t.startsWith('image/')?'Images':t.startsWith('video/')?'Videos':/pdf|word|sheet|excel|powerpoint|presentation|text|csv|document/.test(t)?'Documents':'Other']++}));
  const kTot=Object.values(kinds).reduce((a,b)=>a+b,0),kCol={Images:OVC.orange,Videos:OVC.purple,Documents:OVC.teal,Other:OVC.soft};
  const people=new Map();subs.forEach(x=>{const g=people.get(x.userId)||{name:x.username,role:x.role,n:0};g.n++;people.set(x.userId,g)});
  const top=[...people.values()].sort((a,b)=>b.n-a.n).slice(0,5).map(g=>({l:g.name,v:g.n,c:`var(${(ROLES.find(r=>r.key===g.role)||{tok:'--role-ec'}).tok})`,tip:g.name+': '+g.n+' response'+(g.n===1?'':'s')}));
  const totalSent=rateRows.reduce((a,r)=>a+r.sent,0),totalDone=rateRows.reduce((a,r)=>a+r.done,0),mid=med(all),fast=timeRows[0],slow=timeRows[timeRows.length-1];
  const stat=(l,v,sub)=>`<div class="oi-st"><span class="eyebrow">${l}</span><b>${v}</b><small class="muted">${sub}</small></div>`;
  const strip=`<div class="oi-strip">${stat('Response rate',totalSent?Math.round(totalDone/totalSent*100)+'%':'–',`${totalDone} of ${totalSent} requests answered`)}${stat('Typical response time',mid===null?'–':ovcDur(mid),'median, instruction to first response')}${stat('Fastest team',fast?esc(fast.l):'–',fast?'about '+ovcDur(fast.v)+' on average':'no responses yet')}${stat('Needs attention',slow&&timeRows.length>1?esc(slow.l):(rateRows.length?esc(rateRows[rateRows.length-1].l):'–'),slow&&timeRows.length>1?'slowest, about '+ovcDur(slow.v):(rateRows.length?'lowest response rate':'nothing to compare yet'))}</div>`;
  const card=(t,sub,body,cls)=>`<section class="panel oi-card ${cls||''}"><div><h2>${t}</h2><p class="muted" style="font-size:.85rem">${sub}</p></div>${body}</section>`;
  const donutCard=(parts,top,sub,legend)=>`<div class="cust">${donut(parts,top,sub)}<div class="legend">${legend}</div></div>`;
  const completion=full+part+none?donutCard([{v:full,c:OVC.teal,l:'Fully answered'},{v:part,c:OVC.orange,l:'Partly answered'},{v:none,c:OVC.soft,l:'No response yet'}],String(full+part+none),'instructions',`<div><i style="background:${OVC.teal}"></i><b>${full}</b> fully answered</div><div><i style="background:${OVC.orange}"></i><b>${part}</b> partly answered</div><div><i style="background:${OVC.soft}"></i><b>${none}</b> no response yet</div>`):'<p class="muted">No instructions in this selection.</p>';
  const mix=kTot?donutCard(Object.keys(kinds).filter(k=>kinds[k]).map(k=>({v:kinds[k],c:kCol[k],l:k})),String(kTot),'files',Object.keys(kinds).filter(k=>kinds[k]).map(k=>`<div><i style="background:${kCol[k]}"></i><b>${kinds[k]}</b> ${k.toLowerCase()}</div>`).join('')):'<p class="muted">No files received in this selection.</p>';
  return `<div class="oi">${strip}
    <div class="oi-grid wide">${card('Activity, last 12 weeks','Responses received each week against instructions sent.',ovcActivity(ins,subs),'span2')}${card('Response rate by team','Share of requests each team has answered.',rateRows.length?ovcRows(rateRows,r=>r.v+'%  ('+r.done+'/'+r.sent+')'):'<p class="muted">No instructions sent yet.</p>')}</div>
    <div class="oi-grid">${card('How fast they respond','Average time from sending to the first response.',timeRows.length?ovcRows(timeRows,r=>ovcDur(r.v)):'<p class="muted">No responses yet.</p>')}${card('Instruction progress','How far each instruction has been answered.',completion)}${card('What comes in','Types of files received.',mix)}${card('Most active people','Responses sent, top five.',top.length?ovcRows(top):'<p class="muted">No responses yet.</p>')}</div></div>`;
}
function ovRender(){$('#view').innerHTML=overviewHTML();ovSpy()}

function ovSetHash(id){try{history.replaceState(null,'','#home'+(id?':'+id:''))}catch(e){}}
let ovLock=0;
function ovMark(id){S.ovSec=id;document.querySelectorAll('.ovtabs button').forEach(b=>{const on=b.dataset.sec===id;b.classList.toggle('on',on);if(on){b.setAttribute('aria-current','true');const bar=b.parentNode;if(bar.scrollWidth>bar.clientWidth)bar.scrollTo({left:b.offsetLeft-bar.clientWidth/2+b.offsetWidth/2,behavior:'smooth'})}else b.removeAttribute('aria-current')})}
function ovSpy(){
  if(S.route!=='home'||!isAdmin())return;
  const bar=document.querySelector('.ovtabs');if(!bar)return;
  const ids=[...bar.querySelectorAll('button')].map(b=>b.dataset.sec);
  if(S.ovPending){const id=S.ovPending;S.ovPending=null;const el=document.getElementById(id);if(el){ovMark(id);requestAnimationFrame(()=>el.scrollIntoView());return}}
  const keep=S.ovSec;S.ovSec=null;ovLock=0;ovOnScroll();if(!S.ovSec)ovMark(ids.includes(keep)?keep:ids[0])
}
function ovOnScroll(){
  if(Date.now()<ovLock||S.route!=='home'||!isAdmin())return;
  const bar=document.querySelector('.ovtabs');if(!bar)return;
  const line=bar.getBoundingClientRect().bottom+30;let cur=null;
  document.querySelectorAll('.ovsec').forEach(el=>{if(el.getBoundingClientRect().top<=line)cur=el.id});
  if((window.innerHeight+window.scrollY)>=document.documentElement.scrollHeight-4){const all=document.querySelectorAll('.ovsec');cur=all[all.length-1].id}
  if(!cur)cur=document.querySelector('.ovsec')?.id;
  if(cur&&cur!==S.ovSec){ovMark(cur);ovSetHash(cur===document.querySelector('.ovsec').id?'':cur)}
}
let ovTick=0;window.addEventListener('scroll',()=>{if(ovTick)return;ovTick=requestAnimationFrame(()=>{ovTick=0;ovOnScroll()})},{passive:true});
function insRowAdmin(i){
  const rec=recipients(i);const done=rec.filter(u=>responded(i.id,u.id)).length;const pct=rec.length?Math.round(done/rec.length*100):0;
  return `<button class="item" data-act="go" data-route="ins" data-param="${i.id}"><div class="item-top"><h3>${esc(i.title)}</h3><span class="mono muted">${fmtDate(i.createdAt)}</span></div>
    <div class="row">${targetChips(i)}</div><div class="row" style="gap:12px"><div class="bar" style="flex:1;min-width:120px"><i style="width:${pct}%"></i></div><span class="mono muted">${done}/${rec.length} responded</span></div></button>`;
}
function inboxHTML(){
  const list=myInstructions();
  if(!list.length)return empty('No instructions yet','When the Super Admin sends you a brief, it shows up here.');
  return `<div class="list">${list.map(i=>{const d=responded(i.id);return `<button class="item" data-act="go" data-route="ins" data-param="${i.id}"><div class="item-top"><h3>${esc(i.title)}</h3><span class="pill ${d?'done':'new'}">${d?'Responded':'New'}</span></div><p class="snippet">${esc(i.body)}</p><span class="mono muted">${fmtDate(i.createdAt)}</span></button>`}).join('')}</div>`;
}
function allNotes(){return S.comments.filter(c=>c.userId!==S.me.id).sort((a,b)=>b.createdAt-a.createdAt)}
function unreadNotes(){return allNotes().filter(c=>!S.reads.has(c.id))}
function notesHTML(){
  const l=allNotes(),u=unreadNotes().length;
  if(!l.length)return empty('No notifications yet',isAdmin()?'When a team member replies to a comment, it shows here.':'When the Super Admin comments on your tasks, it shows here.');
  return `<div class="row" style="justify-content:space-between"><span class="muted">${u?u+' unread':'All read'}</span>${u?'<button class="btn sm" data-act="note-all">Mark all as read</button>':''}</div><div class="list">${l.map(c=>{
    const sub=S.subs.find(x=>x.id===c.submissionId);const ins=sub&&sub.instructionId&&S.instructions.find(i=>i.id===sub.instructionId);
    const on=!S.reads.has(c.id);
    const where=!sub?'a deleted task':sub.instructionId?`"${esc(ins?ins.title:'deleted instruction')}"`:'an upload';
    const who=isAdmin()&&sub?` · task by ${esc(sub.username)}`:'';
    return `<button class="item note${on?' unread':''}" data-act="open-note" data-id="${c.id}"><div class="item-top"><span><b>${esc(c.username)}</b> commented on ${where}${who}</span><span class="mono muted">${fmtDate(c.createdAt)}</span></div><p class="body-text note-snip">${esc(c.body.length>160?c.body.slice(0,160)+'…':c.body)}</p><span class="muted" style="font-size:.85rem">${on?'New · ':''}Click to open the conversation</span></button>`}).join('')}</div>`;
}
async function markRead(ids){ids=ids.filter(i=>!S.reads.has(i));if(!ids.length)return;ids.forEach(i=>S.reads.add(i));S.lastJson='';try{await api('POST','/api/submissions',{action:'read',ids})}catch(e){}}
function notifyNew(){
  const n=unreadNotes().length;
  document.title=(n?'('+n+') ':'')+document.title.replace(/^\(\d+\) /,'');
  if(S.seenUnread!==null&&n>S.seenUnread)toast('New comment — open Notifications');
  S.seenUnread=n;
}
function updateIns(){
  const i=S.instructions.find(x=>x.id===S.param);
  if(!i){$('#live').innerHTML=empty('Instruction not found','It may have been deleted.');$('#live2').innerHTML='';document.querySelectorAll('[data-form="up-resp"]').forEach(f=>f.closest('.panel').hidden=true);return}
  const head=`<div class="panel"><div class="item-top"><div style="display:grid;gap:6px;min-width:0"><span class="eyebrow">Instruction · ${fmtDate(i.createdAt)}</span><h1>${esc(i.title)}</h1></div>
    ${isAdmin()?`<button class="btn sm danger" data-act="del-ins" data-id="${i.id}">Delete</button>`:''}</div><p class="body-text">${esc(i.body)}</p><div class="row"><span class="eyebrow">Sent to</span>${targetChips(i)}</div></div>`;
  if(isAdmin()){
    const rec=recipients(i);const subs=S.subs.filter(s=>s.instructionId===i.id);
    $('#live').innerHTML=head+`<div class="panel"><h2>Who has responded</h2>${rec.length?`<div class="checks">${rec.map(u=>`<span class="check" style="cursor:default">${responded(i.id,u.id)?'<span class="pill done">Done</span>':'<span class="pill new">Waiting</span>'}<span class="mono">${esc(u.username)}</span></span>`).join('')}</div>`:'<p class="muted">Nobody currently holds the roles or names this was sent to.</p>'}</div>`;
    $('#live2').innerHTML=`<section style="display:grid;gap:12px"><h2>Responses (${subs.length})</h2>${listOrEmpty(subs,'No responses yet','Files sent back for this instruction appear here.',true)}</section>`;
  }else{
    $('#live').innerHTML=head;
    $('#live2').innerHTML=`<section style="display:grid;gap:12px"><h2>Your responses</h2>${listOrEmpty(S.subs.filter(s=>s.instructionId===i.id&&s.userId===S.me.id),'You have not responded yet','Use the form above to send your files.',true)}</section>`;
  }
}
function teamHTML(){
  return `<div class="roles">${ROLES.map(r=>{const us=S.users.filter(u=>u.role===r.key);return `<div class="role-card" style="--rc:var(${r.tok})"><div class="item-top"><h3>${r.label}</h3><span class="mono muted">${us.length}</span></div>${us.length?`<ul>${us.map(u=>`<li>${esc(u.username)}${S.me.id===u.id?' <span class="muted">(you)</span>':''}</li>`).join('')}</ul>`:'<p class="muted" style="font-size:.85rem">No one in this role yet.</p>'}</div>`}).join('')}</div>`;
}
function updateSend(){
  const ppl=S.users.filter(u=>u.role!=='super_admin');
  $('#in-people').innerHTML=ppl.length?`<div class="people">${ppl.map(u=>`<label class="check"><span class="row" style="gap:8px"><input type="checkbox" id="pu-${u.id}" value="${u.id}" data-act="pick-user" ${S.sendUsers.has(u.id)?'checked':''}><span class="mono">${esc(u.username)}</span></span>${roleChip(u.role)}</label>`).join('')}</div>`:'<p class="muted">Add team members on the Users page first.</p>';
  updateSendCount();
  $('#live').innerHTML=`<section style="display:grid;gap:12px"><h2>Sent instructions</h2>${S.instructions.length?`<div class="list">${S.instructions.map(insRowAdmin).join('')}</div>`:empty('Nothing sent yet','Instructions you send appear here with their response progress.')}</section>`;
}
function updateSendCount(){
  const n=recipients({roles:[...S.sendRoles],userIds:[...S.sendUsers]}).length;
  const el=$('#in-count');if(el)el.textContent=n?`Reaches ${n} ${n===1?'person':'people'}`:'Choose at least one role or person';
}
function updateContent(){
  const fu=$('#f-user');const opts=S.users.filter(u=>u.role!=='super_admin'&&(!S.fRole||u.role===S.fRole));
  if(S.fUser&&!opts.some(u=>u.id===S.fUser))S.fUser='';
  fu.innerHTML=`<option value="">Everyone</option>`+opts.map(u=>`<option value="${u.id}" ${S.fUser===u.id?'selected':''}>${esc(u.username)}</option>`).join('');
  const list=S.subs.filter(s=>(!S.fRole||s.role===S.fRole)&&(!S.fUser||s.userId===S.fUser)&&(!S.fKind||(S.fKind==='resp'?!!s.instructionId:!s.instructionId)));
  $('#live').innerHTML=listOrEmpty(list,'Nothing matches','Change the filters, or wait for your team to upload.');
}
function usersHTML(){
  const admins=S.users.filter(u=>u.role==='super_admin').length;
  return `<div class="tablewrap"><table><thead><tr><th>Username</th><th>Role</th><th>Password</th><th></th></tr></thead><tbody>${S.users.map(u=>{
    const self=u.id===S.me.id;const lastAdmin=u.role==='super_admin'&&admins<=1;
    return `<tr><td><span class="mono">${esc(u.username)}</span>${self?' <span class="muted">(you)</span>':''}</td>
    <td><select class="select" id="role-of-${u.id}" data-act="set-role" data-id="${u.id}" ${lastAdmin?'disabled title="The hub needs at least one Super Admin"':''} aria-label="Role for ${esc(u.username)}">${ROLES.map(r=>`<option value="${r.key}" ${u.role===r.key?'selected':''}>${r.label}</option>`).join('')}</select></td>
    <td>${S.pwOpen===u.id?`<form class="pwrow" data-form="pw" data-id="${u.id}"><input class="input" id="pw-${u.id}" type="text" minlength="4" placeholder="New password" autocomplete="off" required><button class="btn sm primary" type="submit">Save</button><button class="btn sm ghost" type="button" data-act="pw-close">Cancel</button></form>`:`<button class="btn sm" data-act="pw-open" data-id="${u.id}">Change password</button>`}</td>
    <td style="text-align:right">${self||lastAdmin?'':`<button class="btn sm danger" data-act="del-user" data-id="${u.id}">Remove</button>`}</td></tr>`}).join('')}</tbody></table></div>`;
}

/* ---------- submissions ---------- */
function empty(t,s){return `<div class="empty"><b>${esc(t)}</b><span>${esc(s)}</span></div>`}
function listOrEmpty(list,t,s,hideIns){return list.length?`<div class="list">${list.map(x=>subHTML(x,hideIns)).join('')}</div>`:empty(t,s)}
function subHTML(s,hideIns){
  const ins=s.instructionId&&S.instructions.find(i=>i.id===s.instructionId);
  const canDel=isAdmin()||s.userId===S.me.id;
  const ctx=hideIns?'':s.instructionId?`<button class="btn sm ghost" style="padding:0;justify-content:flex-start" data-act="go" data-route="ins" data-param="${s.instructionId}">Re: ${esc(ins?ins.title:'deleted instruction')}</button>`:'<span class="muted" style="font-size:.85rem">Upload without instruction</span>';
  return `<article class="item" id="sub-${s.id}"><div class="item-top"><div class="row" style="gap:8px"><span class="mono">${esc(s.username)}</span>${roleChip(s.role)}</div><div class="row" style="gap:8px"><span class="mono muted">${fmtDate(s.createdAt)}</span>${(s.files||[]).length>1?`<button class="btn sm" data-act="sel-sub" data-id="${s.id}">Select all files</button>`:''}${canDel?`<button class="btn sm danger" data-act="del-sub" data-id="${s.id}">Delete</button>`:''}</div></div>
    ${ctx}${s.note?`<p class="body-text">${esc(s.note)}</p>`:''}
    ${isAdmin()&&s.instructionId?`<div class="rate"><span class="eyebrow">Speed</span><input class="input ev-speed" type="number" min="0" max="100" placeholder="–" data-ins="${s.instructionId}" data-user="${s.userId}" value="${(()=>{const x=(S.speeds||[]).find(z=>z.instructionId===s.instructionId&&z.userId===s.userId);return x&&x.score!==null?x.score:''})()}" aria-label="Speed percentage"><span class="muted">%</span><button class="btn sm primary" data-act="ev-save-speed">Save</button></div>`:''}
    ${isAdmin()&&s.instructionId?`<div class="rate"><span class="eyebrow">Accuracy</span><input class="input ev-rate" type="number" min="0" max="100" placeholder="–" data-id="${s.id}" value="${s.rating===null||s.rating===undefined?'':s.rating}" aria-label="Accuracy percentage"><span class="muted">%</span>${[100,75,50,0].map(v=>`<button type="button" class="btn sm" data-act="ev-quick" data-v="${v}">${v}</button>`).join('')}<button class="btn sm primary" data-act="ev-save-rate">Save</button></div>`:''}
    ${(s.files||[]).length?`<div class="files">${s.files.map(fileHTML).join('')}</div>`:''}${threadHTML(s)}</article>`;
}
function threadHTML(s){
  const cs=S.comments.filter(c=>c.submissionId===s.id),rv=S.revs.filter(r=>r.submissionId===s.id).sort((a,b)=>b.savedAt-a.savedAt);
  const open=!!S.thr[s.id],mine=s.userId===S.me.id;
  const label=`Conversation${cs.length?' ('+cs.length+')':''}${rv.length?' · edited '+rv.length+'×':''}`;
  let h=`<button type="button" class="btn sm thr-btn" data-act="thr" data-id="${s.id}" aria-expanded="${open}">${open?'Hide':'Open'} ${label}</button>`;
  if(!open)return h;
  const msgs=cs.length?cs.map(c=>`<div class="cmt${c.userId===S.me.id?' me':''}"><div class="cmt-h"><b>${esc(c.username)}</b>${roleChip(c.role)}<span class="mono muted">${fmtDate(c.createdAt)}</span></div><p class="body-text">${esc(c.body)}</p></div>`).join(''):'<p class="muted" style="font-size:.9rem">No comments yet.</p>';
  const hist=rv.length?`<details class="hist"><summary>Earlier versions (${rv.length})</summary>${rv.map(r=>`<div class="rev"><span class="mono muted">Saved ${fmtDate(r.savedAt)}</span>${r.note?`<p class="body-text">${esc(r.note)}</p>`:'<p class="muted">(no note)</p>'}${(r.files||[]).length?`<div class="files">${r.files.map(fileHTML).join('')}</div>`:''}</div>`).join('')}</details>`:'';
  const amend=mine?(S.amend===s.id?`<div class="amend"><label class="eyebrow" for="am-n-${s.id}">Amend your task</label><textarea class="textarea" id="am-n-${s.id}" data-draft="am-${s.id}" style="min-height:70px">${esc(S.draft['am-'+s.id]!==undefined?S.draft['am-'+s.id]:s.note)}</textarea>
      <input type="file" multiple data-amfile="${s.id}" aria-label="Add files"><div class="err" id="am-e-${s.id}"></div>
      <div class="row"><button type="button" class="btn sm primary" data-act="am-save" data-id="${s.id}">Save changes</button><button type="button" class="btn sm ghost" data-act="am-cancel">Cancel</button><span class="muted" style="font-size:.85rem">The previous version stays in the history.</span></div></div>`
    :`<button type="button" class="btn sm" data-act="am-open" data-id="${s.id}">Amend this task</button>`):'';
  return h+`<div class="thread"><div class="cmts">${msgs}</div>
    <form class="cmt-form" data-form="cmt" data-id="${s.id}"><textarea class="textarea" data-draft="cm-${s.id}" style="min-height:56px" placeholder="${isAdmin()?'Comment on this task…':'Reply…'}" aria-label="Comment">${esc(S.draft['cm-'+s.id]||'')}</textarea><div class="row" style="justify-content:flex-end"><button class="btn sm primary" type="submit">Send comment</button></div></form>
    ${amend}${s.editedAt?`<span class="mono muted">Last edited ${fmtDate(s.editedAt)}</span>`:''}${hist}</div>`;
}
function fileHTML(f){
  const url=f.url;const ext=(f.name.split('.').pop()||'file').slice(0,5);
  const inner=f.type.startsWith('image/')?`<img src="${url}" alt="${esc(f.name)}" loading="lazy">`:f.type.startsWith('video/')?`<video src="${url}" muted preload="metadata"></video>`:`<span class="ext">${esc(ext)}</span>`;
  const on=S.sel.has(url);
  return `<div class="ftile${on?' on':''}"><a class="thumb" href="${url}" target="_blank" rel="noopener"><span class="frame">${inner}</span><span class="nm" title="${esc(f.name)}">${esc(f.name)}</span><span class="mono muted">${fmtSize(f.size||0)}</span></a>
    <label class="fsel" title="Select for bulk download"><input type="checkbox" data-act="sel-file" data-url="${esc(url)}" aria-label="Select ${esc(f.name)}" ${on?'checked':''}></label>
    <a class="fdl" href="${esc(dlUrl(url))}" download="${esc(f.name)}" title="Download ${esc(f.name)}" aria-label="Download ${esc(f.name)}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg></a></div>`;
}

/* ---------- Date range (shared by Shopify, Odoo and Meta Ads) ---------- */
const pad2=n=>String(n).padStart(2,'0');
const todayStr=()=>{const d=new Date();return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())};
const lastDay=(y,m)=>new Date(y,m,0).getDate();
const MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
S.per={mode:'month',from:'',to:'',cmp:'smart',cfrom:'',cto:''};
function perSet(mode,from,to){const t=todayStr();if(from>t)return false;S.per.mode=mode;S.per.from=from;S.per.to=to>t?t:to;return true}
function perMonth(y,m){return perSet('month',y+'-'+pad2(m)+'-01',y+'-'+pad2(m)+'-'+pad2(lastDay(y,m)))}
function perQuarter(y,q){const m=(q-1)*3+1;return perSet('quarter',y+'-'+pad2(m)+'-01',y+'-'+pad2(m+2)+'-'+pad2(lastDay(y,m+2)))}
(function(){const t=todayStr();perMonth(+t.slice(0,4),+t.slice(5,7))})();
/* Compare options. Shifted ones keep the same day numbers (or weekdays) so like is compared with like. */
const CMP_OPTS=[['smart','Smart pick'],['auto','Previous period'],['week','Same weekdays, week(s) before'],['month','Same days last month'],['year','Same days last year'],['custom','Another period…']];
function cmpShift(d,how,wk){
  const [y,m,dd]=d.split('-').map(Number);
  if(how==='week'){const t=new Date(Date.UTC(y,m-1,dd-7*(wk||1)));return t.toISOString().slice(0,10)}
  const Y=how==='year'?y-1:(m===1?y-1:y),M=how==='year'?m:(m===1?12:m-1);
  return Y+'-'+pad2(M)+'-'+pad2(Math.min(dd,lastDay(Y,M)))}
function cmpSmart(){
  const p=S.per,days=Math.round((Date.parse(p.to)-Date.parse(p.from))/864e5)+1,wd=new Date(p.from+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'long',timeZone:'UTC'});
  if(days===1)return ['week','same '+wd+' last week, because each weekday sells differently'];
  if(days<=7)return ['week','the same weekdays last week, so busy and quiet days line up'];
  if(p.mode==='quarter'||days>62)return ['year','the same dates last year, so seasons and holidays line up'];
  return ['month','the same dates last month, so the month-to-date pace lines up'];
}
function cmpRange(){
  const p=S.per;let how=p.cmp;
  if(how==='smart')how=cmpSmart()[0];
  if(how==='custom')return p.cfrom&&p.cto?[p.cfrom,p.cto]:null;
  if(how==='week'||how==='month'||how==='year'){const wk=Math.max(1,Math.ceil((Math.round((Date.parse(p.to)-Date.parse(p.from))/864e5)+1)/7));return [cmpShift(p.from,how,wk),cmpShift(p.to,how,wk)]}
  return null;
}
function perQuery(){const p=S.per;let q='from='+p.from+'&to='+p.to;if(p.mode!=='custom')q+='&kind='+p.mode;const c=cmpRange();if(c)q+='&cfrom='+c[0]+'&cto='+c[1];return q}
function perReload(refresh){S.route==='dash'?loadDash(!!refresh,true):S.route==='meta'?loadMeta(undefined,refresh):S.route==='odoo'?loadOdoo(undefined,refresh):loadShop()}
function curData(){return S.route==='dash'?S.dash.d.shop:S.route==='meta'?S.meta.data:S.route==='odoo'?S.od.data:(S.an.tab==='overview'?S.shop.data:S.an.data)}
function cmpText(){const d=curData();return (d&&d.compareText)||'the period before'}
function perMonthSel(){return S.per.mode==='month'?S.per.from.slice(0,7):''}
function dateBar(d){
  const p=S.per,t=todayStr(),Y=+t.slice(0,4),opt=(v,l,cur)=>`<option value="${v}" ${String(v)===String(cur)?'selected':''}>${esc(l)}</option>`;
  const years=n=>Array.from({length:n},(_,i)=>Y-i);
  let pick='';
  if(p.mode==='day')pick=`<input type="date" class="input" id="per-day" value="${p.from}" max="${t}" aria-label="Day">`;
  else if(p.mode==='month')pick=`<select class="select" id="per-m" aria-label="Month">${MONTH_NAMES.map((n,i)=>opt(i+1,n,+p.from.slice(5,7))).join('')}</select><select class="select" id="per-y" aria-label="Year">${years(6).map(y=>opt(y,y,p.from.slice(0,4))).join('')}</select>`;
  else if(p.mode==='quarter')pick=`<select class="select" id="per-q" aria-label="Quarter">${[1,2,3,4].map(q=>opt(q,'Q'+q,Math.floor((+p.from.slice(5,7)-1)/3)+1)).join('')}</select><select class="select" id="per-y" aria-label="Year">${years(6).map(y=>opt(y,y,p.from.slice(0,4))).join('')}</select>`;
  else pick=`<input type="date" class="input" id="per-from" value="${p.from}" max="${t}" aria-label="From"><span class="muted">to</span><input type="date" class="input" id="per-to" value="${p.to}" max="${t}" aria-label="To">`;
  const cust=p.cmp==='custom'?`<input type="date" class="input" id="per-cfrom" value="${p.cfrom}" max="${t}" aria-label="Compare from"><span class="muted">to</span><input type="date" class="input" id="per-cto" value="${p.cto}" max="${t}" aria-label="Compare to">`:'';
  const info=d&&d.period?`<span class="perinfo"><b>${esc(d.period.label)}</b> <span class="muted">(${d.period.days} day${d.period.days===1?'':'s'}) compared with</span> <b>${esc(d.compare.label)}</b>${d.period.clamped?' <span class="muted">· cut at today</span>':''}${p.cmp==='smart'?`<br><span class="muted">Smart pick: comparing with ${cmpSmart()[1]}.</span>`:''}</span>`:'';
  return `<div class="datebar"><div class="seg" role="tablist" aria-label="Period type">${[['day','Day'],['month','Month'],['quarter','Quarter'],['custom','Custom']].map(([k,l])=>`<button class="segb${p.mode===k?' on':''}" data-act="per-mode" data-mode="${k}" aria-pressed="${p.mode===k}">${l}</button>`).join('')}</div>
  <div class="row perpick">${pick}</div>
  <div class="row perpick"><label class="muted" for="per-cmp">Compare with</label><select class="select" id="per-cmp">${CMP_OPTS.map(([v,l])=>opt(v,l,p.cmp)).join('')}</select>${cust}</div>
  ${info}</div>`;
}
function perChange(t){
  const p=S.per,v=t.value;
  if(t.id==='per-day'){if(!v)return;perSet('day',v,v)}
  else if(t.id==='per-m'||t.id==='per-y'){
    const m=t.id==='per-m'?+v:+document.getElementById('per-m').value,y=t.id==='per-y'?+v:+document.getElementById('per-y').value;
    if(!perMonth(y,m)){toast('That month has not started yet');return perRender()}}
  else if(t.id==='per-from'||t.id==='per-to'){
    let f=t.id==='per-from'?v:p.from,e=t.id==='per-to'?v:p.to;
    if(!f||!e)return;if(f>e){if(t.id==='per-from')e=f;else f=e}
    perSet('custom',f,e)}
  else if(t.id==='per-cmp'){
    p.cmp=v;if(v==='custom'){const d=curData();p.cfrom=(d&&d.compare&&d.compare.from)||'';p.cto=(d&&d.compare&&d.compare.to)||''}}
  else if(t.id==='per-cfrom'||t.id==='per-cto'){
    let f=t.id==='per-cfrom'?v:p.cfrom,e=t.id==='per-cto'?v:p.cto;
    if(!f||!e)return;if(f>e){if(t.id==='per-cfrom')e=f;else f=e}
    p.cfrom=f;p.cto=e}
  perReload();
}
function perRender(){S.route==='dash'?dashFill():S.route==='meta'?renderMeta():S.route==='odoo'?renderOdoo():renderShop()}

/* ---------- Homepage + Dashboards (Shopify + Odoo + Meta together) ---------- */
const REPORTS=[
  {k:'dash',t:'Dashboards',d:'Shopify, Odoo and Meta Ads together in one report: sales, profit, ad spend and stock side by side.',ico:'dash',c:'#FF8A3D',feat:1,ceo:1},
  {k:'shop',t:'Shopify',d:'Sales, funnel, products, customers and retention.',ico:'shop',c:'#2DD4BF',ceo:1},
  {k:'odoo',t:'Odoo',d:'Supply, sales, stock and finance.',ico:'odoo',c:'#A78BFA',ceo:1},
  {k:'meta',t:'Meta Ads',d:'Facebook and Instagram ad spend and results.',ico:'meta',c:'#FF8A3D',ceo:1},
  {k:'home',t:'Team overview',d:'Needs attention, deliveries, and who is waiting.',ico:'home',c:'#F472B6'},
  {k:'eval',t:'Evaluation',d:'Monthly KPIs and team ranking.',ico:'eval',c:'#FBBF24'},
  {k:'content',t:'All content',d:'Every file and note your team added.',ico:'content',c:'#60A5FA'},
  {k:'act',t:'Activity',d:'Who used the hub, which pages and for how long.',ico:'act',c:'#34D399'}
];
function hubHTML(){
  const list=REPORTS.filter(r=>isAdmin()||(isCeo()&&r.ceo));
  const t=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Africa/Cairo'});
  const tile=r=>`<button class="hub-t${r.feat?' feat':''}" style="--hc:${r.c}" data-act="go" data-route="${r.k}"><span class="kico" style="--kc:${r.c}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[r.ico]||NAV_ICON[r.ico]||''}</svg></span><span class="hub-tt">${r.t}</span><span class="hub-td">${r.d}</span><span class="hub-go">Open report <i>→</i></span></button>`;
  return `<div class="hub-bar">${brandHTML}<div class="row"><span class="muted">${esc(S.me.username)}</span>${roleChip(S.me.role)}<button class="btn sm so" data-act="theme-toggle">${theme()==='light'?'Dark':'Light'} mode</button><button class="btn sm so" data-act="logout">Sign out</button></div></div><div class="head"><div><h1>Welcome, ${esc(S.me.username)}</h1><p>${t}. Choose a report to open.</p></div></div><div class="hub-grid">${list.map(tile).join('')}</div>`;
}
S.dash={d:{},err:{},done:{},busy:false,tok:0,at:0,focus:'all',trendM:'money',dayM:'revenue',dayCmp:true,off:{},prodBy:'revenue',prodQ:'',geo:'countries',campBy:'spend'};
const DC={shop:'#2DD4BF',odoo:'#A78BFA',meta:'#FF8A3D',good:'#34D399',bad:'#F87171',pink:'#F472B6',blue:'#60A5FA',amber:'#FBBF24'};
const DNAME={shop:'Shopify',meta:'Meta Ads',odoo:'Odoo profit',stock:'Odoo stock',sales:'Odoo sales',cash:'Odoo invoices'};
function dashJobs(){
  const q=perQuery();
  return [['shop','/api/shopify?only=summary&'+q],['meta','/api/meta?tab=overview&only=kpi,trend,campaigns,platform&'+q],
    ['odoo','/api/odoo?tab=profit&only=kpi,trend,cost&'+q],['stock','/api/odoo?tab=finished&only=kpi,sold&'+q],
    ['sales','/api/odoo?tab=sales&only=kpi&'+q],['cash','/api/odoo?tab=in&only=kpi,aging,overdue&'+q]];
}
async function dashGet(url,retry){
  try{const d=await api('GET',url,null,65000);if(d&&d.configured===false)throw new Error('Not connected yet. Add its keys in Vercel, then reload.');return d}
  catch(e){if(!retry&&/taking longer|Server error|went wrong|reach the server/i.test(e.message||'')){await new Promise(r=>setTimeout(r,4000));return dashGet(url,true)}throw e}
}
async function dashRun(key,force,tok){
  const D=S.dash,job=dashJobs().find(j=>j[0]===key);delete D.err[key];
  try{const d=await dashGet(job[1]+(force?'&refresh=1':''));if(tok!==D.tok)return;D.d[key]=d}
  catch(e){if(tok!==D.tok)return;D.err[key]=e.message||'Could not load'}
  D.done[key]=1;D.at=Date.now();dashFill();
}
async function loadDash(force,clear){
  const D=S.dash,tok=++D.tok;
  if(clear){D.d={};D.done={}}D.err={};D.busy=true;dashFill();
  const odooChain=async()=>{for(const k of ['odoo','stock','sales','cash'])await dashRun(k,force,tok)};
  await Promise.all([dashRun('shop',force,tok),dashRun('meta',force,tok),odooChain()]);
  if(tok===D.tok){D.busy=false;dashFill()}
}
let dashT=0;
function dashFill(){
  if(S.screen!=='app'||S.route!=='dash')return;const L=$('#live');if(!L)return;
  // Many answers can arrive within a moment of each other: draw once per frame.
  if(dashT)return;dashT=requestAnimationFrame(()=>{dashT=0;const y=window.scrollY,a=document.activeElement,aid=a&&a.id;L.innerHTML=dashHTML();dSizeCharts();window.scrollTo(0,y);if(aid){const n=document.getElementById(aid);if(n&&n.focus){n.focus();if(n.setSelectionRange&&typeof n.value==='string')n.setSelectionRange(n.value.length,n.value.length)}}});
}

/* ---- small helpers ---- */
const dSec=(d,id)=>((d&&d.sections)||[]).find(x=>x.id===id);
const dT=(d,l)=>pvTile(d,'kpi',l);
const dReady=k=>!!(S.dash.done[k]&&S.dash.d[k]);
const dCur=()=>{const D=S.dash.d;return (D.shop&&D.shop.currency)||(D.odoo&&D.odoo.currency)||(D.meta&&D.meta.currency)||''};
const dM=n=>pvCur(n,dCur());
const dMf=n=>{n=Number(n)||0;const c=dCur();try{return new Intl.NumberFormat('en-US',c?{style:'currency',currency:c,maximumFractionDigits:0}:{maximumFractionDigits:0}).format(n)}catch(e){return Math.round(n).toLocaleString()}};
const dMs=n=>{n=Number(n)||0;const c=dCur();try{return new Intl.NumberFormat('en-US',c?{style:'currency',currency:c,notation:'compact',maximumFractionDigits:1}:{notation:'compact',maximumFractionDigits:1}).format(n)}catch(e){return dN(n)}};
const dN=n=>{n=Number(n)||0;return Math.abs(n)>=1e6?(n/1e6).toFixed(1)+'M':Math.abs(n)>=1e4?(n/1e3).toFixed(1)+'K':Math.round(n).toLocaleString('en-US')};
const dX=n=>(Number(n)||0).toFixed(2)+'×';
const dP=n=>(Number(n)||0).toFixed(1)+'%';
const dDay=s=>new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
const dWk=s=>new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
const dDaily=t=>!t||!t.daily?null:Array.isArray(t.daily)?{cur:t.daily,dates:null,prev:null}:t.daily;
const dDiv=(a,b)=>b?a/b:0;
const dIco=k=>`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]||NAV_ICON[k]||''}</svg>`;
function dGate(keys,fn,h){
  const D=S.dash;keys=[].concat(keys);const bad=keys.find(k=>D.err[k]);
  if(bad)return `<div class="dx-err"><b>Could not load ${DNAME[bad]||bad}.</b><span class="muted">${esc(D.err[bad])}</span><button class="btn sm" data-act="dash-retry" data-k="${bad}">Try again</button></div>`;
  if(!keys.every(dReady))return `<div class="dx-skel" style="height:${h||160}px"><span>Loading ${keys.filter(k=>!dReady(k)).map(k=>DNAME[k]).join(', ')}…</span></div>`;
  try{return fn()}catch(e){console.error(e);return '<p class="muted">This part could not be drawn with the data that came back.</p>'}
}
function dCard(title,sub,body,o={}){
  return `<section class="dx-card ${o.cls||''}" style="grid-column:span ${o.span||12}${o.color?';--dc:'+o.color:''}"><header class="dx-ch"><div><h3>${o.dot?`<i class="dx-dot" style="background:${o.dot}"></i>`:''}${title}</h3>${sub?`<p>${sub}</p>`:''}</div>${o.tools||''}</header>${body}</section>`;
}
function dStat(label,value,delta,goodDown,sub,color){
  return `<div class="dx-stat"${color?` style="--sc:${color}"`:''}><span>${label}</span><b>${value}</b><em>${delta===null||delta===undefined||!isFinite(delta)?'':chip(Math.round(delta*10)/10,goodDown)}${sub?`<small>${sub}</small>`:''}</em></div>`;
}
function dSeg(name,cur,opts){return `<div class="dx-seg" role="group">${opts.map(([v,l])=>`<button class="${cur===v?'on':''}" data-act="dx-set" data-k="${name}" data-v="${v}" aria-pressed="${cur===v}">${l}</button>`).join('')}</div>`}
function dBars(rows,o={}){
  if(!rows.length)return `<p class="muted dx-empty">${o.empty||'Nothing in this period.'}</p>`;
  const mx=Math.max(...rows.map(r=>Math.abs(r.v)),1);
  return `<ul class="dx-hb">${rows.map((r,i)=>`<li><span class="dx-hn">${o.rank?`<i>${i+1}</i>`:''}${r.img?`<img src="${esc(r.img)}" alt="" loading="lazy">`:''}<span title="${esc(r.l)}">${esc(r.l)}</span></span><span class="dx-hv"><b>${r.f||dM(r.v)}</b>${r.s?`<small>${r.s}</small>`:''}</span><span class="dx-ht"><i style="width:${Math.max(2,Math.abs(r.v)/mx*100)}%;background:${r.c||o.color||'var(--accent)'}"></i></span></li>`).join('')}</ul>`;
}
function dDonut(parts,center,sub){
  parts=parts.filter(p=>p.v>0);const tot=parts.reduce((a,p)=>a+p.v,0);
  if(!tot)return '<p class="muted dx-empty">Nothing to show for this period.</p>';
  const r=54,C=2*Math.PI*r;let off=0;
  const arcs=parts.map(p=>{const len=C*p.v/tot,s=`<circle cx="70" cy="70" r="${r}" fill="none" stroke="${p.c}" stroke-width="16" stroke-dasharray="${Math.max(0,len-2)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"><title>${esc(p.l)}: ${Math.round(p.v/tot*100)}%</title></circle>`;off+=len;return s}).join('');
  return `<div class="dx-dn"><svg viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--line)" stroke-width="16"/>${arcs}<text x="70" y="68" text-anchor="middle" class="dx-dn-v">${center}</text><text x="70" y="86" text-anchor="middle" class="dx-dn-s">${sub||''}</text></svg><ul>${parts.map(p=>`<li><i style="background:${p.c}"></i><span>${esc(p.l)}</span><b>${Math.round(p.v/tot*100)}%</b><small>${p.f||dM(p.v)}</small></li>`).join('')}</ul></div>`;
}
function dRing(score,color){
  const r=46,C=2*Math.PI*r,len=C*Math.max(0,Math.min(100,score))/100;
  return `<svg class="dx-ring" viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="dxrg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${DC.pink}"/><stop offset="1" stop-color="${color}"/></linearGradient></defs><circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="10"/><circle cx="60" cy="60" r="${r}" fill="none" stroke="url(#dxrg)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${len} ${C}" transform="rotate(-90 60 60)"/><text x="60" y="66" text-anchor="middle">${Math.round(score)}</text></svg>`;
}

/* ---- chart kit: bars + lines on one or two axes, drawn at the real width, with a hover read-out ---- */
const CH={};
function dLegend(id,series){return `<div class="dx-lg">${series.map((s,i)=>`<button class="${S.dash.off[id+':'+s.name]?'off':''}" data-act="ch-toggle" data-c="${id}" data-s="${esc(s.name)}"><i class="${s.type}" style="--lc:${s.color}"></i>${esc(s.name)}</button>`).join('')}</div>`}
function dChart(id,o){CH[id]=o;return `${o.legend===false?'':dLegend(id,o.series)}<div class="ch" data-c="${id}" style="height:${o.h||260}px"></div>`}
function dNice(m){if(!(m>0))return 1;const p=Math.pow(10,Math.floor(Math.log10(m))),f=m/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p}
function dChartSVG(id,el){
  const o=CH[id];if(!o)return;const W=Math.max(260,el.clientWidth),H=o.h||260,n=o.labels.length;
  const vis=o.series.filter(s=>!S.dash.off[id+':'+s.name]),hasR=vis.some(s=>s.axis==='r');
  const small=W<480,pl=small?44:58,pr=hasR?(small?44:58):12,pt=12,pb=26,iw=W-pl-pr,ih=H-pt-pb,bw=iw/Math.max(n,1);
  const ext=ax=>{const v=vis.filter(s=>(s.axis||'l')===ax).flatMap(s=>s.values.map(Number).filter(Number.isFinite));return v.length?Math.max(...v,0):0};
  const ml=dNice(ext('l')),mr=dNice(ext('r')),yl=v=>pt+ih-ih*(v/ml),yr=v=>pt+ih-ih*(v/mr),x=i=>pl+bw*i+bw/2;
  const fl=o.fmtL||dN,fr=o.fmtR||dN;
  let g='';
  for(let k=0;k<=4;k++){const y=pt+ih-ih*k/4;g+=`<line x1="${pl}" x2="${W-pr}" y1="${y}" y2="${y}" class="ch-g"/><text x="${pl-8}" y="${y+4}" text-anchor="end" class="ch-t">${fl(ml*k/4)}</text>${hasR?`<text x="${W-pr+8}" y="${y+4}" class="ch-t">${fr(mr*k/4)}</text>`:''}`}
  const step=Math.ceil(n/(small?5:9));
  o.labels.forEach((l,i)=>{if(i%step===0||(i===n-1&&(n-1)%step>=step*.6))g+=`<text x="${x(i)}" y="${H-8}" text-anchor="middle" class="ch-t">${esc(o.short?o.short(l):l)}</text>`});
  const bars=vis.filter(s=>s.type==='bar'),bwi=Math.min(38,bw*.72)/Math.max(bars.length,1);
  let marks='';
  bars.forEach((s,j)=>{const Y=s.axis==='r'?yr:yl;s.values.forEach((v,i)=>{v=Number(v)||0;if(v<=0)return;const bx=x(i)-bwi*bars.length/2+bwi*j,y=Y(v);marks+=`<rect x="${bx.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1,bwi-1.5).toFixed(1)}" height="${(pt+ih-y).toFixed(1)}" rx="${Math.min(4,bwi/3).toFixed(1)}" fill="${s.color}" opacity="${s.dim?.45:.9}"/>`})});
  vis.filter(s=>s.type!=='bar').forEach((s,j)=>{
    const Y=s.axis==='r'?yr:yl,pts=s.values.map((v,i)=>v===null||v===undefined||!Number.isFinite(Number(v))?null:[x(i),Y(Number(v))]);
    const segs=[];let cur=[];pts.forEach(p=>{if(p)cur.push(p);else if(cur.length){segs.push(cur);cur=[]}});if(cur.length)segs.push(cur);
    const gid='cg'+id+j;
    segs.forEach(sg=>{const d=sg.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join('');
      if(s.type==='area')marks+=`<path d="${d}L${sg[sg.length-1][0].toFixed(1)},${pt+ih}L${sg[0][0].toFixed(1)},${pt+ih}Z" fill="url(#${gid})"/>`;
      marks+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.type==='dash'?1.8:2.6}" ${s.type==='dash'?'stroke-dasharray="5 5" opacity=".8"':''} stroke-linejoin="round" stroke-linecap="round"/>`;
      if(n<=16&&s.type!=='dash')sg.forEach(p=>marks+=`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.2" fill="var(--card)" stroke="${s.color}" stroke-width="2"/>`)});
    if(s.type==='area')marks=`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".32"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>`+marks;
  });
  o.geo={pl,bw,n,W,H,pt,ih};
  el.innerHTML=`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title||'Chart')}">${g}${marks}<line class="ch-x" x1="0" x2="0" y1="${pt}" y2="${pt+ih}" style="display:none"/></svg><div class="ch-tip" hidden></div>`;
}
function dSizeCharts(){document.querySelectorAll('#live .ch').forEach(el=>dChartSVG(el.dataset.c,el))}
function dChartHover(el,ev){
  const id=el.dataset.c,o=CH[id];if(!o||!o.geo)return;const r=el.getBoundingClientRect(),px=ev.clientX-r.left,{pl,bw,n,pt,ih,W}=o.geo;
  const i=Math.floor((px-pl)/bw),tip=el.querySelector('.ch-tip'),ln=el.querySelector('.ch-x');
  if(i<0||i>=n){tip.hidden=true;if(ln)ln.style.display='none';return}
  const vis=o.series.filter(s=>!S.dash.off[id+':'+s.name]),cx=pl+bw*i+bw/2;
  if(ln){ln.setAttribute('x1',cx);ln.setAttribute('x2',cx);ln.style.display=''}
  tip.innerHTML=`<b>${esc(o.tipLabel?o.tipLabel(i):o.labels[i])}</b>${vis.map(s=>{const v=s.values[i];return `<span><i style="background:${s.color}"></i>${esc(s.name)}<em>${v===null||v===undefined?'–':(s.fmt||dN)(v)}</em></span>`}).join('')}`;
  tip.hidden=false;const tw=tip.offsetWidth;tip.style.left=Math.max(4,Math.min(W-tw-4,cx+(cx>W/2?-tw-14:14)))+'px';tip.style.top=(pt+8)+'px';
}
document.addEventListener('pointermove',e=>{const el=e.target.closest&&e.target.closest('.ch');if(el)dChartHover(el,e)});
document.addEventListener('pointerout',e=>{const el=e.target.closest&&e.target.closest('.ch');if(el&&!el.contains(e.relatedTarget)){const t=el.querySelector('.ch-tip'),l=el.querySelector('.ch-x');if(t)t.hidden=true;if(l)l.style.display='none'}});
let dResizeT;window.addEventListener('resize',()=>{clearTimeout(dResizeT);dResizeT=setTimeout(()=>{if(S.route==='dash')dSizeCharts()},150)});

/* ---- the numbers everything below is built from ---- */
function dModel(){
  const D=S.dash.d,sh=D.shop,ss=sh&&sh.summary,od=D.odoo,mt=D.meta,st=D.stock,sa=D.sales,ca=D.cash;
  const t=(d,l)=>dT(d,l);
  return {sh,ss,od,mt,st,sa,ca,
    rev:t(od,'Net revenue'),cost:t(od,'Product cost'),gross:t(od,'Gross profit'),oads:t(od,'Ad spend (Meta)'),pro:t(od,'Profit after ads')||t(od,'Gross profit'),
    sp:t(mt,'Amount spent'),pu:t(mt,'Purchases'),pv:t(mt,'Purchase value'),ro:t(mt,'Return on ad spend'),cpp:t(mt,'Cost per purchase'),reach:t(mt,'People reached'),imp:t(mt,'Impressions'),clk:t(mt,'Link clicks'),ctr:t(mt,'Link click rate'),cpc:t(mt,'Cost per link click'),cpm:t(mt,'Cost per 1,000 views'),
    oos:t(st,'Out of stock'),low:t(st,'Running low'),sval:t(st,'Finished goods value (at cost)'),ssale:t(st,'Value at sale price'),sunits:t(st,'Units sold in this period'),
    owe:t(ca,'Customers owe you'),inv:t(ca,'Invoiced to customers'),paid:t(ca,'Payments received')};
}
function dHealth(m){
  const parts=[],clamp=v=>Math.max(0,Math.min(1,v));
  if(m.ss&&m.ss.change&&m.ss.change.revenue!==null&&m.ss.change.revenue!==undefined)parts.push(['Sales growth',clamp((m.ss.change.revenue+20)/40),`${m.ss.change.revenue>=0?'+':''}${m.ss.change.revenue}% Shopify revenue`]);
  if(m.ss&&m.sp&&m.sp.value)parts.push(['Ad efficiency',clamp((dDiv(m.ss.revenue,m.sp.value)-1)/5),dX(dDiv(m.ss.revenue,m.sp.value))+' store revenue per 1 on ads']);
  if(m.pro&&m.rev&&m.rev.value)parts.push(['Profit margin',clamp(dDiv(m.pro.value,m.rev.value)/.35),dP(dDiv(m.pro.value,m.rev.value)*100)+' of Odoo net revenue']);
  const prods=dT(m.st,'Products');if(m.oos&&prods&&prods.value)parts.push(['Stock availability',clamp(1-dDiv(m.oos.value,prods.value)/.2),`${m.oos.value} of ${prods.value} finished goods out of stock`]);
  if(!parts.length)return null;
  return {score:parts.reduce((a,p)=>a+p[1],0)/parts.length*100,parts};
}
function dInsights(m){
  const out=[],add=(tone,ico,html)=>out.push({tone,ico,html});
  const ss=m.ss;
  if(ss&&m.sp&&m.sp.prev){const rc=ss.change.revenue,sc=pvPct(m.sp.value,m.sp.prev);
    if(rc!==null&&sc!==null){if(rc-sc>5)add('good','trend',`Sales grew <b>${rc}%</b> while ad spend changed <b>${sc}%</b>. Every pound on ads is working harder than before.`);
      else if(sc-rc>5)add('bad','alert',`Ad spend rose <b>${sc}%</b> but sales only <b>${rc}%</b>. Ads are getting more expensive per sale; review the weakest campaigns below.`);
      else add('info','trend',`Sales (<b>${rc>=0?'+':''}${rc}%</b>) and ad spend (<b>${sc>=0?'+':''}${sc}%</b>) moved together.`)}}
  const dl=m.sh&&m.sh.daily&&m.sh.daily.cur;if(dl&&dl.revenue.some(v=>v)){const i=dl.revenue.indexOf(Math.max(...dl.revenue));add('good','star',`Best day was <b>${dWk(dl.dates[i])}</b> with <b>${dMf(dl.revenue[i])}</b> from ${dl.orders[i]} orders.`)}
  const cs=dSec(m.mt,'campaigns');if(cs&&cs.rows&&cs.rows.length){const r=cs.rows.filter(x=>x.spend>0);const best=r.slice().sort((a,b)=>b.roas-a.roas)[0],worst=r.filter(x=>x.spend>=(m.sp?m.sp.value*.08:0)).sort((a,b)=>a.roas-b.roas)[0];
    if(best&&best.roas)add('good','meta',`Strongest campaign: <b>${esc(best.name)}</b> returned <b>${dX(best.roas)}</b> on ${dM(best.spend)}.`);
    if(worst&&worst!==best&&worst.roas<1.5)add('bad','meta',`<b>${esc(worst.name)}</b> spent ${dM(worst.spend)} for only <b>${dX(worst.roas)}</b>. Consider pausing it or changing the creative.`)}
  if(m.oos&&m.oos.value){const rows=(m.oos.breakdown&&m.oos.breakdown.rows)||[];add('bad','alert',`<b>${m.oos.value}</b> finished product${m.oos.value===1?' is':'s are'} out of stock${rows.length?`, including <b>${esc(rows[0].name)}</b>`:''}.${m.low&&m.low.value?` ${m.low.value} more running low.`:''}`)}
  else if(m.low&&m.low.value)add('info','alert',`<b>${m.low.value}</b> finished product${m.low.value===1?' is':'s are'} running low. Plan production before they sell out.`);
  const ag=dSec(m.ca,'aging');if(m.owe&&m.owe.value){const late=ag&&ag.rows?ag.rows.filter(r=>!/not yet|current|not due/i.test(r.name)).reduce((a,r)=>a+(Number(r.value)||0),0):0;add(late?'bad':'info','refund',`Customers owe you <b>${dMf(m.owe.value)}</b>${late?`, of which <b>${dMf(late)}</b> is overdue`:''}.`)}
  const hm=m.sh&&m.sh.heat;if(hm){let b=[0,0,0];hm.forEach((r,w)=>r.forEach((v,h)=>{if(v>b[0])b=[v,w,h]}));if(b[0]>1)add('info','chat',`Most orders arrive on <b>${['Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays','Sundays'][b[1]]}</b> around <b>${b[2]}:00</b>. Time posts and budget boosts for just before then.`)}
  if(ss&&m.sh.abandoned&&m.sh.abandoned.monthValue)add('info','bag',`<b>${dMf(m.sh.abandoned.monthValue)}</b> was left in ${m.sh.abandoned.monthCount} unfinished carts this period (${dP(m.sh.abandoned.monthRate)} of checkouts).`);
  return out;
}

/* ---- sections ---- */
function dHero(m){
  const H=dHealth(m),sh=m.ss;
  const metric=(label,keys,val,delta,goodDown,sub,spark,color)=>`<div class="dx-hm" style="--hc:${color}"><span class="dx-hl"><i style="background:${color}"></i>${label}</span>${[].concat(keys).every(dReady)?`<b>${val}</b><span class="dx-hd">${delta===null||delta===undefined||!isFinite(delta)?'':chip(Math.round(delta*10)/10,goodDown)}<small>${sub||''}</small></span>${spark||''}`:S.dash.err[[].concat(keys).find(k=>S.dash.err[k])]?`<b class="muted">–</b><small class="muted">Could not load</small>`:'<div class="pv-sk"><i></i><i></i></div>'}</div>`;
  const sd=m.sh&&m.sh.daily&&m.sh.daily.cur,md=dDaily(m.sp);
  const blend=sh&&m.sp&&m.sp.value?dDiv(sh.revenue,m.sp.value):null,blendPrev=sh&&m.sp&&m.sp.prev?dDiv(sh.previous.revenue,m.sp.prev):null;
  const per=(m.sh&&m.sh.period&&m.sh.period.label)||(m.od&&m.od.period&&m.od.period.label)||'';
  return `<section class="dx-hero"><div class="dx-hero-top"><div><span class="dx-eye">Bless · all systems${per?' · '+esc(per):''}</span><h2>${sh?dMf(sh.revenue):'…'}<small>in Shopify sales${sh&&sh.change.revenue!==null?` · ${sh.change.revenue>=0?'up':'down'} ${Math.abs(sh.change.revenue)}% on ${esc(m.sh.compareText||'the period before')}`:''}</small></h2></div>
    ${H?`<div class="dx-health" tabindex="0">${dRing(H.score,DC.good)}<div><span class="dx-eye">Business health</span><b>${H.score>=70?'Strong':H.score>=45?'Steady':'Needs attention'}</b><ul>${H.parts.map(p=>`<li><i style="width:${Math.round(p[1]*100)}%"></i><span>${p[0]}</span><small>${p[2]}</small></li>`).join('')}</ul></div></div>`:''}</div>
    <div class="dx-hgrid">
      ${metric('Orders','shop',sh?dN(sh.orders):'',sh&&sh.change.orders,false,sh?dMf(sh.aov)+' average':'',sd?pvSpark(sd.orders,DC.shop):'',DC.shop)}
      ${metric(m.pro?m.pro.label:'Profit after ads','odoo',m.pro?dMf(m.pro.value):'–',m.pro?pvPct(m.pro.value,m.pro.prev):null,false,m.pro&&m.rev&&m.rev.value?dP(dDiv(m.pro.value,m.rev.value)*100)+' margin in Odoo':'from Odoo',(()=>{const tr=dSec(m.od,'trend');return tr?pvSpark(tr.rows.map(r=>r.values.profit),DC.odoo):''})(),DC.odoo)}
      ${metric('Ad spend','meta',m.sp?dMf(m.sp.value):'–',m.sp?pvPct(m.sp.value,m.sp.prev):null,true,m.pu?dN(m.pu.value)+' purchases on Meta':'',md&&md.cur?pvSpark(md.cur,DC.meta):'',DC.meta)}
      ${metric('Store return on ads',['shop','meta'],blend!==null?dX(blend):'–',blend!==null&&blendPrev?pvPct(blend,blendPrev):null,false,'Shopify revenue ÷ Meta spend','',DC.pink)}
    </div></section>`;
}
function dInsightsHTML(m){
  const list=dInsights(m);if(!list.length)return '';
  return `<section class="dx-ins">${list.slice(0,8).map(x=>`<div class="dx-in ${x.tone}"><span>${dIco(x.ico)}</span><p>${x.html}</p></div>`).join('')}</section>`;
}
function dSalesHTML(m){
  const D=S.dash;
  const daily=dGate(['shop'],()=>{
    const dd=m.sh.daily;if(!dd||!dd.cur)return '<p class="muted dx-empty">Day-by-day sales are not available for this period (it is older than the synced orders). Pick a more recent period.</p>';
    const cur=dd.cur,prev=dd.prev,isR=D.dayM==='revenue',md=dDaily(m.sp),mpu=dDaily(m.pu);
    const mByDate=(t)=>{if(!t||!t.dates)return null;const mp=new Map(t.dates.map((d,i)=>[d,t.cur[i]]));return cur.dates.map(d=>mp.has(d)?mp.get(d):null)};
    const series=[{name:isR?'Shopify revenue':'Shopify orders',type:'bar',color:DC.shop,values:isR?cur.revenue:cur.orders,fmt:isR?dMf:dN}];
    if(D.dayCmp&&prev)series.push({name:'Previous period',type:'dash',color:'#94A3B8',values:cur.dates.map((_,i)=>(isR?prev.revenue:prev.orders)[i]??null),fmt:isR?dMf:dN});
    const ms=isR?mByDate(md):mByDate(mpu);if(ms)series.push({name:isR?'Meta ad spend':'Meta purchases',type:'line',color:DC.meta,values:ms,axis:isR?'r':'l',fmt:isR?dMf:dN});
    return dChart('daily',{h:340,labels:cur.dates,short:dDay,tipLabel:i=>dWk(cur.dates[i])+(prev&&prev.dates[i]?` · vs ${dDay(prev.dates[i])}`:''),series,fmtL:dN,fmtR:dN,title:'Sales by day'});
  },300);
  const tools=`<div class="row">${dSeg('dayM',D.dayM,[['revenue','Revenue'],['orders','Orders']])}<label class="dx-chk"><input type="checkbox" data-dx="dayCmp" ${D.dayCmp?'checked':''}> Compare</label></div>`;
  const stats=dGate(['shop'],()=>{const s=m.ss,p=s.previous||{};return `<div class="dx-stats">${dStat('Revenue',dMf(s.revenue),s.change.revenue,false,'',DC.shop)}${dStat('Orders',dN(s.orders),s.change.orders,false,'',DC.shop)}${dStat('Average order',dMf(s.aov),pvPct(s.aov,p.aov),false,'',DC.shop)}${dStat('Items sold',dN(s.units),s.change.units,false,'',DC.shop)}${dStat('Refunds',dMf(s.refunds),pvPct(s.refunds,p.refunds),true,dP(s.refundRate)+' of revenue',DC.bad)}${dStat('Cancelled',dN(s.cancelled||0),null,true,dP(s.cancelRate||0)+' of orders',DC.bad)}</div>`},120);
  const heat=dGate(['shop'],()=>{const h=m.sh.heat;if(!h)return '<p class="muted dx-empty">Not available for this period.</p>';const mx=Math.max(1,...h.flat());const W=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    return `<div class="dx-heat"><div class="dx-hr"><span></span>${Array.from({length:24},(_,i)=>`<span class="dx-hh">${i%3===0?i:''}</span>`).join('')}</div>${h.map((r,w)=>`<div class="dx-hr"><span class="dx-hw">${W[w]}</span>${r.map((v,hh)=>`<span class="dx-hc" style="--a:${v?(.12+.88*v/mx).toFixed(2):0}" title="${W[w]} ${hh}:00 · ${v} order${v===1?'':'s'}"></span>`).join('')}</div>`).join('')}<div class="dx-hk"><span>Fewer</span><i></i><span>More orders</span></div></div>`},200);
  const prods=dGate(['shop'],()=>`<div class="row dx-tl">${dSeg('prodBy',D.prodBy,[['revenue','By revenue'],['units','By units']])}<input class="input dx-q" id="dx-pq" data-dxq="prodQ" placeholder="Search products" value="${esc(D.prodQ)}"></div><div id="dx-prods">${dProdList(m)}</div>`,240);
  const geo=dGate(['shop'],()=>{const L=(rows,c)=>dBars((rows||[]).slice(0,5).map(r=>({l:r.name||r.country||r.city||'Unknown',v:r.revenue,c,s:dN(r.orders)+' orders'})),{rank:1});return `<h4 class="dx-h4" style="margin-top:0">Countries</h4>${L(m.sh.countries,DC.blue)}<h4 class="dx-h4">Cities</h4>${L(m.sh.cities,DC.pink)}`},240);
  const cust=dGate(['shop'],()=>{const c=m.sh.customers;if(!c)return '<p class="muted dx-empty">No customer data.</p>';return dDonut([{l:'Returning customers',v:c.repeat,c:DC.shop,f:dN(c.repeat)},{l:'First-time customers',v:c.fresh,c:DC.pink,f:dN(c.fresh)},{l:'Guest checkouts',v:c.guest,c:'#94A3B8',f:dN(c.guest)}],dP(c.repeatRate),'returning')},200);
  const carts=dGate(['shop'],()=>{const a=m.sh.abandoned;if(!a)return '<p class="muted dx-empty">No cart data.</p>';const ag=a.aging||[],tot=ag.reduce((x,b)=>x+b.value,0)||1,cc=[DC.good,DC.amber,'#FB923C',DC.bad];
    return `<div class="dx-stats">${dStat('Left this period',dMf(a.monthValue),null,true,dN(a.monthCount)+' carts · '+dP(a.monthRate),DC.amber)}${dStat('Still open (90 days)',dMf(a.openValue),null,true,dN(a.openCount)+' carts',DC.amber)}</div>
      <div class="dx-stk">${ag.map((b,i)=>`<i style="flex:${b.value/tot};background:${cc[i%4]}" title="${esc(b.label)}"></i>`).join('')}</div><ul class="dx-ol">${ag.map((b,i)=>`<li><span><i class="dx-sq" style="background:${cc[i%4]}"></i>${esc(b.label)}</span><b>${dM(b.value)}</b></li>`).join('')}</ul><button class="btn sm ghost" style="margin-top:12px" data-act="dtab" data-t="shop">Recover carts →</button>`},200);
  return `<div class="dx-block" id="dx-sales"><div class="dx-bh"><span class="dx-bi" style="--bc:${DC.shop}">${dIco('shop')}</span><div><h2>Sales</h2><p>Shopify store: what sold, when and to whom.</p></div></div><div class="dx-grid">
    ${dCard('Sales by day',m.sh&&m.sh.period?esc(m.sh.period.label):'',daily,{span:8,tools,dot:DC.shop})}
    ${dCard('At a glance','vs '+esc((m.sh&&m.sh.compareText)||'the period before'),stats,{span:4})}
    ${dCard('Best sellers','Shopify, this period',prods,{span:6})}
    ${dCard('Where orders come from','Shopify revenue by place',geo,{span:6})}
    ${dCard('When people order','Shopify orders by weekday and hour (Cairo time)',heat,{span:6})}
    ${dCard('Customers','Who bought this period',cust,{span:3})}
    ${dCard('Unfinished carts','Money left at checkout',carts,{span:3})}
  </div></div>`;
}
function dProdList(m){
  const D=S.dash;m=m||dModel();if(!m.sh)return '';const q=D.prodQ.trim().toLowerCase();
  const rows=((D.prodBy==='units'?m.sh.bestByUnits:m.sh.bestByRevenue)||[]).filter(p=>!q||String(p.title).toLowerCase().includes(q)).slice(0,8);
  return dBars(rows.map(p=>({l:p.title,v:D.prodBy==='units'?p.units:p.revenue,f:D.prodBy==='units'?dN(p.units)+' units':dMf(p.revenue),s:D.prodBy==='units'?dMf(p.revenue):dN(p.units)+' units'})),{color:DC.shop,rank:1,empty:q?'No product matches that search.':'No sales in this period.'});
}
function dMarketingHTML(m){
  const D=S.dash;
  const funnel=dGate(['meta','shop'],()=>{
    const steps=[['People reached',m.reach&&m.reach.value],['Saw an ad (impressions)',m.imp&&m.imp.value],['Clicked through',m.clk&&m.clk.value],['Bought (Meta says)',m.pu&&m.pu.value],['Shopify orders (all sources)',m.ss&&m.ss.orders]].filter(s=>s[1]!==undefined&&s[1]!==null);
    const mx=Math.max(...steps.map(s=>s[1]),1),w=v=>v>0?12+88*Math.log10(v+1)/Math.log10(mx+1):4;
    const cols=[DC.meta,'#FB923C','#F472B6','#C084FC',DC.shop];
    return `<div class="dx-fn">${steps.map((s,i)=>{const prev=i?steps[i-1][1]:null,conv=prev&&i<4?dP(s[1]/prev*100):'';return `<div class="dx-fr"><div class="dx-fl"><span>${s[0]}</span><b>${dN(s[1])}</b></div><div class="dx-fb"><i style="width:${w(s[1])}%;background:${cols[i]}"></i></div>${conv?`<small>${conv} of the step before</small>`:''}</div>`}).join('')}</div><p class="muted dx-note">Bar lengths use a log scale so every step stays visible.</p>`;
  },260);
  const eff=dGate(['meta'],()=>`<div class="dx-stats">${[[m.ro,'Return on ad spend',dX,false],[m.cpp,'Cost per purchase',dMf,true],[m.ctr,'Click rate',dP,false],[m.cpc,'Cost per click',v=>pvCur(v,dCur()),true],[m.cpm,'Cost per 1,000 views',dMf,true],[m.pv,'Purchase value (Meta)',dMf,false]].filter(x=>x[0]).map(([t,l,f,gd])=>dStat(l,f(t.value),pvPct(t.value,t.prev),gd,'',DC.meta)).join('')}</div>`,200);
  const camps=dGate(['meta'],()=>{const s=dSec(m.mt,'campaigns');if(!s)return '<p class="muted dx-empty">No campaigns.</p>';if(s.error)return `<p class="muted">${esc(s.error)}</p>`;
    const by=D.campBy,rows=(s.rows||[]).slice().sort((a,b)=>(b[by]||0)-(a[by]||0)).slice(0,8),mx=Math.max(1,...rows.map(r=>r.spend));
    const pill=r=>{const v=Number(r.roas)||0,c=v>=3?'good':v>=1.5?'mid':'bad';return `<span class="dx-pill ${c}">${dX(v)}</span>`};
    return `<div class="row dx-tl">${dSeg('campBy',by,[['spend','Spend'],['roas','Return'],['purchases','Purchases']])}</div><div class="dx-tbl"><div class="dx-tr dx-th"><span>Campaign</span><span>Spend</span><span>Buys</span><span>Return</span></div>${rows.map(r=>`<div class="dx-tr"><span class="dx-cn">${r.img?`<img src="${esc(r.img)}" alt="" loading="lazy">`:''}<span title="${esc(r.name)}">${esc(r.name)}</span></span><span class="dx-cs"><b>${dM(r.spend)}</b><i style="width:${r.spend/mx*100}%"></i>${r.change!==null&&r.change!==undefined?chip(r.change,true):''}</span><span>${dN(r.purchases)}</span><span>${pill(r)}</span></div>`).join('')}</div>`},280);
  const plat=dGate(['meta'],()=>{const s=dSec(m.mt,'platform');const cols=[DC.blue,DC.pink,DC.amber,DC.good,'#94A3B8','#C084FC'];return s&&s.rows?dDonut(s.rows.map((r,i)=>({l:r.name,v:r.spend,c:cols[i%cols.length],f:dM(r.spend)+(r.roas?' · '+dX(r.roas):'')})),dMs(m.sp?m.sp.value:0),'spent'):'<p class="muted dx-empty">No breakdown.</p>'},200);
  const dailyEff=dGate(['meta','shop'],()=>{const md=dDaily(m.sp),dd=m.sh.daily&&m.sh.daily.cur;if(!md||!md.dates||!dd)return '<p class="muted dx-empty">Not enough daily data for this period.</p>';
    const mp=new Map(md.dates.map((d,i)=>[d,md.cur[i]])),roas=dd.dates.map((d,i)=>{const s=mp.get(d);return s?dd.revenue[i]/s:null});
    const pr=dDaily(m.ro);const mr=pr&&pr.dates?(()=>{const q=new Map(pr.dates.map((d,i)=>[d,pr.cur[i]]));return dd.dates.map(d=>q.has(d)?q.get(d):null)})():null;
    return dChart('roas',{h:220,labels:dd.dates,short:dDay,tipLabel:i=>dWk(dd.dates[i]),fmtL:v=>(+v).toFixed(1)+'×',series:[{name:'Store revenue ÷ spend',type:'area',color:DC.pink,values:roas,fmt:dX},...(mr?[{name:'Meta-reported return',type:'line',color:DC.meta,values:mr,fmt:dX}]:[])]});
  },240);
  return `<div class="dx-block" id="dx-marketing"><div class="dx-bh"><span class="dx-bi" style="--bc:${DC.meta}">${dIco('meta')}</span><div><h2>Marketing</h2><p>Meta Ads checked against real Shopify sales.</p></div></div><div class="dx-grid">
    ${dCard('From ad to order','Meta funnel, ending in real Shopify orders',funnel,{span:6,dot:DC.meta})}
    ${dCard('Ad efficiency','vs the period before',eff,{span:6})}
    ${dCard('Campaigns','Sorted your way; the colour shows the return',camps,{span:8})}
    ${dCard('Where the money went','Spend by platform',plat,{span:4})}
    ${dCard('Return on ads, day by day','How many pounds of sales each pound of ads brought in',dailyEff,{span:12})}
  </div></div>`;
}
function dProfitHTML(m){
  const D=S.dash;
  const wf=dGate(['odoo'],()=>{
    if(!m.rev)return '<p class="muted dx-empty">No Odoo sales in this period.</p>';
    const R=m.rev.value,C=m.cost?m.cost.value:0,G=m.gross?m.gross.value:R-C,A=m.oads?m.oads.value:0,P=m.pro?m.pro.value:G-A;
    const steps=[['Net revenue',0,R,DC.odoo],['Product cost',G,R,DC.bad],['Gross profit',0,G,'#C084FC'],...(A?[['Ad spend',P,G,DC.meta],['Profit after ads',0,P,DC.good]]:[])];
    const mx=Math.max(R,1);
    return `<div class="dx-wf">${steps.map(([l,lo,hi,c],i)=>{const a=Math.min(lo,hi),b=Math.max(lo,hi);return `<div class="dx-wc"><b class="dx-wv">${i%2&&i<4?'−':''}${dN(Math.abs(hi-lo))}</b><div class="dx-wt"><i style="bottom:${Math.max(0,a)/mx*100}%;height:${Math.max(1,(b-a)/mx*100)}%;background:${c}"></i></div><span>${l}</span></div>`}).join('')}</div>`;
  },260);
  const trend=dGate(['odoo','meta','shop'],()=>{
    const ot=dSec(m.od,'trend'),mt=dSec(m.mt,'trend'),sm=m.sh.months||[];
    const keys=[...new Set([...(ot?ot.rows.map(r=>r.key):[]),...(mt&&mt.rows?mt.rows.map(r=>r.key):[]),...sm.map(r=>r.key)].filter(k=>/^\d{4}-\d{2}$/.test(k)))].sort().slice(-12);
    if(!keys.length)return '<p class="muted dx-empty">No monthly history yet.</p>';
    const by=(rows,f)=>{const mp=new Map((rows||[]).map(r=>[r.key,f(r)]));return keys.map(k=>mp.has(k)?mp.get(k):null)};
    const shR=by(sm,r=>r.revenue),shO=by(sm,r=>r.orders),odR=by(ot&&ot.rows,r=>r.values.revenue),odP=by(ot&&ot.rows,r=>r.values.profit),mS=by(mt&&mt.rows,r=>r.values.spend),mP=by(mt&&mt.rows,r=>r.values.purchases),mR=by(mt&&mt.rows,r=>r.values.roas);
    const lab=keys.map(k=>new Date(k+'-15T12:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'}));
    let series,fl=dN;
    if(D.trendM==='orders')series=[{name:'Shopify orders',type:'bar',color:DC.shop,values:shO,fmt:dN},{name:'Meta purchases',type:'line',color:DC.meta,values:mP,fmt:dN}],fl=dN;
    else if(D.trendM==='eff')series=[{name:'Store revenue ÷ Meta spend',type:'area',color:DC.pink,values:keys.map((_,i)=>shR[i]&&mS[i]?shR[i]/mS[i]:null),fmt:dX},{name:'Meta-reported return',type:'line',color:DC.meta,values:mR,fmt:dX},{name:'Odoo margin',type:'line',color:DC.odoo,values:keys.map((_,i)=>odR[i]?odP[i]/odR[i]*100:null),axis:'r',fmt:dP}],fl=v=>(+v).toFixed(1)+'×';
    else series=[{name:'Shopify revenue',type:'bar',color:DC.shop,values:shR,fmt:dMf},{name:'Odoo net revenue',type:'bar',color:DC.odoo,values:odR,fmt:dMf,dim:1},{name:'Odoo profit',type:'line',color:DC.good,values:odP,fmt:dMf},{name:'Meta ad spend',type:'line',color:DC.meta,values:mS,fmt:dMf}];
    return dChart('months',{h:300,labels:lab,series,fmtL:fl,fmtR:v=>Math.round(v)+'%',title:'Last 12 months'});
  },320);
  const costT=dGate(['odoo'],()=>{const s=dSec(m.od,'cost');const rows=(s&&s.rows||[]).filter(r=>r.margin!==null&&r.margin!==undefined).slice(0,8);
    if(!rows.length)return '<p class="muted dx-empty">No product costs for this period. Set a Cost on products in Odoo to see margins.</p>';
    return `<div class="dx-tbl m"><div class="dx-tr dx-th"><span>Product</span><span>Revenue</span><span>Profit</span><span>Margin</span></div>${rows.map(r=>{const c=r.margin>=50?DC.good:r.margin>=25?DC.amber:DC.bad;return `<div class="dx-tr"><span class="dx-cn"><span title="${esc(r.name)}">${esc(r.name)}</span></span><span>${dM(r.net_sales)}</span><span>${dM(r.profit)}</span><span class="dx-mg"><i style="width:${Math.max(2,Math.min(100,r.margin))}%;background:${c}"></i><b>${Math.round(r.margin)}%</b></span></div>`}).join('')}</div>`},260);
  const orders=dGate(['sales'],()=>{const t=l=>dT(m.sa,l);return `<div class="dx-stats">${[['Confirmed orders',dN,false],['Order value',dMf,false],['Invoiced',dMf,false],['Open quotations',dN,false],['Waiting to be paid',dMf,true]].map(([l,f,gd])=>{const x=t(l);return x?dStat(l,f(x.value),x.prev!==undefined?pvPct(x.value,x.prev):null,gd,x.sub?esc(x.sub):'',DC.odoo):''}).join('')}</div>`},160);
  return `<div class="dx-block" id="dx-profit"><div class="dx-bh"><span class="dx-bi" style="--bc:${DC.odoo}">${dIco('odoo')}</span><div><h2>Profit</h2><p>Odoo's books with Meta's spend taken off.</p></div></div><div class="dx-grid">
    ${dCard('From revenue to profit','Odoo, this period'+(dCur()?' · in '+dCur():''),wf,{span:5,dot:DC.odoo})}
    ${dCard('Last 12 months','All three systems on one timeline',trend,{span:7,tools:dSeg('trendM',D.trendM,[['money','Money'],['orders','Orders'],['eff','Efficiency']])})}
    ${dCard('Margin by product','Odoo cost vs sale price',costT,{span:7})}
    ${dCard('Odoo sales orders','All channels booked in Odoo',orders,{span:5})}
  </div></div>`;
}
function dStockHTML(m){
  const stock=dGate(['stock'],()=>{const sale=m.ssale,val=m.sval;
    const list=(t,c)=>{const rows=(t&&t.breakdown&&t.breakdown.rows)||[];return rows.length?`<ul class="dx-ol">${rows.slice(0,6).map(r=>`<li><span title="${esc(r.name)}">${esc(r.name)}</span><b style="color:${c}">${dN(r.units)} left</b></li>`).join('')}${rows.length>6?`<li class="muted">+${rows.length-6} more</li>`:''}</ul>`:'<p class="muted dx-empty">None 🎉</p>'};
    return `<div class="dx-stats">${val?dStat('Stock value at cost',dMf(val.value),null,false,val.sub?esc(val.sub):'',DC.odoo):''}${sale?dStat('Value at sale price',dMf(sale.value),null,false,sale.sub?esc(sale.sub):'',DC.good):''}${m.sunits?dStat('Units sold',dN(m.sunits.value),pvPct(m.sunits.value,m.sunits.prev),false,'',DC.odoo):''}</div>
      <div class="dx-two"><div><h4 class="dx-h4" style="color:${DC.bad}">Out of stock · ${m.oos?m.oos.value:0}</h4>${list(m.oos,DC.bad)}</div><div><h4 class="dx-h4" style="color:${DC.amber}">Running low · ${m.low?m.low.value:0}</h4>${list(m.low,DC.amber)}</div></div>`},260);
  const sold=dGate(['stock'],()=>{const s=dSec(m.st,'sold');return dBars(((s&&s.rows)||[]).slice(0,8).map(r=>({l:r.name,v:r.value,img:r.img,s:dN(r.units)+' units'})),{color:DC.odoo,rank:1})},260);
  const cash=dGate(['cash'],()=>{const ag=dSec(m.ca,'aging'),ov=dSec(m.ca,'overdue');
    const cols=[DC.good,DC.amber,'#FB923C',DC.bad,'#DC2626'];
    const ovRows=(ov&&ov.rows||[]).slice(0,5),mcol=ov&&ov.columns?(ov.columns.find(c=>/money/.test(c.fmt))||{}).key:null,scol=ov&&ov.columns?(ov.columns.filter(c=>c.fmt==='str')[1]||{}).key:null;
    return `<div class="dx-stats">${[m.inv&&dStat('Invoiced to customers',dMf(m.inv.value),pvPct(m.inv.value,m.inv.prev),false,'',DC.odoo),m.paid&&dStat('Payments received',dMf(m.paid.value),null,false,'',DC.good),m.owe&&dStat('Customers owe you',dMf(m.owe.value),null,true,m.owe.sub?esc(m.owe.sub):'',DC.amber)].filter(Boolean).join('')}</div>
      ${ag&&ag.rows?`<h4 class="dx-h4">Who owes you, by how late</h4>${dBars(ag.rows.map((r,i)=>({l:r.name,v:r.value,c:cols[Math.min(i,cols.length-1)],s:dN(r.count)+' invoices'})))}`:''}
      ${ovRows.length&&mcol?`<h4 class="dx-h4">Chase first</h4><ul class="dx-ol">${ovRows.map(r=>`<li><span title="${esc(r.name)}">${esc(r.name)}${scol&&r[scol]?` <small class="muted">${esc(r[scol])}</small>`:''}</span><b style="color:${DC.bad}">${dMf(r[mcol])}</b></li>`).join('')}</ul>`:''}`},260);
  return `<div class="dx-block" id="dx-stock"><div class="dx-bh"><span class="dx-bi" style="--bc:${DC.good}">${dIco('box')}</span><div><h2>Stock & cash</h2><p>What is on the shelf and who still has to pay.</p></div></div><div class="dx-grid">
    ${dCard('Finished goods','Odoo stock right now',stock,{span:5,dot:DC.odoo})}
    ${dCard('Best sellers in Odoo','All channels, this period',sold,{span:3})}
    ${dCard('Money owed to you','Odoo invoices',cash,{span:4})}
  </div></div>`;
}
function dashHTML(){
  const D=S.dash,m=dModel();
  const f=D.focus,show=k=>f==='all'||f===k;
  const loaded=Object.keys(DNAME).filter(dReady).length,total=Object.keys(DNAME).length;
  const status=D.busy||loaded<total?`<span class="dx-live"><i class="pv-spin"></i>Loading ${loaded} of ${total} sources…</span>`:`<span class="dx-live ok"><i></i>All ${total} sources up to date · ${pvAgo(D.at)}</span>`;
  return `${dashTabs()}<div class="dx-head"><div><span class="dx-eye">Shopify · Odoo · Meta Ads</span><h1>Dashboards</h1>${status}</div><div class="row"><button class="btn sm ghost" data-act="dash-csv">⤓ Export CSV</button><button class="btn sm ghost" data-act="dash-print">⎙ Print</button><button class="btn sm" data-act="dash-refresh">${D.busy?'Refreshing…':'↻ Refresh'}</button></div></div>
  <div class="dx-filters">${dateBar(m.sh||m.od||m.mt)}<div class="dx-focus" role="tablist" aria-label="Show">${[['all','Everything'],['sales','Sales'],['marketing','Marketing'],['profit','Profit'],['stock','Stock & cash']].map(([k,l])=>`<button class="${f===k?'on':''}" data-act="dx-set" data-k="focus" data-v="${k}" aria-pressed="${f===k}">${l}</button>`).join('')}</div></div>
  ${dHero(m)}
  ${dInsightsHTML(m)}
  ${show('sales')?dSalesHTML(m):''}
  ${show('marketing')?dMarketingHTML(m):''}
  ${show('profit')?dProfitHTML(m):''}
  ${show('stock')?dStockHTML(m):''}`;
}
function dashCSV(){
  const m=dModel(),rows=[['Source','Metric','This period','Previous period']],q=v=>'"'+String(v===null||v===undefined?'':v).replace(/"/g,'""')+'"';
  const per=(m.sh&&m.sh.period&&m.sh.period.label)||'';
  if(m.ss){const s=m.ss,p=s.previous||{};[['Revenue',s.revenue,p.revenue],['Orders',s.orders,p.orders],['Average order',Math.round(s.aov),Math.round(p.aov||0)],['Items sold',s.units,p.units],['Refunds',s.refunds,p.refunds]].forEach(r=>rows.push(['Shopify',...r]))}
  [['Meta Ads',m.mt],['Odoo profit',m.od],['Odoo stock',m.st],['Odoo sales',m.sa],['Odoo invoices',m.ca]].forEach(([n,d])=>{const s=dSec(d,'kpi');(s&&s.tiles||[]).forEach(t=>rows.push([n,t.label,typeof t.value==='number'?Math.round(t.value*100)/100:t.value,t.prev!==undefined?Math.round(t.prev*100)/100:'']))});
  const dd=m.sh&&m.sh.daily&&m.sh.daily.cur;if(dd){rows.push([]);rows.push(['Date','Shopify revenue','Shopify orders','Meta spend']);const md=dDaily(m.sp),mp=md&&md.dates?new Map(md.dates.map((d,i)=>[d,md.cur[i]])):new Map();dd.dates.forEach((d,i)=>rows.push([d,Math.round(dd.revenue[i]),dd.orders[i],mp.has(d)?Math.round(mp.get(d)*100)/100:'']))}
  const blob=new Blob(['﻿'+rows.map(r=>r.map(q).join(',')).join('\n')],{type:'text/csv'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='bless-dashboards-'+(S.per.from||'')+'_'+(S.per.to||'')+'.csv';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500);
}

/* ---------- Shopify dashboard ---------- */
async function loadShop(){
  if(S.an.tab!=='overview')return loadAn();
  const sh=S.shop;sh.loading=true;sh.err='';renderShop();
  try{sh.data=await api('GET','/api/shopify?'+perQuery())}
  catch(e){sh.err=e.message}
  sh.loading=false;renderShop();
}
async function runSync(){
  const sh=S.shop;if(sh.syncing)return;sh.syncing=true;sh.syncMsg='Starting…';sh.err='';renderShop();
  try{
    for(let i=0;i<300;i++){const j=await api('POST','/api/shopify-sync');sh.syncMsg=j.message||'';renderShop();if(j.done)break}
    sh.syncing=false;await loadShop();toast('Shopify data synced');
  }catch(e){sh.err=e.message;sh.syncing=false;renderShop()}
}
const fmtNum=n=>Math.round(n).toLocaleString();
function money(n){const c=(S.route==='meta'&&S.meta.data&&S.meta.data.currency)||(S.route==='odoo'&&S.od.data&&S.od.data.currency)||(S.shop.data&&S.shop.data.currency)||(S.an&&S.an.data&&S.an.data.currency);try{return new Intl.NumberFormat(undefined,c?{style:'currency',currency:c,maximumFractionDigits:0}:{maximumFractionDigits:0}).format(n)}catch(e){return fmtNum(n)}}
function money2(n){const c=(S.route==='meta'&&S.meta.data&&S.meta.data.currency)||(S.shop.data&&S.shop.data.currency);try{return new Intl.NumberFormat(undefined,c?{style:'currency',currency:c,minimumFractionDigits:2,maximumFractionDigits:2}:{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)}catch(e){return n.toFixed(2)}}
function shortNum(n){if(n<0)return '−'+shortNum(-n);return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e4?Math.round(n/1e3)+'k':n>=1e3?(n/1e3).toFixed(1)+'k':String(Math.round(n))}
function delta(v){if(v===null||v===undefined)return '';const up=v>=0;return `<span class="delta ${up?'up':'down'}">${up?'▲':'▼'} ${Math.abs(v)}% vs ${esc(cmpText())}</span>`}
function ageText(h){return h<48?h+' h':Math.round(h/24)+' days'}
function rankList(list,valFn,sub){
  if(!list.length)return '<p class="muted">Nothing here yet.</p>';
  const max=Math.max(1,...list.map(valFn));
  return `<div class="ranks">${list.map((x,i)=>`<div class="rrow"><span class="rn mono">${i+1}</span><span class="rt" title="${esc(x.title||x.name)}">${esc(x.title||x.name)}</span><span class="rbar"><i style="width:${Math.max(2,valFn(x)/max*100)}%"></i></span><span class="rv mono">${sub(x)}</span></div>`).join('')}</div>`;
}
function monthChart(ms,metric,sel){
  const f=metric==='revenue'?money:fmtNum;const max=Math.max(1,...ms.map(m=>m[metric]));
  return `<div class="mchart">${ms.map(m=>`<button class="mcol${m.key===sel?' on':''}${m.fromReports?' rep':''}" data-act="shop-month" data-m="${m.key}" title="${esc(m.label)}: ${esc(f(m[metric]))}"><span class="mval mono">${shortNum(m[metric])}</span><span class="mbar"><i style="height:${Math.max(2,m[metric]/max*100)}%"></i></span><span class="mlab">${esc(m.label.slice(0,3)+" '"+m.label.slice(-2))}</span></button>`).join('')}</div>`;
}
/* ---------- Team evaluation (monthly KPIs and ranking) ---------- */
S.ev={month:'',data:null,loading:false,err:'',open:new Set()};
async function loadEval(month,quiet){
  const ev=S.ev;if(month!==undefined)ev.month=month;if(!quiet){ev.loading=true;ev.err='';renderEval(true)}
  try{ev.data=await api('GET','/api/evaluation'+(ev.month?'?month='+encodeURIComponent(ev.month):''));ev.month=ev.data.month}
  catch(e){ev.err=e.message}
  ev.loading=false;renderEval(true);
}
async function evPost(body,msg){
  try{await api('POST','/api/evaluation',body);if(msg)toast(msg);await Promise.all([sync(),S.route==='eval'?loadEval(undefined,true):null])}
  catch(e){toast(e.message||'Could not save');if(S.route==='eval')renderEval(true)}
}
const scCls=v=>v===null||v===undefined?'':v>=85?'hi':v>=60?'mid':'lo';
const scPill=v=>v===null||v===undefined?'<span class="muted">–</span>':`<span class="sc ${scCls(v)}">${Math.round(v)}%</span>`;
function dur(h){if(h===null||h===undefined)return '–';if(h<1)return Math.max(1,Math.round(h*60))+' min';if(h<48)return (Math.round(h*10)/10)+' h';return (Math.round(h/24*10)/10)+' days'}
function moveChip(r){
  if(r.rank===null)return '';
  if(r.prevRank===null||r.prevRank===undefined)return '<span class="mv new">new</span>';
  const d=r.prevRank-r.rank;return d>0?`<span class="mv up">▲ ${d}</span>`:d<0?`<span class="mv down">▼ ${-d}</span>`:'<span class="mv same">–</span>';
}
const scCol=v=>v===null||v===undefined?'var(--line)':v>=85?'#3E9B5E':v>=60?'#F28D3A':'#C9453B';
function gauge(v,label,sub,size){
  size=size||64;const R=size/2-6,C=2*Math.PI*R,has=v!==null&&v!==undefined,len=has?Math.max(0,Math.min(100,v))/100*C:0;
  return `<div class="gauge" style="--gs:${size}px"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size/2}" cy="${size/2}" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="7"/>${has?`<circle cx="${size/2}" cy="${size/2}" r="${R}" fill="none" stroke="${scCol(v)}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${len} ${C}" transform="rotate(-90 ${size/2} ${size/2})"/>`:''}<text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" class="gv">${has?Math.round(v)+'%':'–'}</text></svg><span class="gl">${label}</span>${sub?`<small class="muted">${sub}</small>`:''}</div>`;
}
const initials=n=>String(n).trim().slice(0,2).toUpperCase();
function renderEval(force){
  if(S.screen!=='app'||S.route!=='eval')return;const L=$('#live');if(!L)return;
  const ae=document.activeElement;if(!force&&ae&&L.contains(ae)&&/INPUT|TEXTAREA|SELECT/.test(ae.tagName))return;
  const ev=S.ev,d=ev.data;
  if(!d){L.innerHTML=ev.err?`<div class="empty"><b>Could not load the evaluation</b><span>${esc(ev.err)}</span><button class="btn" data-act="ev-reload">Try again</button></div>`:empty('Loading…','Calculating this month.');return}
  const st=d.settings,w=st.weights,rows=d.rows,wsum=w.speed+w.accuracy+w.behaviour;
  const monthOpts=d.months.slice().reverse().map(m=>`<option value="${m.key}" ${m.key===d.month?'selected':''}>${esc(m.label)}</option>`).join('');
  const scored=rows.filter(r=>r.final!==null);
  const avgFinal=scored.length?scored.reduce((a,r)=>a+r.final,0)/scored.length:null;
  const best=scored.length?scored.reduce((a,r)=>r.final>a.final?r:a,scored[0]):null;
  const totalSlots=rows.reduce((a,r)=>a+r.tasks+r.items.reduce((x,i)=>x+i.responses.length,0)+1,0);
  const missing=d.unspeed+d.unrated+rows.filter(r=>r.behaviour===null).length;
  const donePct=totalSlots?Math.round((1-missing/totalSlots)*100):0;
  const hero=`<section class="ehero"><div class="ehero-top"><div><span class="eyebrow">Team evaluation</span><div class="hero-n sm">${esc(d.monthLabel)}</div>
      <p class="hero-sub">${rows.length?`${rows.length} team member${rows.length===1?'':'s'} · speed ${w.speed}% · accuracy ${w.accuracy}% · behaviour ${w.behaviour}%`:'No team members yet.'}</p></div>
      <div class="hero-actions"><select class="select" id="ev-month" aria-label="Month">${monthOpts}</select><button class="btn light" data-act="ev-csv">Download CSV</button></div></div>
    <div class="estats"><div class="mini"><span class="eyebrow">Team average</span><b>${avgFinal===null?'–':Math.round(avgFinal)+'%'}</b></div>
      <div class="mini"><span class="eyebrow">Top performer</span><b style="font-size:1.05rem">${best?esc(best.username)+' · '+Math.round(best.final)+'%':'–'}</b></div>
      <div class="mini wide"><span class="eyebrow">Ratings entered</span><b>${donePct}%</b><span class="eprog"><i style="width:${donePct}%"></i></span><small>${missing?missing+' still to enter':'everything is filled in'}</small></div></div></section>`;
  const medals=['#E0A526','#9AA3AD','#B9723A'];
  const top=rows.filter(r=>r.rank!==null&&r.rank<=3);
  const order=top.length>=3?[top[1],top[0],top[2]]:top;
  const podium=top.length?`<div class="podium">${order.map(r=>`<div class="pcard p${r.rank}">${r.rank===1?'<span class="crown" aria-hidden="true">♛</span>':''}<span class="avatar" style="--ac:${medals[r.rank-1]}">${esc(initials(r.username))}</span><span class="medal" style="background:${medals[r.rank-1]}">${r.rank}</span><b class="pn">${esc(r.username)}</b>${roleChip(r.role)}<div class="pf">${Math.round(r.final)}<small>%</small></div>${r.complete?'':'<span class="muted" style="font-size:.72rem">partial score</span>'}</div>`).join('')}</div>`:'';
  const rules=`<details class="panel rules"><summary><b>Scoring weights</b> <span class="muted">Speed ${w.speed}% · Accuracy ${w.accuracy}% · Behaviour ${w.behaviour}%</span></summary>
    <form id="ev-settings" class="rulegrid"><label>Speed weight (%)<input class="input" type="number" min="0" max="100" name="speed" value="${w.speed}"></label><label>Accuracy weight (%)<input class="input" type="number" min="0" max="100" name="accuracy" value="${w.accuracy}"></label><label>Behaviour weight (%)<input class="input" type="number" min="0" max="100" name="behaviour" value="${w.behaviour}"></label>
      <div class="rulenote"><p class="muted">You enter every percentage yourself. Speed: one percentage per instruction. Accuracy: one per response. Behaviour: one per person per month, from HR. A person's speed and accuracy are the averages of what you entered, and the final score is the weighted average of the parts that exist. The weights total ${wsum}%.</p><button class="btn primary" type="submit">Save weights</button></div></form></details>`;
  const cards=rows.map(r=>{
    const open=ev.open.has(r.userId);
    const tasks=open?(r.items.length?`<div class="tasks">${r.items.map(x=>`<div class="task">
      <div class="task-head"><button class="btn ghost sm" style="padding:0;font-weight:700" data-act="go" data-route="ins" data-param="${x.id}">${esc(x.title)}</button>
        <span class="muted mono">Sent ${fmtDate(x.createdAt)} · ${x.respondedAt?'responded '+fmtDate(x.respondedAt)+' · took '+dur(x.hours):'no response yet'}</span></div>
      <div class="rline"><span class="rlab">Speed</span><input class="input ev-speed" type="number" min="0" max="100" placeholder="–" data-ins="${x.id}" data-user="${r.userId}" value="${x.speed===null?'':x.speed}" aria-label="Speed percentage"><span class="muted">%</span><button class="btn sm primary" data-act="ev-save-speed">Save</button></div>
      ${x.responses.length?x.responses.map((s,k)=>`<div class="rline"><span class="rlab">Accuracy${x.responses.length>1?' #'+(k+1):''}</span><input class="input ev-rate" type="number" min="0" max="100" placeholder="–" data-id="${s.id}" value="${s.rating===null?'':s.rating}" aria-label="Accuracy percentage"><span class="muted">%</span><button class="btn sm primary" data-act="ev-save-rate">Save</button></div>`).join(''):'<div class="rline"><span class="rlab">Accuracy</span><span class="muted">Nothing to rate: no response sent.</span></div>'}</div>`).join('')}</div>`:'<p class="muted">No instructions were sent to this person this month.</p>'):'';
    return `<article class="mcard${r.rank===1?' first':''}">
      <div class="mc-top"><div class="mc-id"><span class="rk">${r.rank===null?'–':r.rank}</span><span class="avatar sm" style="--ac:${r.rank&&r.rank<=3?medals[r.rank-1]:'var(--accent)'}">${esc(initials(r.username))}</span>
          <div style="min-width:0"><b class="mc-name">${esc(r.username)}</b><div class="row" style="gap:6px">${roleChip(r.role)}${r.complete?'':'<span class="pill new" title="Some parts are not scored yet">Partial</span>'}</div></div></div>
        <div class="mc-final">${gauge(r.final,'Final','',92)}<div class="mc-move">${moveChip(r)}</div></div></div>
      <div class="gauges">${gauge(r.speed,'Speed',r.unspeed?r.unspeed+' to enter':r.tasks+' task'+(r.tasks===1?'':'s'))}${gauge(r.accuracy,'Accuracy',r.unrated?r.unrated+' to enter':'')}${gauge(r.behaviour,'Behaviour','HR · monthly')}</div>
      <div class="behrow"><span class="rlab">Behaviour</span><input class="input ev-beh" type="number" min="0" max="100" placeholder="–" data-user="${r.userId}" value="${r.behaviour===null?'':r.behaviour}" aria-label="Behaviour score for ${esc(r.username)}"><span class="muted">%</span><input class="input ev-note" type="text" maxlength="500" placeholder="HR note (optional)" value="${esc(r.behaviourNote||'')}" aria-label="HR note for ${esc(r.username)}"><button class="btn sm primary" data-act="ev-save-beh">Save</button></div>
      <button class="btn sm tasksbtn" data-act="ev-open" data-id="${r.userId}" aria-expanded="${open}">${open?'Hide tasks':'Tasks · '+r.answered+'/'+r.tasks+' answered'}</button>${tasks}</article>`;
  }).join('');
  L.innerHTML=`${hero}${d.unrated||d.unspeed?`<div class="panel" style="border-color:var(--warn);padding:12px 16px"><b style="color:var(--warn)">Still to enter: ${d.unspeed} speed and ${d.unrated} accuracy percentage${d.unspeed+d.unrated===1?'':'s'}.</b> <span class="muted">Open a person's Tasks and fill them in.</span></div>`:''}
    ${podium}${rules}
    <section style="display:grid;gap:12px"><div><h2>Ranking</h2><p class="muted">Ranked by final score. Behaviour is entered once per month; press Save on each box you change.</p></div>
    ${rows.length?`<div class="mcards">${cards}</div>`:'<p class="muted">Add team members on the Users page to start evaluating.</p>'}</section>`;
}
function evCsv(){
  const d=S.ev.data;if(!d)return;
  const q=v=>'"'+String(v===null||v===undefined?'':v).replace(/"/g,'""')+'"';
  const lines=[['Rank','Member','Role','Tasks','Answered','Speed %','Accuracy %','Behaviour %','Final %','HR note'].map(q).join(',')];
  d.rows.forEach(r=>lines.push([r.rank,r.username,(ROLE[r.role]||{label:r.role}).label,r.tasks,r.answered,r.speed,r.accuracy,r.behaviour,r.final,r.behaviourNote].map(q).join(',')));
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+lines.join('\n')],{type:'text/csv'}));a.download='team-evaluation-'+d.month+'.csv';document.body.appendChild(a);a.click();a.remove();
}

/* ---------- Shopify overview (rich layout) ---------- */
const ICON={
  refund:'<path d="M4 8h9a4 4 0 0 1 0 8H8M4 8l3-3M4 8l3 3"/>',
  cancel:'<circle cx="12" cy="12" r="8"/><path d="m9 9 6 6M15 9l-6 6"/>',
  repeat:'<path d="M17 4l3 3-3 3M20 7H8a4 4 0 0 0-4 4M7 20l-3-3 3-3M4 17h12a4 4 0 0 0 4-4"/>',
  cart:'<path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.8L19 8H6"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
  bag:'<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  box:'<path d="M4 8l8-4 8 4v8l-8 4-8-4V8Z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5"/><path d="M16 5a3 3 0 0 1 0 6M18 14c2 .6 3 2.2 3 5"/>',
  send:'<path d="M21 3 3 10l7 3 3 7 8-17Z"/>',
  clock:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  file:'<path d="M7 3h7l5 5v13H7V3Z"/><path d="M14 3v5h5"/>',
  alert:'<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17.200v.1"/>',
  check:'<circle cx="12" cy="12" r="8.500"/><path d="m8.500 12.300 2.500 2.500 4.500-5"/>',
  eye:'<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12Z"/><circle cx="12" cy="12" r="2.800"/>',
  star:'<path d="m12 3.500 2.600 5.300 5.900.9-4.300 4.100 1 5.800L12 16.900 6.800 19.600l1-5.800-4.300-4.100 5.900-.9L12 3.500Z"/>',
  trend:'<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>',
  moon:'<path d="M21 12.800A9 9 0 1 1 11.200 3a7 7 0 0 0 9.800 9.800z"/>',
  chat:'<path d="M4 5h16v11H9l-5 4V5Z"/>',
  tag:'<path d="M3 12V4h8l10 10-8 8L3 12Z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
};
const ico=(k,c)=>`<span class="kico" style="--kc:${c||'var(--accent)'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg></span>`;
function seg(key,cur,opts){return `<div class="seg" role="group">${opts.map(([v,l])=>`<button type="button" class="${cur===v?'on':''}" data-act="ov-seg" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div>`}
function chip(v,goodDown){if(v===null||v===undefined)return '';const good=goodDown?v<=0:v>=0;return `<span class="dchip ${good?'up':'down'}">${v>=0?'▲':'▼'} ${Math.abs(v)}%</span>`}
function areaSpark(vals,selIdx){
  const W=640,H=140,P=6,max=Math.max(1e-9,...vals),n=vals.length;
  const x=i=>P+(W-2*P)*(n>1?i/(n-1):0.5),y=v=>H-P-(H-2*P-10)*(v/max);
  const pts=vals.map((v,i)=>[x(i),y(v)]);
  let d='M'+pts[0][0]+','+pts[0][1];
  for(let i=1;i<pts.length;i++){const[x0,y0]=pts[i-1],[x1,y1]=pts[i],cx=(x0+x1)/2;d+=` C${cx},${y0} ${cx},${y1} ${x1},${y1}`}
  const sel=pts[selIdx];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".35"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
  <path d="${d} L${pts[n-1][0]},${H} L${pts[0][0]},${H} Z" fill="url(#sg)"/><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linecap="round"/>
  ${sel?`<line x1="${sel[0]}" x2="${sel[0]}" y1="${sel[1]}" y2="${H}" stroke="currentColor" stroke-opacity=".5" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>`:''}</svg>`;
}
function donut(parts,centerTop,centerSub){
  const total=parts.reduce((a,p)=>a+p.v,0)||1,R=52,C=2*Math.PI*R;let off=0;
  const arcs=parts.map(p=>{const len=p.v/total*C,s=`<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.c}" class="dseg"${p.l?` data-tip="${esc(p.l)}: ${fmtNum(p.v)} (${(p.v/total*100).toFixed(1)}%)"`:''} stroke-width="16" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;off+=len;return s}).join('');
  return `<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="${esc(centerTop+' '+centerSub)}"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="16"/>${arcs}<text x="70" y="68" text-anchor="middle" class="dn">${esc(centerTop)}</text><text x="70" y="86" text-anchor="middle" class="ds">${esc(centerSub)}</text></svg>`;
}
function ovBody(d){
  const s=d.summary,a=d.abandoned,c=d.customers,sh=S.shop;
  const idx=d.months.findIndex(m=>m.key===d.month);
  const revs=d.months.map(m=>m.revenue);
  const mini=(l,v,ch,sub)=>`<div class="mini"><span class="eyebrow">${l}</span><b>${v}</b>${ch||''}${sub?`<small>${sub}</small>`:''}</div>`;
  const hero=`<section class="hero">
    <div class="hero-top"><div><span class="eyebrow">Revenue · ${esc(d.monthLabel)}</span><div class="hero-n">${money(s.revenue)}</div>${chip(s.change.revenue)}<span class="hero-vs"> vs last month</span></div>
      <div class="minis">${mini('Orders',fmtNum(s.orders),chip(s.change.orders))}${mini('Units sold',fmtNum(s.units),chip(s.change.units))}${mini('Average order',money(s.aov))}</div></div>
    ${areaSpark(revs,idx)}
    <div class="hero-foot"><span>${esc(d.months[0].label)}</span><span>12 months of revenue</span><span>${esc(d.months[d.months.length-1].label)}</span></div></section>`;
  const kpi=(k,color,l,v,sub)=>`<div class="kcard" style="--kc:${color}">${ico(k,color)}<div><span class="eyebrow">${l}</span><div class="kn">${v}</div><small class="muted">${sub}</small></div></div>`;
  const kpis=`<div class="kgrid">
    ${kpi('refund','#C2410C','Refunded',money(s.refunds),s.refundRate.toFixed(1)+'% of revenue')}
    ${kpi('cancel','#B3261E','Cancelled orders',fmtNum(s.cancelled),s.cancelRate.toFixed(1)+'% of orders')}
    ${kpi('repeat','#7B4FA0','Repeat customers',c.repeatRate.toFixed(0)+'%',fmtNum(c.repeat)+' of '+fmtNum(c.distinct)+' customers')}
    ${kpi('cart','#F28D3A','Left in carts',money(a.openValue),fmtNum(a.openCount)+' open carts')}</div>`;
  const metricName={revenue:'Revenue',orders:'Orders',units:'Units sold'}[sh.metric]||'Revenue';
  const chart=`<section class="panel"><div class="item-top"><div><h2>Last 12 months</h2><p class="muted">${metricName} by month. Click a month to open it.${d.months.some(m=>m.fromReports)?' Lighter bars come from Shopify reports.':''}</p></div>${seg('metric',sh.metric,[['revenue','Revenue'],['orders','Orders'],['units','Units']])}</div>
    ${monthChart(d.months,sh.metric,d.month)}</section>`;
  const best=sh.best==='revenue'?d.bestByRevenue:d.bestByUnits;
  const geo=sh.geo==='cities'?d.cities:d.countries;
  const geoTot=geo.reduce((x,y)=>x+y.revenue,0)||1;
  const lists=`<div class="two">
    <section class="panel"><div class="item-top"><h2>Best sellers</h2>${seg('best',sh.best||'units',[['units','By units'],['revenue','By revenue']])}</div>${rankList(best,x=>sh.best==='revenue'?x.revenue:x.units,x=>sh.best==='revenue'?money(x.revenue):fmtNum(x.units)+' units')}</section>
    <section class="panel"><div class="item-top"><h2>Where orders go</h2>${seg('geo',sh.geo||'countries',[['countries','Countries'],['cities','Cities']])}</div>${rankList(geo,x=>x.revenue,x=>Math.round(x.revenue/geoTot*100)+'% · '+fmtNum(x.orders)+' orders')}</section></div>`;
  const cust=`<section class="panel"><h2>Customers</h2>${c.distinct||c.guest?`<div class="cust">${donut([{v:c.fresh,c:'#F28D3A',l:'First-time customers'},{v:c.repeat,c:'#7B4FA0',l:'Returning customers'}],c.repeatRate.toFixed(0)+'%','returning')}
    <div class="legend"><div><i style="background:#F28D3A"></i><b>${fmtNum(c.fresh)}</b> first-time customers</div><div><i style="background:#7B4FA0"></i><b>${fmtNum(c.repeat)}</b> returning customers</div>${c.guest?`<div class="muted"><i style="background:var(--line)"></i>${fmtNum(c.guest)} orders without a customer record</div>`:''}
    <p class="muted" style="font-size:.82rem;margin:6px 0 0">Returning means the customer has more than one order with you in total.</p></div></div>`:'<p class="muted">No customer data for this month.</p>'}</section>`;
  const cols=['#F8D9BC','#F4B982','#F28D3A','#B4540F'];
  const totC=a.aging.reduce((x,y)=>x+y.count,0)||1;
  const stack=`<div class="stack" role="img" aria-label="Carts by waiting time">${a.aging.map((x,i)=>x.count?`<i style="flex:${x.count};background:${cols[i]}" title="${esc(x.label)}: ${x.count}"></i>`:'').join('')}</div>
    <div class="legend row-legend">${a.aging.map((x,i)=>`<div><i style="background:${cols[i]}"></i>${esc(x.label)} <b>${fmtNum(x.count)}</b> <span class="muted mono">${money(x.value)}</span></div>`).join('')}</div>`;
  const rows=a.oldest.map(x=>{const ph=(x.phone||'').replace(/[^\d]/g,'');return `<tr><td class="mono"><b>${money(x.total)}</b></td><td>${ageText(x.ageHours)}</td><td style="max-width:300px;overflow-wrap:anywhere">${esc(x.items)}</td><td style="overflow-wrap:anywhere">${x.name||x.email||x.phone?`${x.name?`<b>${esc(x.name)}</b><br>`:''}${x.email?`<span class="muted">${esc(x.email)}</span><br>`:''}${x.phone?`<span class="muted mono">${esc(x.phone)}</span>`:''}`:'<span class="muted">No contact saved</span>'}</td><td style="white-space:nowrap">${x.url&&x.linkFresh?`<a class="btn sm" href="${esc(x.url)}" target="_blank" rel="noopener">Open cart</a>`:'<span class="muted" style="font-size:.75rem">Cart link expired</span>'}${ph?` <a class="btn sm" href="https://wa.me/${ph}" target="_blank" rel="noopener">WhatsApp</a>`:''}</td></tr>`}).join('');
  const carts=`<section class="panel carts"><div class="item-top"><div><h2>Carts left behind</h2><p class="muted">Customers who added items and never checked out (last 90 days).</p></div></div>
    <div class="cart-hero"><div><span class="eyebrow">Money sitting in carts</span><div class="hero-n sm">${money(a.openValue)}</div><span class="muted">${fmtNum(a.openCount)} carts waiting</span></div>
      <div class="cart-side"><div><span class="eyebrow">Abandoned in ${esc(d.monthLabel)}</span><b>${fmtNum(a.monthCount)}</b> <span class="muted mono">${money(a.monthValue)}</span></div><div><span class="eyebrow">Abandonment rate</span><b>${a.monthRate.toFixed(0)}%</b> <span class="muted">carts vs orders</span></div></div></div>
    <div style="display:grid;gap:8px"><h3>How long they have been waiting</h3>${stack}</div>
    <div class="two"><div style="display:grid;gap:10px"><h3>Most left in carts</h3>${rankList(a.topProducts,x=>x.qty,x=>fmtNum(x.qty)+' in '+x.carts+' carts')}</div>
    <div class="callout"><b>Recovery tip</b><p>Carts under 10 days old still have a working link. For older ones, message the customer on WhatsApp or email and send the product directly.</p></div></div>
    ${a.oldest.length?`<div style="display:grid;gap:10px"><h3>Biggest carts to recover</h3><div class="tablewrap"><table style="min-width:640px"><thead><tr><th>Value</th><th>Waiting</th><th>Items</th><th>Customer</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`:''}</section>`;
  return hero+kpis+chart+lists+cust+carts;
}
function renderShop(){
  if(S.screen!=='app'||S.route!=='shop')return;const L=$('#live');if(!L)return;
  const sh=S.shop,d=sh.data;
  if(S.an.tab!=='overview'){renderAnalytics(L);return}
  if(!d){L.innerHTML=shopTabs()+(sh.err?`<div class="empty"><b>Could not load Shopify data</b><span>${esc(sh.err)}</span><button class="btn" data-act="shop-reload">Try again</button></div>`:empty('Loading…','Reading your Shopify numbers.'));return}
  if(d.configured===false){
    L.innerHTML=shopTabs()+`<div class="panel"><h2>Connect your Shopify store</h2><p class="muted">Add these in Vercel (Settings, Environment Variables), then redeploy:</p>
      <div class="list">${d.missing.map(m=>`<div class="item"><span class="mono">${esc(m)}</span></div>`).join('')}</div>
      <p class="muted">The README in the project lists the full steps, including the permissions the Shopify app needs.</p></div>`;return}
  const s=d.summary,a=d.abandoned,c=d.customers,sy=d.sync;
  const last=sy.lastSync?fmtDate(Date.parse(sy.lastSync)):'never';
  const stat=(l,v,x)=>`<div class="stat"><div class="eyebrow">${l}</div><div class="n">${v}</div>${x||''}</div>`;
  const small=t=>`<span class="muted mono" style="font-size:.75rem">${t}</span>`;
  L.innerHTML=shopTabs()+dateBar(d)+`
  <div class="row" style="justify-content:space-between;gap:12px">
    <div class="row" style="gap:10px">${sh.loading?'<span class="muted">Loading…</span>':''}</div>
    <div class="row" style="gap:10px"><span class="muted mono" style="font-size:.75rem">${sy.orders} orders stored · last sync ${esc(last)}</span><button class="btn primary" data-act="shop-sync" ${sh.syncing?'disabled':''}>${sh.syncing?'Syncing…':'Sync now'}</button></div>
  </div>
  ${sh.syncing?`<div class="panel" style="padding:12px 16px"><span class="mono">${esc(sh.syncMsg)}</span></div>`:''}
  ${sh.err?`<div class="panel" style="border-color:var(--danger)"><b style="color:var(--danger)">Sync problem</b><p class="body-text">${esc(sh.err)}</p></div>`:''}
  ${sy.note?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Heads up</b><p class="body-text">${esc(sy.note)}</p></div>`:''}
  ${sy.cartsError?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Carts could not be read</b><p class="body-text">${esc(sy.cartsError)}</p></div>`:''}
  ${!sy.orders&&!sh.syncing?`<div class="empty"><b>No data yet</b><span>Press Sync now to pull your orders from Shopify. The first sync can take a few minutes.</span></div>`:''}

  ${d.fromReports?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Older month</b><p class="body-text">Shopify only lets this site download the last 60 days of orders, so this month's totals come from Shopify's sales reports. Best sellers, areas, customers and carts are not available for it. Open the Sales tab for the full report.</p></div>`:''}
  ${d.reportsError?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Older months could not be filled in</b><p class="body-text">${esc(d.reportsError)}</p></div>`:''}
  ${ovBody(d)}
  <p class="muted" style="font-size:.8rem">Months follow ${esc(d.tz)} time. Revenue counts all non-cancelled orders; best-seller revenue is before discounts.</p>`;
}

/* ---------- downloads ---------- */
const dlUrl=u=>u+(u.includes('?')?'&':'?')+'download=1';
function allFiles(){const m=new Map();S.subs.forEach(s=>(s.files||[]).forEach(f=>m.set(f.url,{...f,owner:s.username})));return m}
function pruneSel(){const all=allFiles();[...S.sel].forEach(u=>{if(!all.has(u))S.sel.delete(u)})}
function renderSelBar(){
  let bar=$('#selbar');if(!bar)return;
  pruneSel();
  const n=S.sel.size;
  if(!n||S.screen!=='app'){bar.hidden=true;return}
  bar.hidden=false;
  if(bar.dataset.busy)return;
  bar.innerHTML=`<span class="mono">${n} selected</span><span class="row" style="gap:8px"><button class="btn sm" data-act="sel-page">Select all on page</button><button class="btn sm ghost" data-act="sel-clear">Clear</button><button class="btn sm primary" data-act="dl-zip">Download ${n===1?'file':'as ZIP'}</button></span>`;
}
function syncChecks(){
  document.querySelectorAll('input[data-act="sel-file"]').forEach(c=>{const on=S.sel.has(c.dataset.url);c.checked=on;c.closest('.ftile')?.classList.toggle('on',on)});
  renderSelBar();
}
function saveBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),10000);
}
async function downloadSelected(){
  const bar=$('#selbar');const all=allFiles();const items=[...S.sel].map(u=>all.get(u)).filter(Boolean);
  if(!items.length)return;
  if(items.length===1){const f=items[0];const a=document.createElement('a');a.href=dlUrl(f.url);a.download=f.name;document.body.appendChild(a);a.click();a.remove();return}
  bar.dataset.busy='1';const files={},used=new Set(),failed=[];
  for(let i=0;i<items.length;i++){
    const f=items[i];bar.innerHTML=`<span class="mono">Preparing ${i+1} of ${items.length}…</span>`;
    try{
      const r=await fetch(f.url);if(!r.ok)throw new Error('http '+r.status);
      const data=new Uint8Array(await r.arrayBuffer());
      const base=(isAdmin()?f.owner+'/':'')+f.name;let path=base,n=2;
      while(used.has(path)){const d=base.lastIndexOf('.');path=d>base.lastIndexOf('/')?base.slice(0,d)+' ('+n+')'+base.slice(d):base+' ('+n+')';n++}
      used.add(path);files[path]=[data,{level:0}];
    }catch(e){failed.push(f.name)}
  }
  delete bar.dataset.busy;
  if(!Object.keys(files).length){
    toast('Could not build a ZIP, downloading the files one by one instead.');
    for(const f of items){const a=document.createElement('a');a.href=dlUrl(f.url);a.download=f.name;document.body.appendChild(a);a.click();a.remove();await new Promise(r=>setTimeout(r,500))}
    renderSelBar();return;
  }
  try{
    const zip=zipSync(files);
    saveBlob(new Blob([zip],{type:'application/zip'}),'bless-hub-files-'+new Date().toISOString().slice(0,10)+'.zip');
    toast(failed.length?`ZIP ready. ${failed.length} file(s) could not be added: ${failed.slice(0,3).join(', ')}`:`ZIP ready with ${Object.keys(files).length} files`);
  }catch(e){toast('Could not create the ZIP.')}
  renderSelBar();
}

/* ---------- upload form ---------- */
function uploadForm(kind){
  S.picked[kind]=[];
  return `<form data-form="up-${kind}" style="display:grid;gap:14px">
    <label class="drop" id="drop-${kind}"><input type="file" id="file-${kind}" multiple data-kind="${kind}"><b>Choose files or drop them here</b><span class="muted" style="font-size:.85rem">Images, video (MP4, WebM), PDF, TXT, CSV, MD, JSON · up to 20 MB each</span></label>
    <div class="picked" id="picked-${kind}"></div>
    <div class="field"><label for="note-${kind}">Note <span class="muted" style="font-weight:400">(optional)</span></label><textarea class="textarea" id="note-${kind}" style="min-height:70px" placeholder="Anything the Super Admin should know"></textarea></div>
    <div class="err" id="err-${kind}"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit" id="go-${kind}">${kind==='resp'?'Send response':'Upload'}</button></div></form>`;
}
function syncUploadAvail(){}
function addFiles(kind,files){
  const err=$('#err-'+kind);const bad=[];
  for(const f of files){const ext=(f.name.split('.').pop()||'').toLowerCase();const t=TYPES[ext];
    if(!t){bad.push(`${f.name} (type not supported)`);continue}
    if(f.size>(t==='image/svg+xml'?2:20)*1048576){bad.push(`${f.name} (too large)`);continue}
    S.picked[kind].push(f)}
  err.textContent=bad.length?'Skipped: '+bad.join(', ')+'. For PSD, AI or ZIP files, export to PDF or PNG first.':'';
  renderPicked(kind);
}
function renderPicked(kind){$('#picked-'+kind).innerHTML=S.picked[kind].map((f,i)=>`<div><span>${esc(f.name)} · <span class="muted">${fmtSize(f.size)}</span></span><button type="button" class="btn sm ghost" data-act="unpick" data-kind="${kind}" data-i="${i}">Remove</button></div>`).join('')}

async function submitUpload(kind){
  const err=$('#err-'+kind),btn=$('#go-'+kind),note=$('#note-'+kind).value.trim(),files=S.picked[kind];
  if(!files.length&&!note){err.textContent=kind==='resp'?'Add at least one file or a note.':'Choose at least one file.';return}
  if(kind==='free'&&!files.length){err.textContent='Choose at least one file.';return}
  if(files.length&&!S.assets){err.textContent='You cannot upload files with your current access.';return}
  btn.disabled=true;err.dataset.busy='1';err.textContent='';const done=[],failed=[];
  for(let i=0;i<files.length;i++){const f=files[i];btn.textContent=`Uploading ${i+1} of ${files.length}…`;
    const type=TYPES[(f.name.split('.').pop()||'').toLowerCase()];
    try{const r=await upload(f.name,f,{access:'public',handleUploadUrl:'/api/upload',contentType:type});done.push({url:r.url,name:f.name,type:type,size:f.size})}
    catch(e){failed.push(f.name+(e&&e.message?' ('+String(e.message).slice(0,80)+')':''))}}
  btn.textContent=kind==='resp'?'Send response':'Upload';btn.disabled=false;delete err.dataset.busy;
  if(!done.length&&!note){err.textContent='Upload failed: '+failed.join(', ');return}
  try{await api('POST','/api/submissions',{instructionId:kind==='resp'?S.param:'',note,files:done})}catch(e){err.textContent=e.message||'Could not save. Try again.';return}
  await sync();
  S.picked[kind]=[];renderPicked(kind);$('#note-'+kind).value='';
  if(failed.length)err.textContent='Saved, but these files failed: '+failed.join(', ');
  toast(kind==='resp'?'Response sent':'Uploaded');
}

/* ---------- Shopify analysis tabs ---------- */
const AN_TABS=[['overview','Overview'],['sales','Sales'],['profit','Profit'],['funnel','Funnel'],['products','Products'],['experience','Customer experience'],['retention','Retention'],['delivery','Delivery'],['undelivered','Without delivery']];
S.an={tab:'overview',cache:{},loading:false,err:'',metric:{},saving:false};
function shopTabs(){return `<div class="subtabs" role="tablist">${AN_TABS.map(([k,l])=>`<button role="tab" class="subtab${S.an.tab===k?' on':''}" aria-selected="${S.an.tab===k}" data-act="an-tab" data-tab="${k}">${l}</button>`).join('')}</div>`}
async function loadAn(refresh){
  const an=S.an,sh=S.shop,tab=an.tab;if(tab==='overview')return;
  const key=tab+'|'+perQuery();if(!refresh&&an.cache[key]){an.last=key;renderShop();return}
  an.loading=true;an.err='';renderShop();
  try{
    const d=await api('GET','/api/analytics?tab='+tab+'&'+perQuery()+(refresh?'&refresh=1':''));
    an.cache[key]=d;an.last=key;
  }catch(e){an.err=e.message}
  an.loading=false;renderShop();
}
function fv(v,f){
  if(v===null||v===undefined||(typeof v==='number'&&!isFinite(v)))return '–';
  switch(f){
    case 'money':return money(v);case 'money2':return money2(v);case 'x':return v.toFixed(2)+'×';case 'int':return fmtNum(v);
    case 'pct':return v.toFixed(1)+'%';case 'num1':return v.toFixed(1);case 'num2':return v.toFixed(2);
    case 'ms':return v>=1000?(v/1000).toFixed(1)+' s':Math.round(v)+' ms';
    case 'days':return v>=100?fmtNum(v):v.toFixed(v%1?1:0)+' d';
    case 'hours':return v>=48?(v/24).toFixed(1)+' days':v.toFixed(1)+' h';
    case 'growth':return `<span class="delta ${v>=0?'up':'down'}">${v>=0?'▲':'▼'} ${Math.abs(v)}%</span>`;
    case 'link':return v&&v.href?`<a href="${esc(v.href)}" target="_blank" rel="noopener">${esc(v.text)}</a>`:esc(String(v||''));
    default:return esc(String(v));
  }
}
const noHtml=new Set(['growth','link']);
const ST_CLS={paid:'ok','in payment':'info',partial:'warn','partly paid':'warn','not paid':'bad',reversed:'mute',ok:'ok','running low':'warn','out of stock':'bad',delivered:'ok','in transit':'info',shipped:'info','out for delivery':'info','delivery attempted':'warn','partly shipped':'warn','on hold':'warn',scheduled:'warn',failed:'bad','not shipped':'bad',cancelled:'mute'};
const stTag=v=>{const s=String(v),k=ST_CLS[s.toLowerCase()];return k?`<span class="st st-${k}">${esc(s)}</span>`:esc(s)};
const cellText=(v,f)=>noHtml.has(f)?fv(v,f):f==='str'&&ST_CLS[String(v).toLowerCase()]?stTag(v):esc(fv(v,f)).replace(/&amp;/g,'&');
const KPAL=['#F28D3A','#7B4FA0','#0F766E','#C2410C','#1D4ED8','#A21CAF'];
function iconFor(label){
  const l=String(label).toLowerCase();
  if(/return|refund/.test(l))return 'refund';if(/cancel/.test(l))return 'cancel';
  if(/cart|checkout|abandon/.test(l))return 'cart';if(/customer|visitor|buyer|session/.test(l))return 'users';
  if(/unit|item|stock|product|search|page view/.test(l))return 'box';if(/order|purchase|payment|deliver|fulfill|shipped/.test(l))return 'bag';
  if(/day|hour|time|speed|response|between/.test(l))return 'clock';if(/rate|repeat|conversion|bounce/.test(l))return 'repeat';
  return 'tag';
}
/* Change pill: arrow + percent, green when it moved the good way, red when the bad way, grey when flat. */
function dp(g,goodDown){if(g===null||g===undefined||!isFinite(g))return '';if(Math.abs(g)<0.05)return '<span class="dp flat">– 0%</span>';const good=goodDown?g<0:g>0;return `<span class="dp ${good?'good':'bad'}"><i aria-hidden="true">${g>0?'▲':'▼'}</i>${Math.abs(g).toLocaleString(undefined,{maximumFractionDigits:1})}%<span class="vh">${good?' better':' worse'}</span></span>`}
function pctChange(v,p){return p?Math.round((v-p)/Math.abs(p)*1000)/10:null}
/* Small line chart for a card: this period solid, comparison dashed, end dot on the latest day. */
function sparkline(dl){
  const W=200,H=38,a=dl.cur,b=dl.prev||[],all=[...a,...b].filter(v=>typeof v==='number'&&isFinite(v)),mx=Math.max(1e-9,...all),mn=Math.min(0,...all);
  const X=(k,n)=>1+(n>1?k/(n-1):0.5)*(W-8),Y=v=>3+(1-(v-mn)/(mx-mn||1))*(H-8);
  const path=arr=>arr.map((v,k)=>(k?'L':'M')+X(k,arr.length).toFixed(1)+' '+Y(v).toFixed(1)).join('');
  const lx=X(a.length-1,a.length),ly=Y(a[a.length-1]);
  return `<svg class="spk" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="spk-p" d="${path(b)}"/><path class="spk-c" d="${path(a)}"/></svg>`;
}
/* Without a daily series: two bars, this period against the comparison, drawn on one shared scale. */
function pairBars(t){
  const v=Math.abs(t.value),p=Math.abs(t.prev),mx=Math.max(v,p,1e-9);
  return `<div class="pbars" aria-hidden="true"><i class="pb-c" style="width:${Math.max(2,v/mx*100)}%"></i><i class="pb-p" style="width:${Math.max(2,p/mx*100)}%"></i></div>`;
}
function tileCard(t){
  const g=t.prev!==undefined?pctChange(t.value,t.prev):null,hasD=t.daily&&t.daily.cur&&t.daily.cur.length>1;
  const vs=t.prev!==undefined?`<div class="mx-s">${g===null?'No earlier figure':'vs '+esc(cmpText())+' · was <b>'+esc(fv(t.prev,t.fmt))+'</b>'}</div>`:'';
  const viz=hasD?sparkline(t.daily):(t.prev!==undefined&&(t.value||t.prev)?pairBars(t):'');
  return `<div class="mx" data-detail tabindex="0" role="button" aria-expanded="false"><div class="mx-top"><span class="mx-l">${esc(t.label)}</span>${dp(g,t.goodDown)}</div><div class="mx-v${fv(t.value,t.fmt).length>13?' xl':fv(t.value,t.fmt).length>10?' lg':''}">${esc(fv(t.value,t.fmt))}</div>${vs}${viz}${t.sub?`<div class="mx-n">${esc(t.sub)}</div>`:''}<div class="rkdetail">${tileDetail(t)}</div></div>`;
}
/* The few things worth reading first: what improved most, what slipped most, the strongest day. */
function highlights(secs){
  const tiles=[];(secs||[]).forEach(x=>{if(!x.error&&(x.kind==='kpi'||x.kind==='funnel')&&x.tiles)x.tiles.forEach(t=>tiles.push(t))});
  const moved=tiles.filter(t=>t.prev!==undefined&&t.prev&&isFinite(t.value)).map(t=>{const g=pctChange(t.value,t.prev);return {t,g,score:t.goodDown?-g:g}});
  if(moved.length<2)return '';
  const best=moved.reduce((a,b)=>b.score>a.score?b:a),worst=moved.reduce((a,b)=>b.score<a.score?b:a);
  const card=(cls,title,m)=>`<div class="hl ${cls}"><span class="hl-t">${title}</span><b>${esc(m.t.label)}</b><span class="hl-d">${dp(m.g,m.t.goodDown)} <span class="muted">${esc(fv(m.t.prev,m.t.fmt))} → ${esc(fv(m.t.value,m.t.fmt))}</span></span></div>`;
  let h='';
  if(best.score>0)h+=card('good','Biggest improvement',best);
  if(worst.score<0&&worst!==best)h+=card('bad','Biggest drop',worst);
  const dt=tiles.find(t=>t.daily&&t.daily.cur&&t.daily.cur.length>2&&(t.fmt==='money'||t.fmt==='int'));
  if(dt){const a=dt.daily.cur,k=a.indexOf(Math.max(...a));if(a[k]>0){const nice=new Date(dt.daily.dates[k]+'T12:00:00Z').toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});h+=`<div class="hl"><span class="hl-t">Strongest day</span><b>${esc(nice)}</b><span class="hl-d"><span class="muted">${esc(dt.label)}: ${esc(fv(a[k],dt.fmt))}</span></span></div>`}}
  return h?`<section class="hls" aria-label="Highlights">${h}</section>`:'';
}
function anKpi(sec){return `<div class="kgrid">${sec.tiles.map(tileCard).join('')}</div>`}
function anFunnel(sec){
  const top=Math.max(1,sec.steps[0].value),cols=['#F8C79A','#F6A25B','#F28D3A','#B4540F'];
  const steps=`<div class="funl">${sec.steps.map((s,i)=>{const prev=i?sec.steps[i-1].value:null,w=Math.max(22,s.value/top*100);
    return `<div class="fstep">${prev!==null?`<div class="fdrop"><span>▼ ${prev?(100-s.value/prev*100).toFixed(0):0}% left here</span></div>`:''}<div class="fbarc" style="width:${w}%;background:${cols[i%4]};color:${i>=2?'#fff':'#2B1D35'}"><b>${esc(s.label)}</b><span class="mono">${fmtNum(s.value)}<small> · ${(s.value/top*100).toFixed(s.value/top<0.1?1:0)}%</small></span></div></div>`}).join('')}</div>`;
  return steps+anKpi({tiles:sec.tiles});
}
function anTrend(sec){
  const od=S.route==='odoo',mt=S.route==='meta',id=sec.id+'|'+(od?'od-'+S.od.tab:mt?'meta-'+S.meta.tab:S.an.tab),m=S.an.metric[id]||sec.metrics[0].key,def=sec.metrics.find(x=>x.key===m)||sec.metrics[0];
  const max=Math.max(1e-9,...sec.rows.map(r=>r.values[def.key]));
  const sel=perMonthSel();
  return `<div class="item-top" style="margin-bottom:6px"><span></span><select class="select" data-act="an-metric" data-id="${esc(id)}" style="width:auto" aria-label="Metric">${sec.metrics.map(x=>`<option value="${x.key}" ${x.key===def.key?'selected':''}>${esc(x.label)}</option>`).join('')}</select></div>
  <div class="mchart">${sec.rows.map(r=>{const v=r.values[def.key];return `<button class="mcol${r.key===sel?' on':''}" data-act="${od?'od-month':mt?'meta-month':'shop-month'}" data-m="${r.key}" title="${esc(r.label)}: ${esc(fv(v,def.fmt))}"><span class="mval mono">${def.fmt==='pct'?v.toFixed(1)+'%':def.fmt==='x'?v.toFixed(1)+'×':def.fmt==='money2'?v.toFixed(v<10?2:0):shortNum(v)}</span><span class="mbar"><i style="height:${Math.max(2,v/max*100)}%"></i></span><span class="mlab">${esc(r.label.slice(0,3)+" '"+r.label.slice(-2))}</span></button>`}).join('')}</div>`;
}
function rateClass(v,r){return !r?'':v<=r[0]?'good':v<=r[1]?'mid':'bad'}
function rkChip(c,v){const cls=c.rate&&typeof v==='number'?' r-'+rateClass(v,c.rate):'';return `<span class="rkc${cls}"><em>${esc(c.label)}</em><b class="mono">${cellText(v,c.fmt)}</b></span>`}
/* ---------- click-to-open details (cards and table rows) ---------- */
function numFmt(fmt,v){return fmt==='growth'||fmt==='str'||fmt==='link'?null:fv(v,fmt)}
function diffLine(label,cur,prev,fmt){
  if(prev===undefined||prev===null||!isFinite(prev))return '';
  const d=cur-prev,g=prev?Math.round((cur-prev)/Math.abs(prev)*1000)/10:null,up=d>=0,f=fmt==='pct'?(x=>x.toFixed(1)+' pts'):(x=>fv(x,fmt));
  return `<div class="dl"><span>${esc(label)}</span><b class="mono">${esc(fv(prev,fmt))}</b></div><div class="dl"><span>Difference</span><b class="mono ${up?'up':'down'}">${up?'+':'−'}${esc(f(Math.abs(d)))}${g!==null?' ('+(up?'+':'−')+Math.abs(g)+'%)':''}</b></div>`;
}
function dailyChart(dl,fmt){
  const W=300,H=96,pl=4,pr=4,pt=8,pb=16,all=[...dl.cur,...(dl.prev||[])].filter(v=>typeof v==='number'&&isFinite(v)),mx=Math.max(1e-9,...all),mn=Math.min(0,...all);
  const X=(i,n)=>pl+(n>1?i/(n-1):0.5)*(W-pl-pr),Y=v=>pt+(1-(v-mn)/(mx-mn||1))*(H-pt-pb);
  const line=a=>a.map((v,i)=>(i?'L':'M')+X(i,a.length).toFixed(1)+' '+Y(v).toFixed(1)).join('');
  const dots=dl.cur.length<=62?dl.cur.map((v,i)=>`<circle cx="${X(i,dl.cur.length).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="5" fill="transparent" stroke="none" data-tip="${esc(dl.dates[i])}: ${esc(fv(v,fmt))}"></circle>`).join(''):'';
  const lo=dl.dates[0],hi=dl.dates[dl.dates.length-1];
  return `<div class="dchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Day by day chart" preserveAspectRatio="none"><path d="${line(dl.prev||[])}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" opacity=".8"/><path d="${line(dl.cur)}" fill="none" stroke="var(--accent-text)" stroke-width="2"/>${dots}<text x="${pl}" y="${H-3}" class="dax">${esc(lo.slice(5))}</text><text x="${W-pr}" y="${H-3}" text-anchor="end" class="dax">${esc(hi.slice(5))}</text></svg>
  <div class="dleg"><span><i style="background:var(--accent-text)"></i>This period</span><span><i style="background:var(--muted)"></i>Compared period</span><span class="muted">peak ${esc(fv(Math.max(...dl.cur),fmt))}</span></div></div>`;
}
/* ---------- charts that sit beside the tables ---------- */
const CAT=['#2a78d6','#eb6834','#1baf7a','#eda100','#e87ba4','#008300'],CAT_OTHER='#9b8aa8';
function short(t,n){t=String(t==null?'':t);return t.length>n?t.slice(0,n-1)+'…':t}
/* Share of the whole: biggest 6 slices plus "Other", every slice labelled with its percentage. */
function shareDonut(sec,col){
  if(!col||!['money','money2','int'].includes(col.fmt))return '';
  const items=sec.rows.map(r=>({n:String(r[sec.columns[0].key]&&r[sec.columns[0].key].text||r[sec.columns[0].key]||'Unknown'),v:Math.max(0,Number(r[col.key])||0)})).filter(x=>x.v>0);
  if(items.length<3)return '';
  items.sort((a,b)=>b.v-a.v);const top=items.slice(0,6),rest=items.slice(6).reduce((a,x)=>a+x.v,0);if(rest>0)top.push({n:'Other',v:rest});
  const total=top.reduce((a,x)=>a+x.v,0),R=52,C=2*Math.PI*R;let off=0;
  const arcs=top.map((x,i)=>{const len=x.v/total*C,col2=x.n==='Other'&&i===top.length-1&&rest>0?CAT_OTHER:CAT[i%CAT.length],a=`<circle cx="70" cy="70" r="${R}" fill="none" stroke="${col2}" class="dseg" data-tip="${esc(x.n)}: ${esc(fv(x.v,col.fmt))} (${(x.v/total*100).toFixed(1)}%)" stroke-width="22" stroke-dasharray="${Math.max(0,len-1.5).toFixed(2)} ${(C-Math.max(0,len-1.5)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"></circle>`;off+=len;return a}).join('');
  const leg=top.map((x,i)=>`<li data-tip="${esc(x.n)}: ${esc(fv(x.v,col.fmt))} (${(x.v/total*100).toFixed(1)}%)"><i style="background:${x.n==='Other'&&rest>0&&i===top.length-1?CAT_OTHER:CAT[i%CAT.length]}"></i><span>${esc(short(x.n,26))}</span><b>${(x.v/total*100).toFixed(x.v/total<0.1?1:0)}%</b></li>`).join('');
  return `<aside class="viz" aria-label="Share chart"><div class="viz-t">Share of ${esc(col.label.toLowerCase())}</div><div class="donutw"><svg viewBox="0 0 140 140" role="img" aria-label="Share chart">${arcs}<text x="70" y="67" text-anchor="middle" class="dn1">${esc(fv(total,col.fmt==='int'?'int':'money'))}</text><text x="70" y="82" text-anchor="middle" class="dn2">listed</text></svg><ul class="dleg2">${leg}</ul></div></aside>`;
}
/* Horizontal bars for the biggest lines of a breakdown. */
function bkBars(b){
  const col=[...b.columns].reverse().find(c=>['money','int'].includes(c.fmt)&&c.key!=='units');if(!col||!b.rows.length)return '';
  const rows=b.rows.map(r=>({n:r[b.columns[0].key],v:Number(r[col.key])||0})).filter(x=>x.v>0).sort((a,c)=>c.v-a.v).slice(0,8);if(rows.length<2)return '';
  const mx=rows[0].v;
  return `<aside class="viz"><div class="viz-t">Biggest by ${esc(col.label.toLowerCase())}</div>${rows.map(x=>`<div class="hb" data-tip="${esc(String(x.n))}: ${esc(fv(x.v,col.fmt))}"><div class="hb-top"><span class="hb-n" title="${esc(x.n)}">${esc(short(x.n,28))}</span><b>${esc(fv(x.v,col.fmt))}</b></div><span class="hb-b"><i style="width:${Math.max(2,x.v/mx*100)}%"></i></span></div>`).join('')}</aside>`;
}
/* Revenue down to profit after ads as steps: totals in orange, deductions in plum. */
function waterfall(b){
  const st=b.rows;if(!st||st.length<3)return '';
  const W=320,H=190,pl=6,pt=22,pb=34,bw=Math.min(46,(W-pl*2)/st.length-14),top=Math.max(...st.map(x=>Math.abs(x.amount)),1);
  const Y=v=>pt+(1-Math.max(0,v)/top)*(H-pt-pb);let run=0,out='';
  st.forEach((x,i)=>{const cx=pl+(i+.5)*(W-pl*2)/st.length,tot=/^(Net revenue|Gross profit|Profit after ads)$/.test(x.step);let a,z;
    if(tot){run=x.amount;a=0;z=x.amount}else{a=run;run=run+x.amount;z=run}
    const y1=Y(Math.max(a,z)),y2=Y(Math.min(a,z));
    out+=`<rect x="${(cx-bw/2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2,y2-y1).toFixed(1)}" rx="3" fill="${tot?'var(--accent)':'var(--cmp)'}" opacity="${tot?1:.7}"><title>${esc(x.step)}: ${esc(fv(x.amount,'money'))}</title></rect><text x="${cx.toFixed(1)}" y="${(y1-5).toFixed(1)}" text-anchor="middle" class="wv">${esc(fv(x.amount,'money'))}</text><text x="${cx.toFixed(1)}" y="${H-18}" text-anchor="middle" class="wl">${esc(short(x.step.replace('Ad spend (Meta)','Ad spend').replace('Product cost','Cost').replace('Profit after ads','After ads'),13))}</text>`});
  return `<aside class="viz"><div class="viz-t">From revenue to profit</div><svg viewBox="0 0 ${W} ${H}" class="wf" role="img" aria-label="Revenue to profit steps">${out}</svg></aside>`;
}
/* One month at a time: pick the month and year; each bar shows its percentage of a base figure; hover a bar for its exact figure.
   rows: [{key:'2026-10', month:'Oct 2026', v:{figureKey:number}}], bars: [[figureKey,label,color]], base: figureKey, baseLabel */
S.mc={key:'',keys:[]};S.more={};
function monthBarsChart(rows,bars,base,baseLabel){
  const all=rows.filter(r=>r.key).sort((a,b)=>a.key<b.key?-1:1);if(!all.length)return '';
  S.mc.keys=all.map(r=>r.key);
  let key=S.mc.key;if(!all.some(r=>r.key===key))key=(all.find(r=>r.key===perMonthSel())||all[all.length-1]).key;
  const row=all.find(r=>r.key===key),yr=key.slice(0,4),years=[...new Set(all.map(r=>r.key.slice(0,4)))].reverse();
  const monthsOfYear=all.filter(r=>r.key.startsWith(yr));
  const W=560,H=250,pl=48,pr=10,pt=38,pb=34,vals=bars.map(b=>row.v[b[0]]||0),mx=Math.max(1,...vals),mn=Math.min(0,...vals),bv=row.v[base]||0;
  const Y=v=>pt+(1-(v-mn)/(mx-mn||1))*(H-pt-pb),gw=(W-pl-pr)/bars.length,bw=Math.min(70,gw-26);
  const grid=[0,.5,1].map(f=>{const v=mn+(mx-mn)*f;return `<line x1="${pl}" x2="${W-pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--paper-line)" stroke-width="1" opacity=".7"/><text x="${pl-6}" y="${(Y(v)+3).toFixed(1)}" text-anchor="end" class="wl">${esc(shortNum(v))}</text>`}).join('');
  const body=bars.map((b,k)=>{const v=row.v[b[0]]||0,x=pl+k*gw+(gw-bw)/2,y1=Y(Math.max(v,0)),y2=Y(Math.min(v,0)),p=bv?(v/bv*100).toFixed(1)+'%':'–';
    const tip=`${row.month} · ${b[1]}: ${fv(v,'money')}${bv&&b[0]!==base?' ('+p+' of '+baseLabel+')':''}`;
    return `<g data-tip="${esc(tip)}"><rect x="${(pl+k*gw).toFixed(1)}" y="${pt}" width="${gw.toFixed(1)}" height="${H-pt-pb}" fill="transparent"/><rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(2,y2-y1).toFixed(1)}" rx="4" fill="${b[2]}"/><text x="${(x+bw/2).toFixed(1)}" y="${(v>=0?y1-18:y2+13).toFixed(1)}" text-anchor="middle" class="wv">${esc(shortNum(v))}</text><text x="${(x+bw/2).toFixed(1)}" y="${(v>=0?y1-6:y2+25).toFixed(1)}" text-anchor="middle" class="wp">${p}</text><text x="${(x+bw/2).toFixed(1)}" y="${H-12}" text-anchor="middle" class="wl">${esc(b[1])}</text></g>`}).join('');
  const sel=(id,opts,cur,label)=>`<select class="select" id="${id}" aria-label="${label}">${opts.map(([v,l])=>`<option value="${esc(v)}" ${v===cur?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
  const mname=r=>String(r.month).split(' ')[0];
  return `<div class="viz wide"><div class="viz-h"><div class="viz-t">${esc(row.month)}</div><div class="row" style="gap:8px">${sel('mc-m',monthsOfYear.map(r=>[r.key,mname(r)]),key,'Month')}${sel('mc-y',years.map(y=>[y,y]),yr,'Year')}</div></div>
  <svg viewBox="0 0 ${W} ${H}" class="mc2" role="img" aria-label="Figures for ${esc(row.month)}">${grid}${body}</svg><p class="muted dn">Percentages are shares of ${esc(baseLabel)}. Point at a bar to read its exact figure.</p></div>`;
}
function monthsChart(sec){
  const has=sec.columns.some(c=>c.key==='ads');
  const bars=[['revenue','Net revenue','#2a78d6'],['cost','Product cost','#eb6834'],...(has?[['ads','Ad spend','#eda100'],['profit','Profit after ads','#6250d6']]:[['gross','Gross profit','#6250d6']])];
  return monthBarsChart(sec.rows.map(r=>({key:r.key,month:r.month,v:r})),bars,'revenue',"the month's net revenue");
}
/* Odoo: the same one-month view for the trend sections that say which figures to draw. */
function trendMonthChart(sec){
  if(!sec.monthBars)return '';
  const pal=['#2a78d6','#1baf7a','#eb6834','#6250d6'],bars=sec.monthBars.keys.map((k,i)=>[k,(sec.metrics.find(m=>m.key===k)||{label:k}).label,pal[i%pal.length]]);
  const baseM=sec.metrics.find(m=>m.key===sec.monthBars.base)||{label:sec.monthBars.base};
  return monthBarsChart(sec.rows.map(r=>({key:r.key,month:r.label,v:r.values})),bars,sec.monthBars.base,baseM.label.toLowerCase());
}
/* hover tooltip for anything with data-tip */
(function(){
  let tip;const get=()=>tip||(tip=Object.assign(document.createElement('div'),{className:'tipbox',role:'tooltip'}),document.body.appendChild(tip),tip);
  const place=e=>{const t=get(),w=t.offsetWidth,x=Math.min(e.clientX+14,innerWidth-w-8);t.style.left=Math.max(8,x)+'px';t.style.top=(e.clientY+16)+'px'};
  document.addEventListener('mouseover',e=>{const g=e.target.closest&&e.target.closest('[data-tip]');if(!g)return;const t=get();t.textContent=g.dataset.tip;t.style.display='block';place(e)});
  document.addEventListener('mousemove',e=>{if(tip&&tip.style.display==='block')place(e)});
  document.addEventListener('mouseout',e=>{const g=e.target.closest&&e.target.closest('[data-tip]');if(g&&tip)tip.style.display='none'});
  document.addEventListener('click',e=>{const g=e.target.closest&&e.target.closest('[data-tip]');if(!g)return;const t=get();t.textContent=g.dataset.tip;t.style.display='block';place(e);setTimeout(()=>{if(tip)tip.style.display='none'},2500)});
})();
/* Breakdown behind a number: a few headline figures, then the lines it is made of. */
function breakdownHtml(b){
  if(!b)return '';
  const sum=(b.summary||[]).map(x=>`<span class="bk-s"><em>${esc(x.l)}</em><b>${esc(fv(x.v,x.f))}</b></span>`).join('');
  const head=b.columns.map(c=>`<th class="${c.fmt==='str'?'':'num'}">${esc(c.label)}</th>`).join('');
  const body=b.rows.map(r=>`<tr>${b.columns.map(c=>{const v=r[c.key];return `<td class="${c.fmt==='str'?'':'num'}">${v===null||v===undefined?'–':c.fmt==='str'?stTag(v):esc(fv(v,c.fmt))}</td>`}).join('')}</tr>`).join('');
  const chart=b.plain?'':b.columns[0].key==='step'?waterfall(b):bkBars(b);
  const tbl=b.rows.length?`<div><div class="bk-wrap"><table class="bk-t"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${b.more?`<p class="muted dn">Showing the first ${b.rows.length}. ${b.more} more are not listed.</p>`:''}</div>`:'';
  const more=(b.extra||[]).map(x=>`<h4 class="bk-h">${esc(x.title)}</h4><div class="bk-wrap"><table class="bk-t"><thead><tr>${x.columns.map(c=>`<th class="${c.fmt==='str'?'':'num'}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${x.rows.map(r=>`<tr>${x.columns.map(c=>{const v=r[c.key];return `<td class="${c.fmt==='str'?'':'num'}">${v===null||v===undefined?'–':c.fmt==='str'?stTag(v):esc(fv(v,c.fmt))}</td>`}).join('')}</tr>`).join('')}</tbody></table></div>`).join('');
  return `<div class="bk">${sum?`<div class="bk-sum">${sum}</div>`:''}${b.note?`<p class="muted dn">${esc(b.note)}</p>`:''}<div class="${chart?'splitc':''}">${tbl}${chart}</div>${more}</div>`;
}
function tileDetail(t){
  const d=curData(),per=d&&d.period?d.period.label:'this period',cmp=d&&d.compare?d.compare.label:'';
  return `<div class="dl"><span>${esc(per)}</span><b class="mono">${esc(fv(t.value,t.fmt))}</b></div>${t.prev!==undefined?diffLine(cmp?'Compared with '+cmp:'Before',t.value,t.prev,t.fmt):'<p class="muted dn">No earlier figure is available for this one.</p>'}${t.sub?`<p class="muted dn">${esc(t.sub)}</p>`:''}${t.breakdown?breakdownHtml(t.breakdown):''}${t.daily&&t.daily.cur&&t.daily.cur.length>1?dailyChart(t.daily,t.fmt):''}`;
}
function rowDetail(sec,r,i,barCol,total){
  if(r.only&&r.breakdown)return breakdownHtml(r.breakdown);
  const cols=sec.columns,name=cols[0];let h=(r.img?`<a class="pbig"${/^https?:/.test(r.img)?` href="${esc(r.img)}" target="_blank" rel="noopener"`:''}><img src="${esc(picUrl(r.img,640))}" ${/^https:\/\/cdn\.shopify\.com\//.test(r.img)?`srcset="${esc(picUrl(r.img,640))} 1x, ${esc(picUrl(r.img,1280))} 2x"`:''} alt="${esc(String(r.name||''))}" loading="lazy" referrerpolicy="no-referrer"></a>`:'')+`<div class="dl"><span>Rank</span><b class="mono">#${i+1} of ${sec.rows.length}</b></div>`;
  for(const c of cols.slice(1)){const v=r[c.key];if(v===null||v===undefined||v==='')continue;h+=`<div class="dl"><span>${esc(c.label)}</span><b class="mono">${cellText(v,c.fmt)}</b></div>`}
  if(barCol&&total>0){const v=Number(r[barCol.key])||0;h+=`<div class="dl"><span>Share of the ${sec.rows.length} listed</span><b class="mono">${(v/total*100).toFixed(1)}%</b></div>`}
  const gc=cols.find(c=>c.fmt==='growth'),g=gc&&r[gc.key];
  if(barCol&&typeof g==='number'&&g>-100){const v=Number(r[barCol.key])||0,prev=v/(1+g/100);h+=diffLine('Was '+(curData()&&curData().compareText?'in '+curData().compareText:'before'),v,prev,barCol.fmt)}
  if(r.breakdown)h+=breakdownHtml(r.breakdown);
  return h;
}
/* Shopify serves the same picture at any width; ask for 2x and 3x so it stays sharp on high-density screens. */
function picUrl(u,w){return /^https:\/\/cdn\.shopify\.com\//.test(u)?u+(u.includes('?')?'&':'?')+'width='+w:u}
function pic(r,size){if(!r.img)return '';return `<img class="pimg" src="${esc(picUrl(r.img,size*2))}" ${/^https:\/\/cdn\.shopify\.com\//.test(r.img)?`srcset="${esc(picUrl(r.img,size*2))} 1x, ${esc(picUrl(r.img,size*3))} 1.5x, ${esc(picUrl(r.img,size*4))} 2x"`:''} width="${size}" height="${size}" alt="${esc(String(r.name||''))}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.removeAttribute('srcset');this.removeAttribute('src');this.classList.add('ph')">`}
function anTable(sec){
  if(!sec.rows.length)return `<p class="muted">${esc(sec.empty||'No data for this period.')}</p>`;
  const cols=sec.columns,nameCol=cols[0],barCol=cols.find(c=>c.bar);
  if(barCol){
    const maxv=Math.max(1e-9,...sec.rows.map(r=>Number(r[barCol.key])||0));
    const rest=cols.filter(c=>c!==nameCol&&c!==barCol&&!(nameCol.fmt==='str'&&cols[1]&&cols[1].fmt==='str'&&c===cols[1]&&false));
    const total=sec.rows.reduce((a,r)=>a+(Number(r[barCol.key])||0),0);
    const anyPic=sec.rows.some(r=>r.img);
    const donut=barCol.barReverse?'':shareDonut(sec,barCol);
    const lim=sec.initial||0,open=!!S.more[sec.id],hide=lim&&!open&&sec.rows.length>lim?sec.rows.length-lim:0;
    const list=`<div class="rkl">${sec.rows.map((r,i)=>{if(hide&&i>=lim)return '';const v=Number(r[barCol.key])||0,w=barCol.barReverse?(1-Math.min(1,v/maxv)):v/maxv;
      return `<div class="rkr${anyPic?' hp':''}" data-detail tabindex="0" role="button" aria-expanded="false"><span class="rkn">${i+1}</span>${anyPic?(r.img?pic(r,52):'<span class="pimg ph" aria-hidden="true"></span>'):''}<div class="rkmain"><div class="rkt"><b title="${esc(String(r[nameCol.key]&&r[nameCol.key].text||r[nameCol.key]||''))}">${cellText(r[nameCol.key],nameCol.fmt)}</b><span class="rkv mono">${cellText(r[barCol.key],barCol.fmt)}</span></div><span class="rkbar"><i style="width:${Math.max(2,w*100)}%"></i></span>${rest.length?`<div class="rkchips">${rest.map(c=>rkChip(c,r[c.key])).join('')}</div>`:''}<div class="rkdetail">${rowDetail(sec,r,i,barCol,total)}</div></div></div>`}).join('')}${lim&&sec.rows.length>lim?`<button class="btn sm seemore" data-act="see-more" data-id="${esc(sec.id)}">${hide?'See '+hide+' more':'Show less'}</button>`:''}</div>`;
    return donut?`<div class="splitc">${list}${donut}</div>`:list;
  }
  if(cols.some(c=>c.rate)){
    return `<div class="mgrid">${sec.rows.map(r=>`<div class="mtile"><div class="rkt"><b>${cellText(r[nameCol.key],nameCol.fmt)}</b></div><div class="rkchips">${cols.slice(1).map(c=>rkChip(c,r[c.key])).join('')}</div></div>`).join('')}</div>`;
  }
  return `<div class="tablewrap"><table class="dt"><thead><tr>${cols.map(c=>`<th class="${c.fmt==='str'||c.fmt==='link'?'':'num'}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${sec.rows.map((r,i)=>r.style?`<tr class="stm stm-${r.style}">${cols.map((c,ci)=>{const v=r[c.key],isText=c.fmt==='str'||c.fmt==='link';return `<td class="${isText?'':'num mono'}">${r.style==='head'&&ci===0?'':cellText(v,c.fmt)}</td>`}).join('')}</tr>`:`<tr data-detail tabindex="0">${cols.map(c=>{const v=r[c.key],isText=c.fmt==='str'||c.fmt==='link';return `<td class="${isText?'':'num mono'}">${c===cols[0]&&r.img?`<span class="pcell">${pic(r,40)}<span>${cellText(v,c.fmt)}</span></span>`:cellText(v,c.fmt)}</td>`}).join('')}</tr><tr class="drow"><td colspan="${cols.length}"><div class="rkdetail">${rowDetail(sec,r,i,null,0)}</div></td></tr>`).join('')}</tbody></table></div>`;
}
function heroSpec(tab,secs){
  const by=id=>secs.find(s=>s.id===id&&!s.error);
  const mini=(l,v)=>({l,v});
  const gchip=t=>t&&t.prev!==undefined&&t.prev?chip(Math.round((t.value-t.prev)/t.prev*1000)/10,t.goodDown):'';
  if(tab==='sales'){const k=by('kpi'),m=by('monthly');if(!k)return {};const T=k.tiles;return {label:'Net revenue',value:fv(T[0].value,'money'),chip:gchip(T[0]),minis:[mini('Orders',fv(T[4].value,'int')),mini('Units sold',fv(T[5].value,'int')),mini('Average order',fv(T[6].value,'money'))],spark:m?m.rows.map(r=>r.values.net_sales):null,sel:m?m.rows.findIndex(r=>r.key===perMonthSel()):-1,foot:'12 months of net revenue'}}
  if(tab==='profit'){const k=by('kpi'),m=by('trend');if(!k)return {};const T=k.tiles,pr=T.find(t=>t.label==='Profit after ads')||T.find(t=>t.label==='Gross profit');return {label:pr.label,value:fv(pr.value,'money'),chip:gchip(pr),minis:[mini('Net revenue',fv(T[0].value,'money')),mini('Product cost',fv(T[1].value,'money')),...(T.find(t=>t.label==='Ad spend (Meta)')?[mini('Ad spend',fv(T.find(t=>t.label==='Ad spend (Meta)').value,'money'))]:[])],spark:m?m.rows.map(r=>r.values.profit):null,sel:m?m.rows.findIndex(r=>r.key===perMonthSel()):-1,foot:'12 months of '+pr.label.toLowerCase()}}
  if(tab==='funnel'){const f=by('funnel'),t=by('trend');if(!f)return {};const g=l=>f.tiles.find(x=>x.label===l);return {label:'Conversion rate',value:fv(g('Conversion rate').value,'pct'),minis:[mini('Sessions',fv(f.steps[0].value,'int')),mini('Cart abandonment',fv(g('Cart abandonment').value,'pct')),mini('Checkout abandonment',fv(g('Checkout abandonment').value,'pct'))],spark:t?t.rows.map(r=>r.values.conv):null,sel:t?t.rows.findIndex(r=>r.key===perMonthSel()):-1,foot:'12 months of conversion rate'}}
  if(tab==='products'){const b=by('best');if(!b||!b.rows.length)return {};const r=b.rows[0];return {label:'Best seller',value:esc(r.name),small:true,minis:[mini('Units sold',fv(r.units,'int')),mini('Net revenue',fv(r.revenue,'money'))]}}
  if(tab==='experience'){const dl=by('delivery'),rk=by('returnsKpi');if(!dl)return {};const T=dl.tiles;return {label:'Order to delivered (median)',value:fv(T[4].value,'hours'),minis:[mini('Delivered',fv(T[1].value,'int')),...(rk?[mini('Return rate',fv(rk.tiles[1].value,'pct')),mini('Cancellation rate',fv(rk.tiles[4].value,'pct'))]:[])]}}
  if(tab==='retention'){const k=by('kpi');if(!k)return {};const T=k.tiles;return {label:'Repeat purchase rate',value:fv(T[1].value,'pct'),minis:[mini('Customers',fv(T[0].value,'int')),mini('Orders each',fv(T[2].value,'num1')),mini('Average lifetime value',fv(T[4].value,'money'))]}}
  if(tab==='delivery'){const k=by('kpi');if(!k)return {};const T=k.tiles;return {label:'Delivered',value:fv(T[1].value,'int'),minis:[mini('Orders',fv(T[0].value,'int')),mini('On the way',fv(T[2].value,'int')),mini('Not shipped yet',fv(T[3].value,'int'))]}}
  if(tab==='undelivered'){const k=by('kpi');if(!k)return {};const T=k.tiles;return {label:'Orders without delivery',value:fv(T[0].value,'int'),minis:[mini('Value waiting',fv(T[1].value,'money')),mini('Over 3 days',fv(T[2].value,'int')),mini('Oldest (days)',fv(T[4].value,'num1'))]}}
  return {};
}
const TAB_INFO={profit:['Profit','Revenue, product cost and ad spend'],sales:['Sales','Revenue, orders, channels and profit'],funnel:['Website funnel','Where visitors drop off before buying'],products:['Products','What sells, what sits, and what needs work'],experience:['Customer experience','Delivery, returns and service'],retention:['Retention','Who comes back, and who to win back'],delivery:['Delivery','The delivery of every order, read live from Shopify'],undelivered:['Orders without delivery','Open orders that have not been shipped yet']};
function analyticsHero(tab,d){
  const sp=heroSpec(tab,d.sections),info=TAB_INFO[tab]||[tab,''];
  return `<section class="hero"><div class="hero-top"><div><span class="eyebrow">${esc(info[0])} · ${esc(d.monthLabel)}</span>${sp.value?`<div class="hero-n${sp.small?' sm':''}">${sp.value}</div><div><span class="hero-vs">${esc(sp.label)}</span> ${sp.chip||''}</div>`:`<div class="hero-n sm">${esc(info[1])}</div>`}</div>
    <div style="display:grid;gap:10px;justify-items:end"><div class="hero-actions"><button class="btn light" data-act="an-refresh" ${S.an.loading?'disabled':''}>${S.an.loading?'Loading…':'Refresh numbers'}</button></div>
      ${sp.minis?`<div class="minis">${sp.minis.map(m=>`<div class="mini"><span class="eyebrow">${esc(m.l)}</span><b>${m.v}</b></div>`).join('')}</div>`:''}</div></div>
    ${sp.spark&&sp.spark.length>1?areaSpark(sp.spark,sp.sel):''}${sp.foot?`<div class="hero-foot"><span>${esc(d.months[0].label)}</span><span>${esc(sp.foot)}</span><span>${esc(d.months[d.months.length-1].label)}</span></div>`:''}</section>`;
}
function anCohort(sec){
  if(!sec.rows.length)return `<p class="muted">${esc(sec.empty)}</p>`;
  const heat=v=>v===null?'':`style="background:color-mix(in srgb,var(--accent) ${Math.round(Math.min(100,v)*0.85+4)}%,transparent);color:var(--ink)"`;
  return `<div class="tablewrap"><table class="dt coh"><thead><tr><th>First purchase</th><th class="num">Customers</th>${Array.from({length:12},(_,i)=>`<th class="num">${i?'+'+i+' mo':'Month 0'}</th>`).join('')}</tr></thead><tbody>${sec.rows.map(r=>`<tr><td>${esc(r.label)}</td><td class="num mono">${fmtNum(r.size)}</td>${r.cells.map(c=>`<td class="num mono hc" ${heat(c)}>${c===null?'':Math.round(c)+'%'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function anAudit(sec){
  return `<div class="stats"><div class="stat"><div class="eyebrow">Active products</div><div class="n">${fmtNum(sec.total)}</div></div><div class="stat"><div class="eyebrow">Need attention</div><div class="n">${fmtNum(sec.withIssues)}</div><span class="muted mono" style="font-size:.75rem">${sec.total?Math.round(sec.withIssues/sec.total*100):0}% of products</span></div></div>
  ${sec.tally.length?`<h3 class="sub">Most common gaps</h3>${rankList(sec.tally.map(([name,n])=>({name,n})),x=>x.n,x=>fmtNum(x.n)+' products')}`:''}
  ${sec.worst.length?`<h3 class="sub">Products with the most gaps</h3><div class="tablewrap"><table class="dt"><tbody>${sec.worst.map(w=>`<tr><td title="${esc(w.name)}"><span class="ct">${esc(w.name)}</span></td><td>${w.issues.map(i=>`<span class="chip">${esc(i)}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Every active product passes the checklist.</p>'}`;
}
function anManual(sec){
  const v=sec.values||{};
  return `<form id="an-manual" class="manual">${sec.fields.map(f=>`<label class="mf"><span>${esc(f.label)}</span><input class="input" type="number" step="any" name="${f.key}" min="${f.min??0}" max="${f.max}" value="${v[f.key]??''}" inputmode="decimal"></label>`).join('')}
  <div class="row" style="gap:10px;grid-column:1/-1"><button class="btn primary" type="submit" ${S.an.saving?'disabled':''}>${S.an.saving?'Saving…':'Save for '+esc(sec.monthText||'this month')}</button><span class="muted" style="font-size:.8rem">Leave a box empty if you do not track it.</span></div></form>
  ${sec.history.length?`<h3 class="sub">Previous months</h3><div class="tablewrap"><table class="dt"><thead><tr><th>Month</th>${sec.fields.map(f=>`<th class="num">${esc(f.label.replace(/\s*\(.*\)/,''))}</th>`).join('')}</tr></thead><tbody>${sec.history.map(h=>`<tr><td>${esc(h.label)}</td>${sec.fields.map(f=>`<td class="num mono">${h.values[f.key]??'–'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}`;
}

/* ---- courier sheet (profit tab) ---- */
function parseDelim(text){
  const first=(text.split(/\r?\n/).find(l=>l.trim())||'');const d=first.includes('\t')?'\t':(first.split(';').length>first.split(',').length?';':',');
  const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}else cur+=c}
    else if(c==='"')q=true;else if(c===d){row.push(cur);cur=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cur);cur='';rows.push(row);row=[]}else cur+=c}
  if(cur||row.length){row.push(cur);rows.push(row)}
  return rows;
}
function colIdx(ref){let n=0;for(const ch of ref.replace(/[0-9]/g,''))n=n*26+ch.charCodeAt(0)-64;return n-1}
function parseXlsx(buf){
  const z=unzipSync(new Uint8Array(buf)),dom=t=>new DOMParser().parseFromString(t,'application/xml');
  const names=Object.keys(z),sheetName=names.filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  if(!sheetName)throw new Error('Could not read that Excel file.');
  const shared=z['xl/sharedStrings.xml']?[...dom(strFromU8(z['xl/sharedStrings.xml'])).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
  const out=[];
  for(const r of dom(strFromU8(z[sheetName])).getElementsByTagName('row')){
    const row=[];
    for(const c of r.getElementsByTagName('c')){
      const i=colIdx(c.getAttribute('r')||'A1'),t=c.getAttribute('t'),v=c.getElementsByTagName('v')[0],is=c.getElementsByTagName('is')[0];
      row[i]=t==='s'&&v?(shared[+v.textContent]||''):t==='inlineStr'&&is?[...is.getElementsByTagName('t')].map(x=>x.textContent).join(''):v?v.textContent:'';
    }
    for(let k=0;k<row.length;k++)if(row[k]===undefined)row[k]='';
    out.push(row);
  }
  return out;
}
async function sheetSend(rows){
  S.an.saving=true;renderShop();
  try{const r=await api('POST','/api/analytics',{action:'sheet',rows});Object.keys(S.an.cache).forEach(k=>{if(k.startsWith('profit|'))delete S.an.cache[k]});S.an.saving=false;toast('Saved '+r.saved+' orders from the sheet');await loadAn(true)}
  catch(x){S.an.saving=false;toast(x.message||'Could not save the sheet');renderShop()}
}
function anSheet(sec){
  const rows=sec.rows||[],ro=!isAdmin();
  return `<div class="sheetbox">
  <p class="body-text" style="font-size:.9rem"><b>Returned to shipper</b>: the order is taken out of revenue and cost, and its shipping fee comes off profit. <b>Confirmed delivery</b>: the order stays and its shipping fee comes off profit. Column A = order number, column B = status, column E = shipping fee.</p>
  ${ro?'':`<textarea id="sheet-text" class="input" rows="5" placeholder="Paste the sheet here (copy the cells from Excel or Google Sheets)" style="width:100%;font-family:var(--mono,monospace)"></textarea>
  <div class="row" style="gap:10px;margin-top:8px;flex-wrap:wrap;align-items:center"><button class="btn primary" data-act="sheet-save" ${S.an.saving?'disabled':''}>${S.an.saving?'Saving…':'Add pasted sheet'}</button><label class="btn">Upload a file (.xlsx or .csv)<input id="sheet-file" type="file" accept=".xlsx,.csv,.tsv,.txt" hidden></label>${sec.total?`<button class="btn" data-act="sheet-clear">Clear the sheet</button>`:''}</div>
  <p class="muted" style="font-size:.82rem;margin-top:8px">New uploads add to what is already saved. An order that appears again is updated.</p>`}
  ${sec.total?`<div class="repsum" style="margin:10px 0"><span>${fmtNum(sec.total)} orders in the sheet</span> · <span>${fmtNum(sec.delivered)} delivered</span> · <span>${fmtNum(sec.returned)} returned</span> · <span>${fmtNum(sec.other)} ignored</span> · <span>Fees counted ${money(sec.fees)}</span>${sec.unmatched?` · <b style="color:var(--warn)">${fmtNum(sec.unmatched)} not found in Shopify</b>`:''}</div>
  ${(sec.ignoredStatuses||[]).length?`<p class="muted" style="font-size:.82rem">Ignored statuses: ${sec.ignoredStatuses.map(x=>esc(x.status)+' ('+x.n+')').join(', ')}. Tell me if one of these should count.</p>`:''}<div class="tablewrap"><table class="dt"><thead><tr><th>Order</th><th>Date</th><th>Courier status</th><th>Result</th><th class="num">Shipping fee</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.no)}</td><td>${esc(r.date)}</td><td>${esc(r.status)}</td><td>${esc(r.result)}</td><td class="num">${esc(money(r.fee))}</td></tr>`).join('')}</tbody></table></div>${sec.more?`<p class="muted">Showing 300 of ${fmtNum(sec.total)}.</p>`:''}`:''}
  </div>`;
}
function anSection(sec){
  const head=`<div><h2>${esc(sec.title)}</h2>${sec.note?`<p class="muted" style="font-size:.85rem">${esc(sec.note)}</p>`:''}</div>`;
  if(sec.error)return `<section class="panel an" style="border-color:var(--warn)">${head}<p class="body-text"><b style="color:var(--warn)">This part could not be loaded.</b> ${esc(sec.error)}</p></section>`;
  let body='';
  try{
    body=sec.kind==='kpi'?anKpi(sec):sec.kind==='funnel'?anFunnel(sec):sec.kind==='trend'?trendMonthChart(sec)+anTrend(sec):sec.kind==='table'?(sec.id==='months'?monthsChart(sec):'')+anTable(sec):sec.kind==='reps'?anReps(sec):sec.kind==='cohort'?anCohort(sec):sec.kind==='audit'?anAudit(sec):sec.kind==='campaigns'?metaCampaigns(sec):sec.kind==='manual'?anManual(sec):sec.kind==='sheet'?anSheet(sec):sec.kind==='text'?`<ul class="gaps">${sec.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:'';
  }catch(e){body=`<p class="muted">Could not show this part (${esc(e.message)}).</p>`}
  return `<section class="panel an${sec.kind==='text'?' soft':''}">${head}${body}</section>`;
}
function renderAnalytics(L){
  const an=S.an,sh=S.shop,d=an.cache[an.tab+'|'+perQuery()]||an.cache[an.last];
  an.data=d;
  if(!d){L.innerHTML=shopTabs()+(an.err?`<div class="empty"><b>Could not load this tab</b><span>${esc(an.err)}</span><button class="btn" data-act="an-refresh">Try again</button></div>`:empty('Loading…','Asking Shopify for the numbers. This can take a few seconds.'));return}
  if(d.configured===false){L.innerHTML=shopTabs()+`<div class="panel"><h2>Connect your Shopify store first</h2><p class="muted">Missing: ${d.missing.map(esc).join(', ')}</p></div>`;return}
  const scrollY=window.scrollY;
  L.innerHTML=shopTabs()+dateBar(d)+analyticsHero(an.tab,d)+(an.err?`<div class="panel" style="border-color:var(--danger)"><b style="color:var(--danger)">Problem</b><p class="body-text">${esc(an.err)}</p></div>`:'')+(d.scopes?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Permissions this site currently has from Shopify</b><p class="body-text mono" style="font-size:.8rem">${d.scopes.length?d.scopes.map(esc).join(', '):'none returned'}</p><p class="muted" style="font-size:.8rem">Reports need read_reports in this list.</p></div>`:'')+highlights(d.sections)+d.sections.map(anSection).join('')+`<p class="muted" style="font-size:.78rem">Figures come straight from Shopify reports and are kept for 30 minutes. Press Refresh numbers to fetch them again. Times use ${esc(d.tz)}.</p>`;
  window.scrollTo(0,scrollY);
}


function odHeroSpec(tab,secs){
  if(tab==='profit')return heroSpec('profit',secs);
  const by=id=>secs.find(x=>x.id===id&&!x.error),k=by('kpi'),tr=by('trend');if(!k)return {};
  const T=k.tiles,g=l=>T.find(t=>t.label===l),mini=(l,t)=>t?{l,v:fv(t.value,t.fmt)}:null;
  const fixed={inventory:['Stock value (at cost)',['Stocked products','Out of stock','Running low']],sales:['Order value',['Confirmed orders','Invoiced','Waiting to be paid']],hr:['Employees',['Departments','Hours worked','Approved time off']]}[tab];
  const main=fixed?fixed[0]:T[0].label,m=g(main);if(!m)return {};
  const minis=(fixed?fixed[1]:T.slice(1,4).map(t=>t.label)).map(l=>mini(l,g(l))).filter(Boolean);
  const key=tab==='sales'?'orders':tr&&tr.metrics&&tr.metrics.length?tr.metrics[0].key:null,rows=tr&&key?tr.rows:null;
  return {label:main,value:fv(m.value,m.fmt),chip:m.prev!==undefined&&m.prev?chip(Math.round((m.value-m.prev)/m.prev*1000)/10,m.goodDown):'',minis,spark:rows?rows.map(r=>r.values[key]):null,sel:rows?rows.findIndex(r=>r.key===perMonthSel()):-1,rows};
}
function odooHero(d){
  const sp=odHeroSpec(d.tab,d.sections),info={suppliers:'Who you buy from and what you owe',raw:'Raw materials: stock and buying',packaging:'Packaging: stock and buying',finished:'Finished goods: stock and sales',inventory:'All stock, by type',sales:'Orders and invoices',distributors:'Your distributors and what they owe',people:'Sales per salesperson',profit:'Revenue, product cost and ad spend',in:'Invoices and what customers owe',out:'Bills and what you owe',trial:'Debit and credit by account',pnl:'Income, expenses and net profit',balance:'Assets, liabilities and equity at the end date',hr:'People and attendance'}[d.tab];
  const rows=sp.rows||(()=>{const t=d.sections.find(x=>x.id==='trend'&&!x.error);return t?t.rows:null})();
  return `<section class="hero"><div class="hero-top"><div><span class="eyebrow">Odoo${d.company?' · '+esc(d.company):''} · ${esc(d.monthLabel)}</span>${sp.value?`<div class="hero-n${sp.small?' sm':''}">${sp.value}</div><div><span class="hero-vs">${esc(sp.label)}</span> ${sp.chip||''}</div>`:`<div class="hero-n sm">${esc(info)}</div>`}${d.version?`<div><span class="hero-vs">Odoo ${esc(d.version)}</span></div>`:''}</div>
    <div style="display:grid;gap:10px;justify-items:end"><div class="hero-actions"><button class="btn light" data-act="od-refresh" ${S.od.loading?'disabled':''}>${S.od.loading?'Loading…':'Refresh numbers'}</button></div>
      ${sp.minis&&sp.minis.length?`<div class="minis">${sp.minis.map(m=>`<div class="mini"><span class="eyebrow">${esc(m.l)}</span><b>${m.v}</b></div>`).join('')}</div>`:''}</div></div>
    ${sp.spark&&sp.spark.length>1?areaSpark(sp.spark,sp.sel):''}${sp.spark&&sp.spark.length>1&&rows?`<div class="hero-foot"><span>${esc(rows[0].label)}</span><span>12 months of ${esc((sp.label||'').toLowerCase())}</span><span>${esc(rows[rows.length-1].label)}</span></div>`:''}</section>`;
}

/* Sales by salesperson: plain tables only. Click a line to see what is behind it. */
function targetBox(p){
  const t=p.monthlyTarget||0,pct=p.targetPct,w=Math.max(0,Math.min(100,pct||0)),canEdit=isAdmin();
  const form=canEdit?`<form class="tgform" data-form="rep-target" data-rep="${esc(p.name)}" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px"><label class="muted" style="font-size:.85rem">Monthly target</label><input class="input" name="amount" type="number" min="0" step="100" value="${t||''}" placeholder="e.g. 500000" style="width:150px"><button class="btn sm primary" type="submit">Save target</button></form>`:'';
  if(!t)return `<div class="tgbox">${canEdit?`<p class="muted" style="font-size:.88rem;margin:0">No target set for ${esc(p.name)}.</p>${form}`:''}</div>`;
  const hit=pct>=100;
  return `<div class="tgbox"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span><b>Monthly target: ${esc(fv(t,'money'))}</b>${Math.abs(p.periodTarget-t)>1?` <span class="muted">(${esc(fv(p.periodTarget,'money'))} for these dates)</span>`:''}</span><span><b style="color:var(--${hit?'ok':'warn'})">${Math.round(pct)}% achieved</b> · ${hit?`${esc(fv(p.cur.sales-p.periodTarget,'money'))} above target`:`${esc(fv(p.targetLeft,'money'))} to go`}</span></div><div class="bar" style="margin-top:6px"><i style="width:${w}%"></i></div>${form}</div>`;
}
function anReps(sec){
  if(!sec.people.length)return `<p class="muted">${esc(sec.empty)}</p>`;
  const plain=(cols,rows,empty)=>anTable({columns:cols,rows:rows.map(r=>r.breakdown?{...r,only:true}:r),empty});
  const col=(key,label,fmt)=>({key,label,fmt}),hasT=sec.people.some(x=>x.monthlyTarget>0);
  const team=plain([col('name','Salesperson','str'),col('sales','Sales (before tax)','money'),col('orders','Orders','int'),col('units','Units','int'),col('distributors','Distributors','int'),col('invoices','Invoices','int'),col('invoiced','Invoiced','money'),...(hasT?[col('monthlyTarget','Monthly target','money'),col('targetPct','Achieved','pct')]:[])],
    sec.people.map(x=>({name:x.name,sales:x.cur.sales,orders:x.cur.orders,units:x.cur.units,distributors:x.distributors,invoices:x.cur.invoices,invoiced:x.cur.invoiced,monthlyTarget:x.monthlyTarget||null,targetPct:x.targetPct,breakdown:x.breakdown})));
  const one=(p,n)=>{
    const c=p.cur,stat=(l,v,k)=>`<button type="button" class="rs" data-act="rep-stat" data-k="${k}" aria-expanded="false"><em>${esc(l)}</em><b>${esc(v)}</b></button>`;
    return `<details class="repbox"${n===0?' open':''}><summary><b>${esc(p.name)}</b><span class="muted">${esc(fv(c.sales,'money'))} · ${fmtNum(c.orders)} orders · ${fmtNum(c.units)} units${p.targetPct!==null&&p.targetPct!==undefined?` · <b>${Math.round(p.targetPct)}% achieved</b>`:''}</span></summary>
    <div class="repin">${targetBox(p)}<div class="repsum">${stat('Sales',fv(c.sales,'money'),'months')}${stat('Orders',fmtNum(c.orders),'orders')}${stat('Units',fmtNum(c.units),'units')}${stat('Distributors',fmtNum(p.distributors),'dist')}${stat('Invoices',fmtNum(c.invoices),'invoices')}${stat('Invoiced',fv(c.invoiced,'money'),'invoices')}</div>
    <div class="repdet" data-k="orders" hidden><h3 class="sub">Orders (${fmtNum(c.orders)})</h3>${plain([col('name','Order','str'),col('date','Date','str'),col('customer','Distributor','str'),col('city','City','str'),col('amount','Amount','money')],p.orders||[],'No orders in this period.')}</div>
    <div class="repdet" data-k="units" hidden><h3 class="sub">Units per product (${fmtNum(c.units)})</h3>${plain([col('name','Product','str'),col('units','Units','int'),col('distributors','Distributors','int'),col('orders','Orders','int'),col('sales','Sales','money')],p.products,'No sales in this period.')}</div>
    <div class="repdet" data-k="dist" hidden><h3 class="sub">Distributors (${fmtNum(p.distributors)})</h3>${plain([col('name','Distributor','str'),col('city','City','str'),col('orders','Orders','int'),col('units','Units','int'),col('sales','Sales','money'),col('invoices','Invoices','int'),col('invoiced','Invoiced','money')],p.customers,'No sales in this period.')}</div>
    <div class="repdet" data-k="invoices" hidden><h3 class="sub">Invoices (${fmtNum(c.invoices)}) · ${esc(fv(c.invoiced,'money'))}</h3>${plain([col('name','Invoice','str'),col('customer','Distributor','str'),col('date','Date','str'),col('amount','Amount','money'),col('status','Payment','str')],p.invoices,'No invoices in this period.')}</div>
    <div class="repdet" data-k="months" hidden><h3 class="sub">Sales month by month</h3>${plain([col('label','Month','str'),col('sales','Sales','money'),col('orders','Orders','int'),col('units','Units','int'),col('invoiced','Invoiced','money'),...(p.monthlyTarget?[col('target','Monthly target','money'),col('targetPct','Achieved','pct')]:[])],p.months.slice().reverse(),'No sales.')}</div>
    <h3 class="sub">Products</h3>${plain([col('name','Product','str'),col('units','Units','int'),col('distributors','Distributors','int'),col('orders','Orders','int'),col('sales','Sales','money')],p.products,'No sales in this period.')}
    <h3 class="sub">Distributors</h3>${plain([col('name','Distributor','str'),col('city','City','str'),col('invoices','Invoices','int'),col('invoiced','Invoiced','money'),col('units','Units','int'),col('orders','Orders','int'),col('sales','Sales','money')],p.customers,'No sales in this period.')}
    <h3 class="sub">Cities</h3>${plain([col('name','City','str'),col('distributors','Distributors','int'),col('units','Units','int'),col('orders','Orders','int'),col('sales','Sales','money')],p.cities,'No sales in this period.')}
    <h3 class="sub">Month by month</h3>${plain([col('label','Month','str'),col('sales','Sales','money'),col('orders','Orders','int'),col('units','Units','int'),col('invoiced','Invoiced','money'),...(p.monthlyTarget?[col('target','Target','money'),col('targetPct','Of target','pct')]:[])],p.months.slice().reverse(),'No sales.')}
    <h3 class="sub">Invoices</h3>${plain([col('name','Invoice','str'),col('customer','Distributor','str'),col('date','Date','str'),col('amount','Amount','money'),col('status','Payment','str')],p.invoices,'No invoices in this period.')}</div></details>`;
  };
  return `${sec.source?`<p class="muted" style="font-size:.85rem">${esc(sec.source)}</p>`:''}<h3 class="sub">Everyone</h3>${team}<h3 class="sub" style="margin-top:22px">Each salesperson</h3><p class="muted" style="font-size:.85rem">Click any line to see the detail behind it.</p>${sec.people.map(one).join('')}`;
}
/* ---------- Odoo ---------- */
const OD_GROUPS=[['supply','Supply',[['suppliers','Suppliers'],['raw','Raw materials'],['packaging','Packaging'],['finished','Finished goods'],['inventory','All stock']]],['sales','Sales',[['sales','Sales'],['distributors','Distributors'],['people','Salespeople']]],['finance','Finance',[['profit','Cost & profit'],['in','Money in'],['out','Money out'],['trial','Trial balance'],['pnl','Profit & loss'],['balance','Balance sheet']]],['team','Team',[['hr','Employees']]]];
const odGroup=t=>OD_GROUPS.find(g=>g[2].some(x=>x[0]===t))||OD_GROUPS[0];
S.od={tab:'suppliers',month:'',cache:{},loading:false,err:'',data:null};
async function loadOdoo(_m,refresh){
  const od=S.od;
  const key=od.tab+'|'+perQuery();
  if(!refresh&&od.cache[key]){od.data=od.cache[key];renderOdoo();return}
  od.loading=true;od.err='';renderOdoo();
  try{
    const d=await api('GET','/api/odoo?tab='+od.tab+'&'+perQuery());
    od.cache[key]=d;od.data=d;
  }catch(e){od.err=e.message}
  od.loading=false;renderOdoo();
}
function odooSetup(missing){
  return `<section class="panel"><h2>Connect Odoo</h2><p class="body-text">This site is not connected to Odoo yet. Add these settings in Vercel (Project, Settings, Environment Variables), then redeploy:</p>
  <ul class="gaps"><li><b>ODOO_URL</b>: your Odoo address, for example https://yourcompany.odoo.com</li><li><b>ODOO_DB</b>: the database name (on Odoo Online it is usually the part before .odoo.com)</li><li><b>ODOO_LOGIN</b>: the email of the Odoo user the dashboard should read as</li><li><b>ODOO_API_KEY</b>: an API key made in Odoo (your avatar, My Profile, Account Security, New API Key)</li></ul>
  <p class="muted">Still missing: ${missing.map(esc).join(', ')}</p></section>`;
}
function renderOdoo(){
  if(S.screen!=='app'||S.route!=='odoo')return;const L=$('#live');if(!L)return;
  const od=S.od,d=od.data,grp=odGroup(od.tab),tabs=`<div class="subtabs" role="tablist">${OD_GROUPS.map(([g,l,ps])=>`<button role="tab" class="subtab${grp[0]===g?' on':''}" aria-selected="${grp[0]===g}" data-act="od-tab" data-tab="${(od.last&&od.last[g])||ps[0][0]}">${l}</button>`).join('')}</div>${grp[2].length>1?`<div class="subtabs pills" role="tablist" aria-label="${grp[1]}">${grp[2].map(([k,l])=>`<button role="tab" class="subtab${od.tab===k?' on':''}" aria-selected="${od.tab===k}" data-act="od-tab" data-tab="${k}">${l}</button>`).join('')}</div>`:''}`;
  if(!d||d.tab!==od.tab){L.innerHTML=tabs+(od.err?`<div class="empty"><b>Could not reach Odoo</b><span>${esc(od.err)}</span><button class="btn" data-act="od-refresh">Try again</button></div>`:empty('Loading…','Asking Odoo for the numbers. This can take a few seconds.'));return}
  if(d.configured===false){L.innerHTML=tabs+odooSetup(d.missing);return}
  const y=window.scrollY;
  L.innerHTML=tabs+dateBar(d)+odooHero(d)
    +(od.err?`<div class="panel" style="border-color:var(--danger)"><b style="color:var(--danger)">Problem</b><p class="body-text">${esc(od.err)}</p></div>`:'')+highlights(d.sections)+d.sections.map(anSection).join('');
  window.scrollTo(0,y);
}

/* ---------- Meta Ads ---------- */
const META_TABS=[['overview','Overview'],['campaigns','Campaigns']];
S.meta={tab:'overview',month:'',cache:{},loading:false,busy:false,err:'',data:null};
async function loadMeta(_m,refresh){
  const m=S.meta;
  const key=m.tab+'|'+perQuery();
  if(!refresh&&m.cache[key]){m.data=m.cache[key];renderMeta();return}
  m.loading=true;m.err='';renderMeta();
  try{
    const d=await api('GET','/api/meta?tab='+m.tab+'&'+perQuery()+(refresh?'&refresh=1':''));
    m.cache[key]=d;m.data=d;
  }catch(e){m.err=e.message}
  m.loading=false;renderMeta();
}
async function metaWrite(body,msg){
  const m=S.meta;m.busy=true;
  try{await api('POST','/api/meta',body);toast(msg);m.cache={};await loadMeta(undefined,true)}
  catch(e){toast(e.message||'Could not change the campaign');renderMeta()}
  m.busy=false;
}
function metaSetup(missing){
  return `<section class="panel"><h2>Connect Meta Ads</h2><p class="body-text">This site is not connected to your Meta ad account yet. Create a token in Meta Business Settings, then add the settings in Vercel (Project, Settings, Environment Variables) and redeploy:</p>
  <ol class="gaps"><li>Open <b>business.facebook.com</b>, then Business Settings, Users, <b>System users</b>, and add a system user with the Admin role.</li><li>Under <b>Add assets</b>, give that user your ad account. Choose "Manage campaigns" if you want to pause campaigns and change budgets from here, or "View performance" for reports only.</li><li>Press <b>Generate new token</b>, pick your Meta app, and tick <b>ads_read</b> (add <b>ads_management</b> to allow changes). Copy the token.</li></ol>
  <ul class="gaps"><li><b>META_ACCESS_TOKEN</b>: the token you just copied</li><li><b>META_AD_ACCOUNT_ID</b>: your ad account number, shown in Ads Manager (with or without the act_ in front)</li><li><b>META_API_VERSION</b> (optional): defaults to v23.0</li></ul>
  <p class="muted">Still missing: ${missing.map(esc).join(', ')}</p></section>`;
}
const META_STATUS=s=>String(s||'').replace(/_/g,' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
function metaCampaigns(sec){
  if(!sec.rows.length)return `<p class="muted">${esc(sec.empty)}</p>`;
  const busy=S.meta.busy?'disabled':'';
  const rows=sec.rows.map(r=>{
    const live=r.status==='ACTIVE'&&r.effective==='ACTIVE';
    const pill=`<span class="pill ${live?'done':'new'}">${esc(r.status==='PAUSED'?'Paused':r.status==='ACTIVE'&&r.effective==='ACTIVE'?'Active':META_STATUS(r.effective||r.status))}</span>`;
    const budget=r.dailyBudget!==null&&r.dailyBudget!==undefined
      ?`<span class="mcell"><input class="input mbud" type="number" min="1" step="any" inputmode="decimal" value="${esc(r.dailyBudget)}" data-id="${esc(r.id)}" aria-label="Daily budget for ${esc(r.name)}"><button class="btn sm" data-act="meta-budget" data-id="${esc(r.id)}" ${busy}>Save</button></span>`
      :r.lifetimeBudget!==null&&r.lifetimeBudget!==undefined?`<span class="muted">Lifetime ${esc(money(r.lifetimeBudget))}</span>`:`<span class="muted">Set on each ad set</span>`;
    const act=r.canToggle?(r.status==='ACTIVE'?`<button class="btn sm danger" data-act="meta-toggle" data-id="${esc(r.id)}" data-to="PAUSED" ${busy}>Pause</button>`:`<button class="btn sm" data-act="meta-toggle" data-id="${esc(r.id)}" data-to="ACTIVE" ${busy}>Resume</button>`):'';
    return `<tr><td title="${esc(r.name)}">${r.img?`<span class="pcell">${pic(r,40)}<span><span class="ct">${esc(r.name)}</span>${r.objective?`<small class="muted">${esc(r.objective)}</small>`:''}</span></span>`:`<span class="ct">${esc(r.name)}</span>${r.objective?`<small class="muted">${esc(r.objective)}</small>`:''}`}</td><td>${pill}</td><td class="num">${budget}</td><td class="num mono">${esc(money(r.spend))}</td><td class="num mono">${esc(fmtNum(r.purchases))}</td><td class="num mono">${r.spend?esc(fv(r.roas,'x')):'–'}</td><td class="num mono">${r.purchases?esc(money2(r.cpp)):'–'}</td><td class="num">${act}</td></tr>`;
  }).join('');
  return `<div class="tablewrap"><table class="dt"><thead><tr><th>Campaign</th><th>Status</th><th class="num">Daily budget</th><th class="num">Spent</th><th class="num">Purchases</th><th class="num">Return</th><th class="num">Per purchase</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderMeta(){
  if(S.screen!=='app'||S.route!=='meta')return;const L=$('#live');if(!L)return;
  const m=S.meta,d=m.data,tabs=`<div class="subtabs" role="tablist">${META_TABS.map(([k,l])=>`<button role="tab" class="subtab${m.tab===k?' on':''}" aria-selected="${m.tab===k}" data-act="meta-tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
  if(d&&d.configured===false){L.innerHTML=tabs+metaSetup(d.missing);return}
  if(!d||d.tab!==m.tab){L.innerHTML=tabs+(m.err?`<div class="empty"><b>Could not reach Meta</b><span>${esc(m.err)}</span><button class="btn" data-act="meta-refresh">Try again</button></div>`:empty('Loading…','Asking Meta for the numbers. This can take a few seconds.'));return}
  const info={overview:'Spend, results and what is working',campaigns:'Switch campaigns on or off and set budgets'}[d.tab];
  const warn=d.accountStatus&&d.accountStatus!=='Active'?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">This ad account is ${esc(d.accountStatus.toLowerCase())}</b><p class="body-text">Meta may not be delivering ads. Check Ads Manager.</p></div>`:'';
  const y=window.scrollY;
  L.innerHTML=tabs+dateBar(d)+`<section class="hero"><div class="hero-top"><div><span class="eyebrow">Meta Ads${d.account?' · '+esc(d.account):''} · ${esc(d.monthLabel)}</span><div class="hero-n sm">${esc(info)}</div><div><span class="hero-vs">${esc(d.currency)}${d.timezone?' · '+esc(d.timezone):''}</span></div></div>
    <div class="hero-actions"><button class="btn light" data-act="meta-refresh" ${m.loading?'disabled':''}>${m.loading?'Loading…':'Refresh numbers'}</button></div></div></section>`
    +warn+(m.err?`<div class="panel" style="border-color:var(--danger)"><b style="color:var(--danger)">Problem</b><p class="body-text">${esc(m.err)}</p></div>`:'')+highlights(d.sections)+d.sections.map(anSection).join('');
  window.scrollTo(0,y);
}


/* ---------- activity: tracking (every signed-in user) + report (admin) ---------- */
const AT={id:'',key:'',acc:0,mark:Date.now(),sent:-1,sentAt:0,act:Date.now()};
function atKey(){if(!S.me)return '';const r=S.route,t=r==='shop'?S.an.tab:r==='odoo'?S.od&&S.od.tab:r==='meta'?S.meta.tab:'';return t?r+':'+t:r}
function atSend(){
  if(!AT.id||!AT.key)return;const secs=Math.round(AT.acc);if(secs===AT.sent)return;AT.sent=secs;AT.sentAt=Date.now();
  try{fetch('/api/auth?action=ping',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({id:AT.id,page:AT.key,secs}),credentials:'same-origin'}).catch(()=>{})}catch(e){}
}
function atTick(){
  if(!S.me){AT.id='';AT.key='';return}
  const now=Date.now(),dt=Math.min(now-AT.mark,15000);AT.mark=now;
  const key=atKey();
  if(key!==AT.key){atSend();AT.key=key;AT.id='v'+now.toString(36)+Math.random().toString(36).slice(2,7);AT.acc=0;AT.sent=-1;atSend();return}
  if(!document.hidden&&now-AT.act<60000)AT.acc+=dt/1000;
  if(now-AT.sentAt>=15000)atSend();
}
['mousemove','keydown','click','scroll','touchstart'].forEach(ev=>addEventListener(ev,()=>{AT.act=Date.now()},{passive:true,capture:true}));
document.addEventListener('visibilitychange',()=>{if(document.hidden){atTick();atSend()}else{AT.mark=Date.now();AT.act=Date.now()}});
addEventListener('pagehide',()=>{atTick();atSend()});
setInterval(atTick,4000);

S.act={days:30,data:null,loading:false,err:'',open:'',log:'20'};
const ACT_PAGES={home:'Overview',send:'Send instruction',content:'All content',eval:'Evaluation',shop:'Shopify',odoo:'Odoo',meta:'Meta Ads',team:'Team by role',notes:'Notifications',users:'Users',act:'Activity',ins:'Instruction',uploads:'My uploads',login:'Signed in'};
function actPage(k){const [r,t]=String(k).split(':');const nm=ACT_PAGES[r]||r;if(!t)return nm;const tab=r==='shop'?(AN_TABS.find(x=>x[0]===t)||[])[1]:({pnl:'Profit & loss',trial:'Trial balance',balance:'Balance sheet',hr:'HR',in:'Stock in',out:'Stock out'})[t]||t;return nm+' · '+(tab||t).toString().replace(/^./,c=>c.toUpperCase())}
function actDur(sec){sec=Math.round(sec||0);if(sec<60)return sec+'s';const m=Math.floor(sec/60);if(m<60)return m+'m '+String(sec%60).padStart(2,'0')+'s';const h=Math.floor(m/60);return h+'h '+String(m%60).padStart(2,'0')+'m'}
function actAgo(t){if(!t)return 'Never';const d=Date.now()-t;if(d<90e3)return 'Just now';if(d<36e5)return Math.round(d/6e4)+' min ago';if(d<864e5)return Math.round(d/36e5)+' h ago';return Math.round(d/864e5)+' days ago'}
function actAt(t){return new Date(t).toLocaleString('en-GB',{timeZone:'Africa/Cairo',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false})}
async function loadAct(){
  if(S.act.loading)return;S.act.loading=true;S.act.err='';if(S.route==='act')renderAct();
  try{S.act.data=await api('GET','/api/auth?action=activity&days='+S.act.days)}catch(e){S.act.err=e.message}
  S.act.loading=false;if(S.route==='act')renderAct();
}
function actBars(items,w,h,fmt){
  const mx=Math.max(1,...items.map(i=>i.v)),n=items.length,bw=(w-30)/n;
  return `<svg class="oi-chart" viewBox="0 0 ${w} ${h}" role="img">${[0,.5,1].map(f=>`<line class="oi-gl" x1="30" x2="${w}" y1="${(h-22)*(1-f)+4}" y2="${(h-22)*(1-f)+4}"/>`).join('')}<text class="oi-axis" x="26" y="${10}" text-anchor="end">${mx}</text><text class="oi-axis" x="26" y="${h-18}" text-anchor="end">0</text>${items.map((i,k)=>{const bh=Math.max(i.v?2:0,(h-26)*i.v/mx);return `<rect class="oi-bar" x="${30+k*bw+bw*.15}" y="${h-22-bh}" width="${bw*.7}" height="${bh}" rx="3" fill="var(--accent)" data-tip="${esc(i.tip)}"/>`}).join('')}${items.map((i,k)=>i.l&&(n<=14||k%Math.ceil(n/12)===0)?`<text class="oi-axis" x="${30+k*bw+bw/2}" y="${h-6}" text-anchor="middle">${esc(i.l)}</text>`:'').join('')}</svg>`;
}
function actModal(d){
  const u=d.users.find(x=>x.id===S.act.open);if(!u)return '';
  const mx=Math.max(1,...u.pages.map(p=>p.secs)),ev=u.recent||[];
  return `<div class="amod" data-act="act-close" role="dialog" aria-modal="true" aria-label="Activity of ${esc(u.username)}"><div class="amod-box" onclick="event.stopPropagation()">
    <div class="amod-h"><div><h2>${esc(u.username)}</h2><div class="row">${roleChip(u.role)}<span class="muted">${u.online?'Online now':u.lastSeen?'Last seen '+actAgo(u.lastSeen)+' · '+actAt(u.lastSeen):'Never opened the hub'}</span></div></div><button class="btn ghost" data-act="act-close" aria-label="Close">✕</button></div>
    <div class="amod-kpis">${[['Sign-ins',u.logins],['Page views',u.visits],['Time spent',actDur(u.secs)],['Avg / visit',u.visits?actDur(u.avgVisit):'–'],['Active days',u.activeDays]].map(([l,v])=>`<div><span class="eyebrow">${l}</span><b>${v}</b></div>`).join('')}</div>
    <h3>Pages opened · last ${d.days} days</h3>
    ${u.pages.length?`<div class="oi-hbs">${u.pages.map(p=>`<div class="oi-hb"><span class="oi-hl" title="${esc(actPage(p.page))}">${esc(actPage(p.page))}</span><span class="oi-ht"><i style="width:${p.secs/mx*100}%;background:var(--accent)"></i></span><span class="oi-hv">${p.visits}× · ${actDur(p.secs)}</span></div>`).join('')}</div>`:'<p class="muted">No pages opened in this range.</p>'}
    <h3>Timeline</h3>
    <div class="tablewrap amod-log"><table class="dt"><thead><tr><th>When</th><th>What</th><th class="num">Time on page</th><th>Device</th></tr></thead><tbody>${ev.map(r=>`<tr><td class="mono">${actAt(r.at)}</td><td>${r.kind==='login'?'<b>Signed in</b>':esc(actPage(r.page))}</td><td class="num">${r.kind==='login'?'–':actDur(r.secs)}</td><td>${esc(r.device)}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">Nothing recorded.</td></tr>'}</tbody></table></div>
  </div></div>`;
}
function renderAct(){
  const L=$('#live');if(!L)return;const A=S.act,d=A.data;
  const head=`<div class="head"><div><h1>Activity</h1><p>Who is using the hub, which pages they open and for how long. Times are Cairo time.</p></div><div class="row"><div class="seg" role="group" aria-label="Range">${[[7,'7 days'],[30,'30 days'],[90,'90 days']].map(([n,l])=>`<button type="button" class="segb${A.days===n?' on':''}" data-act="act-days" data-n="${n}">${l}</button>`).join('')}</div><button class="btn" data-act="act-refresh">Refresh</button></div></div>`;
  if(!d){L.innerHTML=head+(A.err?`<div class="empty"><b>Could not load activity</b><p>${esc(A.err)}</p><button class="btn" data-act="act-refresh">Try again</button></div>`:`<div class="empty"><p>Loading activity…</p></div>`);if(!A.loading&&!A.err)loadAct();return}
  const tot=d.users.reduce((a,u)=>({v:a.v+u.visits,s:a.s+u.secs,l:a.l+u.logins}),{v:0,s:0,l:0});
  const active=d.users.filter(u=>u.visits||u.logins).length,online=d.users.filter(u=>u.online).length;
  const strip=`<div class="oi-strip">${[['Online now',online,online?'seen in the last 3 minutes':'nobody right now'],['Active people',active+' / '+d.users.length,'opened the hub in '+d.days+' days'],['Page views',tot.v,tot.l+' sign-ins'],['Time spent',actDur(tot.s),'active time on pages'],['Avg per visit',actDur(tot.v?tot.s/tot.v:0),'per page opened']].map(([l,v,sub])=>`<div class="oi-st"><span class="eyebrow">${l}</span><b class="oi-big">${v}</b><span class="muted">${sub}</span></div>`).join('')}</div>`;
  // daily chart over the full range
  const days=[];const dk=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(t);
  const map=new Map(d.daily.map(x=>[x.day,x]));
  for(let i=d.days-1;i>=0;i--){const k=dk(d.now-i*864e5),x=map.get(k)||{visits:0,users:0,secs:0};days.push({v:x.visits,l:k.slice(5).replace('-','/'),tip:k+' · '+x.visits+' page views · '+x.users+' people · '+actDur(x.secs)})}
  const hrs=d.hours.map((v,h)=>({v,l:String(h).padStart(2,'0'),tip:String(h).padStart(2,'0')+':00 · '+v+' page views'}));
  const mxP=Math.max(1,...d.pages.map(p=>p.visits));
  const pagesHB=d.pages.length?`<div class="oi-hbs">${d.pages.slice(0,10).map(p=>`<div class="oi-hb"><span class="oi-hl" title="${esc(actPage(p.page))}">${esc(actPage(p.page))}</span><span class="oi-ht"><i style="width:${p.visits/mxP*100}%;background:var(--accent)"></i></span><span class="oi-hv">${p.visits} · ${actDur(p.secs)}</span></div>`).join('')}</div>`:'<p class="muted">No page views yet.</p>';
  const card=(t,sub,body)=>`<section class="viz oi-card"><div><h3>${t}</h3><p class="muted">${sub}</p></div>${body}</section>`;
  const charts=`<div class="oi-grid wide">${card('Page views per day','Every page opened, by day.',actBars(days,520,190))}${card('Busiest hours','When the hub is used, across the whole range.',actBars(hrs,520,190))}</div><div class="oi-grid wide">${card('Most opened pages','Page views and total time spent.',pagesHB)}${card('Who spends the most time','Total active time per person.',(()=>{const t=d.users.filter(u=>u.secs).sort((a,b)=>b.secs-a.secs).slice(0,8),mx=Math.max(1,...t.map(u=>u.secs));return t.length?`<div class="oi-hbs">${t.map(u=>`<div class="oi-hb"><span class="oi-hl" title="${esc(u.username)}">${esc(u.username)}</span><span class="oi-ht"><i style="width:${u.secs/mx*100}%;background:var(--role-${({super_admin:'sa',graphic_designer:'gd',media_buyer:'mb',content_creator:'cc',moderator:'mo',pr:'pr',ecommerce:'ec',ceo:'ceo'})[u.role]||'sa'})"></i></span><span class="oi-hv">${actDur(u.secs)}</span></div>`).join('')}</div>`:'<p class="muted">No time recorded yet.</p>'})())}</div>`;
  const rows=d.users.map(u=>{
    const top=u.pages[0],dev=Object.entries(u.devices).sort((a,b)=>b[1]-a[1])[0],open=false;
    const st=u.online?'<span class="act-dot on"></span>Online':u.lastSeen?`<span class="act-dot"></span>${actAgo(u.lastSeen)}`:'<span class="act-dot off"></span>Never opened';
    return `<tr class="actrow${open?' open':''}" data-act="act-open" data-id="${u.id}" tabindex="0"><td><b>${esc(u.username)}</b> ${roleChip(u.role)}</td><td>${st}</td><td class="num">${u.logins}</td><td class="num">${u.visits}</td><td class="num">${actDur(u.secs)}</td><td class="num">${u.visits?actDur(u.avgVisit):'–'}</td><td class="num">${u.activeDays}</td><td>${top?esc(actPage(top.page)):'–'}</td><td>${dev?dev[0]:'–'}</td></tr>`;
  }).join('');
  const users=`<section class="viz"><div><h3>People</h3><p class="muted">Click a person to see every page they opened, with timing.</p></div><div class="tablewrap"><table class="dt acttable"><thead><tr><th>Person</th><th>Status</th><th class="num">Sign-ins</th><th class="num">Page views</th><th class="num">Time spent</th><th class="num">Avg / visit</th><th class="num">Active days</th><th>Favourite page</th><th>Device</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  const nlog=Number(A.log),log=d.recent.slice(0,nlog);
  const logT=`<section class="viz"><div class="row" style="justify-content:space-between"><div><h3>Latest activity</h3><p class="muted">Most recent sign-ins and pages opened.</p></div><div class="seg" role="group">${['20','50','150'].map(n=>`<button type="button" class="segb${A.log===n?' on':''}" data-act="act-log" data-n="${n}">${n}</button>`).join('')}</div></div><div class="tablewrap"><table class="dt"><thead><tr><th>When</th><th>Person</th><th>What</th><th class="num">Time on page</th><th>Device</th></tr></thead><tbody>${log.map(r=>`<tr><td class="mono">${actAt(r.at)}</td><td>${esc(r.username)}</td><td>${r.kind==='login'?'<b>Signed in</b>':'Opened '+esc(actPage(r.page))}</td><td class="num">${r.kind==='login'?'–':actDur(r.secs)}</td><td>${esc(r.device)}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Nothing recorded yet.</td></tr>'}</tbody></table></div></section>`;
  L.innerHTML=head+strip+charts+users+logT+(d.truncated?'<p class="muted">Showing the most recent 30,000 events.</p>':'')+actModal(d);
}

/* ---------- events ---------- */
function arm(btn){if(btn.dataset.armed)return true;btn.dataset.armed='1';btn.classList.add('armed');const t=btn.textContent;btn.textContent='Click again to confirm';setTimeout(()=>{if(btn.isConnected){delete btn.dataset.armed;btn.classList.remove('armed');btn.textContent=t}},4000);return false}

function toggleDetail(r){const o=!r.classList.contains('open');r.classList.toggle('open',o);r.setAttribute('aria-expanded',String(o))}
document.addEventListener('click',e=>{const r=e.target.closest('[data-detail]');if(!r||e.target.closest('a,button,input,select,textarea,[data-act],.rkdetail'))return;toggleDetail(r)});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-detail]')){e.preventDefault();toggleDetail(e.target)}});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='go'){e.preventDefault();go(b.dataset.route,b.dataset.param)}
  else if(a==='side-toggle')toggleSide();
  else if(a==='pv-retry')b.dataset.k.split(',').forEach(k=>pvRun(k,true));
  else if(a==='dtab'){const t=b.dataset.t;go(t,null,t!=='dash')}
  else if(a==='dash-retry')b.dataset.k.split(',').forEach(k=>dashRun(k,true,S.dash.tok));
  else if(a==='dash-refresh')loadDash(true,false);
  else if(a==='dash-csv')dashCSV();
  else if(a==='dash-print')window.print();
  else if(a==='dx-set'){S.dash[b.dataset.k]=b.dataset.v;dashFill()}
  else if(a==='ch-toggle'){const k=b.dataset.c+':'+b.dataset.s;S.dash.off[k]=!S.dash.off[k];dashFill()}
  else if(a==='pv-refresh')loadPulse(true).then(()=>{});
  else if(a==='act-days'){S.act.days=Number(b.dataset.n);S.act.data=null;loadAct()}
  else if(a==='act-refresh'){S.act.data=null;loadAct()}
  else if(a==='act-open'){S.act.open=b.dataset.id;renderAct()}
  else if(a==='act-close'){S.act.open='';renderAct()}
  else if(a==='act-log'){S.act.log=b.dataset.n;renderAct()}
  else if(a==='theme-toggle')toggleTheme();
  else if(a==='ov-kpi'){S.ov.open=S.ov.open===b.dataset.k?'':b.dataset.k;S.ov.q='';S.ov.f='';S.ov.who='';S.ov.d='';S.ov.sk='';ovRender()}
  else if(a==='ov-sort'){const i=b.dataset.i;if(String(S.ov.sk)===i)S.ov.sd=S.ov.sd==='asc'?'desc':'asc';else{S.ov.sk=i;S.ov.sd='asc'}ovRender()}
  else if(a==='ov-export'){const L=S.ovLast;if(!L)return;const csv=[L.head,...L.rows].map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n'),a2=document.createElement('a');a2.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'}));a2.download='overview-'+L.name+'.csv';a2.click();setTimeout(()=>URL.revokeObjectURL(a2.href),2000)}
  else if(a==='ov-clear-sub'){S.ov.q='';S.ov.f='';S.ov.who='';S.ov.d='';S.ov.sk='';ovRender()}
  else if(a==='ov-reset'){S.ov.role='';S.ov.period='all';ovRender()}
  else if(a==='ov-tab'){const id=b.dataset.sec,el=document.getElementById(id);if(!el)return;ovLock=Date.now()+900;ovMark(id);ovSetHash(id);el.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})}
  else if(a==='logout')logout();
  else if(a==='shop-sync')runSync();
  else if(a==='ev-reload')loadEval();
  else if(a==='ev-csv')evCsv();
  else if(a==='ev-open'){const id=b.dataset.id;S.ev.open.has(id)?S.ev.open.delete(id):S.ev.open.add(id);renderEval(true)}
  else if(a==='ev-quick'){const i=b.closest('.rate').querySelector('.ev-rate');i.value=b.dataset.v;i.focus()}
  else if(a==='ev-save-speed'){const i=b.parentElement.querySelector('.ev-speed');evPost({action:'speed',instructionId:i.dataset.ins,userId:i.dataset.user,score:i.value===''?null:i.value},'Speed saved')}
  else if(a==='ev-save-rate'){const i=b.parentElement.querySelector('.ev-rate');evPost({action:'rate',submissionId:i.dataset.id,rating:i.value===''?null:i.value},'Accuracy saved')}
  else if(a==='ev-save-beh'){const tr=b.closest('.behrow'),sc=tr.querySelector('.ev-beh'),nt=tr.querySelector('.ev-note');evPost({action:'behaviour',month:S.ev.month,userId:sc.dataset.user,score:sc.value===''?null:sc.value,note:nt.value},'Behaviour saved')}
  else if(a==='shop-reload')loadShop();
  else if(a==='shop-month'||a==='od-month'||a==='meta-month'){const [y,m]=b.dataset.m.split('-').map(Number);if(perMonth(y,m))perReload()}
  else if(a==='per-mode'){const md=b.dataset.mode,P=S.per,t=todayStr(),e=P.to||t,y=+e.slice(0,4),m=+e.slice(5,7);
    if(md==='day')perSet('day',e,e);else if(md==='month')perMonth(y,m);else if(md==='quarter')perQuarter(y,Math.floor((m-1)/3)+1);else{P.mode='custom'}
    perReload()}
  else if(a==='note-all'){await markRead(unreadNotes().map(c=>c.id));update()}
  else if(a==='open-note'){
    const c=S.comments.find(x=>x.id===b.dataset.id);if(!c)return;const sub=S.subs.find(x=>x.id===c.submissionId);
    markRead([c.id]);if(!sub){toast('That task was deleted');update();return}
    S.thr[sub.id]=true;if(sub.instructionId)go('ins',sub.instructionId);else go(isAdmin()?'content':'uploads');update();
    setTimeout(()=>{const el=document.getElementById('sub-'+sub.id);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),2500)}},80);
  }
  else if(a==='thr'){S.thr[b.dataset.id]=!S.thr[b.dataset.id];update()}
  else if(a==='am-open'){S.amend=b.dataset.id;update()}
  else if(a==='am-cancel'){delete S.draft['am-'+S.amend];S.amend=null;update()}
  else if(a==='am-save'){
    const id=b.dataset.id,err=$('#am-e-'+id),note=$('#am-n-'+id).value.trim(),inp=document.querySelector('[data-amfile="'+id+'"]'),files=[...(inp.files||[])];
    const bad=files.filter(f=>{const t=TYPES[(f.name.split('.').pop()||'').toLowerCase()];return !t||f.size>(t==='image/svg+xml'?2:20)*1048576});
    if(bad.length){err.textContent='Not supported or too large: '+bad.map(f=>f.name).join(', ');return}
    b.disabled=true;const done=[];
    try{
      for(let i=0;i<files.length;i++){b.textContent=`Uploading ${i+1} of ${files.length}…`;const f=files[i],type=TYPES[(f.name.split('.').pop()||'').toLowerCase()];const r=await upload(f.name,f,{access:'public',handleUploadUrl:'/api/upload',contentType:type});done.push({url:r.url,name:f.name,type,size:f.size})}
      await api('PUT','/api/submissions',{id,note,addFiles:done});
      delete S.draft['am-'+id];S.amend=null;S.lastJson='';await sync();update();toast('Task amended. The old version is kept in the history.');
    }catch(x){err.textContent=x.message||'Could not save. Try again.';b.disabled=false;b.textContent='Save changes'}
  }
  else if(a==='rep-stat'){const box=b.closest('.repin'),k=b.dataset.k,det=box.querySelector('.repdet[data-k="'+k+'"]'),was=det&&!det.hidden;
    box.querySelectorAll('.repdet').forEach(d=>d.hidden=true);box.querySelectorAll('.rs').forEach(x=>{x.classList.remove('on');x.setAttribute('aria-expanded','false')});
    if(det&&!was){det.hidden=false;b.classList.add('on');b.setAttribute('aria-expanded','true');box.querySelectorAll('.rs[data-k="'+(k==='invoices'?'invoices':k)+'"]').forEach(x=>x.classList.add('on'))}}
  else if(a==='see-more'){S.more[b.dataset.id]=!S.more[b.dataset.id];S.route==='meta'?renderMeta():S.route==='odoo'?renderOdoo():renderShop()}
  else if(a==='od-tab'){S.od.tab=b.dataset.tab;(S.od.last=S.od.last||{})[odGroup(S.od.tab)[0]]=S.od.tab;S.od.err='';loadOdoo()}
  else if(a==='od-refresh')loadOdoo(undefined,true);
  else if(a==='meta-tab'){S.meta.tab=b.dataset.tab;S.meta.err='';loadMeta()}
  else if(a==='meta-refresh')loadMeta(undefined,true);
  else if(a==='meta-toggle'){if(S.meta.busy||!arm(b))return;await metaWrite({action:'status',id:b.dataset.id,status:b.dataset.to},b.dataset.to==='PAUSED'?'Campaign paused':'Campaign resumed')}
  else if(a==='meta-budget'){if(S.meta.busy)return;const i=document.querySelector('.mbud[data-id="'+b.dataset.id+'"]');if(!i||!(Number(i.value)>0)){toast('Enter a daily budget above zero');return}if(!arm(b))return;await metaWrite({action:'budget',id:b.dataset.id,amount:Number(i.value)},'Daily budget saved')}
  else if(a==='ov-seg'){S.shop[b.dataset.k]=b.dataset.v;const y=window.scrollY;renderShop();window.scrollTo(0,y)}
  else if(a==='sheet-save'){const t=(document.getElementById('sheet-text')||{}).value||'';if(!t.trim()){toast('Paste the sheet first');return}sheetSend(parseDelim(t))}
  else if(a==='sheet-clear'){if(!confirm('Remove the saved courier sheet? Profit will go back to the Shopify figures.'))return;api('POST','/api/analytics',{action:'sheet',clear:true}).then(()=>{Object.keys(S.an.cache).forEach(k=>{if(k.startsWith('profit|'))delete S.an.cache[k]});loadAn(true)}).catch(x=>toast(x.message))}
  else if(a==='an-tab'){S.an.tab=b.dataset.tab;S.an.err='';if(S.an.tab==='overview'){if(!S.shop.data)loadShop();else renderShop()}else loadAn()}
  else if(a==='an-refresh')loadAn(true);
  else if(a==='sel-file'){b.checked?S.sel.add(b.dataset.url):S.sel.delete(b.dataset.url);syncChecks()}
  else if(a==='sel-sub'){const s=S.subs.find(x=>x.id===b.dataset.id);if(s){const urls=(s.files||[]).map(f=>f.url);const allOn=urls.every(u=>S.sel.has(u));urls.forEach(u=>allOn?S.sel.delete(u):S.sel.add(u));syncChecks()}}
  else if(a==='sel-page'){document.querySelectorAll('input[data-act="sel-file"]').forEach(c=>S.sel.add(c.dataset.url));syncChecks()}
  else if(a==='sel-clear'){S.sel.clear();syncChecks()}
  else if(a==='dl-zip')downloadSelected();
  else if(a==='unpick'){S.picked[b.dataset.kind].splice(+b.dataset.i,1);renderPicked(b.dataset.kind)}
  else if(a==='pick-role'){b.checked?S.sendRoles.add(b.value):S.sendRoles.delete(b.value);updateSendCount()}
  else if(a==='pick-user'){b.checked?S.sendUsers.add(b.value):S.sendUsers.delete(b.value);updateSendCount()}
  else if(a==='pw-open'){S.pwOpen=b.dataset.id;update();$('#pw-'+b.dataset.id)?.focus()}
  else if(a==='pw-close'){S.pwOpen=null;update()}
  else if(a==='del-user'){if(!arm(b))return;try{await api('DELETE','/api/users?id='+encodeURIComponent(b.dataset.id));await sync();toast('User removed')}catch(x){toast(x.message||'Could not remove the user')}}
  else if(a==='del-ins'){if(!arm(b))return;try{await api('DELETE','/api/instructions?id='+encodeURIComponent(b.dataset.id));await sync();toast('Instruction deleted');go('send')}catch(x){toast(x.message||'Could not delete')}}
  else if(a==='del-sub'){if(!arm(b))return;try{await api('DELETE','/api/submissions?id='+encodeURIComponent(b.dataset.id));await sync();toast('Deleted')}catch(x){toast(x.message||'Could not delete')}}
});
document.addEventListener('submit',async e=>{
  if(e.target.id==='ev-settings'){e.preventDefault();const f=new FormData(e.target);evPost({action:'settings',weights:{speed:f.get('speed'),accuracy:f.get('accuracy'),behaviour:f.get('behaviour')}},'Weights saved');return}
  if(e.target.id!=='an-manual')return;e.preventDefault();
  const values={};new FormData(e.target).forEach((v,k)=>{values[k]=v});
  S.an.saving=true;renderShop();
  try{await api('POST','/api/analytics',{month:S.an.data&&S.an.data.month,values});Object.keys(S.an.cache).forEach(k=>{if(k.startsWith('experience|'))delete S.an.cache[k]});S.an.saving=false;toast('Saved');await loadAn(false)}
  catch(x){S.an.saving=false;toast(x.message||'Could not save');renderShop()}
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter')return;const el=e.target;if(!el.matches||!el.matches('.ev-speed,.ev-rate,.ev-beh,.ev-note'))return;
  e.preventDefault();const host=el.closest('.rline,.rate,.behrow');const btn=host&&host.querySelector('[data-act^="ev-save"]');if(btn)btn.click();
});
document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.id==='sheet-file'&&t.files&&t.files[0]){const f=t.files[0];try{const rows=/\.xlsx$/i.test(f.name)?parseXlsx(await f.arrayBuffer()):parseDelim(await f.text());t.value='';sheetSend(rows)}catch(x){toast(x.message||'Could not read that file')}return}
  if(t.matches('input[type=file]')){addFiles(t.dataset.kind,[...t.files]);t.value=''}
  else if(t.id==='mc-m'||t.id==='mc-y'){if(t.id==='mc-m')S.mc.key=t.value;else{const k=S.mc.keys.filter(k=>k.startsWith(t.value)).sort();const cur=(S.mc.key||perMonthSel()||'').slice(5);S.mc.key=k.find(x=>x.slice(5)===cur)||k[k.length-1]||S.mc.key}S.route==='odoo'?renderOdoo():renderShop()}
  else if(t.id&&t.id.startsWith('per-')){if((t.id==='per-q'||t.id==='per-y')&&S.per.mode==='quarter'){const q=+(document.getElementById('per-q').value),y=+(document.getElementById('per-y').value);if(!perQuarter(y,q)){toast('That quarter has not started yet');perRender();return}perReload()}else perChange(t)}
  else if(t.id==='ev-month'){loadEval(t.value)}
  else if(t.id==='shop-metric'){S.shop.metric=t.value;renderShop()}
  else if(t.dataset.act==='an-metric'){S.an.metric[t.dataset.id]=t.value;S.route==='meta'?renderMeta():S.route==='odoo'?renderOdoo():renderShop()}
  else if(t.id==='f-role'){S.fRole=t.value;update()}
  else if(t.id==='f-user'){S.fUser=t.value;update()}
  else if(t.id==='f-kind'){S.fKind=t.value;update()}
  else if(t.dataset.act==='set-role'){const u=userById(t.dataset.id);try{await api('PATCH','/api/users',{id:t.dataset.id,role:t.value});await sync();toast(`${u.username} is now ${ROLE[t.value].label}`)}catch(x){toast(x.message||'Could not change the role');update()}}
});
['dragover','dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{const d=e.target.closest&&e.target.closest('.drop');if(!d)return;e.preventDefault();
  if(ev==='dragover')d.classList.add('over');else d.classList.remove('over');
  if(ev==='drop'&&S.assets)addFiles(d.id.replace('drop-',''),[...e.dataTransfer.files])}));
document.addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.closest('.thumb')?.classList.add('broken')},true);

document.addEventListener('input',e=>{const t=e.target;if(t&&t.dataset&&t.dataset.dxq&&S.route==='dash'){S.dash[t.dataset.dxq]=t.value;const L=document.getElementById('dx-prods');if(L)L.innerHTML=dProdList();return}if(t&&t.dataset&&t.dataset.dx&&S.route==='dash'){S.dash[t.dataset.dx]=t.type==='checkbox'?t.checked:t.value;dashFill();return}if(t.dataset&&t.dataset.draft)S.draft[t.dataset.draft]=t.value});
document.addEventListener('submit',async e=>{
  const f=e.target.closest('[data-form]');if(!f)return;e.preventDefault();const k=f.dataset.form;
  if(k==='rep-target'){const amount=Number(new FormData(f).get('amount')||0);api('POST','/api/odoo',{action:'target',rep:f.dataset.rep,amount}).then(()=>{S.od.cache={};toast(amount?'Target saved':'Target removed');loadOdoo(undefined,true)}).catch(x=>toast(x.message||'Could not save'));return}
  if(k==='setup'){
    const u=$('#su-u').value.trim().replace(/\s+/g,' '),p=$('#su-p').value,p2=$('#su-p2').value,err=$('#su-err');
    if(!validName(u))return err.textContent='Use 2 to 40 characters.';
    if(p.length<4)return err.textContent='Use at least 4 characters.';
    if(p!==p2)return err.textContent='The passwords do not match.';
    err.textContent='';
    try{await api('POST','/api/auth?action=setup',{username:u,password:p});S.lastJson='';S.route='hub';await sync()}catch(x){err.textContent=x.message}
  }
  else if(k==='login'){
    const u=$('#li-u').value.trim().replace(/\s+/g,' '),p=$('#li-p').value,err=$('#li-err');
    err.textContent='';
    try{await api('POST','/api/auth?action=login',{username:u,password:p});S.lastJson='';S.route='hub';await sync()}catch(x){err.textContent=x.message}
  }
  else if(k==='cmt'){
    const id=f.dataset.id,t=f.querySelector('textarea'),body=t.value.trim();if(!body)return;
    try{await api('POST','/api/submissions',{action:'comment',submissionId:id,body});delete S.draft['cm-'+id];S.lastJson='';await sync();update()}
    catch(x){toast(x.message||'Could not send')}
  }
  else if(k==='send'){
    const title=$('#in-t').value.trim(),body=$('#in-b').value.trim(),err=$('#in-err');
    if(!S.sendRoles.size&&!S.sendUsers.size)return err.textContent='Choose at least one role or person.';
    try{await api('POST','/api/instructions',{title,body,roles:[...S.sendRoles],userIds:[...S.sendUsers]});await sync();
      S.sendRoles.clear();S.sendUsers.clear();$('#in-t').value='';$('#in-b').value='';err.textContent='';f.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=false);updateSendCount();toast('Instruction sent')}
    catch(x){err.textContent=x.message||'Could not send. Try again.'}
  }
  else if(k==='adduser'){
    const u=$('#nu-u').value.trim().replace(/\s+/g,' '),p=$('#nu-p').value,role=$('#nu-r').value,err=$('#nu-err');
    if(!validName(u))return err.textContent='Use 2 to 40 characters.';
    if(S.users.some(x=>x.usernameLower===u.toLowerCase()))return err.textContent='That username is taken.';
    if(p.length<4)return err.textContent='Use at least 4 characters.';
    try{await api('POST','/api/users',{username:u,password:p,role});await sync();
      $('#nu-u').value='';$('#nu-p').value='';err.textContent='';toast(`Added ${u} as ${ROLE[role].label}`)}catch(x){err.textContent=x.message||'Could not add the user.'}
  }
  else if(k==='pw'){
    const id=f.dataset.id,p=$('#pw-'+id).value,u=userById(id);
    if(p.length<4)return toast('Use at least 4 characters.');
    try{await api('PATCH','/api/users',{id,password:p});
      S.pwOpen=null;await sync();update();toast(`Password changed for ${u.username}`)}catch(x){toast(x.message||'Could not change the password')}
  }
  else if(k==='up-resp')submitUpload('resp');
  else if(k==='up-free')submitUpload('free');
});

(function(){try{let h=location.hash.slice(1);if(h.startsWith('home:')){S.ovSec=S.ovPending=h.slice(5);h='home'}if(h.startsWith('ins-')){S.route='ins';S.param=h.slice(4)}else if(['hub','dash','home','uploads','notes','team','send','content','users','shop','eval','odoo','meta'].includes(h))S.route=h}catch(e){}})();
boot();

/* Side charts (pies and bar panels) can be dragged out of the way. Position is remembered while the page is open; double-click the title to put it back. */
(function(){
  const pos={};let drag=null;
  const keyOf=v=>{const s=v.closest('section,.panel,.an-sec,[data-sec]'),h=s&&s.querySelector('h2,h3');const t=v.querySelector('.viz-t');return [S.route,S.route==='odoo'?S.od.tab:S.route==='meta'?S.meta.tab:S.an.tab,h?h.textContent.trim():'',t?t.textContent.trim():''].join('|')};
  const apply=v=>{if(v.dataset.mv)return;v.dataset.mv='1';const t=v.querySelector('.viz-t');if(t)t.title='Drag to move · double-click to put back';const p=pos[keyOf(v)];if(p)v.style.transform=`translate(${p[0]}px,${p[1]}px)`};
  const scan=()=>document.querySelectorAll('aside.viz:not([data-mv])').forEach(apply);
  let q=0;new MutationObserver(()=>{if(!q)q=requestAnimationFrame(()=>{q=0;scan()})}).observe(document.body,{childList:true,subtree:true});scan();
  document.addEventListener('pointerdown',e=>{const t=e.target.closest&&e.target.closest('aside.viz .viz-t');if(!t||e.button>0)return;const v=t.closest('.viz'),k=keyOf(v),p=pos[k]||[0,0];drag={v,k,x:e.clientX-p[0],y:e.clientY-p[1]};v.classList.add('dragging');try{t.setPointerCapture(e.pointerId)}catch(x){}e.preventDefault()});
  document.addEventListener('pointermove',e=>{if(!drag)return;const p=[e.clientX-drag.x,e.clientY-drag.y];pos[drag.k]=p;drag.v.style.transform=`translate(${p[0]}px,${p[1]}px)`});
  const end=()=>{if(drag){drag.v.classList.remove('dragging');drag=null}};
  document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
  document.addEventListener('dblclick',e=>{const t=e.target.closest&&e.target.closest('aside.viz .viz-t');if(!t)return;const v=t.closest('.viz');delete pos[keyOf(v)];v.style.transform=''});
})();

document.addEventListener('change',e=>{const t=e.target;if(t&&t.dataset&&t.dataset.ov&&S.route==='home'&&isAdmin()){S.ov[t.dataset.ov]=t.value;ovRender()}});

function ovRefreshTable(keepFocus){
  const box=document.querySelector('.ovdet');if(!box||!S.ov.open)return;
  const c=ovCtx(),tmp=document.createElement('div');tmp.innerHTML=ovDetail(S.ov.open,c.team,c.ins,c.subs);
  const nt=tmp.querySelector('.ovtbl'),ot=box.querySelector('.ovtbl');if(ot&&nt)ot.innerHTML=nt.innerHTML;
  const cn=tmp.querySelector('.ovcount'),oc=box.querySelector('.ovcount');if(oc&&cn)oc.textContent=cn.textContent;
  const ct=tmp.querySelector('.ovtool'),ot2=box.querySelector('.ovtool');
  const had=!!ot2.querySelector('[data-act=ov-clear-sub]'),has=!!ct.querySelector('[data-act=ov-clear-sub]');
  if(had!==has){if(has)ot2.insertAdjacentHTML('beforeend','<button class="btn sm ghost" data-act="ov-clear-sub">Clear all</button>');else ot2.querySelector('[data-act=ov-clear-sub]').remove()}
}
document.addEventListener('input',e=>{const t=e.target;if(t&&t.dataset&&t.dataset.ovq&&S.route==='home'){S.ov.q=t.value;ovRefreshTable()}});
document.addEventListener('change',e=>{const t=e.target;if(!t||!t.dataset||S.route!=='home')return;if(t.dataset.ovf){S.ov.f=t.value;ovRefreshTable()}else if(t.dataset.ovw){S.ov.who=t.value;ovRefreshTable()}else if(t.dataset.ovd){S.ov.d=t.value;ovRefreshTable()}});
