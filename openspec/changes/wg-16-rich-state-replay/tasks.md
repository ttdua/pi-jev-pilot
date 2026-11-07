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

- [ ] 4.1 `scripts/replay/sessions.ts`: read session files into entries and branches, find the main prompts and `subagent` launches, and read the ledger with a local line parser. Test it with fixture sessions under `tests/fixtures/replay/`.
- [ ] 4.2 `scripts/replay/corpus.ts`: seeded, stratified sampling with exclusions, plus the "Same seed" and "Exclusions" tests.
- [ ] 4.3 `scripts/replay/inputs.ts`: rebuild `last_decision`, `context_used_percent`, `languages`, `capabilities` and `git`, with exclusion counts, and test the "Replay inputs" and "Capabilities snapshot" scenarios. Add a test that the main state equals the host's ("Same state as live").
- [ ] 4.4 `scripts/replay/variants.ts`: build the pass 1 and pass 2 plans, including the reversed `effort` options and the worker variants, with tests.
- [ ] 4.5 `scripts/replay/run.ts`: concurrency 8, a 5000 ms timeout, one retry, and miss counting. Test the dry run, the send and the Jev failure scenarios against the loopback fixture.
- [ ] 4.6 `scripts/replay/compare.ts`: flips per key, noise as the larger of the two reruns, the beyond-noise mark, `aggregates.json` and `cases.md` written owner-only under `<agentDir>/jev/replay/<run-id>/`. Test the output scenarios.
- [ ] 4.7 `scripts/replay/cli.ts`: the flags (`--pass`, `--seed`, `--main`, `--workers`, `--capabilities`, `--models`, `--url`, `--send`) and plain-JSON config reading. Add `tests/host/manual/capabilities-snapshot.ts`.
- [ ] 4.8 In `docs/testing.md`, document the replay procedure, the snapshot procedure and `JEV_REPLAY_GIT`. In `docs/privacy.md`, document the recorder file.

## 5. Pass 1 (operator approval required)

- [ ] 5.1 Dry-run pass 1, then send the counts and the estimated cost to the operator. Wait for approval.
- [ ] 5.2 Run pass 1 with `--send`. Share `aggregates.json` and `cases.md` privately with the operator.
- [ ] 5.3 Record the operator's decision per group (`last_decision`, `context_used_percent`, `languages`, `capabilities`), the effort option order, and each worker field.
- [ ] 5.4 Write `docs/evidence/<date>-state-replay.md`, aggregates only.
- [ ] 5.5 Apply the pass 1 decisions:
  - a kept group goes into `SHIPPED_MAIN_GROUPS`;
  - a removed group has its builder, tests, contract rule and delta requirement deleted;
  - add the `worker-request` delta and code if a worker field changes;
  - fix the effort order if the operator chooses one;
  - update `docs/jev-contract.md` and `docs/privacy.md`.

## 6. Pass 2: git (operator approval required)

- [ ] 6.1 With the operator, start recording (`JEV_REPLAY_GIT=1`). After a few days, dry-run pass 2 and send the counts and the cost. Wait for approval.
- [ ] 6.2 Run pass 2 with `--send`, and record the operator's git decision.
- [ ] 6.3 Write `docs/evidence/<date>-git-replay.md`. Apply the git decision as in 5.5. Remove the recorder and its spec unless the operator wants it kept for later replays.
- [ ] 6.4 Update `docs/roadmap.md` (WG-16 Done) and the contract's IMPORTANT note, and clear the pending line in `docs/privacy.md`.
