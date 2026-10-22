import { ApiClient, MiniEngine, type Account, type Manifest, type ActionPayloads } from '@casb02/mini-engine-sdk';
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
