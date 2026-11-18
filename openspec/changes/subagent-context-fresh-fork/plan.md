# Subagent Context: Fresh or Fork Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Replace `prompt_mode` and `inherit_context` with one `context: fresh | fork` setting. Fresh is the default and uses a clean child-session prompt. Fork is a real fork that reuses the parent's prompt cache. The UI shows `fork` instead of `twin`, and the jev root renames `forkedLaunch` to `forkLaunch`.

**Architecture:**
- **Executor.** The vendored executor (`packages/pi-subagents`) resolves one `ContextMode` per launch and carries it everywhere a launch is described.
  - A fresh child lets Pi build its own session prompt and appends the agent body.
  - A fork copies the parent's live branch into its own session. It keeps the parent's system prompt and tool declarations, enforces limits with a `tool_call` refusal, and rewrites the provider cache key to the parent's id.
- **jev root.** It reads the new field, renames its setting, and keeps `jev_review` declared but refused in forks.

**Tech Stack:**
- TypeScript on Pi (`@earendil-works/pi-coding-agent` SDK: `SessionManager`, resource loader `systemPromptOverride`, extension events `tool_call`, `before_provider_headers`, `before_provider_request`).
- Bun tests; the host tests use the recording provider fixture (`tests/host/fixture.ts`).

## Global Constraints

- Tests need no secrets, paid calls or network beyond loopback. The real-provider cache run (Task 7, step 7.3) is a manual evidence run outside `bun test`.
- `policy/` stays pure; only `host/` touches Pi. `src/` never imports `packages/pi-subagents` at runtime (`import type` only).
- Public repository: all code, docs and commit messages in English; no real prompts or secrets in fixtures.
- Deprecated names (`prompt_mode`, `inherit_context`, `inheritContext`, `subagents.forkedLaunch`) keep working for exactly one minor release, with warnings.
- Fixed strings, copied verbatim from the specs:
  - pending-call result: `Forked: this branch continues as a subagent.`
  - refusal: `Tool "<name>" is not available to this subagent.`
  - no-parent error: `Cannot fork: the parent has no session to fork from.`
  - labels: `fork`, `fork → fresh`
- Verify commands: `bun run test:executor` (executor), `bun test` (root), `bun run typecheck`, `bun run lint`.

## Review Focus

