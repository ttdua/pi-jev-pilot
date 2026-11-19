/**
 * service-adapter.ts — Adapter that wraps SubagentManager to satisfy SubagentsService.
 *
 * Handles model resolution at the API boundary, record serialization
 * (stripping non-serializable fields), and session gating.
 */

import type { Model } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { type DeprecationWarnings, defaultDeprecationWarnings } from "#src/config/deprecations";
import { resolveContext } from "#src/config/invocation-config";
import { parseThinkingLevel, thinkingLevelError } from "#src/config/thinking-level";
import { lookupChildSession } from "#src/seams/child-sessions";
import { parseLaunchMetadata } from "#src/seams/launch-metadata";
import { defaultLaunchResourcesIO, parseLaunchResources } from "#src/seams/launch-resources";
import { parseResultSchema } from "#src/seams/result-schema";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { AgentSpawnConfig, ResumeCallOptions, ResumeOutcome } from "#src/lifecycle/subagent-manager";
import type { WorkspaceProvider } from "#src/lifecycle/workspace";
import type { AgentTypeCatalog } from "#src/seams/registry";
import type {
  AgentTypeSnapshot,
  ChildSessionInfo,
  LaunchPolicy,
  ResumeOptions,
  ResumeResult,
  SpawnOptions,
  SubagentRecord,
  SubagentsService,
  WaitOptions,
} from "#src/service/service";
import type { RunOutcome } from "#src/lifecycle/subagent-run";
import type { ModelRegistry } from "#src/session/model-resolver";
import type { ContextMode, SessionContext, Subagent, ThinkingLevel } from "#src/types";

/** Narrow interface for the SubagentManager — avoids coupling to the concrete class. */
export interface SubagentManagerLike {
  spawn(snapshot: ParentSnapshot, type: string, prompt: string, options: AgentSpawnConfig): string;
  getRecord(id: string): Subagent | undefined;
  listAgents(): Subagent[];
  abort(id: string): boolean;
  waitForAll(): Promise<void>;
  hasRunning(): boolean;
  registerWorkspaceProvider(provider: WorkspaceProvider): () => void;
  registerLaunchPolicy(policy: LaunchPolicy, options: { timeoutMs: number }): () => void;
  resume(id: string, prompt: string, options: ResumeCallOptions): Promise<ResumeOutcome>;
}

/**
 * Narrow runtime interface consumed by the service adapter.
 * `SubagentRuntime` satisfies this structurally; tests use plain stubs.
 */
export interface ServiceRuntimeLike {
  readonly currentCtx: SessionContext | undefined;
  buildSnapshot(context: ContextMode): ParentSnapshot;
  /** Parent session identity, so an SDK-spawned child nests under its parent. */
  getSessionInfo(): { parentSessionFile: string; parentSessionId: string };
}

/**
 * The context a `spawn` call itself asks for: `context` wins over the deprecated
 * `inheritContext`. An unknown `context` throws.
 */
function callerContext(options: SpawnOptions | undefined, warnings: DeprecationWarnings): ContextMode | undefined {
  const context: unknown = options?.context;
  // DEPRECATED(remove next minor): SpawnOptions.inheritContext alias
  if (options?.inheritContext !== undefined) {
    warnings.warnOnce("inheritContext", 'SpawnOptions.inheritContext is deprecated; use context: "fork" | "fresh"');
  }
  if (context === undefined) {
    if (options?.inheritContext === undefined) return undefined;
    return options.inheritContext ? "fork" : "fresh";
  }
  if (context === "fresh" || context === "fork") return context;
  throw new Error(`Invalid context "${String(context)}": expected "fresh" or "fork".`);
}

/** Adapter that wraps SubagentManager to satisfy SubagentsService. */
export class SubagentsServiceAdapter implements SubagentsService {
  readonly implementation = "@ttdua/pi-subagents" as const;

  constructor(
    private readonly manager: SubagentManagerLike,
    private readonly resolveModel: (input: string, registry: ModelRegistry) => Model<any> | string,
    private readonly runtime: ServiceRuntimeLike,
    private readonly agentTypes: Pick<AgentTypeCatalog, "list" | "get">,
    private readonly warnings: DeprecationWarnings = defaultDeprecationWarnings,
  ) {}

  private session = "";

  /** The session this instance first started in; `""` before `session_start`. */
  get sessionId(): string {
    return this.session;
  }

  /** Record the instance's session at its first `session_start`; later starts keep it. */
  bindSession(sessionId: string): void {
    if (this.session === "") this.session = sessionId;
  }

