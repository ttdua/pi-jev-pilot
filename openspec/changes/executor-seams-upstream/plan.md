# Vendored executor with explicit seams — Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md` (`openspec/changes/executor-seams-upstream/`).

**Goal:** Vendor `@gotgenes/pi-subagents` into `packages/pi-subagents/`, add launch identity, effective launch facts, an agent registry, `disallowed_tools`, a launch policy provider and checked tool grants to it, and move jev-pilot's worker routing and tool assessment onto those seams.

**Architecture:** The executor stays a separate Pi extension, loaded first from the same install. Its new seams live in new files under `packages/pi-subagents/src/seams/`, with thin call sites in upstream files, recorded in `VENDORED.md`. jev-pilot talks to it only through the published service and `pi.events`. The worker decision in `src/policy/` is unchanged; `src/host/worker/` changes from tool-call handlers to one launch policy.

**Tech Stack:** TypeScript; Bun (jev-pilot tests, workspace, lockfile); vitest, tsc and biome for the vendored package; Pi `@earendil-works/pi-coding-agent` 1.5.x; OpenSpec.

## Global Constraints

- Public Pi APIs only; fail open everywhere: a Jev, policy or executor failure leaves the launch as it would run without jev-pilot.
- `src/policy/` stays pure; only `src/host/` touches Pi or executor events.
- Never store prompt text, tool arguments or tool output; the ledger keeps its strict schema.
- Tests need no secrets, paid calls or network beyond loopback (`PI_OFFLINE=1`, fixture provider).
- Root `package.json` has no runtime `dependencies`; peers are exactly `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`, each `"*"`.
- `pi.extensions` is exactly `["./packages/pi-subagents/src/index.ts", "./src/extension.ts"]`.
- `src/` never imports `packages/` or `@ttdua/pi-subagents` at runtime; `import type` is allowed.
- Executor public identity unchanged: `Symbol.for("@gotgenes/pi-subagents:service")`, `subagents:*` event names, `subagent` tool name. New fields are optional.
- `RUBRIC_VERSION` stays `2`. `tools.grantAt` default `0.8`, range 0.5–1. Block threshold stays `0.5`. Total candidate cap `32`, block candidates first.
- Policy watchdog `timeoutMs` = 10000; Jev requests per launch bounded by `classifier.timeoutMs` read fresh.
- Every upstream file edited under `packages/pi-subagents/` is listed in `VENDORED.md` with a one-line reason.
- Function-size lint rules (`.oxlintrc.json`) apply to `src/`; follow `~/.agents/skills/coding-standards/SKILL.md`.
- Repository content in English.

## Review Focus

- A user who still has `@gotgenes/pi-subagents` installed upgrades: they expect a clear `/jev` problem and unchanged non-worker features, not a crash or silent double routing → Task 6 host test installs both packages in each load order.
- A background launch is queued behind the concurrency limit for longer than the classifier timeout: the policy must run at dequeue with a fresh deadline, not time out while queued → Task 4 unit test "queued launch consults policy only at dequeue, with a fresh signal".
- A main session reloads (`/reload`) while workers are running: the old policy must be unregistered and the new one registered; running children keep their tools → Task 7 test "re-register on reload with a running worker".
- An extension calls `spawn()` with `inheritContext: true` and an explicit model: model kept, `forkedLaunch` rules still apply → Task 7 test "service fork with explicit model".
- A granted tool name collides with an agent's declared `disallowed_tools` in another casing (`Bash` vs `bash`): tool names are case-sensitive in Pi; the executor must compare exactly and the debug note must not throw → Task 3 test "disallowed match is exact" (in `registry.test.ts`, via `finalToolNames` with a grant).

---

## Contracts

> Apply-time changes (operator decisions, 2026-11-11): service publication moved back to load time (guarded by `implementation`); child event identity fields optional in public types.

