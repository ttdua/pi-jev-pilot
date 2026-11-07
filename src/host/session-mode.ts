import type { SessionEntryLike } from "../jev/branch.ts";
import { readSessionMode } from "../jev/session-mode.ts";
import type { Mode } from "../store/defaults.ts";

/** The worker mode of the one main session that is currently open. */
export type SessionModeHolder = {
  /** Make `sessionId` the current session and read its mode from the branch entries. */
  rebuild(sessionId: string, entries: readonly SessionEntryLike[]): void;
  /** Make `sessionId` current, rebuilding from `entries` only when it is not already. */
  ensure(sessionId: string, entries: readonly SessionEntryLike[]): void;
  /** Change the mode; ignored when `sessionId` is not the current session. */
  set(sessionId: string, mode: Mode | undefined): void;
  /** The mode of `sessionId` (or of the current session when omitted), if it is the current one. */
  modeFor(sessionId: string | undefined): Mode | undefined;
};

export function createSessionModeHolder(): SessionModeHolder {
  let currentId: string | undefined;
  let mode: Mode | undefined;
  return {
    rebuild(sessionId, entries) {
      currentId = sessionId;
      mode = readSessionMode(entries);
    },
    ensure(sessionId, entries) {
      if (sessionId !== currentId) this.rebuild(sessionId, entries);
    },
    set(sessionId, next) {
      if (sessionId === currentId) mode = next;
    },
    modeFor(sessionId) {
      const id = sessionId ?? currentId;
      return id !== undefined && id === currentId ? mode : undefined;
    },
  };
}

/** Process-wide slot, so every copy of the extension in this process shares one holder. */
export const SESSION_MODE_KEY: unique symbol = Symbol.for("pi-jev-pilot.sessionMode") as never;

export function sessionModes(): SessionModeHolder {
  const slots = globalThis as unknown as Record<symbol, SessionModeHolder | undefined>;
  return (slots[SESSION_MODE_KEY] ??= createSessionModeHolder());
}
