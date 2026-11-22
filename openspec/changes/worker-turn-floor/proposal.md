## Why

The main model picks a worker's `max_turns` itself, often 20 or 40, whatever the size of the brief. When that limit is too tight, the executor stops the run at the ceiling, the run ends `aborted` and its work is lost. Jev already reads the brief, so it can tell when a task needs more turns. `@ttdua/pi-subagents` v0.2.0 now accepts a raise-only `maxTurns` from a launch policy, so jev-pilot can add this preventive guard (issue #102).

## What Changes

- New worker question `turns`: the expected workload as a choice over `short`, `medium`, `long`, `very_long`. It is asked only when the launch has a turn limit (`requested.maxTurns`) and the agent does not lock `max_turns`.
- New pure turn floor: the band probabilities give a floor (`medium` 40, `long` 100, `very_long` 200, `short` none). Routing writes `maxTurns` only when the floor is greater than the requested limit.

**Launches left untouched**
- From: a launch whose agent locks both `model` and `thinking`, or a fork with `subagents.forkLaunch` `untouched`, sends no worker request.
- To: such a launch sends a request asking `turns` only when it has a turn limit that is not locked; model and thinking stay untouched.
- Reason: the turn limit is a separate field, and locking model and thinking does not lock it.
- Impact: non-breaking; adds one Jev call for those rare launches.

**Input mutation**
- From: the adjustment carries only `model` and `thinking`.
- To: it may also carry `maxTurns`, raise-only.
- Reason: the executor's new raise-only field.
- Impact: non-breaking; launches with no limit, with a locked limit or with a limit at or above the floor are unchanged.

- Worker ledger line gains `requestedTurns`, `turnsP` and `turnFloor`.
- The `subagents` switch covers the turn floor; no new switch or config key.
- Fail open: a Jev failure, timeout or unanswered `turns` writes no `maxTurns`.
- Bump the `@ttdua/pi-subagents` dev dependency and the install lines from `v0.1.1` to `v0.2.0`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `worker-request`: the `turns` question, its wording and when the question set includes it.
- `worker-decision`: the pure turn floor rule; launches left untouched may still send a `turns`-only request.
- `worker-routing`: the request content for `turns`, and `maxTurns` in the adjustment.
- `worker-ledger`: the new turn fields on the worker line.
- `decision-ledger`: the `turns distribution` domain and the three new worker fields in the schema table.

## Impact

- Code: `src/jev/rubrics.ts`, `src/jev/questions.ts`, `src/policy/launch.ts`, `src/policy/worker/` (new turn floor module, `route.ts` launch kind, `worker-line.ts`), `src/host/worker/` (`request.ts`, `classify.ts`, `route.ts`, `policy.ts`, `entry.ts`, `outcomes.ts`), `src/store/ledger-schema.ts`.
- Dependency: `package.json` devDependency `@ttdua/pi-subagents` to `#v0.2.0`, `bun.lock`.
- Tests: `tests/policy/worker/`, `tests/jev/questions.test.ts`, `tests/host/worker-routing.test.ts`, `tests/host/worker-ledger.test.ts`, `tests/store/ledger-schema.test.ts`, `tests/release.test.ts`, `tests/store/ledger-pin.test.ts`. `tests/host/evidence.test.ts` and `docs/evidence/` keep their `v0.1.1` links on purpose: they cite dated evidence.
- Docs: `README.md` (feature table, install line), `docs/usage-guide.md` (install line), `docs/jev-questions.md`, `docs/jev-contract.md`, `docs/scenarios.md`, `docs/configuration.md` (the `subagents` switch scope), `CHANGELOG.md`.
