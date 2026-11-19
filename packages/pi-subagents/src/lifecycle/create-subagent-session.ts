/**
 * create-subagent-session.ts — Assembly factory for born-complete child sessions (issue #265).
 *
 * `createSubagentSession()` does the assembly portion that the old runner's
 * `runAgent()` did up front: detect the environment, assemble the session config,
 * create the SDK session (with the recursion guard as a tool denylist), publish
 * `spawning`/`session-created`, and bind extensions. It returns a fully usable
 * `SubagentSession` — `Subagent` then only coordinates (turn loop, steer, dispose).
 *
 * The factory takes a resolved `cwd` value, never the WorkspaceProvider: `cwd`
 * is a value the factory consumes directly (detectEnv, assembleSessionConfig,
 * createSession), so threading the provider through here would be a relay smell.
 */

import type { Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  type InlineExtension,
  type SessionEntry,
  type SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfigLookup } from "#src/config/agent-types";
import { debugLog, debugNote } from "#src/debug";
import type { ChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { missingToolStubs, type RealToolLookup } from "#src/lifecycle/fork-stubs";
import type { ParentSnapshot, ToolDeclaration } from "#src/lifecycle/parent-snapshot";
import { buildForkSession } from "#src/lifecycle/fork-session";
import { forkCallableTools, forkGuardExtension, type ForkGuardState, ORCHESTRATION_TOOLS } from "#src/lifecycle/fork-guard";
import { enforceForkGrants, enforceGrants, isModelCallable } from "#src/seams/grant-check";
import { applyLocks, type LaunchValues } from "#src/seams/locked-launch";
import { type EffectiveFacts, effectiveFacts, launchIdentity, type ToolFacts } from "#src/seams/identity";
import type { LaunchMetadata } from "#src/service/service";
import { blockedToolCount, finalToolNames } from "#src/seams/registry";
import { SubagentSession } from "#src/lifecycle/subagent-session";
import { resolveTurnLimits, type TurnLimitRequest } from "#src/lifecycle/turn-limits";
import { AskParentTool, type QuestionRecorder } from "#src/session/ask-parent-tool";
import { builtinExtensionsFor } from "#src/session/builtin-extensions";
import type { EnvInfo } from "#src/session/env";
import { expandMcpToolPatterns } from "#src/session/mcp-tool-patterns";
import { type ModelRegistry, resolveForkThinking } from "#src/session/model-resolver";
import { NotifyParentTool, type UpdateAnnouncer } from "#src/session/notify-parent-tool";
import { freshPromptExtension } from "#src/session/fresh-prompt-extension";
import { composeAgentSection } from "#src/session/prompts";
import { type AssemblerIO, assembleSessionConfig, type SessionConfig } from "#src/session/session-config";
import type {
  ContextMode,
  ParentSessionInfo,
  ShellExec,
  SubagentType,
  ThinkingLevel,
} from "#src/types";

/**
 * Recursion guard: names of tools registered by this extension that subagents
 * must NOT inherit. Passed to the SDK as a denylist, which it applies whenever
 * it rebuilds the child's tool registry — including the rebuild triggered by a
 * child extension registering a tool of its own. Filtering the active set once
 * after `bindExtensions` would be undone by that rebuild (#725).
 */
const EXCLUDED_TOOL_NAMES = [...ORCHESTRATION_TOOLS];

// ── IO boundary ───────────────────────────────────────────────────────────────

/** Minimal resource-loader contract used by the factory. */
export interface ResourceLoaderLike {
  reload(): Promise<void>;
  /** The extensions the loader loaded; read by a fork to see which tools it can build. */
  getExtensions?(): { extensions: readonly { tools: ReadonlyMap<string, unknown> }[] };
}

/** Minimal session-manager contract used by the factory. */
export interface SessionManagerLike {
  newSession(opts: { parentSession?: string }): void;
  getSessionFile(): string | undefined;
  getSessionId(): string;
}

/** Options passed to EnvironmentIO/SessionFactoryIO methods. */
export interface ResourceLoaderOptions {
  cwd: string;
  agentDir: string;
  /** Settings the loader resolves packages from; defaults to the ambient ones when absent. */
  settingsManager?: SettingsManager;
  noPromptTemplates?: boolean;
  noThemes?: boolean;
  noContextFiles?: boolean;
  systemPromptOverride?: (base: string | undefined) => string;
  /** Override the append system prompt. Receives the current base value; return the replacement. */
  appendSystemPromptOverride?: (base: string[]) => string[];
  /** Extensions supplied as code; `builtin` entries are Pi's built-ins, resolved as `builtin:<name>`. */
  extensionFactories?: InlineExtension[];
}

/** Options passed to SessionFactoryIO.createSession. */
export interface CreateSessionOptions {
  cwd: string;
  agentDir: string;
  sessionManager: SessionManagerLike;
  settingsManager: SettingsManager;
  modelRegistry: ModelRegistry;
  model?: Model<any>;
  /** Allowlist: only these tool names are enabled in the session. */
  tools: string[];
  /**
   * Tool definitions supplied directly rather than by an extension. The SDK
   * filters these through `tools` too, so every name here must also be listed
   * there or the definition is silently dropped.
   */
  customTools?: ToolDefinition[];
  /** Denylist applied after `tools`, on every tool-registry rebuild. */
  excludeTools?: string[];
  resourceLoader: ResourceLoaderLike;
  thinkingLevel?: ThinkingLevel;
}

/**
 * Environment discovery - detect runtime context and resolve directories.
 *
 * Decouples the factory from direct process/SDK reads so each can be stubbed
 * independently in tests.
 */
export interface EnvironmentIO {
  detectEnv: (exec: ShellExec, cwd: string) => Promise<EnvInfo>;
  getAgentDir: () => string;
  deriveSessionDir: (parentSessionFile: string | undefined, effectiveCwd: string) => string;
}

/**
 * Session factory - create SDK objects for a child agent session.
 *
 * Decouples the factory from direct Pi SDK imports and sibling-module IO,
 * making it testable via plain stub objects without vi.mock().
 */
export interface SessionFactoryIO {
  createResourceLoader: (opts: ResourceLoaderOptions) => ResourceLoaderLike;
  createSessionManager: (cwd: string, sessionDir: string) => SessionManagerLike;
  /**
   * Create a fork's session manager: its own id, holding a copy of the
   * parent's branch entries.
   */
  createForkSessionManager: (
    cwd: string,
    sessionDir: string,
    parentSession: string | undefined,
    entries: readonly SessionEntry[],
  ) => SessionManagerLike;
  /** Delete a session file; used to drop a fork's transcript when its launch fails. */
  removeSessionFile: (file: string) => void;
  createSettingsManager: (cwd: string, agentDir: string) => SettingsManager;
  /**
   * Settings view the child's resource loader resolves packages from.
   * The composition root decides whether any package extensions are excluded;
   * the identity function reproduces the child's default full inheritance.
   */
  createLoaderSettingsManager: (parent: SettingsManager) => SettingsManager;
  createSession: (opts: CreateSessionOptions) => Promise<{ session: AgentSession }>;
  assemblerIO: AssemblerIO;
}

/**
 * IO boundary injected into createSubagentSession().
 *
 * Intersection of EnvironmentIO and SessionFactoryIO — callers satisfy both
 * sub-interfaces via TypeScript's structural typing.
 */
export type SubagentSessionIO = EnvironmentIO & SessionFactoryIO;

/**
 * Dependencies injected at construction time — the IO boundary plus the two
 * static domain deps (exec, registry) every creation needs.
 */
export interface SubagentSessionDeps {
  io: SubagentSessionIO;
  exec: ShellExec;
  registry: AgentConfigLookup;
  /** Publishes the child-execution lifecycle so consumers can observe it. */
  lifecycle: ChildLifecyclePublisher;
  /**
   * Names of the tools the parent session has registered, read when a child is
   * created. An agent's `mcp__<server>__*` tool patterns expand against them.
   */
  listParentToolNames: () => readonly string[];
}

/** Per-spawn parameters — the fields that vary per child session. */
export interface CreateSubagentSessionParams {
  /** The record id `spawn()` returned; names the launch on every child event. */
  agentId: string;
  snapshot: ParentSnapshot;
  type: SubagentType;
  /** Resolved workspace cwd; undefined → parent cwd. */
  cwd?: string;
  /** The launch's resolved context; undefined → `fresh`. */
  context?: ContextMode;
  /** The task: a fresh child's first prompt, and what a fork's instructions message ends with. */
  task?: string;
  /** Parent session identity (file path + session ID). */
  parentSession?: ParentSessionInfo;
  /** The launch's frozen metadata; carried on the child events. */
  metadata?: LaunchMetadata;
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
  /**
   * Records a question the child declares with `ask_parent`. Supplied for every
   * child; its absence installs no ask-back tool.
   */
  askParent?: QuestionRecorder;
  /**
   * Announces a mid-run update the child sends with `notify_parent`. Supplied
   * only for a background child whose operator left the channel on; its absence
   * installs no update tool.
   */
  notifyParent?: UpdateAnnouncer;
  /** The caller's turn-limit inputs, resolved with the agent's own limit into the session's. */
  turnLimits?: TurnLimitRequest;
  /**
   * Receives the model and thinking level the session was created with, before
   * `session-created` is emitted, so the record and the event carry one snapshot.
   */
  onEffectiveFacts?: (facts: EffectiveFacts) => void;
  /**
   * The launch policy's tool plan: base tool names replacing the agent's, and
   * the grants added to them, checked in the child after bind. Absent when no
   * policy adjusted the launch.
   */
  tools?: {
    toolNames: readonly string[];
    grants: readonly string[];
    removed: readonly string[];
  };
  /**
   * Receives the child's tool count and blocked tool count once its grants are
   * checked. Not called when either could not be read.
   */
  onToolFacts?: (facts: ToolFacts) => void;
}

/**
 * The core's own child-facing tools, built for whichever callbacks this run
 * supplied. An agent's `tools:` list is its complete capability allowlist, so
 * these are appended to it rather than drawn from it: they are protocol the
 * core installs in every child, and neither reaches the filesystem, the shell,
 * or the network. A fork gets none: they would change its declarations.
 */
function buildChildTools(params: CreateSubagentSessionParams): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  if (params.askParent) tools.push(new AskParentTool(params.askParent).toToolDefinition());
  if (params.notifyParent)
    tools.push(new NotifyParentTool(params.notifyParent).toToolDefinition());
  return tools;
}

