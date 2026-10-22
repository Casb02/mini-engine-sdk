import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, MiniEngine, createRoom, joinRoom, sessionKey, saveSession, loadSession, removeSession } from '../dist/mini-engine.js';

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
