/** JSON values accepted by Mini Engine's wire protocol. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** `T` when it serializes to JSON as it is, interfaces without an index signature included; `never` for functions, dates, maps, bigint and undefined. */
export type JsonCompatible<T> =
  T extends null | boolean | number | string ? T
  : T extends (...args: never[]) => unknown ? never
  : T extends readonly (infer Item)[] ? readonly JsonCompatible<Item>[]
  : T extends object ? { [K in keyof T]: JsonCompatible<T[K]> }
  : never;
export type Role = 'host' | 'player' | 'display';
export type HostMode = 'moderator' | 'playing' | 'hostless';
export type Lifecycle = 'lobby' | 'running' | 'finished';
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export interface RoomConfig { host_mode: HostMode; display_enabled: boolean; allow_late_join: boolean }
export type MutableRoomConfig = Partial<Pick<RoomConfig, 'display_enabled' | 'allow_late_join'>>;
export interface Player { id: string; name: string; connected: boolean; ready?: boolean; account_id?: string | null }
/** The saved set a room plays with. Public in every snapshot; only the host reads the content, through `gameData()`. */
export interface RoomSet { id: string; kind: string; title: string }
export interface Snapshot<PublicState = Json, Settings = Record<string, Json>, PrivateState = Json> {
  code: string; game_id: string; status: Lifecycle; version: number; max_players: number;
  /** The uploaded release the room runs; absent for built-in games. */
  game_version?: string | null;
  host_connected: boolean; players: Player[]; public_state: PublicState; settings: Settings;
  runtime?: 'host' | 'server'; config?: RoomConfig; round_id?: string;
  /** `null` when the room plays with the game's own data. */
  set?: RoomSet | null;
  /** The creator's own seat when they play along (`host_mode: 'playing'`), otherwise `null`. That seat is in `players`. */
  host_player_id?: string | null;
  you: { role: Role; player_id?: string | null };
  host_state?: Json; player_states?: Record<string, Json>; private_state?: PrivateState;
}
/** What `roomInfo()` shows before joining: no players, no state. */
export interface RoomInfo {
  code: string; game_id: string; game_version?: string | null; status: Lifecycle;
  player_count: number; max_players: number; runtime?: 'host' | 'server'; config?: RoomConfig;
  set?: RoomSet | null;
}
export interface SettingsProperty {
  type: 'integer' | 'number' | 'string' | 'boolean'; enum?: Json[];
  minimum?: number; maximum?: number; maxLength?: number;
  title?: string; description?: string; default?: Json;
}
/** An achievement a game declares in its manifest; at most 50 per game. */
export interface AchievementDefinition {
  /** `^[a-z0-9][a-z0-9_-]{0,47}$`, unique within the game. */
  id: string;
  /** 1–60 characters. */
  title: string;
  /** 1–160 characters. */
  description: string;
}
interface SetSchemaNode { title?: string; description?: string }
/** The set schema dialect, a bounded JSON Schema subset: at most 8 levels and 256 nodes; objects forbid extra properties, arrays declare items. */
export type SetSchema =
  | (SetSchemaNode & { type: 'object'; properties: Record<string, SetSchema>; required?: string[]; additionalProperties: false })
  | (SetSchemaNode & { type: 'array'; items: SetSchema; minItems?: number; maxItems?: number })
  | (SetSchemaNode & { type: 'string'; minLength?: number; maxLength?: number; enum?: string[] })
  | (SetSchemaNode & { type: 'integer' | 'number'; minimum?: number; maximum?: number })
  | (SetSchemaNode & { type: 'boolean' });
/** A kind of set players can save for a game; at most 4 per game. */
export interface SetKind {
  /** `^[a-z0-9][a-z0-9_-]{0,47}$`, unique within the game. */
  id: string;
  /** 1–60 characters. */
  title: string;
  /** 1–160 characters. */
  description: string;
  schema: SetSchema;
}
export interface Manifest<Settings = Record<string, Json>> {
  id: string; title: string; description: string; version: string;
  min_players: number; max_players: number; has_display: boolean;
  default_settings: Settings;
  settings_schema: { type: 'object'; properties: Record<string, SettingsProperty>; required?: string[]; additionalProperties: false; title?: string; description?: string; default?: Settings };
  runtime?: 'host' | 'server'; host_modes?: HostMode[]; default_host_mode?: HostMode;
  /** Whether the game can support joins after start; omitted legacy packages default to true. */
  supports_late_join?: boolean;
  achievements?: AchievementDefinition[];
  set_kinds?: SetKind[];
  /** Optional package path `assets/<name>.svg`: a square SVG tile of at most 64 KiB, without scripts, event attributes or `<foreignObject>`. Absent → the engine's own mark. */
  icon?: string;
}
export interface RoomCredentials { code: string; token: string; role: Role; player_id?: string | null; display_token?: string }
export interface CreateRoomOptions {
  game_id: string; max_players?: number; settings?: Record<string, Json>; name?: string; config?: Partial<RoomConfig>;
  /** A set of the signed-in account for this game; needs the account token. The room keeps a copy. */
  set_id?: string;
}
/** A set saved on an account, as listed: without its content. */
export interface SetSummary {
  id: string; game_id: string; kind: string; title: string;
  /** Bytes of the serialized content; at most 64 KiB. */
  size: number;
  /** Seconds since the Unix epoch. */
  created_at: number; updated_at: number;
}
export interface SavedSet<Data = Json> extends SetSummary { data: Data }
export interface NewSet<Data = Json> {
  game_id: string; kind: string;
  /** 1–80 characters. */
  title: string;
  data: Data;
}
export interface SetFilter { game_id?: string; kind?: string }
export interface Account { id: string; username: string; display_name: string; created_at: string | number; email: string | null; email_verified: boolean }
export interface AccountSession { account: Account; token: string }
export interface AccountStats {
  totals: { games_played: number; wins: number };
  games: { game_id: string; games_played: number; wins: number; total_score: number; best_score: number | null; counters: Record<string, number> }[];
  recent: Json[];
}
/** `server`: decided by a built-in server runtime. `game`: granted by a browser-host game itself, not verified by the server. */
export type AchievementSource = 'server' | 'game';
/** One achievement of the signed-in account; title and description are kept from the moment it was earned. */
export interface AccountAchievement {
  game_id: string;
  /** The game's current title, or null when the engine no longer knows the game. */
  game_title: string | null;
  id: string; title: string; description: string;
  source: AchievementSource;
  /** Seconds since the Unix epoch. */
  awarded_at: number;
}
/** Broadcast to the whole room when a player earns an achievement for the first time. Not versioned, not in the snapshot. */
export interface AchievementEarned { player_id: string; achievement: AchievementDefinition }
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
  /** Host only: clear every value in the room. Values you set after calling it are kept. */
  reset(): void;
}
export interface ActionEnvelope { type: 'action'; player_id: string; name: string; data: Json; request_id?: string; action_id?: string }
export interface StateUpdate<PublicState = Json> { expected_version: number; public_state: PublicState; host_state?: Json; player_states?: Record<string, Json> }
export interface ActionPayloads {
  roll: { held?: number[] }; clear_history: Record<string, never>; start: Record<string, never>; finish: Record<string, never>;
  choose_team: { team_id: string }; buzz: Record<string, never>; select_clue: { clue_id: string };
  judge: { correct: boolean }; reveal: Record<string, never>; reopen: Record<string, never>; close_clue: Record<string, never>;
}