/** The child's callable tool count and blocked tool count. */
function computeToolFacts(callable: readonly string[], parentToolNames: readonly string[]): ToolFacts {
  return {
    toolCount: callable.length,
    blockedToolCount: blockedToolCount({ parentToolNames, activeToolNames: callable }),
  };
}

/** Report the tool facts; a failure leaves them unknown and never affects the launch. */
function reportToolFacts(
  readCallable: () => readonly string[],
  parentToolNames: readonly string[],
  report: ((facts: ToolFacts) => void) | undefined,
): void {
  try {
    const facts = computeToolFacts(readCallable(), parentToolNames);
    report?.(facts);
  } catch (err) {
    debugLog("tool facts unavailable; launch unaffected", err);
  }
}

/** What one context contributes to the child session; built before the SDK objects. */
interface ContextSetup {
  /** Extra extension factories and loader prompt options. */
  loader: Pick<ResourceLoaderOptions, "noContextFiles" | "appendSystemPromptOverride" | "extensionFactories">;
  /** The tools the session declares. */
  tools: string[];
  /** The custom tool definitions among them, read once the loader has loaded. */
  customTools: (loader: ResourceLoaderLike) => ToolDefinition[];
  excludeTools: string[];
  /** The session manager, created once the session directory is known. */
  createSessionManager: (cwd: string, sessionDir: string) => SessionManagerLike;
  /** Replaces the first run's prompt; undefined sends the prompt as given. */
  firstMessage?: string;
  /** Check the grants after bind; returns the grants that took effect. */
  checkGrants: (session: AgentSession) => string[];
  /** The tools the child can call, read after the grant check. */
  callable: (session: AgentSession) => readonly string[];
  forkGuard?: ForkGuardState;
}