- **A fork from a parent mid-turn with several pending tool calls.** Every pending call gets the fixed result, so the request is valid. Pin: Task 4, "Mixed pending calls".
- **Two forks launched in the same assistant message.** Their requests are byte-identical up to the synthetic result, and each persists to its own file. Pin: Task 4, "Parallel forks share the prefix" and "Own lifecycle id".
- **A read-only agent forked from a parent that has `edit`/`bash`.** Nothing mutating runs, and the run facts count those tools as blocked. Pin: Task 4, "Disallowed tool refused" and "Fork blocked count".
- **An old agent file with `prompt_mode: append` and `inherit_context: true`.** It loads, runs as a fork, warns once per load, and never shows `twin`. Pin: Task 2, "Old prompt mode ignored"; Task 5, "Fresh run line".
- **A fork launched before the parent has written anything to its session file.** It still copies the in-memory branch. Pin: Task 4, "Fork before the parent has persisted".

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `ContextMode` | new | `type ContextMode = "fresh" \| "fork"` (`packages/pi-subagents/src/types.ts`, re-exported from the public types) | public |
| `subagent` tool param `context` | new | `context?: "fresh" \| "fork"`; description: "fresh (default): a new conversation with the agent's own prompt. fork: continues this conversation with the same prompt and tools." | public |
| `subagent` tool param `inherit_context` | modified (deprecated) | `inherit_context?: boolean`, kept one minor release; `true` → `fork`; warns once per session | public |
| Agent frontmatter `context` | new | `context: fresh \| fork`; any other value → no declared context + warning | public |
| Agent frontmatter `inherit_context` / `prompt_mode` | modified (deprecated) | `inherit_context` → `context`; `prompt_mode` ignored; warn once per file per load | public |
| `LockableField` / `LOCKABLE_FIELDS` | modified | `["model","thinking","max_turns","context","run_in_background"]`; frontmatter `locked: inherit_context` is read as `context` (deprecated) | public |
| `AgentConfig` | modified | remove `promptMode`, `inheritContext`; add `context?: ContextMode` | internal |
| `AgentIdentity` / `AgentPromptConfig` | modified | remove `promptMode` | internal |
| `AgentInvocation` | modified | remove `inheritContext`; add `context: ContextMode`, `contextFallback?: "no-parent-session"` | internal |
| `AgentInvocationConfig` (`config/invocation-config.ts`, returned by `resolveAgentInvocationConfig(agentConfig, params)`) | modified | `inheritContext: boolean` → `context: ContextMode`, `contextSource: "call" \| "agent" \| "default"` | internal |
| `AgentInvocationParams` | modified | adds `context?: ContextMode`; keeps `inherit_context?: boolean` (deprecated) | internal |
| `resolveInvocationModel` (`session/model-resolver.ts`) | modified | `(parentModel: Model<any> \| undefined, modelInput: string \| undefined, modelFromParams: boolean, registry: ModelRegistry \| undefined, opts?: { fork: boolean; modelLocked: boolean }) => ModelResolution`. When `opts.fork` and not `modelLocked` and not `modelFromParams`, it returns the parent model and ignores the agent's `modelInput` | internal |
| `resolveForkThinking` (`session/model-resolver.ts`) | new | `(input: { locked?: ThinkingLevel; caller?: ThinkingLevel; parent?: ThinkingLevel }) => ThinkingLevel \| undefined`; returns `locked ?? caller ?? parent`. The policy adjustment is applied afterwards by the existing launch-gate rule | internal |
| `composeAgentSection` (`session/prompts.ts`) | new (replaces `composeFreshPrompt`, decided at Task 3: Pi's `systemPromptOverride` only replaces the preamble) | `(header: string, body: string) => string`; returns `header + (body.trim() ? "\n\n" + body : "")` | internal |
| `freshPromptExtension` (`session/fresh-prompt-extension.ts`) | new | `(section: string) => ExtensionFactory`. It registers `before_agent_start` and sets `event.systemPromptOptions.sections.agent = section`, returning nothing | internal |
| Fresh prompt assembly internals (`buildAgentPrompt`, `AssemblerIO`, `AssemblerContext`, `CreateSubagentSessionDeps`) | modified (Task 3) | `buildAgentPrompt(config, cwd, env)` returns the header only (no `inherited`/`loadProjectContext`); `AssemblerIO` drops `loadProjectContext`; `AssemblerContext` drops `parentSystemPrompt`/`parentPortablePrompt`/`resolvePromptInheritance`; `CreateSubagentSessionDeps` drops `resolvePromptInheritance`. Reason: Pi builds the child's own prompt, so no parent prompt or portable strategy is needed. `project-context.ts` deleted; `provider-inheritance.ts` stays (child runtime provider replay in `index.ts`). | internal |
| `RuntimeSnapshotSource.buildSnapshot` (`runtime.ts`, `service/service-adapter.ts`, `tools/agent-tool.ts`) | modified | `buildSnapshot(context: ContextMode): ParentSnapshot` (was `inheritContext: boolean`) | internal |
| Spawn plumbing options (`SubagentRunOptions` in `lifecycle/subagent.ts`, `SpawnRequest` in `lifecycle/subagent-manager.ts`, and the execution objects in `tools/foreground-runner.ts` and `tools/background-spawner.ts`) | modified | `inheritContext?: boolean` → `context: ContextMode` (required) and `contextSource: "call" \| "agent" \| "default"` (required) | internal |
| Child registry (`src/host/platform/child.ts`) | modified | records `Map<sessionId, { context: "fresh" \| "fork" }>`; adds `childContext(sessionId: string): "fresh" \| "fork" \| undefined`; `isChild` unchanged | internal |
| `SpawnOptions` | modified | add `context?: ContextMode`; `inheritContext?: boolean` deprecated alias; an invalid `context` makes `spawn` throw `Invalid context "<v>": expected "fresh" or "fork".` | public |
| `AgentTypeSnapshot` | modified | `inheritContext?: boolean` → `context?: ContextMode` | public |
| `LaunchRequest` | modified | `inheritContext: boolean` → `context: ContextMode` (resolved, after fallback); `requested` for a fork = locked ?? caller ?? parent | public |
| `SubagentRecord` | modified | add `context: ContextMode`, `contextFallback?: "no-parent-session"` | public |
| `ChildSessionCreatedEvent` | modified | add `context: ContextMode` | public |
| `ParentSnapshot` | modified | remove `parentContext`, `portablePrompt`; add `sessionId: string`, `branch: readonly SessionEntry[]`, `toolNames: readonly string[]`, `declarations: readonly ToolDeclaration[]` (name, description, parameters; a fork stubs the ones its registry cannot build), `thinking?: ThinkingLevel`. `buildParentSnapshot(ctx, context, tools: readonly ToolDeclaration[])` (was `promptOptions`; `toolNames` derive from it); `branch` is empty for `fresh`. `SessionContext` gains `thinkingLevel?`; `SubagentRuntime` takes `listActiveTools` and drops `setSystemPromptOptions` (Task 4) | internal |
| `buildForkSession(input: ForkInput): ForkPlan` | new | `lifecycle/fork-session.ts`; `ForkInput = { parent: ParentSnapshot; agent: AgentConfig; cwd: string; task: string; callableTools: readonly string[]; agentOnlyTools: readonly string[] }`; `ForkPlan = { entries: SessionEntry[]; firstMessage: string; systemPrompt: string; toolNames: readonly string[] }` | internal |
| `forkGuardExtension` (`lifecycle/fork-guard.ts`) | new (modified at Task 4: prompt-force handler; no `systemPromptOverride` for a fork. Reason: SDK 1.5.0 treats a loader `systemPromptOverride` as the preamble and still renders its own `<cwd>` section after it, so the fork's system message differed from the parent's) | `(state: ForkGuardState) => ExtensionFactory`, with `ForkGuardState = { callable: Set<string>; parentSessionId: string; systemPrompt: string }`. It registers `before_agent_start` returning `{ systemPrompt: state.systemPrompt }` (every run), a `tool_call` refusal for names not in `state.callable`, and `before_provider_headers` (sets every spike-listed header) / `before_provider_request` (rewrites `prompt_cache_key`/`promptCacheKey` when present). `state.callable` is mutable so the grant check can update it after bind | internal |
| `enforceForkGrants` (`seams/grant-check.ts`) | new | `(state: ForkGuardState, granted: readonly string[], childTools: readonly Pick<ToolInfo, "name" \| "exposure">[]) => string[]`. It reuses `checkGrants(granted, childTools)`, so only grants that the child registered with a model-callable exposure take effect. It adds those to `state.callable`, returns them as `grantedTools`, and never calls `setActiveToolsByName`, so the declarations stay unchanged | internal |
| Fork session plumbing (Task 4) | new | `SessionFactoryIO.createForkSessionManager(cwd, sessionDir, parentSession, entries)` (prod: `session/fork-session-manager.ts`, writes the fork file with its own header plus the copied entries, then opens it; `SessionManager` has no public raw-entry append and `appendMessage` cannot carry compaction entries); `CreateSubagentSessionParams` gains `context?: ContextMode`, `task?: string`; `SubagentSessionMeta.parentContext` → `firstMessage?: string` (replaces the first run's prompt) and `forkGuard?: ForkGuardState`; `forkCallableTools({ agentTools, disallowed, parentTools }) => { callable, agentOnly }` in `fork-guard.ts`; `resolveLaunchContext(snapshot, context, contextSource)` + `NO_PARENT_SESSION_ERROR` in `subagent-manager.ts`; `LaunchFacts.parentThinking?`; fix round 1: `lifecycle/fork-stubs.ts` (`missingToolStubs`, `refusingStub`), `ResourceLoaderLike.getExtensions?`, `ContextSetup.customTools(loader)`, `SessionFactoryIO.removeSessionFile` (drops a failed fork's transcript), stubs delegate at call time to a real same-name tool the bound session registered (round 2: `refusingStub(declaration, real)`, `ForkStubs.settle` after bind decides callable/refusing from `extensionRunner.getAllRegisteredTools()`), `ModelInfo.parentHasBranch?` (an agent-file fork with no branch resolves model and thinking as fresh) | internal |
| `getContextLabel(context, fallback?)` | new (replaces `getPromptModeLabel`) | `(context: ContextMode, fallback?: "no-parent-session") => "fork" \| "fork → fresh" \| undefined` | internal |
| Config key `subagents.forkLaunch` | new | `"untouched" \| "thinking"`, default `"untouched"` | public |
| Config key `subagents.forkedLaunch` | modified (deprecated) | alias of `forkLaunch`; both present → problem at `subagents.forkedLaunch` | public |
| Config read result | modified | gains `notices?: readonly string[]` (deprecation notices shown by `/jev` status) | internal |
| `Settings.subagents` | modified | `{ forkedLaunch }` → `{ forkLaunch: "untouched" \| "thinking" }`; `ForkedLaunch` type → `ForkLaunch` | internal |
| `AgentFacts` / `EffectiveLaunch` / `LaunchRequestFacts` (`src/policy/launch.ts`) | modified | `inheritContext` → `context: "fresh" \| "fork"` (facts: optional) | internal |

---

## Task 1: Spike — fork mechanics on the Pi SDK — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4
**Difficulty:** Hard
**Blocked by:** none
**Model:** dispatch this task with `model: "9router/gpt-6-luna"`, as requested by the user at the final gate. It is the only task with a model override.

**Files:**
- Create (throwaway, deleted before the task ends): `packages/pi-subagents/test/spike/fork-probe.test.ts`
- Modify: `openspec/changes/subagent-context-fresh-fork/design.md` (append "Spike results")

- [ ] **Step 1:** Write `fork-probe.test.ts`. It creates a parent session against the recording fixture, runs one turn with a `read` tool result, then builds a second session through the real `createAgentSession`:
  - a persisted `SessionManager` with its own id, with the parent branch entries appended plus a synthetic tool result;
  - `systemPromptOverride: () => parentPrompt`;
  - `tools: parentToolNames`.

  Assert that the second session's first recorded request has the same `system`/`instructions` and `tools` JSON as the parent's last request.
- [ ] **Step 2:** Add a `tool_call` handler returning `{ block: true, reason }` for `edit`, and script the fixture to call `edit`. Assert that the result is an error with the reason and that no file changed.
- [ ] **Step 3:** For each `pi-ai` API used by registered providers (anthropic-messages, openai-completions, openai-responses, openai-codex-responses), record where `options.sessionId` lands. Source: `~/.bun/install/global/node_modules/@earendil-works/pi-ai/dist/api/*.js`. Assert in the probe that a `before_provider_headers` / `before_provider_request` handler can set each one to the parent id.
- [ ] **Step 3b:** Real-provider probe, kept in the throwaway spike only and never in `bun test` (the global constraint holds for merged tests). Use Pi's model registry entry `9router/gpt-6-luna` (the local router at `127.0.0.1:20128`, key from Pi's own auth).
  1. Run one parent turn that is at least 8000 input tokens.
  2. Run one fork built as in Step 1, with the guard's cache-key rewrite active.
  3. Record the `x-session-affinity` / `session_id` / `prompt_cache_key` values the router received. They must equal the parent's id.
  4. Record the fork's first-turn `usage.cacheRead`, and its ratio to the parent's total input.

  Write the numbers into the spike results. A ratio below 0.90 is reported, not a stop condition: the bound is enforced in Task 7.
