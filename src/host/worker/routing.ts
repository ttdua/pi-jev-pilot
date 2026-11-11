import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { askJev } from "../../jev/client.ts";
import type { WindowEntry } from "../../policy/worker/index.ts";
import { appendLedger } from "../../store/ledger.ts";
import { jevDir, loadSnapshot, type Snapshot } from "../platform/index.ts";
import { mainService, type VendoredService } from "../tools/index.ts";
import { LaunchBook } from "./launches.ts";
import {
  BOUND,
  OUTCOME_EVENTS,
  onBound,
  onOutcome,
  onSessionCreated,
  SESSION_CREATED,
} from "./outcomes.ts";
import { createWorkerPolicy, type Decided, type WorkerHost } from "./policy.ts";
import type { MainContext } from "./request.ts";
import { LaunchWarnings } from "./warnings.ts";

/** The executor's watchdog for one policy call; Jev requests are bounded by the classifier timeout. */
export const POLICY_TIMEOUT_MS = 10_000;

/** The `/jev` problem shown when another extension holds the executor's launch policy slot. */
export const SLOT_TAKEN = "launch policy held by another extension";

export type WorkerDeps = {
  /** The in-memory cut-point window; default empty (seed cut points). */
  window?: () => readonly WindowEntry[];
  ask?: typeof askJev;
  append?: (entry: unknown) => void;
  snapshot?: () => Snapshot;
  now?: () => number;
  /** The captured main-session executor service; default `mainService`. */
  service?: () => VendoredService | undefined;
};

export type WorkerRouting = {
  /** Main `session_start`: unregister any earlier policy, then register one for this session. */
  start(ctx: MainContext): void;
  /** Unregister the policy; the book keeps what it holds. */
  stop(): void;
  /** Unregister, unsubscribe and forget every held launch. */
  off(): void;
  clearWarnings(): void;
  /** Launches still waiting for their outcome. */
  pending(): number;
  /** Problems `/jev` reports for routing, such as a launch policy slot held elsewhere. */
  problems(): readonly string[];
};

/** The shared context; dependency defaults resolved once, called detached. */
function workerHost(
  pi: ExtensionAPI,
  deps: WorkerDeps,
  main: () => MainContext | undefined,
): WorkerHost {
  const apiKey = (keyVar: string): string => process.env[keyVar] ?? "";
  const ask = deps.ask ?? askJev;
  return {
    book: new LaunchBook<Decided>(),
    warnings: new LaunchWarnings(() => join(jevDir(), "config.json")),
    classify: { ask, window: deps.window ?? ((): readonly WindowEntry[] => []), apiKey },
    assess: { ask, pi, apiKey },
    snapshot: deps.snapshot ?? (() => loadSnapshot(pi)),
    append: deps.append ?? ((entry: unknown): void => void appendLedger(jevDir(), entry)),
    now: deps.now ?? Date.now,
    main,
  };
}

/** Subscribes one executor event; a missing event bus leaves the ledger without lines. */
function subscribe(pi: ExtensionAPI, name: string, handle: (data: unknown) => void): () => void {
  try {
    return pi.events.on(name, (data: unknown) => {
      try {
        handle(data);
      } catch {
        /* fail open */
      }
    });
  } catch {
    return () => {};
  }
}

function subscribeExecutor(pi: ExtensionAPI, host: WorkerHost): (() => void)[] {
  return [
    subscribe(pi, SESSION_CREATED, (d) => onSessionCreated(host, d)),
    subscribe(pi, BOUND, (d) => onBound(host, d)),
    ...OUTCOME_EVENTS.map((name) => subscribe(pi, name, (d) => onOutcome(host, d))),
  ];
}

function quietly(step: () => void): void {
  try {
    step();
  } catch {
    /* keep shutdown clean */
  }
}

/** The one policy registration of this extension instance, and whether the slot was taken. */
class Registration {
  #unregister: (() => void) | undefined;
  #taken = false;

  register(service: VendoredService | undefined, host: WorkerHost): void {
    this.unregister();
    this.#taken = false;
    if (service === undefined || typeof service.registerLaunchPolicy !== "function") return;
    try {
      this.#unregister = service.registerLaunchPolicy(createWorkerPolicy(host), {
        timeoutMs: POLICY_TIMEOUT_MS,
      });
    } catch {
      this.#taken = true;
    }
  }

  unregister(): void {
    const off = this.#unregister;
    this.#unregister = undefined;
    if (off !== undefined) quietly(off);
  }

  taken(): boolean {
    return this.#taken;
  }
}

/**
 * Worker routing: the main session's executor launch policy routes each worker and assesses its
 * tools, and one `worker` ledger line is written per decided launch when its outcome arrives.
 */
export function registerWorkerRouting(pi: ExtensionAPI, deps: WorkerDeps = {}): WorkerRouting {
  let main: MainContext | undefined;
  const host = workerHost(pi, deps, () => main);
  const service = deps.service ?? mainService;
  const registration = new Registration();
  const offs = subscribeExecutor(pi, host);
  return {
    start(ctx) {
      main = ctx;
      registration.register(service(), host);
    },
    stop: () => registration.unregister(),
    off() {
      host.book.stop();
      registration.unregister();
      for (const off of offs.splice(0)) quietly(off);
      host.book.clear();
    },
    clearWarnings: () => host.warnings.clear(),
    pending: () => host.book.pending(),
    problems: () => (registration.taken() ? [SLOT_TAKEN] : []),
  };
}