/** What both context setups read. */
interface SetupInput {
  params: CreateSubagentSessionParams;
  deps: SubagentSessionDeps;
  cfg: SessionConfig;
  /** The child's tools as the fresh pipeline gives them, before protocol tools. */
  baseTools: readonly string[];
  disallowed: readonly string[];
  grants: readonly string[];
}

/**
 * Fresh: Pi builds the child's own prompt (base, project context for the
 * child's cwd, append file); the agent header and body go in the last section.
 */
function freshSetup(input: SetupInput): ContextSetup {
  const { params, deps, cfg } = input;
  const protocolTools = buildChildTools(params);
  const toolNames = finalToolNames(
    [...input.baseTools, ...protocolTools.map((tool) => tool.name)],
    input.grants,
    input.disallowed,
  );
  const grants = input.grants.filter((name) => toolNames.includes(name));
  const agentBody = deps.registry.resolveAgentConfig(params.type).systemPrompt;
  return {
    loader: {
      noContextFiles: false,
      appendSystemPromptOverride: (base) => base,
      extensionFactories: [
        ...builtinExtensionsFor(toolNames),
        freshPromptExtension(composeAgentSection(cfg.systemPrompt, agentBody)),
      ],
    },
    tools: toolNames,
    // The SDK drops a custom tool missing from `tools`; keep the two consistent.
    customTools: () => protocolTools.filter((tool) => toolNames.includes(tool.name)),
    excludeTools: EXCLUDED_TOOL_NAMES,
    createSessionManager: (cwd, sessionDir) => {
      const manager = deps.io.createSessionManager(cwd, sessionDir);
      manager.newSession({ parentSession: params.parentSession?.parentSessionId });
      return manager;
    },
    checkGrants: (session) => enforceGrants(session, grants),
    callable: (session) => session.getActiveToolNames(),
  };
}