- [ ] **Step 4:** Run `bun run --cwd packages/pi-subagents test test/spike`. Expected: all assertions pass.
- [ ] **Step 5:** Append `## Spike results` to `design.md` with the field list and outcomes.

  Stop condition: if the declarations cannot be kept identical, or blocking does not prevent execution, escalate to the parent and do not continue to Task 2.
- [ ] **Step 6:** Delete `test/spike/`, then commit the design note only: `docs(openspec): record fork spike results`.

---

## Task 2: Executor — context setting, resolution and deprecation — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
**Difficulty:** Normal
**Blocked by:** Task 1

**Files:**
- Modify:
  - `packages/pi-subagents/src/types.ts`
  - `src/config/custom-agents.ts`, `src/config/default-agents.ts`, `src/config/agent-types.ts`, `src/config/invocation-config.ts`
  - `src/seams/locked-launch.ts`, `src/seams/registry.ts`, `src/seams/launch-request.ts`, `src/seams/launch-gate.ts`
  - `src/tools/agent-tool.ts`, `src/tools/spawn-config.ts`
  - `src/service/service.ts`, `src/service/service-adapter.ts`
  - `src/public.ts` (if it re-exports types)

  All paths after the first are under `packages/pi-subagents/`.
- Test:
  - `packages/pi-subagents/test/config/custom-agents.test.ts`, `test/config/invocation-config.test.ts`
  - `test/tools/agent-tool.test.ts`
  - `test/service/service-adapter.test.ts`
  - `test/seams/registry.test.ts`, `test/seams/launch-policy.test.ts`

**Interfaces:** Produces `ContextMode`, `AgentInvocationConfig.context` / `contextSource`, `AgentInvocationParams.context`, the spawn plumbing options, `LaunchRequest.context`, `AgentTypeSnapshot.context`, `SpawnOptions.context` and `LockableField` (see Contracts).

- [ ] **Step 1:** Failing tests in `invocation-config.test.ts`:
  - `"default is fresh"` → `context` `fresh`, `contextSource` `default`;
  - `"caller wins over agent default"`;
  - `"locked agent wins over caller"` (`locked: context`);
  - `"inherit_context true maps to fork as caller"`;
  - `"context wins over inherit_context"`;
  - `"locked inherit_context reads as context"`.
- [ ] **Step 2:** Failing tests in `custom-agents.test.ts`:
  - `context: fork` parsed;
  - `context: twin` → undefined plus one warning naming the file and `context`;
  - `inherit_context: true` → `context: "fork"` plus a warning;
  - `prompt_mode: append` → ignored plus a warning;
  - two loads of the same file in one `loadCustomAgents` call → one warning each.
- [ ] **Step 3:** Run `bun run --cwd packages/pi-subagents test test/config`. Expected: FAIL.
- [ ] **Step 4:** Implement `ContextMode` and the field changes in `types.ts`, the frontmatter parsing in `custom-agents.ts`, and resolution in `invocation-config.ts` (`resolveField("context", …)` with the deprecated-call fallback; the warning goes through the existing `debugNote` path). Update `LOCKABLE_FIELDS`. Remove `promptMode` from `default-agents.ts` and `agent-types.ts`.
- [ ] **Step 5:** Run the config tests. Expected: PASS.
- [ ] **Step 6:** Failing tests:
  - `agent-tool.test.ts`: the schema has `context` (enum); `inherit_context: true` three times → one warning per session; `context: "twin"` rejected by the schema.
  - `service-adapter.test.ts`: `spawn(..., { context: "twin" })` throws `Invalid context "twin": expected "fresh" or "fork".`; `{ inheritContext: false }` → fresh plus a warning.
  - `registry.test.ts`: `inherit_context: true` → snapshot `context` `fork` with no `inheritContext`; built-in Explore has no `context`.
  - `launch-policy.test.ts`: the request has `context` and no `inheritContext`.
- [ ] **Step 7:** Implement the tool param, service options, snapshot and launch-request field (`agent-tool.ts`, `spawn-config.ts`, `service.ts`, `service-adapter.ts`, `registry.ts`, `launch-request.ts`, `launch-gate.ts`, `locked-launch.ts`).
- [ ] **Step 8:** Migrate every remaining production consumer so the package compiles with `promptMode`/`inheritContext` gone:
  - `lifecycle/subagent.ts`, `lifecycle/subagent-manager.ts`, `tools/foreground-runner.ts`, `tools/background-spawner.ts`: carry `context` and `contextSource`.
  - `runtime.ts` and `lifecycle/parent-snapshot.ts`: `buildSnapshot(context)`, building the text `parentContext` only when `context === "fork"` (temporary bridge, removed in Task 4 step 5).
  - `session/prompts.ts`: treat every agent as the old `replace` branch (temporary bridge, replaced in Task 3).
  - `ui/display.ts`: `getPromptModeLabel` returns `"fork"` for an invocation `context === "fork"` and nothing otherwise, and `buildInvocationTags` drops `inherit context` (temporary bridge, finalized in Task 5).

  Update the tests that asserted the old fields to the bridged behaviour.
