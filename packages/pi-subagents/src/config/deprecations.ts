/**
 * deprecations.ts — One-shot deprecation warnings.
 *
 * A deprecated field warns once per key: a session-wide set for tool
 * parameters and service options, and a per-load set the caller owns for
 * frontmatter. Warnings go through `debugNote`, the package's silent-by-design
 * channel.
 */

import { debugNote } from "#src/debug";

const warnedThisSession = new Set<string>();

/** Warn once per session for `key`. */
export function warnDeprecatedOnce(key: string, message: string): void {
  if (warnedThisSession.has(key)) return;
  warnedThisSession.add(key);
  debugNote(`deprecated: ${message}`);
}

/** Warn once per `key` within `seen`, the set one load owns. */
export function warnDeprecatedIn(seen: Set<string>, key: string, message: string): void {
  if (seen.has(key)) return;
  seen.add(key);
  debugNote(`deprecated: ${message}`);
}

/** Forget the session's warnings; a new session may warn again. */
export function resetDeprecationWarnings(): void {
  warnedThisSession.clear();
}
