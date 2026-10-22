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

const S={shop:{month:'',metric:'revenue',data:null,loading:false,err:'',syncing:false,syncMsg:''},sel:new Set(),assets:true,lastJson:'',users:[],instructions:[],subs:[],usersReady:false,screen:null,me:null,route:'home',param:null,
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
  S.users=j.users;S.instructions=j.instructions;S.subs=j.submissions;S.usersReady=true;
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
async function logout(msg){try{await api('POST','/api/auth?action=logout')}catch(e){}S.lastJson='';S.me=null;S.shop.data=null;S.sel.clear();renderSelBar();S.mode='login';showLogin();if(msg)toast(msg)}

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
  if(isAdmin())return [['home','Overview'],['send','Send instruction'],['content','All content'],['shop','Shopify'],['team','Team by role'],['users','Users']];
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
  if(!isAdmin()&&['send','content','users','shop'].includes(r)){S.route='home'}
  if(S.route==='home')v.innerHTML=isAdmin()?`<div class="head"><div><h1>Overview</h1><p>What the team has received from you and what they have sent back.</p></div><button class="btn primary" data-act="go" data-route="send">New instruction</button></div><div id="live"></div>`
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
  syncUploadAvail();renderSelBar();
}

function overviewHTML(){
  const team=S.users.filter(u=>u.role!=='super_admin');
  let open=0;S.instructions.forEach(i=>recipients(i).forEach(u=>{if(!responded(i.id,u.id))open++}));
  const files=S.subs.reduce((n,s)=>n+(s.files||[]).length,0);
  return `<div style="display:grid;gap:24px"><div class="stats">
    <div class="stat"><div class="eyebrow">Team members</div><div class="n">${team.length}</div></div>
    <div class="stat"><div class="eyebrow">Instructions sent</div><div class="n">${S.instructions.length}</div></div>
    <div class="stat"><div class="eyebrow">Awaiting response</div><div class="n" style="color:${open?'var(--warn)':'inherit'}">${open}</div></div>
    <div class="stat"><div class="eyebrow">Files received</div><div class="n">${files}</div></div></div>
    <section style="display:grid;gap:12px"><h2>Latest instructions</h2>${S.instructions.length?`<div class="list">${S.instructions.slice(0,5).map(insRowAdmin).join('')}</div>`:empty('No instructions yet','Send your first brief from Send instruction.')}</section>
    <section style="display:grid;gap:12px"><h2>Latest from the team</h2>${listOrEmpty(S.subs.slice(0,6),'Nothing received yet','Responses and uploads from your team land here.')}</section></div>`;
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

/* ---------- Shopify dashboard ---------- */
async function loadShop(month){
  if(S.an.tab!=='overview'){if(month!==undefined)S.shop.month=month;return loadAn()}
  const sh=S.shop;sh.loading=true;sh.err='';if(month!==undefined)sh.month=month;renderShop();
  try{sh.data=await api('GET','/api/shopify'+(sh.month?'?month='+encodeURIComponent(sh.month):''));if(sh.data.month)sh.month=sh.data.month}
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
function money(n){const c=(S.shop.data&&S.shop.data.currency)||(S.an&&S.an.data&&S.an.data.currency);try{return new Intl.NumberFormat(undefined,c?{style:'currency',currency:c,maximumFractionDigits:0}:{maximumFractionDigits:0}).format(n)}catch(e){return fmtNum(n)}}
function shortNum(n){return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e4?Math.round(n/1e3)+'k':n>=1e3?(n/1e3).toFixed(1)+'k':String(Math.round(n))}
function delta(v){if(v===null||v===undefined)return '';const up=v>=0;return `<span class="delta ${up?'up':'down'}">${up?'▲':'▼'} ${Math.abs(v)}% vs last month</span>`}
function ageText(h){return h<48?h+' h':Math.round(h/24)+' days'}
function rankList(list,valFn,sub){
  if(!list.length)return '<p class="muted">Nothing here yet.</p>';
  const max=Math.max(1,...list.map(valFn));
  return `<div class="ranks">${list.map((x,i)=>`<div class="rrow"><span class="rn mono">${i+1}</span><span class="rt" title="${esc(x.title||x.name)}">${esc(x.title||x.name)}</span><span class="rbar"><i style="width:${Math.max(2,valFn(x)/max*100)}%"></i></span><span class="rv mono">${sub(x)}</span></div>`).join('')}</div>`;
}
function monthChart(ms,metric,sel){
  const f=metric==='revenue'?money:fmtNum;const max=Math.max(1,...ms.map(m=>m[metric]));
  return `<div class="mchart">${ms.map(m=>`<button class="mcol${m.key===sel?' on':''}" data-act="shop-month" data-m="${m.key}" title="${esc(m.label)}: ${esc(f(m[metric]))}"><span class="mval mono">${shortNum(m[metric])}</span><span class="mbar"><i style="height:${Math.max(2,m[metric]/max*100)}%"></i></span><span class="mlab">${esc(m.label.slice(0,3)+" '"+m.label.slice(-2))}</span></button>`).join('')}</div>`;
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
  const monthOpts=d.months.slice().reverse().map(m=>`<option value="${m.key}" ${m.key===d.month?'selected':''}>${esc(m.label)}</option>`).join('');
  const last=sy.lastSync?fmtDate(Date.parse(sy.lastSync)):'never';
  const stat=(l,v,x)=>`<div class="stat"><div class="eyebrow">${l}</div><div class="n">${v}</div>${x||''}</div>`;
  const small=t=>`<span class="muted mono" style="font-size:.75rem">${t}</span>`;
  L.innerHTML=shopTabs()+`
  <div class="row" style="justify-content:space-between;gap:12px">
    <div class="row" style="gap:10px"><label class="muted" for="shop-month" style="font-weight:600">Month</label><select class="select" id="shop-month" style="width:auto">${monthOpts}</select>${sh.loading?'<span class="muted">Loading…</span>':''}</div>
    <div class="row" style="gap:10px"><span class="muted mono" style="font-size:.75rem">${sy.orders} orders stored · last sync ${esc(last)}</span><button class="btn primary" data-act="shop-sync" ${sh.syncing?'disabled':''}>${sh.syncing?'Syncing…':'Sync now'}</button></div>
  </div>
  ${sh.syncing?`<div class="panel" style="padding:12px 16px"><span class="mono">${esc(sh.syncMsg)}</span></div>`:''}
  ${sh.err?`<div class="panel" style="border-color:var(--danger)"><b style="color:var(--danger)">Sync problem</b><p class="body-text">${esc(sh.err)}</p></div>`:''}
  ${sy.note?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Heads up</b><p class="body-text">${esc(sy.note)}</p></div>`:''}
  ${sy.cartsError?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Carts could not be read</b><p class="body-text">${esc(sy.cartsError)}</p></div>`:''}
  ${!sy.orders&&!sh.syncing?`<div class="empty"><b>No data yet</b><span>Press Sync now to pull your orders from Shopify. The first sync can take a few minutes.</span></div>`:''}

  ${d.fromReports?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Older month</b><p class="body-text">Shopify only lets this site download the last 60 days of orders, so this month's totals come from Shopify's sales reports. Best sellers, areas, customers and carts are not available for it. Open the Sales tab for the full report.</p></div>`:''}
  ${d.reportsError?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Older months could not be filled in</b><p class="body-text">${esc(d.reportsError)}</p></div>`:''}
  <div class="stats">
    ${stat('Revenue',money(s.revenue),delta(s.change.revenue))}
    ${stat('Orders',fmtNum(s.orders),delta(s.change.orders))}
    ${stat('Units sold',fmtNum(s.units),delta(s.change.units))}
    ${stat('Average order',money(s.aov))}
    ${stat('Refunded',money(s.refunds),small(s.refundRate.toFixed(1)+'% of revenue'))}
    ${stat('Cancelled orders',fmtNum(s.cancelled),small(s.cancelRate.toFixed(1)+'% of orders'))}
  </div>

  <section class="panel"><div class="item-top"><div><h2>Last 12 months</h2><p class="muted">Click a month to open it.</p></div>
    <select class="select" id="shop-metric" style="width:auto" aria-label="Chart metric"><option value="revenue" ${sh.metric==='revenue'?'selected':''}>Revenue</option><option value="orders" ${sh.metric==='orders'?'selected':''}>Orders</option><option value="units" ${sh.metric==='units'?'selected':''}>Units sold</option></select></div>
    ${monthChart(d.months,sh.metric,d.month)}</section>

  <div class="two">
    <section class="panel"><h2>Best sellers by units</h2>${rankList(d.bestByUnits,x=>x.units,x=>fmtNum(x.units)+' units')}</section>
    <section class="panel"><h2>Best sellers by revenue</h2>${rankList(d.bestByRevenue,x=>x.revenue,x=>money(x.revenue))}</section>
  </div>

  <div class="two">
    <section class="panel"><h2>Countries</h2>${rankList(d.countries,x=>x.revenue,x=>fmtNum(x.orders)+' orders · '+money(x.revenue))}</section>
    <section class="panel"><h2>Cities</h2>${rankList(d.cities,x=>x.revenue,x=>fmtNum(x.orders)+' orders · '+money(x.revenue))}</section>
  </div>

  <section class="panel"><h2>Customers</h2>
    ${c.distinct||c.guest?`<div class="stats">${stat('Customers who ordered',fmtNum(c.distinct))}${stat('First-time',fmtNum(c.fresh))}${stat('Returning',fmtNum(c.repeat))}${stat('Repeat rate',c.repeatRate.toFixed(0)+'%')}</div>
      <p class="muted" style="font-size:.85rem">Returning means the customer has more than one order with you in total.${c.guest?` ${fmtNum(c.guest)} order(s) had no customer record.`:''}</p>`:'<p class="muted">No customer data for this month.</p>'}</section>

  <section class="panel"><div><h2>Carts left behind</h2><p class="muted">Customers who added items and never checked out (last 90 days).</p></div>
    <div class="stats">
      ${stat('Open carts',fmtNum(a.openCount))}
      ${stat('Value sitting in carts',money(a.openValue))}
      ${stat('Abandoned in '+esc(d.monthLabel),fmtNum(a.monthCount),small(money(a.monthValue)))}
      ${stat('Abandonment rate',a.monthRate.toFixed(0)+'%',small('carts vs orders that month'))}
    </div>
    <div class="two">
      <div style="display:grid;gap:10px"><h3>How long they have been waiting</h3>${rankList(a.aging.map(x=>({name:x.label,count:x.count,value:x.value})),x=>x.count,x=>fmtNum(x.count)+' · '+money(x.value))}</div>
      <div style="display:grid;gap:10px"><h3>Most left in carts</h3>${rankList(a.topProducts,x=>x.qty,x=>fmtNum(x.qty)+' in '+x.carts+' carts')}</div>
    </div>
    ${a.oldest.length?`<div style="display:grid;gap:10px"><h3>Biggest carts to recover</h3><div class="tablewrap"><table style="min-width:640px"><thead><tr><th>Value</th><th>Waiting</th><th>Items</th><th>Customer</th><th></th></tr></thead><tbody>${a.oldest.map(x=>{const ph=(x.phone||'').replace(/[^\d]/g,'');return `<tr><td class="mono">${money(x.total)}</td><td>${ageText(x.ageHours)}</td><td style="max-width:300px;overflow-wrap:anywhere">${esc(x.items)}</td><td style="overflow-wrap:anywhere">${x.name||x.email||x.phone?`${x.name?`<b>${esc(x.name)}</b><br>`:''}${x.email?`<span class="muted">${esc(x.email)}</span><br>`:''}${x.phone?`<span class="muted mono">${esc(x.phone)}</span>`:''}`:'<span class="muted">No contact saved</span>'}</td><td style="white-space:nowrap">${x.url&&x.linkFresh?`<a class="btn sm" href="${esc(x.url)}" target="_blank" rel="noopener">Open cart</a>`:`<span class="muted" style="font-size:.75rem">Cart link expired</span>`}${ph?` <a class="btn sm" href="https://wa.me/${ph}" target="_blank" rel="noopener">WhatsApp</a>`:''}</td></tr>`}).join('')}</tbody></table></div><p class="muted" style="font-size:.8rem">Shopify cart links stop working after about 10 days, or once the customer buys. For older carts, contact the customer and send them the products directly.</p></div>`:''}
  </section>
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
const AN_TABS=[['overview','Overview'],['sales','Sales'],['funnel','Funnel'],['products','Products'],['experience','Customer experience'],['retention','Retention']];
S.an={tab:'overview',cache:{},loading:false,err:'',metric:{},saving:false};
function shopTabs(){return `<div class="subtabs" role="tablist">${AN_TABS.map(([k,l])=>`<button role="tab" class="subtab${S.an.tab===k?' on':''}" aria-selected="${S.an.tab===k}" data-act="an-tab" data-tab="${k}">${l}</button>`).join('')}</div>`}
async function loadAn(refresh){
  const an=S.an,sh=S.shop,tab=an.tab;if(tab==='overview')return;
  const key=tab+'|'+(sh.month||'');if(!refresh&&an.cache[key]){renderShop();return}
  an.loading=true;an.err='';renderShop();
  try{
    const d=await api('GET','/api/analytics?tab='+tab+(sh.month?'&month='+encodeURIComponent(sh.month):'')+(refresh?'&refresh=1':''));
    if(d.month)sh.month=d.month;an.cache[d.configured===false?key:tab+'|'+d.month]=d;an.cache[key]=d;
  }catch(e){an.err=e.message}
  an.loading=false;renderShop();
}
function fv(v,f){
  if(v===null||v===undefined||(typeof v==='number'&&!isFinite(v)))return '–';
  switch(f){
    case 'money':return money(v);case 'int':return fmtNum(v);
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
function anKpi(sec){
  return `<div class="stats">${sec.tiles.map(t=>{
    let d='';
    if(t.prev!==undefined){const g=t.prev?Math.round((t.value-t.prev)/t.prev*1000)/10:null;
      if(g!==null){const good=t.goodDown?g<=0:g>=0;d=`<span class="delta ${good?'up':'down'}">${g>=0?'▲':'▼'} ${Math.abs(g)}% vs last month</span>`}}
    return `<div class="stat"><div class="eyebrow">${esc(t.label)}</div><div class="n">${esc(fv(t.value,t.fmt))}</div>${d}${t.sub?`<div class="muted" style="font-size:.75rem;margin-top:2px">${esc(t.sub)}</div>`:''}</div>`}).join('')}</div>`;
}
function anFunnel(sec){
  const top=Math.max(1,sec.steps[0].value);
  const steps=`<div class="fun">${sec.steps.map((s,i)=>{const prev=i?sec.steps[i-1].value:null;
    return `<div class="frow"><span class="fl">${esc(s.label)}</span><span class="fbar"><i style="width:${Math.max(1.5,s.value/top*100)}%"></i></span><span class="fv mono">${fmtNum(s.value)}</span><span class="fd mono">${prev?(prev?(100-s.value/prev*100).toFixed(0)+'% drop':''):''}</span></div>`}).join('')}</div>`;
  return steps+anKpi({tiles:sec.tiles});
}
function anTrend(sec){
  const id=sec.id+'|'+S.an.tab,m=S.an.metric[id]||sec.metrics[0].key,def=sec.metrics.find(x=>x.key===m)||sec.metrics[0];
  const max=Math.max(1e-9,...sec.rows.map(r=>r.values[def.key]));
  const sel=S.shop.month;
  return `<div class="item-top" style="margin-bottom:6px"><span></span><select class="select" data-act="an-metric" data-id="${esc(id)}" style="width:auto" aria-label="Metric">${sec.metrics.map(x=>`<option value="${x.key}" ${x.key===def.key?'selected':''}>${esc(x.label)}</option>`).join('')}</select></div>
  <div class="mchart">${sec.rows.map(r=>{const v=r.values[def.key];return `<button class="mcol${r.key===sel?' on':''}" data-act="shop-month" data-m="${r.key}" title="${esc(r.label)}: ${esc(fv(v,def.fmt))}"><span class="mval mono">${def.fmt==='pct'?v.toFixed(1)+'%':shortNum(v)}</span><span class="mbar"><i style="height:${Math.max(2,v/max*100)}%"></i></span><span class="mlab">${esc(r.label.slice(0,3)+" '"+r.label.slice(-2))}</span></button>`}).join('')}</div>`;
}
function rateClass(v,r){return !r?'':v<=r[0]?'good':v<=r[1]?'mid':'bad'}
function anTable(sec){
  if(!sec.rows.length)return `<p class="muted">${esc(sec.empty||'No data for this period.')}</p>`;
  const cols=sec.columns;const maxes={};cols.forEach(c=>{if(c.bar)maxes[c.key]=Math.max(1e-9,...sec.rows.map(r=>Number(r[c.key])||0))});
  return `<div class="tablewrap"><table class="dt"><thead><tr>${cols.map(c=>`<th class="${c.fmt==='str'||c.fmt==='link'?'':'num'}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${sec.rows.map(r=>`<tr>${cols.map(c=>{
    const v=r[c.key],isText=c.fmt==='str'||c.fmt==='link';
    const bar=c.bar&&typeof v==='number'?`<span class="cbar"><i style="width:${Math.max(2,(c.barReverse?(1-Math.min(1,v/maxes[c.key])):v/maxes[c.key])*100)}%"></i></span>`:'';
    const cls=c.rate&&typeof v==='number'?' r-'+rateClass(v,c.rate):'';
    return `<td class="${isText?'':'num mono'}${cls}" ${isText&&c.fmt==='str'?`title="${esc(String(v))}"`:''}>${bar}<span class="ct">${cellText(v,c.fmt)}</span></td>`}).join('')}</tr>`).join('')}</tbody></table></div>`;
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
  <div class="row" style="gap:10px;grid-column:1/-1"><button class="btn primary" type="submit" ${S.an.saving?'disabled':''}>${S.an.saving?'Saving…':'Save for '+esc(sec.history.length?S.an.data.monthLabel:'this month')}</button><span class="muted" style="font-size:.8rem">Leave a box empty if you do not track it.</span></div></form>
  ${sec.history.length?`<h3 class="sub">Previous months</h3><div class="tablewrap"><table class="dt"><thead><tr><th>Month</th>${sec.fields.map(f=>`<th class="num">${esc(f.label.replace(/\s*\(.*\)/,''))}</th>`).join('')}</tr></thead><tbody>${sec.history.map(h=>`<tr><td>${esc(h.label)}</td>${sec.fields.map(f=>`<td class="num mono">${h.values[f.key]??'–'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}`;
}
function anSection(sec){
  const head=`<div><h2>${esc(sec.title)}</h2>${sec.note?`<p class="muted" style="font-size:.85rem">${esc(sec.note)}</p>`:''}</div>`;
  if(sec.error)return `<section class="panel" style="border-color:var(--warn)">${head}<p class="body-text"><b style="color:var(--warn)">This part could not be loaded.</b> ${esc(sec.error)}</p></section>`;
  let body='';
  try{
    body=sec.kind==='kpi'?anKpi(sec):sec.kind==='funnel'?anFunnel(sec):sec.kind==='trend'?anTrend(sec):sec.kind==='table'?anTable(sec):sec.kind==='cohort'?anCohort(sec):sec.kind==='audit'?anAudit(sec):sec.kind==='manual'?anManual(sec):sec.kind==='text'?`<ul class="gaps">${sec.items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:'';
  }catch(e){body=`<p class="muted">Could not show this part (${esc(e.message)}).</p>`}
  return `<section class="panel${sec.kind==='text'?' soft':''}">${head}${body}</section>`;
}
function renderAnalytics(L){
  const an=S.an,sh=S.shop,d=an.cache[an.tab+'|'+(sh.month||'')]||an.cache[an.tab+'|'+(an.last||'')];
  an.data=d;
  const top=(months)=>`<div class="row" style="justify-content:space-between;gap:12px">
    <div class="row" style="gap:10px"><label class="muted" for="shop-month" style="font-weight:600">Month</label><select class="select" id="shop-month" style="width:auto">${(months||[]).slice().reverse().map(m=>`<option value="${m.key}" ${m.key===sh.month?'selected':''}>${esc(m.label)}</option>`).join('')}</select>${an.loading?'<span class="muted">Loading…</span>':''}</div>
    <button class="btn" data-act="an-refresh" ${an.loading?'disabled':''}>Refresh numbers</button></div>`;
  if(!d){L.innerHTML=shopTabs()+(an.err?`<div class="empty"><b>Could not load this tab</b><span>${esc(an.err)}</span><button class="btn" data-act="an-refresh">Try again</button></div>`:empty('Loading…','Asking Shopify for the numbers. This can take a few seconds.'));return}
  if(d.configured===false){L.innerHTML=shopTabs()+`<div class="panel"><h2>Connect your Shopify store first</h2><p class="muted">Missing: ${d.missing.map(esc).join(', ')}</p></div>`;return}
  an.last=d.month;
  const scrollY=window.scrollY;
  L.innerHTML=shopTabs()+top(d.months)+(an.err?`<div class="panel" style="border-color:var(--danger)"><b style="color:var(--danger)">Problem</b><p class="body-text">${esc(an.err)}</p></div>`:'')+(d.scopes?`<div class="panel" style="border-color:var(--warn)"><b style="color:var(--warn)">Permissions this site currently has from Shopify</b><p class="body-text mono" style="font-size:.8rem">${d.scopes.length?d.scopes.map(esc).join(', '):'none returned'}</p><p class="muted" style="font-size:.8rem">Reports need read_reports in this list.</p></div>`:'')+d.sections.map(anSection).join('')+`<p class="muted" style="font-size:.78rem">Figures come straight from Shopify reports and are kept for 30 minutes. Press Refresh numbers to fetch them again. Times use ${esc(d.tz)}.</p>`;
  window.scrollTo(0,scrollY);
}

/* ---------- events ---------- */
function arm(btn){if(btn.dataset.armed)return true;btn.dataset.armed='1';btn.classList.add('armed');const t=btn.textContent;btn.textContent='Click again to confirm';setTimeout(()=>{if(btn.isConnected){delete btn.dataset.armed;btn.classList.remove('armed');btn.textContent=t}},4000);return false}

document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='go'){e.preventDefault();go(b.dataset.route,b.dataset.param)}
  else if(a==='logout')logout();
  else if(a==='shop-sync')runSync();
  else if(a==='shop-reload')loadShop();
  else if(a==='shop-month')loadShop(b.dataset.m);
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
  if(e.target.id!=='an-manual')return;e.preventDefault();
  const values={};new FormData(e.target).forEach((v,k)=>{values[k]=v});
  S.an.saving=true;renderShop();
  try{await api('POST','/api/analytics',{month:S.shop.month,values});delete S.an.cache['experience|'+S.shop.month];S.an.saving=false;toast('Saved');await loadAn(false)}
  catch(x){S.an.saving=false;toast(x.message||'Could not save');renderShop()}
});
document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.matches('input[type=file]')){addFiles(t.dataset.kind,[...t.files]);t.value=''}
  else if(t.id==='shop-month'){loadShop(t.value)}
  else if(t.id==='shop-metric'){S.shop.metric=t.value;renderShop()}
  else if(t.dataset.act==='an-metric'){S.an.metric[t.dataset.id]=t.value;renderShop()}
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

(function(){try{const h=location.hash.slice(1);if(h.startsWith('ins-')){S.route='ins';S.param=h.slice(4)}else if(['home','uploads','team','send','content','users','shop'].includes(h))S.route=h}catch(e){}})();
boot();
