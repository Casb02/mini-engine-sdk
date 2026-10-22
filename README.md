<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-donker.png">
  <img alt="Miniengine✱ SDK" src=".github/assets/banner-licht.png" width="100%">
</picture>

# Miniengine✱ SDK

Typed, dependency-free browser client and game scaffolder for Mini Engine v0.4, published as the GitHub npm package [**@casb02/mini-engine-sdk**](https://github.com/Casb02/mini-engine-sdk/pkgs/npm/mini-engine-sdk) under the MIT license.

Documentation (Dutch): [docs.miniengine.nl](https://docs.miniengine.nl/), including the [API reference PDF](https://docs.miniengine.nl/downloads/MiniEngine-API-v0.4.pdf).

## Install

The package lives in GitHub Packages. Point the `@casb02` scope at it once, in your project's `.npmrc` (or `~/.npmrc`):

```ini
@casb02:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

GitHub Packages asks for a token even for public packages: create a [personal access token (classic)](https://github.com/settings/tokens) with only `read:packages`, and export it as `GITHUB_TOKEN` (or `gh auth token` if you use the GitHub CLI with that scope). Then:

```sh
npm install @casb02/mini-engine-sdk
```

**Without a token** you can install straight from the repository; npm builds it on install:

```sh
npm install github:Casb02/mini-engine-sdk           # latest main
npm install github:Casb02/mini-engine-sdk#v0.3.1    # a release tag
```

Requires Node.js 22+. The package ships the ESM client (`dist/`), one bundled declaration file (`types/`), the `create-mini-game` scaffolder (`bin/`) and the AI agent skills (`skills/`).

## Build a game in five minutes

**On a hosted engine** such as miniengine.nl, use the [Mini Engine CLI](https://github.com/Casb02/mini-engine-cli), which vendors this scaffolder:

```sh
npm install -g github:Casb02/mini-engine-cli
me game new my-vote
me game upload ./my-vote
```

**In a local engine checkout**, scaffold straight into its `games/` folder:

```sh
npx -p @casb02/mini-engine-sdk create-mini-game my-vote --directory ../mini-engine/games/my-vote
```

Restart Mini Engine from its checkout root with `cargo run`, open its `/demo`, select **My Vote**, and create a room. Join from a second browser or device, click **I'm ready**, and start voting on the host. The generated host, player and display pages work immediately with the SDK served by Mini Engine at `/sdk/mini-engine.js`.

The starter is a complete trusted host-runtime game: the host validates votes, serializes state writes, shows totals to all roles, and supports repeated rounds. Keep its host tab open while playing. Change the question/defaults in `manifest.json`, game logic in `assets/app.js`, and appearance in `assets/style.css`. Each generated package includes its own README.

Scaffolder options:

```sh
npx -p @casb02/mini-engine-sdk create-mini-game another-game
npx -p @casb02/mini-engine-sdk create-mini-game another-game --directory /path/to/engine/games/another-game
npx -p @casb02/mini-engine-sdk create-mini-game --help
```

The destination must not exist and its final directory name must match the slug, as required by the engine catalog. Slugs use at most 48 lowercase letters, digits and single hyphens, starting with a letter. The CLI rejects unsafe slugs and never overwrites an existing directory.

## Build a game with an AI agent

The `skills/` directory contains [Agent Skills](https://agentskills.io/specification) (a `SKILL.md` with YAML frontmatter plus `references/` and `scripts/`) that let a coding agent scaffold, implement, run and verify a Mini Engine game without guessing at the engine's rules:

| Skill | Use |
| --- | --- |
| [`build-mini-engine-game`](skills/build-mini-engine-game/SKILL.md) | The workflow: scaffold with `create-mini-game`, manifest and settings schema, moderator host and roles, host-runtime state (public, host-only and per-player secrets), rounds, the shared display, running the engine and verifying with several seats. References cover the SDK API, manifest/settings rules, host-runtime recipes and troubleshooting; `scripts/play.mjs` drives a real room with Playwright. |
| [`design-mini-engine-game-ui`](skills/design-mini-engine-game-ui/SKILL.md) | Player (phone), display (TV across the room) and host (console) pages: each game's own atmosphere, touch targets, readability, self-hosted fonts, no inline scripts under the engine's CSP, reduced motion. |

The quickest way to install them for **Claude Code** is the CLI: `me skill install` (all projects) or `me skill install --project` (this project). Or copy them from the installed package:

```sh
mkdir -p ~/.claude/skills
cp -R node_modules/@casb02/mini-engine-sdk/skills/* ~/.claude/skills/   # all projects
mkdir -p .claude/skills
cp -R node_modules/@casb02/mini-engine-sdk/skills/* .claude/skills/     # this project only
```

Restart the agent session, then ask for example: *"Build a Mini Engine game where everyone secretly picks a number and the closest to 2/3 of the average wins; show the results on the shared screen."* The skill triggers on such requests; you can also name it (`/build-mini-engine-game` in Claude Code).

**Other agents:** Codex, Gemini CLI, Copilot CLI and other agents that read the SKILL.md format also look in `~/.agents/skills/` (copy or symlink the same directories there, or into the location your agent documents). Agents without skill support can be pointed at the files directly: *"Read skills/build-mini-engine-game/SKILL.md in the Mini Engine SDK and follow it."* The skills assume a Mini Engine to run and test the game (a local checkout, or a hosted engine plus the CLI to upload) and scaffold with `npx -p @casb02/mini-engine-sdk create-mini-game` or `me game new`.

## Using the client

In a bundled app or a Node script, import the package:

```js
import { ApiClient, MiniEngine } from '@casb02/mini-engine-sdk';
```

For browser game packages served by the engine, import the copy the engine serves, so the client always matches that engine:

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
const { token } = await api.login({ username: 'sander', password: 'your-password' });
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

`ApiClient` methods: `getGames()`, `getGame(id)`, `createRoom(options)`, `joinRoom(code,name)`, `getRoom(code,roomToken)`, `roomInfo(code)`, `gameData(code,hostToken)`, `displayToken(code,hostToken)`, `register({username,password,display_name,email})`, `verifyEmail(token)`, `setEmail(email)`, `login({username,password})`, `me()`, `stats()`, `logout()`. Since engine v0.4 registration needs an email address; the engine mails a confirmation link (`?verify=<token>`), which `verifyEmail` confirms while signed in to that account (set `accountToken` first). `Account` includes `email` and `email_verified`. `displayToken` rotates the display credential and returns `{token}`; only share it through the room launcher's URL fragment.

The original same-origin `http(path,{token,...fetchOptions})`, `getGames()`, `createRoom(options)` and `joinRoom(code,name)` exports remain available. `getGames()` returns `{games}`. `ApiClient({baseUrl,accountToken,fetch})` supports a separate server and custom fetch implementation; cross-origin browser requests require the server's CORS support.

Game metadata can declare `supports_late_join: false` when its rules cannot admit players after start. The optional capability defaults to true for legacy custom packages. Built-in Jeopardy disables late joining; Common Dice supports it. A room can enable `allow_late_join` only when its game supports the capability.

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

## Releasing

Bump `version` in `package.json`, merge, then tag: `git tag v0.3.2 && git push origin v0.3.2`. The [publish workflow](.github/workflows/publish.yml) runs the full check and publishes the tag to GitHub Packages with the repository's own `GITHUB_TOKEN`; the tag must match the package version.

## Sessions and distribution

`sessionKey(code,role)`, `saveSession(credentials,storage?)`, `loadSession(code,role,storage?)`, `removeSession(code,role,storage?)` retain the existing `mini-engine:CODE:ROLE` sessionStorage format. Storage helpers never put secrets into URL query strings. The room launcher consumes display credentials from the URL fragment before loading the game iframe.

`dist/mini-engine.js` is one bundled ES module suitable for the engine's `/sdk/mini-engine.js` route; it has no runtime package dependencies. Its declarations are the committed file `types/mini-engine.d.ts` (see [TypeScript types](#typescript-types)). Engine maintainers vendor both with the engine's `npm run sdk:sync -- /path/to/mini-engine-sdk`; game packages consume the engine-served copy.

```sh
npm run check         # Types up to date, build, strict typed consumer, transport/API/CLI tests
npm run test:package  # Pack, install without scripts, import and run installed CLI
```

## TypeScript types

The whole public API is described by one self-contained declaration file, [`types/mini-engine.d.ts`](types/mini-engine.d.ts): no imports, no other files needed. It is generated from `src/` by `npm run build` (`scripts/build-types.mjs` type-checks the sources, stitches tsc's per-module declarations into one module and compiles the result on its own) and committed, so it is readable on GitHub without a build. `npm run check` starts with `npm run types:check`, which regenerates it in memory and fails when the committed file is stale; after changing `src/`, run `npm run build` and commit `types/mini-engine.d.ts` with your change. Do not edit it by hand.

Where the types are picked up:

- **npm/tarball consumers:** `package.json` `types` and `exports["."].types` point at `types/mini-engine.d.ts`, so `import { MiniEngine } from '@casb02/mini-engine-sdk'` is typed in TypeScript and in JavaScript editors.
- **Mini Engine checkout:** `npm run sdk:sync` copies the file to the engine's `web/mini-engine.d.ts` next to the served bundle and pins its hash in `sdk-version.json` (`npm run sdk:check` verifies both).
- **Scaffolded games:** `create-mini-game` writes `jsconfig.json` and a copy of the declarations in `types/mini-engine.d.ts`. Game code keeps importing the rooted browser path `/sdk/mini-engine.js`; TypeScript applies `compilerOptions.paths` to that specifier and resolves it to `../../web/mini-engine.d.ts` when the game lives in an engine checkout's `games/<slug>/` (always matching the SDK that engine serves), otherwise to the game's own `types/mini-engine.d.ts`. `checkJs` and `strict` are on, so VS Code and other TypeScript-based editors give completion and underline wrong SDK calls in plain JavaScript without a build step or an import map. The generated `assets/app.js` declares its state and settings shapes with JSDoc (`@typedef`, `@type {MiniEngine<PublicState, Settings>}`) and passes the check. From a terminal: `npx -p typescript tsc -p jsconfig.json` inside the game directory. The engine only serves `assets/`, so `jsconfig.json` and `types/` never reach browsers.

CI runs those checks on Node 22 and 24. No npm publishing is configured.

To test the generated game against a real engine, first build a Mini Engine v0.4 checkout with `cargo build`, then run:

```sh
MINI_ENGINE_CHECKOUT=/absolute/path/to/mini-engine npm run test:engine
```

This optional integration check starts an isolated engine with a temporary database, loads the generated package through its actual catalog, and executes all three generated role scripts in a DOM harness with real WebSockets. It verifies readiness, start, simultaneous votes, shared display totals and round reset, then removes its temporary data.
