/** How many launches, parked launches or buffered outcomes each map keeps. */
export const CACHE_MAX = 256;

/** An outcome that arrived before its launch's tool result, stamped with arrival order. */
type Buffered<O> = { seq: number; outcome: O };

/** What `join` decided for a launch whose tool result named its executor agent. */
export type Joined<O> = { kind: "write"; outcome: O } | { kind: "parked" };

/** Sets `key` as the newest entry and drops the oldest past `max`. */
function putNewest<T>(map: Map<string, T>, key: string, value: T, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/**
 * Worker routing's mutable state: launches by tool call id until their tool result, launches
 * waiting for their executor outcome by agent id, and outcomes that arrived first. One order
 * counter stamps tool calls and buffered outcomes, because the clock is not strictly increasing.
 */
export class LaunchBook<E extends { seq?: number }, O> {
  readonly #max: number;
  readonly #launches = new Map<string, E>();
  readonly #parked = new Map<string, E>();
  readonly #outcomes = new Map<string, Buffered<O>>();
  #seq = 0;
  #open = true;

  constructor(max = CACHE_MAX) {
    this.#max = max;
  }

  isOpen(): boolean {
    return this.#open;
  }

  /** The next order stamp; a tool call takes one each time it routes. */
  nextSeq(): number {
    return ++this.#seq;
  }

  launch(toolCallId: string): E | undefined {
    return this.#launches.get(toolCallId);
  }

  remember(toolCallId: string, entry: E): void {
    putNewest(this.#launches, toolCallId, entry, this.#max);
  }

  /** Removes and returns the launch for a tool result. */
  take(toolCallId: string): E | undefined {
    const entry = this.#launches.get(toolCallId);
    this.#launches.delete(toolCallId);
    return entry;
  }

  /**
   * Keeps an executor outcome until its launch's tool result arrives. The order stamp is taken
   * before `read` runs, so reading the outcome cannot reorder it behind a later tool call.
   */
  buffer(agentId: string, read: () => O): void {
    const seq = this.nextSeq();
    putNewest(this.#outcomes, agentId, { seq, outcome: read() }, this.#max);
  }

  dropOutcome(agentId: string): void {
    this.#outcomes.delete(agentId);
  }

  /**
   * Joins a launch with its agent's buffered outcome. Only an outcome that arrived after this
   * launch's tool call can be its own; otherwise the launch waits for its outcome.
   */
  join(agentId: string, entry: E): Joined<O> {
    const buffered = this.#outcomes.get(agentId);
    this.#outcomes.delete(agentId);
    if (buffered === undefined || buffered.seq < (entry.seq ?? 0)) {
      putNewest(this.#parked, agentId, entry, this.#max);
      return { kind: "parked" };
    }
    return { kind: "write", outcome: buffered.outcome };
  }

  /** Removes and returns the launch waiting for this agent's outcome. */
  claim(agentId: string): E | undefined {
    const entry = this.#parked.get(agentId);
    this.#parked.delete(agentId);
    return entry;
  }

  /** Launches, parked launches and buffered outcomes still held. */
  pending(): number {
    return this.#launches.size + this.#parked.size + this.#outcomes.size;
  }

  /** Stops the book: handlers ignore new events; what it holds stays until `clear`. */
  stop(): void {
    this.#open = false;
  }

  /** Forgets every launch, parked launch and buffered outcome. */
  clear(): void {
    this.#launches.clear();
    this.#parked.clear();
    this.#outcomes.clear();
  }
}
