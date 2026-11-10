/**
 * thinking-level.ts — The thinking-level vocabulary both spawn doors validate against.
 *
 * Pi accepts `off` alongside pi-ai's `ThinkingLevel`, but does not export the
 * combined list: `THINKING_LEVEL_OPTIONS` lives in `@earendil-works/pi-coding-agent`'s
 * internals and is absent from its public entry, so this package carries its own.
 *
 * An unrecognized level is not ignored by the SDK — `clampThinkingLevel` misses it in
 * the ordered table and falls to the first supported level, which is always `off`. A
 * typo therefore disables thinking entirely, which is why both doors reject rather
 * than pass the value through (Refs #834).
 */
/**
 * Every level Pi accepts, in ascending order of effort.
 *
 * The `satisfies` clause rejects an entry the installed SDK does not declare, and the
 * parity tests in `test/config/thinking-level.test.ts` check both directions at runtime.
 * One drift escapes them: a level the SDK adds *and* gates behind a `thinkingLevelMap`
 * key, the way `xhigh` and `max` are gated, is invisible until a caller names it.
 */
declare const THINKING_LEVELS: readonly ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/** A thinking level as an agent file or a spawn caller may spell it. */
type SubagentThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * types.ts — Type definitions for the subagent system.
 */

/** Agent type: any string name (built-in defaults or user-defined). */
type SubagentType = string;

/**
 * turn-limits.ts — The turn-budget policy for subagent execution.
 *
 * Owns the budget's shape, the limit normalization the subagent tool's
 * spawn-config resolution shares, and the tracker that decides, turn by turn,
 * when the turn loop in SubagentSession warns the child or stops it. The
 * decisions live here, apart from the session, so the policy is testable
 * without one.
 */
/** What the harness has done about a run's turn limit, in the order it happens. */
type TurnBudgetPhase = "within" | "warned" | "exhausted";
/**
 * A run's turn limit and its use. Present only when a limit exists.
 *
 * `phase` is recorded rather than derived from the counts: whether the harness
 * warned or stopped the run is an event, and an agent that answered on its last
 * permitted turn has the same counts as one the harness cut off.
 */
interface TurnBudget {
    /** The ceiling; absent for an unlimited run. */
    maxTurns?: number;
    /** Successful turns completed in this run. */
    used: number;
    phase: TurnBudgetPhase;
}

/** usage.ts — Token usage: shapes, accumulator operators, session-stats readers. */
/**
 * Lifetime usage components, accumulated via `message_end` events. Survives
 * compaction (which replaces session.state.messages and would reset any
 * stats-derived sum). cacheRead is excluded because each turn's cacheRead is
 * the cumulative cached prefix re-read on that one call — summing across
 * turns counts the prefix N times. See issue #38.
 */
type LifetimeUsage = {
    input: number;
    output: number;
    cacheWrite: number;
};

/**
 * subagent-state.ts — SubagentState value object: metrics and live activity, and the status vocabulary.
 *
 * Owns the passive, readable state of a subagent that spans its runs — stats
 * (toolUses, lifetimeUsage, compactionCount), live-activity fields
 * (activeTools, responseText, lastProgressAt) — together with the accumulation
 * methods (incrementToolUses, addUsage, incrementCompactions) and live-activity
 * transition methods (addActiveTool, removeActiveTool, resetResponseText,
 * appendResponseText, markProgress) that mutate them. A run's outcome lives on
 * its SubagentRun.
 *
 * State is encapsulated behind getters; external code reads through them but
 * mutates only via the transition/accumulation methods. The value object owns
 * all of its own mutations — no field is written from outside.
 *
 * Subagent holds one of these privately and delegates its getters and mutation
 * methods to it. Extracting it lets the lifecycle state machine and the
 * session-event observer be unit-tested without constructing an executor.
 */

type SubagentStatus = "queued" | "running" | "completed" | "aborted" | "stopped" | "error";

/**
 * workspace.ts — The single generative extension seam (ADR 0002, Phase 16 Step 2).
 *
 * "Where does a child run, and what brackets the run?" is a strategy (git
 * worktree, container, tmpdir, remote sandbox), not core behavior. The core
 * needs only a working directory plus a disposal hook; the default — the
 * parent's cwd, with no setup/teardown — is always correct.
 *
 * Unlike the observational lifecycle events in child-lifecycle.ts, this is a
 * *generative* seam: a registered provider returns a value the core consumes
 * synchronously at run-start. The core has no knowledge of git or worktrees.
 */

