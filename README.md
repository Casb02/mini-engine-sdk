# Mini Engine SDK

Typed, dependency-free browser client and game scaffolder for Mini Engine v0.2. Package name: **@casb02/mini-engine-sdk**, version **0.2.0**. The source repository is private. This package has **not been published to npm**; use the local build and tarball workflows below.

## Build a game in five minutes

Requires Node.js 22+ and an existing Mini Engine checkout. Authenticate with GitHub first for access to the private SDK repository.

```sh
git clone git@github.com:Casb02/mini-engine-sdk.git
cd mini-engine-sdk
npm ci
npm run build
node bin/create-mini-game.mjs my-vote --directory ../mini-engine/games/my-vote
```

Restart Mini Engine from its checkout root with `cargo run`, open its `/demo`, select **My Vote**, and create a room. Join from a second browser or device, click **I'm ready**, and start voting on the host. The generated host, player and display pages work immediately with the SDK served by Mini Engine at `/sdk/mini-engine.js`.

The starter is a complete trusted host-runtime game: the host validates votes, serializes state writes, shows totals to all roles, and supports repeated rounds. Keep its host tab open while playing. Change the question/defaults in `manifest.json`, game logic in `assets/app.js`, and appearance in `assets/style.css`. Each generated package includes its own README.

CLI options:

```sh
node bin/create-mini-game.mjs another-game
node bin/create-mini-game.mjs another-game --directory /path/to/engine/games/another-game
node bin/create-mini-game.mjs --help
```

The destination must not exist. The CLI rejects unsafe slugs and never overwrites an existing directory.

## Install the local npm artifact

Build and pack from the SDK checkout:

```sh
npm pack
```

Then, in your own project:

```sh
npm install /absolute/path/to/mini-engine-sdk/casb02-mini-engine-sdk-0.2.0.tgz
npx create-mini-game my-game --directory /path/to/engine/games/my-game
```

Here `npx` runs the CLI installed from your local tarball. It does not depend on an npm registry publication. For browser game packages served by the engine, import its served SDK directly:

```js
import { MiniEngine, loadSession } from '/sdk/mini-engine.js';

const code = new URLSearchParams(location.search).get('room');
const session = loadSession(code, 'player');
if (!session) throw new Error('Open this page through the room launcher.');
const client = new MiniEngine(session);
client.on('snapshot', room => {
  console.log(room.status, room.players, room.public_state);
});
client.connect();
await client.waitForSnapshot();
await client.ready(true);
// After the host starts the generated vote game:
// await client.action('vote', { yes: true });
```

Do not open generated HTML with file:// or a static server. Mini Engine supplies the API, room sessions, WebSockets and game asset routes. Games are locally trusted code; review packages before installing them. Host-private data belongs in `data.json`, loaded through the authenticated game-data API, rather than public assets.

## HTTP and accounts

```ts
import { ApiClient, MiniEngine, saveSession } from '@casb02/mini-engine-sdk';

const api = new ApiClient({ baseUrl: 'http://localhost:3000' });
const { games } = await api.getGames();
const { token } = await api.login({ username: 'cas', password: 'your-password' });
api.accountToken = token;
const credentials = await api.createRoom({
  game_id: 'common-dice',
  name: 'Cas',
  config: { host_mode: 'hostless', display_enabled: false },
});
saveSession(credentials); // Browser sessionStorage; an explicit Storage adapter is also supported.
const client = new MiniEngine({ ...credentials, baseUrl: api.baseUrl }).connect();
await client.waitForSnapshot();
await client.ready(true);
// Once every participant is ready, a hostless participant may start:
await client.action('start');
await client.action('roll', { held: [] });
console.log(await api.stats());
```

Accounts are optional. Omitting `accountToken` creates/joins as a guest. Create/join requests use the account bearer; room snapshot and game-data requests use their explicit room bearer. Register/login return `{account,token}` without storing credentials automatically. Set `api.accountToken` after login/register and choose your own persistence. Logout clears it after server success.