- [ ] **Step 9:** Run `bun run test:executor` and `bun run typecheck`. Expected: PASS. Also run `rg -n "promptMode|inheritContext" packages/pi-subagents/src`. Expected: matches only in the deprecated-alias parsing (`custom-agents.ts`, `invocation-config.ts`, `service-adapter.ts`, `service.ts` `SpawnOptions`).
- [ ] **Step 10:** Commit `feat(subagents): add context fresh|fork setting with deprecated aliases`.

---

## Task 3: Executor — fresh prompt — implements 3

**Covers:** 3.1, 3.2, 3.3
**Difficulty:** Normal
**Blocked by:** Task 2

**Files:**
- Modify (under `packages/pi-subagents/`):
  - `src/lifecycle/create-subagent-session.ts`
  - `src/session/prompts.ts`, `src/session/session-config.ts`
- Delete if unused: `packages/pi-subagents/src/session/project-context.ts`, `src/session/provider-inheritance*` portions tied to the portable prompt.
- Test: `packages/pi-subagents/test/session/prompts.test.ts`, `test/lifecycle/create-subagent-session.test.ts`, `test/session/session-config.test.ts`, `test/lifecycle/fresh-prompt.test.ts` (new)

**Interfaces:** Consumes `AgentInvocationConfig.context`. Produces `composeAgentSection` and `freshPromptExtension` (see Contracts).

- [ ] **Step 1:** Failing tests:
  - `create-subagent-session.test.ts` (fresh): the loader is created with `noContextFiles: false`, no `systemPromptOverride`, and a passthrough `appendSystemPromptOverride`; `extensionFactories` include `freshPromptExtension`.
  - A new SDK-assembly test in `test/lifecycle/fresh-prompt.test.ts` uses the real `DefaultResourceLoader` on a temp project holding an `AGENTS.md` with `AGENTS-MARKER` and an `APPEND_SYSTEM.md` with `APPEND-MARKER`, and a parent prompt containing `PARENT-MARKER`. It asserts on the child's assembled system prompt:
    - `AGENTS-MARKER` is present before the body;
    - `APPEND-MARKER` occurs exactly once;
    - `PARENT-MARKER` is absent;
    - the prompt's last section is `<agent>` and it ends with `BODY-MARKER`, with `<active_agent name="…"/>` before the body;
    - the first user message is exactly the task.

    The test runs a real `createAgentSession` turn against a loopback fixture, so `before_agent_start` fires.
- [ ] **Step 2:** Failing tests in `prompts.test.ts`:
  - `composeAgentSection` puts the body last and `<active_agent name="x"/>` before it; an empty body yields the header only;
  - `freshPromptExtension` sets `sections.agent` on the event;
  - the old inherited-identity tests are deleted.
- [ ] **Step 3:** Run them. Expected: FAIL.
- [ ] **Step 4:** Implement. Delete `adoptedIdentity`, `inheritedIdentity`, `ownProjectContext`, `genericBase` and the portable strategy plumbing in `session-config.ts` (`resolvePromptInheritance`, `parentPortablePrompt`). Keep `buildPromptHeader`.
- [ ] **Step 5:** Run `bun run test:executor`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(subagents): fresh children use their own session prompt`.

---

## Task 4: Executor — fork session — implements 4

**Covers:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
**Difficulty:** Very Hard
**Blocked by:** Task 2, Task 3 (both edit `create-subagent-session.ts`; added to keep one writer per file)

**Files:**
- Create (under `packages/pi-subagents/src/lifecycle/`): `fork-session.ts`, `fork-guard.ts`
- Modify (under `packages/pi-subagents/src/`):
  - `lifecycle/parent-snapshot.ts`, `lifecycle/create-subagent-session.ts`, `lifecycle/subagent-session.ts`, `lifecycle/subagent-manager.ts`, `lifecycle/child-lifecycle.ts`
  - `session/context.ts` (delete `buildParentContext`)
  - `session/model-resolver.ts`
  - `runtime.ts`
  - `seams/launch-gate.ts`, `seams/grant-check.ts`
  - `ui/run-facts.ts` (or wherever the tool facts are read)
- Test (under `packages/pi-subagents/test/`):
  - Create: `lifecycle/fork-session.test.ts`, `lifecycle/fork-tools.test.ts`
  - Modify: `lifecycle/parent-snapshot.test.ts`, `lifecycle/subagent-manager.test.ts`, `session/model-resolver.test.ts`, `session/context.test.ts` (delete), `ui/run-facts.test.ts`

**Interfaces:**
- Consumes `ContextMode`, `contextSource`, and the spike field list (`design.md` "Spike results").
- Produces `buildForkSession`, `forkGuardExtension`, `ParentSnapshot` (new shape), `SubagentRecord.context` / `contextFallback` and `ChildSessionCreatedEvent.context`.

- [ ] **Step 1:** Failing tests in `parent-snapshot.test.ts`: the snapshot carries `sessionId`, `branch` (the live `getBranch()` entries, including when the session file is not yet written), `toolNames` and `thinking`, and no `parentContext`.
- [ ] **Step 2:** Failing tests in `fork-session.test.ts` (pure `buildForkSession`):
  - **"Same prefix":** `entries` begin with the parent branch in order.
  - **"Tool results inherited":** a tool-result entry stays a tool result.
  - **"Mixed pending calls":** a leaf with pending `read` and `subagent` gets two results with text `Forked: this branch continues as a subagent.`
  - **"Parallel forks share the prefix":** two plans with different tasks are equal up to the instructions message.
  - **"Child directory stated":** `firstMessage` names `cwd`.
  - **"Agent-only tools named":** `firstMessage` names `web_search`.
  - `systemPrompt === parent.systemPrompt`, `toolNames === parent.toolNames`.
- [ ] **Step 3:** Run them. Expected: FAIL. Implement `parent-snapshot.ts` and `fork-session.ts`. Expected: PASS.
- [ ] **Step 4:** Failing tests in `fork-tools.test.ts`:
  - the callable set for `tools: read, grep` from a parent with `read, grep, edit, subagent` is `read, grep`;
  - `disallowed_tools: bash` → `bash` not callable but declared;
  - a policy removal → not callable;
  - an enforced assessment flag → not callable;
  - `subagent` / `get_subagent_result` / `steer_subagent` are never callable;
  - no `ask_parent` / `notify_parent` in the declarations;
  - the `forkGuardExtension` `tool_call` handler returns `{ block: true, reason: 'Tool "edit" is not available to this subagent.' }`;
  - the header/payload rewrite sets each spike-listed field to the parent id.
- [ ] **Step 5:** Implement `fork-guard.ts` and wire the fork path in `create-subagent-session.ts`:
  - when `context === "fork"`, create the session manager with its own id, then append `plan.entries`;
  - `systemPromptOverride: () => plan.systemPrompt`;
  - `tools: plan.toolNames`; `customTools` without protocol tools;
  - **`excludeTools: []`** for a fork, so the orchestration tools the parent declares stay declared and are refused by the guard instead;
  - `extensionFactories` plus `forkGuardExtension(state)`;
  - after bind, call `enforceForkGrants(state, grants, session.getAllTools())` instead of `enforceGrants`, so nothing calls `setActiveToolsByName` on a fork;
  - the first prompt is `plan.firstMessage`.

  Add tests:
  - the fork session's `getActiveToolNames()` equals `plan.toolNames` after bind and after the grant check;
  - a granted parent tool that the child did not register is not added to `state.callable` and is absent from `grantedTools`;
  - a granted tool registered with an exposure that is not model-callable is not added.

  Remove the `parentContext` prepend in `subagent-session.ts`, the Task 2 bridge in `parent-snapshot.ts`, and `session/context.ts`'s `buildParentContext`. Keep the `ForkGuardState` on `SubagentSession` so that a resume reuses it. Expected: PASS.
- [ ] **Step 6:** Failing tests in `model-resolver.test.ts`:
  - **"Agent default ignored":** unlocked agent model, no caller → the parent's model.
  - **"Caller override".**
  - **"Locked agent model".**
  - **"Parent thinking kept".**
  - **"Policy over caller":** caller `low`, policy `medium` → `medium`.
  - The launch request's `requested` = locked ?? caller ?? parent ("Locked fork request").

  Implement in `model-resolver.ts` / `launch-gate.ts`. Expected: PASS.
- [ ] **Step 7:** Failing tests in `subagent-manager.test.ts`:
  - **"Explicit fork fails":** `contextSource` `call` with an empty branch → rejects with `Cannot fork: the parent has no session to fork from.` and no session is created.
  - **"Agent default falls back":** `contextSource` `agent` with an empty branch → runs fresh with `contextFallback` `no-parent-session`; the launch request's `context` is `fresh`.

  Implement. Expected: PASS.
- [ ] **Step 8:** Failing tests in `run-facts.test.ts`:
  - a fork's tool count = callable size; blocked = the rest of the total;
  - **"Refused fork tool is blocked"**;
  - the `subagents:child:session-created` payload has `context`.

  Implement. Expected: PASS.
- [ ] **Step 9:** Run `bun run test:executor`. Expected: PASS.
- [ ] **Step 10:** Commit `feat(subagents): real fork sharing the parent's prompt cache`.