/** Context the core hands a provider when a child run starts. */
interface WorkspacePrepareContext {
    agentId: string;
    agentType: SubagentType;
    baseCwd: string;
}
/** Outcome the core reports to a workspace when the run ends. */
interface WorkspaceDisposeOutcome {
    status: SubagentStatus;
    description: string;
}
/** What dispose may hand back for the core to fold into the child result. */
interface WorkspaceDisposeResult {
    /** Appended verbatim to the child's result text — the provider owns the wording. */
    resultAddendum?: string;
}
/** A prepared working directory plus its bracketed teardown. Born complete. */
interface Workspace {
    /** The working directory — already exists when the workspace is handed back. */
    readonly cwd: string;
    dispose(outcome: WorkspaceDisposeOutcome): WorkspaceDisposeResult | undefined;
}
/** The single generative seam: supplies a child's workspace. */
interface WorkspaceProvider {
    prepare(ctx: WorkspacePrepareContext): Promise<Workspace | undefined>;
}

/**
 * subagent.ts — Subagent class: identity, lifecycle status, and per-subagent behavior.
 *
 * Status/stats are delegated to the SubagentState value object; each run's abort
 * lever and listener handles to a SubagentRun; workspace prepare/dispose to
 * WorkspaceBracket.
 * Behavior (abort, steer buffering) lives here rather than on SubagentManager.
 */

/**
 * Why a resume of an agent would be refused.
 *
 * One vocabulary for a fact three record-level conditions used to answer
 * separately: the resume door decided it from `isSessionReady()`,
 * `sessionReleased`, and `workspaceDisposed`, while the result carriers never
 * consulted any of them and advertised the resume regardless.
 *
 * `still-running` and `resume-queued` are the transient members: each is a
 * refusal of *now* rather than of ever, clearing when the run in question
 * settles, and the carriers word them accordingly. `resume-queued` names a
 * resume waiting for a concurrency slot, which has not started running.
 */
type ResumeRefusal = "still-running" | "resume-queued" | "no-session" | "session-released" | "workspace-disposed";

/**
 * subagent-manager.ts - Tracks subagents, background execution, resume support.
 *
 * Background runs, spawned or resumed, are subject to a configurable concurrency
 * limit (default: 4). Excess runs are scheduled on a ConcurrencyLimiter and
 * auto-started as running ones complete. Foreground runs bypass the limiter
 * (they block the parent anyway).
 */

/**
 * Why a resume was refused, across every front door.
 *
 * Widens the record's own vocabulary by the one refusal that is not a fact
 * about a record: an id no record answers to.
 */
type ResumeRefusalReason = ResumeRefusal | "unknown-agent";

/**
 * service.ts — Public API surface for cross-extension access to subagents.
 *
 * Consumers declare this package as an optional peer dependency and use
 * dynamic import to access the accessor functions:
 *
 *   const { getSubagentsService } = await import("@gotgenes/pi-subagents");
 *   const svc = getSubagentsService();
 *   svc?.spawn("Explore", "Check for stale TODOs");
 */

/**
 * Serializable by-value snapshot of an agent's state.
 *
 * Produced by this package and read by consumers — not a contract third
 * parties implement, so a new field is a minor release. What earns a field a
 * place here (and what the snapshot deliberately withholds) is decided in
 * `docs/decisions/0005-subagent-record-admission-policy.md`.
 */
interface SubagentRecord {
    id: string;
    type: string;
    description: string;
    status: SubagentStatus;
    /**
     * Whether the agent's current run is in the background: the run in flight, or
     * the last one to end, and the spawn's mode before the first run starts. A
     * resume chooses its own mode, so this can change after one.
     */
    isBackground: boolean;
    result?: string;
    /** The question the agent ended its turn with, when it declared one. */
    pendingQuestion?: string;
    error?: string;
    toolUses: number;
    /**
     * The current run's turn budget: successful turns used, the ceiling (absent
     * when unlimited), and whether the harness has warned or stopped the run.
     * Live while the run is going; absent until its turn loop starts.
     */
    turnBudget?: TurnBudget;
    startedAt: number;
    completedAt?: number;
    lifetimeUsage: LifetimeUsage;
    compactionCount: number;
    /** Path to the agent's session JSONL, once the session exists. */
    outputFile?: string;
    /**
     * Why `resume()` would refuse this agent at snapshot time; absent when it
     * would start a run. `still-running` clears when the run settles,
     * `resume-queued` (a resume waiting for a concurrency slot) clears when that
     * resumed run settles, and a queued agent's `no-session` clears once it
     * starts; the other reasons are final.
     */
    resumeRefusal?: ResumeRefusal;
    /** The model the session was created with, as `provider/id`; absent until it exists. */
    effectiveModel?: string;
    /** The thinking level the session was created with; absent until it exists. */
    effectiveThinking?: SubagentThinkingLevel;
}
/** Options for resuming an agent via the service. */
interface ResumeOptions {
    /**
     * Declare that the caller will deliver the resumed outcome to the parent,
     * suppressing the completion nudge for it. Omitted, the resumed outcome is
     * announced exactly as a background completion is.
     */
    claimOutcome?: boolean;
    /**
     * Cancels the resumed turn loop. It is wired through the record's own lever,
     * so it ends the resume exactly as `abort(id)` does — the record reads
     * `stopped`, and either cancel reaches the same run. A signal that has already
     * fired stops the resume before its first turn.
     */
    signal?: AbortSignal;
}
/**
 * What a resume attempt produced.
 *
 * A resumed run that *failed* is still `resumed` — the snapshot carries
 * `status: "error"` and the message. `refused` means no turn loop ran.
 */
