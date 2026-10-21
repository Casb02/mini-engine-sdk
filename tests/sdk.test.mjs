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
