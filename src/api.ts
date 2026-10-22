import type { Account, AccountSession, AccountStats, CreateRoomOptions, Json, Manifest, RoomCredentials, Snapshot, RoomConfig, Lifecycle } from './types.js';

export class MiniEngineError extends Error {
  constructor(message: string, public code = 'client_error', public status?: number) {
    super(message);
    this.name = 'MiniEngineError';
  }
}
export interface HttpOptions extends RequestInit { token?: string }
export interface ApiClientOptions { baseUrl?: string; accountToken?: string; fetch?: typeof fetch }
export const normalizeCode = (code: string): string => code.trim().toUpperCase();
export function endpoint(baseUrl: string, path: string): string {
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${path}` : path;
}

/** Fetch JSON without persisting or logging bearer credentials. */
export async function http<T = unknown>(path: string, { token, ...options }: HttpOptions = {}, fetcher: typeof fetch = globalThis.fetch): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetcher(path, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    throw new MiniEngineError(body.error?.message || `Verzoek mislukt (${response.status}).`, body.error?.code || 'http_error', response.status);
  }
  return response.status === 204 ? null as T : response.json() as Promise<T>;
}

export class ApiClient {
  readonly baseUrl: string;
  accountToken?: string;
  private readonly fetcher?: typeof fetch;
  constructor({ baseUrl = '', accountToken, fetch: fetcher }: ApiClientOptions = {}) {
    this.baseUrl = baseUrl;
    this.accountToken = accountToken;
    this.fetcher = fetcher;
  }
  private call<T>(path: string, options: HttpOptions = {}): Promise<T> {
    return http<T>(endpoint(this.baseUrl, `/api/v1${path}`), options, this.fetcher ?? globalThis.fetch);
  }
  getGames(): Promise<{ games: Manifest[] }> { return this.call('/games'); }
  getGame(id: string): Promise<Manifest> { return this.call(`/games/${encodeURIComponent(id)}`); }
  createRoom(options: CreateRoomOptions): Promise<RoomCredentials> {
    return this.call('/rooms', { method: 'POST', token: this.accountToken, body: JSON.stringify(options) });
  }
  joinRoom(code: string, name: string): Promise<RoomCredentials> {
    return this.call(`${this.roomPath(code)}/join`, { method: 'POST', token: this.accountToken, body: JSON.stringify({ name }) });
  }
  getRoom<P = Json>(code: string, token: string): Promise<Snapshot<P>> {
    return this.call(this.roomPath(code), { token });
  }
  roomInfo(code: string): Promise<{ code: string; game_id: string; status: Lifecycle; player_count: number; max_players: number; runtime?: string; config?: RoomConfig }> {
    return this.call(`${this.roomPath(code)}/info`);
  }
  gameData<T = unknown>(code: string, token: string): Promise<T> { return this.call(`${this.roomPath(code)}/game-data`, { token }); }
  displayToken(code: string, token: string): Promise<{ token: string }> {
    return this.call(`${this.roomPath(code)}/display-token`, { method: 'POST', token });
  }
  register(input: { username: string; password: string; display_name: string }): Promise<AccountSession> {
    return this.call('/accounts/register', { method: 'POST', body: JSON.stringify(input) });
  }
  login(input: { username: string; password: string }): Promise<AccountSession> {
    return this.call('/accounts/login', { method: 'POST', body: JSON.stringify(input) });
  }
  me(): Promise<Account> { return this.call('/accounts/me', { token: this.accountToken }); }
  stats(): Promise<AccountStats> { return this.call('/accounts/stats', { token: this.accountToken }); }
  async logout(): Promise<null> {
    const result = await this.call<null>('/accounts/logout', { method: 'POST', token: this.accountToken });
    this.accountToken = undefined;
    return result;
  }
  private roomPath(code: string): string { return `/rooms/${encodeURIComponent(normalizeCode(code))}`; }
}

/** Legacy helpers use the current origin; use ApiClient for a separate server or account. */
export const getGames = (): Promise<{ games: Manifest[] }> => new ApiClient().getGames();
export const createRoom = (options: CreateRoomOptions): Promise<RoomCredentials> => new ApiClient().createRoom(options);
export const joinRoom = (code: string, name: string): Promise<RoomCredentials> => new ApiClient().joinRoom(code, name);
