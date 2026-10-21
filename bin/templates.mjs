/** All files are static engine game assets; no generated npm dependency is required. */
export function gameFiles(slug) {
  const title = slug.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
  const manifest = {
    id: slug,
    title,
    description: 'A ready-to-play yes/no vote game. Customize the question and start voting.',
    version: '0.1.0',
    runtime: 'host',
    host_modes: ['moderator'],
    default_host_mode: 'moderator',
    min_players: 1,
    max_players: 24,
    has_display: true,
    default_settings: { prompt: 'Should we play another round?', allow_change: true },
    settings_schema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', maxLength: 120 },
        allow_change: { type: 'boolean' },
      },
      required: ['prompt', 'allow_change'],
      additionalProperties: false,
    },
  };
  const html = role => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="/games/${slug}/assets/style.css">
</head>
<body data-role="${role}">
  <main>
    <p class="eyebrow">${title} · <span id="code"></span></p>
    <h1 id="prompt">Connecting…</h1>
    <p id="status" role="status">Waiting for the room.</p>
    <p id="error" role="alert"></p>
    <section class="results" aria-label="Votes"><div><strong id="yes">0</strong>Yes</div><div><strong id="no">0</strong>No</div></section>
    <section id="player-controls" hidden>
      <button id="ready">I'm ready</button>
      <div class="actions"><button id="vote-yes">Yes</button><button id="vote-no">No</button></div>
      <p id="my-vote"></p>
    </section>
    <section id="host-controls" hidden>
      <div class="actions"><button id="start">Start voting</button><button id="finish">Finish round</button><button id="reset">New round</button></div>
      <p>Keep this host tab open: it runs this game's trusted reducer.</p>
    </section>
    <ul id="players" aria-label="Players"></ul>
  </main>
  <script type="module" src="/games/${slug}/assets/app.js"></script>
</body>
</html>
`;
  return {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'host.html': html('host'),
    'player.html': html('player'),
    'display.html': html('display'),
    'assets/app.js': app,
    'assets/style.css': css,
    'README.md': `# ${title}

A trusted **host-runtime** vote game for Mini Engine v0.2. The host tab validates player actions and publishes state; keep it online during play. Guests need no accounts. All roles see the same vote totals; players can optionally change their vote.

## Run in five minutes

1. Put this whole directory at games/${slug}/ in your Mini Engine checkout.
2. Restart the engine from its project root (cargo run). If your server uses another games directory, put it there instead.
3. Open the engine's /demo, select **${title}**, and create a moderator room.
4. Join from another browser/device using the room code, then click **I'm ready**.
5. On the host, click **Start voting**. Vote on the player screen; optionally open a display.

The generated HTML imports the SDK served by your engine at /sdk/mini-engine.js. Do not open the HTML files with file:// or a generic static server: the engine supplies room sessions, HTTP and WebSocket routes.

## Make it yours

- Change metadata/defaults and the supported settings schema in manifest.json.
- Change rendering and the serial host reducer in assets/app.js.
- Change the layout in host.html, player.html, display.html and assets/style.css.
- Keep only public assets in assets/; host-only data belongs in data.json and must be loaded through the authenticated game-data route.

The room snapshot is authoritative. A request acknowledgement means the action reached the host queue; it does not confirm durable processing for host-runtime games. The SDK never replays actions automatically. New rounds reset votes; the room's prompt and allow_change settings remain configurable through the workbench.

Game packages are locally trusted code, not sandboxed uploads. Review a package before installing it.
`,
  };
}

const app = String.raw`import { MiniEngine, loadSession } from '/sdk/mini-engine.js';

const $ = id => document.getElementById(id);
const role = document.body.dataset.role;
const code = new URLSearchParams(location.search).get('room') || '';
const session = loadSession(code, role);
const showError = error => { $('error').textContent = error.message || String(error); };

