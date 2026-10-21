import { endpoint, MiniEngineError, normalizeCode } from './api.js';
import type { Ack, ActionEnvelope, ConnectionStatus, Json, Lifecycle, MutableRoomConfig, Snapshot, StateUpdate } from './types.js';

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
}
interface Pending { resolve: (ack: Ack) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
interface Events<P, S, V> {
  snapshot: Snapshot<P, S, V>; action: ActionEnvelope; status: ConnectionStatus; error: Error; closed: string;
}
export interface WaitOptions { timeout?: number; signal?: AbortSignal }
const transientReasons = new Set(['host_lagged', 'heartbeat_timeout', 'rate_limit', 'server_shutdown']);
let actionSequence = 0;
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
    };
    socket.onerror = () => {}; // Close drives request rejection and backoff.
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.connected = false;
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
    for (const fail of [...this.waiters]) fail(error);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    this.emit('status', 'disconnected');
  }
}
