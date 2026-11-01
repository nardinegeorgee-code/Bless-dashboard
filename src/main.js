import { upload } from '@vercel/blob/client';
import { zipSync } from 'fflate';
import './style.css';

const ROLES=[
  {key:'super_admin',label:'Super Admin',tok:'--role-sa'},
  {key:'graphic_designer',label:'Graphic Designer',tok:'--role-gd'},
  {key:'media_buyer',label:'Media Buyer',tok:'--role-mb'},
  {key:'content_creator',label:'Content Creator',tok:'--role-cc'},
  {key:'moderator',label:'Moderator',tok:'--role-mo'},
  {key:'pr',label:'PR',tok:'--role-pr'},
  {key:'ecommerce',label:'E-Commerce',tok:'--role-ec'},
];
const ROLE=Object.fromEntries(ROLES.map(r=>[r.key,r]));
const TYPES={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',mp4:'video/mp4',webm:'video/webm',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',md:'text/markdown',json:'application/json'};

const S={shop:{month:'',metric:'revenue',best:'units',geo:'countries',data:null,loading:false,err:'',syncing:false,syncMsg:''},sel:new Set(),assets:true,lastJson:'',users:[],instructions:[],subs:[],usersReady:false,screen:null,me:null,route:'home',param:null,
  sendRoles:new Set(),sendUsers:new Set(),fRole:'',fUser:'',fKind:'',pwOpen:null,picked:{}};

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
const isAdmin=()=>S.me&&S.me.role==='super_admin';
const roleChip=k=>{const r=ROLE[k]||{label:k,tok:'--muted'};return `<span class="chip" style="--rc:var(${r.tok})">${esc(r.label)}</span>`};
const fmtDate=ms=>{if(!ms)return'';const d=new Date(ms);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+', '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})};
const fmtSize=b=>b<1024?b+' B':b<1048576?(b/1024).toFixed(0)+' KB':(b/1048576).toFixed(1)+' MB';
const userById=id=>S.users.find(u=>u.id===id);
let toastT;function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,3200)}

