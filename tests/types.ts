import { ApiClient, MiniEngine, type Account, type Manifest, type ActionPayloads, type Json, type Realtime, type RealtimeFrom } from '@casb02/mini-engine-sdk';
const api = new ApiClient({ baseUrl: 'http://localhost:3000', accountToken: 'secret' });
void api.createRoom({ game_id: 'vote', config: { host_mode: 'moderator' } });
const client = new MiniEngine<{ votes: Record<string, boolean> }, { prompt: string }>({ code: 'ABCDEF', token: 'secret' });
const injected = new MiniEngine({ code: 'ABCDEF', token: 'secret', WebSocket: globalThis.WebSocket });
void injected;
client.on('snapshot', room => { const prompt: string = room.settings.prompt; void prompt; });
client.once('status', status => { const typed: string = status; void typed; });
void client.setSettings({ prompt: 'Yes?' });
void client.waitForSnapshot(room => room.status === 'running');
const payload: ActionPayloads['judge'] = { correct: true };
void client.action('judge', payload, { actionId: 'known' });
const manifest: Manifest = { id:'vote', title:'Vote', description:'Vote', version:'1', min_players:1, max_players:10, has_display:true, default_settings:{}, settings_schema:{type:'object',title:'Settings',description:'Game settings',default:{prompt:'Vote?'},properties:{prompt:{type:'string',title:'Question',description:'Shown on screen',default:'Vote?'}},additionalProperties:false} };
void manifest;
const noLateJoin: Manifest = { ...manifest, supports_late_join: false };
void noLateJoin;
// @ts-expect-error late-join support is a capability boolean
const invalidLateJoin: Manifest = { ...manifest, supports_late_join: 'false' };
void invalidLateJoin;
// @ts-expect-error settings retain their semantic type
void client.setSettings({ prompt: 1 });
// @ts-expect-error host_mode is immutable after creation
void client.configure({ host_mode: 'playing' });
// The bundled declaration keeps internal helper types private.
// @ts-expect-error Pending is not part of the public API
import type { Pending } from '@casb02/mini-engine-sdk';
// @ts-expect-error lifecycle states are a closed union
void client.lifecycle('started');

const account: Account = { id: 'a', username: 'sander', display_name: 'Sander', created_at: 1, email: 'sander@example.com', email_verified: false };
void account;
// @ts-expect-error registration needs an email address since engine v0.4
void new ApiClient().register({ username: 'sander', password: 'correct horse battery', display_name: 'Sander' });

const realtime: Realtime = client.realtime;
const emitted: boolean = realtime.emit('buzz', { at: 1 }, { to: ['p1'], echo: true });
void emitted;
void realtime.emit('pressed');
void realtime.emit('cue', null, { to: 'display' });
const offEvent = realtime.on('*', (data, from, ts, channel) => {
  const role: 'host' | 'player' | 'display' = from.role; const id: string | null = from.player_id;
  const at: number = ts; const name: string = channel; const payload: Json = data;
  void role; void id; void at; void name; void payload;
});
offEvent();
realtime.set('kart', { x: 1, y: 2 });
realtime.set('kart', null);
const sender: RealtimeFrom = { role: 'player', player_id: 'p1' };
const kart: Json | undefined = realtime.value(sender, 'kart') ?? realtime.value('host', 'kart');
void kart;
const offValue = realtime.onValue('kart', (value, from, ts, key) => { void value; void from; void ts; void key; });
offValue();
realtime.reset();
client.on('throttled', ({ dropped }) => { const count: number = dropped; void count; });
void new MiniEngine({ code: 'ABCDEF', token: 'secret', realtime: { setInterval: 50 } });
// @ts-expect-error targets are a role, everyone or a list of player ids
void realtime.emit('buzz', null, { to: 'everyone' });
// @ts-expect-error realtime values must be JSON
realtime.set('kart', () => 1);
// @ts-expect-error the server stamps the sender; emit has no from option
void realtime.emit('buzz', null, { from: sender });
// @ts-expect-error the realtime implementation stays private
import type { RealtimeChannel } from '@casb02/mini-engine-sdk';