/**
 * Fork: the parent's branch, prompt and tool declarations, so the first
 * request shares the parent's cached prefix. Tools the fork may not use stay
 * declared and are refused by the guard; nothing changes the active set.
 */
function forkSetup(input: SetupInput): ContextSetup {
  const { params, deps, cfg } = input;
  const { snapshot } = params;
  const agent = deps.registry.resolveAgentConfig(params.type);
  const { callable, agentOnly } = forkCallableTools({
    agentTools: input.baseTools,
    disallowed: input.disallowed,
    parentTools: snapshot.toolNames,
  });
  const plan = buildForkSession({
    parent: snapshot,
    agent,
    cwd: cfg.effectiveCwd,
    task: params.task ?? "",
    callableTools: callable,
    agentOnlyTools: agentOnly,
  });
  const state: ForkGuardState = {
    callable: new Set(callable),
    parentSessionId: snapshot.sessionId,
    systemPrompt: plan.systemPrompt,
  };
  const stubs = new ForkStubs(snapshot.declarations, state);
  const grants = input.grants.filter((name) => !input.disallowed.includes(name));
  return {
    loader: {
      noContextFiles: false,
      appendSystemPromptOverride: (base) => base,
      extensionFactories: [...builtinExtensionsFor(plan.toolNames), forkGuardExtension(state)],
    },
    tools: [...plan.toolNames],
    customTools: (loader) => stubs.define(loader),
    // The orchestration tools the parent declares stay declared; the guard refuses them.
    excludeTools: [],
    createSessionManager: (cwd, sessionDir) =>
      deps.io.createForkSessionManager(cwd, sessionDir, params.parentSession?.parentSessionId, plan.entries),
    firstMessage: plan.firstMessage,
    checkGrants: (session) => {
      stubs.settle(session);
      return grants.length === 0
        ? []
        : enforceForkGrants(state, grants, session.getAllTools().filter((tool) => !stubs.refusing.has(tool.name)));
    },
    callable: () => [...state.callable],
    forkGuard: state,
  };
}

/**
 * The refusing stubs for the parent tools this fork's registry cannot build.
 * Declared before bind, they cannot tell a tool that never exists from one an
 * extension registers in `session_start`; `settle` decides after bind from what
 * actually registered. A stub never shadows a real implementation: it delegates.
 */
class ForkStubs {
  /** Stub names with no real implementation in the bound session. */
  readonly refusing = new Set<string>();
  private declared: string[] = [];
  private lookup: RealToolLookup | undefined;

  constructor(
    private readonly declarations: readonly ToolDeclaration[],
    private readonly state: ForkGuardState,
  ) {}

  define(loader: ResourceLoaderLike): ToolDefinition[] {
    const loaded = new Set(
      (loader.getExtensions?.().extensions ?? []).flatMap((extension) => [...extension.tools.keys()]),
    );
    const stubs = missingToolStubs(this.declarations, loaded, () => this.lookup);
    this.declared = stubs.map((stub) => stub.name);
    for (const name of this.declared) this.refusing.add(name);
    return stubs;
  }

