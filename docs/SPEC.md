# Standalone SDK v0.2

Create a dependency-free typed browser/Node ESM client compatible with Mini Engine v1 and the engine v0.2 contract. Preserve `http`, `createRoom`, `joinRoom`, `getGames`, and `MiniEngine`. Add ApiClient with configurable origin/account bearer credentials, account APIs, readiness/configuration, action identity, event and snapshot helpers, and storage helpers using existing room session keys.

WebSockets authenticate on open, become connected only after snapshots, retain semantic projected snapshots, reject outstanding commands on disconnect/timeout, retry transient closure with bounded backoff, and never replay commands. Explicit resume reconnects a closed client.

Ship TypeScript source, compiled `dist/mini-engine.js` plus declarations, a CLI `create-mini-game <slug> [--directory path]` generating a trusted host-runtime vote game with all role HTML, supported settings schema and assets, package exports, tests, CI and an honest five minute local/package installation guide. The GitHub repository is private; no npm publication is performed.
