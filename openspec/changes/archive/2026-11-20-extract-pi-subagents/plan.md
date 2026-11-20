# Extract pi-subagents Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Remove the vendored executor so `@ttdua/pi-jev-pilot` loads one extension, detects any installed executor by capability, and runs its host tests against `@ttdua/pi-subagents` `v0.1.1` pinned as a dev dependency.

**Architecture:** `src/` already talks to the executor only through the `Symbol.for("@gotgenes/pi-subagents:service")` slot and `subagents:*` events. The change replaces the name/path checks in `src/host/platform/` with capability facts (design D1), feeds those facts to routing, the agent list and `/jev`, and moves tests and tooling from the workspace member to the `node_modules` copy (design D3).

**Tech Stack:** TypeScript on Bun (`bun test`), Pi `@earendil-works/pi-coding-agent` 1.5.0, oxlint/oxfmt, OpenSpec.

## Global Constraints

- Package name `@ttdua/pi-jev-pilot`; version `0.6.0`.
- Executor dev dependency exactly `"@ttdua/pi-subagents": "github:ttdua/pi-subagents#v0.1.1"`; no runtime `dependencies`; `peerDependencies` exactly `{ "@earendil-works/pi-ai": "*", "@earendil-works/pi-coding-agent": "*", "@earendil-works/pi-tui": "*", "typebox": "*" }`.
- `src/` imports `@ttdua/pi-subagents` with `import type` only.
- Executor slot key stays `Symbol.for("@gotgenes/pi-subagents:service")`.
- Tests need no secrets, paid calls or network beyond loopback; host installs run with `PI_OFFLINE=1`.
- `policy/` stays pure; only `src/host/` touches Pi.
- Status strings (exact): `executor: no executor; worker routing is off`, `executor: <impl>`, `executor: <impl>; no launch policy, worker routing is off`, suffix `; no agent registry`, `<impl>` = `unknown` when missing.

## Review Focus

- A service whose capability getter throws: the check must report the capability false, not throw (test in Task 2).
- A non-object or `null` value in the slot: the executor is still `present` if a `subagent` tool exists, with both capabilities false (Task 2).
- `/jev` after the main session reloads: the capture is refreshed and the executor line does not go stale (Task 2, `service.test.ts` re-capture case).
- `bun install` on a fresh clone pulls the git tag; host tests must not fall back to network when `node_modules/@ttdua/pi-subagents` is missing; the harness throws a clear error naming `bun install` (Task 3).
- Upgrading users with the old vendored install left behind: README migration says to reinstall jev-pilot after installing the executor so Pi does not see two `subagent` tools (Task 5).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `ExecutorService` (`src/host/platform/service.ts`) | new (replaces `VendoredService`) | `Partial<Pick<SubagentsService, "registerLaunchPolicy" \| "listAgentTypes">> & { readonly implementation?: unknown }` (raw slot value; `ExecutorState.implementation` is the normalized `string`) | no |
| `ExecutorState` (`src/host/platform/readiness.ts`) | modified | `{ kind: "absent" } \| { kind: "present"; implementation?: string; launchPolicy: boolean; agentRegistry: boolean }` | no |
| `executorState(tools, captured)` | modified | `(tools: readonly ToolInfo[], captured: unknown) => ExecutorState`; drops the `published` parameter | no |
| `canRoute(state)` (`readiness.ts`) | new | `(state: ExecutorState) => boolean` = `kind === "present" && launchPolicy` | no |
| `buildSnapshot({ executor?, toolNames, … })` | modified | `executor` stays optional; when omitted: `subagent` in `toolNames` → `{ kind: "present", launchPolicy: true, agentRegistry: true }` (no implementation), else `{ kind: "absent" }`; `loadSnapshot` always passes `executorState(tools, capturedService())` | no |
| `hasExecutor(toolNames)` | kept | unchanged | no |
| `publishedService()` | removed | — (only readiness used it) | no |
| `capturedService()` | kept | `() => unknown` | no |
| `executorAgents(service)` (`agents.ts`) | modified | `(service: ExecutorService \| undefined) => AgentFacts[]`; `[]` when `listAgentTypes` is not a function | no |
| `WorkerDeps.service`, `Registration.register` (`routing.ts`) | modified | `() => ExecutorService \| undefined`; `register(service: ExecutorService \| undefined, host)` | no |
| `worker-fakes` `Opts.executor` (`tests/host/worker-fakes.ts`) | modified | `boolean \| { launchPolicy?: boolean; agentRegistry?: boolean; implementation?: string }` replacing `"duplicate"` | no |
| `PrepareOpts`, `runOnce` opts (`tests/host/harness.ts`) | modified | drop `self` and `executor`; keep `install?: InstallMode`, `installs?: string[]` | no |
| `captureMainService()` / `mainService()` | modified | capture any non-null object in the slot; `mainService(): ExecutorService \| undefined` | no |
| `InstallMode` (`tests/host/harness.ts`) | modified | `"jev+executor" \| "jev" \| "none"`; default `"jev+executor"` | no |
| `executorDir(root = REPO_ROOT)` (`tests/host/harness.ts`) | new | `(root?: string) => string`: real path of `<root>/node_modules/@ttdua/pi-subagents`; throws an error containing `bun install` when absent | no |
| `package.json` | modified | `name`, `version`, `pi.extensions`, `devDependencies`, no `workspaces`, no `test:executor` (see Task 1) | yes |
| `/jev` executor line | modified | strings in Global Constraints | yes |
| `checkRelease` executor rule (`tests/release-check.ts`) | modified | reports a `pi install git:github.com/ttdua/pi-subagents@<ref>` line whose ref ≠ pinned tag, or missing / after the jev-pilot line | no |