  spawn(type: string, prompt: string, options?: SpawnOptions): string {
    // First: a refusal throws before anything is read, built or created.
    const metadata = parseLaunchMetadata(options?.metadata);
    const resources = parseLaunchResources(options ?? {}, defaultLaunchResourcesIO(getAgentDir()));
    const resultSchema = parseResultSchema(options?.resultSchema);
    if (!this.runtime.currentCtx) {
      throw new Error("No active session — cannot spawn agents outside a session.");
    }

    const model = this.resolveModelOption(options?.model);
    const description = options?.description ?? prompt.slice(0, 80);

    const { context, contextSource } = resolveContext(
      this.agentTypes.get(type) ?? {},
      callerContext(options, this.warnings),
    );
    if (resultSchema && context === "fork") {
      throw new Error(
        'resultSchema cannot be used with context "fork": a forked child inherits the parent\'s conversation, so the submit_result protocol cannot be set up.',
      );
    }
    const snapshot = this.runtime.buildSnapshot(context);
    const { parentSessionFile, parentSessionId } = this.runtime.getSessionInfo();
    return this.manager.spawn(snapshot, type, prompt, {
      description,
      model,
      // No toolCallId — an SDK spawn has no originating tool call, and
      // Subagent.toolCallId reporting undefined there is the truth.
      parentSession: { parentSessionFile, parentSessionId },
      origin: { kind: "service" },
      metadata,
      resources,
      resultSchema,
      maxTurns: options?.maxTurns,
      thinkingLevel: this.resolveThinkingLevel(options?.thinkingLevel),
      context,
      contextSource,
      bypassQueue: options?.bypassQueue,
      // A caller that names `foreground` has committed; one that omits it has
      // not, so the agent's own frontmatter decides and background is the
      // SDK-door default.
      background:
        options?.foreground === undefined
          ? { kind: "default", isBackground: true }
          : { kind: "explicit", isBackground: !options.foreground },
    });
  }

  childSession(sessionId: string): ChildSessionInfo | undefined {
    return lookupChildSession(sessionId);
  }

  getRecord(id: string): SubagentRecord | undefined {
    const record = this.manager.getRecord(id);
    return record ? toSubagentRecord(record) : undefined;
  }

  listAgents(): SubagentRecord[] {
    return this.manager.listAgents().map(toSubagentRecord);
  }

  abort(id: string): boolean {
    return this.manager.abort(id);
  }

  async steer(id: string, message: string): Promise<boolean> {
    const record = this.manager.getRecord(id);
    if (!record) {
      return false;
    }
    const outcome = await record.steer(message);
    return outcome.kind !== "rejected";
  }

  async resume(id: string, prompt: string, options?: ResumeOptions): Promise<ResumeResult> {
    const outcome = await this.manager.resume(id, prompt, {
      // Nothing in the parent's turn waits on a service resume, so it runs in
      // the background, as a service spawn does by default.
      background: true,
      claimOutcome: options?.claimOutcome,
      signal: options?.signal,
    });
    // A refusal is the same value on both sides; only the resumed arm crosses
    // the by-value boundary the snapshot draws.
    return outcome.kind === "refused"
      ? outcome
      : { kind: "resumed", record: toSubagentRecord(outcome.record) };
  }

  listAgentTypes(): readonly AgentTypeSnapshot[] {
    return this.agentTypes.list();
  }

  getAgentType(name: string): AgentTypeSnapshot | undefined {
    return this.agentTypes.get(name);
  }

  wait(id: string, options?: WaitOptions): Promise<SubagentRecord> {
    const record = this.manager.getRecord(id);
    if (!record) return Promise.reject(new Error(`Unknown agent "${id}"`));
    return this.waitForRun(record, options?.signal ?? NEVER_ABORTS);
  }

  /**
   * Hold the record's current run as a carrier: claim it so nothing announces
   * it, wait for it to end, then collect it. Any exit other than a settled
   * outcome releases the claim.
   */
  private async waitForRun(record: Subagent, signal: AbortSignal): Promise<SubagentRecord> {
    // A settled run wins over an aborted signal, as in get_subagent_result.
    if (!record.latestRun.isActive()) {
      record.latestRun.markConsumed();
      return toWaitedRecord(record, record.latestRun);
    }
    const claim = record.claim();
    let settled = false;
    try {
      const run = await record.waitForRunEnd(signal);
      if (!run.isActive()) {
        settled = true;
        run.markConsumed();
        return toWaitedRecord(record, run);
      }
      throw signal.reason;
    } finally {
      // A settled run is over; a resume starts a new, unclaimed run.
      if (!settled) claim.release();
    }
  }

  async waitForAll(): Promise<void> {
    return this.manager.waitForAll();
  }

  hasRunning(): boolean {
    return this.manager.hasRunning();
  }