`ApiClient` methods: `getGames()`, `getGame(id)`, `createRoom(options)`, `joinRoom(code,name)`, `getRoom(code,roomToken)`, `roomInfo(code)`, `gameData(code,hostToken)`, `register({username,password,display_name})`, `login({username,password})`, `me()`, `stats()`, `logout()`.

The original same-origin `http(path,{token,...fetchOptions})`, `getGames()`, `createRoom(options)` and `joinRoom(code,name)` exports remain available. `getGames()` returns `{games}`. `ApiClient({baseUrl,accountToken,fetch})` supports a separate server and custom fetch implementation; cross-origin browser requests require the server's CORS support.

## Realtime API

`new MiniEngine({code,token,baseUrl?,reconnectDelay?,requestTimeout?,WebSocket?})` works in a browser or Node with a WebSocket implementation. Node callers must supply `baseUrl`; credentials are sent only in the first socket authentication frame. Room codes are normalized automatically.

| Method | Behavior |
| --- | --- |
| `connect()` / `resume()` | Connect or explicitly resume a closed client; returns the client. |
| `on(type,fn)` / `once(type,fn)` | Subscribe; returns unsubscribe. `once` runs the callback once. |
| `waitForSnapshot(predicate?,{timeout?,signal?}?)` | Resolve with a matching current/future connected snapshot; timeout defaults to requestTimeout. |
| `ready(ready=true)` | Set your participant readiness in the lobby. |
| `action(name,data={}, {actionId}={})` | Send an action with a fresh action_id by default. |
| `configure({display_enabled?,allow_late_join?})` | Host lobby configuration, using latest version. Host mode is chosen on creation. |
| `setSettings(settings)` | Host settings update using latest version. |
| `setState({expected_version,public_state,host_state?,player_states?})` | Host-runtime state publishing. Server-runtime rooms reject this. |
| `lifecycle('running' / 'finished' / 'lobby')` | Host lifecycle update. |
| `request(type,payload={})` | Raw correlated request, resolves with ack. |
| `close()` | Stop automatic retries and reject outstanding requests/waiters. |

Events: `snapshot` receives the projected room itself, `action` the attributed host-runtime action envelope, `status` one of `connecting/connected/reconnecting/disconnected`, `error` an Error with server code, and `closed` the terminal reason. `client.room` holds the latest snapshot and `client.connected` becomes true only after authentication produces a snapshot. Snapshot generic parameters are `MiniEngine<PublicState,Settings,PrivateState>`.

Server-runtime mutations send a fresh projected snapshot before their success ack. An ack carries correlation, not state. Presence/readiness can change without a version increment. Subscribe to snapshots instead of assuming every snapshot has a new version. Role projections determine which private fields are present.

Outstanding commands reject on disconnect or timeout. Transient closures reconnect with bounded exponential backoff and fresh authentication; the SDK **never automatically replays commands**. After an uncertain result, inspect the latest snapshot. For an intentional retry of the same server-runtime action, reuse its explicit `actionId` (1–64 characters); server deduplication is scoped to actor and round and retains its last 256 ids. Host-runtime action acknowledgements confirm delivery to the host queue, not durable gameplay processing.

`MiniEngineError` exposes `.code` and optional HTTP `.status`. Explicitly handle errors from returned promises. An `error` event does not consume a rejected request promise.

## Sessions and distribution

`sessionKey(code,role)`, `saveSession(credentials,storage?)`, `loadSession(code,role,storage?)`, `removeSession(code,role,storage?)` retain the existing `mini-engine:CODE:ROLE` sessionStorage format. Storage helpers never put secrets into URL query strings. The room launcher consumes display credentials from the URL fragment before loading the game iframe.

`dist/mini-engine.js` is one bundled ES module suitable for the engine's `/sdk/mini-engine.js` route; it has no runtime package dependencies. The npm artifact also includes TypeScript declarations. Engine maintainers can copy the built bundle into the engine's SDK asset; game packages consume the engine-served copy.

```sh
npm run check         # Build, strict typed consumer, transport/API/CLI tests
npm run test:package  # Pack, install without scripts, import and run installed CLI
```

CI runs those checks on Node 22 and 24. No npm publishing is configured.