---

## Task 1: Manifest, dependency pin and repository checks — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Modify: `package.json`, `bun.lock`, `tsconfig.json`, `.oxlintrc.json`, `.github/workflows/ci.yml`, `scripts/fork-cache-evidence.ts`
- Modify: `tests/manifest.test.ts`, `tests/ci.test.ts`, `tests/import-graph.test.ts`, `tests/support/import-graph.ts`, `tests/docs-old-names.test.ts`, `tests/load.test.ts`
- Delete: `packages/pi-subagents/`, `scripts/vendor-manifest.ts`, `tests/vendoring.test.ts`, `tests/fixtures/import-graph/src/host/bad-executor-relative-runtime.ts`, `tests/fixtures/import-graph/src/host/ok-executor-relative-type.ts`

**Interfaces:**
- Produces: `node_modules/@ttdua/pi-subagents` (types via `exports.types` → `dist/public.d.ts`) for Tasks 2–4.

- [ ] **Step 1: Rewrite `tests/manifest.test.ts`** with tests named after the `package-loading` and `host-test-harness` scenarios: "Manifest names one entry point" (`pkg.name === "@ttdua/pi-jev-pilot"`, `pkg.pi.extensions` equals `["./src/extension.ts"]`, `pkg.workspaces` undefined, keywords/license), "Host package is a peer, not bundled" (exact peers object), "Executor is a dev dependency only", "Pinned to a release tag" (`/^github:ttdua\/pi-subagents#v\d+\.\d+\.\d+$/`), "No published executor dependency", "Every imported host package is declared" (scan `src/` only, skip `import type … "@ttdua/pi-subagents"`).
- [ ] **Step 1b: Load test first.** Change `tests/load.test.ts` "Installed checkout is loaded" to expect exactly one extension resolving to `<checkout>/src/extension.ts` and none else under the checkout (rename from "…; Both extensions loaded").
- [ ] **Step 2: Run** `bun test tests/manifest.test.ts tests/load.test.ts` — expect FAIL on name, extensions, workspaces, devDependency, and the second loaded extension.
- [ ] **Step 3: Edit `package.json`**: `name` → `@ttdua/pi-jev-pilot`; remove `workspaces` and `test:executor`; `pi.extensions` → `["./src/extension.ts"]`; run `bun add -d "@ttdua/pi-subagents@github:ttdua/pi-subagents#v0.1.1"`; delete `packages/pi-subagents/`; `bun install`.
- [ ] **Step 4: Edit `tsconfig.json`**: drop `compilerOptions.paths` and `"packages"` from `exclude`. Run `bun run typecheck` — expect PASS (types from `node_modules`).
- [ ] **Step 5: Run** `bun test tests/manifest.test.ts` — expect PASS.
- [ ] **Step 6: Tooling.** Delete `scripts/vendor-manifest.ts`, `tests/vendoring.test.ts`; `.oxlintrc.json` `ignorePatterns` drop `packages/**`; CI drops the `test:executor` and `verify:public-types` steps; `tests/ci.test.ts` keeps "CI runs every check" with the five steps of `quality-checks` and removes the `packages/` and public-types tests.
- [ ] **Step 7: Import graph.** In `tests/support/import-graph.ts` remove the `packages/` branch (`vendored` at line ~188); in `tests/import-graph.test.ts` drop the relative-into-`packages/` cases and their fixtures; change the message to "Import @ttdua/pi-subagents with import type only."; keep cases "Runtime import rejected" (value import of `@ttdua/pi-subagents` from `src/` fails naming the file) and "Type import allowed".
- [ ] **Step 8: Docs guard.** `tests/docs-old-names.test.ts`: glob only `docs/**/*.md`; exemptions `docs/evidence/`, `docs/decisions/`; test name "Old names gone from current docs"; delete "Decision record present" (~60-67, reads `packages/pi-subagents/docs/decisions`).
- [ ] **Step 9: Load test.** Confirm `tests/load.test.ts` (changed in Step 1b) passes.
- [ ] **Step 10: Script.** `scripts/fork-cache-evidence.ts` `installAll`: install `realpathSync(join(REPO_ROOT, "node_modules", "@ttdua", "pi-subagents"))`. Accepted exception to D4: it is a manual operator script, not the test harness.
- [ ] **Step 11: Run** `bun run typecheck && bun run lint && bun test tests/manifest.test.ts tests/ci.test.ts tests/import-graph.test.ts tests/docs-old-names.test.ts tests/load.test.ts` — expect PASS. Host tests may fail until Task 3.
- [ ] **Step 12: Commit** `refactor(executor-boundary): drop the vendored executor and pin @ttdua/pi-subagents`.

