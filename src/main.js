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

const S={emOpen:null,sel:new Set(),assets:true,lastJson:'',users:[],instructions:[],subs:[],usersReady:false,screen:null,me:null,route:'home',param:null,
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
async function logout(msg){try{await api('POST','/api/auth?action=logout')}catch(e){}S.lastJson='';S.me=null;S.sel.clear();renderSelBar();S.mode='login';showLogin();if(msg)toast(msg)}

/* ---------- auth screens ---------- */
const brandHTML=`<div class="brand"><div class="mark">B</div><div><b>Bless Team Hub</b><small>Briefs, files and roles in one place</small></div></div>`;
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
  if(isAdmin())return [['home','Overview'],['send','Send instruction'],['content','All content'],['team','Team by role'],['users','Users']];
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
  if(!isAdmin()&&['send','content','users'].includes(r)){S.route='home'}
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
  else if(S.route==='users')v.innerHTML=`<div class="head"><div><h1>Users</h1><p>Add people, change their role, or set a new password.</p></div></div>
    <form class="panel" data-form="adduser"><h2>Add a user</h2><div class="grid2">
      <div class="field"><label for="nu-u">Username</label><input class="input" id="nu-u" autocomplete="off" required></div>
      <div class="field"><label for="nu-e">Email <span class="muted" style="font-weight:400">(for instructions)</span></label><input class="input" id="nu-e" type="email" autocomplete="off" placeholder="name@example.com"></div>
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
  return `<div class="tablewrap"><table><thead><tr><th>Username</th><th>Role</th><th>Email</th><th>Password</th><th></th></tr></thead><tbody>${S.users.map(u=>{
    const self=u.id===S.me.id;const lastAdmin=u.role==='super_admin'&&admins<=1;
    return `<tr><td><span class="mono">${esc(u.username)}</span>${self?' <span class="muted">(you)</span>':''}</td>
    <td><select class="select" id="role-of-${u.id}" data-act="set-role" data-id="${u.id}" ${lastAdmin?'disabled title="The hub needs at least one Super Admin"':''} aria-label="Role for ${esc(u.username)}">${ROLES.map(r=>`<option value="${r.key}" ${u.role===r.key?'selected':''}>${r.label}</option>`).join('')}</select></td>
    <td>${S.emOpen===u.id?`<form class="pwrow" data-form="em" data-id="${u.id}"><input class="input" id="em-${u.id}" type="email" value="${esc(u.email||'')}" placeholder="name@example.com" autocomplete="off" style="width:210px"><button class="btn sm primary" type="submit">Save</button><button class="btn sm ghost" type="button" data-act="em-close">Cancel</button></form>`:`<div class="row" style="gap:8px;flex-wrap:nowrap"><span class="${u.email?'mono':'muted'}" style="overflow-wrap:anywhere">${u.email?esc(u.email):'No email'}</span><button class="btn sm ghost" data-act="em-open" data-id="${u.id}">${u.email?'Edit':'Add'}</button></div>`}</td>
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

/* ---------- email note shown after sending an instruction ---------- */
function mailNote(m){
  if(!m)return 'Instruction sent';
  const miss=m.noEmail?` ${m.noEmail} ${m.noEmail===1?'person has':'people have'} no email.`:'';
  if(m.status==='sent')return `Instruction sent. Emailed ${m.sent} ${m.sent===1?'person':'people'}.${miss}`;
  const who=(m.failedUsers||[]).slice(0,4).join(', ')+((m.failedUsers||[]).length>4?'…':'');
  if(m.status==='partial')return `Instruction sent. Emailed ${m.sent}, but ${m.failed} failed (${who}). Check their email addresses on the Users page.${miss}`;
  if(m.status==='failed')return `Instruction sent, but the emails failed${who?' for '+who:''}${m.error?': '+m.error:''}`;
  if(m.status==='not_configured')return 'Instruction sent. Email is not set up yet, so nobody was emailed.';
  return `Instruction sent.${miss||' No one it reached has an email address yet.'}`;
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

/* ---------- events ---------- */
function arm(btn){if(btn.dataset.armed)return true;btn.dataset.armed='1';btn.classList.add('armed');const t=btn.textContent;btn.textContent='Click again to confirm';setTimeout(()=>{if(btn.isConnected){delete btn.dataset.armed;btn.classList.remove('armed');btn.textContent=t}},4000);return false}

document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='go'){e.preventDefault();go(b.dataset.route,b.dataset.param)}
  else if(a==='logout')logout();
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
  else if(a==='em-open'){S.emOpen=b.dataset.id;update();$('#em-'+b.dataset.id)?.focus()}
  else if(a==='em-close'){S.emOpen=null;update()}
  else if(a==='del-user'){if(!arm(b))return;try{await api('DELETE','/api/users?id='+encodeURIComponent(b.dataset.id));await sync();toast('User removed')}catch(x){toast(x.message||'Could not remove the user')}}
  else if(a==='del-ins'){if(!arm(b))return;try{await api('DELETE','/api/instructions?id='+encodeURIComponent(b.dataset.id));await sync();toast('Instruction deleted');go('send')}catch(x){toast(x.message||'Could not delete')}}
  else if(a==='del-sub'){if(!arm(b))return;try{await api('DELETE','/api/submissions?id='+encodeURIComponent(b.dataset.id));await sync();toast('Deleted')}catch(x){toast(x.message||'Could not delete')}}
});
document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.matches('input[type=file]')){addFiles(t.dataset.kind,[...t.files]);t.value=''}
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
    try{const j=await api('POST','/api/instructions',{title,body,roles:[...S.sendRoles],userIds:[...S.sendUsers]});await sync();
      S.sendRoles.clear();S.sendUsers.clear();$('#in-t').value='';$('#in-b').value='';err.textContent='';f.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=false);updateSendCount();toast(mailNote(j.mail))}
    catch(x){err.textContent=x.message||'Could not send. Try again.'}
  }
  else if(k==='adduser'){
    const u=$('#nu-u').value.trim().replace(/\s+/g,' '),p=$('#nu-p').value,role=$('#nu-r').value,email=$('#nu-e').value.trim(),err=$('#nu-err');
    if(!validName(u))return err.textContent='Use 2 to 40 characters.';
    if(S.users.some(x=>x.usernameLower===u.toLowerCase()))return err.textContent='That username is taken.';
    if(p.length<4)return err.textContent='Use at least 4 characters.';
    try{await api('POST','/api/users',{username:u,password:p,role,email});await sync();
      $('#nu-u').value='';$('#nu-p').value='';$('#nu-e').value='';err.textContent='';toast(`Added ${u} as ${ROLE[role].label}`)}catch(x){err.textContent=x.message||'Could not add the user.'}
  }
  else if(k==='em'){
    const id=f.dataset.id,email=$('#em-'+id).value.trim(),u=userById(id);
    try{await api('PATCH','/api/users',{id,email});S.emOpen=null;await sync();update();toast(email?`Email saved for ${u.username}`:`Email removed for ${u.username}`)}catch(x){toast(x.message||'Could not save the email')}
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

(function(){try{const h=location.hash.slice(1);if(h.startsWith('ins-')){S.route='ins';S.param=h.slice(4)}else if(['home','uploads','team','send','content','users'].includes(h))S.route=h}catch(e){}})();
boot();