if (!session) {
  showError(new Error('Open this game from the room launcher to restore your session.'));
} else {
  const client = new MiniEngine(session);
  let queue = Promise.resolve();
  let busy = false;
  const run = async operation => {
    $('error').textContent = '';
    busy = true;
    if (client.room) render(client.room);
    try { await operation(); } catch (error) { showError(error); }
    finally { busy = false; if (client.room) render(client.room); }
  };
  const enqueue = operation => {
    queue = queue.then(operation).catch(showError);
    return queue;
  };
  const stateOf = room => room.public_state && typeof room.public_state === 'object' && room.public_state.votes
    ? room.public_state : { votes: {} };
  const publish = votes => client.setState({ expected_version: client.room.version, public_state: { votes } });

  function render(room) {
    const state = stateOf(room);
    const votes = room.players.map(player => state.votes[player.id]).filter(value => typeof value === 'boolean');
    const mine = state.votes[room.you.player_id];
    const me = room.players.find(player => player.id === room.you.player_id);
    $('code').textContent = room.code;
    $('prompt').textContent = room.settings.prompt;
    $('status').textContent = !client.connected ? 'Reconnecting…' : room.status === 'lobby'
      ? 'Get ready. The host starts the vote.' : room.status === 'running' ? 'Voting is open.' : 'Voting finished.';
    $('yes').textContent = votes.filter(value => value).length;
    $('no').textContent = votes.filter(value => !value).length;
    $('player-controls').hidden = role !== 'player';
    $('host-controls').hidden = role !== 'host';
    $('ready').hidden = room.status !== 'lobby';
    $('ready').textContent = me?.ready ? 'Ready ✓' : "I'm ready";
    $('ready').disabled = busy || !client.connected;
    const voteDisabled = busy || !client.connected || !room.host_connected || room.status !== 'running' || (!room.settings.allow_change && typeof mine === 'boolean');
    $('vote-yes').disabled = voteDisabled;
    $('vote-no').disabled = voteDisabled;
    $('my-vote').textContent = typeof mine === 'boolean' ? 'Your vote: ' + (mine ? 'Yes' : 'No') : '';
    $('start').disabled = busy || !client.connected || room.status !== 'lobby' || !room.players.length || room.players.some(player => !player.ready);
    $('finish').disabled = busy || !client.connected || room.status !== 'running';
    $('reset').disabled = busy || !client.connected || room.status !== 'finished';
    $('players').replaceChildren(...room.players.map(player => {
      const item = document.createElement('li');
      item.textContent = player.name + (player.ready ? ' · ready' : '') + (player.connected ? '' : ' · offline');
      return item;
    }));
  }

  if (role === 'host') {
    // Every mutation waits for its snapshot and acknowledgement before reading the next version.
    client.on('snapshot', () => enqueue(async () => {
      const room = client.room;
      if (room?.status === 'lobby' && !room.public_state?.votes) await publish({});
    }));
    client.on('action', action => enqueue(async () => {
      const room = client.room;
      if (!room || room.status !== 'running' || action.name !== 'vote' || typeof action.data?.yes !== 'boolean') return;
      if (!room.players.some(player => player.id === action.player_id)) return;
      const state = stateOf(room);
      if (!room.settings.allow_change && typeof state.votes[action.player_id] === 'boolean') return;
      await publish({ ...state.votes, [action.player_id]: action.data.yes });
    }));
    $('start').onclick = () => run(() => enqueue(() => client.lifecycle('running')));
    $('finish').onclick = () => run(() => enqueue(() => client.lifecycle('finished')));
    $('reset').onclick = () => run(() => enqueue(() => client.lifecycle('lobby')));
  }
  $('ready').onclick = () => run(() => client.ready(!client.room.players.find(player => player.id === client.room.you.player_id)?.ready));
  $('vote-yes').onclick = () => run(() => client.action('vote', { yes: true }));
  $('vote-no').onclick = () => run(() => client.action('vote', { yes: false }));
  client.on('snapshot', render);
  client.on('error', showError);
  client.on('status', status => { if (client.room) render(client.room); else $('status').textContent = status; });
  client.on('closed', reason => { showError(new Error('Room connection closed: ' + reason)); });
  window.addEventListener('pagehide', () => client.close());
  window.addEventListener('pageshow', () => client.resume());
  client.connect();
}
`;

const css = `:root { color-scheme: light dark; font-family: system-ui, sans-serif; background: light-dark(#f6f4ed, #171c24); color: light-dark(#1e293b, #f6f4ed); }
* { box-sizing: border-box; }
body { margin: 0; padding: clamp(1rem, 5vw, 4rem); }
main { max-width: 48rem; margin: auto; }
.eyebrow { font-size: .8rem; letter-spacing: .1em; text-transform: uppercase; opacity: .7; }
h1 { font-size: clamp(2rem, 5vw, 3.5rem); line-height: 1.1; overflow-wrap: anywhere; }
.results { display: flex; gap: 1rem; margin: 2rem 0; }
.results div { flex: 1; border: 1px solid #778399; border-radius: 1rem; padding: 1.5rem; }
strong { display: block; font-size: 3.5rem; }
.actions { display: flex; gap: .75rem; flex-wrap: wrap; margin: 1rem 0; }
button { font: inherit; padding: .9rem 1.25rem; border: 0; border-radius: .75rem; background: #3557c7; color: white; cursor: pointer; min-height: 44px; }
button:focus-visible { outline: 3px solid #e7a321; outline-offset: 3px; }
button:disabled { opacity: .45; cursor: default; }
#error { color: light-dark(#a51e1e, #ffb0b0); min-height: 1.5em; }
li { margin: .5rem 0; }
[hidden] { display: none !important; }
`;