---

## Task 2: Capability-based executor detection — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
**Difficulty:** Hard
**Blocked by:** Task 1

**Files:**
- Modify: `src/host/platform/service.ts`, `src/host/platform/readiness.ts`, `src/host/platform/index.ts`, `src/host/platform/agents.ts`, `src/host/setup.ts`, `src/host/worker/policy.ts`, `src/host/worker/routing.ts`, `src/host/commands/status-format.ts`
- Test: `tests/host/platform/readiness.test.ts`, `tests/host/platform/service.test.ts`, `tests/host/platform/agent-facts.test.ts`, `tests/host/worker/policy.test.ts`, `tests/host/worker-fakes.ts`, `tests/host/commands/jev.test.ts`, `tests/host/review-tool.test.ts` (Snapshot cast at line ~38)

**Interfaces:**
- Consumes: `SubagentsService` type from `@ttdua/pi-subagents` (Task 1).
- Produces: `ExecutorService`, `ExecutorState`, `executorState`, `canRoute`, `mainService` (Contracts).

- [ ] **Step 0: Remove contradicted tests.** In `readiness.test.ts`: delete the `duplicate` and Windows-path cases of `describe("executorState")` (~259-310) and rewrite the `loadSnapshot` slot-replacement describe (~320-349) to: after a reload `captureMainService()` runs again and the new capture decides. Change the "executor" test (~100) to expect `{ kind: "present", launchPolicy: true, agentRegistry: true }` for `["read","subagent"]`. In `service.test.ts`: replace "unusable service clears" and "another implementation is not captured" with "any object is captured" and "a non-object clears"; delete `describe("publishedService")`. In `policy.test.ts`: replace the "Duplicate executor" case (~216) with "Executor without a launch policy".
- [ ] **Step 1: Failing readiness tests** in `describe("executorState")`, one per `readiness-checks` scenario: "Executor installed" (`{implementation:"@ttdua/pi-subagents", registerLaunchPolicy(){}, listAgentTypes(){}}` + `subagent` tool → `{kind:"present", implementation:"@ttdua/pi-subagents", launchPolicy:true, agentRegistry:true}`); "Executor absent" (no tool, no service → `{kind:"absent"}`); "Original loaded first" and "Original loaded last" (service `{ listAgents(){} }` + tool → `present`, no implementation, both false); "Another compatible executor" (`implementation:"example-executor"`, both methods → both true); "Tool without a service" (tool, `undefined` → present, both false); "Present after children" (same facts after capture twice); Review Focus: getter that throws → that fact false; `null` in slot with tool → present, both false. "Both executors installed" is Pi behavior, recorded in the scenario table, not tested.
- [ ] **Step 2: Failing service tests** in `tests/host/platform/service.test.ts`: `captureMainService()` keeps any object (`{ listAgents(){} }` is captured), drops non-objects; a second capture after the slot changes returns the new object.
- [ ] **Step 3: Run** `bun test tests/host/platform` — expect FAIL.
- [ ] **Step 4: Implement** `ExecutorService` and capture in `service.ts` (remove `VENDORED_IMPLEMENTATION`, `isVendoredService`, `publishedService`); `executorState(tools, captured)` and `canRoute` in `readiness.ts` (remove `VENDORED_DIR`, `insideVendored`, `isOtherService`, `isUsableCapture`); read each property inside `try`. `buildSnapshot` fallback per the Contracts row (both capabilities true when only tool names are given), so the pure `formatStatus(snap(...))` tests in `jev.test.ts`, `jev-pin.test.ts`, `status-reply.test.ts` keep their `mix` lines. Update `index.ts` exports and `loadSnapshot`; `review-tool.test.ts` Snapshot cast gets the new `executor` shape.
- [ ] **Step 5: Run** `bun test tests/host/platform` — expect PASS.
- [ ] **Step 6: Failing routing tests** in `tests/host/worker/policy.test.ts`: "Executor without a launch policy" (snapshot executor `present`, `launchPolicy:false` → no Jev request, no adjustment). Update `worker-fakes.ts` to type its service as `ExecutorService` (comment at ~179: "A fake executor service") and its snapshot executor with the new shape. Keep "Executor absent".
- [ ] **Step 7: Implement** `routingOpen` with `canRoute(snap.executor)`; `Registration.register(service: ExecutorService | undefined, …)` unchanged logic (already checks the method). Run `bun test tests/host/worker` — expect PASS.
- [ ] **Step 8: Failing agent test** in `tests/host/platform/agent-facts.test.ts` or `tests/jev/state.test.ts`: "No agent registry" — `executorAgents({})` (no `listAgentTypes`) returns `[]`; `main-state` "No executor" keeps passing.
- [ ] **Step 9: Implement** `executorAgents(service: ExecutorService | undefined)` returning `[]` when `typeof service?.listAgentTypes !== "function"`. Run — expect PASS.
- [ ] **Step 10: Failing `/jev` tests** in `tests/host/commands/jev.test.ts`: "Default status" passes `executor: { kind: "present", implementation: "@ttdua/pi-subagents", launchPolicy: true, agentRegistry: true }` and contains `executor: @ttdua/pi-subagents`; "No executor" contains `executor: no executor; worker routing is off`; "Duplicate executor reported" (service shaped like the original) contains `executor: unknown; no launch policy, worker routing is off; no agent registry`, no `mix (`, no `uninstall`; "Executor without an agent registry reported" ends with `; no agent registry`; "No mix without the executor" unchanged. Replace the old `{ kind: "duplicate", path }` fixture at line ~1488.
- [ ] **Step 11: Implement** `executorLine` and the `mix` condition (`canRoute`) in `status-format.ts`. Run `bun test tests/host/commands` — expect PASS.
- [ ] **Step 12: Run** `bun run typecheck && bun run lint && bun test tests/host/platform tests/host/worker tests/host/commands tests/jev` — expect PASS.
- [ ] **Step 13: Commit** `feat(readiness-checks): detect the executor by capability`.