/* ---------- data ---------- */
async function api(method,url,body){
  let r;
  try{r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,credentials:'same-origin'})}
  catch(e){throw new Error('Cannot reach the server. Check your connection.')}
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
  S.users=j.users;S.instructions=j.instructions;S.subs=j.submissions;S.speeds=j.speeds||[];S.usersReady=true;
  const roleChanged=!S.me||S.me.role!==j.me.role||S.me.id!==j.me.id;
  const wasNull=!S.me;S.me=j.me;
  if(wasNull||roleChanged){if(roleChanged&&!wasNull){S.route='home';S.param=null}showApp()}
  else if(S.screen==='app')update();
}
async function sync(){try{await refresh()}catch(e){if(S.screen==='boot')fatal(e.message)}}
async function boot(){
  S.screen='boot';
  await sync();
  setInterval(()=>{if(!document.hidden&&S.screen!=='boot')sync()},8000);
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
function navItems(){
  if(isAdmin())return [['home','Overview'],['send','Send instruction'],['content','All content'],['eval','Evaluation'],['shop','Shopify'],['odoo','Odoo'],['meta','Meta Ads'],['team','Team by role'],['users','Users']];
  const pending=myInstructions().filter(i=>!responded(i.id)).length;
  return [['home','Instructions',pending],['uploads','My uploads'],['team','Team by role']];
}
function showApp(){
  S.screen='app';
  $('#app').innerHTML=`<div class="shell"><aside class="side">${brandHTML}<nav class="nav" id="nav" aria-label="Pages"></nav>
    <div class="me"><div class="who"><b>${esc(S.me.username)}</b>${roleChip(S.me.role)}</div><button class="btn sm" data-act="logout">Sign out</button></div></aside>
    <main class="main"><div class="wrap" id="view"></div></main></div>`;
  mount();
}
function renderNav(){
  $('#nav').innerHTML=navItems().map(([k,l,c])=>`<button data-act="go" data-route="${k}" ${S.route===k||(S.route==='ins'&&k===(isAdmin()?'send':'home'))?'aria-current="page"':''}><span>${l}</span>${c?`<span class="count">${c}</span>`:''}</button>`).join('');
}
function go(route,param){S.route=route;S.param=param||null;mount();window.scrollTo(0,0);try{history.replaceState(null,'','#'+(route==='ins'?'ins-'+param:route))}catch(e){}}

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
  if(!isAdmin()&&['send','content','users','shop','eval','odoo','meta'].includes(r)){S.route='home'}
  if(S.route==='home')v.innerHTML=isAdmin()?`<div id="live"></div>`
    :`<div class="head"><div><h1>Instructions</h1><p>Briefs from your Super Admin. Open one to send back your files.</p></div><button class="btn" data-act="go" data-route="uploads">Upload without an instruction</button></div><div id="live"></div>`;
  else if(S.route==='ins')v.innerHTML=`<button class="btn ghost back" data-act="go" data-route="${isAdmin()?'send':'home'}">← Back</button><div id="live"></div>${isAdmin()?'':`<div class="panel"><div><h2>Respond</h2><p class="muted">Attach your files and add a note if needed.</p></div>${uploadForm('resp')}</div>`}<div id="live2"></div>`;
  else if(S.route==='uploads')v.innerHTML=`<div class="head"><div><h1>My uploads</h1><p>Everything you have sent. Add files here even when there is no instruction.</p></div></div><div class="panel"><h2>Upload files</h2>${uploadForm('free')}</div><div id="live"></div>`;
  else if(S.route==='team')v.innerHTML=`<div class="head"><div><h1>Team by role</h1><p>Every username, grouped by role.</p></div></div><div id="live"></div>`;
  else if(S.route==='send')v.innerHTML=`<div class="head"><div><h1>Send instruction</h1><p>Write the brief, then choose whole roles, specific people, or both.</p></div></div>
    <form class="panel" data-form="send">
      <div class="field"><label for="in-t">Title</label><input class="input" id="in-t" maxlength="120" placeholder="Do the post for Friday's offer" required></div>
      <div class="field"><label for="in-b">Instructions</label><textarea class="textarea" id="in-b" placeholder="Sizes, copy, deadline, references…" required></textarea></div>
      <div class="field"><label>Send to roles</label><div class="checks" id="in-roles">${ROLES.filter(r=>r.key!=='super_admin').map(r=>`<label class="check"><input type="checkbox" id="role-${r.key}" value="${r.key}" data-act="pick-role" ${S.sendRoles.has(r.key)?'checked':''}>${roleChip(r.key)}</label>`).join('')}</div></div>
      <div class="field"><label>Or send to specific people</label><div id="in-people"></div></div>
      <div class="row" style="justify-content:space-between"><span class="muted" id="in-count"></span><button class="btn primary" type="submit">Send instruction</button></div>
      <div class="err" id="in-err"></div>
    </form><div id="live"></div>`;
  else if(S.route==='content')v.innerHTML=`<div class="head"><div><h1>All content</h1><p>Every file and note your team has added.</p></div></div>
    <div class="row"><select class="select" id="f-role" style="width:auto" aria-label="Filter by role"><option value="">All roles</option>${ROLES.filter(r=>r.key!=='super_admin').map(r=>`<option value="${r.key}" ${S.fRole===r.key?'selected':''}>${r.label}</option>`).join('')}</select>
    <select class="select" id="f-user" style="width:auto" aria-label="Filter by person"></select>
    <select class="select" id="f-kind" style="width:auto" aria-label="Filter by type"><option value="">Responses and uploads</option><option value="resp" ${S.fKind==='resp'?'selected':''}>Responses to instructions</option><option value="free" ${S.fKind==='free'?'selected':''}>Uploads without instruction</option></select></div><div id="live"></div>`;
  else if(S.route==='eval'){v.innerHTML=`<div class="head"><div><h1>Team evaluation</h1><p>Monthly KPIs and ranking. You enter the speed and accuracy percentages; HR gives behaviour once a month.</p></div></div><div id="live"></div>`;if(!S.ev.data&&!S.ev.loading)loadEval();else renderEval(true)}
  else if(S.route==='odoo'){v.innerHTML=`<div class="head"><div><h1>Odoo</h1><p>Stock, sales, accounting and your team, read live from Odoo.</p></div></div><div id="live"></div>`;if(!S.od.cache[S.od.tab+'|'+(S.od.month||'')]&&!S.od.loading)loadOdoo();else renderOdoo()}
  else if(S.route==='meta'){v.innerHTML=`<div class="head"><div><h1>Meta Ads</h1><p>Facebook and Instagram advertising, read live from Meta. Pause campaigns and change budgets from here.</p></div></div><div id="live"></div>`;if(!S.meta.cache[S.meta.tab+'|'+(S.meta.month||'')]&&!S.meta.loading)loadMeta();else renderMeta()}
  else if(S.route==='shop'){v.innerHTML=`<div class="head"><div><h1>Shopify</h1><p>Sales, funnel, products, customer experience and retention, one tab each.</p></div></div><div id="live"></div>`;if(S.an.tab==='overview'){if(!S.shop.data&&!S.shop.loading)loadShop()}else loadAn();}
  else if(S.route==='users')v.innerHTML=`<div class="head"><div><h1>Users</h1><p>Add people, change their role, or set a new password.</p></div></div>
    <form class="panel" data-form="adduser"><h2>Add a user</h2><div class="grid2">
      <div class="field"><label for="nu-u">Username</label><input class="input" id="nu-u" autocomplete="off" required></div>
      <div class="field"><label for="nu-p">Password</label><input class="input" id="nu-p" type="text" autocomplete="off" minlength="4" required></div>
      <div class="field"><label for="nu-r">Role</label><select class="select" id="nu-r">${ROLES.map(r=>`<option value="${r.key}" ${r.key==='graphic_designer'?'selected':''}>${r.label}</option>`).join('')}</select></div></div>
      <div class="row" style="justify-content:space-between"><span class="err" id="nu-err"></span><button class="btn primary" type="submit">Add user</button></div></form><div id="live"></div>`;
  update();
}

