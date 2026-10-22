/** JSON values accepted by Mini Engine's wire protocol. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Role = 'host' | 'player' | 'display';
export type HostMode = 'moderator' | 'playing' | 'hostless';
export type Lifecycle = 'lobby' | 'running' | 'finished';
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export interface RoomConfig { host_mode: HostMode; display_enabled: boolean; allow_late_join: boolean }
export type MutableRoomConfig = Partial<Pick<RoomConfig, 'display_enabled' | 'allow_late_join'>>;
export interface Player { id: string; name: string; connected: boolean; ready?: boolean; account_id?: string | null }
export interface Snapshot<PublicState = Json, Settings = Record<string, Json>, PrivateState = Json> {
  code: string; game_id: string; status: Lifecycle; version: number; max_players: number;
  host_connected: boolean; players: Player[]; public_state: PublicState; settings: Settings;
  runtime?: 'host' | 'server'; config?: RoomConfig; round_id?: string;
  you: { role: Role; player_id?: string | null };
  host_state?: Json; player_states?: Record<string, Json>; private_state?: PrivateState;
}
export interface SettingsProperty {
  type: 'integer' | 'number' | 'string' | 'boolean'; enum?: Json[];
  minimum?: number; maximum?: number; maxLength?: number;
  title?: string; description?: string; default?: Json;
}
export interface Manifest<Settings = Record<string, Json>> {
  id: string; title: string; description: string; version: string;
  min_players: number; max_players: number; has_display: boolean;
  default_settings: Settings;
  settings_schema: { type: 'object'; properties: Record<string, SettingsProperty>; required?: string[]; additionalProperties: false; title?: string; description?: string; default?: Settings };
  runtime?: 'host' | 'server'; host_modes?: HostMode[]; default_host_mode?: HostMode;
  /** Whether the game can support joins after start; omitted legacy packages default to true. */
  supports_late_join?: boolean;
}
export interface RoomCredentials { code: string; token: string; role: Role; player_id?: string | null; display_token?: string }
export interface CreateRoomOptions { game_id: string; max_players?: number; settings?: Record<string, Json>; name?: string; config?: Partial<RoomConfig> }
export interface Account { id: string; username: string; display_name: string; created_at: string | number; email: string | null; email_verified: boolean }
export interface AccountSession { account: Account; token: string }
export interface AccountStats {
  totals: { games_played: number; wins: number };
  games: { game_id: string; games_played: number; wins: number; total_score: number; best_score: number | null; counters: Record<string, number> }[];
  recent: Json[];
}
export interface Ack { type: 'ack'; request_id?: string }
/** Who sent a realtime event or value. The server stamps it; clients cannot set it. */
export interface RealtimeFrom { role: Role; player_id: string | null }
/** Receivers of a realtime event: everyone, one role, or up to 16 player ids. */
export type RealtimeTarget = 'all' | 'host' | 'players' | 'display' | string[];
export interface RealtimeEmitOptions { to?: RealtimeTarget; echo?: boolean }
export interface RealtimeThrottled { dropped: number }
/** `ts` is the server receive time in ms since the Unix epoch. */
export type RealtimeEventHandler = (data: Json, from: RealtimeFrom, ts: number, channel: string) => void;
/** `value` is `null` when the key was deleted. */
export type RealtimeValueHandler = (value: Json, from: RealtimeFrom, ts: number, key: string) => void;
/** Ephemeral events and latest-wins values. Never stored, versioned, queued or replayed. */
export interface Realtime {
  /** Send an event; returns false when not connected (the event is dropped, not queued). */
  emit(channel: string, data?: Json, options?: RealtimeEmitOptions): boolean;
  /** Listen to one channel, or to every channel with '*'. Returns an unsubscribe function. */
  on(channel: string, fn: RealtimeEventHandler): () => void;
  /** Set this connection's value for a key; `null` deletes it. Coalesced per key. */
  set(key: string, value: Json): void;
  /** Latest value of a key from a sender: 'host', 'display', a player id or a `from` object. */
  value(from: string | RealtimeFrom, key: string): Json | undefined;
  /** Listen to one key, or to every key with '*'. Returns an unsubscribe function. */
  onValue(key: string, fn: RealtimeValueHandler): () => void;
  /** Host only: clear every value in the room. */
  reset(): void;
}
export interface ActionEnvelope { type: 'action'; player_id: string; name: string; data: Json; request_id?: string; action_id?: string }
export interface StateUpdate<PublicState = Json> { expected_version: number; public_state: PublicState; host_state?: Json; player_states?: Record<string, Json> }
export interface ActionPayloads {
  roll: { held?: number[] }; clear_history: Record<string, never>; start: Record<string, never>; finish: Record<string, never>;
  choose_team: { team_id: string }; buzz: Record<string, never>; select_clue: { clue_id: string };
  judge: { correct: boolean }; reveal: Record<string, never>; reopen: Record<string, never>; close_clue: Record<string, never>;
}
