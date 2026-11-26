import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {openDatabase} from '../local-db.mjs';
import worker,{makeEngine} from '../game-worker.mjs';
let checks=0;
function eq(a,b,n){assert.deepEqual(a,b,n);checks++;}function ok(v,n){assert.ok(v,n);checks++;}
const DB=openDatabase(':memory:');
DB.sqlite.exec("CREATE TABLE rooms (code TEXT PRIMARY KEY, state TEXT); INSERT INTO rooms VALUES ('OLD001','old-game-untouched');");
DB.sqlite.exec(`CREATE TABLE rooms_v3 (code TEXT PRIMARY KEY, state TEXT, version INTEGER, updated_at INTEGER);
  INSERT INTO rooms_v3 VALUES ('OLD234','v3-game-untouched',7,123);`);
async function call(path,body,token){const response=await worker.fetch(new Request('http://localhost'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})}),{DB},{});return {status:response.status,data:await response.json()};}
async function create(n){
  const host=await call('/api/rooms',{name:'Ana',capacity:n});
  eq(host.status,201,'create room');
  const code=host.data.code,tokens=[host.data.token];
  for(let i=1;i<n;i++){
    const r=await call(`/api/rooms/${code}/join`,{name:'Player '+i});
    eq(r.status,201,'join room');
    tokens.push(r.data.token);
  }
  return {
    code,tokens,
    async get(i=0){
      const r=await call('/api/rooms/'+code,null,tokens[i]);
      eq(r.status,200,'read own seat');
      return r.data;
    },
    async act(i,act,values={},extra={}){
      return call(`/api/rooms/${code}/action`,{
        act,...values,version:(await this.get(i)).version,requestId:randomUUID(),...extra
      },tokens[i]);
    },
    edit(fn){
      const row=DB.sqlite.prepare('SELECT state FROM rooms_v31 WHERE code=?').get(code);
      const state=JSON.parse(row.state);
      fn(state);
      DB.sqlite.prepare('UPDATE rooms_v31 SET state=?,version=version+1 WHERE code=?').run(JSON.stringify(state),code);
    }
  };
}
eq((await call('/api/health')).data.release,'3.1.0','health shows the deployed release');
eq((await call('/api/rooms/OLD234/watch')).status,404,'older rooms are isolated from this release');
const release=JSON.parse(await readFile(new URL('../version.json',import.meta.url),'utf8'));eq(release.gameVersion,3,'release version');
const r=await create(3);eq((await call('/api/rooms/'+r.code)).status,401,'private state requires identity');
const lobbyWatch=await call(`/api/rooms/${r.code}/watch`);eq(lobbyWatch.status,200,'spectate before start');eq(lobbyWatch.data.members.length,3,'no spectator seat');eq(lobbyWatch.data.me,null,'spectator is not a player');
eq((await call(`/api/rooms/${r.code}/action`,{act:'start',requestId:randomUUID(),version:lobbyWatch.data.version})).status,401,'spectator cannot act');
eq((await r.act(1,'start')).status,403,'host-only start');eq((await r.act(0,'start')).status,200,'start latest game');let state=await r.get();eq(state.game.v,3,'engine version 3');
eq(state.game.players[0].objectives.length,2,'own objectives available');eq(state.game.players[1].objectives.length,0,'other objectives hidden');ok(!('bonusDeck' in state.game),'bonus order hidden');
let spectator=await call(`/api/rooms/${r.code}/watch`);ok(spectator.data.game.players.every(p=>p.objectives.length===0&&p.bonus.length===0),'spectator gets no private cards');eq(spectator.data.game.deck,[...spectator.data.game.deck].sort(),'only canonical deck composition is public');eq(spectator.data.game.deck.length,34,'34 weighted event cards');
ok(!JSON.stringify(spectator.data).includes('tokenHash'),'credential hashes absent from public response');
eq((await r.act(1,'draw')).status,400,'only start player draws');r.edit(room=>{room.game.deck=['winter'];});eq((await r.act(0,'draw',{card:'wardrought'})).data.game.weather.key,'winter','server controls actual draw');
eq((await r.act(0,'weatherContinue')).status,200,'turn begins');
eq((await r.act(1,'build',{type:'well',tile:0})).status,400,'out-of-turn build blocked');
// Force known legal land in an isolated test game; no production API permits state editing.
r.edit(room=>{const p=room.game.players[0];p.land=['city','agri','forest','wetland'];p.geo='silt';p.money=100;p.objectives=[];room.game.structs=[];});
eq((await r.act(0,'build',{type:'repair',tile:1})).status,400,'repair requires city land');eq((await r.act(0,'build',{type:'flood',tile:2})).status,400,'flood structures cannot occupy forest');eq((await r.act(0,'build',{type:'well',tile:0})).status,200,'well on selected tile');
eq((await r.act(0,'build',{type:'storage',tile:0})).status,400,'one structure per tile');eq((await r.act(0,'build',{type:'well',tile:1})).status,200,'second well');eq((await r.act(0,'build',{type:'well',tile:2})).status,400,'maximum two hosted wells');
eq((await r.act(0,'build',{type:'storage',tile:-1})).status,400,'negative tile rejected');
let firstWell=(await r.get()).game.structs[0];eq((await r.act(0,'upgrade',{id:firstWell.id})).status,200,'owner upgrades');
r.edit(room=>{room.game.structs.push({id:room.game.nextId++,type:'storage',tile:0,host:1,owners:[1],level:1});});const foreign=(await r.get()).game.structs.find(s=>s.host===1);
eq((await r.act(0,'upgrade',{id:foreign.id})).status,400,'cannot upgrade a nonowned structure');
eq((await r.act(0,'proposeJoint',{type:'storage',tile:3,to:1})).status,200,'joint construction on legal free tile');eq((await r.act(2,'accept')).status,400,'only recipient can accept');eq((await r.act(1,'accept')).status,200,'recipient accepts from own device');
ok((await r.get()).game.structs.some(s=>s.host===0&&s.tile===3&&s.owners.length===2),'shared structure occupies host tile');
eq((await r.act(0,'proposeTrade',{trade:{to:1,gm:1,gw:0,rm:0,rw:1}})).status,200,'trade proposal');eq((await r.act(0,'pump',{n:1})).status,400,'pending offer blocks unrelated actions');eq((await r.act(1,'accept')).status,200,'trade acceptance');
r.edit(room=>{const p=room.game.players[0];p.objectives=[{uid:9000,type:'cofund',tier:1,l:1,baseId:room.game.nextId+100,vp:3}];p.r.swapped=false;p.money=20;});
eq((await r.act(0,'swapObj',{uid:9000})).status,200,'swap private objective');eq((await r.act(0,'swapObj',{uid:(await r.get()).game.players[0].objectives[0]?.uid})).status,400,'only one swap per turn');
const before=await r.get(),rid=randomUUID();
const sold=await r.act(0,'sell',{n:1},{requestId:rid});
eq(sold.status,200,'sell water');
eq(sold.data.game.players[0].money,before.game.players[0].money+1,'sale adds one cash');
eq(sold.data.game.players[0].water,before.game.players[0].water-1,'sale transfers one water');
const sellAction={act:'sell',n:1,version:before.version,requestId:rid};
const duplicated=await call(`/api/rooms/${r.code}/action`,sellAction,r.tokens[0]);
eq(duplicated.data,sold.data,'retry does not make a second sale');
eq((await call(`/api/rooms/${r.code}/action`,{...sellAction,requestId:randomUUID()},r.tokens[0])).status,409,'stale updates rejected');
eq((await r.act(0,'deposit',{n:1})).status,400,'retired banking action is unavailable');
ok(!('bank' in (await r.get()).game.players[0]),'fresh games have no bank account');