| Name | new / modified | Shape | public |
|---|---|---|---|
| `SubagentsService.registerLaunchPolicy` | new | `(policy: LaunchPolicy, options: { timeoutMs: number }) => () => void`; throws `Error("launch policy slot is taken")` when a policy is registered | yes |
| `LaunchPolicy` | new | `(request: LaunchRequest, signal: AbortSignal) => Promise<LaunchAdjustment \| undefined> \| LaunchAdjustment \| undefined` | yes |
| `LaunchRequest` | new | `{ agentId: string; agentType: string; agent: AgentTypeSnapshot; origin: { kind: "tool"; toolCallId: string } \| { kind: "service" }; parentSessionId?: string; prompt: string; description: string; requested: { model?: string; thinking?: ThinkingLevel }; locked: readonly LockableField[]; inheritContext: boolean; isBackground: boolean; toolSet: { declared: readonly string[] \| null; disallowed: readonly string[]; defaults: readonly string[]; parentTools: readonly string[] } }` (frozen) | yes |
| `LaunchAdjustment` | new | `{ model?: string; thinking?: ThinkingLevel; addTools?: readonly string[]; removeTools?: readonly string[] }` | yes |
| `SubagentsService.listAgentTypes` | new | `() => readonly AgentTypeSnapshot[]` | yes |
| `SubagentsService.getAgentType` | new | `(name: string) => AgentTypeSnapshot \| undefined` | yes |
| `AgentTypeSnapshot` | new | frozen `{ name: string; source: "builtin" \| "global" \| "project"; description: string; instructions: string; tools: readonly string[] \| null; defaultTools: readonly string[]; disallowedTools: readonly string[]; model?: string; thinking?: string; locked?: true \| readonly LockableField[]; maxTurns?: number; runInBackground?: boolean; inheritContext?: boolean }` | yes |
| `SubagentsService.implementation` / `.sessionId` | new | `readonly implementation: "@ttdua/pi-subagents"; readonly sessionId: string` (set at first `session_start`; `""` before) | yes |
| `SubagentRecord` | modified | adds optional `effectiveModel?: string` (`provider/id`), `effectiveThinking?: ThinkingLevel` | yes |
| `ChildSpawningEvent`, `ChildSessionCreatedEvent`, `ChildBoundEvent` | modified | add `agentId?: string; agentType?: string; toolCallId?: string` (optional in `dist/public.d.ts` per spec; the executor always sets `agentId` and `agentType` — operator decision during apply); `session-created` adds `effectiveModel?`, `effectiveThinking?`; `bound` adds `grantedTools?: readonly string[]` | yes |
| `subagents:created\|started\|completed\|failed\|resuming\|resumed` payloads | modified | add `toolCallId?: string` | yes |
| Agent frontmatter `disallowed_tools` | new | YAML list or comma-separated string of tool names | yes |
| `packages/pi-subagents/VENDORED.md` | new | sections `Upstream` (repo, path, tag, commit) and `Local changes` (table: file, kind `seam`/`edit`, reason) | no |
| Root `package.json` | modified | `workspaces: ["packages/pi-subagents"]`; `pi.extensions` as in Global Constraints; peers as in Global Constraints; script `test:executor`; no `@gotgenes/pi-subagents` | yes |
| Config key `tools.grantAt` | new | finite number 0.5–1, default 0.8 | yes |
| Ledger worker fields `effectiveModel`, `effectiveThinking`, `toolsGranted` | new | `model`, `level`, `count` domains | yes |
| `AgentFacts` (`src/policy/launch.ts`) | modified | adds `disallowedTools: readonly string[]`; `source` unchanged | no |
| `agentFacts(snapshot: AgentTypeSnapshot): AgentFacts` (`src/host/platform/agents.ts`) | new (replaces `readAgent`, `listAgents`) | pure mapper | no |
| `ExecutorState` (`src/host/platform/readiness.ts`) | new (replaces `executor: boolean` in `Snapshot`) | `{ kind: "present" } \| { kind: "absent" } \| { kind: "duplicate"; path?: string }` | no |
| `ToolPlan` (`src/policy/tools/assess.ts`) | new | `{ block: string[]; grant: string[] }`; `toolPlan(toolSet, exclusions): ToolPlan`; `grantedTools(answers, grant, grantAt): Set<string>` | no |
| `ToolCounts` (`src/policy/tools/assess.ts`, re-exported by `src/policy/worker/worker-line.ts`) | modified | adds `toolsGranted: number` | no |
| `WorkerLineInput` | modified | adds `effective?: { model?: string; thinking?: string }`; `toolCounts` returns `ToolCounts` with `toolsGranted` | no |
| `LaunchEntry` (`src/host/worker/entry.ts`) | modified | keyed by `agentId`; drops `seq`; adds `origin`; `launch` built from `LaunchRequest` | no |
| `grant::<name>` question | new | noul; wording in `docs/jev-questions.md` | no |
| `AgentConfig.toolsDeclared`, `AgentConfig.disallowedTools` (vendored `src/types.ts`) | new | `toolsDeclared: boolean`; `disallowedTools: string[]` | no |
| `AgentSpawnConfig.origin` (vendored) | new | `origin: { kind: "tool"; toolCallId: string } \| { kind: "service" }` | no |
| `LaunchPolicySlot` (vendored `src/seams/launch-policy.ts`) | new | `register(policy: LaunchPolicy, o: { timeoutMs: number }): () => void`; `consult(request: LaunchRequest, runSignal?: AbortSignal): Promise<LaunchAdjustment \| undefined>` | no |
| `finalToolNames` (vendored `src/seams/registry.ts`) | new | `(base: readonly string[], grants: readonly string[], disallowed: readonly string[]) => string[]` | no |
| `checkGrants` (vendored `src/seams/grant-check.ts`) | new | `(granted: readonly string[], childTools: readonly ToolInfo[]) => string[]`; dropped names removed with `session.setActiveToolsByName` | no |
| `dist/public.d.ts` (vendored) | modified | regenerated by `build:types`; exports `LaunchPolicy`, `LaunchRequest`, `LaunchAdjustment`, `AgentTypeSnapshot` and the extended `SubagentsService`, event and record types | yes |
| `VendoredService` (`src/host/tools/service.ts`) | new | `import type { SubagentsService } from "@ttdua/pi-subagents"`, narrowed to `implementation === "@ttdua/pi-subagents"` | no |
| `effectiveLaunch` (`src/policy/launch.ts`) | modified | `(request: { origin: LaunchRequest["origin"]; requested: LaunchRequest["requested"]; inheritContext: boolean; isBackground: boolean; locked: readonly LockableField[] }, facts: AgentFacts) => EffectiveLaunch`; `modelLocked` true when locked or `origin.kind === "service"` with `requested.model`; `resume` removed | no |
| `LaunchEntry.origin` | new | `LaunchRequest["origin"]` | no |
| `effectiveLaunch` input type (Task 7 apply) | modified | typed as the structural `LaunchRequestFacts` in `src/policy/launch.ts` (`requested.thinking` is `string`) instead of a `LaunchRequest` slice, so `src/policy/` stays free of executor types; a `LaunchRequest` satisfies it | no |
| `LaunchBook<E>` (`src/host/worker/launches.ts`, Task 7 apply) | modified | one map keyed by `agentId`: `remember`, `sessionCreated(agentId, effective)`, `bound(agentId, grantedTools)`, `settle(agentId)`, `pending`, `stop`, `clear`; tool-call keyed paths, buffering and order stamps removed | no |
| `WorkerRouting` (`src/host/worker/routing.ts`, Task 7 apply) | modified | adds `start(ctx)` (unregister, then register the policy), `stop()` (unregister) and `problems()` (`["launch policy held by another extension"]` when the slot was taken); `WorkerDeps` drops `agentDir`, adds `service` | no |
| `formatStatus` (`src/host/commands/status-format.ts`, Task 7 apply) | modified | optional 4th argument `extra: readonly string[]`, listed under `problems:`; `/jev` passes `routing.problems()` | no |
| `buildToolQuestions` (`src/jev/questions.ts`, Task 7 apply) | modified | `(block, grant)`: `tool::<name>` per block candidate, then `grant::<name>` per grant candidate | no |
| `ToolDecision`, `launchToolCounts` (`src/host/tools/counts.ts`, Task 7 apply) | new | replaces the process-wide counts map: the decision lives on the launch entry; `toolsGranted` counts `bound.grantedTools` in `enforce`, would-grant in `observe` | no |

---
## Task 1: Vendor the executor unchanged — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
**Difficulty:** Hard
**Blocked by:** none

**Files:**
- Create: `packages/pi-subagents/**` (subtree), `packages/pi-subagents/VENDORED.md`, `tests/vendoring.test.ts`, `tests/fixtures/executor-only/package.json`
- Modify: `package.json`, `bun.lock`, `bunfig.toml` (create), `NOTICE.md`, `.oxlintrc.json`, `.oxfmtrc.json`, `tsconfig.json`, `scripts/vendor-manifest.ts` (create), `packages/pi-subagents/tsconfig.json`, `.github/workflows/ci.yml`, `tests/import-graph.test.ts`, `tests/support/import-graph.ts`, `tests/manifest.test.ts`, `tests/load.test.ts`, `tests/ci.test.ts`, `tests/host/harness.ts`, `tests/host/harness.test.ts`, `packages/pi-subagents/package.json`

**Interfaces:**
- Produces: `bun run test:executor`; harness option `install: "checkout" | "executor-only"` in `tests/host/harness.ts`; `VENDORED.md` format (Contracts).