  /** After bind: a stub whose tool registered is callable again if the agent allows it. */
  settle(session: AgentSession): void {
    // A registered tool the model cannot call (`hidden`) is no real implementation here.
    const registered = new Map(
      session.extensionRunner
        .getAllRegisteredTools()
        .filter((tool) => isModelCallable(tool.definition.exposure))
        .map((tool) => [tool.definition.name, tool.definition]),
    );
    this.lookup = (name) => registered.get(name);
    for (const name of this.declared) {
      if (registered.has(name)) this.refusing.delete(name);
      else this.state.callable.delete(name);
    }
  }
}

/**
 * A fork's model and thinking before the session exists: the agent's locked
 * values, then the launch's (caller or policy), then the parent's. An unlocked
 * agent default never applies, so the assembler's fallback to it is bypassed.
 */
function forkLaunchValues(params: CreateSubagentSessionParams, deps: SubagentSessionDeps): LaunchValues {
  const { snapshot } = params;
  const locked = applyLocks(
    deps.registry.resolveAgentConfig(params.type),
    { model: params.model, thinkingLevel: params.thinkingLevel },
    { model: snapshot.model, modelRegistry: snapshot.modelRegistry },
  );
  return {
    model: locked.model ?? snapshot.model,
    thinkingLevel: resolveForkThinking({ caller: locked.thinkingLevel, parent: snapshot.thinking }),
  };
}

/**
 * Build a born-complete SubagentSession: assemble config, create the SDK
 * session, publish lifecycle events, bind extensions, apply the recursion guard.
 */
export async function createSubagentSession(
  params: CreateSubagentSessionParams,
  deps: SubagentSessionDeps,
): Promise<SubagentSession> {
  const { snapshot, type } = params;
  const context = params.context ?? "fresh";
  const parentSessionId = params.parentSession?.parentSessionId;
  const identity = launchIdentity({
    id: params.agentId,
    type,
    currentToolCallId: params.parentSession?.toolCallId,
    metadata: params.metadata,
  });
  deps.lifecycle.spawning({ agentName: type, parentSessionId, ...identity });

  // Resolve working directory upfront - needed for detectEnv before assembly.
  const effectiveCwd = params.cwd ?? snapshot.cwd;
  const env = await deps.io.detectEnv(deps.exec, effectiveCwd);

  // Assemble session configuration (synchronous, no SDK objects).
  const cfg = assembleSessionConfig(
    type,
    {
      cwd: snapshot.cwd,
      parentModel: snapshot.model,
      modelRegistry: snapshot.modelRegistry,
    },
    {
      cwd: params.cwd,
      ...(context === "fork" ? forkLaunchValues(params, deps) : { model: params.model, thinkingLevel: params.thinkingLevel }),
    },
    env,
    deps.registry,
    deps.io.assemblerIO,
  );

  const parentToolNames = deps.listParentToolNames();
  const { toolNames: baseTools, unmatchedPatterns } = expandMcpToolPatterns(
    params.tools?.toolNames ?? cfg.toolNames,
    parentToolNames,
  );
  for (const pattern of unmatchedPatterns) {
    debugNote(`agent ${type}: tools pattern ${pattern} matched no tool the parent has`);
  }
  // `disallowed_tools` applies last to the complete allowlist, child protocol
  // tools and policy grants included, before the recursion denylist.
  const setupInput: SetupInput = {
    params,
    deps,
    cfg,
    baseTools,
    disallowed: deps.registry.resolveAgentConfig(type).disallowedTools,
    grants: params.tools?.grants ?? [],
  };
  const setup = context === "fork" ? forkSetup(setupInput) : freshSetup(setupInput);

  const agentDir = deps.io.getAgentDir();
  const sessionSettings = deps.io.createSettingsManager(cfg.effectiveCwd, agentDir);
  const loaderSettings = deps.io.createLoaderSettingsManager(sessionSettings);

  // Children inherit the parent's skills and every extension the composition
  // root did not exclude (#696), plus the Pi built-ins their tools call for —
  // Pi supplies those to its own CLI session only.
  const loader = deps.io.createResourceLoader({
    cwd: cfg.effectiveCwd,
    agentDir,
    settingsManager: loaderSettings,
    noPromptTemplates: true,
    noThemes: true,
    ...setup.loader,
  });
  await loader.reload();

  // Create a persisted SessionManager so transcripts are written in Pi's
  // official JSONL format. Falls back to a temp directory when the parent
  // session is not persisted (e.g. headless/API mode). A fork gets its own id.
  const sessionDir = deps.io.deriveSessionDir(params.parentSession?.parentSessionFile, cfg.effectiveCwd);
  const sessionManager = setup.createSessionManager(cfg.effectiveCwd, sessionDir);
  try {
    return await startSession({ params, deps, cfg, setup, loader, sessionManager, sessionDir, sessionSettings, agentDir, parentToolNames, identity });
  } catch (err) {
    // A fork's file already holds the parent's whole history and no record
    // links it yet; a launch that fails leaves nothing behind.
    discardForkFile(context, sessionManager.getSessionFile(), deps);
    throw err;
  }
}

