import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, MiniEngine, createRoom, getGames, joinRoom, sessionKey, saveSession, loadSession, removeSession } from '../dist/mini-engine.js';

class Socket {
  static sockets = [];
  readyState = 0;
  sent = [];
  constructor(url) { this.url = url; Socket.sockets.push(this); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
const snapshot = version => ({code:'ABCDEF', version, public_state:{votes:{}}, players:[], you:{role:'host'}, settings:{}, status:'lobby'});
const attach = options => {
  const client = new MiniEngine({code:' abcdef ', token:'secret', WebSocket:Socket, baseUrl:'https://party.test', ...options}).connect();
  const socket = Socket.sockets.at(-1);
  socket.open();
  socket.receive({type:'snapshot', room:snapshot(2)});
  return {client, socket};
};

test('ApiClient sends a Turnstile token only when one is given', async () => {
  const calls = [];
  const fetch = async (url, options) => { calls.push({url, ...options}); return {ok:true, status:200, json:async()=>({})}; };
  const api = new ApiClient({baseUrl:'https://party.test', accountToken:'account', fetch});
  const dani = {username:'dani', password:'correct horse battery', display_name:'Dani', email:'dani@example.com'};
  await api.register(dani);
  await api.register(dani, {turnstileToken:'widget'});
  await api.setEmail('dani@example.com', {turnstileToken:'again'});
  await api.accountConfig();
  assert.equal(calls[0].headers.has('X-Turnstile-Token'), false);
  assert.equal(calls[1].headers.get('X-Turnstile-Token'), 'widget');
  assert.equal(calls[2].headers.get('X-Turnstile-Token'), 'again');
  assert.equal(calls[2].headers.get('Authorization'), 'Bearer account');
  assert.equal(calls[3].url, 'https://party.test/api/v1/accounts/config');
});

test('ApiClient scopes account bearer and legacy helpers keep relative endpoints', async () => {
  const calls = [];
  const fetch = async (url, options) => { calls.push({url, ...options}); return {ok:true, status:200, json:async()=>({code:'ABCDEF'})}; };
  const api = new ApiClient({baseUrl:'https://party.test/', accountToken:'account', fetch});
  await api.createRoom({game_id:'vote'});
  await api.joinRoom(' abcdef ', 'Cas');
  await api.getRoom('abcdef', 'room');
  await api.stats();
  assert.equal(calls[0].url, 'https://party.test/api/v1/rooms');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer account');
  assert.equal(calls[1].url, 'https://party.test/api/v1/rooms/ABCDEF/join');
  assert.equal(calls[2].headers.get('Authorization'), 'Bearer room');
  globalThis.fetch = fetch;
  await createRoom({game_id:'vote'});
  await joinRoom('abcdef', 'Cas');
  assert.equal(calls[4].url, '/api/v1/rooms');
  assert.equal(calls[5].url, '/api/v1/rooms/ABCDEF/join');
  await api.displayToken('abcdef', 'host-secret');
  assert.equal(calls[6].url, 'https://party.test/api/v1/rooms/ABCDEF/display-token');
  assert.equal(calls[6].method, 'POST');
  assert.equal(calls[6].headers.get('Authorization'), 'Bearer host-secret');
});

test('HTTP failures retain server code/status, logout handles 204', async () => {
  const api = new ApiClient({fetch:async()=>({ok:false,status:409,json:async()=>({error:{code:'room_full',message:'Vol'}})})});
  await assert.rejects(api.joinRoom('abcdef','Cas'), error=>error.code==='room_full'&&error.status===409);
  const empty = new ApiClient({fetch:async()=>({ok:true,status:204})});
  assert.equal(await empty.logout(), null);
});

test('auth precedes readiness, snapshots are semantic and commands use current versions', async () => {
  const client = new MiniEngine({code:'ABCDEF', token:'secret', WebSocket:Socket, baseUrl:'https://party.test'}).connect();
  const socket = Socket.sockets.at(-1);
  assert.equal(socket.url, 'wss://party.test/api/v1/rooms/ABCDEF/ws');
  socket.open();
  assert.deepEqual(socket.sent, [{type:'auth',token:'secret'}]);
  await assert.rejects(client.action('vote'), /verbonden/);
  const waiting = client.waitForSnapshot();
  socket.receive({type:'snapshot',room:snapshot(3)});
  assert.equal((await waiting).version, 3);
  assert.equal(client.connected, true);
  const pending = client.configure({display_enabled:false});
  assert.equal(socket.sent.at(-1).expected_version, 3);
  socket.receive({type:'ack', request_id:socket.sent.at(-1).request_id});
  await pending;
  client.close();
});

test('action ids are unique by default and can be supplied for explicit retries', async () => {
  const {client,socket}=attach();
  for (const options of [undefined,undefined,{actionId:'known'}]) {
    const pending=client.action('vote',{choice:'yes'},options);
    socket.receive({type:'ack',request_id:socket.sent.at(-1).request_id});
    await pending;
  }
  const actions=socket.sent.filter(frame=>frame.type==='action');
  assert.notEqual(actions[0].action_id, actions[1].action_id);
  assert.equal(actions[2].action_id,'known');
  assert.ok(actions[0].action_id.length<=64);
  client.close();
});

test('disconnect rejects commands and reconnect authenticates without replaying', async () => {
  const {client,socket}=attach({reconnectDelay:1});
  const pending=client.action('vote');
  socket.close();
  await assert.rejects(pending,/Verbinding/);
  await new Promise(resolve=>setTimeout(resolve,20));
  const next=Socket.sockets.at(-1);
  assert.notEqual(next,socket);
  next.open();
  assert.deepEqual(next.sent,[{type:'auth',token:'secret'}]);
  socket.receive({type:'snapshot',room:snapshot(99)});
  assert.equal(client.room.version,2);
  next.receive({type:'snapshot',room:snapshot(4)});
  assert.equal(client.room.version,4);
  client.close();
});

test('terminal auth failure stops retry and explicit resume restores connection', async () => {
  const client=new MiniEngine({code:'ABCDEF',token:'secret',WebSocket:Socket,baseUrl:'https://party.test',reconnectDelay:1}).connect();
  const first=Socket.sockets.at(-1); first.open();
  first.receive({type:'error',error:{code:'unauthorized',message:'Invalid'}});
  const count=Socket.sockets.length;
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(Socket.sockets.length,count);
  client.resume();
  assert.notEqual(Socket.sockets.at(-1),first);
  client.close();
});

test('once removes itself, waits can time out/abort/close and ready is correlated', async () => {
  const {client,socket}=attach({requestTimeout:5});
  let count=0; client.once('snapshot',()=>count++);
  socket.receive({type:'snapshot',room:snapshot(3)});
  socket.receive({type:'snapshot',room:snapshot(4)});
  assert.equal(count,1);
  await assert.rejects(client.waitForSnapshot(room=>room.version>10,{timeout:5}),/snapshot/i);
  const controller=new AbortController();
  const aborted=client.waitForSnapshot(()=>false,{signal:controller.signal}); controller.abort();
  await assert.rejects(aborted,error=>error.name==='AbortError');
  const pending=client.ready(true);
  assert.equal(socket.sent.at(-1).ready,true);
  await assert.rejects(pending,/Geen bevestiging/);
  assert.equal(client.pending.size,0);
  const closed=client.waitForSnapshot(()=>false);
  client.close(); await assert.rejects(closed,/gesloten/);
});

test('room sessions keep compatible keys and reject corrupt credentials', () => {
  const entries=new Map();
  const storage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
  const credentials={code:'ABCDEF',token:'secret',role:'host',player_id:null};
  saveSession(credentials,storage);
  assert.equal(sessionKey(' abcdef ','host'),'mini-engine:ABCDEF:host');
  assert.deepEqual(loadSession('abcdef','host',storage),credentials);
  entries.set(sessionKey('abcdef','player'),'{bad');
  assert.equal(loadSession('abcdef','player',storage),null);
  removeSession('abcdef','host',storage);
  assert.equal(loadSession('abcdef','host',storage),null);
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sender = id => ({role:'player', player_id:id});

test('realtime emit is fire and forget, targeted and never queued while offline', async () => {
  const offline = new MiniEngine({code:'ABCDEF', token:'secret', WebSocket:Socket, baseUrl:'https://party.test'});
  assert.equal(offline.realtime.emit('buzz'), false);
  const {client,socket}=attach({reconnectDelay:1});
  assert.equal(client.realtime.emit('buzz', {at:1}, {to:['p1','p2'], echo:true}), true);
  assert.equal(client.realtime.emit('pressed'), true);
  assert.deepEqual(socket.sent.slice(-2), [
    {type:'rt.emit', channel:'buzz', data:{at:1}, to:['p1','p2'], echo:true},
    {type:'rt.emit', channel:'pressed', data:null},
  ]);
  assert.equal(client.pending.size, 0);
  socket.close();
  assert.equal(client.realtime.emit('buzz'), false);
  await wait(20);
  const next=Socket.sockets.at(-1);
  next.open();
  next.receive({type:'snapshot', room:snapshot(3)});
  assert.deepEqual(next.sent, [{type:'auth', token:'secret'}]);
  client.close();
  assert.equal(client.realtime.emit('buzz'), false);
});

test('realtime events reach channel and wildcard listeners until unsubscribed', () => {
  const {client,socket}=attach();
  const seen=[];
  const off=client.realtime.on('buzz', (data, from, ts, channel) => seen.push(['buzz', data, from, ts, channel]));
  client.realtime.on('*', (data, from, ts, channel) => seen.push(['*', data, from.player_id, ts, channel]));
  socket.receive({type:'rt.event', channel:'buzz', data:{x:1}, from:sender('p1'), ts:100});
  socket.receive({type:'rt.event', channel:'emoji', data:'🎉', from:{role:'display', player_id:null}, ts:101});
  off();
  socket.receive({type:'rt.event', channel:'buzz', data:2, from:sender('p2'), ts:102});
  assert.deepEqual(seen, [
    ['buzz', {x:1}, sender('p1'), 100, 'buzz'],
    ['*', {x:1}, 'p1', 100, 'buzz'],
    ['*', '🎉', null, 101, 'emoji'],
    ['*', 2, 'p2', 102, 'buzz'],
  ]);
  client.close();
});

test('realtime values coalesce per key, apply locally and are flushed at most every interval', async () => {
  const {client,socket}=attach({realtime:{setInterval:25}});
  const seen=[];
  client.realtime.onValue('kart', (value, from, ts, key) => seen.push([key, value, from.role]));
  client.realtime.set('kart', {x:1});
  client.realtime.set('kart', {x:2});
  client.realtime.set('typing', true);
  client.realtime.set('kart', {x:3});
  const sets=()=>socket.sent.filter(frame=>frame.type==='rt.set');
  assert.deepEqual(sets(), [{type:'rt.set', key:'kart', value:{x:1}}]);
  assert.deepEqual(client.realtime.value('host', 'kart'), {x:3});
  assert.deepEqual(client.realtime.value({role:'host', player_id:null}, 'typing'), true);
  assert.equal(seen.length, 3);
  await wait(40);
  assert.deepEqual(sets().slice(1), [{type:'rt.set', key:'kart', value:{x:3}}, {type:'rt.set', key:'typing', value:true}]);
  client.realtime.set('typing', null);
  await wait(40);
  assert.deepEqual(sets().at(-1), {type:'rt.set', key:'typing', value:null});
  assert.equal(client.realtime.value('host', 'typing'), undefined);
  client.close();
});

test('realtime values follow the server, are rebuilt after reconnect and cleared on terminal close', async () => {
  const {client,socket}=attach({reconnectDelay:1});
  const seen=[];
  client.realtime.onValue('*', (value, from, ts, key) => seen.push([from.player_id, key, value, ts]));
  socket.receive({type:'rt.values', values:[{key:'kart', value:{x:1}, from:sender('p1'), ts:5}]});
  socket.receive({type:'rt.value', key:'kart', value:{x:2}, from:sender('p2'), ts:6});
  socket.receive({type:'rt.value', key:'cursor', value:[1,2], from:sender('p2'), ts:7});
  socket.receive({type:'rt.value', key:'cursor', value:null, from:sender('p2'), ts:8});
  assert.deepEqual(client.realtime.value('p1', 'kart'), {x:1});
  assert.deepEqual(client.realtime.value(sender('p2'), 'kart'), {x:2});
  assert.equal(client.realtime.value('p2', 'cursor'), undefined);
  client.realtime.set('pending', 1);
  socket.close();
  assert.deepEqual(client.realtime.value('p1', 'kart'), {x:1});
  await wait(20);
  const next=Socket.sockets.at(-1);
  next.open();
  next.receive({type:'snapshot', room:snapshot(3)});
  next.receive({type:'rt.values', values:[{key:'kart', value:{x:9}, from:sender('p2'), ts:20}]});
  assert.equal(next.sent.some(frame=>frame.type==='rt.set'), false);
  assert.equal(client.realtime.value('p1', 'kart'), undefined);
  assert.deepEqual(client.realtime.value('p2', 'kart'), {x:9});
  assert.deepEqual(seen.slice(-3), [['p1','kart',null,5], [null,'pending',null,seen.at(-2)[3]], ['p2','kart',{x:9},20]]);
  next.receive({type:'rt.reset', from:{role:'host', player_id:null}, ts:30});
  assert.deepEqual(seen.at(-1), ['p2','kart',null,30]);
  assert.equal(client.realtime.value('p2', 'kart'), undefined);
  next.receive({type:'rt.value', key:'kart', value:1, from:sender('p3'), ts:31});
  client.close();
  assert.equal(client.realtime.value('p3', 'kart'), undefined);
});

test('own values set before rt.values arrives survive that frame', async () => {
  const client=new MiniEngine({code:'ABCDEF', token:'secret', WebSocket:Socket, baseUrl:'https://party.test', reconnectDelay:1});
  const seen=[];
  client.realtime.onValue('*', (value, from, ts, key) => seen.push([from.player_id, key, value]));
  client.once('snapshot', () => client.realtime.set('ready', true));
  client.connect();
  const player=version => ({...snapshot(version), you:{role:'player', player_id:'p1'}});
  const socket=Socket.sockets.at(-1);
  socket.open();
  socket.receive({type:'snapshot', room:player(2)});
  socket.receive({type:'rt.values', values:[{key:'kart', value:{x:1}, from:sender('p2'), ts:5}]});
  assert.deepEqual(socket.sent.filter(frame=>frame.type==='rt.set'), [{type:'rt.set', key:'ready', value:true}]);
  assert.equal(client.realtime.value('p1', 'ready'), true);
  assert.deepEqual(seen, [['p1','ready',true], ['p2','kart',{x:1}]]);
  socket.close();
  await wait(20);
  const next=Socket.sockets.at(-1);
  const after=client.waitForSnapshot().then(() => {
    client.realtime.set('ready', null);
    client.realtime.set('cursor', [1,2]);
  });
  next.open();
  next.receive({type:'snapshot', room:player(3)});
  await after;
  seen.length=0;
  next.receive({type:'rt.values', values:[{key:'ready', value:true, from:sender('p1'), ts:6}, {key:'kart', value:{x:2}, from:sender('p2'), ts:7}]});
  assert.equal(client.realtime.value('p1', 'ready'), undefined);
  assert.deepEqual(client.realtime.value('p1', 'cursor'), [1,2]);
  assert.deepEqual(client.realtime.value('p2', 'kart'), {x:2});
  assert.deepEqual(seen, [['p2','kart',{x:2}]]);
  await wait(40);
  assert.deepEqual(next.sent.filter(frame=>frame.type==='rt.set'), [{type:'rt.set', key:'ready', value:null}, {type:'rt.set', key:'cursor', value:[1,2]}]);
  client.close();
});

test('reset is sent as one frame, drops unsent values and throttling is an event', async () => {
  const {client,socket}=attach({realtime:{setInterval:50}});
  client.realtime.set('a', 1);
  client.realtime.set('a', 2);
  client.realtime.reset();
  await wait(70);
  assert.deepEqual(socket.sent.filter(frame=>frame.type.startsWith('rt.')), [{type:'rt.set', key:'a', value:1}, {type:'rt.reset'}]);
  const throttled=[];
  client.on('throttled', event => throttled.push(event));
  socket.receive({type:'rt.throttled', dropped:12});
  assert.deepEqual(throttled, [{dropped:12}]);
  client.close();
});

test('values the host sets after reset survive its own rt.reset echo', async () => {
  const {client,socket}=attach({realtime:{setInterval:0}});
  const seen=[];
  client.realtime.onValue('*', (value, from, ts, key) => seen.push([from.role, from.player_id, key, value]));
  socket.receive({type:'rt.values', values:[{key:'phase', value:'lobby', from:{role:'host', player_id:null}, ts:1}, {key:'kart', value:{x:1}, from:sender('p1'), ts:2}]});
  client.realtime.set('score', 3);
  seen.length=0;
  client.realtime.reset();
  client.realtime.set('phase', 'start');
  await wait(5);
  assert.deepEqual(socket.sent.filter(frame=>frame.type.startsWith('rt.')).slice(-2), [{type:'rt.reset'}, {type:'rt.set', key:'phase', value:'start'}]);
  seen.length=0;
  socket.receive({type:'rt.reset', from:{role:'host', player_id:null}, ts:5});
  assert.equal(client.realtime.value('host', 'phase'), 'start');
  assert.equal(client.realtime.value('host', 'score'), undefined);
  assert.equal(client.realtime.value('p1', 'kart'), undefined);
  assert.deepEqual(seen, [['host',null,'score',null], ['player','p1','kart',null]]);
  client.realtime.reset();
  client.realtime.set('phase', 'round-2');
  client.realtime.reset();
  client.realtime.set('turn', 'p2');
  socket.receive({type:'rt.reset', from:{role:'host', player_id:null}, ts:6});
  socket.receive({type:'rt.reset', from:{role:'host', player_id:null}, ts:7});
  assert.equal(client.realtime.value('host', 'phase'), undefined);
  assert.equal(client.realtime.value('host', 'turn'), 'p2');
  socket.receive({type:'rt.reset', from:{role:'host', player_id:null}, ts:8});
  assert.equal(client.realtime.value('host', 'turn'), undefined, 'a reset this connection did not send clears everything');
  client.close();
});

test('a player cannot keep values through a reset it never sent', () => {
  const client=new MiniEngine({code:'ABCDEF', token:'secret', WebSocket:Socket, baseUrl:'https://party.test', realtime:{setInterval:0}}).connect();
  const socket=Socket.sockets.at(-1);
  socket.open();
  socket.receive({type:'snapshot', room:{...snapshot(2), you:{role:'player', player_id:'p1'}}});
  socket.receive({type:'rt.values', values:[]});
  client.realtime.reset();
  client.realtime.set('ready', true);
  socket.receive({type:'rt.reset', from:{role:'host', player_id:null}, ts:5});
  assert.equal(client.realtime.value('p1', 'ready'), undefined);
  client.close();
});

test('award is a correlated host command and achievements are an event', async () => {
  const {client,socket}=attach();
  const pending=client.award('p1', 'snelste-vinger');
  const frame=socket.sent.at(-1);
  assert.deepEqual(frame, {type:'award', player_id:'p1', achievement_id:'snelste-vinger', request_id:frame.request_id});
  socket.receive({type:'ack', request_id:frame.request_id});
  assert.deepEqual(await pending, {type:'ack', request_id:frame.request_id});
  const refused=client.award('p2', 'onbekend');
  socket.receive({type:'error', request_id:socket.sent.at(-1).request_id, error:{code:'achievement_unknown', message:'Onbekend'}});
  await assert.rejects(refused, error=>error.code==='achievement_unknown');
  const earned=[];
  client.on('achievement', event => earned.push(event));
  const achievement={id:'snelste-vinger', title:'Snelste vinger', description:'Druk als eerste.'};
  socket.receive({type:'achievement', player_id:'p1', achievement});
  socket.receive({type:'achievement', player_id:'p1'});
  assert.deepEqual(earned, [{player_id:'p1', achievement}]);
  assert.equal(client.room.version, 2, 'an achievement is not a snapshot');
  client.close();
  await assert.rejects(client.award('p1', 'snelste-vinger'), error=>error.code==='not_connected');
});

test('achievements use the account bearer, explicit or from the client', async () => {
  const calls=[];
  const body={achievements:[{game_id:'jeopardy', game_title:'Jeopardy', id:'winnaar', title:'Winnaar', description:'Win een show met je team.', source:'server', awarded_at:1761140000}]};
  const fetch=async(url, options)=>{ calls.push({url, ...options}); return {ok:true, status:200, json:async()=>body}; };
  const api=new ApiClient({baseUrl:'https://party.test', accountToken:'account', fetch});
  assert.deepEqual(await api.achievements(), body);
  await api.achievements('other-account');
  assert.equal(calls[0].url, 'https://party.test/api/v1/accounts/achievements');
  assert.equal(calls[0].method, undefined);
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer account');
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer other-account');
});

test('sets use the account bearer and their own routes', async () => {
  const calls=[];
  const replies=[{sets:[]}, {sets:[]}, {id:'s 1', data:{categories:[]}}, {id:'s1'}, {id:'s1'}, null];
  const fetch=async(url, options)=>{ calls.push({url, ...options}); const body=replies.shift(); return body===null ? {ok:true,status:204} : {ok:true,status:200,json:async()=>body}; };
  const api=new ApiClient({baseUrl:'https://party.test', accountToken:'account', fetch});
  await api.listSets();
  await api.listSets({game_id:'jeopardy', kind:'board'});
  assert.deepEqual(await api.getSet('s 1'), {id:'s 1', data:{categories:[]}});
  const board={categories:[{title:'Films', clues:[{question:'Wie?', answer:'Dani.'}]}]};
  await api.createSet({game_id:'jeopardy', kind:'board', title:"Dani's filmavond", data:board});
  await api.updateSet('s1', {title:'Filmavond', data:board});
  assert.equal(await api.deleteSet('s1'), null);
  assert.deepEqual(calls.map(call=>[call.method ?? 'GET', call.url]), [
    ['GET', 'https://party.test/api/v1/accounts/sets'],
    ['GET', 'https://party.test/api/v1/accounts/sets?game_id=jeopardy&kind=board'],
    ['GET', 'https://party.test/api/v1/accounts/sets/s%201'],
    ['POST', 'https://party.test/api/v1/accounts/sets'],
    ['PUT', 'https://party.test/api/v1/accounts/sets/s1'],
    ['DELETE', 'https://party.test/api/v1/accounts/sets/s1'],
  ]);
  assert.ok(calls.every(call=>call.headers.get('Authorization')==='Bearer account'));
  assert.deepEqual(JSON.parse(calls[3].body), {game_id:'jeopardy', kind:'board', title:"Dani's filmavond", data:board});
  assert.deepEqual(JSON.parse(calls[4].body), {title:'Filmavond', data:board});
  await api.createRoom({game_id:'jeopardy', set_id:'s1'});
  assert.equal(JSON.parse(calls.at(-1).body).set_id, 's1');
  assert.equal(calls.at(-1).headers.get('Authorization'), 'Bearer account');
});

test('set errors keep their server code', async () => {
  const api=new ApiClient({accountToken:'account', fetch:async()=>({ok:false,status:409,json:async()=>({error:{code:'quota_sets',message:'Je hebt al 50 sets.'}})})});
  await assert.rejects(api.createSet({game_id:'jeopardy', kind:'board', title:'Vol', data:{}}), error=>error.code==='quota_sets'&&error.status===409);
});

test('media uploads send the raw bytes with their own type, not JSON', async () => {
  const calls=[];
  const item={id:'a'.repeat(32), url:`/media/${'a'.repeat(32)}`, content_type:'image/jpeg', width:640, height:480, size:51200, created_at:1};
  const replies=[{media:item, used_bytes:51200, limit_bytes:262144000}, {media:item, used_bytes:51200, limit_bytes:262144000}, {media:item, used_bytes:51200, limit_bytes:262144000}, {media:[item], used_bytes:51200, limit_bytes:262144000}, null];
  const fetch=async(url, options)=>{ calls.push({url, ...options}); const body=replies.shift(); return body===null ? {ok:true,status:204} : {ok:true,status:201,json:async()=>body}; };
  const api=new ApiClient({baseUrl:'https://party.test', accountToken:'account', fetch});
  const photo=new Blob([new Uint8Array([0xff,0xd8,0xff])], {type:'image/jpeg'});
  assert.deepEqual(await api.uploadMedia(photo), {media:item, used_bytes:51200, limit_bytes:262144000});
  const png=new Uint8Array([0x89,0x50,0x4e,0x47]);
  await api.uploadMedia(png, {contentType:'image/png'});
  await api.uploadMedia(png.buffer);
  assert.equal((await api.listMedia()).media[0].url, item.url);
  assert.equal(await api.deleteMedia('a b'), null);
  assert.deepEqual(calls.map(call=>[call.method ?? 'GET', call.url]), [
    ['POST', 'https://party.test/api/v1/accounts/media'],
    ['POST', 'https://party.test/api/v1/accounts/media'],
    ['POST', 'https://party.test/api/v1/accounts/media'],
    ['GET', 'https://party.test/api/v1/accounts/media'],
    ['DELETE', 'https://party.test/api/v1/accounts/media/a%20b'],
  ]);
  assert.ok(calls.every(call=>call.headers.get('Authorization')==='Bearer account'));
  assert.equal(calls[0].body, photo);
  assert.equal(calls[0].headers.get('Content-Type'), 'image/jpeg');
  assert.equal(calls[1].body, png);
  assert.equal(calls[1].headers.get('Content-Type'), 'image/png');
  assert.equal(calls[2].headers.get('Content-Type'), 'application/octet-stream');
});

test('media space requests post an optional message as JSON', async () => {
  const calls=[];
  const request={id:7, status:'pending', message:'Voor mijn quiz', requested_at:1793030400, next_request_at:1793635200, decided_at:null, granted_mb:null};
  const fetch=async(url, options)=>{ calls.push({url, ...options}); return {ok:true,status:201,json:async()=>({request})}; };
  const api=new ApiClient({baseUrl:'https://party.test', accountToken:'account', fetch});
  assert.deepEqual(await api.requestMediaSpace({message:'Voor mijn quiz'}), {request});
  await api.requestMediaSpace();
  assert.deepEqual(calls.map(call=>[call.method, call.url]), [
    ['POST', 'https://party.test/api/v1/accounts/media/requests'],
    ['POST', 'https://party.test/api/v1/accounts/media/requests'],
  ]);
  assert.ok(calls.every(call=>call.headers.get('Authorization')==='Bearer account'));
  assert.deepEqual(JSON.parse(calls[0].body), {message:'Voor mijn quiz'});
  assert.deepEqual(JSON.parse(calls[1].body), {});
});

test('game lists carry the account session so private games come along', async () => {
  const calls=[];
  const fetch=async(url, options)=>{ calls.push({url, ...options}); return {ok:true,status:200,json:async()=>({games:[], featured:[]})}; };
  const dani=new ApiClient({baseUrl:'https://party.test', accountToken:'a'.repeat(64), fetch});
  await dani.getGames();
  await dani.getGame('geheim spel');
  assert.deepEqual(calls.map(call=>call.url), ['https://party.test/api/v1/games', 'https://party.test/api/v1/games/geheim%20spel']);
  assert.ok(calls.every(call=>call.headers.get('Authorization')===`Bearer ${'a'.repeat(64)}`));
  const guest=new ApiClient({baseUrl:'https://party.test', fetch});
  await guest.getGames();
  await guest.getGame('zeeslag');
  assert.equal(calls[2].headers.has('Authorization'), false);
  assert.equal(calls[3].headers.has('Authorization'), false);
  globalThis.fetch=fetch;
  await getGames();
  assert.equal(calls[4].url, '/api/v1/games');
  assert.equal(calls[4].headers.has('Authorization'), false);
});

test('a game in a room asks for its own metadata with the room code', async () => {
  const calls=[];
  const fetch=async(url, options)=>{ calls.push({url, ...options}); return {ok:true,status:200,json:async()=>({id:'geheimspel'})}; };
  const guest=new ApiClient({baseUrl:'https://party.test', fetch});
  await guest.getGame('geheimspel', { room: ' abcdef ' });
  await guest.getGame('geheimspel', {});
  assert.deepEqual(calls.map(call=>call.url), ['https://party.test/api/v1/games/geheimspel?room=ABCDEF', 'https://party.test/api/v1/games/geheimspel']);
  assert.equal(calls[0].headers.has('Authorization'), false);
});

test('media space requests keep the wait code', async () => {
  const api=new ApiClient({accountToken:'account', fetch:async()=>({ok:false,status:429,json:async()=>({error:{code:'media_request_wait',message:'Je kunt over 7 dagen weer ruimte aanvragen.'}})})});
  await assert.rejects(api.requestMediaSpace(), error=>error.code==='media_request_wait'&&error.status===429);
});

test('media errors keep their server code', async () => {
  const api=new ApiClient({accountToken:'account', fetch:async()=>({ok:false,status:415,json:async()=>({error:{code:'media_unsupported',message:'Gebruik een PNG, JPEG, WebP of GIF.'}})})});
  await assert.rejects(api.uploadMedia(new Uint8Array([1])), error=>error.code==='media_unsupported'&&error.status===415&&error.message.startsWith('Gebruik'));
});