---

## Task 5: Executor — display — implements 5

**Covers:** 5.1, 5.2, 5.3
**Difficulty:** Easy
**Blocked by:** Task 4 (reads `SubagentRecord.context` / `contextFallback` produced there). Task 2 is covered transitively.

**Files:**
- Modify (under `packages/pi-subagents/src/`):
  - `ui/display.ts`, `ui/widget-renderer.ts`, `ui/session-navigation.ts`, `ui/session-navigator.ts`
  - `tools/spawn-config.ts`, `tools/result-renderer.ts`, `tools/helpers.ts`
- Test (under `packages/pi-subagents/test/`): `display.test.ts`, `widget-renderer.test.ts`, `tools/result-renderer.test.ts`, `ui/session-navigation.test.ts`, `ui/session-navigator.test.ts`, `tools/spawn-config.test.ts`

**Interfaces:** Consumes `SubagentRecord.context` / `contextFallback`. Produces `getContextLabel`.

- [ ] **Step 1:** Failing tests:
  - `getContextLabel("fork")` → `"fork"`; `("fresh", "no-parent-session")` → `"fork → fresh"`; `("fresh")` → `undefined`;
  - `buildInvocationTags` never emits `inherit context`;
  - **"Existing order kept":** the stats read `fixture/fixture-fast`, `fork`, `thinking: low`, `🔧12`, `⊘2`, `↻3`, `5 tool uses`;
  - **"Fallback shown"**; **"Fresh run has no label"**;
  - **"Running agent line":** contains `(fork)` then the bracket tag;
  - **"Fresh run line":** no `(fork)` / `(twin)`;
  - the navigator heading shows `(fork)`.
- [ ] **Step 2:** Run them. Expected: FAIL. Implement, taking the label from the record/invocation instead of `registry.resolveAgentConfig(type)`. Remove `getPromptModeLabel`.
- [ ] **Step 3:** `rg -n "twin" packages/pi-subagents/src packages/pi-subagents/test` returns nothing. Then run `bun run test:executor`. Expected: PASS.
- [ ] **Step 4:** Commit `feat(subagents): show fork label from the run, drop twin`.

---

## Task 6: jev root — rename and fork-aware wiring — implements 6

**Covers:** 6.1, 6.2, 6.3, 6.4
**Difficulty:** Normal
**Blocked by:** Task 2, Task 4 (consumes `ChildSessionCreatedEvent.context`, which Task 4 adds)

**Files:**
- Modify (under `src/`):
  - `store/config.ts`, `store/settings.ts`, `store/settings-sections.ts`, `store/defaults.ts`
  - `host/commands/status-format.ts` (prints config notices in the `/jev` report)
  - `policy/launch.ts`, `policy/worker/route.ts`
  - `host/worker/request.ts`, `host/worker/route.ts`
  - `host/platform/agents.ts`, `host/platform/child.ts` (registry keeps `context`)
  - `host/wiring/turn.ts`, `host/review/tool.ts`
- Test (under `tests/`):
  - `store/config-read.test.ts`, `store/settings.test.ts`, `store/settings-sections.test.ts`, `store/settings-pin.test.ts`
  - `host/commands/status-format.test.ts` (notice line)
  - `policy/worker/route.test.ts`, `policy/worker/route-pin.test.ts`
  - `host/worker-routing.test.ts`, `host/worker-fakes.ts`, `host/worker-ledger.test.ts`
  - `host/platform/agent-facts.test.ts`, `host/platform/child.test.ts`
  - `host/review-tool.test.ts`
  - `replay/*.test.ts` that name `forkedLaunch`

**Interfaces:** Consumes (type-only) `LaunchRequest.context`, `AgentTypeSnapshot.context`, `ChildSessionCreatedEvent.context`. Produces `Settings.subagents.forkLaunch`, `ForkLaunch`, config `notices`.

- [ ] **Step 1:** Failing tests in `config-read.test.ts`:
  - **"Forked launch setting accepted"** (`forkLaunch: "thinking"`);
  - **"Forked launch setting rejected"** (`forkLaunch: "skip"` → problem at `subagents.forkLaunch`; `inheritContext` → unknown key);
  - **"Deprecated forkedLaunch accepted"** → `forkLaunch` `thinking` with one notice naming `subagents.forkLaunch`;
  - **"Both keys present"** → invalid at `subagents.forkedLaunch`, no value returned.

  Failing tests in `settings.test.ts`: **"Everything defaulted"** has `subagents.forkLaunch` `untouched`; **"Forked launch from config"**; **"Fork launch from the deprecated key"**.
- [ ] **Step 2:** Implement in `store/*`; the status renderer shows notices. Expected: PASS.
- [ ] **Step 3:** Failing tests in `route.test.ts` / `worker-routing.test.ts`: replace every `inheritContext: true` fixture with `context: "fork"`. The scenario names are unchanged ("Forked launch left alone", "Forked thinking with thinking locked", "Forked launch with thinking", "Forked launch with thinking asks fewer questions"). Add "Jev fails for a fork with thinking" → reason `miss`, nothing written.

  Failing tests in `agent-facts.test.ts`: "Context carried".