- [ ] **Step 1: Vendor.** In a temp clone of `https://github.com/gotgenes/pi-packages`, check out the tag of release `@gotgenes/pi-subagents@25.0.5`, run `git subtree split --prefix packages/pi-subagents -b split-25.0.5`; here run `git subtree add --prefix packages/pi-subagents <clone> split-25.0.5 --squash`. Expected: `packages/pi-subagents/src/index.ts` exists and `git diff <split> -- .` from the clone is empty.
- [ ] **Step 2: Write failing tests** in `tests/manifest.test.ts`: `pi.extensions` equals `["./packages/pi-subagents/src/index.ts","./src/extension.ts"]`; `peerDependencies` equals the four peers; no dependency field names `@gotgenes/pi-subagents`; `workspaces` contains `packages/pi-subagents`; vendored `name` is `@ttdua/pi-subagents`, `private` true. Extend "every imported host package is declared" to scan `packages/pi-subagents/src/` excluding `#src/` and type-only `@ttdua/pi-subagents`.
- [ ] **Step 3: Run** `bun test tests/manifest.test.ts`. Expected: FAIL on each new assertion.
- [ ] **Step 4: Edit manifests** (root and vendored `package.json`), delete `packages/pi-subagents/pnpm-lock.yaml`, change the vendored `lint` script to `biome check . && eslint .`, add root script `"test:executor": "bun run --cwd packages/pi-subagents check && bun run --cwd packages/pi-subagents test"` (the vendored `test` stays `vitest run`). Upstream devDependencies use `catalog:` versions defined in `pnpm-workspace.yaml` outside the subtree: replace each `catalog:` value in the vendored `package.json` with the exact version from that file at the same upstream tag, and list it as part of the `package.json` edit in `VENDORED.md`. Run `bun install`; expected: exit 0 with `vitest` resolvable from `packages/pi-subagents`.
- [ ] **Step 4b: Make the vendored tsconfig self-contained.** Upstream `packages/pi-subagents/tsconfig.json` extends `../../tsconfig.base.json`, which is outside the subtree: inline that base's `compilerOptions` from the same upstream tag into the vendored `tsconfig.json` and list it in `VENDORED.md` as an `edit`. Create root `bunfig.toml` with `[test] root = "tests"` so root `bun test` never discovers the vendored vitest files. Run `bun run test:executor`; expected: type check and vitest PASS.
- [ ] **Step 5: Run** `bun test tests/manifest.test.ts`. Expected: PASS.
- [ ] **Step 6a: Write failing `tests/vendoring.test.ts`**: `VENDORED.md` names `gotgenes/pi-packages`, `packages/pi-subagents`, tag and commit; `NOTICE.md` has an entry for `packages/pi-subagents` with `MIT`; "unlisted edit detected": for every file under `packages/pi-subagents/` whose git blob differs from the blob at the recorded split commit (read via `git ls-tree`/`git hash-object`, stored as `packages/pi-subagents/.upstream-manifest` — a list of `path sha` lines written in Step 7), the path appears in `VENDORED.md`'s Local changes table; else fail naming the file.
- [ ] **Step 6b: Run** `bun test tests/vendoring.test.ts`. Expected: FAIL (files missing).
- [ ] **Step 7: Write `VENDORED.md`, `.upstream-manifest` (generated by `bun scripts/vendor-manifest.ts <upstream-split-commit>`), and the `NOTICE.md` entry.** `VENDORED.md` records the squash commit id created by `git subtree add` as `Upstream tree commit`. Run `bun test tests/vendoring.test.ts`. Expected: PASS, with `package.json` and `tsconfig.json` listed as local edits.
- [ ] **Step 8: Scope jev-pilot checks.** Add `packages/**` to `.oxlintrc.json` `ignorePatterns` and to `.oxfmtrc.json` ignore patterns; keep `tsconfig.json` `include` as `src`, `tests`, `scripts` and add `packages` to `exclude`. In `tests/support/import-graph.ts`, `checkImport` returns a violation for a value import from `@ttdua/pi-subagents` or a path resolving under `packages/`; `moduleSpecifiers` ignores `import type`. Write fixtures `tests/fixtures/import-graph/src/host/bad-executor-runtime.ts` and `ok-executor-type.ts` and tests "Runtime import rejected", "Type import allowed" first; run `bun test tests/import-graph.test.ts`, expected FAIL; then change `checkImport`/`moduleSpecifiers`; run again, expected PASS.
- [ ] **Step 9: CI.** Add `- run: bun run test:executor` and `fetch-depth: 0` on checkout to `.github/workflows/ci.yml`; `tests/ci.test.ts` asserts the workflow runs both `test` and `test:executor`, and that `bun run lint` and `bun run typecheck` file lists contain no `packages/` path.
- [ ] **Step 10: Harness.** `tests/host/harness.ts` installs the checkout (`pi install <REPO_ROOT>`) by default; `install: "executor-only"` installs `tests/fixtures/executor-only/` whose manifest lists only `../../../packages/pi-subagents/src/index.ts`. Remove `EXECUTOR_DIR` from `node_modules/@gotgenes`. Update `tests/load.test.ts` "Installed checkout is loaded" for two extensions with no errors and `subagent` in tools.
- [ ] **Step 11: Checkpoint.** Run `bun run typecheck && bun run lint && bun run test && bun run test:executor`. Expected: all PASS with behavior unchanged (Q1–Q7 host tests still green). If the host load fails on `#src/*`, rewrite `#src/` imports in `packages/pi-subagents/src` to relative paths with a script, list it in `VENDORED.md` as one `edit` row, and re-run.
- [ ] **Step 12: Commit** `git commit -m "build: vendor @gotgenes/pi-subagents 25.0.5 into packages/pi-subagents"`.

---

## Task 2: Executor service identity, launch identity, effective facts — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4
**Difficulty:** Hard
**Blocked by:** Task 1

**Files:**
- Create: `packages/pi-subagents/src/seams/identity.ts`, `packages/pi-subagents/src/seams/service-identity.ts`, `packages/pi-subagents/test/seams/identity.test.ts`, `packages/pi-subagents/test/seams/service-identity.test.ts`
- Modify: `packages/pi-subagents/src/index.ts`, `src/service/service.ts`, `src/service/service-adapter.ts`, `src/lifecycle/child-lifecycle.ts`, `src/lifecycle/create-subagent-session.ts`, `src/lifecycle/subagent.ts`, `src/observation/subagent-events-observer.ts`, `src/types.ts`, `dist/public.d.ts` (regenerated) (all under `packages/pi-subagents/`), `packages/pi-subagents/VENDORED.md`

**Interfaces:**
- Produces: `SubagentsService.implementation`, `.sessionId`; event field additions and `SubagentRecord` fields (Contracts). `childSessionIds(): ReadonlySet<string>` in `seams/service-identity.ts`.

