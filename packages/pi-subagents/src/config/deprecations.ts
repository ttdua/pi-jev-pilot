/**
 * deprecations.ts — One-shot deprecation warnings.
 *
 * A `DeprecationWarnings` instance remembers which keys it has already warned
 * about. The extension owns one per runtime and resets it at each
 * `session_start`, so each alias warns once per session and runtimes never
 * share state. Each warning is printed with `console.warn` so the user sees
 * it.
 */

/** Print one deprecation warning where the user sees it. */
function emit(message: string): void {
  console.warn(`[pi-subagents] deprecated: ${message}`);
}

/** Warn-once memory for one runtime's session. */
export class DeprecationWarnings {
  private readonly seen = new Set<string>();

  /** Warn once per `key` since the last `reset`. */
  warnOnce(key: string, message: string): void {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    emit(message);
  }

  /** Forget every warning; the next session may warn again. */
  reset(): void {
    this.seen.clear();
  }
}

/** Used by callers that were not handed a runtime's instance (tests, direct use). */
export const defaultDeprecationWarnings = new DeprecationWarnings();

/** Warn once per `key` within `seen`, a set one frontmatter load owns. */
export function warnDeprecatedIn(seen: Set<string>, key: string, message: string): void {
  if (seen.has(key)) return;
  seen.add(key);
  emit(message);
}
