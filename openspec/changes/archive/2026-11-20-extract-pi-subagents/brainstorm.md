## Design Summary

The executor now lives in its own repository, `ttdua/pi-subagents` (package `@ttdua/pi-subagents`, release `v0.1.1`, installed with `pi install git:github.com/ttdua/pi-subagents@v0.1.1`). It carries its own specs (`builtin-role-agents`, `package-agents`, `executor-agent-registry`, `executor-launch-identity`, `executor-launch-policy`, `launch-metadata`, `launch-resources`, `service-launch-wait`, `structured-result`, `subagent-context-mode`, `subagent-run-facts`, `fleet-view`, `upstream-provenance`) and its own tests. This repository stops shipping the executor and becomes `@ttdua/pi-jev-pilot` (ttdua/pi-jev-pilot#98).

**Intent.** jev-pilot is a consumer of a subagent executor, not its owner. Users install the two packages separately. jev-pilot uses whatever compatible executor is installed and keeps every other feature when none is.

**Behavior after the change**

- Installing this repository loads one extension, `src/extension.ts`. It no longer loads an executor.
- jev-pilot finds the executor through the shared service slot and decides by what the service offers, not by its name or install path:
  - a launch policy registration (`registerLaunchPolicy`) turns worker routing on;
  - an agent registry (`listAgentTypes`) feeds the agent list;
  - the `subagents:*` events feed the worker ledger and the child registry.
- With no compatible executor, effort, skills, strategy advice, tuning, CLI review and `/jev` keep working, and jev-pilot does not touch worker launches.
- `/jev` reports which executor capability is missing instead of a "duplicate executor" and advice to uninstall `@gotgenes/pi-subagents`. The original `@gotgenes/pi-subagents` offers no launch policy, so routing stays off with it, by the same capability rule.
- Executor behavior is the executor repository's concern. This repository keeps only tests in which the jev-pilot extension runs.

**Goals**

- One-way dependency: jev-pilot depends on an executor contract (types plus the service slot and events); the executor knows nothing of jev-pilot.
- Host tests that run jev-pilot with an executor keep running offline against a pinned executor release.
- Other subagent packages work when they offer the same capabilities.

**Non-goals**

- No change to the executor itself (it is released separately).
- No change to Jev requests, decisions, routing tables or the ledger format.
- No npm publication of either package.

**Anti-goals**

- jev-pilot must not import the executor at runtime or bundle it.
- jev-pilot must not fail, block a launch or block a session when the executor is missing or partial.

## Living specs touched

Specified requirements this change alters, stated explicitly:

- `executor-vendoring`: every requirement ("Vendored executor location", "Upstream provenance", "Upstream license kept", "One install loads both extensions", "Vendored tests run on their own", "No runtime import across the two extensions", "Service identity and ownership") is removed or reworded. The runtime-import ban stays as jev-pilot's own rule. Provenance and service identity now belong to `ttdua/pi-subagents` (`upstream-provenance`, `executor-agent-registry`).
- `package-loading`: "Extension loads through a real install" and "Package manifest with the vendored executor" change from two entry points to one, and the package name changes to `@ttdua/pi-jev-pilot`.
- `readiness-checks`: "Executor presence" changes from three states (`present`, `absent`, `duplicate`, decided by install path and implementation name) to capability-based detection.
- `jev-command`: the "Duplicate executor reported" scenario is replaced by a missing-capability report.
- `worker-routing`: "When routing runs" no longer names a duplicated executor; it reads the capability.
- `host-test-harness`: "Extensions under test are installed by a real install" and "Executor comes from the vendored package" change: the executor comes from the pinned dev dependency, and the executor-only install mode goes away.
- `host-seam-evidence`: "Child tool removal" (Q3), "Launch policy host evidence" and "Service launch escalation host evidence" are executor behavior and are removed. "Child session detection" (Q4) stays because `child-registry` depends on it.
- `subagent-run-facts`: describes executor behavior and is removed (now in `ttdua/pi-subagents`).
- Executor-owned specs now held by `ttdua/pi-subagents` are removed here: `builtin-role-agents`, `package-agents`, `executor-agent-registry`, `executor-launch-identity`, `executor-launch-policy`, `launch-metadata`, `launch-resources`, `service-launch-wait`, `structured-result`, `subagent-context-mode`, `fleet-view`.

Requirements read and kept unchanged: `child-registry`, `agent-metadata`, `worker-ledger`, `status-line`, `quality-checks`, `release-metadata` (it gets a new version and a breaking-change entry).

## Alternatives Considered

### Alternative A: Executor source for host tests — local checkout through an environment variable
- **Approach**: tests read `PI_SUBAGENTS_DIR`; CI clones the executor at a tag.
- **Pros**: develop both repositories side by side without bumping a pin.
- **Cons**: types and tests come from different places; an extra CI step; local runs fail without the variable.
- **Why not chosen**: two sources of truth for one version, and an easy-to-miss setup step.

### Alternative B: Executor source for host tests — `pi install git:...` inside each test
- **Approach**: the harness installs the executor from GitHub at the tag.
- **Pros**: no dependency entry at all.
- **Cons**: breaks offline host tests (`PI_OFFLINE=1`), slow, flaky on network.
- **Why not chosen**: violates the offline requirement of `host-test-harness`.

### Alternative C: Executor detection by implementation name
- **Approach**: accept only a service whose `implementation` is `@ttdua/pi-subagents`, as today.
- **Pros**: strict; matches the existing tests.
- **Cons**: shuts out other compatible executors; still needs a "duplicate" notion.
- **Why not chosen**: the user wants other compatible subagent packages to work.

### Alternative D: Keep executor-only host tests as contract tests
- **Approach**: keep the executor-only host tests here, run against the pinned release.
- **Pros**: catches executor regressions when the pin is bumped.
- **Cons**: duplicates the executor repository's own tests and keeps executor behavior specified in two places.
- **Why not chosen**: the user chose that executor behavior belongs to `ttdua/pi-subagents` only.

## Agreed Approach

Remove the vendored executor; jev-pilot detects the executor by capability; the executor for types and host tests is a dev dependency pinned to the `v0.1.1` git tag of `ttdua/pi-subagents`, installed into the isolated agent directory from `node_modules`, so host tests stay offline. Tests and requirements that install only the executor are deleted; those in which jev-pilot runs are kept and use the pinned executor.

## Key Decisions

- Package names: `@ttdua/pi-subagents` (executor, separate repository) and `@ttdua/pi-jev-pilot` (this repository).
- Install: both packages from git; neither is published to npm.
- Detection by capability: `registerLaunchPolicy` for routing, `listAgentTypes` for agents, `subagents:*` events for the ledger and child registry. No `duplicate` state.
- Test rule: a test or requirement whose session installs only the executor, without the jev-pilot extension, is removed. Removed host tests: `run-facts-offline`, `fleet-print`, `q3-q4-child` (Q3 parts; Q4 moves to a kept test if it is not already covered), `service-escalation`, the executor-only describe block of `launch-policy-evidence`, and the executor-only cases of `context-mode`, `harness`, `jev-base`, `main-effort` and `strategy-advice`. The `executor-only` fixture goes.
- The pinned executor is the single source for types and host tests; bumping it is a reviewed change.
- Release: breaking install change, version `0.6.0`, with migration notes in the changelog and README.

## Open Questions

- Whether `/jev` should name the detected executor implementation (for example `executor: @ttdua/pi-subagents`) or only the capabilities. Default unless told otherwise: name the implementation when the service reports one, and list missing capabilities.
