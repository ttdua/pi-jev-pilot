## 1. Shared readers in jev/

- [x] 1.1 Move `branchItems` into a new `src/jev/branch.ts`, with a structural entry type and no Pi import. `src/host/context.ts` re-exports it, and the existing context tests pass unchanged.
- [x] 1.2 Move `scanPlatforms` and its marker table into a new `src/jev/workspace.ts`. `src/host/context.ts` re-exports it, and the existing tests pass unchanged.
- [x] 1.3 Update `docs/architecture.md` (module tree) for the moved readers.

## 2. Rich field builders

- [x] 2.1 Add the `RichInputs` type, the `SHIPPED_MAIN_GROUPS` constant (empty) and the optional group placement to `mainState`, with tests for "One group alone" and "Every group".
- [x] 2.2 Build `last_decision` and `context_used_percent` (omission, rounding, clamping), with tests.
- [x] 2.3 Add `parseShortstat` for `workspace.git`, with tests.
- [x] 2.4 Add `scanLanguages` in `src/jev/workspace.ts` (depth, entry cap, skips, thresholds, ranking), with tests.
- [x] 2.5 Add the `capabilities` builder (first sentence, cuts, caps, name order), with tests.

## 3. Host wiring

- [x] 3.1 Add `src/host/rich.ts` (`buildRichInputs`), `src/host/git.ts` (`gitCounts`, which needs exit code 0 and a 500 ms race) and `listAgents` in `src/host/agents.ts`. In `src/host/main.ts`, keep `lastDecided` and make one rich call. Wire them in `src/host/setup.ts`. Add a host test that the default request stays minimal ("Rich inputs ignored unless shipped").
- [x] 3.2 Add `src/host/git-record.ts`: behind `JEV_REPLAY_GIT=1`, after the decision, append to `<agentDir>/jev/replay-git.jsonl` (owner-only, capped at 5000 lines, fail open), sharing the git result from 3.1. Test every `git-count-record` scenario.

## 4. Replay script

- [x] 4.1 `scripts/replay/sessions.ts`: read session files into entries and branches, find the main prompts and `subagent` launches, and read the ledger with a local line parser. Test it with fixture sessions under `tests/fixtures/replay/`.
- [x] 4.2 `scripts/replay/corpus.ts`: seeded, stratified sampling with exclusions, plus the "Same seed" and "Exclusions" tests.
- [x] 4.3 `scripts/replay/inputs.ts`: rebuild `last_decision`, `context_used_percent`, `languages`, `capabilities` and `git`, with exclusion counts, and test the "Replay inputs" and "Capabilities snapshot" scenarios. Add a test that the main state equals the host's ("Same state as live").
- [x] 4.4 `scripts/replay/variants.ts`: build the pass 1 and pass 2 plans, including the reversed `effort` options and the worker variants, with tests.
- [x] 4.5 `scripts/replay/run.ts`: concurrency 8, a 5000 ms timeout, one retry, and miss counting. Test the dry run, the send and the Jev failure scenarios against the loopback fixture.
- [x] 4.6 `scripts/replay/compare.ts`: flips per key, noise as the larger of the two reruns, the beyond-noise mark, `aggregates.json` and `cases.md` written owner-only under `<agentDir>/jev/replay/<run-id>/`. Test the output scenarios.
- [x] 4.7 `scripts/replay/cli.ts`: the flags (`--pass`, `--seed`, `--main`, `--workers`, `--capabilities`, `--models`, `--url`, `--send`) and plain-JSON config reading. Add `tests/host/manual/capabilities-snapshot.ts`.
- [x] 4.8 In `docs/testing.md`, document the replay procedure, the snapshot procedure and `JEV_REPLAY_GIT`. In `docs/privacy.md`, document the recorder file.

## 5. Pass 1 (operator approval required)

- [x] 5.1 Dry-run pass 1, then send the counts and the estimated cost to the operator. Wait for approval.
- [x] 5.2 Run pass 1 with `--send`. Share `aggregates.json` and `cases.md` privately with the operator.
- [x] 5.3 Record the operator's decision per group (`last_decision`, `context_used_percent`, `languages`, `capabilities`), the effort option order, and each worker field.
- [x] 5.4 Write `docs/evidence/<date>-state-replay.md`, aggregates only.
- [x] 5.5 Apply the pass 1 decisions (design D9):
  - `last_decision` and `capabilities` go into `SHIPPED_MAIN_GROUPS`;
  - remove `context_used_percent` and `languages`, with their builders (`shapeContextPercent`, `scanLanguages`), host and replay inputs, tests and contract rules;
  - worker defaults are unchanged, so no `worker-request` delta is needed;
  - update `docs/jev-contract.md`, `docs/privacy.md` and `docs/architecture.md`.
- [x] 5.6 Add the `effort-order` replay variants for main and worker (design D9), then dry-run, get operator approval, and send. Report the shift against the current order.
- [x] 5.7 After the operator rules on the measured order: change the `effort` option order in `src/jev/rubrics.ts` and `EFFORT_LEVELS` for both main and worker, keeping `EFFORT_LADDER` as the rank order. Record the result in the evidence.

## 6. Pass 2: git (dropped by the operator, design D10)

- [x] 6.1 Remove the `git` rich group, `parseShortstat`/`GitCounts`, `src/host/git.ts`, `src/host/git-record.ts`, `MainDeps.record`/`rich.git`, `JEV_REPLAY_GIT`, and pass 2 of `scripts/replay` (`--pass 2`, `--kept`, `readGitMap`, git variants), with their tests.
- [x] 6.2 Update `docs/jev-contract.md`, `docs/privacy.md`, `docs/testing.md`, `docs/architecture.md`, `docs/project-brief.md` and the evidence: git is removed and nothing is pending.
- [x] 6.3 Mark WG-16 Done in `docs/roadmap.md`, and remove the "Rich state fields stay off until WG-16" working agreement line, or mark it settled.
