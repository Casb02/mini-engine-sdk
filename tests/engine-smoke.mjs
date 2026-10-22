import { mkdtemp, mkdir, cp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ApiClient, MiniEngine } from '../dist/mini-engine.js';

const engineRoot = process.env.MINI_ENGINE_CHECKOUT;
if (!engineRoot) throw new Error('Set MINI_ENGINE_CHECKOUT to a built Mini Engine v0.2 checkout.');
const sdkRoot = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'mini-sdk-engine-'));
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const baseUrl = `http://127.0.0.1:${port}`;
const clients = [];
let server;
let logs = '';
const until = async predicate => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for integration condition\n' + logs);
};
try {
  const games = join(root, 'games');
  await mkdir(games);
  const generated = spawnSync(process.execPath, [join(sdkRoot,'bin/create-mini-game.mjs'), 'integration-vote', '--directory', join(games,'integration-vote')], { encoding:'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const web = join(root, 'web');
  await cp(join(engineRoot,'web'), web, { recursive:true });
  await cp(join(sdkRoot,'dist/mini-engine.js'), join(web,'mini-engine.js'));
  server = spawn(join(engineRoot,'target/debug/mini-engine'), [], { cwd:engineRoot, env:{...process.env,MINI_ENGINE_BIND:`127.0.0.1:${port}`,MINI_ENGINE_DB:join(root,'engine.sqlite'),MINI_ENGINE_GAMES:games,MINI_ENGINE_WEB:web}, stdio:['ignore','pipe','pipe'] });
  server.stdout.on('data', chunk => { logs += chunk; });
  server.stderr.on('data', chunk => { logs += chunk; });
  await until(async () => fetch(`${baseUrl}/api/health`).then(response=>response.ok).catch(()=>false));
  const api = new ApiClient({ baseUrl });
  const catalog = await api.getGames();
  assert.equal(catalog.games[0].id,'integration-vote');
  const hostSession = await api.createRoom({game_id:'integration-vote'});
  const firstSession = await api.joinRoom(hostSession.code,'First');
  const secondSession = await api.joinRoom(hostSession.code,'Second');
  const { token:displayToken } = await api.displayToken(hostSession.code,hostSession.token);
  const source = await readFile(join(games,'integration-vote/assets/app.js'),'utf8');
  function mount(role, session) {
    const elements = new Map();
    const element = () => ({ hidden:false, disabled:false, textContent:'', children:[], replaceChildren(...children) { this.children=children; } });
    const document = { body:{dataset:{role}}, getElementById(id) { if (!elements.has(id)) elements.set(id,element()); return elements.get(id); }, createElement:element };
    class BoundEngine extends MiniEngine { constructor(credentials) { super({...credentials,baseUrl}); clients.push(this); } }
    const context = vm.createContext({ SDK:{MiniEngine:BoundEngine,loadSession:()=>session}, document, location:{search:`?room=${session.code}`}, URLSearchParams, window:{addEventListener(){}}, console });
    const script = source.replace("import { MiniEngine, loadSession } from '/sdk/mini-engine.js';",'const { MiniEngine, loadSession } = SDK;');
    new vm.Script(script).runInContext(context);
    return { elements, client:clients.at(-1) };
  }
  const host = mount('host',hostSession);
  const first = mount('player',firstSession);
  const second = mount('player',secondSession);
  const display = mount('display',{code:hostSession.code,token:displayToken,role:'display'});
  await Promise.all(clients.map(client=>client.waitForSnapshot()));
  await first.elements.get('ready').onclick();
  await second.elements.get('ready').onclick();
  await until(()=>host.client.room.players.every(player=>player.ready));
  await host.elements.get('start').onclick();
  await until(()=>clients.every(client=>client.room.status==='running'));
  await Promise.all([first.elements.get('vote-yes').onclick(),second.elements.get('vote-no').onclick()]);
  await until(()=>display.elements.get('yes').textContent==='1' && display.elements.get('no').textContent==='1');
  assert.equal(Object.keys(host.client.room.public_state.votes).length,2);
  await first.elements.get('vote-no').onclick();
  await until(()=>display.elements.get('yes').textContent==='0' && display.elements.get('no').textContent==='2');
  await host.elements.get('finish').onclick();
  await until(()=>clients.every(client=>client.room.status==='finished'));
  await host.elements.get('reset').onclick();
  await until(()=>clients.every(client=>client.room.status==='lobby') && Object.keys(host.client.room.public_state?.votes??{}).length===0);
  assert.equal(first.elements.get('error').textContent,'');
  assert.equal(host.elements.get('error').textContent,'');
  console.log(JSON.stringify({result:'passed',catalog:catalog.games[0].id,checks:['actual catalog load','host/player/display generated scripts','room create/join/display token SDK API','ready/lifecycle','rapid serialized votes','changed vote shared by display','finish and reset']}));
} finally {
  for (const client of clients) client.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve=>server.once('exit',resolve));
  }
  await rm(root,{recursive:true,force:true});
}