type ResumeResult = {
    kind: "resumed";
    record: SubagentRecord;
} | {
    kind: "refused";
    reason: ResumeRefusalReason;
};
/** Options for spawning an agent via the service. */
interface SpawnOptions {
    description?: string;
    model?: string;
    /**
     * Turn ceiling for the run. A value below 2 runs with 2: the result is the
     * child's final response, so it needs one turn to work and one to answer.
     * Omit for the agent's own limit, then the operator's default; 0 means unlimited.
     */
    maxTurns?: number;
    thinkingLevel?: string;
    inheritContext?: boolean;
    foreground?: boolean;
    bypassQueue?: boolean;
}
/** The public service contract for cross-extension subagent access. */
interface SubagentsService {
    /** Which package published this service. */
    readonly implementation: "@ttdua/pi-subagents";
    /** The id of the session whose extension instance published this service. */
    readonly sessionId: string;
    /** Spawn an agent. Returns the agent ID immediately. */
    spawn(type: string, prompt: string, options?: SpawnOptions): string;
    /** Get a snapshot of an agent's current state. */
    getRecord(id: string): SubagentRecord | undefined;
    /** List all tracked agents, most recent first. */
    listAgents(): SubagentRecord[];
    /** Abort a running or queued agent. Returns false if not found. */
    abort(id: string): boolean;
    /** Send a steering message to a running agent. */
    steer(id: string, message: string): Promise<boolean>;
    /**
     * Resume a settled agent with a new prompt, continuing its session.
     *
     * The resume runs in the background, so like a background spawn it waits for
     * a concurrency slot when `maxConcurrent` background runs are live, reading
     * `queued` until one frees.
     *
     * Resolves when the resumed run reaches a terminal state, carrying the
     * terminal snapshot — a caller that does not need the outcome can ignore the
     * promise. A refusal resolves promptly instead: the checks are synchronous
     * and no turn loop is started. A record's `resumeRefusal` answers the same
     * question before the call.
     */
    resume(id: string, prompt: string, options?: ResumeOptions): Promise<ResumeResult>;
    /** Wait for all running and queued agents to complete. */
    waitForAll(): Promise<void>;
    /** Whether any agents are running or queued. */
    hasRunning(): boolean;
    /**
     * Register the single workspace provider that supplies a child's working
     * directory plus bracketed setup/teardown. Throws if one is already
     * registered. Returns a disposer that unregisters the provider.
     */
    registerWorkspaceProvider(provider: WorkspaceProvider): () => void;
}
/** Event channel constants for pi.events subscriptions. */
declare const SUBAGENT_EVENTS: {
    readonly STARTED: "subagents:started";
    readonly COMPLETED: "subagents:completed";
    readonly FAILED: "subagents:failed";
    readonly RESUMING: "subagents:resuming";
    readonly RESUMED: "subagents:resumed";
    readonly COMPACTED: "subagents:compacted";
    readonly CREATED: "subagents:created";
    readonly STEERED: "subagents:steered";
};
/** Publish the SubagentsService on globalThis for cross-extension access. */
declare function publishSubagentsService(service: SubagentsService): void;
/** Retrieve the published SubagentsService, or undefined if not yet published. */
declare function getSubagentsService(): SubagentsService | undefined;
/** Remove the SubagentsService from globalThis (call on shutdown/reload). */
declare function unpublishSubagentsService(): void;

export { SUBAGENT_EVENTS, getSubagentsService, publishSubagentsService, unpublishSubagentsService };
export type { LifetimeUsage, ResumeOptions, ResumeRefusal, ResumeRefusalReason, ResumeResult, SpawnOptions, SubagentRecord, SubagentStatus, SubagentsService, TurnBudget, TurnBudgetPhase, Workspace, WorkspaceDisposeOutcome, WorkspaceDisposeResult, WorkspacePrepareContext, WorkspaceProvider };
