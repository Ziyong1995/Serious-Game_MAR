import assert from 'node:assert/strict';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import worker from '../game-worker.mjs';
import {openDatabase} from '../local-db.mjs';
const DB=openDatabase(':memory:');const page=await (await worker.fetch(new Request('http://localhost/'),{DB},{})).text();const source=page.match(/<script>([\s\S]*?)<\/script>/)[1];
function storage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}
function client(name='',href='http://localhost/',localStorage=storage()){
  const app={innerHTML:'',querySelectorAll:()=>[]},inputs={'online-name':{value:name},'room-code':{value:''}},listeners={};let copied='';
  const context=vm.createContext({document:{hidden:false,getElementById:id=>id==='app'?app:id==='toast'?{hidden:true,textContent:''}:inputs[id],addEventListener:(event,fn)=>listeners[event]=fn},location:{href},history:{replaceState(){}},localStorage,sessionStorage:storage(),navigator:{clipboard:{writeText:async text=>{copied=text;}}},window:{addEventListener(){}},URL,crypto,AbortController,structuredClone,clearTimeout(){},setTimeout(){return 1;},console,fetch:(path,opts={})=>worker.fetch(new Request(new URL(path,'http://localhost'),opts),{DB},{})});
  vm.runInContext(source,context);
  return {app,inputs,context,localStorage,run:s=>vm.runInContext(s,context),click:dataset=>listeners.click({target:{closest:()=>({dataset,disabled:false})}}),copied:()=>copied};
}
function edit(code,fn){const row=DB.sqlite.prepare('SELECT state FROM rooms_v3 WHERE code=?').get(code),state=JSON.parse(row.state);fn(state);DB.sqlite.prepare('UPDATE rooms_v3 SET state=?,version=version+1 WHERE code=?').run(JSON.stringify(state),code);}
const a=client('Ana'),b=client('Ben'),c=client('Chiara'),observer=client();
assert.match(a.app.innerHTML,/Watch this room/);await a.click({act:'rules'});assert.match(a.app.innerHTML,/Final scoring/);await a.click({act:'closeRules'});
await a.run('NET.capacity=3;enterRoom(true)');const code=a.run('NET.room');
for(const player of [b,c]){player.inputs['room-code'].value=code;await player.run('enterRoom(false)');}
await observer.run(`watchRoom('${code}')`);assert.equal(observer.run('NET.spectator'),true);await a.run('pollRoom(true)');assert.match(a.app.innerHTML,/3 \/ 3/);
await a.run("sendCommand({act:'start'})");for(const player of [b,c,observer])await player.run('pollRoom(true)');
assert.match(a.app.innerHTML,/Draw the card/);assert.doesNotMatch(b.app.innerHTML,/data-act="draw"/);assert.doesNotMatch(observer.app.innerHTML,/data-act="draw"/);assert.doesNotMatch(observer.app.innerHTML,/data-act="swapObj"/);
assert.equal(observer.run('G.players.every(p=>p.objectives.length===0&&p.bonus.length===0)'),true);
await a.click({net:'copyWatch'});assert.equal(new URL(a.copied()).searchParams.get('watch'),code);assert.equal(new URL(a.copied()).searchParams.get('room'),null);
const anotherObserver=client('',a.copied(),a.localStorage);await new Promise(setImmediate);assert.equal(anotherObserver.run('NET.spectator'),true);assert.equal(anotherObserver.run('NET.me'),null);
edit(code,room=>{room.game.deck=['winter'];for(const p of room.game.players){p.land=['city','agri','forest','wetland'];p.geo='silt';}});
await a.run('pollRoom(true)');await a.click({act:'draw'});await a.click({act:'weatherContinue'});for(const player of [b,c,observer])await player.run('pollRoom(true)');
assert.match(a.app.innerHTML,/Build on city/);assert.doesNotMatch(b.app.innerHTML,/data-act="build"/);assert.match(observer.app.innerHTML,/Normal rainfall/);
await a.click({act:'build',t:'well',tile:'0'});assert.equal(a.run('G.structs[0].tile'),0);
await a.click({act:'jointPick',t:'storage',tile:'3'});assert.equal(a.run('UI.joint.tile'),3);await a.click({act:'jointWith',p:'1'});await b.run('pollRoom(true)');
assert.match(b.app.innerHTML,/Ben, do you accept/);assert.doesNotMatch(observer.app.innerHTML,/data-act="accept"/);await b.click({act:'accept'});await a.run('pollRoom(true)');assert.equal(a.run('G.pending'),null);assert.equal(a.run('G.structs.filter(s=>s.owners.length===2).length'),1);
await a.click({act:'pump'});await a.click({act:'toggleObj'});assert.match(a.app.innerHTML,/Swap · 2 M/);
const ownUid=a.run('G.players[0].objectives[0].uid');await a.click({act:'swapObj',u:String(ownUid)});assert.equal(a.run('G.players[0].r.swapped'),true);
await a.click({act:'tab',t:'alloc'});await a.click({act:'step',key:'alloc.xCity',d:'1'});await a.click({act:'step',key:'alloc.xAgri',d:'1'});assert.equal(a.run('UI.alloc.xCity'),1);assert.equal(a.run('UI.alloc.xAgri'),1);
await a.click({act:'endTurn'});for(const player of [b,c,observer])await player.run('pollRoom(true)');assert.equal(b.run('G.cur'),1);assert.match(b.app.innerHTML,/data-act="build"/);assert.doesNotMatch(a.app.innerHTML,/data-act="build"/);
assert.equal(b.run('G.players[0].objectives.length'),0);const oldVersion=observer.run('NET.version');await observer.run("sendCommand({act:'draw'})");assert.equal(observer.run('NET.version'),oldVersion);
const token=b.run('NET.token');b.run('disconnect(false)');await b.run(`resumeSeat('${code}')`);assert.equal(b.run('NET.token'),token);assert.equal(b.run('NET.me'),1);assert.equal(b.run('NET.members.length'),3);
// Observe a committed action without becoming the active player.
await b.run("sendCommand({act:'deposit',n:1})");await observer.run('pollRoom(true)');assert.equal(observer.run('G.players[1].bank'),1);assert.match(observer.app.innerHTML,/Share spectator view/);
// Final score view remains read-only and private for spectators.
edit(code,room=>{room.game.phase='end';room.game.round=8;});await observer.run('pollRoom(true)');assert.match(observer.app.innerHTML,/wins with/);assert.equal(observer.run('G.players.every(p=>p.objectives.length===0&&p.bonus.length===0)'),true);
DB.sqlite.close();console.log('PASS: four independent clients cover player creation/join, shared spectator links, private views, v3 draw/build/tile co-funding/objective swapping/extra supply, live synchronization and seat reconnect. Actual browser layout is not covered.');