- [ ] **Step 4:** Implement in `policy/launch.ts`, `policy/worker/route.ts`, `host/worker/*`, `host/platform/agents.ts`. Expected: PASS.
- [ ] **Step 5:** Failing tests in `review-tool.test.ts` / `child.test.ts`: the registry records `context` from `session-created`; `hideReviewInChild` leaves `jev_review` in `selectedTools` for a fork and removes it for a fresh child; `execute` in any child returns the error and spawns no process.
- [ ] **Step 6:** Implement. Run `bun test`, `bun run typecheck`, `bun run lint`. Expected: PASS.
- [ ] **Step 7:** Commit `feat: rename forkedLaunch to forkLaunch and key routing on fork context`.

---

## Task 7: Host evidence and cache evidence — implements 7

**Covers:** 7.1, 7.2, 7.3
**Difficulty:** Hard
**Blocked by:** Task 3, Task 4, Task 5, Task 6

**Files:**
- Modify: `tests/host/launch-policy-evidence.test.ts`, `tests/host/tool-assessment.test.ts`
- Create:
  - `tests/host/context-mode.test.ts`
  - `scripts/fork-cache-evidence.ts` (manual, not run by `bun test`)
  - `docs/evidence/<YYYY-MM-DD>-fork-cache.md`

**Interfaces:** Consumes the full executor and jev root behaviour.

- [ ] **Step 1:** In `launch-policy-evidence.test.ts`, change `launch(WORKER, { inherit_context: true })` to `{ context: "fork" }`. Assert:
  - **"Inherited context with a policy model":** the marker appears inside a `role: "tool"` message;
  - **"Untouched fork keeps the parent prefix":** a fork with no policy has a first request whose `system` and `tools` JSON equal the parent's last request byte-for-byte.
- [ ] **Step 2:** Create `context-mode.test.ts`, using `startHostSession` and `startFixture`, with these cases:
  - a fresh child has no parent-prompt marker and no conversation marker;
  - two forks in one parent message have identical request prefixes up to the synthetic result, and different session ids and transcript files;
  - a read-only fork calling `edit` → refused text, no file change;
  - a fork calling `jev_review` → refused, declared;
  - an explicit fork from an empty parent fails with the fixed message;
  - **"Fork before the parent has persisted"**.
- [ ] **Step 2b:** In `tests/host/tool-assessment.test.ts`, add the fork cases:
  - **"Observe in a fork"**;
  - **"Enforce in a fork"**;
  - **"Resumed fork keeps refusals"**: resume reuses the session and its `ForkGuardState` (kept on `SubagentSession` from Task 4), and no assessment request is sent.

  Add `tests/host/tool-assessment.test.ts` to this task's files.
- [ ] **Step 3:** Run `bun test tests/host/launch-policy-evidence.test.ts tests/host/context-mode.test.ts`. Expected: PASS.
- [ ] **Step 4:** Write `scripts/fork-cache-evidence.ts`, run as `bun scripts/fork-cache-evidence.ts --anthropic <provider/id> --openai <provider/id>`.
  - **Keys.** Read from `ANTHROPIC_API_KEY` and `FORK_EVIDENCE_OPENAI_API_KEY` (with `FORK_EVIDENCE_OPENAI_BASE_URL`). Never print them.
  - **Parent.** Build a parent turn from a generated filler document. Let `P` be the parent's last-request total input, `input + cacheRead + cacheWrite` from its usage. Exclude the sample unless `P >= 8000`.
  - **Fork.** Record the timestamp when the parent's last request is sent. Start the fork within 60 seconds of that timestamp, with no thinking or tool override; compute elapsed seconds and the exclusion rule from it. Record the fork's first-turn `cacheRead` and the ratio `cacheRead / P`.
  - **Matrix.** For each provider: one fork, two parallel forks, and one fork with a model override. The model-override row is recorded with no bound.
  - **Output.** One table row per run: provider, kind, `P`, `cacheRead`, ratio, elapsed seconds, included or excluded.

  Run it manually and write the table and conditions into `docs/evidence/<date>-fork-cache.md`. The bound is a ratio of at least 0.90 for every included same-model row. If the bound fails, stop and escalate; do not lower it.
- [ ] **Step 5:** Commit `test: host and cache evidence for fresh and fork contexts`.

---

## Task 8: Docs, decision record and migration — implements 8

**Covers:** 8.1, 8.2, 8.3
**Difficulty:** Easy
**Blocked by:** Task 3, Task 4, Task 5, Task 6

**Files:**
- Create: `packages/pi-subagents/docs/decisions/0014-subagent-context-is-fresh-or-fork.md`, `tests/docs-old-names.test.ts`
- Modify:
  - ADR status lines: `packages/pi-subagents/docs/decisions/0006-*.md`, `0008-*.md`, `0009-*.md`, `0010-*.md`, `0011-*.md`
  - `packages/pi-subagents/README.md`, `packages/pi-subagents/docs/configuration.md`, `packages/pi-subagents/VENDORED.md`, `packages/pi-subagents/CHANGELOG.md`
  - `docs/configuration.md`, `docs/usage-guide.md`, `docs/workflow.md`, `docs/jev-contract.md`, `docs/domain-model.md`, `docs/roadmap.md`

- [ ] **Step 1:** Failing test `tests/docs-old-names.test.ts` ("Old names gone from current docs"). It greps `docs/**/*.md` and `packages/pi-subagents/**/*.md` for `twin`, `prompt_mode` and `inherit_context`. Exempt:
  - `docs/evidence/` and `openspec/changes/archive/`;
  - accepted ADR files and `CHANGELOG.md`;
  - lines inside a section whose heading contains "Deprecated".

  Also assert that ADR 0014 exists and ADR 0008's status names 0014 ("Decision record present").
- [ ] **Step 2:** Write ADR 0014 from design D1–D9. Update the status lines of ADRs 0006, 0008, 0009, 0010 and 0011.
- [ ] **Step 3:** Update the READMEs and configuration docs: `context`, frontmatter, service, the fork cache conditions and the agent-only-tools caveat; a "Deprecated" subsection listing the aliases. Add a CHANGELOG migration section mapping each old name to its replacement; `VENDORED.md` lists the local divergence.
- [ ] **Step 4:** Run `bun test tests/docs-old-names.test.ts` and `bun run lint`. Expected: PASS.
- [ ] **Step 5:** Commit `docs: fresh and fork subagent context, ADR 0014 and migration notes`.

---

## Scenario → test

