## 1. Manifest, dependency pin and repository checks

Blocked by: none

- [x] 1.1 Update `tests/manifest.test.ts` to the `package-loading` "Package manifest" scenarios and the `host-test-harness` "Executor comes from the pinned dev dependency" scenarios (name `@ttdua/pi-jev-pilot`, `pi.extensions` = `["./src/extension.ts"]`, no `workspaces`, executor only in `devDependencies` pinned to `github:ttdua/pi-subagents#v<x.y.z>`, no `@gotgenes/pi-subagents`, imported host packages are peers); see them fail
- [x] 1.2 `package.json`: rename to `@ttdua/pi-jev-pilot`, drop `workspaces`, drop the executor entry from `pi.extensions`, drop `test:executor`, add dev dependency `"@ttdua/pi-subagents": "github:ttdua/pi-subagents#v0.1.1"`; `bun install` to refresh `bun.lock`
- [x] 1.3 `tsconfig.json`: drop the `paths` mapping and the `packages` exclude; confirm `bun run typecheck` resolves `@ttdua/pi-subagents` types from `node_modules`
- [x] 1.4 Delete `packages/pi-subagents/`, `scripts/vendor-manifest.ts`, `tests/vendoring.test.ts`
- [x] 1.5 `.oxlintrc.json`: drop `packages/**`; `.github/workflows/ci.yml`: drop `test:executor` and `verify:public-types` steps; update `tests/ci.test.ts` accordingly (remove the `packages/` and public-types tests)
- [x] 1.6 `tests/import-graph.test.ts`, `tests/support/import-graph.ts` and `tests/fixtures/import-graph/`: drop the `packages/` exemption and fixtures; keep the `executor-boundary` "Runtime import rejected" / "Type import allowed" cases against `@ttdua/pi-subagents`
- [x] 1.7 `tests/docs-old-names.test.ts`: scan `docs/**/*.md` only, exemptions per `executor-boundary` "Old names gone from current docs"
- [x] 1.8 `scripts/fork-cache-evidence.ts`: install the executor from the resolved `@ttdua/pi-subagents` directory under `node_modules` instead of `packages/pi-subagents`
- [x] 1.9 `tests/load.test.ts` (package-loading "Installed checkout is loaded"): expect exactly one extension, `src/extension.ts`, and none elsewhere in the checkout

## 2. Capability-based executor detection

Blocked by: 1

- [x] 2.1 Unit tests in `tests/host/platform/readiness.test.ts` and `tests/host/platform/service.test.ts` for `readiness-checks` "Executor presence": installed, absent, without launch policy, another compatible executor, tool without a service, original loaded first/last (fake slot shaped like `@gotgenes/pi-subagents` 25.0.5: no `implementation`, `listAgents` only), throwing property, present after children; see them fail
- [x] 2.2 `src/host/platform/service.ts`: replace `VendoredService`/`isVendoredService` with `ExecutorService` (design D1); capture any object service at `session_start`; `mainService()` returns it
- [x] 2.3 `src/host/platform/readiness.ts`: replace the three-state `executorState` with the capability facts of design D1; remove `VENDORED_DIR`, `insideVendored`, `isOtherService`, `isUsableCapture`; `buildSnapshot` without `executor` yields `present` with both capabilities when `subagent` is listed (design D1)
- [x] 2.4 `src/host/worker/policy.ts` `routingOpen` and `src/host/worker/routing.ts` `Registration.register`: route only with `launchPolicy`; tests in `tests/host/worker/policy.test.ts` and `tests/host/worker-fakes.ts` for "Executor without a launch policy"
- [x] 2.5 `src/host/setup.ts` / `src/host/platform/agents.ts`: agent list only with `agentRegistry`; test `main-state` "No agent registry" in `tests/host/platform/agent-facts.test.ts`
- [x] 2.6 `src/host/commands/status-format.ts`: executor line per `jev-command` "Status report" and design D2; `mix` only when routing can run; update `tests/host/commands/jev.test.ts` (default status, no executor, duplicate executor reported, without agent registry, no mix without the executor)

## 3. Host harness on the pinned executor

Blocked by: 1, 2