function discardForkFile(context: ContextMode, file: string | undefined, deps: SubagentSessionDeps): void {
  if (context !== "fork" || !file) return;
  try {
    deps.io.removeSessionFile(file);
  } catch (err) {
    debugLog("fork transcript not removed", err);
  }
}

/** What `startSession` needs from the assembly above it. */
interface StartInput {
  params: CreateSubagentSessionParams;
  deps: SubagentSessionDeps;
  cfg: SessionConfig;
  setup: ContextSetup;
  loader: ResourceLoaderLike;
  sessionManager: SessionManagerLike;
  sessionDir: string;
  sessionSettings: SettingsManager;
  agentDir: string;
  parentToolNames: readonly string[];
  identity: ReturnType<typeof launchIdentity>;
}

/** Create the SDK session on the prepared manager, bind it and publish its lifecycle. */
async function startSession(input: StartInput): Promise<SubagentSession> {
  const { params, deps, cfg, setup, loader, sessionManager, sessionDir, sessionSettings, agentDir, parentToolNames, identity } = input;
  const { snapshot, type } = params;
  const context = params.context ?? "fresh";
  const parentSessionId = params.parentSession?.parentSessionId;
  const sessionId = sessionManager.getSessionId();

  const { session } = await deps.io.createSession({
    cwd: cfg.effectiveCwd,
    agentDir,
    sessionManager,
    settingsManager: sessionSettings,
    modelRegistry: snapshot.modelRegistry,
    model: cfg.model,
    tools: setup.tools,
    customTools: setup.customTools(loader),
    excludeTools: setup.excludeTools,
    resourceLoader: loader,
    thinkingLevel: cfg.thinkingLevel,
  });

  const subagentSession = new SubagentSession(session, {
    outputFile: sessionManager.getSessionFile(),
    sessionId,
    sessionDir,
    agentName: type,
    turnLimits: resolveTurnLimits(params.turnLimits, cfg.agentMaxTurns),
    firstMessage: setup.firstMessage,
    forkGuard: setup.forkGuard,
    lifecycle: deps.lifecycle,
  });

  // Publish session-created before bindExtensions() so observers (e.g. the
  // permission system) can register the child synchronously and have their
  // entry in place for the first permission check during child extension
  // initialization. The event bus dispatches synchronously, so a synchronous
  // subscriber completes before this returns.
  const facts = Object.freeze(effectiveFacts(session));
  params.onEffectiveFacts?.(facts);
  deps.lifecycle.sessionCreated({ sessionId, parentSessionId, context, ...identity, ...facts });

  try {
    // Bind extensions so that session_start fires and extensions can initialize.
    await session.bindExtensions({});
  } catch (err) {
    // Binding failed after session-created — dispose (child session_shutdown +
    // session.dispose() + emit disposed) before rethrowing so neither the
    // registration nor a partially-initialized extension's resources leak.
    await subagentSession.dispose();
    throw err;
  }

  // Every child session_start handler has now run, so this is the first — and
  // only — moment a parent can observe what the child's extensions installed.
  // Deliberately outside the try above: a child whose binding threw never ran.
  let grantedTools: string[];
  try {
    grantedTools = setup.checkGrants(session);
  } catch (err) {
    // Not even the pre-grant tool set could be restored: the child cannot be
    // returned safely, so tear it down as a failed bind is torn down.
    await subagentSession.dispose();
    throw err;
  }
  reportToolFacts(() => setup.callable(session), parentToolNames, params.onToolFacts);
  deps.lifecycle.bound({ sessionId, parentSessionId, ...identity, grantedTools });

  return subagentSession;
}