function update(){
  if(S.screen!=='app')return;renderNav();
  const L=$('#live');if(!L)return;const r=S.route;
  if(r==='home'&&isAdmin())L.innerHTML=overviewHTML();
  else if(r==='home')L.innerHTML=inboxHTML();
  else if(r==='ins')updateIns();
  else if(r==='uploads')L.innerHTML=listOrEmpty(S.subs.filter(s=>s.userId===S.me.id),'Nothing uploaded yet','Files you upload, with or without an instruction, appear here.');
  else if(r==='team')L.innerHTML=teamHTML();
  else if(r==='send')updateSend();
  else if(r==='content')updateContent();
  else if(r==='users')L.innerHTML=usersHTML();
  else if(r==='shop')renderShop();
  else if(r==='odoo')renderOdoo();
  else if(r==='meta')renderMeta();
  else if(r==='eval')renderEval();
  syncUploadAvail();renderSelBar();
}

function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening'}
function overviewHTML(){
  const team=S.users.filter(u=>u.role!=='super_admin');
  let open=0,total=0;S.instructions.forEach(i=>recipients(i).forEach(u=>{total++;if(!responded(i.id,u.id))open++}));
  const answered=total-open,rate=total?Math.round(answered/total*100):0;
  const files=S.subs.reduce((n,s)=>n+(s.files||[]).length,0);
  const today=new Date().toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'});
  const hero=`<section class="hero"><div class="hero-top"><div><span class="eyebrow">${esc(today)}</span><div class="hero-n sm">${greeting()}, ${esc(S.me.username)}</div>
    <p class="hero-sub">${open?`<b>${open}</b> response${open===1?'':'s'} still waiting from your team.`:(S.instructions.length?'Everyone has responded. Nothing is waiting on you.':'Send your first instruction to get the team moving.')}</p></div>
    <div class="hero-actions"><button class="btn dark" data-act="go" data-route="send">New instruction</button><button class="btn light" data-act="go" data-route="content">All content</button><button class="btn light" data-act="go" data-route="shop">Shopify</button></div></div></section>`;
  const kpi=(k,c,l,v,sub)=>`<div class="kcard" style="--kc:${c}">${ico(k,c)}<div><span class="eyebrow">${l}</span><div class="kn">${v}</div><small class="muted">${sub}</small></div></div>`;
  const kpis=`<div class="kgrid">${kpi('users','#7B4FA0','Team members',team.length,ROLES.filter(r=>r.key!=='super_admin'&&S.users.some(u=>u.role===r.key)).length+' roles in use')}
    ${kpi('send','#F28D3A','Instructions sent',S.instructions.length,'briefs to the team')}
    ${kpi('clock',open?'#C2410C':'#2C7A4B','Awaiting response',open,open?'across '+S.instructions.filter(i=>recipients(i).some(u=>!responded(i.id,u.id))).length+' instructions':'all caught up')}
    ${kpi('file','#0F766E','Files received',files,S.subs.length+' submissions')}</div>`;
  const maxR=Math.max(1,...ROLES.map(r=>S.users.filter(u=>u.role===r.key&&u.role!=='super_admin').length));
  const roles=ROLES.filter(r=>r.key!=='super_admin').map(r=>{const n=S.users.filter(u=>u.role===r.key).length;return `<div class="rolebar"><span class="rdot" style="background:var(${r.tok})"></span><span class="rl">${r.label}</span><span class="rbar"><i style="width:${Math.max(n?6:0,n/maxR*100)}%;background:var(${r.tok})"></i></span><b class="mono">${n}</b></div>`}).join('');
  const side=`<div class="two"><section class="panel"><h2>Team response rate</h2>${total?`<div class="cust">${donut([{v:answered,c:'#F28D3A'},{v:open,c:'#CBB7D8'}],rate+'%','responded')}<div class="legend"><div><i style="background:#F28D3A"></i><b>${answered}</b> responses received</div><div><i style="background:#CBB7D8"></i><b>${open}</b> still waiting</div><p class="muted" style="font-size:.82rem;margin:6px 0 0">Counted across every person each instruction was sent to.</p></div></div>`:'<p class="muted">Send an instruction to start tracking responses.</p>'}</section>
    <section class="panel"><div class="item-top"><h2>Your team</h2><button class="btn sm" data-act="go" data-route="team">View all</button></div>${team.length?`<div class="rolebars">${roles}</div>`:'<p class="muted">Add team members on the Users page.</p>'}</section></div>`;
  const waiting=S.instructions.map(i=>({i,w:recipients(i).filter(u=>!responded(i.id,u.id))})).filter(x=>x.w.length).sort((x,y)=>y.w.length-x.w.length).slice(0,4);
  const attn=waiting.length?`<section class="panel"><div><h2>Needs a nudge</h2><p class="muted">Instructions with the most people still to respond.</p></div><div class="attn">${waiting.map(({i,w})=>`<button class="arow" data-act="go" data-route="ins" data-param="${i.id}"><b>${esc(i.title)}</b><span class="muted">${w.slice(0,4).map(u=>esc(u.username)).join(', ')}${w.length>4?' +'+(w.length-4)+' more':''}</span><span class="pill new">${w.length} waiting</span></button>`).join('')}</div></section>`:'';
  return `<div style="display:grid;gap:18px">${hero}${kpis}${side}${attn}
    <section style="display:grid;gap:12px"><div class="item-top"><h2>Latest instructions</h2><button class="btn sm" data-act="go" data-route="send">See all</button></div>${S.instructions.length?`<div class="list">${S.instructions.slice(0,5).map(insRowAdmin).join('')}</div>`:empty('No instructions yet','Send your first brief from Send instruction.')}</section>
    <section style="display:grid;gap:12px"><div class="item-top"><h2>Latest from the team</h2><button class="btn sm" data-act="go" data-route="content">See all</button></div>${listOrEmpty(S.subs.slice(0,6),'Nothing received yet','Responses and uploads from your team land here.')}</section></div>`;
}
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
  return `<article class="item"><div class="item-top"><div class="row" style="gap:8px"><span class="mono">${esc(s.username)}</span>${roleChip(s.role)}</div><div class="row" style="gap:8px"><span class="mono muted">${fmtDate(s.createdAt)}</span>${(s.files||[]).length>1?`<button class="btn sm" data-act="sel-sub" data-id="${s.id}">Select all files</button>`:''}${canDel?`<button class="btn sm danger" data-act="del-sub" data-id="${s.id}">Delete</button>`:''}</div></div>
    ${ctx}${s.note?`<p class="body-text">${esc(s.note)}</p>`:''}
    ${isAdmin()&&s.instructionId?`<div class="rate"><span class="eyebrow">Speed</span><input class="input ev-speed" type="number" min="0" max="100" placeholder="–" data-ins="${s.instructionId}" data-user="${s.userId}" value="${(()=>{const x=(S.speeds||[]).find(z=>z.instructionId===s.instructionId&&z.userId===s.userId);return x&&x.score!==null?x.score:''})()}" aria-label="Speed percentage"><span class="muted">%</span><button class="btn sm primary" data-act="ev-save-speed">Save</button></div>`:''}
    ${isAdmin()&&s.instructionId?`<div class="rate"><span class="eyebrow">Accuracy</span><input class="input ev-rate" type="number" min="0" max="100" placeholder="–" data-id="${s.id}" value="${s.rating===null||s.rating===undefined?'':s.rating}" aria-label="Accuracy percentage"><span class="muted">%</span>${[100,75,50,0].map(v=>`<button type="button" class="btn sm" data-act="ev-quick" data-v="${v}">${v}</button>`).join('')}<button class="btn sm primary" data-act="ev-save-rate">Save</button></div>`:''}
    ${(s.files||[]).length?`<div class="files">${s.files.map(fileHTML).join('')}</div>`:''}</article>`;
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
S.per={mode:'month',from:'',to:'',cmp:'auto',cfrom:'',cto:''};
function perSet(mode,from,to){const t=todayStr();if(from>t)return false;S.per.mode=mode;S.per.from=from;S.per.to=to>t?t:to;return true}
function perMonth(y,m){return perSet('month',y+'-'+pad2(m)+'-01',y+'-'+pad2(m)+'-'+pad2(lastDay(y,m)))}
function perQuarter(y,q){const m=(q-1)*3+1;return perSet('quarter',y+'-'+pad2(m)+'-01',y+'-'+pad2(m+2)+'-'+pad2(lastDay(y,m+2)))}
(function(){const t=todayStr();perMonth(+t.slice(0,4),+t.slice(5,7))})();
function perQuery(){const p=S.per;let q='from='+p.from+'&to='+p.to;if(p.mode!=='custom')q+='&kind='+p.mode;if(p.cmp==='custom'&&p.cfrom&&p.cto)q+='&cfrom='+p.cfrom+'&cto='+p.cto;return q}
function perReload(refresh){S.route==='meta'?loadMeta(undefined,refresh):S.route==='odoo'?loadOdoo(undefined,refresh):loadShop()}
function curData(){return S.route==='meta'?S.meta.data:S.route==='odoo'?S.od.data:(S.an.tab==='overview'?S.shop.data:S.an.data)}
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
  const info=d&&d.period?`<span class="perinfo"><b>${esc(d.period.label)}</b> <span class="muted">(${d.period.days} day${d.period.days===1?'':'s'}) compared with</span> <b>${esc(d.compare.label)}</b>${d.period.clamped?' <span class="muted">· cut at today</span>':''}</span>`:'';
  return `<div class="datebar"><div class="seg" role="tablist" aria-label="Period type">${[['day','Day'],['month','Month'],['quarter','Quarter'],['custom','Custom']].map(([k,l])=>`<button class="segb${p.mode===k?' on':''}" data-act="per-mode" data-mode="${k}" aria-pressed="${p.mode===k}">${l}</button>`).join('')}</div>
  <div class="row perpick">${pick}</div>
  <div class="row perpick"><label class="muted" for="per-cmp">Compare with</label><select class="select" id="per-cmp">${opt('auto','Previous period',p.cmp)}${opt('custom','Another period…',p.cmp)}</select>${cust}</div>
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
function perRender(){S.route==='meta'?renderMeta():S.route==='odoo'?renderOdoo():renderShop()}

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
function shortNum(n){return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e4?Math.round(n/1e3)+'k':n>=1e3?(n/1e3).toFixed(1)+'k':String(Math.round(n))}
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
  const arcs=parts.map(p=>{const len=p.v/total*C,s=`<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.c}" stroke-width="16" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`;off+=len;return s}).join('');
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
  const cust=`<section class="panel"><h2>Customers</h2>${c.distinct||c.guest?`<div class="cust">${donut([{v:c.fresh,c:'#F28D3A'},{v:c.repeat,c:'#7B4FA0'}],c.repeatRate.toFixed(0)+'%','returning')}
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
const AN_TABS=[['overview','Overview'],['sales','Sales'],['profit','Profit'],['funnel','Funnel'],['products','Products'],['experience','Customer experience'],['retention','Retention']];
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
const cellText=(v,f)=>noHtml.has(f)?fv(v,f):esc(fv(v,f)).replace(/&amp;/g,'&');
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
  return `<div class="mx" data-detail tabindex="0" role="button" aria-expanded="false"><div class="mx-top"><span class="mx-l">${esc(t.label)}</span>${dp(g,t.goodDown)}</div><div class="mx-v">${esc(fv(t.value,t.fmt))}</div>${vs}${viz}${t.sub?`<div class="mx-n">${esc(t.sub)}</div>`:''}<div class="rkdetail">${tileDetail(t)}</div></div>`;
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
  const dots=dl.cur.length<=62?dl.cur.map((v,i)=>`<circle cx="${X(i,dl.cur.length).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="5" fill="transparent" stroke="none"><title>${esc(dl.dates[i])}: ${esc(fv(v,fmt))}</title></circle>`).join(''):'';
  const lo=dl.dates[0],hi=dl.dates[dl.dates.length-1];
  return `<div class="dchart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Day by day chart" preserveAspectRatio="none"><path d="${line(dl.prev||[])}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" opacity=".8"/><path d="${line(dl.cur)}" fill="none" stroke="var(--accent-text)" stroke-width="2"/>${dots}<text x="${pl}" y="${H-3}" class="dax">${esc(lo.slice(5))}</text><text x="${W-pr}" y="${H-3}" text-anchor="end" class="dax">${esc(hi.slice(5))}</text></svg>
  <div class="dleg"><span><i style="background:var(--accent-text)"></i>This period</span><span><i style="background:var(--muted)"></i>Compared period</span><span class="muted">peak ${esc(fv(Math.max(...dl.cur),fmt))}</span></div></div>`;
}
function tileDetail(t){
  const d=curData(),per=d&&d.period?d.period.label:'this period',cmp=d&&d.compare?d.compare.label:'';
  return `<div class="dl"><span>${esc(per)}</span><b class="mono">${esc(fv(t.value,t.fmt))}</b></div>${t.prev!==undefined?diffLine(cmp?'Compared with '+cmp:'Before',t.value,t.prev,t.fmt):'<p class="muted dn">No earlier figure is available for this one.</p>'}${t.sub?`<p class="muted dn">${esc(t.sub)}</p>`:''}${t.daily&&t.daily.cur&&t.daily.cur.length>1?dailyChart(t.daily,t.fmt):''}`;
}
function rowDetail(sec,r,i,barCol,total){
  const cols=sec.columns,name=cols[0];let h=(r.img?`<a class="pbig"${/^https?:/.test(r.img)?` href="${esc(r.img)}" target="_blank" rel="noopener"`:''}><img src="${esc(picUrl(r.img,640))}" ${/^https:\/\/cdn\.shopify\.com\//.test(r.img)?`srcset="${esc(picUrl(r.img,640))} 1x, ${esc(picUrl(r.img,1280))} 2x"`:''} alt="${esc(String(r.name||''))}" loading="lazy" referrerpolicy="no-referrer"></a>`:'')+`<div class="dl"><span>Rank</span><b class="mono">#${i+1} of ${sec.rows.length}</b></div>`;
  for(const c of cols.slice(1)){const v=r[c.key];if(v===null||v===undefined||v==='')continue;h+=`<div class="dl"><span>${esc(c.label)}</span><b class="mono">${cellText(v,c.fmt)}</b></div>`}
  if(barCol&&total>0){const v=Number(r[barCol.key])||0;h+=`<div class="dl"><span>Share of the ${sec.rows.length} listed</span><b class="mono">${(v/total*100).toFixed(1)}%</b></div>`}
  const gc=cols.find(c=>c.fmt==='growth'),g=gc&&r[gc.key];
  if(barCol&&typeof g==='number'&&g>-100){const v=Number(r[barCol.key])||0,prev=v/(1+g/100);h+=diffLine('Was '+(curData()&&curData().compareText?'in '+curData().compareText:'before'),v,prev,barCol.fmt)}
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
    return `<div class="rkl">${sec.rows.map((r,i)=>{const v=Number(r[barCol.key])||0,w=barCol.barReverse?(1-Math.min(1,v/maxv)):v/maxv;
      return `<div class="rkr${anyPic?' hp':''}" data-detail tabindex="0" role="button" aria-expanded="false"><span class="rkn">${i+1}</span>${anyPic?(r.img?pic(r,52):'<span class="pimg ph" aria-hidden="true"></span>'):''}<div class="rkmain"><div class="rkt"><b title="${esc(String(r[nameCol.key]&&r[nameCol.key].text||r[nameCol.key]||''))}">${cellText(r[nameCol.key],nameCol.fmt)}</b><span class="rkv mono">${cellText(r[barCol.key],barCol.fmt)}</span></div><span class="rkbar"><i style="width:${Math.max(2,w*100)}%"></i></span>${rest.length?`<div class="rkchips">${rest.map(c=>rkChip(c,r[c.key])).join('')}</div>`:''}<div class="rkdetail">${rowDetail(sec,r,i,barCol,total)}</div></div></div>`}).join('')}</div>`;
  }
  if(cols.some(c=>c.rate)){
    return `<div class="mgrid">${sec.rows.map(r=>`<div class="mtile"><div class="rkt"><b>${cellText(r[nameCol.key],nameCol.fmt)}</b></div><div class="rkchips">${cols.slice(1).map(c=>rkChip(c,r[c.key])).join('')}</div></div>`).join('')}</div>`;
  }
  return `<div class="tablewrap"><table class="dt"><thead><tr>${cols.map(c=>`<th class="${c.fmt==='str'||c.fmt==='link'?'':'num'}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${sec.rows.map((r,i)=>`<tr data-detail tabindex="0">${cols.map(c=>{const v=r[c.key],isText=c.fmt==='str'||c.fmt==='link';return `<td class="${isText?'':'num mono'}">${c===cols[0]&&r.img?`<span class="pcell">${pic(r,40)}<span>${cellText(v,c.fmt)}</span></span>`:cellText(v,c.fmt)}</td>`}).join('')}</tr><tr class="drow"><td colspan="${cols.length}"><div class="rkdetail">${rowDetail(sec,r,i,null,0)}</div></td></tr>`).join('')}</tbody></table></div>`;
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
  return {};
}
const TAB_INFO={profit:['Profit','Revenue, product cost and ad spend'],sales:['Sales','Revenue, orders, channels and profit'],funnel:['Website funnel','Where visitors drop off before buying'],products:['Products','What sells, what sits, and what needs work'],experience:['Customer experience','Delivery, returns and service'],retention:['Retention','Who comes back, and who to win back']};
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
function anSection(sec){
  const head=`<div><h2>${esc(sec.title)}</h2>${sec.note?`<p class="muted" style="font-size:.85rem">${esc(sec.note)}</p>`:''}</div>`;
  if(sec.error)return `<section class="panel an" style="border-color:var(--warn)">${head}<p class="body-text"><b style="color:var(--warn)">This part could not be loaded.</b> ${esc(sec.error)}</p></section>`;
  let body='';
  try{
    body=sec.kind==='kpi'?anKpi(sec):sec.kind==='funnel'?anFunnel(sec):sec.kind==='trend'?anTrend(sec):sec.kind==='table'?anTable(sec):sec.kind==='cohort'?anCohort(sec):sec.kind==='audit'?anAudit(sec):sec.kind==='campaigns'?metaCampaigns(sec):sec.kind==='manual'?anManual(sec):sec.kind==='text'?`<ul class="gaps">${sec.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:'';
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


/* ---------- Odoo ---------- */
const OD_TABS=[['inventory','Inventory'],['sales','Sales & invoices'],['accounting','Accounting'],['hr','Employees']];
S.od={tab:'inventory',month:'',cache:{},loading:false,err:'',data:null};
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
  const od=S.od,d=od.data,tabs=`<div class="subtabs" role="tablist">${OD_TABS.map(([k,l])=>`<button role="tab" class="subtab${od.tab===k?' on':''}" aria-selected="${od.tab===k}" data-act="od-tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
  if(!d||d.tab!==od.tab){L.innerHTML=tabs+(od.err?`<div class="empty"><b>Could not reach Odoo</b><span>${esc(od.err)}</span><button class="btn" data-act="od-refresh">Try again</button></div>`:empty('Loading…','Asking Odoo for the numbers. This can take a few seconds.'));return}
  if(d.configured===false){L.innerHTML=tabs+odooSetup(d.missing);return}
  const info={inventory:'Stock and purchasing',sales:'Orders and invoices',accounting:'Money in and out',hr:'People and attendance'}[d.tab];
  const y=window.scrollY;
  L.innerHTML=tabs+dateBar(d)+`<section class="hero"><div class="hero-top"><div><span class="eyebrow">Odoo${d.company?' · '+esc(d.company):''} · ${esc(d.monthLabel)}</span><div class="hero-n sm">${esc(info)}</div>${d.version?`<div><span class="hero-vs">Odoo ${esc(d.version)}</span></div>`:''}</div>
    <div class="hero-actions"><button class="btn light" data-act="od-refresh" ${od.loading?'disabled':''}>${od.loading?'Loading…':'Refresh numbers'}</button></div></div></section>`
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

/* ---------- events ---------- */
function arm(btn){if(btn.dataset.armed)return true;btn.dataset.armed='1';btn.classList.add('armed');const t=btn.textContent;btn.textContent='Click again to confirm';setTimeout(()=>{if(btn.isConnected){delete btn.dataset.armed;btn.classList.remove('armed');btn.textContent=t}},4000);return false}

function toggleDetail(r){const o=!r.classList.contains('open');r.classList.toggle('open',o);r.setAttribute('aria-expanded',String(o))}
document.addEventListener('click',e=>{const r=e.target.closest('[data-detail]');if(!r||e.target.closest('a,button,input,select,textarea,[data-act]'))return;toggleDetail(r)});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-detail]')){e.preventDefault();toggleDetail(e.target)}});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='go'){e.preventDefault();go(b.dataset.route,b.dataset.param)}
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
  else if(a==='od-tab'){S.od.tab=b.dataset.tab;S.od.err='';loadOdoo()}
  else if(a==='od-refresh')loadOdoo(undefined,true);
  else if(a==='meta-tab'){S.meta.tab=b.dataset.tab;S.meta.err='';loadMeta()}
  else if(a==='meta-refresh')loadMeta(undefined,true);
  else if(a==='meta-toggle'){if(S.meta.busy||!arm(b))return;await metaWrite({action:'status',id:b.dataset.id,status:b.dataset.to},b.dataset.to==='PAUSED'?'Campaign paused':'Campaign resumed')}
  else if(a==='meta-budget'){if(S.meta.busy)return;const i=document.querySelector('.mbud[data-id="'+b.dataset.id+'"]');if(!i||!(Number(i.value)>0)){toast('Enter a daily budget above zero');return}if(!arm(b))return;await metaWrite({action:'budget',id:b.dataset.id,amount:Number(i.value)},'Daily budget saved')}
  else if(a==='ov-seg'){S.shop[b.dataset.k]=b.dataset.v;const y=window.scrollY;renderShop();window.scrollTo(0,y)}
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
  if(t.matches('input[type=file]')){addFiles(t.dataset.kind,[...t.files]);t.value=''}
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

document.addEventListener('submit',async e=>{
  const f=e.target.closest('[data-form]');if(!f)return;e.preventDefault();const k=f.dataset.form;
  if(k==='setup'){
    const u=$('#su-u').value.trim().replace(/\s+/g,' '),p=$('#su-p').value,p2=$('#su-p2').value,err=$('#su-err');
    if(!validName(u))return err.textContent='Use 2 to 40 characters.';
    if(p.length<4)return err.textContent='Use at least 4 characters.';
    if(p!==p2)return err.textContent='The passwords do not match.';
    err.textContent='';
    try{await api('POST','/api/auth?action=setup',{username:u,password:p});S.lastJson='';S.route='home';await sync()}catch(x){err.textContent=x.message}
  }
  else if(k==='login'){
    const u=$('#li-u').value.trim().replace(/\s+/g,' '),p=$('#li-p').value,err=$('#li-err');
    err.textContent='';
    try{await api('POST','/api/auth?action=login',{username:u,password:p});S.lastJson='';S.route='home';await sync()}catch(x){err.textContent=x.message}
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

(function(){try{const h=location.hash.slice(1);if(h.startsWith('ins-')){S.route='ins';S.param=h.slice(4)}else if(['home','uploads','team','send','content','users','shop','eval','odoo','meta'].includes(h))S.route=h}catch(e){}})();
boot();