  registerWorkspaceProvider(provider: WorkspaceProvider): () => void {
    return this.manager.registerWorkspaceProvider(provider);
  }

  registerLaunchPolicy(policy: LaunchPolicy, options: { timeoutMs: number }): () => void {
    return this.manager.registerLaunchPolicy(policy, options);
  }

  /**
   * Narrow an optional thinking-level override, rejecting one the SDK does not know.
   *
   * `SpawnOptions` widens the field to `string` for the public surface, and Pi clamps an
   * unrecognized level down to `off` rather than reporting it — so a typo would silently
   * disable thinking in the child. Throwing matches the adapter's other input failures.
   */
  private resolveThinkingLevel(input: string | undefined): ThinkingLevel | undefined {
    if (input == null) return undefined;
    const level = parseThinkingLevel(input);
    if (level === undefined) throw new Error(thinkingLevelError(input));
    return level;
  }

  /** Resolve an optional model-string override against the current session's registry. */
  private resolveModelOption(modelInput: string | undefined): Model<any> | undefined {
    if (!modelInput) return undefined;
    const registry = this.runtime.currentCtx?.modelRegistry;
    if (!registry) {
      throw new Error("No model registry available.");
    }
    const resolved = this.resolveModel(modelInput, registry);
    if (typeof resolved === "string") {
      throw new Error(resolved);
    }
    return resolved;
  }
}

/** The signal of a wait that was given none: it never fires. */
const NEVER_ABORTS = new AbortController().signal;

/**
 * The snapshot of one run: `toSubagentRecord` with the per-run fields taken
 * from `run`, which a resume may have replaced since. `pendingQuestion` is the
 * question the run itself ended with (`run.question`).
 */
export function toWaitedRecord(record: Subagent, run: RunOutcome): SubagentRecord {
  const out = toSubagentRecord(record);
  out.status = run.status;
  out.startedAt = run.startedAt;
  setOrOmit(out, "result", run.result);
  setOrOmit(out, "error", run.error);
  setOrOmit(out, "completedAt", run.completedAt);
  setOrOmit(out, "turnBudget", run.turnBudget && { ...run.turnBudget });
  setOrOmit(out, "pendingQuestion", run.question);
  return out;
}

function setOrOmit<K extends keyof SubagentRecord>(out: SubagentRecord, key: K, value: SubagentRecord[K] | undefined): void {
  if (value === undefined) delete out[key];
  else out[key] = value;
}

/**
 * Convert an internal Subagent to a serializable SubagentRecord.
 *
 * The allowlist is explicit because the snapshot admits only discrete facts —
 * identity, resolved spawn decisions, cumulative metrics, and pointers to
 * durable artifacts. Live objects, momentary activity, and package-internal
 * bookkeeping stay out; see
 * `docs/decisions/0005-subagent-record-admission-policy.md`.
 */
export function toSubagentRecord(record: Subagent): SubagentRecord {
  const out: SubagentRecord = {
    id: record.id,
    type: record.type,
    description: record.description,
    status: record.status,
    isBackground: record.isBackground,
    toolUses: record.toolUses,
    startedAt: record.startedAt,
    // Copy: the agent accumulates into its own object on every message_end, so
    // an aliased snapshot would drift, and a consumer could write into the
    // agent's totals.
    lifetimeUsage: { ...record.lifetimeUsage },
    compactionCount: record.compactionCount,
    context: record.context,
  };

  if (record.metadata !== undefined) out.metadata = record.metadata;
  if (record.result !== undefined) out.result = record.result;
  if (record.structuredResult !== undefined) out.structuredResult = record.structuredResult;
  if (record.structuredResultError !== undefined) out.structuredResultError = record.structuredResultError;
  if (record.pendingQuestion !== undefined) out.pendingQuestion = record.pendingQuestion;
  if (record.error !== undefined) out.error = record.error;
  if (record.completedAt !== undefined) out.completedAt = record.completedAt;
  // Copy, like lifetimeUsage: the snapshot is by value.
  if (record.turnBudget !== undefined) out.turnBudget = { ...record.turnBudget };
  if (record.outputFile !== undefined) out.outputFile = record.outputFile;
  if (record.resumeRefusal !== undefined) out.resumeRefusal = record.resumeRefusal;
  if (record.contextFallback !== undefined) out.contextFallback = record.contextFallback;
  const { effectiveModel, effectiveThinking } = record.effective;
  if (effectiveModel !== undefined) out.effectiveModel = effectiveModel;
  if (effectiveThinking !== undefined) out.effectiveThinking = effectiveThinking;
  if (record.toolFacts !== undefined) {
    out.toolCount = record.toolFacts.toolCount;
    out.blockedToolCount = record.toolFacts.blockedToolCount;
  }

  return out;
}