---

## Task 3: Host harness on the pinned executor — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
**Difficulty:** Hard
**Blocked by:** Task 1, Task 2 (tasks.md group 3 is blocked by 1, 2: host tests need capability detection, or the `node_modules` executor still reads as `duplicate`).

**Files:**
- Modify: `tests/host/harness.ts`, `tests/host/harness.test.ts`, `tests/host/manual/probe-tools/index.ts`, a probe under `tests/host/probes/` recording `subagent` `sourceInfo.path`, `tests/host/cli-review.test.ts`, `tests/host/directory-mode-e2e.test.ts`, `tests/host/effort-hold.test.ts`, `tests/host/jev-base.test.ts`, `tests/host/main-effort.test.ts`, `tests/host/setup.test.ts`, `tests/host/skill-delivery.test.ts`, `tests/host/strategy-advice.test.ts`, `tests/host/tuning-host.test.ts`, `tests/host/verbose-log.test.ts`, `tests/host/worker-routing.test.ts`, `tests/host/q5-q6-main.test.ts`, `tests/host/launch-policy-evidence.test.ts`, `tests/host/context-mode.test.ts`
- Delete: `tests/fixtures/executor-only/`, `tests/fixtures/jev-only/`, `tests/host/run-facts-offline.test.ts`, `tests/host/fleet-print.test.ts`, `tests/host/service-escalation.test.ts`, `tests/host/duplicate-executor.test.ts`, `tests/host/probes/escalation/`, `tests/host/manual/fleet-fixture.ts` (only evidence docs reference it)

