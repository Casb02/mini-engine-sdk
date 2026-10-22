import type { Account, AccountAchievement, AccountSession, AccountStats, CreateRoomOptions, Json, JsonCompatible, Manifest, NewSet, RoomCredentials, RoomInfo, SavedSet, SetFilter, SetSummary, Snapshot } from './types.js';

export class MiniEngineError extends Error {
  constructor(message: string, public code = 'client_error', public status?: number) {
    super(message);
    this.name = 'MiniEngineError';
  }
}
export interface HttpOptions extends RequestInit { token?: string }
export interface ApiClientOptions { baseUrl?: string; accountToken?: string; fetch?: typeof fetch }
/** The Cloudflare Turnstile widget's token; `accountConfig()` gives the site key to render it with. */
export interface TurnstileOptions { turnstileToken?: string }
const turnstileHeaders = (token?: string): Record<string, string> => token ? { 'X-Turnstile-Token': token } : {};
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
  roomInfo(code: string): Promise<RoomInfo> {
    return this.call(`${this.roomPath(code)}/info`);
  }
  gameData<T = unknown>(code: string, token: string): Promise<T> { return this.call(`${this.roomPath(code)}/game-data`, { token }); }
  displayToken(code: string, token: string): Promise<{ token: string }> {
    return this.call(`${this.roomPath(code)}/display-token`, { method: 'POST', token });
  }
  /**
   * Creates an account; the engine mails a confirmation link to `email`.
   * When the engine runs Turnstile, pass the widget token rendered with action `register`.
   */
  register(input: { username: string; password: string; display_name: string; email: string }, { turnstileToken }: TurnstileOptions = {}): Promise<AccountSession> {
    return this.call('/accounts/register', { method: 'POST', headers: turnstileHeaders(turnstileToken), body: JSON.stringify(input) });
  }
  /** Confirms an address with the token from the `?verify=` link; needs that account's `accountToken`. */
  verifyEmail(token: string): Promise<{ account: Account }> {
    return this.call('/accounts/verify-email', { method: 'POST', token: this.accountToken, body: JSON.stringify({ token }) });
  }
  /** Adds or changes the account address, or resends the confirmation link; a Turnstile token uses action `email`. */
  setEmail(email: string, { turnstileToken }: TurnstileOptions = {}): Promise<{ account: Account; verification_sent: boolean }> {
    return this.call('/accounts/email', { method: 'PUT', token: this.accountToken, headers: turnstileHeaders(turnstileToken), body: JSON.stringify({ email }) });
  }
  login(input: { username: string; password: string }): Promise<AccountSession> {
    return this.call('/accounts/login', { method: 'POST', body: JSON.stringify(input) });
  }
  /** Public account settings; `turnstile_site_key` is `null` when the engine does not check for robots. */
  accountConfig(): Promise<{ turnstile_site_key: string | null }> { return this.call('/accounts/config'); }
  me(): Promise<Account> { return this.call('/accounts/me', { token: this.accountToken }); }
  stats(): Promise<AccountStats> { return this.call('/accounts/stats', { token: this.accountToken }); }
  /** Achievements of an account, newest first; defaults to this client's `accountToken`. */
  achievements(accountToken = this.accountToken): Promise<{ achievements: AccountAchievement[] }> {
    return this.call('/accounts/achievements', { token: accountToken });
  }
  /** The account's sets without their content, most recently changed first. */
  listSets(filter: SetFilter = {}): Promise<{ sets: SetSummary[] }> {
    const query = new URLSearchParams();
    if (filter.game_id !== undefined) query.set('game_id', filter.game_id);
    if (filter.kind !== undefined) query.set('kind', filter.kind);
    const search = query.toString();
    return this.call(`/accounts/sets${search ? `?${search}` : ''}`, { token: this.accountToken });
  }
  /** One of the account's sets with its content; another account's set answers 404 `set_not_found`. */
  getSet<Data = Json>(id: string): Promise<SavedSet<Data>> {
    return this.call(this.setPath(id), { token: this.accountToken });
  }
  /** Saves a set; the kind must be declared by the game's active release and the data must match its schema. */
  createSet<Data = Json>(input: NewSet<Data> & { data: JsonCompatible<Data> }): Promise<SavedSet<Data>> {
    return this.call('/accounts/sets', { method: 'POST', token: this.accountToken, body: JSON.stringify(input) });
  }
  /** Replaces the title and content of a set; rooms that already use it keep their copy. */
  updateSet<Data = Json>(id: string, input: { title: string; data: Data & JsonCompatible<Data> }): Promise<SavedSet<Data>> {
    return this.call(this.setPath(id), { method: 'PUT', token: this.accountToken, body: JSON.stringify(input) });
  }
  deleteSet(id: string): Promise<null> {
    return this.call(this.setPath(id), { method: 'DELETE', token: this.accountToken });
  }
  async logout(): Promise<null> {
    const result = await this.call<null>('/accounts/logout', { method: 'POST', token: this.accountToken });
    this.accountToken = undefined;
    return result;
  }
  private roomPath(code: string): string { return `/rooms/${encodeURIComponent(normalizeCode(code))}`; }
  private setPath(id: string): string { return `/accounts/sets/${encodeURIComponent(id)}`; }
}

/** Legacy helpers use the current origin; use ApiClient for a separate server or account. */
export const getGames = (): Promise<{ games: Manifest[] }> => new ApiClient().getGames();
export const createRoom = (options: CreateRoomOptions): Promise<RoomCredentials> => new ApiClient().createRoom(options);
export const joinRoom = (code: string, name: string): Promise<RoomCredentials> => new ApiClient().joinRoom(code, name);
