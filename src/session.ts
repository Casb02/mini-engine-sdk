import { normalizeCode } from './api.js';
import type { Role, RoomCredentials } from './types.js';

export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const sessionKey = (code: string, role: Role): string => `mini-engine:${normalizeCode(code)}:${role}`;
export function saveSession(session: RoomCredentials, storage: SessionStorage = globalThis.sessionStorage): void {
  storage.setItem(sessionKey(session.code, session.role), JSON.stringify({ ...session, code: normalizeCode(session.code) }));
}
export function loadSession(code: string, role: Role, storage: SessionStorage = globalThis.sessionStorage): RoomCredentials | null {
  try {
    const value = JSON.parse(storage.getItem(sessionKey(code, role)) ?? 'null') as RoomCredentials | null;
    return value && normalizeCode(value.code) === normalizeCode(code) && value.role === role && typeof value.token === 'string' && value.token.length > 0 ? value : null;
  } catch { return null; }
}
export function removeSession(code: string, role: Role, storage: SessionStorage = globalThis.sessionStorage): void {
  storage.removeItem(sessionKey(code, role));
}
