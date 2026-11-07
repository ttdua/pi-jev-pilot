## Why

The first release sends a minimal main state. Five richer field groups (`last_decision`, `context_used_percent`, `workspace.git`, `workspace.languages`, `capabilities`) were designed but held off until replay shows they help (roadmap WG-16, issue #17). There is no replay tooling in the repository, and the earlier one-off scripts are gone. WG-09 and WG-13 are done, so requests now have their final shape and the groups can be decided.

## What Changes

- **Rich field builders.** Pure builders for the five groups go into `src/jev/`. `mainState` accepts any subset of them. The host passes only the groups listed as shipped, and that list starts empty, so behaviour is unchanged until a group is decided.
- **Session and workspace readers move to `jev/`.** The session reader (`branchItems`) and the platform scan move from `src/host/` to `src/jev/`, so `scripts/replay` can reuse them under the existing lint boundaries. The host imports them back. This is a refactor; behaviour does not change.
- **Git count recorder.** It is off unless `JEV_REPLAY_GIT=1` is set. For each eligible main prompt it appends one line to `<agentDir>/jev/replay-git.jsonl`, holding the turn id and the two counts only.
- **Capabilities snapshot.** A manual procedure, `tests/host/manual/capabilities-snapshot.ts`, writes today's tools and agents to a private file for replay.
- **`scripts/replay`.**
  - Reads local sessions and samples a corpus.
  - Rebuilds each request with the package's builders and builds the variants.
  - Prints the request count and an estimated cost, and calls Jev only with `--send`.
  - Writes aggregates and a private table of differing cases under `<agentDir>/jev/replay/`.
- **Two replay passes.** Each runs only with the operator's approval at that time. Pass 1 covers `last_decision`, `context_used_percent`, `languages`, `capabilities`, reversed `effort` options, and the worker variants (`parent_request`, agent description, agent instructions). Pass 2 was planned to cover `git` after a few days of recorded counts.
- **Outcome** (design D9, D10):
  - `last_decision` and `capabilities` ship;
  - the effort option order becomes `high, medium, xhigh, low, max`;
  - `context_used_percent`, `languages` and `git` are removed, together with the git recorder and pass 2;
  - the worker defaults are unchanged.
- **Decisions applied.** A kept group is added to the shipped list and documented. A removed group has its builder deleted. Removed worker fields are dropped from `buildWorkerState`. The evidence goes in `docs/evidence/`.

## Capabilities

### New Capabilities
- `state-replay`: the offline replay script. It covers corpus sampling, variant building, the dry run and cost estimate, the explicit send, Jev failure handling, the comparison against noise, and the private and aggregate outputs.

### Modified Capabilities
- `main-state`: `mainState` gains optional rich field groups, with their build rules. Each group is sent only when it is listed as shipped. The minimal field set stays the default.

The `worker-request` capability is not modified up front. If pass 1 removes agent `description` or `instructions_excerpt`, or makes `parent_request` the default, its delta is added to this change once that is decided.

## Impact

- **Code:**
  - `src/jev/state.ts`, plus new `src/jev/workspace.ts` and `src/jev/branch.ts`;
  - `src/host/context.ts` (re-exports), `src/host/main.ts` (rich inputs and the recorder), and a new `src/host/git-record.ts`;
  - new `scripts/replay/`, and `tests/host/manual/capabilities-snapshot.ts`.
- **Tests:**
  - new unit tests for the builders and the replay script, run against the loopback Jev fixture and fixture sessions;
  - a host test that the default main state stays minimal;
  - recorder tests.
- **Docs:**
  - `docs/jev-contract.md` (field rules, the shipped note);
  - `docs/privacy.md` (the recorder, and the pending table once decided);
  - `docs/testing.md` (replay and snapshot procedures);
  - `docs/architecture.md` (module moves);
  - `docs/roadmap.md` (WG-16 status);
  - `docs/configuration.md` (only if a decision changes the worker default);
  - new `docs/evidence/<date>-state-replay.md` for pass 1 and `docs/evidence/<date>-git-replay.md` for pass 2.
- **No new dependency.** No config key, command, or ledger format change.
