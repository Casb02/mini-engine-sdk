import { endpoint, MiniEngineError, normalizeCode } from './api.js';
import type { AchievementEarned, Ack, ActionEnvelope, ConnectionStatus, Json, Lifecycle, MutableRoomConfig, Realtime, RealtimeEmitOptions, RealtimeEventHandler, RealtimeFrom, RealtimeThrottled, RealtimeValueHandler, Snapshot, StateUpdate } from './types.js';

export interface SocketLike {
  readonly readyState: number;
  onopen: WebSocket['onopen'];
  onmessage: WebSocket['onmessage'];
  onclose: WebSocket['onclose'];
  onerror: WebSocket['onerror'];
  send(data: string): void;
  close(): void;
}
export interface MiniEngineOptions {
  code: string; token: string; baseUrl?: string; reconnectDelay?: number; requestTimeout?: number;
  WebSocket?: new (url: string) => SocketLike;
  /** `setInterval`: send coalesced realtime values at most this often, in ms (default 33). */
  realtime?: { setInterval?: number };
}
interface Pending { resolve: (ack: Ack) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
interface Events<P, S, V> {
  snapshot: Snapshot<P, S, V>; action: ActionEnvelope; status: ConnectionStatus; error: Error; closed: string; throttled: RealtimeThrottled;
  achievement: AchievementEarned;
}
export interface WaitOptions { timeout?: number; signal?: AbortSignal }
const transientReasons = new Set(['host_lagged', 'heartbeat_timeout', 'rate_limit', 'server_shutdown']);
let actionSequence = 0;
interface RealtimeLink { send(frame: Record<string, Json>): boolean; self(): RealtimeFrom | null }
interface RealtimeEntry { value: Json; from: RealtimeFrom; ts: number }
const senderOf = (from: string | RealtimeFrom): string =>
  typeof from === 'string' ? from : from.role === 'player' ? String(from.player_id ?? '') : from.role;
const fromOf = (value: unknown): RealtimeFrom => {
  const from = (value && typeof value === 'object' ? value : {}) as Partial<RealtimeFrom>;
  return { role: from.role ?? 'player', player_id: from.player_id ?? null };
};
function call<F extends (...args: never[]) => void>(handlers: Iterable<F> | undefined, ...args: Parameters<F>): void {
  for (const fn of [...(handlers ?? [])]) {
    try { fn(...args); } catch (error) { console.error(error); }
  }
}

class RealtimeChannel implements Realtime {
  private readonly events = new Map<string, Set<RealtimeEventHandler>>();
  private readonly watchers = new Map<string, Set<RealtimeValueHandler>>();
  private values = new Map<string, Map<string, RealtimeEntry>>();
  private readonly pending = new Map<string, Json>();
  /** Keys this connection set before its `rt.values` arrived; that frame cannot know them. */
  private readonly early = new Set<string>();
  private synced = false;
  private timer?: ReturnType<typeof setTimeout>;
  private flushed = 0;
  constructor(private readonly link: RealtimeLink, private readonly interval: number) {}
  emit(channel: string, data: Json = null, { to, echo }: RealtimeEmitOptions = {}): boolean {
    const frame: Record<string, Json> = { type: 'rt.emit', channel, data };
    if (to !== undefined) frame.to = to;
    if (echo) frame.echo = true;
    return this.link.send(frame);
  }
  on(channel: string, fn: RealtimeEventHandler): () => void { return listen(this.events, channel, fn); }
  onValue(key: string, fn: RealtimeValueHandler): () => void { return listen(this.watchers, key, fn); }
  value(from: string | RealtimeFrom, key: string): Json | undefined { return this.values.get(senderOf(from))?.get(key)?.value; }
  set(key: string, value: Json): void {
    const self = this.link.self();
    if (!self) return;
    if (!this.synced) this.early.add(key);
    this.pending.set(key, value);
    this.store(key, value, self, Date.now());
    if (this.timer !== undefined) return;
    const wait = this.flushed + this.interval - Date.now();
    if (wait <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
  }
  reset(): void {
    this.drop();
    this.link.send({ type: 'rt.reset' });
  }
  private flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.flushed = Date.now();
    for (const [key, value] of this.pending) this.link.send({ type: 'rt.set', key, value });
    this.pending.clear();
  }
  private store(key: string, value: Json, from: RealtimeFrom, ts: number): void {
    const sender = senderOf(from);
    if (value === null) {
      this.values.get(sender)?.delete(key);
      if (this.values.get(sender)?.size === 0) this.values.delete(sender);
    } else {
      if (!this.values.has(sender)) this.values.set(sender, new Map());
      this.values.get(sender)!.set(key, { value, from, ts });
    }
    this.notify(key, value, from, ts);
  }
  private notify(key: string, value: Json, from: RealtimeFrom, ts: number): void {
    call(this.watchers.get(key), value, from, ts, key);
    call(this.watchers.get('*'), value, from, ts, key);
  }
  receive(message: Record<string, unknown>): void {
    const ts = Number(message.ts) || 0;
    if (message.type === 'rt.event') {
      const channel = String(message.channel);
      const from = fromOf(message.from);
      call(this.events.get(channel), (message.data ?? null) as Json, from, ts, channel);
      call(this.events.get('*'), (message.data ?? null) as Json, from, ts, channel);
    } else if (message.type === 'rt.value') {
      this.store(String(message.key), (message.value ?? null) as Json, fromOf(message.from), ts);
    } else if (message.type === 'rt.values' && Array.isArray(message.values)) {
      const previous = this.values;
      this.values = new Map();
      for (const item of message.values as Record<string, unknown>[]) {
        const from = fromOf(item?.from);
        if (item?.value === null || item?.value === undefined) continue;
        if (!this.values.has(senderOf(from))) this.values.set(senderOf(from), new Map());
        this.values.get(senderOf(from))!.set(String(item.key), { value: item.value as Json, from, ts: Number(item.ts) || 0 });
      }
      const self = this.link.self();
      if (self) {
        const sender = senderOf(self);
        for (const key of this.early) {
          const entry = previous.get(sender)?.get(key);
          if (entry) {
            if (!this.values.has(sender)) this.values.set(sender, new Map());
            this.values.get(sender)!.set(key, entry);
          } else this.values.get(sender)?.delete(key);
        }
        if (this.values.get(sender)?.size === 0) this.values.delete(sender);
      }
      this.early.clear();
      this.synced = true;
      for (const [sender, entries] of previous) {
        for (const [key, entry] of entries) if (!this.values.get(sender)?.has(key)) this.notify(key, null, entry.from, entry.ts);
      }
      for (const [sender, entries] of this.values) {
        for (const [key, entry] of entries) if (previous.get(sender)?.get(key) !== entry) this.notify(key, entry.value, entry.from, entry.ts);
      }
    } else if (message.type === 'rt.reset') {
      const previous = this.values;
      this.values = new Map();
      for (const entries of previous.values()) for (const [key, entry] of entries) this.notify(key, null, entry.from, ts);
    }
  }
  /** Forget unsent values; they are never sent after a reconnect. */
  drop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
    this.early.clear();
    this.synced = false;
  }
  clear(): void {
    this.drop();
    this.values = new Map();
  }
}
function listen<F>(map: Map<string, Set<F>>, name: string, fn: F): () => void {
  if (!map.has(name)) map.set(name, new Set());
  map.get(name)!.add(fn);
  return () => { map.get(name)?.delete(fn); };
}
function actionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++actionSequence}`;
}

/** Commands are never automatically replayed, including after a timeout or reconnect. */
export class MiniEngine<P = Json, S = Record<string, Json>, V = Json> {
  readonly code: string;
  readonly token: string;
  room: Snapshot<P, S, V> | null = null;
  connected = false;
  readonly pending = new Map<string, Pending>();
  /** Ephemeral events and values for this room. */
  readonly realtime: Realtime;
  private readonly live: RealtimeChannel;
  private readonly options: MiniEngineOptions;
  private readonly listeners = new Map<string, Set<(value: never) => void>>();
  private readonly waiters = new Set<(error: Error) => void>();
  private socket?: SocketLike;
  private serial = 0;
  private attempt = 0;
  private stopped = true;
  private retry?: ReturnType<typeof setTimeout>;
  private cooldown = 0;

  constructor(options: MiniEngineOptions) {
    this.options = options;
    this.code = normalizeCode(options.code);
    this.token = options.token;
    this.live = new RealtimeChannel({
      send: frame => this.sendRealtime(frame),
      self: () => this.connected && this.room ? { role: this.room.you.role, player_id: this.room.you.player_id ?? null } : null,
    }, Math.max(0, options.realtime?.setInterval ?? 33));
    this.realtime = this.live;
  }
  on<K extends keyof Events<P, S, V>>(type: K, fn: (value: Events<P, S, V>[K]) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn as (value: never) => void);
    return () => { this.listeners.get(type)?.delete(fn as (value: never) => void); };
  }
  once<K extends keyof Events<P, S, V>>(type: K, fn: (value: Events<P, S, V>[K]) => void): () => void {
    const off = this.on(type, value => { off(); fn(value); });
    return off;
  }
  private emit<K extends keyof Events<P, S, V>>(type: K, value: Events<P, S, V>[K]): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      try { fn(value as never); } catch (error) { console.error(error); }
    }
  }
  connect(): this {
    if (!this.stopped) return this;
    this.stopped = false;
    this.attempt = 0;
    this.open();
    return this;
  }
  /** Explicitly reconnect; saved room state is retained until a fresh snapshot arrives. */
  resume(): this { return this.connect(); }
  private open(): void {
    if (this.stopped) return;
    this.emit('status', this.attempt ? 'reconnecting' : 'connecting');
    let socket: SocketLike;
    try {
      const base = this.options.baseUrl || globalThis.location?.origin || (globalThis.location?.host ? `${globalThis.location.protocol}//${globalThis.location.host}` : '');
      if (!base) throw new MiniEngineError('Set baseUrl outside a browser.', 'missing_base_url');
      const url = new URL(endpoint(base, `/api/v1/rooms/${encodeURIComponent(this.code)}/ws`));
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const Socket = this.options.WebSocket ?? globalThis.WebSocket;
      socket = new Socket(url.toString()) as SocketLike;
    } catch (error) {
      this.close();
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket === socket && !this.stopped) socket.send(JSON.stringify({ type: 'auth', token: this.token }));
    };
    socket.onmessage = event => {
      if (this.socket !== socket || this.stopped) return;
      let message: Record<string, unknown>;
      try { message = JSON.parse(event.data) as Record<string, unknown>; } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'snapshot' && message.room && typeof message.room === 'object') {
        this.room = message.room as Snapshot<P, S, V>;
        const wasConnected = this.connected;
        this.connected = true;
        this.attempt = 0;
        if (!wasConnected) this.emit('status', 'connected');
        this.emit('snapshot', this.room);
      } else if (message.type === 'ack') {
        const pending = this.pending.get(String(message.request_id));
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(String(message.request_id));
          pending.resolve(message as unknown as Ack);
        }
      } else if (message.type === 'error') {
        const body = message.error as { code?: string; message?: string } | undefined;
        const error = new MiniEngineError(body?.message || 'Verzoek mislukt.', body?.code);
        const pending = this.pending.get(String(message.request_id));
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(String(message.request_id));
          pending.reject(error);
        }
        this.emit('error', error);
        if (!this.connected && !message.request_id) this.close();
      } else if (message.type === 'closed') {
        const reason = String(message.reason);
        if (transientReasons.has(reason)) {
          if (reason === 'rate_limit') this.cooldown = 1200;
          socket.close();
        } else {
          this.close();
          this.emit('closed', reason);
        }
      } else if (message.type === 'action') this.emit('action', message as unknown as ActionEnvelope);
      else if (message.type === 'rt.throttled') this.emit('throttled', { dropped: Number(message.dropped) || 0 });
      else if (message.type === 'achievement' && message.achievement && typeof message.achievement === 'object') {
        this.emit('achievement', { player_id: String(message.player_id), achievement: message.achievement as AchievementEarned['achievement'] });
      }
      else if (typeof message.type === 'string' && message.type.startsWith('rt.')) this.live.receive(message);
    };
    socket.onerror = () => {}; // Close drives request rejection and backoff.
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.connected = false;
      this.live.drop();
      this.rejectPending(new MiniEngineError('Verbinding verbroken. Probeer opnieuw zodra je verbonden bent.', 'disconnected'));
      if (this.stopped) return;
      this.emit('status', 'reconnecting');
      const delay = Math.max(this.cooldown, Math.min(15000, (this.options.reconnectDelay ?? 500) * 2 ** Math.min(this.attempt++, 6)));
      this.cooldown = 0;
      this.retry = setTimeout(() => this.open(), delay + Math.random() * delay * 0.2);
    };
  }
  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  private sendRealtime(frame: Record<string, Json>): boolean {
    if (!this.connected || this.socket?.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify(frame)); return true; } catch { return false; }
  }
  request(type: string, payload: Record<string, unknown> = {}): Promise<Ack> {
    if (!this.connected || this.socket?.readyState !== 1) return Promise.reject(new MiniEngineError('Je bent nog niet verbonden.', 'not_connected'));
    const request_id = String(++this.serial);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request_id);
        reject(new MiniEngineError('Geen bevestiging ontvangen. Controleer de actuele spelstand voordat je opnieuw probeert.', 'request_timeout'));
      }, this.options.requestTimeout ?? 10000);
      this.pending.set(request_id, { resolve, reject, timer });
      try { this.socket!.send(JSON.stringify({ ...payload, type, request_id })); }
      catch (error) { clearTimeout(timer); this.pending.delete(request_id); reject(error); }
    });
  }
  action(name: string, data: Json = {}, { actionId: id = actionId() }: { actionId?: string } = {}): Promise<Ack> {
    if (!id || id.length > 64) return Promise.reject(new MiniEngineError('actionId must contain 1–64 characters.', 'invalid_action_id'));
    return this.request('action', { name, data, action_id: id });
  }
  setState(state: StateUpdate<P>): Promise<Ack> { return this.request('set_state', { ...state }); }
  lifecycle(status: Lifecycle): Promise<Ack> { return this.request('lifecycle', { status }); }
  setSettings(settings: S): Promise<Ack> { return this.request('settings', { expected_version: this.room?.version, settings }); }
  ready(ready = true): Promise<Ack> { return this.request('ready', { ready }); }
  configure(config: MutableRoomConfig): Promise<Ack> { return this.request('configure', { expected_version: this.room?.version, config }); }
  /** Host of a browser-host game: grant a declared achievement to a seated player with an account. Awarding twice still acks. */
  award(playerId: string, achievementId: string): Promise<Ack> { return this.request('award', { player_id: playerId, achievement_id: achievementId }); }
  waitForSnapshot(predicate: (room: Snapshot<P, S, V>) => boolean = () => true, { timeout = this.options.requestTimeout ?? 10000, signal }: WaitOptions = {}): Promise<Snapshot<P, S, V>> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    if (this.connected && this.room && predicate(this.room)) return Promise.resolve(this.room);
    return new Promise((resolve, reject) => {
      const cleanup = () => { off(); clearTimeout(timer); signal?.removeEventListener('abort', abort); this.waiters.delete(fail); };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const abort = () => fail(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      const off = this.on('snapshot', room => {
        try { if (predicate(room)) { cleanup(); resolve(room); } } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      });
      const timer = setTimeout(() => fail(new MiniEngineError('Timed out waiting for a snapshot.', 'snapshot_timeout')), timeout);
      signal?.addEventListener('abort', abort, { once: true });
      this.waiters.add(fail);
    });
  }
  close(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    this.connected = false;
    const error = new MiniEngineError('Verbinding gesloten.', 'closed');
    this.rejectPending(error);
    this.live.clear();
    for (const fail of [...this.waiters]) fail(error);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.emit('status', 'disconnected');
  }
}