**Interfaces:**
- Produces: `InstallMode`, `executorDir()` (Contracts); `startHostSession({ install })` keeps its signature otherwise.

- [ ] **Step 1: Failing harness tests** in `tests/host/harness.test.ts`. First delete "installs the vendored executor offline" (~102) and "installs the checkout, which brings the executor" (~111), and change "installs the checkout by default" (~119-134) to expect `[executorDir(), REPO_ROOT]`. Then add: "Executor installs offline" (both installs exit 0 with `PI_OFFLINE=1`); "Executor and probe are loaded" (tools include `subagent` and `jev_review`, probe ran); "Probes only" (`install: "none"`, no `subagent`, no `jev_review`); "jev-pilot without an executor" (`install: "jev"`, `jev_review` present, no `subagent`); "Harness installs the resolved package" (`settings.json` packages list `executorDir()` before `REPO_ROOT`, and the session's `subagent` tool `sourceInfo.path` starts with `executorDir()`, read by a probe that records `pi.getAllTools()` `sourceInfo.path` to the probe report, since RPC does not expose it); `executorDir(tmpRoot)` throws a message containing `bun install`; an `installs` list holding `executorDir()` without `REPO_ROOT` throws (spec: no executor-only install).
- [ ] **Step 2: Run** `bun test tests/host/harness.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** in `harness.ts`: `InstallMode = "jev+executor" | "jev" | "none"`; `executorDir()`; `installMode` installs `executorDir()` then `REPO_ROOT` for `jev+executor`, `REPO_ROOT` for `jev`; drop `EXECUTOR_ONLY_DIR`, `JEV_ONLY_DIR`, `legacyMode` and the `self`/`executor` flags; `installs` (explicit list) stays, each source skipped on its own when already listed in `settings.json`, and rejected when it holds `executorDir()` without `REPO_ROOT`.
- [ ] **Step 4: Run** `bun test tests/host/harness.test.ts` — expect PASS.
- [ ] **Step 5: Delete** the executor-only files listed above; reword the comment at `tests/host/manual/probe-tools/index.ts:9` to name the installed executor; the `describe("launch policy seam evidence")` block of `launch-policy-evidence.test.ts`, and the `install: "executor-only"` cases of `context-mode.test.ts`; delete `tests/fixtures/executor-only/` and `tests/fixtures/jev-only/`.
- [ ] **Step 6: Migrate** every remaining host test:
  - `self: true` / `install: "checkout"` / `executor: true` → default (`jev+executor`); `install: "jev-only"` → `"jev"`; `self: false` with no executor → `"none"`; keep `"none"`.
  - Explicit `installs` lists containing the checkout get `executorDir()` first: `launch-policy-evidence.test.ts:246` → `installs: [executorDir(), REPO_ROOT_SOURCE, PROBE_SOURCE]`.
  - Print-mode baselines (`jev-base.test.ts` ~230-262, `main-effort.test.ts` ~197-217, `strategy-advice.test.ts` ~130-147): first run `install: "none"`, second run `install: "jev"`, same agent dir and cwd; the same-bodies assertion is unchanged.
  - `/jev` assertions `executor: present` (`jev-base.test.ts:147`, `launch-policy-evidence.test.ts:642`) → `executor: @ttdua/pi-subagents`.
- [ ] **Step 7: Run** `bun run typecheck && bun test tests/host` — expect PASS; fix fallout in the migrated tests only.
- [ ] **Step 8: Commit** `test(host-test-harness): install the pinned executor and drop executor-only tests`.

---

## Task 4: Q4 evidence on jev-pilot sessions — implements 4

**Covers:** 4.1, 4.2, 4.3
**Difficulty:** Normal
**Blocked by:** Task 3

**Files:**
- Create: `tests/host/q4-child.test.ts`
- Delete: `tests/host/q3-q4-child.test.ts`
- Modify: `tests/host/evidence.test.ts`, `docs/evidence/2026-11-05-host-seams.md`

**Interfaces:**
- Consumes: `startHostSession` default mode (Task 3).

- [ ] **Step 1: Failing evidence tests** in `tests/host/evidence.test.ts` (rewrite: "report answers every question" requires a `tests/host/` citation only for rows not marked `Moved:`; `launchPolicyLinks` / LIVING_SPEC check expects the executor repository URL instead of `openspec/specs/executor-launch-policy/spec.md`, and drops the existence/`One launch policy slot` read): `PINNED = ["Q4","Q5","Q6"]`; "Q3 marked moved" (row answer starts `Moved:`, keeps `Yes`, names `ttdua/pi-subagents`, evidence cites no `tests/host/`); "Service launch escalation section marked moved" (section contains `**Moved.**` and `ttdua/pi-subagents`, observations kept); "Superseded questions kept" links `https://github.com/ttdua/pi-subagents/blob/v0.1.1/openspec/specs/executor-launch-policy/spec.md` and `REPLACING_TEST` = `tests/host/launch-policy-evidence.test.ts` (kept jev-pilot part); "Q4 runs with jev-pilot" (file `tests/host/q4-child.test.ts` contains `"WG-02 Q4` and no `install: "none"`/`"jev"`).
- [ ] **Step 2: Run** `bun test tests/host/evidence.test.ts` — expect FAIL.
- [ ] **Step 3: Create** `tests/host/q4-child.test.ts` from the Q4 test of `q3-q4-child.test.ts` on the default `jev+executor` session (same probe, same assertions and `"WG-02 Q4 …"` messages); delete `q3-q4-child.test.ts`.
- [ ] **Step 4: Edit the report**: Q3 row and section → `Moved:` with the recorded answer, `ttdua/pi-subagents`; service launch escalation section → `**Moved.**`; Q1/Q2/Q7 links → the executor repository URL; Q4 row → `tests/host/q4-child.test.ts`; "Read with care" paragraph names Q4–Q6 as pinned.
- [ ] **Step 5: Run** `bun test tests/host/evidence.test.ts tests/host/q4-child.test.ts` — expect PASS.
- [ ] **Step 6: Commit** `test(host-seam-evidence): pin Q4 on a jev-pilot session and mark executor evidence moved`.

---

## Task 5: Docs, release metadata and decision record — implements 5

**Covers:** 5.1, 5.2, 5.3, 5.4, 5.5
**Difficulty:** Normal
**Blocked by:** Task 2, Task 3

**Files:**
- Modify: `tests/release-check.ts`, `tests/release.test.ts`, `README.md`, `docs/usage-guide.md`, `docs/decisions/README.md`, `docs/architecture.md`, `docs/project-brief.md`, `docs/glossary.md`, `docs/testing.md`, `docs/roadmap.md`, `NOTICE.md`, `openspec/config.yaml`, `package.json` (version), `CHANGELOG.md`
- Create: `docs/decisions/0010-executor-as-installed-package.md`

**Interfaces:**
- Consumes: the status strings of Task 2 for docs; `package.json` dev dependency of Task 1.

- [ ] **Step 1: Failing release tests** in `tests/release.test.ts`: "Pinned install" (real files: jev-pilot `@v0.6.0`, executor `@v0.1.1` before it, in both files); "Unpinned install fails" (unchanged); "Executor install drifts from the pin" (fixture README `…pi-subagents@v0.1.0` with pin `v0.1.1` → problem naming the line). `checkRelease` takes the pinned tag from `files.pkg.devDependencies["@ttdua/pi-subagents"]`.
- [ ] **Step 2: Run** `bun test tests/release.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the executor rule in `tests/release-check.ts` (regex `/pi install git:github\.com\/ttdua\/pi-subagents(\S*)/g`, must equal `@<tag>`, at least one per file, first index < first jev-pilot install index).
- [ ] **Step 4: Docs.** README and usage guide: install section with the two commands (executor first), one line that worker routing needs the executor and `/jev` shows `executor: no executor; worker routing is off` without it, migration note for 0.5.x users (remove the old install, install the executor, reinstall jev-pilot `@v0.6.0`). Remove the uninstall-the-original advice.
- [ ] **Step 5: ADR 0010** (Context, Decision, Consequences; under a page) per design D1, D3, D4; 0009 row → "Superseded by 0010"; add 0010 row.
- [ ] **Step 6: Other docs**: architecture (executor is a separate package; capability facts; host seams table unchanged), project brief, glossary (`executor` entry), testing (pinned dev dependency, install modes), roadmap (remove the vendored-executor sync row ~238; add a note), `NOTICE.md` (drop vendored and ported-to-`packages/` entries; one line naming `ttdua/pi-subagents` as the executor jev-pilot works with), `openspec/config.yaml` context line → `@ttdua/pi-subagents as executor, installed separately`.
- [ ] **Step 7: Version.** `package.json` `version` → `0.6.0`; `CHANGELOG.md` `## [0.6.0]` with `v0.6.0`, date, **Breaking** install change, capability detection, removed executor-only tests, migration.
- [ ] **Step 8: Run** `bun run fmt:check && bun test tests/release.test.ts tests/docs-old-names.test.ts tests/manifest.test.ts` — expect PASS.
- [ ] **Step 9: Commit** `docs(release-metadata): install the executor separately; 0.6.0`.

---

## Task 6: Whole-change verification — implements 6

**Covers:** 6.1, 6.2, 6.3, 6.4
**Difficulty:** Normal
**Blocked by:** Task 2, Task 4, Task 5 (Task 3 is reached through Task 4)

**Files:** none modified unless a check fails (then the owning task's files).

- [ ] **Step 1:** `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run fmt:check && bun run test` — all exit 0.
- [ ] **Step 2:** `rg -n "packages/pi-subagents|VENDORED|vendored executor|executor-only|duplicate executor|test:executor" --glob '!openspec/**' --glob '!CHANGELOG.md' --glob '!docs/evidence/**' --glob '!docs/decisions/**'` — no output (`openspec/specs/**` changes at archive). (`Duplicate executor reported` is a spec scenario name; the pattern is lower-case `duplicate executor` and matches only status text.)
- [ ] **Step 3: E2E.** In a temp `PI_CODING_AGENT_DIR`: `pi install git:github.com/ttdua/pi-subagents@v0.1.1`, `pi install <checkout>`; start `pi --mode rpc`, run `/jev` — reply contains `executor: @ttdua/pi-subagents`. Remove the executor install, run `/jev` again — contains `executor: no executor; worker routing is off`. Record the commands and outputs in `apply.md`.
- [ ] **Step 4:** `openspec validate extract-pi-subagents --strict` — valid. After archive (not in apply), check `openspec/specs/` holds none of the 13 emptied capabilities; delete any left.

---

## Scenario → test

**executor-boundary**
- Runtime import rejected → `tests/import-graph.test.ts` "Runtime import rejected"
- Type import allowed → `tests/import-graph.test.ts` "Type import allowed"
- Old names gone from current docs → `tests/docs-old-names.test.ts`

**package-loading**
- Installed checkout is loaded → `tests/load.test.ts`
- A failing entry point is not reported as loaded → `tests/load.test.ts`
- Loaded extension registers only /jev and handlers → `tests/load.test.ts`
- Manifest names one entry point → `tests/manifest.test.ts`
- Host package is a peer, not bundled → `tests/manifest.test.ts`
- Executor is a dev dependency only → `tests/manifest.test.ts`
- Every imported host package is declared → `tests/manifest.test.ts`

**host-test-harness**
- Executor installs offline → `tests/host/harness.test.ts`
- Executor and probe are loaded → `tests/host/harness.test.ts`
- Probes only → `tests/host/harness.test.ts`
- jev-pilot without an executor → `tests/host/harness.test.ts`
- Pinned to a release tag → `tests/manifest.test.ts`
- Harness installs the resolved package → `tests/host/harness.test.ts`
- No published executor dependency → `tests/manifest.test.ts`
- Lockfile matches → CI `bun install --frozen-lockfile` (`tests/ci.test.ts` "CI runs every check") and Task 6 Step 1

**readiness-checks**
- Executor installed → also `tests/host/jev-base.test.ts` "/jev reports the executor when present" (host)
- Executor installed / Executor absent / Original loaded first / Original loaded last / Another compatible executor / Tool without a service / Present after children → `tests/host/platform/readiness.test.ts` `describe("executorState")`
- Both executors installed → not tested here (Pi behavior, stated in the scenario)

**jev-command**
- Default status / No executor / Duplicate executor reported / Executor without an agent registry reported / No mix without the executor → `tests/host/commands/jev.test.ts` (Task 2)
- Directory mode in the report / Malformed directory mode reported / CLI review default shown / Key name, never value / Malformed state reported / Invalid config reported / Deprecated tools section reported / Deprecation never notified on its own / Malformed tuning reported / Empty tally / Tally after work / Mix with a full window / Budget target shown / Mix while the seed applies / Empty window → existing tests in `tests/host/commands/jev.test.ts` and `tests/host/commands/status-reply.test.ts`, unchanged

**worker-routing**
- Executor absent / Executor without a launch policy → `tests/host/worker/policy.test.ts`
- Switch off / No key / Invalid config / Child session / Other tools ignored / No tool questions or tool adjustment / Routing off sends nothing about tools / Nested launch with the switch off / Jev timeout / Timeout changed after session start / Jev error / Unreadable answers / Turn cancelled / Internal error → existing `tests/host/worker/policy.test.ts`
- Registered at session start / Re-registered after reload → `tests/host/launch-policy-evidence.test.ts` (kept jev-pilot part) and `tests/host/worker-routing.test.ts`

**main-state**
- First sentence / Caps / Agent caps / No executor → existing `tests/jev/state.test.ts`
- No agent registry → `tests/host/platform/agent-facts.test.ts` (`executorAgents` returns `[]`) and `tests/jev/state.test.ts` (empty agents still builds the main request; Task 2 Step 8)

**agent-metadata**
- Built-in explore / Package source carried → existing `tests/host/platform/agent-facts.test.ts` (fixtures now typed from `node_modules`)

**cli-review**
- Offered in the main session / Absent in a child session / Refused in a child session / Declared but refused in a fork → existing `tests/host/cli-review.test.ts`, `tests/host/review-tool.test.ts` (migrated in Task 3)

**host-seam-evidence**
- Changed host behavior fails the test → `tests/host/evidence.test.ts` "Q4 to Q6 stay pinned by their host tests"
- Q4 runs with jev-pilot → `tests/host/evidence.test.ts` + `tests/host/q4-child.test.ts`
- Every question answered or marked unsettled → `tests/host/evidence.test.ts` "report answers every question"
- Superseded questions kept → `tests/host/evidence.test.ts`
- Q3 marked moved → `tests/host/evidence.test.ts`
- Service launch escalation section marked moved → `tests/host/evidence.test.ts`

**release-metadata**
- Pinned install / Unpinned install fails / Executor install drifts from the pin → `tests/release.test.ts`

**Removed capabilities** (`builtin-role-agents`, `package-agents`, `executor-agent-registry`, `executor-launch-identity`, `executor-launch-policy`, `launch-metadata`, `launch-resources`, `service-launch-wait`, `structured-result`, `subagent-context-mode`, `subagent-run-facts`, `fleet-view`, `executor-vendoring`): REMOVED only; no scenario to cover.
