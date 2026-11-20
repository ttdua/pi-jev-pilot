# 0010: The executor is an installed package, detected at run time

**Status:** Accepted, 2026-11-20. Supersedes [0009](0009-vendored-executor.md).

## Context

[ADR 0009](0009-vendored-executor.md) vendored the executor into `packages/pi-subagents/`. That kept the seams under our control, but this repository carried a second toolchain, a manifest test and a sync procedure, and one install bundled two extensions. The executor now has its own repository, [ttdua/pi-subagents](https://github.com/ttdua/pi-subagents), with its own tests and releases.

## Decision

- Remove `packages/`. jev-pilot is one package with one extension; the executor is installed beside it with its own `pi install`, executor first.
- Detect capabilities at run time from the service the executor publishes: a launch policy, an agent registry, an implementation name. Without them, worker routing is off and `/jev` says why. Nothing is inferred from install state.
- Pin the executor tag as a dev dependency (`github:ttdua/pi-subagents#v0.1.1`). The host harness installs it from `node_modules`, and the release test requires the documented install line to match the pin.
- Keep `src/` free of runtime imports from the executor; types only.

## Consequences

- Two install commands instead of one, and a migration note for 0.5.x users. `/jev` no longer prints uninstall advice, because detection is by capability. Two executors still cannot coexist: Pi refuses to start with two `subagent` tools, so the old one must be removed first. The original `@gotgenes/pi-subagents` has no launch policy and leaves routing off.
- Executor-only tests, the vendoring manifest and the sync procedure leave this repository. Executor evidence (Q3, service escalation) is cited from there.
- A new executor release is adopted by bumping the pin, which reruns the host tests.
- Other executors can work if they publish the same service facts.
