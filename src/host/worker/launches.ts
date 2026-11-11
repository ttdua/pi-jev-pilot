import type { EffectiveValues } from "../../policy/worker/index.ts";

/** How many launches the book keeps while they wait for their outcome. */
export const CACHE_MAX = 256;

/** A launch the policy decided, with what the executor reported for it so far. */
export type Held<E> = {
  entry: E;
  /** From `subagents:child:session-created`; absent until the session exists. */
  effective?: EffectiveValues;
  /** From `subagents:child:bound`: the grants that took effect in the child. */
  grantedTools?: readonly string[];
};

/**
 * Worker routing's mutable state: launches the policy decided, by executor agent id, until their
 * outcome arrives. Outcomes for an id the book does not hold (a resume, a launch the policy did
 * not route, another session's launch) are ignored.
 */
export class LaunchBook<E> {
  readonly #max: number;
  readonly #held = new Map<string, Held<E>>();
  #open = true;

  constructor(max = CACHE_MAX) {
    this.#max = max;
  }

  isOpen(): boolean {
    return this.#open;
  }

  /** Holds a decided launch as the newest; the oldest is dropped past the cap. */
  remember(agentId: string, entry: E): void {
    this.#held.delete(agentId);
    this.#held.set(agentId, { entry });
    while (this.#held.size > this.#max) {
      const oldest = this.#held.keys().next().value;
      if (oldest === undefined) break;
      this.#held.delete(oldest);
    }
  }

  /** Records the effective model and thinking of a held launch's session. */
  sessionCreated(agentId: string, effective: EffectiveValues): void {
    const held = this.#held.get(agentId);
    if (held !== undefined) held.effective = effective;
  }

  /** Records the grants the executor reports as taken effect in a held launch's child. */
  bound(agentId: string, grantedTools: readonly string[]): void {
    const held = this.#held.get(agentId);
    if (held !== undefined) held.grantedTools = grantedTools;
  }

  /** Removes and returns a held launch when its outcome arrives. */
  settle(agentId: string): Held<E> | undefined {
    const held = this.#held.get(agentId);
    this.#held.delete(agentId);
    return held;
  }

  /** Launches still waiting for their outcome. */
  pending(): number {
    return this.#held.size;
  }

  /** Stops the book: the policy and the event handlers ignore new launches and events. */
  stop(): void {
    this.#open = false;
  }

  /** Forgets every held launch. */
  clear(): void {
    this.#held.clear();
  }
}
