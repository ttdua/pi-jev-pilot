## Why

The executor is vendored in `packages/pi-subagents`, so jev-pilot owns code, tests and specs that are not about Jev. It now lives in `ttdua/pi-subagents` (`v0.1.1`) with its own specs and tests. Keeping a second copy here doubles maintenance and ties every executor change to a jev-pilot release. jev-pilot should consume an installed executor through its service and events, use any compatible one, and work without one (ttdua/pi-jev-pilot#98).

## What Changes

**Package and install** (BREAKING)
- From: one `pi install git:github.com/ttdua/pi-jev-pilot` loads the vendored executor and jev-pilot; the package is `pi-jev-pilot`.
- To: the package is `@ttdua/pi-jev-pilot` and loads only `src/extension.ts`; users install `git:github.com/ttdua/pi-subagents@v0.1.1` separately for worker routing.
- Reason: the executor is a separate product with its own releases.
- Impact: breaking for installs; existing users add the executor install. Version `0.6.0`.

**Executor detection**
- From: three states decided by install path (`packages/pi-subagents/`) and `implementation === "@ttdua/pi-subagents"`: `present`, `absent`, `duplicate`; `/jev` advises uninstalling `@gotgenes/pi-subagents`.
- To: capabilities of the service in the shared slot: launch policy (`registerLaunchPolicy`), agent registry (`listAgentTypes`). Worker routing needs the launch policy. `/jev` names the executor and the capabilities it lacks. No `duplicate` state.
- Reason: work with any compatible executor; the path no longer exists.
- Impact: with the original `@gotgenes/pi-subagents`, routing stays off as before, now reported as a missing launch policy.

**Removed from this repository**
- `packages/pi-subagents/`, the root `workspaces`, `test:executor`, the CI `verify:public-types` step, `scripts/vendor-manifest.ts`, `tests/vendoring.test.ts`, the `executor-only` fixture.
- Host tests that install only the executor: `run-facts-offline`, `fleet-print`, `q3-q4-child` (Q3), `service-escalation`, `duplicate-executor`, the executor-only cases of `launch-policy-evidence`, `context-mode`, `harness`, `jev-base`, `main-effort`, `strategy-advice`.
- Specs owned by the executor repository (listed below).

**Executor for types and host tests**
- From: the workspace member `packages/pi-subagents`.
- To: dev dependency `@ttdua/pi-subagents` pinned to `github:ttdua/pi-subagents#v0.1.1`; host tests install it from `node_modules` into the isolated agent directory, offline.

## Capabilities

### New Capabilities

- `executor-boundary`: jev-pilot imports the executor for types only and talks to it through the service slot and events; also keeps the old-name docs guard for jev-pilot's own `docs/`.

### Modified Capabilities

- `package-loading`: one entry point, renamed package, the executor no longer in the manifest.
- `readiness-checks`: "Executor presence" becomes capability-based, without `duplicate`.
- `jev-command`: the status report names the executor and missing capabilities instead of the duplicate problem.
- `worker-routing`: "When routing runs" reads the launch policy capability instead of absent-or-duplicated; "Routing fails open" and "Routing is the executor's launch policy" point to the executor repository for the policy contract and register only when the capability is present.
- `main-state`: "Capabilities" sends no agents when the executor offers no agent registry; its reference moves to the executor repository.
- `agent-metadata`: "Agent facts from the snapshot" references the snapshot type of the executor repository (wording only).
- `cli-review`: "Review tool in the main session only" defines fork inline instead of referencing the removed `subagent-context-mode` (wording only).
- `host-test-harness`: the executor comes from the pinned dev dependency; no executor-only install.
- `host-seam-evidence`: Q3, launch policy and service escalation evidence removed; Q4 pinned by a jev-pilot host test.
- `release-metadata`: README install section names both packages.
- `executor-vendoring`: its last requirement moves to the new `executor-boundary` capability; the capability is removed in full.
- Removed in full (now in `ttdua/pi-subagents`): `builtin-role-agents`, `package-agents`, `executor-agent-registry`, `executor-launch-identity`, `executor-launch-policy`, `launch-metadata`, `launch-resources`, `service-launch-wait`, `structured-result`, `subagent-context-mode`, `subagent-run-facts`, `fleet-view`.

### Reworded scenarios

- `readiness-checks` "Executor presence": "Original loaded first", "Original loaded last" now expect `present` without a launch policy instead of `duplicate`.
- `jev-command` "Status report": "Duplicate executor reported" now expects the missing-launch-policy line and no uninstall advice.
- `host-test-harness`: "Executor and probe are loaded" also expects jev-pilot (`jev_review`).

## Impact

- Code: `src/host/platform/service.ts`, `src/host/platform/readiness.ts`, `src/host/commands/status-format.ts`, `src/host/worker/routing.ts`, `src/host/worker/policy.ts`, `src/host/setup.ts`.
- Manifest and tooling: `package.json`, `bun.lock`, `.github/workflows/ci.yml`, `tsconfig.json`, `.oxlintrc.json` (if it names `packages/`), `scripts/`.
- Tests: `tests/host/**`, `tests/manifest.test.ts`, `tests/ci.test.ts`, `tests/import-graph.test.ts`, `tests/docs-old-names.test.ts`, `tests/fixtures/**`.
- Docs updated: `README.md`, `NOTICE.md`, `CHANGELOG.md`, `docs/usage-guide.md`, `docs/architecture.md`, `docs/project-brief.md`, `docs/glossary.md`, `docs/testing.md`, `docs/roadmap.md`, `docs/evidence/2026-11-05-host-seams.md`, `docs/decisions/README.md`, a new decision superseding `docs/decisions/0009-vendored-executor.md`; `openspec/config.yaml` context.
- Dependencies: dev dependency `@ttdua/pi-subagents` (git tag); no runtime dependency.
