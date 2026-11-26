/* Online controller. Only the server can change the shared game. */
const NET={room:null,me:null,token:null,version:0,members:[],host:false,spectator:false,capacity:4,busy:false,online:true,turnKey:null,loading:true,notice:'',timer:null};
const LAST_ROOM_KEY='wc31-last-room';
const seatKey=code=>'wc31-seat-'+code;
const initialWatchCode=new URL(location.href).searchParams.get('watch')?.toUpperCase()||'';
let rememberedRoom=new URL(location.href).searchParams.get('room')?.toUpperCase()||initialWatchCode;
function stored(key,fallback='') { try { return localStorage.getItem(key)||fallback; } catch { return fallback; } }
function remember(key,value) { try { localStorage.setItem(key,value); } catch {} }
function readToken(code) {
  const key=seatKey(code);
  try { return sessionStorage.getItem(key)||stored(key); }
  catch { return stored(key); }
}
function saveSeat(data) {
  NET.shareLink=null;
  NET.token=data.token||NET.token;
  if(NET.token) {
    const key=seatKey(data.code);
    try { sessionStorage.setItem(key,NET.token); } catch {}
    remember(key,NET.token);
  }
  rememberedRoom=data.code; remember(LAST_ROOM_KEY,data.code);
  const u=new URL(location.href); u.search='';u.searchParams.set('room',data.code); history.replaceState({},'',u);
}
function applySnapshot(data) {
  if(data.unchanged) return;
  const key=data.game?`${data.game.round}:${data.game.cur}:${data.game.phase}`:'lobby';
  if(key!==NET.turnKey) { UI.alloc=null; UI.tab='build'; UI.showObj=false; UI.joint=null; UI.target=null; UI.trade={to:null,gm:0,gw:0,rm:0,rw:0}; NET.turnKey=key; }
  Object.assign(NET,{room:data.code,me:data.me,version:data.version,members:data.members,host:data.host,spectator:!!data.spectator,capacity:data.capacity,online:true});
  G=data.game; NET.currentTurnId=G?.cur; NET.loading=false; NET.notice=''; render();
}
async function requestJSON(path,{method='GET',body,token=NET.token}={}) {
  const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),12000);
  try {
    const r=await fetch(path,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{'Authorization':'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:ctl.signal,cache:'no-store'});
    const data=await r.json(); if(!r.ok) { const e=new Error(data.error||'Request failed.'); e.status=r.status; throw e; } return data;
  } finally {clearTimeout(timeout);}
}
function schedulePoll() { clearTimeout(NET.timer); if(NET.room) NET.timer=setTimeout(pollRoom,document.hidden?5000:1800); }
async function pollRoom(force=false) {
  if(!NET.room) return;
  if(NET.busy && !force) { schedulePoll(); return; }
  try {
    const data=await requestJSON('/api/rooms/'+NET.room+(NET.spectator?'/watch':'')+(force?'':'?since='+NET.version),{token:NET.spectator?null:NET.token});
    const wasOffline=!NET.online; NET.online=true;
    if(!data.unchanged) applySnapshot(data); else if(wasOffline) render();
  } catch(e) {
    if(e.status===401 || e.status===404) { NET.notice=e.message; disconnect(false); render(); return; }
    if(NET.online) {NET.online=false;render();}
  }
  schedulePoll();
}
function isMyTurn() { return !NET.spectator && G?.phase==='turn' && G.cur===NET.me; }
async function sendCommand(command) {
  if(NET.busy||NET.spectator) return;
  NET.busy=true; const payload={...command,version:NET.version,requestId:crypto.randomUUID()}; render();
  try {
    let data;
    for(let attempt=0;attempt<2;attempt++) {
      try { data=await requestJSON('/api/rooms/'+NET.room+'/action',{method:'POST',body:payload}); break; }
      catch(e) { if(e.status || attempt===1) throw e; }
    }
    if(['pump','sell','accept','playBonus','endTurn','build','upgrade'].includes(command.act)) UI.alloc=null;
    if(['accept','decline','cancelOffer'].includes(command.act)) {UI.trade={to:null,gm:0,gw:0,rm:0,rw:0};UI.joint=null;}
    applySnapshot(data);
  } catch(e) { toast(e.name==='AbortError'?'Connection timed out. Reconnecting…':e.message); await pollRoom(true); }
  finally { NET.busy=false;render();schedulePoll(); }
}
async function enterRoom(create) {
  if(NET.busy) return;
  const name=document.getElementById('online-name')?.value.trim();
  const code=(document.getElementById('room-code')?.value||'').trim().toUpperCase();
  if(!name) {toast('Please enter your name / 请填写名字');return;}
  if(!create && !/^[A-Z2-9]{6}$/.test(code)) {toast('Enter a 6-character room code / 输入6位房间码');return;}
  remember('wc-name',name); NET.busy=true;
  try {
    const path=create?'/api/rooms':'/api/rooms/'+code+'/join';
    const data=await requestJSON(path,{method:'POST',body:create?{name,capacity:NET.capacity}:{name},token:null});
    saveSeat(data);applySnapshot(data);schedulePoll();
  } catch(e) {toast(e.name==='AbortError'?'Connection timed out. Please try again.':e.message);}
  finally {NET.busy=false;render();}
}
async function resumeSeat(code) {
  const token=readToken(code); if(!token) return;
  NET.busy=true; NET.loading=true;render();
  try { const data=await requestJSON('/api/rooms/'+code,{token});NET.token=token;saveSeat(data);applySnapshot(data);schedulePoll(); }
  catch(e) {NET.notice=e.message;NET.loading=false;}
  finally {NET.busy=false;NET.loading=false;render();}
}
async function watchRoom(code){
  code=(code||document.getElementById('room-code')?.value||'').trim().toUpperCase();
  if(NET.busy)return;
  if(!/^[A-Z2-9]{6}$/.test(code)){toast('Enter a six-character room code / 输入6位房间码');return;}
  NET.busy=true;NET.loading=true;render();
  try{const data=await requestJSON('/api/rooms/'+code+'/watch',{token:null});NET.token=null;NET.shareLink=null;applySnapshot(data);rememberedRoom=code;const u=new URL(location.href);u.search='';u.searchParams.set('watch',code);history.replaceState({},'',u);schedulePoll();}
  catch(e){NET.notice=e.message;NET.loading=false;}
  finally{NET.busy=false;NET.loading=false;render();}
}
function disconnect(clearURL=true) {
  clearTimeout(NET.timer);NET.room=null;NET.me=null;NET.token=null;NET.host=false;NET.spectator=false;NET.shareLink=null;NET.version=0;NET.turnKey=null;G=null;UI.rules=false;UI.confirmNew=false;NET.loading=false;
  if(clearURL) {const u=new URL(location.href);u.search='';history.replaceState({},'',u);rememberedRoom='';}
}
async function copyRoom(watch=false) {
  const u=new URL(location.href);u.search='';u.searchParams.set(watch?'watch':'room',NET.room);
  try {await navigator.clipboard.writeText(u.href);toast(watch?'Spectator link copied / 观众链接已复制':'Player link copied / 玩家链接已复制');}
  catch {NET.shareLink=u.href;render();}
}
function roomBar() {
  return `<div class="onlinebar"><div class="field"><span class="signal ${NET.online?'':'off'}"></span><span>${NET.online?'Connected / 已连接':'Reconnecting / 正在重连'}</span><span class="roomcode">${esc(NET.room)}</span>${!NET.spectator?'<button class="ghost" data-net="copy">Player link / 玩家邀请</button>':''}<button class="ghost" data-net="copyWatch">Share spectator view / 分享观众视角</button></div><span class="note">${NET.spectator?'Spectator / 观众 · read-only':'You / 你：'+esc(NET.members[NET.me]?.name||'')}${NET.host?' · Host':''}${NET.busy?' · Saving…':''}</span>${NET.shareLink?`<label class="shared-url">Copy this link / 复制链接<input readonly value="${esc(NET.shareLink)}" aria-label="Share link"></label>`:''}</div>`;
}
function renderSetup() {
  const saved=stored(LAST_ROOM_KEY),hasSeat=saved&&readToken(saved);
  return `<header class="top"><div class="brand"><span class="mark">${UIICON.mark}</span><div><h1>Watershed <span>Council</span></h1><span class="sub">Online · version ${RELEASE}</span></div></div><button class="ghost" data-act="rules">How to play</button></header>
  <section class="hero"><div style="display:flex;flex-direction:column;gap:16px"><span class="label">Online multiplayer · 3–5 players</span><h2>One aquifer.<br>Your own screen.<br>Eight seasons.</h2><p>Manage your catchment, invest in water infrastructure, and negotiate over a shared aquifer. Everyone plays on their own computer or phone.</p><p class="muted">每人使用自己的设备。创建房间，把链接发给朋友，一起进入同一局游戏。</p><div class="onlinefeatures"><span>Private objectives</span><span>Shared board</span><span>Saved progress</span></div></div>
  <div class="panel"><h2 style="font-size:24px">Join the council / 加入游戏</h2>${NET.notice?`<div class="warnbox">${esc(NET.notice)}</div>`:''}
  <label class="onlinefield">Your name / 你的名字<input id="online-name" autocomplete="nickname" maxlength="24" value="${esc(stored('wc-name'))}" placeholder="e.g. Ana"></label>
  <div><span class="label">Create a room / 创建房间</span><div class="field" style="margin-top:8px">${[3,4,5].map(n=>`<button class="pbtn ${NET.capacity===n?'on':''}" style="--pc:var(--water)" data-net="capacity" data-n="${n}">${n} players</button>`).join('')}</div></div>
  <button class="btn big" data-net="create" ${NET.busy?'disabled':''}>Create room / 创建房间</button>
  <div class="or">or join a friend / 或加入朋友的房间</div><label class="onlinefield">Room code / 房间码<input id="room-code" maxlength="6" autocapitalize="characters" autocomplete="off" value="${esc(rememberedRoom)}" placeholder="ABC234" style="text-transform:uppercase;letter-spacing:.15em"></label>
  <button class="btn alt" data-net="join" ${NET.busy?'disabled':''}>Join as player / 玩家加入</button><button class="ghost" data-net="watch">Watch this room / 观众进入</button>
  ${hasSeat?`<button class="ghost" data-net="resume" data-code="${esc(saved)}">Return to my room ${esc(saved)} / 返回游戏</button>`:''}
  <p class="note">Your seat is remembered in this browser. Return here after refreshing or a short disconnect.</p></div></section>`;
}
function lobby() {
  const ready=NET.members.length===NET.capacity;
  return `<div class="top"><div class="brand"><h1>Watershed <span>Council</span></h1></div><button class="ghost" data-net="leave">Leave / 离开房间</button></div>${roomBar()}
  <section class="hero"><div style="display:flex;flex-direction:column;gap:16px"><span class="label">The council is gathering</span><h2>Invite your<br>fellow catchments.</h2><p>Share the room code or invite link. Each player joins from their own device.</p><div class="bigcode">${esc(NET.room)}</div><p class="muted">把房间码或邀请链接发给其他玩家，等待大家进入后开始。</p></div>
  <div class="panel"><div class="field" style="justify-content:space-between"><h2 style="font-size:24px">Players / 玩家</h2><span class="pill">${NET.members.length} / ${NET.capacity}</span></div>
  ${Array.from({length:NET.capacity},(_,i)=>{const m=NET.members[i];return `<div class="lobbymember">${pChip({color:PCOLORS[i]})}<span style="flex:1">${m?esc(m.name):'<span class="muted">Waiting for a player…</span>'}${m&&i===0?' · Host':''}${m&&i===NET.me?' · You':''}</span>${NET.host&&m&&i>0?`<button class="ghost" data-net="remove" data-id="${i}">Remove</button>`:''}</div>`;}).join('')}
  ${NET.host?`<button class="btn big" data-net="start" ${!ready||NET.busy?'disabled':''}>${ready?'Start game / 开始游戏':'Waiting for all players / 等待所有玩家'}</button>`:'<p class="note">The host starts the game when everyone has joined. / 人齐后由房主开始。</p>'}
  <button class="ghost" data-act="rules">How to play / 游戏规则</button></div></section>`;
}
function waitingPanel() {
  const name=P(NET.currentTurnId)?.name;
  let msg=G.phase==='weather'?`${P(G.start).name} is drawing the event card.`:G.phase==='weatherResult'?`${P(G.start).name} is reviewing the event.`:`${name} is taking their turn.`;
  return `<div class="panel waitpanel"><span class="label">Your catchment stays private</span><h2 style="font-size:25px">Waiting for ${esc(G.phase.startsWith('weather')?P(G.start).name:name)}</h2><p>${esc(msg)} The shared board updates automatically.</p><p class="note">You can check your own objectives while you wait. Use your usual voice or video call to negotiate.</p>${G.weather?`<div class="pill">${esc(G.weather.name)} · severity ${G.weather.sev}/5 · rain ${G.weather.rain} W</div>`:''}</div>`;
}
function spectatorPanel(){
  const who=G.phase.startsWith('weather')?P(G.start):P(G.cur);
  const status=G.phase==='end'?'Final results':esc(who.name)+' · '+(
    G.phase==='weather'?'drawing the event':G.phase==='weatherResult'?'reviewing the event':'taking a turn');
  const offer=G.pending
    ? `${esc(P(G.pending.from).name)} is waiting for ${esc(P(G.pending.to).name)} to answer an offer.`
    : 'No pending offer.';
  return `<section class="panel spectator-panel">
    <div><span class="label">Spectator view / 观众视角</span><h2 style="font-size:24px">${status}</h2>
      <p class="note">This view updates automatically. Secret objectives and bonus cards remain private. Spectators cannot play or confirm offers.</p></div>
    <div class="spectator-event">${eventCard(G.weather?.key)}
      <div><span class="label">Aquifer history</span><div class="chart">${aqChart()}</div><p class="note">${offer}</p></div></div>
    <div class="tscroll"><table class="tbl">
      <thead><tr><th>Player</th><th>Cash (M)</th><th>Water</th><th>VP so far</th><th>Net recharge</th><th>Objectives completed</th></tr></thead>
      <tbody>${G.players.map(p=>`<tr><td>${pChip(p)} ${esc(p.name)}</td><td>${p.money} M</td><td>${p.water} W</td><td>${vpTotal(p)}</td><td>${netRecharge(p)} W</td><td>${p.done.length}</td></tr>`).join('')}</tbody>
    </table></div></section>`;
}
function pendingOnline() {
  const q=G.pending;
  if(NET.me===q.to) return renderPending();
  if(NET.me===q.from) return `<div class="ov"><div class="sheet"><h2>Offer sent to ${esc(P(q.to).name)}</h2><p>They can accept or decline on their device.</p><button class="btn alt" data-net="cancelOffer">Cancel offer</button></div></div>`;
  return '';
}
function render() {
  const app=document.getElementById('app');
  if(NET.loading) {app.innerHTML='<div class="panel"><h2>Connecting to the council…</h2><p class="muted">正在连接游戏</p></div>';return;}
  let h='';
  if(!NET.room) h=renderSetup();
  else if(!G) h=lobby();
  else {
    h=roomBar()+renderTop().replace('<button class="ghost" data-act="askNew">New game</button>','<button class="ghost" data-net="leave">Leave room</button>')+renderBoard();
    if(NET.spectator) h+=spectatorPanel();
    else if(G.phase!=='end') {const current=G.cur;G.cur=NET.me;try{h+=renderDesk();}finally{G.cur=current;}}
    h+=`<details class="log"><summary>Game log</summary><div class="logl">${G.log.map(l=>`<div>${esc(l)}</div>`).join('')}</div></details>`;
    if(G.phase==='weather' && NET.me===G.start) h+=renderWeatherRoll();
    if(G.phase==='weatherResult' && NET.me===G.start) h+=renderWeatherResult();
    if(G.phase==='end') h+=renderEnd().replace('<button class="btn big" data-act="newgame">Play again</button>',NET.host?'<button class="btn big" data-net="rematch">Play again</button>':'<span class="note">The host can start a rematch.</span>');
    if(G.pending) h+=pendingOnline();
  }
  if(UI.rules) h+=renderRulesSheet();
  if(UI.confirmNew) h+='<div class="ov"><div class="sheet"><h2>Leave this room?</h2><p>Your seat and progress are saved in this browser. You can return from the home screen.</p><div class="field"><button class="btn" data-net="confirmLeave">Leave room</button><button class="btn alt" data-net="cancelLeave">Stay here</button></div></div></div>';
  app.innerHTML=h;
  if(G&&!isMyTurn()) app.querySelectorAll('[data-act="playBonus"],[data-act="target"],[data-act="swapObj"]').forEach(b=>b.disabled=true);
  if(NET.busy) app.querySelectorAll('button:not([data-act="closeRules"])').forEach(b=>b.disabled=true);
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-net],[data-act]'); if(!el||el.disabled) return;
  if(el.dataset.net) {
    switch(el.dataset.net) {
      case 'capacity': {const name=document.getElementById('online-name')?.value||'';remember('wc-name',name);rememberedRoom=document.getElementById('room-code')?.value||rememberedRoom;NET.capacity=+el.dataset.n;render();break;}
      case 'create': await enterRoom(true);break;
      case 'join': await enterRoom(false);break;
      case 'resume': await resumeSeat(el.dataset.code);break;
      case 'copy': await copyRoom();break;
      case 'copyWatch': await copyRoom(true);break;
      case 'watch': await watchRoom();break;
      case 'start': await sendCommand({act:'start'});break;
      case 'remove': await sendCommand({act:'removeMember',id:+el.dataset.id});break;
      case 'cancelOffer': await sendCommand({act:'cancelOffer'});break;
      case 'rematch': await sendCommand({act:'rematch'});break;
      case 'leave': UI.confirmNew=true;render();break;
      case 'cancelLeave': UI.confirmNew=false;render();break;
      case 'confirmLeave': disconnect();render();break;
    }
    return;
  }
  const act=el.dataset.act;
  if(act==='rules'||act==='closeRules') {UI.rules=act==='rules';render();return;}
  if(act==='toggleObj') {UI.showObj=!UI.showObj;render();return;}
  if(NET.busy||!G) return;
  if(['accept','decline'].includes(act)) {await sendCommand({act});return;}
  if(['draw','weatherContinue'].includes(act)) {await sendCommand({act});return;}
  if(!isMyTurn()||G.pending) return;
  let command=null;
  switch(act) {
    case 'tab': UI.tab=el.dataset.t;if(UI.tab==='alloc'&&!UI.alloc)autoAlloc();break;
    case 'toggleTile': if(UI.alloc)UI.alloc.on[+el.dataset.i]=el.checked;break;
    case 'jointPick': UI.joint=UI.joint&&UI.joint.type===el.dataset.t&&UI.joint.tile===+el.dataset.tile?null:{type:el.dataset.t,tile:+el.dataset.tile};break;
    case 'target': UI.target=+el.dataset.p;break;
    case 'tradeTo': UI.trade={to:+el.dataset.p,gm:0,gw:0,rm:0,rw:0};break;
    case 'autoAlloc': autoAlloc();break;
    case 'step': {
      const k=el.dataset.key,d=+el.dataset.d;
      if(k.startsWith('trade.')) UI.trade[k.slice(6)]=Math.max(0,UI.trade[k.slice(6)]+d);
      else if(k.startsWith('alloc.')) UI.alloc[k.slice(6)]=Math.max(0,(UI.alloc[k.slice(6)]||0)+d);
      else if(['pumpN','sellN'].includes(k)) UI[k]=Math.max(0,UI[k]+d);
      break;
    }
    case 'build': command={act,type:el.dataset.t,tile:+el.dataset.tile};break;
    case 'swapObj': command={act,uid:+el.dataset.u};break;
    case 'upgrade': command={act,id:+el.dataset.id};break;
    case 'jointWith': if(UI.joint)command={act:'proposeJoint',type:UI.joint.type,tile:UI.joint.tile,to:+el.dataset.p};break;
    case 'pump': command={act,n:UI.pumpN};break;
    case 'sell': command={act,n:UI.sellN};break;
    case 'proposeTrade': command={act,trade:UI.trade};break;
    case 'playBonus': command={act,index:+el.dataset.i,target:UI.target};break;
    case 'endTurn': {const current=G.cur;G.cur=NET.me;const summary=allocSummary();G.cur=current;if(!summary.ok){toast('You have allocated more water than you hold.');return;}command={act,alloc:UI.alloc};break;}
  }
  if(command) await sendCommand(command);else render();
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&NET.room)pollRoom();});
window.addEventListener('online',()=>pollRoom());
window.addEventListener('offline',()=>{NET.online=false;render();});
if(initialWatchCode)watchRoom(initialWatchCode);
else if(rememberedRoom&&readToken(rememberedRoom)) resumeSeat(rememberedRoom);
else {NET.loading=false;render();}
