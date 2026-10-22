import { ApiClient, MiniEngine, type Account, type AccountAchievement, type AchievementEarned, type Ack, type Manifest, type ActionPayloads, type Json, type Realtime, type RealtimeFrom, type RoomSet, type SavedSet, type SetKind, type SetSchema, type SetSummary, type Snapshot } from '@casb02/mini-engine-sdk';
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

const withAchievements: Manifest = { ...manifest, achievements: [{ id: 'winnaar', title: 'Winnaar', description: 'Win een show.' }] };
void withAchievements;
// @ts-expect-error an achievement needs a description
const missingDescription: Manifest = { ...manifest, achievements: [{ id: 'winnaar', title: 'Winnaar' }] };
void missingDescription;
const awarded: Promise<Ack> = client.award('p1', 'winnaar');
void awarded;
// @ts-expect-error the server finds the account from the seat; award takes no account id
void client.award('p1', 'winnaar', 'account-id');
client.on('achievement', ({ player_id, achievement }: AchievementEarned) => {
  const who: string = player_id; const title: string = achievement.title; void who; void title;
});
void api.achievements().then(({ achievements }) => {
  const first: AccountAchievement | undefined = achievements[0];
  if (first) {
    const source: 'server' | 'game' = first.source; const game: string | null = first.game_title;
    const at: number = first.awarded_at; void source; void game; void at;
  }
});
void api.achievements('other-account-token');
const serverSource: AccountAchievement['source'] = 'server';
// @ts-expect-error source is server or game
const invalidSource: AccountAchievement['source'] = 'host';
void serverSource; void invalidSource;

const boardSchema: SetSchema = { type: 'object', properties: { categories: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: { title: { type: 'string', maxLength: 40 }, clues: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, answer: { type: 'string' } }, required: ['question', 'answer'], additionalProperties: false } } }, required: ['title', 'clues'], additionalProperties: false } } }, required: ['categories'], additionalProperties: false };
const board: SetKind = { id: 'board', title: 'Vragenbord', description: 'Zes categorieën met vijf vragen.', schema: boardSchema };
const withSets: Manifest = { ...manifest, set_kinds: [board] };
void withSets;
// @ts-expect-error objects in a set schema must forbid additional properties
const openObject: SetSchema = { type: 'object', properties: {} };
void openObject;
// @ts-expect-error arrays in a set schema need items
const bareArray: SetSchema = { type: 'array' };
void bareArray;
// @ts-expect-error string bounds belong to strings, not numbers
const wrongBound: SetSchema = { type: 'integer', maxLength: 3 };
void wrongBound;
// @ts-expect-error a set kind needs a schema
const noSchema: SetKind = { id: 'board', title: 'Vragenbord', description: 'Bord.' };
void noSchema;
void api.createRoom({ game_id: 'jeopardy', set_id: 'set-id' });
// @ts-expect-error set ids are strings
void api.createRoom({ game_id: 'jeopardy', set_id: 1 });
type Board = { categories: { title: string; clues: { question: string; answer: string }[] }[] };
void api.listSets({ game_id: 'jeopardy', kind: 'board' }).then(({ sets }) => {
  const first: SetSummary | undefined = sets[0];
  // @ts-expect-error listings leave out the content
  void first?.data;
  if (first) { const size: number = first.size; const at: number = first.updated_at; void size; void at; }
});
void api.listSets();
void api.getSet<Board>('set-id').then((set: SavedSet<Board>) => { const title: string | undefined = set.data.categories[0]?.title; void title; });
void api.createSet({ game_id: 'jeopardy', kind: 'board', title: 'Filmavond', data: { categories: [] } });
// @ts-expect-error a new set needs a title
void api.createSet({ game_id: 'jeopardy', kind: 'board', data: {} });
void api.updateSet('set-id', { title: 'Filmavond', data: { categories: [] } });
// @ts-expect-error the game and kind of a set never change
void api.updateSet('set-id', { title: 'Filmavond', data: {}, kind: 'deck' });
const deleted: Promise<null> = api.deleteSet('set-id');
void deleted;
client.on('snapshot', (room: Snapshot) => {
  const set: RoomSet | null | undefined = room.set;
  if (set) { const name: string = set.title; const kind: string = set.kind; void name; void kind; }
});