- agent-metadata / Built-in Explore → `tests/host/platform/agent-facts.test.ts`
- agent-metadata / Long instructions → `tests/host/platform/agent-facts.test.ts`
- agent-metadata / Disallowed tools carried → `tests/host/platform/agent-facts.test.ts`
- agent-metadata / Context carried → `tests/host/platform/agent-facts.test.ts`
- cli-review / Offered in the main session → `tests/host/review-tool.test.ts`
- cli-review / Absent in a child session → `tests/host/review-tool.test.ts`
- cli-review / Refused in a child session → `tests/host/review-tool.test.ts`
- cli-review / Declared but refused in a fork → `tests/host/review-tool.test.ts` (fork case) + `tests/host/platform/child.test.ts`
- config-file / Duplicate hold provider → `tests/store/config-read.test.ts`
- config-file / Hold provider bounds → `tests/store/config-read.test.ts`
- config-file / Non-boolean parentRequest → `tests/store/config-read.test.ts`
- config-file / Enum values → `tests/store/config-read.test.ts`
- config-file / CLI review enabled accepted → `tests/store/config-read.test.ts`
- config-file / Non-boolean review.enabled → `tests/store/config-read.test.ts`
- config-file / Forked launch setting accepted → `tests/store/config-read.test.ts`
- config-file / Forked launch setting rejected → `tests/store/config-read.test.ts`
- config-file / Deprecated forkedLaunch accepted → `tests/store/config-read.test.ts`
- config-file / Both keys present → `tests/store/config-read.test.ts`
- config-file / Grant cut accepted → `tests/store/config-read.test.ts`
- config-file / Grant cut out of range → `tests/store/config-read.test.ts`
- executor-agent-registry / Built-in Explore → `packages/pi-subagents/test/seams/registry.test.ts`
- executor-agent-registry / Snapshot is detached → `packages/pi-subagents/test/seams/registry.test.ts`
- executor-agent-registry / Absent tools kept distinct from defaults → `packages/pi-subagents/test/seams/registry.test.ts`
- executor-agent-registry / Deprecated inherit_context declared → `packages/pi-subagents/test/seams/registry.test.ts`
- executor-agent-registry / Default tool denied → `packages/pi-subagents/test/seams/registry.test.ts`
- executor-agent-registry / Denied wins over declared → `packages/pi-subagents/test/seams/registry.test.ts`
- executor-agent-registry / Denied wins over a grant → `packages/pi-subagents/test/seams/registry.test.ts`
- executor-agent-registry / Snapshot lists denied tools → `packages/pi-subagents/test/seams/registry.test.ts`
- executor-agent-registry / Denied in a fork → `packages/pi-subagents/test/lifecycle/fork-tools.test.ts`
- executor-launch-policy / Tool-call origin → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- executor-launch-policy / Orchestration tools never offered → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- executor-launch-policy / Excluded extension's tool not offered → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- executor-launch-policy / Locked caller value not requested → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- executor-launch-policy / Fork request → `packages/pi-subagents/test/seams/launch-policy.test.ts` (fork cases)
- executor-launch-policy / Locked fork request → `packages/pi-subagents/test/seams/launch-policy.test.ts` (fork cases)
- executor-launch-policy / Fallen-back fork → `packages/pi-subagents/test/seams/launch-policy.test.ts` (fork cases)
- executor-launch-policy / Model and thinking applied → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- executor-launch-policy / Locked field kept → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- executor-launch-policy / Extension tool granted → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- executor-launch-policy / Declared tool not removable → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- executor-launch-policy / Default tool removed → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- executor-launch-policy / Grant outside the parent's tools dropped → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- executor-launch-policy / Removal in a fork → `packages/pi-subagents/test/seams/launch-policy.test.ts` (fork cases)
- host-seam-evidence / Policy model reaches the child → `tests/host/launch-policy-evidence.test.ts`
- host-seam-evidence / Inherited context with a policy model → `tests/host/launch-policy-evidence.test.ts`
- host-seam-evidence / Untouched fork keeps the parent prefix → `tests/host/launch-policy-evidence.test.ts`
- host-seam-evidence / Grant reaches the child → `tests/host/launch-policy-evidence.test.ts`
- settings-resolution / Everything defaulted → `tests/store/settings.test.ts`
- settings-resolution / Config over default → `tests/store/settings.test.ts`
- settings-resolution / Tuning over config → `tests/store/settings.test.ts`
- settings-resolution / Forked launch from config → `tests/store/settings.test.ts`
- settings-resolution / Fork launch from the deprecated key → `tests/store/settings.test.ts`
- settings-resolution / Grant cut from config → `tests/store/settings.test.ts`
- subagent-context-mode / Invalid value → `packages/pi-subagents/test/config/invocation-config.test.ts` + `test/tools/agent-tool.test.ts`
- subagent-context-mode / Invalid service value → `packages/pi-subagents/test/service/service-adapter.test.ts`
- subagent-context-mode / Invalid frontmatter value → `packages/pi-subagents/test/config/custom-agents.test.ts`
- subagent-context-mode / Default is fresh → `packages/pi-subagents/test/config/invocation-config.test.ts`
- subagent-context-mode / Caller wins over agent default → `packages/pi-subagents/test/config/invocation-config.test.ts`
- subagent-context-mode / Locked agent wins over caller → `packages/pi-subagents/test/config/invocation-config.test.ts`
- subagent-context-mode / Service option → `packages/pi-subagents/test/service/service-adapter.test.ts`
- subagent-context-mode / Old tool parameter → `packages/pi-subagents/test/config/invocation-config.test.ts` + `test/tools/agent-tool.test.ts`
- subagent-context-mode / Both given → `packages/pi-subagents/test/config/invocation-config.test.ts` + `test/tools/agent-tool.test.ts`
- subagent-context-mode / Old service option → `packages/pi-subagents/test/service/service-adapter.test.ts`
- subagent-context-mode / Old prompt mode ignored → `packages/pi-subagents/test/config/custom-agents.test.ts`
- subagent-context-mode / Warning once per session → `packages/pi-subagents/test/config/invocation-config.test.ts` + `test/tools/agent-tool.test.ts`
- subagent-context-mode / Project instructions present → `packages/pi-subagents/test/lifecycle/fresh-prompt.test.ts` + `tests/host/context-mode.test.ts` (no parent marker)
- subagent-context-mode / Append file applied once → `packages/pi-subagents/test/lifecycle/fresh-prompt.test.ts` + `tests/host/context-mode.test.ts` (no parent marker)
- subagent-context-mode / Agent body last → `packages/pi-subagents/test/lifecycle/fresh-prompt.test.ts` + `tests/host/context-mode.test.ts` (no parent marker)
- subagent-context-mode / No parent identity → `packages/pi-subagents/test/lifecycle/fresh-prompt.test.ts` + `tests/host/context-mode.test.ts` (no parent marker)
- subagent-context-mode / No parent conversation → `packages/pi-subagents/test/lifecycle/fresh-prompt.test.ts` + `tests/host/context-mode.test.ts` (no parent marker)
- subagent-context-mode / Same prefix as parent → `packages/pi-subagents/test/lifecycle/fork-session.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Tool results inherited → `packages/pi-subagents/test/lifecycle/fork-session.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Fork before the parent has persisted → `packages/pi-subagents/test/lifecycle/fork-session.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Own lifecycle id → `packages/pi-subagents/test/lifecycle/fork-session.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Parallel forks share the prefix → `packages/pi-subagents/test/lifecycle/fork-session.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Mixed pending calls → `packages/pi-subagents/test/lifecycle/fork-session.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Agent-only tools named → `packages/pi-subagents/test/lifecycle/fork-session.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Child directory stated → `packages/pi-subagents/test/lifecycle/fork-session.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Agent default ignored → `packages/pi-subagents/test/session/model-resolver.test.ts`
- subagent-context-mode / Caller override → `packages/pi-subagents/test/session/model-resolver.test.ts`
- subagent-context-mode / Locked agent model → `packages/pi-subagents/test/session/model-resolver.test.ts`
- subagent-context-mode / Parent thinking kept → `packages/pi-subagents/test/session/model-resolver.test.ts`
- subagent-context-mode / Policy over caller → `packages/pi-subagents/test/session/model-resolver.test.ts`
- subagent-context-mode / Declarations unchanged → `packages/pi-subagents/test/lifecycle/fork-tools.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / No protocol tools → `packages/pi-subagents/test/lifecycle/fork-tools.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Disallowed tool refused → `packages/pi-subagents/test/lifecycle/fork-tools.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Nested spawn refused → `packages/pi-subagents/test/lifecycle/fork-tools.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Disallowed tool refused, not removed → `packages/pi-subagents/test/lifecycle/fork-tools.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Enforced assessment refuses → `packages/pi-subagents/test/lifecycle/fork-tools.test.ts` + `tests/host/context-mode.test.ts`
- subagent-context-mode / Explicit fork fails → `packages/pi-subagents/test/lifecycle/subagent-manager.test.ts`
- subagent-context-mode / Agent default falls back → `packages/pi-subagents/test/lifecycle/subagent-manager.test.ts`
- subagent-context-mode / Same-model fork reads the cache → manual evidence `docs/evidence/<date>-fork-cache.md` (Task 7, step 7.3)
- subagent-context-mode / Parallel forks → manual evidence `docs/evidence/<date>-fork-cache.md` (Task 7, step 7.3)
- subagent-context-mode / Short parent excluded → manual evidence `docs/evidence/<date>-fork-cache.md` (Task 7, step 7.3)
- subagent-context-mode / Decision record present → `tests/docs-old-names.test.ts` (Task 8)
- subagent-context-mode / Old names gone from current docs → `tests/docs-old-names.test.ts` (Task 8)
- subagent-run-facts / Policy-changed thinking shown live → `packages/pi-subagents/test/tools/result-renderer.test.ts` / `test/widget-renderer.test.ts` / `test/ui/session-navigator.test.ts`
- subagent-run-facts / Existing order kept → `packages/pi-subagents/test/tools/result-renderer.test.ts` / `test/widget-renderer.test.ts` / `test/ui/session-navigator.test.ts`
- subagent-run-facts / Fallback shown → `packages/pi-subagents/test/tools/result-renderer.test.ts` / `test/widget-renderer.test.ts` / `test/ui/session-navigator.test.ts`
- subagent-run-facts / Fresh run has no label → `packages/pi-subagents/test/tools/result-renderer.test.ts` / `test/widget-renderer.test.ts` / `test/ui/session-navigator.test.ts`
- subagent-run-facts / Running agent line → `packages/pi-subagents/test/tools/result-renderer.test.ts` / `test/widget-renderer.test.ts` / `test/ui/session-navigator.test.ts`
- subagent-run-facts / No facts known → `packages/pi-subagents/test/tools/result-renderer.test.ts` / `test/widget-renderer.test.ts` / `test/ui/session-navigator.test.ts`
- subagent-run-facts / Fresh run line → `packages/pi-subagents/test/tools/result-renderer.test.ts` / `test/widget-renderer.test.ts` / `test/ui/session-navigator.test.ts`
- subagent-run-facts / Count after the grant check → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Fork tool count → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Allowlist narrows the child → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Disallowed tool is blocked → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Policy removal is blocked → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Removal re-granted is not blocked → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Unknown before bind → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Fork blocked count → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Recursion guard tools are blocked → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Child's own tools are granted → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Granted plus blocked is the total → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Nothing blocked → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- subagent-run-facts / Refused fork tool is blocked → `packages/pi-subagents/test/ui/run-facts.test.ts` + `tests/host/run-facts-offline.test.ts`
- tool-assessment / Long brief → `tests/host/tool-assessment.test.ts`
- tool-assessment / Forked worker → `tests/host/tool-assessment.test.ts` (fork cases)
- tool-assessment / Empty prompt → `tests/host/tool-assessment.test.ts`
- tool-assessment / Brief not stored → `tests/host/tool-assessment.test.ts`
- tool-assessment / Observe keeps tools → `tests/host/tool-assessment.test.ts`
- tool-assessment / Observe in a fork → `tests/host/tool-assessment.test.ts` (fork cases)
- tool-assessment / Enforce removes → `tests/host/tool-assessment.test.ts`
- tool-assessment / Enforce grants → `tests/host/tool-assessment.test.ts`
- tool-assessment / Enforce grant the child cannot take → `tests/host/tool-assessment.test.ts`
- tool-assessment / Never adds → `tests/host/tool-assessment.test.ts`
- tool-assessment / Enforce in a fork → `tests/host/tool-assessment.test.ts` (fork cases)
- tool-assessment / Resumed worker → `tests/host/tool-assessment.test.ts`
- tool-assessment / Failed first call not retried → `tests/host/tool-assessment.test.ts`
- tool-assessment / Resumed fork keeps refusals → `tests/host/tool-assessment.test.ts` (fork cases)
- worker-decision / Resume → `tests/policy/worker/route.test.ts`
- worker-decision / Forked launch left alone → `tests/policy/worker/route.test.ts`
- worker-decision / Both fields locked → `tests/policy/worker/route.test.ts`
- worker-decision / Service launch with a model and locked thinking → `tests/policy/worker/route.test.ts`
- worker-decision / Forked thinking with thinking locked → `tests/policy/worker/route.test.ts`
- worker-decision / Slot alone with thinking locked → `tests/policy/worker/route.test.ts`
- worker-decision / Forked launch with thinking → `tests/policy/worker/route.test.ts`
- worker-decision / No tier offered → `tests/policy/worker/route.test.ts`
- worker-decision / No tier decided → `tests/policy/worker/route.test.ts`
- worker-decision / Slot below the bar with no tier → `tests/policy/worker/route.test.ts`
- worker-decision / No effort answer → `tests/policy/worker/route.test.ts`
- worker-decision / No tier decided with thinking locked → `tests/policy/worker/route.test.ts`
- worker-decision / Jev fails for a fork with thinking → `tests/policy/worker/route.test.ts`
- worker-routing / Display name prefix → `tests/host/worker-routing.test.ts`
- worker-routing / Slot display name → `tests/host/worker-routing.test.ts`
- worker-routing / Parent request off → `tests/host/worker-routing.test.ts`
- worker-routing / Forked launch with thinking asks fewer questions → `tests/host/worker-routing.test.ts`
- worker-routing / Service launch content → `tests/host/worker-routing.test.ts`