- [ ] **Step 1: Failing tests** `service-identity.test.ts`: "children do not replace the main service" (simulate main `session_start`, two child `session-created` + child `session_start` + `disposed`; the global slot stays the main service with `implementation` `@ttdua/pi-subagents`); "shutdown removes only its own service" (two instances; the second publishes; the first shuts down; slot still holds the second's).
- [ ] **Step 2: Run** `bun run test:executor`. Expected: FAIL.
- [ ] **Step 3: Implement** `seams/service-identity.ts`: record child ids from the instance's own `SUBAGENT_CHILD_SESSION_CREATED` emissions on a process-wide `Symbol.for("@ttdua/pi-subagents:children")` set; `publishIfMain(service, sessionId)` in `session_start`; `unpublishIfOwn(service)` at shutdown. Move the call sites in `index.ts` from load time to `session_start`/shutdown.
- [ ] **Step 4: Run** `bun run test:executor`. Expected: PASS.
- [ ] **Step 5: Failing tests** `identity.test.ts` for every `executor-launch-identity` scenario: tool-call launch (`toolCallId` `call_1`, `agentType` `Explore`); service launch (no `toolCallId`); completion and resume carry `toolCallId`; locked model wins in `effectiveModel`; queued record has neither effective field; existing upstream event tests unchanged.
- [ ] **Step 6: Implement** `seams/identity.ts`: `launchIdentity(record): { agentId; agentType; toolCallId? }`, used by the lifecycle publisher and the events observer; capture `effectiveModel` as `${model.provider}/${model.id}` and `effectiveThinking` from the created session, store them on the `Subagent` record and in `toSubagentRecord`.
- [ ] **Step 7: Run** `bun run test:executor`. Expected: PASS, including all pre-existing tests.
- [ ] **Step 8: Update `VENDORED.md`** (seam rows for the new files, edit rows for each touched upstream file); run `bun test tests/vendoring.test.ts`. Expected: PASS.
- [ ] **Step 9: Commit** `feat(executor): service identity, launch identity and effective launch facts`.

---

## Task 3: Executor agent registry and `disallowed_tools` — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4
**Difficulty:** Normal
**Blocked by:** Task 1, Task 2 (added: Tasks 2 and 3 both write `types.ts`, `service-adapter.ts`, `create-subagent-session.ts`, `service.ts` and `VENDORED.md` in the vendored package, so they run in sequence)

**Files:**
- Create: `packages/pi-subagents/src/seams/registry.ts`, `packages/pi-subagents/test/seams/registry.test.ts`
- Modify: `packages/pi-subagents/src/config/custom-agents.ts`, `src/config/agent-types.ts`, `src/config/default-agents.ts`, `src/types.ts`, `src/service/service.ts`, `src/service/service-adapter.ts`, `src/lifecycle/create-subagent-session.ts`, `dist/public.d.ts` (regenerated with `bun run --cwd packages/pi-subagents build:types`) (all under `packages/pi-subagents/`), `VENDORED.md`

**Interfaces:**
- Produces: `listAgentTypes()`, `getAgentType(name)`, `AgentTypeSnapshot`; `AgentConfig.disallowedTools: string[]`, `AgentConfig.toolsDeclared: boolean`.

- [ ] **Step 1: Failing tests** for every `executor-agent-registry` scenario, using temp `.pi/agents/` and agent dirs: project overrides built-in; case-insensitive `worker` → `Worker`; unknown → `general-purpose`; disabled → `undefined` and absent from list; new file picked up; built-in `Explore` snapshot (tools, empty disallowed, no locked, non-empty instructions); frozen snapshot (`Object.isFrozen` deep, push throws); absent `tools` → `tools: null`, `defaultTools` the seven built-ins; `disallowed_tools: bash` removes `bash` from the child allowlist; declared+disallowed `edit` absent with debug note; disallowed wins over policy grant (assert via the allowlist builder with a stub grant); comma string parses to `["bash","edit"]`; and Review Focus "disallowed match is exact" (`Bash` does not remove `bash`).
- [ ] **Step 2: Run** `bun run test:executor`. Expected: FAIL.
- [ ] **Step 3: Implement** parsing (`listField` reuse) and `toolsDeclared`; `seams/registry.ts`: `snapshotOf(config): AgentTypeSnapshot` (deep-frozen) and service methods calling `registry.reload()` then `resolveType`; `finalToolNames(base, grants, disallowed): string[]` applied last in `create-subagent-session.ts` before the recursion denylist.
- [ ] **Step 4: Run** `bun run test:executor`. Expected: PASS.
- [ ] **Step 5: Update `VENDORED.md`; run** `bun test tests/vendoring.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(executor): agent registry query and disallowed_tools`.

---

## Task 4: Executor launch policy and checked grants — implements 4

**Covers:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
**Difficulty:** Very Hard
**Blocked by:** Task 2, Task 3

**Files:**
- Create: `packages/pi-subagents/src/seams/launch-policy.ts`, `src/seams/launch-request.ts`, `src/seams/grant-check.ts`, `test/seams/launch-policy.test.ts`, `test/seams/grant-check.test.ts` (under `packages/pi-subagents/`)
- Modify: `packages/pi-subagents/src/lifecycle/subagent.ts`, `src/lifecycle/subagent-manager.ts`, `src/lifecycle/create-subagent-session.ts`, `src/service/service.ts`, `src/service/service-adapter.ts`, `src/tools/agent-tool.ts`, `src/types.ts`, `src/index.ts`, `dist/public.d.ts` (regenerated), `VENDORED.md`

**Interfaces:**
- Consumes: `AgentTypeSnapshot`, `finalToolNames` (Task 3); `launchIdentity` (Task 2).
- Produces: `registerLaunchPolicy`, `LaunchPolicy`, `LaunchRequest`, `LaunchAdjustment` (Contracts); `grantedTools` on `subagents:child:bound`.

- [ ] **Step 1: Failing tests** `launch-policy.test.ts` for every `executor-launch-policy` scenario except the three grant-check ones: one slot (second throws `launch policy slot is taken`; unregister frees); called once per tool and service launch, before `createSubagentSession` (spy order); queued launch called only at dequeue — plus Review Focus "queued launch consults policy only at dequeue, with a fresh signal"; never on resume; no policy → upstream behavior except `disallowed_tools`; request fields (`origin` tool `call_7`, `requested.model` after lock, `parentTools` without the five orchestration tools and without an excluded package's tool); adjustment rules (model/thinking applied; locked thinking kept with debug note; declared tool not removable; default tool removed; grant outside parent tools dropped); fail open on throw, on 1000 ms settle with `timeoutMs` 200 (session created after ≈200 ms, signal aborted), on `{ model: 42 }`; cancellation while consulting (abort the run signal during a pending policy: the policy's signal aborts at once, no session is created, the record ends `stopped` as upstream `abort()` does, and no `subagents:child:session-created` is emitted).
- [ ] **Step 2: Run** `bun run test:executor`. Expected: FAIL.
- [ ] **Step 3: Implement** `launch-policy.ts`: `class LaunchPolicySlot { register(policy, { timeoutMs }): () => void; consult(request): Promise<LaunchAdjustment | undefined> }` with `Promise.race` against the watchdog and the run signal, and one `AbortController` aborted by either; `validAdjustment(value): LaunchAdjustment | undefined`.
- [ ] **Step 4: Implement** `launch-request.ts`: `buildLaunchRequest(record, snapshot, origin, requested, parentTools, excludedPackages): LaunchRequest` (frozen). Thread `origin` from `AgentTool.execute` (`toolCallId`) and `SubagentsServiceAdapter.spawn` (`service`) into `AgentSpawnConfig`.
- [ ] **Step 5: Call site.** In `Subagent`'s start path (after the limiter releases, before `createSubagentSession`), `await slot.consult(request, runSignal)`, check `runSignal.aborted` again before creating the session, and pass `applyAdjustment(request, adjustment): { model?; thinking?; toolNames: string[] }` into the session params; built-ins for granted names load via `builtinExtensionsFor`.
- [ ] **Step 6: Run** `bun run test:executor`. Expected: PASS.
- [ ] **Step 7: Failing tests** `grant-check.test.ts`: grant of a tool the child does not register → dropped, absent from `grantedTools`; grant of a tool whose exposure is not model-callable → dropped; grant registered and callable → in `grantedTools`; the executor never changes exposure; each case asserts the child's active tool names (dropped grants absent, default and declared tools still present), not only the `grantedTools` payload.
- [ ] **Step 8: Implement** `grant-check.ts`: `checkGrants(granted, childTools: ToolInfo[]): string[]` run after `bindExtensions()` and before emitting `bound`; compute `dropped = granted − kept` and call `session.setActiveToolsByName(session.getActiveToolNames().filter((n) => !dropped.includes(n)))`, so default and declared tools stay; emit `bound` with `grantedTools`.
- [ ] **Step 9: Run** `bun run test:executor`. Expected: PASS.
- [ ] **Step 10: Update `VENDORED.md`; run** `bun test tests/vendoring.test.ts`. Expected: PASS.
- [ ] **Step 11: Commit** `feat(executor): launch policy provider with checked tool grants`.

---

## Task 5: jev-pilot config, ledger schema, agent facts — implements 5

**Covers:** 5.1, 5.2, 5.3, 5.4, 5.5
**Difficulty:** Normal
**Blocked by:** Task 1, Task 3 (added: `agentFacts` and `capabilities.subagents` consume `AgentTypeSnapshot` and `listAgentTypes`)

**Files:**
- Create: `tests/host/platform/agent-facts.test.ts`
- Modify: `src/host/tools/service.ts`, `tests/host/tools/service.test.ts`, `src/store/config.ts`, `src/store/settings-sections.ts`, `src/store/settings.ts`, `src/store/defaults.ts`, `src/store/ledger-schema.ts`, `src/policy/launch.ts`, `src/host/platform/agents.ts`, `src/host/platform/index.ts`, `src/host/setup.ts`, `src/jev/state.ts`, `tests/store/config-read.test.ts`, `tests/store/settings.test.ts`, `tests/store/ledger-schema.test.ts`, `tests/jev/state.test.ts`

**Interfaces:**
- Consumes: `AgentTypeSnapshot`, `SubagentsService` as `import type` from `@ttdua/pi-subagents` (Contracts).
- Produces: `settings.tools.grantAt: number`; ledger fields; `agentFacts(snapshot)`; `AgentFacts.disallowedTools`; `VendoredService` (Contracts) and `mainService(): VendoredService | undefined`, capturing only a service with `implementation === "@ttdua/pi-subagents"`.

**Transitional exception (5.3):** `agentFacts` is added and used for `capabilities.subagents` here; the file reader `readAgent` and the built-in table stay until Task 7, whose rewrite removes their two remaining callers (`src/host/worker/classify.ts`, `src/host/tools/assessment.ts`). Checkbox 5.3 is ticked when Task 7 deletes them.

- [ ] **Step 1: Failing tests:** `service.test.ts`: a published object without `implementation` `@ttdua/pi-subagents` is not captured; config "Grant cut accepted" (`0.9` valid) and "Grant cut out of range" (`0.3`, `"high"` → problem at `tools.grantAt`); settings "Everything defaulted" includes `tools.grantAt` `0.8`, "Grant cut from config"; ledger "Worker line with effective launch fields accepted", "Bad effective thinking rejected" (`huge` → issue at `effectiveThinking`), exported worker field set includes the three new names; agent facts for "Built-in Explore", "Long instructions", "Disallowed tools carried", "Model never read out" (serialize facts, assert neither value appears), "Invalid thinking is not set"; main state "No executor" (`capabilities.subagents` empty).
- [ ] **Step 2: Run** `bun test tests/store tests/host/platform/agent-facts.test.ts tests/jev/state.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the `mainService` capture rule and `VendoredService` type; the config rule and default; schema entries (`effectiveModel` → model domain, `effectiveThinking` → level, `toolsGranted` → count); `agentFacts(snapshot: AgentTypeSnapshot): AgentFacts` next to the existing reader; `capabilities.subagents` from `mainService()?.listAgentTypes()` mapped through `agentFacts`, `[]` on absence or throw, replacing the `listAgents` call in `src/host/setup.ts`. `readAgent` stays until Task 7 removes its last callers; both its built-in table and its file mapper (`factsOf`) set `disallowedTools: []` so `AgentFacts` type-checks.
- [ ] **Step 4: Run** `bun run typecheck && bun run test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: grant cut setting, effective launch ledger fields, agent facts from the executor`.

---

## Task 6: jev-pilot readiness and duplicate detection — implements 6

**Covers:** 6.1, 6.2, 6.3
**Difficulty:** Normal
**Blocked by:** Task 2, Task 5

**Files:**
- Create: `tests/host/duplicate-executor.test.ts`
- Modify: `src/host/platform/readiness.ts`, `src/host/commands/status-format.ts` (lines using `s.executor`), `src/host/worker/handlers.ts` (the one `!snap.executor` gate, which Task 7 later deletes), `tests/host/platform/readiness.test.ts`, `tests/host/commands/jev.test.ts`

**Interfaces:**
- Consumes: `SubagentsService.implementation` (Task 2); `mainService` (Task 5).
- Produces: `ExecutorState`, `executorState(tools: readonly ToolInfo[], published: unknown, captured: unknown): ExecutorState`; `Snapshot.executor: ExecutorState`.

- [ ] **Step 1: Failing unit tests** in `readiness.test.ts` for the pure `executorState`: installed → present; no `subagent` → absent; winning tool's `sourceInfo.path` outside `packages/pi-subagents/` → duplicate with path; published service `implementation` other than `@ttdua/pi-subagents` → duplicate. In `jev.test.ts`: "Duplicate executor reported" text contains `duplicate executor`, the path, `uninstall @gotgenes/pi-subagents`, and that routing and tool assessment are off.
- [ ] **Step 2: Run** `bun test tests/host/platform/readiness.test.ts tests/host/commands/jev.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `executorState` and wire it into `buildSnapshot`; status formatting for the new state; the three existing boolean checks (`status-format.ts:44`, `status-format.ts:54`, `handlers.ts:35`) become `executor.kind === "present"`.
- [ ] **Step 4: Run** `bun run test`. Expected: PASS.
- [ ] **Step 5: Host test** `duplicate-executor.test.ts`: install the checkout plus a fixture copy of the original executor in both orders. The fixture is built offline at test time with `git archive <Upstream tree commit from VENDORED.md>` (the squash commit holds the unmodified upstream tree at its root) into a temp dir, with its `package.json` `name` set to `@gotgenes/pi-subagents`; CI checkout uses `fetch-depth: 0` so the commit exists; `/jev` reports `duplicate executor` in each; a third case with the checkout only spawns and disposes two workers, then `/jev` reports the executor present.
- [ ] **Step 6: Run** `bun test tests/host/duplicate-executor.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** `feat: three-state executor readiness with duplicate detection`.

---

## Task 7: jev-pilot routing and tool assessment through the launch policy — implements 7

**Covers:** 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
**Difficulty:** Very Hard
**Blocked by:** Task 4, Task 5, Task 6

**Files:**
- Create: `src/host/worker/policy.ts`, `src/host/worker/request.ts`, `src/host/worker/outcomes.ts`, `src/host/tools/plan.ts`, `tests/host/worker/policy.test.ts`, `tests/host/tools/policy-assessment.test.ts`
- Modify: `src/host/worker/classify.ts`, `src/host/worker/route.ts`, `src/host/worker/entry.ts`, `src/host/worker/launches.ts`, `src/host/worker/routing.ts`, `src/host/worker/index.ts`, `src/host/tools/assessment.ts`, `src/host/tools/counts.ts`, `src/host/tools/index.ts`, `src/host/setup.ts`, `src/host/wiring/session.ts`, `src/policy/launch.ts`, `src/policy/tools/assess.ts`, `src/policy/tools/index.ts`, `src/policy/worker/worker-line.ts`, `src/policy/worker/route.ts`, `src/jev/questions.ts`, `src/jev/state.ts`, `docs/jev-questions.md`, tests under `tests/host/worker/`, `tests/host/tools/`, `tests/host/worker-ledger.test.ts`, `tests/policy/tools/assess.test.ts`, `tests/policy/worker/route.test.ts`, `tests/policy/worker/worker-line.test.ts`, `tests/jev/questions.test.ts`, `tests/load.test.ts`
- Delete (completes 5.3): `src/host/worker/handlers.ts` (tool-call paths), `tests/host/worker/launches.test.ts` cases keyed by tool call id, `readAgent`/`listAgents` and the built-in table in `src/host/platform/agents.ts`, `tests/host/platform/agents.test.ts`, `tests/host/platform/agents-parse.test.ts`

**Interfaces:**
- Consumes: `registerLaunchPolicy`, `LaunchRequest`, `LaunchAdjustment` (Task 4); `ExecutorState`, `mainService` (Task 6); `agentFacts`, `settings.tools.grantAt` (Task 5).
- Produces: `createWorkerPolicy(host: WorkerHost): LaunchPolicy`; `planTools(request, settings): ToolPlan`; `toolPlan`, `grantedTools` (Contracts); `effectiveLaunch(request: LaunchRequest, facts: AgentFacts): EffectiveLaunch` with `modelLocked` true for a service launch naming a model.

- [ ] **Step 1: Failing policy-layer tests** in `tests/policy/tools/assess.test.ts`: every `tool-assessment` scenario mapped there below (candidates, exclusions, total cap 32 with 7 block + 30 grant → 7 + 25, thresholds `tool::` ≥ 0.5 and `grant::` ≥ `grantAt`); `tests/jev/questions.test.ts`: `grant::web_search` noul present with the `docs/jev-questions.md` wording, `RUBRIC_VERSION` is `2`; `tests/policy/worker/route.test.ts`: "Service launch naming a model", "Service launch with a model", "Service launch with a model and locked thinking", "Resume" (no route computed); `worker-line.test.ts`: effective fields and `toolsGranted` written.
- [ ] **Step 2: Run** `bun test tests/policy tests/jev`. Expected: FAIL.
- [ ] **Step 3: Implement** pure parts: `toolPlan(toolSet, never): ToolPlan`, `grantedTools(answers, grant, grantAt)`, `toolCounts` with `toolsGranted`; `buildToolQuestions(block, grant)`; `effectiveLaunch(request, facts)` replacing the input-based version (resume removed); `WorkerLineInput.effective`.
- [ ] **Step 4: Run** `bun test tests/policy tests/jev`. Expected: PASS.
- [ ] **Step 5: Failing host-layer tests** `tests/host/worker/policy.test.ts` with a fake service (records `registerLaunchPolicy`, invokes the policy with built `LaunchRequest`s) for every `worker-routing` scenario mapped there below, plus Review Focus "re-register on reload with a running worker" and "service fork with explicit model"; `tests/host/tools/policy-assessment.test.ts` for the `tool-assessment` host scenarios mapped there (gates, routing off but assessment on, concurrent requests with one deadline — fake `ask` records start times, fresh `classifier.timeoutMs`, observe vs enforce adjustment, fail open, counts keyed by `agentId`); `tests/host/worker-ledger.test.ts` unit cases joined by `agentId` (resume writes no line, pre-policy refusal no line, post-policy failure `error` line, concurrent workers in reverse completion order).
- [ ] **Step 6: Run** `bun test tests/host/worker tests/host/tools tests/host/worker-ledger.test.ts`. Expected: FAIL.
- [ ] **Step 7: Implement** `policy.ts`: `createWorkerPolicy(host)` — gate (fresh snapshot, `executor.kind === "present"`), skip child-originated (`isChild(request.parentSessionId)`), build facts and entry, start the worker request (`classify.ts` now takes `LaunchRequest`) and the tool request (`tools/plan.ts`) concurrently with one `AbortSignal.timeout(classifier.timeoutMs)`, await both, route (`route.ts` returns `{ model?, thinking? }` instead of mutating input), merge with `{ addTools, removeTools }` in enforce, remember the entry by `agentId`, return the adjustment. Wrap everything in fail-open.
- [ ] **Step 8: Implement** `outcomes.ts`: subscribe `subagents:child:session-created` (effective fields), `subagents:child:bound` (`grantedTools`), `subagents:completed|failed`; write one line per remembered `agentId` when the outcome arrives; `launches.ts` keyed by `agentId` only.
- [ ] **Step 9: Implement** registration in `routing.ts`/`wiring/session.ts`: at main `session_start` after `captureMainService`, unregister any previous then `registerLaunchPolicy(createWorkerPolicy(host), { timeoutMs: 10000 })`; on throw set a "policy slot taken" problem shown by `/jev`; unregister at `session_shutdown`.
- [ ] **Step 10: Remove** `message_end`, `tool_call`, `tool_result` subscriptions and the child-side assessment path; keep the child `before_agent_start` guard hiding `jev_review`; update `tests/load.test.ts` "Loaded extension registers only /jev and handlers" to the six handlers.
- [ ] **Step 11: Run** `bun run typecheck && bun run lint && bun run test`. Expected: PASS.
- [ ] **Step 12: Commit** `feat: route workers and assess tools through the executor launch policy`.

---

## Task 8: Host evidence and end-to-end checks — implements 8

**Covers:** 8.1, 8.2, 8.3, 8.4
**Difficulty:** Hard
**Blocked by:** Task 7

**Files:**
- Create: `tests/host/launch-policy-evidence.test.ts`, `tests/host/probes/policy/` (probe extension registering a test policy and a probe tool)
- Modify: `tests/host/evidence.test.ts`, `tests/host/q3-q4-child.test.ts`, `tests/host/worker-routing.test.ts`, `tests/host/worker-ledger.test.ts`, `tests/host/tool-assessment.test.ts`, `docs/evidence/2026-11-05-host-seams.md`
- Delete: `tests/host/q1-q7-worker-mutation.test.ts`, `tests/host/q2-message-end-order.test.ts`, `tests/host/probes/rewrite/`, `tests/host/probes/ordering/`

**Interfaces:**
- Consumes: everything above through a real install.

- [ ] **Step 1: Failing host tests** in `launch-policy-evidence.test.ts` (fixture provider, `install: "executor-only"` plus the policy probe for seam evidence; checkout install for jev-pilot paths): policy model/thinking reaches the child for foreground, background, service and inherited-context (marker present) launches; locked field wins; watchdog timeout falls open; grant of the probe tool is listed and its scripted call executes; `disallowed_tools` wins over a grant; "Published before capture" on start and reload; jev-pilot routed launch's ledger `effectiveModel` equals the child's first request `model`; enforce removes and grants; slow answers in observe and enforce; resumed worker not reassessed; Jev down in enforce keeps default tools.
- [ ] **Step 2: Run** `bun test tests/host/launch-policy-evidence.test.ts`. Expected: FAIL (probe missing).
- [ ] **Step 2b: Write the probe** `tests/host/probes/policy/index.ts`: reads a scripted adjustment from an env-provided JSON file, registers it with `getSubagentsService().registerLaunchPolicy` at `session_start`, registers tool `probe_tool` returning a fixed string, and calls `spawn()` when the fixture scripts a `/probe-spawn` command.
- [ ] **Step 2c: Run** the same command. Expected: PASS.
- [ ] **Step 3: Retire** Q1, Q2, Q7 tests and their probes; `evidence.test.ts` asserts Q1, Q2, Q7 are marked superseded with links, Q3–Q6 still pinned; update the evidence report.
- [ ] **Step 4: End-to-end run** (manual-equivalent scripted host test in the same file, `describe("e2e")`): one session with a routed tool launch, a service `spawn` from the probe, an enforce-mode grant, `/jev` output captured, and the resulting ledger lines validated against the schema with no prompt marker.
- [ ] **Step 5: Run** `bun run test`. Expected: PASS.
- [ ] **Step 6: Commit** `test: host evidence for the launch policy; retire Q1, Q2 and Q7`.

---

## Task 9: Documentation and release notes — implements 9

**Covers:** 9.1, 9.2, 9.3, 9.4
**Difficulty:** Easy
**Blocked by:** Task 7

**Files:**
- Create: `docs/decisions/0009-vendored-executor.md`
- Modify: `docs/decisions/0006-gotgenes-executor.md`, `docs/decisions/README.md`, `docs/architecture.md`, `docs/domain-model.md`, `docs/workflow.md`, `docs/jev-contract.md`, `docs/glossary.md`, `docs/testing.md`, `docs/roadmap.md`, `docs/project-brief.md`, `docs/usage-guide.md`, `docs/configuration.md`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1:** Write ADR 0009 (context: seams upstream will not provide; decision: vendored executor with seams; consequences: subtree sync, maintenance cost, users uninstall the original, duplicate detection limit). Mark 0006 `Superseded by 0009`; update the decisions index.
- [ ] **Step 2:** Update the host seams table (launch policy, identity events, registry, grant check; Q1/Q2/Q7 superseded), runtime contexts and module map in `docs/architecture.md`; tool assessment and routing flows in `docs/workflow.md`, `docs/domain-model.md`, `docs/jev-contract.md`; new terms (launch policy, grant, block candidate) in `docs/glossary.md`; harness and `test:executor` in `docs/testing.md`; roadmap and brief lines naming ADR 0006.
- [ ] **Step 3:** `README.md` install: one `pi install`; remove the `@gotgenes/pi-subagents` line; add "uninstall `@gotgenes/pi-subagents` first". `docs/usage-guide.md` and `docs/configuration.md`: `disallowed_tools`, `tools.grantAt`, the duplicate-executor limit.
- [ ] **Step 4:** `CHANGELOG.md` entry under Unreleased with a **Breaking** line.
- [ ] **Step 5: Verify** `rg -n "@gotgenes/pi-subagents" README.md docs | rg -v "0006|0009|uninstall|evidence"` prints nothing; `bun run test` (docs link tests) PASS.
- [ ] **Step 6: Commit** `docs: vendored executor, launch policy and tool grants`.

---

## Scenario → test

- `agent-metadata` / Built-in Explore → `tests/host/platform/agent-facts.test.ts`
- `agent-metadata` / Long instructions → `tests/host/platform/agent-facts.test.ts`
- `agent-metadata` / Disallowed tools carried → `tests/host/platform/agent-facts.test.ts`
- `agent-metadata` / Model never read out → `tests/host/platform/agent-facts.test.ts`
- `agent-metadata` / Invalid thinking is not set → `tests/host/platform/agent-facts.test.ts`
- `config-file` / Duplicate hold provider → `tests/store/config-read.test.ts`
- `config-file` / Hold provider bounds → `tests/store/config-read.test.ts`
- `config-file` / Non-boolean parentRequest → `tests/store/config-read.test.ts`
- `config-file` / Enum values → `tests/store/config-read.test.ts`
- `config-file` / CLI review enabled accepted → `tests/store/config-read.test.ts`
- `config-file` / Non-boolean review.enabled → `tests/store/config-read.test.ts`
- `config-file` / Forked launch setting accepted → `tests/store/config-read.test.ts`
- `config-file` / Forked launch setting rejected → `tests/store/config-read.test.ts`
- `config-file` / Grant cut accepted → `tests/store/config-read.test.ts`
- `config-file` / Grant cut out of range → `tests/store/config-read.test.ts`
- `decision-ledger` / Valid main line accepted → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Valid worker line accepted → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Worker line with cut-point fields accepted → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Older worker line still accepted → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Valid correction line accepted → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Unknown kind rejected → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Field from another kind rejected → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Missing required field rejected → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Exported field sets match the table → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Unknown agent value is still an identifier → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Worker line with effective launch fields accepted → `tests/store/ledger-schema.test.ts`
- `decision-ledger` / Bad effective thinking rejected → `tests/store/ledger-schema.test.ts`
- `executor-agent-registry` / Project file overrides a built-in → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / Case-insensitive name → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / Unknown name → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / Disabled agent → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / New file picked up → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / Built-in Explore → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / Snapshot is detached → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / Absent tools kept distinct from defaults → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / Default tool denied → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / Denied wins over declared → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / Denied wins over a grant → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-agent-registry` / Snapshot lists denied tools → `packages/pi-subagents/test/seams/registry.test.ts`
- `executor-launch-identity` / Tool-call launch → `packages/pi-subagents/test/seams/identity.test.ts`
- `executor-launch-identity` / Service launch → `packages/pi-subagents/test/seams/identity.test.ts`
- `executor-launch-identity` / Completion of a tool-call launch → `packages/pi-subagents/test/seams/identity.test.ts`
- `executor-launch-identity` / Resume from a tool call → `packages/pi-subagents/test/seams/identity.test.ts`
- `executor-launch-identity` / Model rewritten by the policy → `packages/pi-subagents/test/seams/identity.test.ts + tests/host/launch-policy-evidence.test.ts (host)`
- `executor-launch-identity` / Locked model wins → `packages/pi-subagents/test/seams/identity.test.ts`
- `executor-launch-identity` / Queued record → `packages/pi-subagents/test/seams/identity.test.ts`
- `executor-launch-identity` / Upstream consumer unaffected → `packages/pi-subagents/test/seams/identity.test.ts`
- `executor-launch-policy` / Second registration refused → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Unregister frees the slot → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Tool-call launch → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Service launch → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Queued launch → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Resume → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / No policy registered → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Tool-call origin → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Orchestration tools never offered → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Excluded extension's tool not offered → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Locked caller value not requested → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Model and thinking applied → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Locked field kept → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Extension tool granted → `packages/pi-subagents/test/seams/launch-policy.test.ts + tests/host/launch-policy-evidence.test.ts (host)`
- `executor-launch-policy` / Declared tool not removable → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Default tool removed → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Grant outside the parent's tools dropped → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Grant of a tool the child cannot load → `packages/pi-subagents/test/seams/grant-check.test.ts`
- `executor-launch-policy` / Grant of a hidden tool → `packages/pi-subagents/test/seams/grant-check.test.ts`
- `executor-launch-policy` / Grant that took effect → `packages/pi-subagents/test/seams/grant-check.test.ts`
- `executor-launch-policy` / Policy throws → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Policy too slow → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-launch-policy` / Malformed adjustment → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- `executor-vendoring` / Workspace member → `tests/vendoring.test.ts`
- `executor-vendoring` / Not confused with the published package → `tests/vendoring.test.ts`
- `executor-vendoring` / Initial provenance → `tests/vendoring.test.ts`
- `executor-vendoring` / Unlisted edit detected → `tests/vendoring.test.ts`
- `executor-vendoring` / Notice entry → `tests/vendoring.test.ts`
- `executor-vendoring` / Both extensions loaded from one install → `tests/load.test.ts`
- `executor-vendoring` / Executor suite runs from the root → `tests/ci.test.ts`
- `executor-vendoring` / jev-pilot checks skip the vendored tree → `tests/ci.test.ts`
- `executor-vendoring` / Runtime import rejected → `tests/import-graph.test.ts`
- `executor-vendoring` / Type import allowed → `tests/import-graph.test.ts`
- `executor-vendoring` / Children do not replace the main service → `packages/pi-subagents/test/seams/service-identity.test.ts`
- `executor-vendoring` / Published before capture → `tests/host/launch-policy-evidence.test.ts`
- `executor-vendoring` / Shutdown removes only its own service → `packages/pi-subagents/test/seams/service-identity.test.ts`
- `host-seam-evidence` / Policy model reaches the child → `tests/host/launch-policy-evidence.test.ts`
- `host-seam-evidence` / Inherited context with a policy model → `tests/host/launch-policy-evidence.test.ts`
- `host-seam-evidence` / Grant reaches the child → `tests/host/launch-policy-evidence.test.ts`
- `host-seam-evidence` / Changed host behavior fails the test → `tests/host/evidence.test.ts`
- `host-seam-evidence` / Every question answered or marked unsettled → `tests/host/evidence.test.ts`
- `host-seam-evidence` / Superseded questions kept → `tests/host/evidence.test.ts`
- `host-test-harness` / No published executor dependency → `tests/manifest.test.ts`
- `host-test-harness` / Lockfile matches → `tests/ci.test.ts`
- `host-test-harness` / Executor installs offline → `tests/host/harness.test.ts`
- `host-test-harness` / Executor and probe are loaded → `tests/host/harness.test.ts`
- `jev-command` / Default status → `tests/host/commands/jev.test.ts`
- `jev-command` / Directory mode in the report → `tests/host/commands/jev.test.ts`
- `jev-command` / Malformed directory mode reported → `tests/host/commands/jev.test.ts`
- `jev-command` / CLI review default shown → `tests/host/commands/jev.test.ts`
- `jev-command` / No executor → `tests/host/commands/jev.test.ts`
- `jev-command` / Key name, never value → `tests/host/commands/jev.test.ts`
- `jev-command` / Malformed state reported → `tests/host/commands/jev.test.ts`
- `jev-command` / Invalid config reported → `tests/host/commands/jev.test.ts`
- `jev-command` / Malformed tuning reported → `tests/host/commands/jev.test.ts`
- `jev-command` / Empty tally → `tests/host/commands/jev.test.ts`
- `jev-command` / Tally after work → `tests/host/commands/jev.test.ts`
- `jev-command` / Mix with a full window → `tests/host/commands/jev.test.ts`
- `jev-command` / Budget target shown → `tests/host/commands/jev.test.ts`
- `jev-command` / Mix while the seed applies → `tests/host/commands/jev.test.ts`
- `jev-command` / Empty window → `tests/host/commands/jev.test.ts`
- `jev-command` / No mix without the executor → `tests/host/commands/jev.test.ts`
- `jev-command` / Duplicate executor reported → `tests/host/commands/jev.test.ts + tests/host/duplicate-executor.test.ts (host)`
- `main-state` / First sentence → `tests/jev/state.test.ts`
- `main-state` / Caps → `tests/jev/state.test.ts`
- `main-state` / Agent caps → `tests/jev/state.test.ts`
- `main-state` / No executor → `tests/jev/state.test.ts`
- `package-loading` / Manifest names both entry points → `tests/manifest.test.ts`
- `package-loading` / Host package is a peer, not bundled → `tests/manifest.test.ts`
- `package-loading` / Every imported host package is declared → `tests/manifest.test.ts`
- `package-loading` / Installed checkout is loaded → `tests/load.test.ts`
- `package-loading` / A failing entry point is not reported as loaded → `tests/load.test.ts`
- `package-loading` / Loaded extension registers only /jev and handlers → `tests/load.test.ts`
- `readiness-checks` / Executor installed → `tests/host/platform/readiness.test.ts`
- `readiness-checks` / Executor absent → `tests/host/platform/readiness.test.ts`
- `readiness-checks` / Original loaded first → `tests/host/duplicate-executor.test.ts (host)`
- `readiness-checks` / Original loaded last → `tests/host/duplicate-executor.test.ts (host)`
- `readiness-checks` / Present after children → `tests/host/duplicate-executor.test.ts (host)`
- `settings-resolution` / Everything defaulted → `tests/store/settings.test.ts`
- `settings-resolution` / Config over default → `tests/store/settings.test.ts`
- `settings-resolution` / Tuning over config → `tests/store/settings.test.ts`
- `settings-resolution` / Forked launch from config → `tests/store/settings.test.ts`
- `settings-resolution` / Grant cut from config → `tests/store/settings.test.ts`
- `tool-assessment` / Grant threshold boundary → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / Rubric version unchanged → `tests/jev/questions.test.ts`
- `tool-assessment` / Invalid grant answer → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / Declared tools kept → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / Disallowed tool never offered → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / Orchestration and review tools excluded → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / Switch off → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / No key → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Invalid config → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Executor absent → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Main session → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Routing off, assessment on → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Mode read once → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Default and grant candidates → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / Declared agent has only grant candidates → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / Protocol tools never candidates → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / Review tool never a candidate → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / Cap at 32 → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / One noul per candidate → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Tool metadata from Pi → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Long tool description → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Concurrent with routing → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Long brief → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Forked worker → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Empty prompt → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Brief not stored → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Slow answer in observe → `tests/host/launch-policy-evidence.test.ts (host)`
- `tool-assessment` / Slow answer in enforce → `tests/host/launch-policy-evidence.test.ts (host)`
- `tool-assessment` / Threshold boundary → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / One bad answer → `tests/policy/tools/assess.test.ts`
- `tool-assessment` / Observe keeps tools → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Enforce removes → `tests/host/launch-policy-evidence.test.ts (host)`
- `tool-assessment` / Enforce grants → `tests/host/launch-policy-evidence.test.ts (host)`
- `tool-assessment` / Enforce grant the child cannot take → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Never adds → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Resumed worker → `tests/host/launch-policy-evidence.test.ts (host)`
- `tool-assessment` / Failed first call not retried → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Jev down in enforce → `tests/host/launch-policy-evidence.test.ts (host)`
- `tool-assessment` / Timeout → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Malformed response → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / Counts on the line → `tests/host/tools/policy-assessment.test.ts`
- `tool-assessment` / No worker line → `tests/host/tools/policy-assessment.test.ts`
- `worker-decision` / Resume → `tests/policy/worker/route.test.ts`
- `worker-decision` / Forked launch left alone → `tests/policy/worker/route.test.ts`
- `worker-decision` / Both fields locked → `tests/policy/worker/route.test.ts`
- `worker-decision` / Service launch with a model and locked thinking → `tests/policy/worker/route.test.ts`
- `worker-decision` / Forked thinking with thinking locked → `tests/policy/worker/route.test.ts`
- `worker-decision` / Slot alone with thinking locked → `tests/policy/worker/route.test.ts`
- `worker-decision` / Locked flag → `tests/policy/worker/route.test.ts`
- `worker-decision` / Locked untouched launch → `tests/policy/worker/route.test.ts`
- `worker-decision` / No lock → `tests/policy/worker/route.test.ts`
- `worker-decision` / Service launch naming a model → `tests/policy/worker/route.test.ts`
- `worker-decision` / Model locked → `tests/policy/worker/route.test.ts`
- `worker-decision` / Model locked without a decided tier → `tests/policy/worker/route.test.ts`
- `worker-decision` / Thinking locked → `tests/policy/worker/route.test.ts`
- `worker-decision` / Model locked with a slot decided → `tests/policy/worker/route.test.ts`
- `worker-decision` / Service launch with a model → `tests/policy/worker/route.test.ts`
- `worker-ledger` / Routed launch recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Not running means no line → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Cancelled turn → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Resume writes no line → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Foreground completion → `tests/host/worker-ledger.test.ts (host)`
- `worker-ledger` / Background completion → `tests/host/worker-ledger.test.ts (host)`
- `worker-ledger` / Failed worker → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Refused launch → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Effective values joined → `tests/host/worker-ledger.test.ts (host)`
- `worker-ledger` / Concurrent workers joined correctly → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Service launch recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Routed fields → `tests/policy/worker/worker-line.test.ts`
- `worker-ledger` / Expert offered recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Expert switched off recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Fallback recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Nothing could run recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Thinking-only recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Miss recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Untouched recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Tier asked, nothing decided → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / No expert needed field → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Locked recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Not locked → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / No prompt text → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Mode recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Tool counts recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / No assessment, no counts → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Resumed launch carries no counts → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Slot decision recorded → `tests/host/worker-ledger.test.ts`
- `worker-ledger` / Slot fallback recorded → `tests/host/worker-ledger.test.ts`
- `worker-routing` / Registered at session start → `tests/host/launch-policy-evidence.test.ts (host)`
- `worker-routing` / Re-registered after reload → `tests/host/launch-policy-evidence.test.ts (host)`
- `worker-routing` / Launch from a worker → `tests/host/worker/policy.test.ts`
- `worker-routing` / Service launch with an explicit model → `tests/host/worker/policy.test.ts`
- `worker-routing` / Service launch without a model → `tests/host/worker/policy.test.ts`
- `worker-routing` / Slot taken → `tests/host/worker/policy.test.ts`
- `worker-routing` / Switch off → `tests/host/worker/policy.test.ts`
- `worker-routing` / No key → `tests/host/worker/policy.test.ts`
- `worker-routing` / Invalid config → `tests/host/worker/policy.test.ts`
- `worker-routing` / Executor absent → `tests/host/worker/policy.test.ts`
- `worker-routing` / Child session → `tests/host/worker/policy.test.ts`
- `worker-routing` / Other tools ignored → `tests/host/worker/policy.test.ts`
- `worker-routing` / Nested launch with the switch off → `tests/host/worker/policy.test.ts`
- `worker-routing` / Display name prefix → `tests/host/worker/policy.test.ts`
- `worker-routing` / Slot display name → `tests/host/worker/policy.test.ts`
- `worker-routing` / Parent request off → `tests/host/worker/policy.test.ts`
- `worker-routing` / Forked launch with thinking asks fewer questions → `tests/host/worker/policy.test.ts`
- `worker-routing` / Service launch content → `tests/host/worker/policy.test.ts`
- `worker-routing` / Caller model replaced → `tests/host/launch-policy-evidence.test.ts (host)`
- `worker-routing` / Background launch → `tests/host/launch-policy-evidence.test.ts (host)`
- `worker-routing` / Resume untouched → `tests/host/worker/policy.test.ts`
- `worker-routing` / Effective values recorded → `tests/host/worker/policy.test.ts`
- `worker-routing` / Jev timeout → `tests/host/worker/policy.test.ts`
- `worker-routing` / Timeout changed after session start → `tests/host/worker/policy.test.ts`
- `worker-routing` / Jev error → `tests/host/worker/policy.test.ts`
- `worker-routing` / Unreadable answers → `tests/host/worker/policy.test.ts`
- `worker-routing` / Turn cancelled → `tests/host/worker/policy.test.ts`
- `worker-routing` / Internal error → `tests/host/worker/policy.test.ts`
- `worker-routing` / Premium launch end to end → `tests/host/worker-routing.test.ts (host)`
- `worker-routing` / Mode changed between message end and launch → `tests/host/worker/policy.test.ts`
- `worker-routing` / Jev down in premium → `tests/host/worker/policy.test.ts`
- `worker-routing` / Siblings share a window state → `tests/host/worker/policy.test.ts`
- `worker-routing` / Launch classified alone → `tests/host/worker/policy.test.ts`
