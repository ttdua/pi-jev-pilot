## 1. Replay variants and turn-size side measure

Blocked by: none

- [x] 1.1 Keep `toolCalls` (non-negative integer only) in `readLedgerLines` (`scripts/replay/sessions.ts`); make `mainSamples` take the ledger as a parameter with the CLI passing the `<agentDir>/jev` ledger; carry the sample's own turn size on `MainSample` (`scripts/replay/corpus.ts`), found through the first `jev-turn` entry after the prompt as `startEffortOf` does
- [x] 1.2 Add the `role-rule` variant in `scripts/replay/variants.ts`: base `full`, needs the `full` groups, `effort.instructions` replaced by the candidate text from design D2, criteria and order unchanged
- [x] 1.3 Add the `no-prompt-chars` variant: base `full`, the `full` state with `request.prompt_chars` removed
- [x] 1.4 Make `baseOfKey` map both new ids to `full`, make `--only` with either name also plan `full`, keep both ids valid for `--only` without a snapshot, and list both as skipped without a snapshot
- [x] 1.5 Add `size` (`large`/`small` × `raised`/`same`/`lowered`, plus `unknown`) to every main variant other than `minimal` and the reruns in `scripts/replay/compare.ts`, counts only, misses and undecided effort excluded
- [x] 1.6 Extend fixtures under `tests/fixtures/replay/sessions/` with `toolCalls` and cover every new scenario in `tests/replay/` (variants, corpus/sessions, compare, cli `--only`)
- [x] 1.7 Document both variants and `size` in `docs/testing.md`

## 2. Replay run and evidence

Blocked by: 1

- [x] 2.1 Save the capabilities snapshot and do the dry run `bun scripts/replay/cli.ts --pass 1 --capabilities <scratch>/capabilities.json --only role-rule,no-prompt-chars`; report sample counts, exclusions, request count and cost to the operator
- [x] 2.2 After the operator approves data and cost, run the same command with `--send`
- [x] 2.3 Write `docs/evidence/<date>-effort-reply-replay.md` with aggregates only: flips against noise, `size` per variant, misses and exclusions; then the operator reads `cases.md` and gives a verdict per variant (ships / does not ship)
- [x] 2.4 Delete the private run directory under `<agentDir>/jev/replay/` after the verdict, and record each verdict in the evidence and in `docs/roadmap.md` (the "Effort rubric revision" row)

## 3. Ship the role-based reply rule (only if `role-rule` won)

Blocked by: 2

- [x] 3.1 Replace the last sentence of `MAIN_EFFORT_INSTRUCTION` in `src/jev/rubrics.ts` with the measured candidate text, and update the main instruction in `docs/jev-questions.md` to match
- [x] 3.2 Update `tests/jev/questions.test.ts` for the new text, no `short`, and the worker instruction unchanged; keep the Jev-500 host test green
- [x] 3.3 Remove the `role-rule` variant and its candidate constant from `scripts/replay/variants.ts` and its tests, since it now equals `full`, and remove every normative reference to `role-rule` from `specs/state-replay/spec.md` and `docs/testing.md` as design D6 lists
- [x] 3.4 Not applicable: `role-rule` won (see docs/evidence/2026-11-15-effort-reply-replay.md). If `role-rule` lost: ship nothing and keep the variant; close this group unticked with a note in `tasks.md`, and delete `specs/main-effort/spec.md` from the change before verify

## 4. Drop `prompt_chars` (only if `no-prompt-chars` won)

Blocked by: 2, 3

- [ ] 4.1 Remove `prompt_chars` from `RequestSignals` and `requestSignals` in `src/jev/state.ts`, and update `tests/jev/state.test.ts`
- [ ] 4.2 Assert in `tests/host/main-effort.test.ts` ("default request state") that `state.request` has no `prompt_chars` key for an 800-character prompt
- [ ] 4.3 Update `docs/jev-contract.md` (main state example and the `request` table)
- [ ] 4.4 Remove the `no-prompt-chars` variant from `scripts/replay/variants.ts` and its tests, since it now equals `full`, and remove every normative reference to `no-prompt-chars` from `specs/state-replay/spec.md` and `docs/testing.md` as design D6 lists
- [ ] 4.5 If `no-prompt-chars` lost: ship nothing and keep the variant; close this group unticked with a note in `tasks.md`, and delete `specs/main-state/spec.md` from the change before verify
