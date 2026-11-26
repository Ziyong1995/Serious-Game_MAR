class ApiError extends Error { constructor(status,message) { super(message); this.status=status; } }
const fail=(condition,status,message)=>{if(!condition) throw new ApiError(status,message);};
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
const randomHex=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
async function digest(token) { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)); return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''); }
function roomCode() { const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>alphabet[n%alphabet.length]).join(''); }
function playerName(name) { fail(typeof name==='string',400,'Enter your name.'); name=name.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,24); fail(name.length>0,400,'Enter your name.'); return name; }
async function bodyOf(request) { const text=await request.text(); fail(text.length<=12000,413,'Request is too large.'); try { const b=JSON.parse(text); fail(b && typeof b==='object' && !Array.isArray(b),400,'Invalid request.'); return b; } catch(e) { if(e instanceof ApiError) throw e; throw new ApiError(400,'Invalid request.'); } }
function project(room,me,version) {
  const game=room.game?structuredClone(room.game):null;
  if(game) {
    delete game.bonusDeck;
    // The remaining composition is public (the UI shows odds); its draw order is private.
    game.deck=game.deck.slice().sort(); game.deckOrderHidden=true;
    for(const p of game.players) if(p.id!==me) {
      p.objectives=[]; p.bonus=[]; p.flags={}; p.insurance=0; p.streak=0; p.streakDry=false;
      if(game.weather?.results?.[p.id]) game.weather.results[p.id].notes=game.weather.results[p.id].notes.filter(n=>!n.includes('reserve'));
    }
  }
  return {code:room.code,capacity:room.capacity,version,me,host:me===0,spectator:me===null,members:room.members.map((m,id)=>({id,name:m.name})),game};
}
async function readRoom(db,code) {
  const row=await db.prepare('SELECT state, version FROM rooms_v31 WHERE code = ?').bind(code).first();
  fail(row,404,`Room not found. Check the code or ask the host for a link to an Online ${RELEASE} room.`);
  return {room:JSON.parse(row.state),version:row.version};
}
async function memberId(room,request) { const token=request.headers.get('Authorization')?.replace(/^Bearer /,''); fail(token && /^[a-f0-9]{64}$/.test(token),401,'Rejoin this room on the browser you used before.'); const hash=await digest(token); const me=room.members.findIndex(m=>m.tokenHash===hash); fail(me>=0,401,'This seat is no longer available.'); return me; }
async function persist(db,room,version) {
  const r=await db.prepare('UPDATE rooms_v31 SET state = ?, version = version + 1, updated_at = ? WHERE code = ? AND version = ?').bind(JSON.stringify(room),Date.now(),room.code,version).run();
  fail(r.meta.changes===1,409,'The game changed. Please try your action again.'); return version+1;
}
async function api(request,env) {
  const url=new URL(request.url);
  if(url.pathname==='/api/health') return json({ok:true,version:3,release:RELEASE,spectators:true,storage:!!env.DB});
  fail(env.DB,503,'The game storage is not available yet.');
  if(request.method==='POST') {
    const origin=request.headers.get('Origin'); fail(!origin || origin===url.origin,403,'Cross-site requests are not allowed.');
    fail((request.headers.get('Content-Type')||'').startsWith('application/json'),415,'Use JSON for game actions.');
  }
  if(url.pathname==='/api/rooms' && request.method==='POST') {
    const b=await bodyOf(request),name=playerName(b.name); fail([3,4,5].includes(b.capacity),400,'Choose 3, 4 or 5 players.');
    const token=randomHex(),tokenHash=await digest(token);
    for(let i=0;i<5;i++) {
      const code=roomCode(),room={code,capacity:b.capacity,members:[{name,tokenHash}],game:null,receipts:[]};
      const r=await env.DB.prepare('INSERT OR IGNORE INTO rooms_v31 (code, state, version, updated_at) VALUES (?, ?, 1, ?)').bind(code,JSON.stringify(room),Date.now()).run();
      if(r.meta.changes===1) return json({...project(room,0,1),token},201);
    }
    throw new ApiError(503,'Could not create a room. Please try again.');
  }
  const match=/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|action|watch))?$/.exec(url.pathname);
  fail(match,404,'Not found.'); const code=match[1],route=match[2];
  const {room,version}=await readRoom(env.DB,code);
  if(route==='watch'){
    fail(request.method==='GET',405,'Spectator view is read-only.');
    if(url.searchParams.get('since')===String(version)) return json({unchanged:true,version});
    return json(project(room,null,version));
  }
  if(route==='join' && request.method==='POST') {
    fail(!room.game,409,'This game has already started. Use your original browser to return to your seat.');
    fail(room.members.length<room.capacity,409,'This room is full.');
    const b=await bodyOf(request),name=playerName(b.name);
    fail(!room.members.some(m=>m.name.toLowerCase()===name.toLowerCase()),400,'That name is already in use in this room.');
    const token=randomHex(); room.members.push({name,tokenHash:await digest(token)}); const me=room.members.length-1;
    return json({...project(room,me,await persist(env.DB,room,version)),token},201);
  }
  const me=await memberId(room,request);
  if(!route && request.method==='GET') {
    if(url.searchParams.get('since')===String(version)) return json({unchanged:true,version});
    return json(project(room,me,version));
  }
  fail(route==='action' && request.method==='POST',405,'Method not allowed.');
  const b=await bodyOf(request);
  fail(typeof b.requestId==='string' && /^[a-zA-Z0-9-]{16,80}$/.test(b.requestId),400,'Invalid request identifier.');
  const actor=room.members[me].tokenHash;
  if(room.receipts.some(r=>r.id===b.requestId && r.actor===actor)) return json(project(room,me,version));
  fail(b.version===version,409,'The game changed. Please try your action again.');
  fail(typeof b.act==='string',400,'Missing action.');
  if(b.act==='start') {
    fail(me===0,403,'Only the host can start the game.'); fail(!room.game,409,'The game has already started.');
    fail(room.members.length===room.capacity,400,'Wait for all players to join before starting.');
    room.game=makeEngine().create(room.members.map(m=>m.name));
  } else if(b.act==='rematch') {
    fail(me===0 && room.game?.phase==='end',403,'The host can start a rematch after the game ends.');
    room.game=makeEngine().create(room.members.map(m=>m.name));
  } else if(b.act==='removeMember') {
    fail(me===0 && !room.game,403,'Only the host can remove players before the game starts.');
    fail(Number.isInteger(b.id) && b.id>0 && b.id<room.members.length,400,'Invalid player.'); room.members.splice(b.id,1);
  } else {
    fail(room.game,400,'The game has not started yet.');
    try { room.game=makeEngine().execute(room.game,me,b); } catch(e) { throw new ApiError(400,e.message); }
  }
  room.receipts.push({id:b.requestId,actor}); room.receipts=room.receipts.slice(-128);
  return json(project(room,me,await persist(env.DB,room,version)));
}
export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')) { try { return await api(request,env); } catch(e) { if(!(e instanceof ApiError)) console.error('Game API error',e.message); return json({error:e instanceof ApiError?e.message:'The server could not complete this action. Please try again.'},e.status||500); } }
    if(url.pathname==='/favicon.ico') return new Response(null,{status:204});
    if(url.pathname!=='/' || request.method!=='GET') return new Response('Not found',{status:404});
    return new Response(PAGE,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.openai.com"}});
  }
};