// With every tile occupied and no replacement objective, a swap must leave the room unchanged.
r.edit(room=>{
  const g=room.game,p=g.players[0];
  g.round=8; g.weather={key:'summer',wet:false}; g.contamEver=false;
  g.aquifer=g.aqStart+1; p.money=2; p.water=0; p.r.swapped=false;
  p.land=['city','agri','city','city'];
  g.structs=g.players.flatMap(q=>q.land.map((land,tile)=>({
    id:g.nextId++,host:q.id,owners:[q.id],tile,level:3,
    type:land==='city'?'repair':land==='agri'?'flood':'storage'
  })));
  p.objectives=['irrigate','citysupply'].map(type=>({
    uid:g.nextId++,type,tier:3,pc:100,r:2,run:0,vp:6
  }));
});
const beforeBlockedSwap=await r.get();
const blockedSwap=await r.act(0,'swapObj',{uid:beforeBlockedSwap.game.players[0].objectives[0].uid});
eq(blockedSwap.status,400,'cannot swap without an eligible replacement');
ok(blockedSwap.data.error.includes('keep this one and your money'),'player sees why the swap was declined');
eq(await r.get(),beforeBlockedSwap,'declined swap preserves money, objectives and room version');
// Exact accounting for extra supply and net recharge credits.
function accountingFixture(){const g=makeEngine().create(['A','B','C']);g.cur=0;g.phase='turn';g.weather={wet:false,key:'summer',agriExtra:0};const p=g.players[0];p.land=['city','agri','forest','wetland'];p.geo='silt';p.money=20;p.water=8;p.objectives=[];p.r={pumped:0,recharged:0,infilUsed:0};g.structs=[{id:g.nextId++,type:'well',level:2,host:0,tile:0,owners:[0]}];return g;}
{
 const g=accountingFixture(),out=makeEngine().execute(g,0,{act:'endTurn',alloc:{on:{0:true,1:true},recharge:2,xCity:0,xAgri:0}});eq(out.players[0].money,30,'income 9 + net recharge 2 - maintenance 1');eq(out.players[0].water,2,'supplied water and recharge removed');eq(out.aquifer,g.aquifer+2,'recharge enters shared reserve');eq(out.players[0].cityInject,2,'infiltration well on city counts for injection');
}
{
 const g=accountingFixture();g.players[0].r.pumped=3;const out=makeEngine().execute(g,0,{act:'endTurn',alloc:{on:{0:true,1:true},recharge:2,xCity:0,xAgri:0}});eq(out.players[0].money,28,'no positive credit for pumping more than recharging');
}
{
 const g=accountingFixture(),out=makeEngine().execute(g,0,{act:'endTurn',alloc:{on:{0:true,1:true},recharge:0,xCity:1,xAgri:1}});eq(out.players[0].money,30,'extra city and farmland water each earns one money');
 assert.throws(()=>makeEngine().execute(g,0,{act:'endTurn',alloc:{on:{0:true,1:true},recharge:0,xCity:3,xAgri:0}}));checks++;
}
{
 const g=accountingFixture();g.weather.wet=true;assert.throws(()=>makeEngine().execute(g,0,{act:'endTurn',alloc:{on:{0:true,1:true},recharge:1,xCity:0,xAgri:0}}));checks++;
 const full=makeEngine().create(['A','B','C']);full.deck=['modflood'];const out=makeEngine().execute(full,0,{act:'draw'});ok(out.players.every(p=>p.r.infilUsed===0),'automatic infiltration also closed in floods');
 full.deck=['wardrought'];const war=makeEngine().execute(full,0,{act:'draw'});eq(war.war,1,'population shock persists');eq(makeEngine().inspect(war,0).demand.find(d=>d.t==='city').need,3,'city demand rises permanently');
}
{
  const g=accountingFixture();
  g.players[0].money=60; g.players[1].money=70; g.players[2].money=0;
  g.players[2].vp.objectives=1;
  const scores=makeEngine().inspect(g,0).score;
  eq(scores.map(({p,total})=>[p.id,total]),[[2,1],[1,0],[0,0]],'cash breaks VP ties without adding points');
}
{
  const g=accountingFixture();
  g.phase='weather'; g.deck=['modflood'];
  g.players[0].land=['city','agri','city','agri'];
  g.structs[0].level=3;
  const out=makeEngine().execute(g,0,{act:'draw'});
  eq(out.structs.map(s=>s.level),[1],'flood returns an upgraded facility to level one');
  eq(out.players[0].vp.flood,-1,'remaining damage costs a point and leaves the facility standing');
}
// All supported group sizes play eight complete rounds through the real API.
for(const n of [3,4,5]){
 const match=await create(n);await match.act(0,'start');let moves=0,oldObjectiveIds=[];
 while(true){
  const s=await match.get(),g=s.game;if(g.phase==='end')break;ok(moves++<70,'game progresses');let pid=g.cur,act,values={};
  if(g.phase==='weather'){pid=g.start;act='draw';}
  else if(g.phase==='weatherResult'){pid=g.start;act='weatherContinue';}
  else {act='endTurn';values={alloc:makeEngine().inspect(g,pid).allocation};if(g.ti===n-1&&[3,6].includes(g.round))oldObjectiveIds=g.players.flatMap(p=>p.objectives.map(o=>o.uid));}
  const out=await match.act(pid,act,values);eq(out.status,200,`${n}-player ${act}: ${out.data.error||''}`);const next=out.data.game;
  ok(next.aquifer>=0&&next.aquifer<=next.aqMax,'aquifer bounded');ok(next.players.every(p=>[p.money,p.water].every(v=>Number.isSafeInteger(v)&&v>=0)),'resource balances valid');
  if(act==='endTurn'&&next.phase==='weather'&&[4,7].includes(next.round)){ok(next.players.flatMap(p=>p.objectives).every(o=>!oldObjectiveIds.includes(o.uid)),'old tier objectives expire');}
 }
 const end=await match.get();eq(end.game.round,8,'ends in round eight');eq(end.game.history.length,9,'all rounds recorded');eq(end.game.drawn.length,8,'one event card per round');
 const publicEnd=await call(`/api/rooms/${match.code}/watch`);ok(publicEnd.data.game.players.every(p=>p.objectives.length===0&&p.bonus.length===0),'spectator privacy holds after game end');
 eq((await match.act(0,'rematch')).status,200,'host rematch');
}
eq(DB.sqlite.prepare("SELECT state FROM rooms WHERE code='OLD001'").get().state,'old-game-untouched','legacy database table preserved');
eq(DB.sqlite.prepare("SELECT state FROM rooms_v3 WHERE code='OLD234'").get().state,'v3-game-untouched','v3 database table preserved');
DB.sqlite.close();
// Actual release server: serving, HTTPS reverse proxy, concurrency, spectator link and restart.
const tempBase=resolve(tmpdir()),temp=await mkdtemp(join(tempBase,'watershed-v3-test-'));if(dirname(temp)!==tempBase||!basename(temp).startsWith('watershed-v3-test-'))throw Error('Unexpected temporary directory');
let child,origin;
async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DB_PATH:join(temp,'db.sqlite')},stdio:['ignore','pipe','pipe']});origin=await new Promise((yes,no)=>{const timer=setTimeout(()=>no(Error('Server startup timed out')),10000);child.once('error',e=>{clearTimeout(timer);no(e);});child.stdout.on('data',d=>{const m=String(d).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);yes(m[0]);}});});}
async function stop(){if(child?.exitCode===null){const end=once(child,'exit');child.kill('SIGTERM');await end;}}
async function http(path,body,token,headers={}){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};}
try{
 await start();eq((await fetch(origin+'/')).status,200,'release homepage');const host=await http('/api/rooms',{name:'Host',capacity:3});const code=host.data.code,token=host.data.token;
 for(let i=1;i<3;i++)eq((await http(`/api/rooms/${code}/join`,{name:'Guest '+i})).status,201,'HTTP guest');
 const snapshot=await http('/api/rooms/'+code,null,token);const attempts=await Promise.all([0,1].map(()=>http(`/api/rooms/${code}/action`,{act:'start',version:snapshot.data.version,requestId:randomUUID()},token)));eq(attempts.map(r=>r.status).sort(),[200,409],'concurrent start commits once');
 const current=await http('/api/rooms/'+code,null,token),watched=await http(`/api/rooms/${code}/watch`);ok(watched.data.spectator&&watched.data.game.players.every(p=>p.objectives.length===0),'public watch route works');
 eq((await http(`/api/rooms/${code}/action`,{act:'draw',version:current.data.version,requestId:randomUUID()},null)).status,401,'spectator request cannot draw');
 eq((await http(`/api/rooms/${code}/action`,{act:'draw',version:current.data.version,requestId:randomUUID()},token,{Origin:'https://foreign.example'})).status,403,'foreign origin blocked');
 eq((await http(`/api/rooms/${code}/action`,{act:'draw',version:current.data.version,requestId:randomUUID()},token,{'X-Forwarded-Proto':'https',Origin:origin.replace('http:','https:')})).status,200,'Render HTTPS proxy supported');
 const saved=await http('/api/rooms/'+code,null,token);await stop();await start();const restored=await http('/api/rooms/'+code,null,token);eq(restored.data.game,saved.data.game,'persistent restart preserves event and private seat');eq((await http(`/api/rooms/${code}/watch`)).status,200,'watchers reconnect after restart');
}finally{await stop();await rm(temp,{recursive:true,force:true});}
console.log(`PASS: ${checks} checks. Updated scoring and floods, eight-round games with 3/4/5 players, spectator permissions, trade and co-funding, concurrency, HTTPS and persistent restart.`);