- [x] 3.1 `tests/host/harness.test.ts`: cases for `host-test-harness` "Executor installs offline", "Executor and probe are loaded", "Probes only", "jev-pilot without an executor", "Harness installs the resolved package"; see them fail
- [x] 3.2 `tests/host/harness.ts`: install modes `jev+executor` (default), `jev`, `none` (design D3); resolve the executor directory from `node_modules/@ttdua/pi-subagents`; install executor then checkout then probes; remove `executor-only`, `self`/`executor` legacy flags if unused after migration
- [x] 3.3 Delete `tests/fixtures/executor-only/` and `tests/fixtures/jev-only/` if the checkout now equals jev-only
- [x] 3.4 Delete executor-only host tests: `run-facts-offline.test.ts`, `fleet-print.test.ts`, `service-escalation.test.ts`, `duplicate-executor.test.ts`, the executor-only `describe` of `launch-policy-evidence.test.ts`, executor-only cases of `context-mode.test.ts`; remove probes and manual fixtures only they used (`tests/host/probes/escalation`, `tests/host/manual/fleet-fixture.ts`)
- [x] 3.5 Migrate remaining host tests to the new modes (explicit `installs` lists that contain the checkout get the executor prepended; print-mode baselines compare `none` with `jev` in the same agent dir; `/jev` assertions read `executor: @ttdua/pi-subagents`): `cli-review`, `directory-mode-e2e`, `effort-hold`, `jev-base`, `main-effort`, `setup`, `skill-delivery`, `strategy-advice`, `tuning-host`, `verbose-log`, `worker-routing`, `q5-q6-main`, the kept parts of `launch-policy-evidence` and `context-mode`
- [x] 3.6 Run `bun run test` for `tests/host/` and fix fallout

## 4. Q4 evidence on jev-pilot sessions

Blocked by: 3

- [ ] 4.1 Move the Q4 test from `tests/host/q3-q4-child.test.ts` to `tests/host/q4-child.test.ts` on a `jev+executor` session, keeping the `"WG-02 Q4"` marker; delete `q3-q4-child.test.ts`
- [ ] 4.2 `docs/evidence/2026-11-05-host-seams.md`: mark Q3 and the service launch escalation section moved to `ttdua/pi-subagents` (answers kept, no `tests/host/` citation); link `executor-launch-policy` by URL into `ttdua/pi-subagents`; Q4 cites `tests/host/q4-child.test.ts`
- [ ] 4.3 `tests/host/evidence.test.ts`: `PINNED` = Q4–Q6, Q3 moved check, links point to the executor repository URL, replacing test for Q1/Q2/Q7 = jev-pilot's kept launch policy host test; covers `host-seam-evidence` scenarios

## 5. Docs, release metadata and decision record

Blocked by: 2, 3

- [ ] 5.1 `tests/release-check.ts` and `tests/release.test.ts`: executor install line pinned to the dev-dependency tag and before the jev-pilot install (`release-metadata` scenarios); see them fail
- [ ] 5.2 `README.md` and `docs/usage-guide.md`: install `git:github.com/ttdua/pi-subagents@v0.1.1` first, then `git:github.com/ttdua/pi-jev-pilot@v0.6.0`; say worker routing needs the executor; replace the uninstall-the-original advice
- [ ] 5.3 New `docs/decisions/0010-executor-as-installed-package.md`; mark 0009 superseded in it and in `docs/decisions/README.md`
- [ ] 5.4 Update `docs/architecture.md`, `docs/project-brief.md`, `docs/glossary.md`, `docs/testing.md`, `docs/roadmap.md` for the separate executor, capability detection and the pinned dev dependency; `NOTICE.md`: drop the vendored entries and name `ttdua/pi-subagents`; `openspec/config.yaml` context: executor is `@ttdua/pi-subagents`, installed separately
- [ ] 5.5 `package.json` version `0.6.0`; `CHANGELOG.md` `## [0.6.0]` with the breaking install change and migration (`v0.6.0`, date)

## 6. Whole-change verification

Blocked by: 2, 4, 5

- [ ] 6.1 `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun run test` all pass
- [ ] 6.2 `rg -n "packages/pi-subagents|VENDORED|vendored executor|executor-only|duplicate executor|test:executor" --glob '!openspec/**' --glob '!CHANGELOG.md' --glob '!docs/evidence/**' --glob '!docs/decisions/**'` returns nothing outside history
- [ ] 6.3 E2E: in a temp `PI_CODING_AGENT_DIR`, `pi install` the executor at `v0.1.1` and this checkout; `/jev` shows `executor: @ttdua/pi-subagents`; without the executor `/jev` shows `executor: no executor; worker routing is off`
- [ ] 6.4 `openspec validate extract-pi-subagents --strict`; after archive, the 13 emptied capability folders under `openspec/specs/` are gone (hand-delete any that remain)
