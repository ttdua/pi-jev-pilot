# Effort Reply by Context Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Measure a role-based main effort follow-up rule and the removal of `request.prompt_chars` through two replay variants with a turn-size side measure, then ship each change only if its variant wins.

**Architecture:**
- Task 1 extends the offline replay (`scripts/replay/`):
  - two `full`-based variants;
  - the turn size of each sample, read from the ledger;
  - a counts-only `size` aggregate.
- Task 2 runs the replay against real Jev, with the operator's approval, and writes aggregate evidence.
- Tasks 3 and 4 ship one change each into `src/jev/` and the docs, conditional on the operator's verdict. Each removes its variant afterwards.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun check`), oxlint/oxfmt, TypeSafe Jev (replay only).

## Global Constraints

- Tests need no secrets, paid calls or network beyond loopback. Only Task 2's `--send` run calls Jev, and only after operator approval.
- Never store prompt text. `aggregates.json` and the committed evidence hold counts only. `cases.md` stays under `<agentDir>/jev/replay/`, owner-only, and is deleted after the decision.
- `scripts/replay/` must not import `src/host/`, `src/store/` or `@earendil-works/*` (lint boundary).
- Public repository: code, docs, evidence and commits in English, with no real prompts.
- The `large` turn threshold is exactly 15 tool calls (`>= 15`).
- The candidate sentence is the D2 text, word for word (see Contracts).
- Verify per task: `bun test`, `bun check`, `bun run lint`, `bun run fmt:check`.

## Review Focus

1. **Turn join leaks across turns.** A prompt whose own turn has no `jev-turn` entry must not take the next turn's or a sibling branch's `toolCalls`. Pinned by the "next turn not borrowed" test in Task 1.
2. **Selecting one new variant drops its base.** `--only role-rule` without `full` would plan candidates with no pair. Pinned by the "only a new variant" test in Task 1.
3. **Malformed ledger values.** `toolCalls` given as a string, negative or fractional must give "no size", never `NaN` buckets. Pinned in Task 1.
4. **Undecided effort counted as `same`.** A pair where one side has no effort key must stay out of `size`. Pinned in Task 1.
5. **Docs and code drift on the instruction.** The shipped `MAIN_EFFORT_INSTRUCTION` must equal `docs/jev-questions.md` verbatim. Pinned by the existing verbatim test plus the D2 literal test in Task 3.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `LedgerMain` (`scripts/replay/sessions.ts`) | modified | `{ effective?: string; strategy?: string; from?: string; toolCalls?: number }`. `toolCalls` is set only when `Number.isInteger(v) && v >= 0` | no |
| `mainSamples` (`scripts/replay/corpus.ts`) | modified | `mainSamples(dir: string, ledger: ReturnType<typeof readLedgerLines>): MainSample[]`. The ledger is passed in, no longer read from `dir`. The CLI passes `setup.ctx.ledger`, read from `<agentDir>/jev` | no |
| `turnToolCallsOf` (`scripts/replay/corpus.ts`, module-private) | new | `turnToolCallsOf(entries: readonly SessionEntry[], index: number, ledger: ReturnType<typeof readLedgerLines>): number \| undefined`, built on `walkBranch` like `startEffortOf` | no |
| `MainSample` (`scripts/replay/corpus.ts`) | modified | adds `toolCalls?: number`, the own turn's ledger `toolCalls` | no |
| `ROLE_RULE_SENTENCE` (`scripts/replay/variants.ts`, exported) | new, removed in Task 3 (`role-rule` won and shipped into `MAIN_EFFORT_INSTRUCTION`) | `string`, exactly: `A reply to the assistant's own question, proposal, review or approval request, such as approving it, picking an option, answering it or asking to continue, whatever its length and however it is formatted, takes the size of the work it approves or starts, judged from the recent conversation rather than from the reply's own text.` | no |
| `roleRuleInstruction(shipped: string): string` (`scripts/replay/variants.ts`, exported) | new, removed in Task 3 | returns `shipped` cut before its `A short reply` sentence, plus `ROLE_RULE_SENTENCE`. Throws `Error` when `A short reply` is absent | no |
| `MainVariant` (`scripts/replay/variants.ts`) | modified | adds `edit?: "no-prompt-chars"` (Task 3: `role-rule` removed) | no |
| `NEW_FULL_VARIANTS` (`scripts/replay/variants.ts`) | new | `readonly ["no-prompt-chars"]` after Task 3 (`role-rule` won and shipped, so it left the replay; it was `["role-rule", "no-prompt-chars"]` in Task 1). The ids are always valid for `--only`; they are planned only with a snapshot | no |
| `Plan.skipped` content | modified | without a snapshot, it holds `"capabilities"`, `"workers"` and `"no-prompt-chars"` (Task 3 removed `"role-rule"`), printed on the existing `skipped:` line | no |
| `--only no-prompt-chars` (`--only role-rule` removed in Task 3) | new | operator CLI names for pass 1 that also plan `full`, `minimal`, `rerun-a` and `rerun-b` | yes (operator-facing CLI, documented in `docs/testing.md`) |
| `SizeAggregate` (`scripts/replay/compare.ts`, exported) | new | `{ large: { raised: number; same: number; lowered: number }; small: { raised: number; same: number; lowered: number }; unknown: number }` | no |
| `VariantAggregate.size` | modified | `size?: SizeAggregate`, present for main variants other than `minimal`, `rerun-a` and `rerun-b` | no |
| `CompareMeta.toolCalls` | new | `toolCalls?: readonly (number \| undefined)[]`, indexed by main sample index | no |
| `countSize` (`scripts/replay/compare.ts`, module-private) | new | `countSize(size: SizeAggregate, own: Decided, base: Decided, toolCalls: number \| undefined): void`. `compare` calls it per decided main pair, with `meta.toolCalls?.[pair.req.sample]`; `countPair` keeps its signature | no |
| `aggregates.json` (pass 1) | modified | each main variant except the bases gains `size` (`SizeAggregate`) | no (private operator output) |
| `MAIN_EFFORT_INSTRUCTION` (`src/jev/rubrics.ts`) | modified (Task 3, if `role-rule` wins) | `roleRuleInstruction(<current>)`, written out as a literal | yes (wire text sent to Jev, mirrored in `docs/jev-questions.md`) |
| `RequestSignals` (`src/jev/state.ts`) and main state `request` | modified (Task 4, if `no-prompt-chars` wins) | `{ text: string; files_mentioned: number; has_code_or_error: boolean; is_question: boolean }` | yes (Jev main state, `docs/jev-contract.md`) |

---

## Task 1: Replay variants and turn-size side measure — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Modify:
  - `scripts/replay/sessions.ts` (`LedgerMain`, `readLedgerLines`)
  - `scripts/replay/corpus.ts` (`MainSample`, `mainSamples` signature, `turnToolCallsOf`)
  - `scripts/replay/variants.ts` (`MainVariant`, `mainVariants`, `variantIds`, `selected`, `baseOfKey`, `planMain`, `planPass`, `NEW_FULL_VARIANTS`, `ROLE_RULE_SENTENCE`, `roleRuleInstruction`)
  - `scripts/replay/compare.ts` (`SizeAggregate`, `CompareMeta`, `compare`, `countSize`)
  - `scripts/replay/cli.ts` (`sampleInputs` passes `setup.ctx.ledger`; `replayPass1` passes `toolCalls`)
  - `docs/testing.md`
- Fixtures:
  - `tests/fixtures/replay/sessions/ledger.jsonl` (add `toolCalls` to the existing `turn-2` line)
  - new `tests/fixtures/replay/size/size.jsonl`, `ledger.jsonl` (two consecutive prompts, a sibling branch, turns of 15 and 14 calls); a separate directory, so existing corpus counts do not change
- Test:
  - `tests/replay/sessions.test.ts`, `tests/replay/corpus.test.ts`
  - `tests/replay/variants.test.ts`, `tests/replay/compare.test.ts`, `tests/replay/cli.test.ts`

**Interfaces:**
- Produces: every Task 1 row of Contracts.
- Consumes:
  - `mainState`, `pickRich`, `mainQuestions`, `MAIN_EFFORT_INSTRUCTION` and `EFFORT_LEVELS` (`src/jev/`, `src/policy/`).
  - `walkBranch` (existing in `corpus.ts`).

- [ ] **Step 1: Failing tests for the ledger and the turn join**
  - `sessions.test.ts` "keeps toolCalls only as a non-negative integer": ledger lines with `toolCalls` 20, 0, -1, 2.5 and `"7"`. Expect `get(id)?.toolCalls` to be 20, 0, then `undefined` three times.
  - `corpus.test.ts`: existing calls become `mainSamples(dir, readLedgerLines(dir))`, with expectations unchanged. On `tests/fixtures/replay/size/`:
    - "turn size joins the own turn's ledger line": the turns give `toolCalls` 15 and 14.
    - "next turn not borrowed": the first prompt has no `jev-turn` entry, the second has one with 20, and a sibling branch of the first has one with 30. Expect `undefined` for the first sample and 20 for the second.
- [ ] **Step 2: Run them and see them fail**
  - Run: `bun test tests/replay/sessions.test.ts tests/replay/corpus.test.ts`.
  - Expected: FAIL on the new tests.
- [ ] **Step 3: Implement**
  - `readLedgerLines` keeps `toolCalls`.
  - `mainSamples(dir, ledger)` sets `toolCalls` from `turnToolCallsOf`.
  - `cli.ts` `sampleInputs` calls `mainSamples(setup.sessionsDir, setup.ctx.ledger)`.
- [ ] **Step 4: Run them and see them pass**
  - Same command. Expected: PASS.
- [ ] **Step 5: Failing variant tests in `variants.test.ts`**
  - "role-rule variant":
    - base is `full`, and state equals `full`'s state for the same sample;
    - every question except `effort` equals `full`'s;
    - `effort.criteria` equals `full`'s;
    - `effort.instructions === roleRuleInstruction(MAIN_EFFORT_INSTRUCTION)`, which ends with `ROLE_RULE_SENTENCE` and has no `/\bshort\b/`.
  - "roleRuleInstruction throws without the short-reply sentence": `expect(() => roleRuleInstruction("x")).toThrow()`.
  - "no-prompt-chars variant": base `full`, questions equal `full`'s, and `state` deep-equals `full`'s state with `request.prompt_chars` deleted.
  - "new variants need the snapshot": with `hasSnapshot: false`, with and without `only: [...NEW_FULL_VARIANTS]`, neither id is planned, and `skipped` contains `"role-rule"` and `"no-prompt-chars"`.
  - "new ids are valid without a snapshot": `variantIds({ ...input, hasSnapshot: false })` contains both ids.
  - "only a new variant": `only: ["role-rule"]` with a snapshot. Expect the main ids to be `minimal`, `rerun-a`, `rerun-b`, `full`, `role-rule`, every `role-rule` sample to have a `full` request, and no `no-prompt-chars`.
  - "excluded new variant names full as base": a sample missing `capabilities` and `only: ["no-prompt-chars"]`. Expect `compare(...).variants["no-prompt-chars"].base === "full"`.
  - Update "pass 1 variant order ends with…" to end with `"effort-reversed", "role-rule", "no-prompt-chars"`.
- [ ] **Step 6: Run them and see them fail**
  - Run: `bun test tests/replay/variants.test.ts`. Expected: FAIL.
- [ ] **Step 7: Implement**
  - `mainVariants` appends both variants (base `full`, `groups` and `needs` = `candidates`) only when `hasSnapshot`.
  - `variantIds` adds `NEW_FULL_VARIANTS` unconditionally.
  - `planPass` pushes both ids to `skipped` without a snapshot.
  - `selected` returns `true` for `full` when `only` includes either id.
  - `baseOfKey` returns base `full` for either id.
  - `planMain` applies `edit`:
    - `role-rule` replaces only `wire.effort.instructions`;
    - `no-prompt-chars` deletes `request.prompt_chars` from a copy of the built state.
- [ ] **Step 8: Run them and see them pass**
  - Run: `bun test tests/replay/variants.test.ts`. Expected: PASS.
- [ ] **Step 9: Failing `size` tests in `compare.test.ts`**
  - The `size` tests use a plain main variant `full` against base `minimal` (`mainReq("full","minimal",s)`), so they do not depend on a candidate variant that a later task may remove. Each passes `meta.toolCalls`.
  - "raised on a large turn": `toolCalls` 20, base `low`, variant `high`. Expect `size.large.raised === 1`.
  - "lowered on a small turn": `toolCalls` 3, `high` then `medium`. Expect `size.small.lowered === 1`.
  - "same level": `toolCalls` 3, `medium` and `medium`. Expect `size.small.same === 1`.
  - "boundary 14 is small, 15 is large".
  - "unknown size": `toolCalls` `undefined`, both sides decided. Expect `size.unknown === 1` and all buckets 0.
  - "miss not counted": a variant miss and a body without `effort` both leave `size` all zeros.
  - "bases carry no size": `minimal`, `rerun-a` and `rerun-b` have no `size` key.
  - "size holds no text": every leaf is a non-negative integer, and `JSON.stringify(aggregates)` does not contain `MARKER`.
  - "full-based noise": a `role-rule` variant with base `full` flips 3 efforts against `full`, and the `minimal` reruns flip 2 and 4. Expect flips 3, noise 4, and not beyond.
- [ ] **Step 10: Run them and see them fail**
  - Run: `bun test tests/replay/compare.test.ts`. Expected: FAIL.
- [ ] **Step 11: Implement `countSize` and wire it in `compare`**
  - `compare` initialises a zeroed `size` for every main variant id not in `minimal`, `rerun-a`, `rerun-b`.
  - For each pair where `own` and `base` both have `keys.effort`, it calls `countSize(entry.size, own, base, meta.toolCalls?.[pair.req.sample])`.
  - `countSize` compares `EFFORT_LEVELS.indexOf`, and uses the bucket `large` when `toolCalls >= 15`, `small` when it is a number below that, and `unknown` otherwise.
- [ ] **Step 12: Run them and see them pass**
  - Run: `bun test tests/replay/`. Expected: PASS.
- [ ] **Step 13: CLI end-to-end and docs**
  - `cli.test.ts` "pass 1 joins turn size from the jev ledger", on a loopback Jev fixture:
    - The agent dir keeps the sessions in `<dir>/sessions` (copied from `tests/fixtures/replay/size/size.jsonl`) and the ledger only in `<dir>/jev/ledger.jsonl`.
    - Run `--pass 1 --sessions <dir>/sessions --url <fixture> --send` with a fake key in `TYPESAFE_API_KEY`.
    - Read `aggregates.json` from `<dir>/jev/replay/*/`, and expect some variant's `size.large` or `size.small` sum to be greater than 0.
  - `cli.test.ts` "new variants without a snapshot are skipped": `--pass 1 --only role-rule,no-prompt-chars` without `--capabilities`. Expect exit 0 and a `skipped:` line containing `role-rule` and `no-prompt-chars`.
  - Document both variants, the `full` base with `minimal` noise, `size`, and the `<agentDir>/jev` ledger source in `docs/testing.md` § Rich state replay.
- [ ] **Step 14: Verify all**
  - Run: `bun test && bun check && bun run lint && bun run fmt:check`. Expected: every command exits 0.
- [ ] **Step 15: Commit**
  - `git commit -m "feat(replay): role-rule and no-prompt-chars variants with a turn-size measure"`

---

## Task 2: Replay run and evidence — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4
**Difficulty:** Normal
**Blocked by:** Task 1

**Files:**
- Create: `docs/evidence/<YYYY-MM-DD>-effort-reply-replay.md`
- Modify: `docs/roadmap.md` (the "Effort rubric revision" row)
- Private, never committed: `<scratch>/capabilities.json`, `<agentDir>/jev/replay/<run-id>/`

**Interfaces:**
- Consumes: the Task 1 CLI variants and `size` aggregate.
- Produces: one verdict per variant, `ships` or `does not ship`, recorded in the evidence. Tasks 3 and 4 read it.

- [ ] **Step 1: Snapshot and dry run**
  - Run `bun tests/host/manual/capabilities-snapshot.ts <scratch>/capabilities.json`.
  - Then run `bun scripts/replay/cli.ts --pass 1 --capabilities <scratch>/capabilities.json --only role-rule,no-prompt-chars`.
  - Expected: sample counts, exclusions, the request count and `cost: $…`. No request is sent.
- [ ] **Step 2: Ask the operator**
  - Send the dry-run counts and cost through the inbox, with a Stakes line.
  - **Stop until approved.** This is a paid call with real data.
- [ ] **Step 3: Run with `--send`** after approval, with the same command plus `--send`.
  - Expected: `aggregates.json` and `cases.md` under `<agentDir>/jev/replay/<run-id>/`.
- [ ] **Step 4: Write the evidence**
  - Base it on the layout of `docs/evidence/2026-11-07-state-replay.md`.
  - Content: data, noise, and for each variant flips against noise per key, `size`, misses and exclusions.
  - Aggregates only, no prompt text.
- [ ] **Step 5: Operator reads `cases.md`**
  - Ask through the inbox for a verdict per variant. The win test is design D6.
  - Record both verdicts and the operator's reasons in the evidence.
- [ ] **Step 6: Clean up and record**
  - Delete `<agentDir>/jev/replay/<run-id>/`.
  - Update the roadmap row with the verdicts and a link to the evidence.
- [ ] **Step 7: Verify and commit**
  - Run: `bun run fmt:check`.
  - Commit: `git commit -m "docs(evidence): effort reply replay"`

---

## Task 3: Ship the role-based reply rule — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4
**Difficulty:** Easy
**Blocked by:** Task 2

**Files:**
- Modify:
  - `src/jev/rubrics.ts` (`MAIN_EFFORT_INSTRUCTION`)
  - `docs/jev-questions.md` (main instruction)
  - `scripts/replay/variants.ts` (remove `role-rule`, `ROLE_RULE_SENTENCE`, `roleRuleInstruction`)
  - `openspec/changes/effort-reply-by-context/specs/state-replay/spec.md` and `docs/testing.md`: remove every normative reference to `role-rule` as design D6 lists. That covers the bullet, the name in the `full`-base paragraph and the "Role rule variant" scenario. Reword the shared scenarios ("New variants need the snapshot", "Only a new variant", "Full-based noise") to name `no-prompt-chars` only.
- Conditional (lost branch only): modify `openspec/changes/effort-reply-by-context/tasks.md`, delete `openspec/changes/effort-reply-by-context/specs/main-effort/spec.md`
- Always: `openspec/changes/effort-reply-by-context/plan.md` ("Scenario → test" after cleanup)
- Test:
  - `tests/jev/questions.test.ts`, `tests/host/main-effort.test.ts`
  - `tests/replay/variants.test.ts`, `tests/replay/compare.test.ts`, `tests/replay/cli.test.ts`

**Interfaces:**
- Consumes: the Task 2 verdict for `role-rule`.

**Test cleanup rule (applies to Tasks 3 and 4):**
- Delete only the tests specific to the shipped candidate: its variant test, and `roleRuleInstruction` here.
- The `size` tests use `full` against `minimal` (Task 1 Step 9), so they stay in every outcome.
- Shared candidate tests are reworded to the variant that remains: "new variants need the snapshot", "new ids are valid without a snapshot", "only a new variant", "excluded new variant names full as base", "full-based noise", the order test and the CLI skip test. If none remains, they are deleted together with their scenarios.
- Update "Scenario → test" to the specs after cleanup.

| Verdict (`role-rule` / `no-prompt-chars`) | Replay variants left | Product deltas left | Shared tests and scenarios |
|---|---|---|---|
| ships / ships | none | `main-effort`, `main-state` | deleted; *One change per variant* restored to baseline plus the rerun sentence |
| ships / loses | `no-prompt-chars` | `main-effort` | reworded to `no-prompt-chars` |
| loses / ships | `role-rule` | `main-state` | reworded to `role-rule` |
| loses / loses | both | none | unchanged |

- [ ] **Step 0: Branch on the verdict**
  - If `role-rule` lost, do only step 3.4: tick nothing, add a note `Not shipped: <reason>, see evidence` under group 3 in `tasks.md`, delete `specs/main-effort/spec.md`, and commit `docs(openspec): role-rule not shipped`.
  - Otherwise continue with Step 1.
- [ ] **Step 1: Failing tests in `questions.test.ts`**
  - "main effort instruction rates replies by context": `MAIN_EFFORT_INSTRUCTION` ends with the Contracts `ROLE_RULE_SENTENCE` literal (typed inline in the test, not imported), starts with the unchanged prefix `How much step-by-step reasoning does the work this request asks for need?`, and has no `/\bshort\b/`.
  - "criteria unchanged": the main `effort.criteria` keys in order and their values equal the current ones: `Object.keys` is `["high","medium","xhigh","low","max"]` (`EFFORT_OPTION_ORDER`, unchanged).
  - "worker instruction unchanged": `WORKER_EFFORT_QUESTION.instructions` equals its current literal.
- [ ] **Step 2: Run them and see them fail**
  - Run: `bun test tests/jev/questions.test.ts`. Expected: FAIL on the first test.
- [ ] **Step 3: Implement**
  - Set `MAIN_EFFORT_INSTRUCTION` to `roleRuleInstruction(<old>)` written out as a literal.
  - Update the main instruction quote in `docs/jev-questions.md` to the same text.
- [ ] **Step 4: Run them and see them pass**
  - Add `main-effort.test.ts` "jev down 500 on a reply changes nothing": a first turn where the assistant asks a question, then a reply prompt, with the Jev fixture answering HTTP 500. Expect the level unchanged.
  - Run: `bun test tests/jev/questions.test.ts tests/host/main-effort.test.ts`.
  - Expected: PASS, including the existing verbatim-docs test.
- [ ] **Step 5: Remove the variant**
  - Delete `role-rule`, `ROLE_RULE_SENTENCE` and `roleRuleInstruction` from `variants.ts`, and apply the test cleanup rule.
  - Edit the `state-replay` delta as listed under Files.
  - Run: `bun test tests/replay/ && openspec validate effort-reply-by-context --strict`. Expected: PASS and valid.
- [ ] **Step 6: Verify all and commit**
  - Run: `bun test && bun check && bun run lint && bun run fmt:check`.
  - Commit: `git commit -m "feat(effort): rate a reply by the work it approves, not its length"`

---

## Task 4: Drop `prompt_chars` — implements 4

**Covers:** 4.1, 4.2, 4.3, 4.4, 4.5
**Difficulty:** Easy
**Blocked by:** Task 2, Task 3 (both edit `scripts/replay/variants.ts`, its tests and the `state-replay` delta; run one after the other)

**Files:**
- Modify:
  - `src/jev/state.ts` (`RequestSignals`, `requestSignals`)
  - `docs/jev-contract.md` (main state example and the `request` table)
  - `scripts/replay/variants.ts` (remove `no-prompt-chars`)
  - `openspec/changes/effort-reply-by-context/specs/state-replay/spec.md` and `docs/testing.md`: remove every normative reference to `no-prompt-chars` as design D6 lists.
    - If `role-rule` was kept (it lost), reword the shared paragraph and scenarios to name `role-rule` only.
    - If neither variant remains, drop the paragraph and the shared scenarios, and restore the baseline bullets of *One change per variant* plus the rerun sentence.
- Conditional (lost branch only): modify `openspec/changes/effort-reply-by-context/tasks.md`, delete `openspec/changes/effort-reply-by-context/specs/main-state/spec.md`
- Always: `openspec/changes/effort-reply-by-context/plan.md` ("Scenario → test" after cleanup)
- Test:
  - `tests/jev/state.test.ts`, `tests/host/main-effort.test.ts`
  - `tests/replay/variants.test.ts`, `tests/replay/compare.test.ts`, `tests/replay/cli.test.ts`

**Interfaces:**
- Consumes: the Task 2 verdict for `no-prompt-chars`, `RequestSignals` (Contracts), and the test cleanup rule and verdict table of Task 3.

- [ ] **Step 0: Branch on the verdict**
  - If `no-prompt-chars` lost, do only step 4.5: tick nothing, add a note `Not shipped: <reason>, see evidence` under group 4 in `tasks.md`, delete `specs/main-state/spec.md`, and commit `docs(openspec): no-prompt-chars not shipped`.
  - Otherwise continue with Step 1.
- [ ] **Step 1: Failing tests**
  - `state.test.ts`: `requestSignals("  why does src/a.ts fail?  ")` equals `{ text: "  why does src/a.ts fail?  ", files_mentioned: 1, has_code_or_error: false, is_question: true }`, with no `prompt_chars`.
  - `main-effort.test.ts` ("default request state"): send an 800-character prompt (`"x".repeat(800)`). Expect `Object.keys(state.request).sort()` to equal `["files_mentioned","has_code_or_error","is_question","text"]`.
- [ ] **Step 2: Run them and see them fail**
  - Run: `bun test tests/jev/state.test.ts tests/host/main-effort.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Remove `prompt_chars` from `RequestSignals` and `requestSignals`.
  - Remove the row and the example key in `docs/jev-contract.md`.
- [ ] **Step 4: Run them and see them pass**
  - Same command. Expected: PASS.
- [ ] **Step 5: Remove the variant**
  - Delete `no-prompt-chars` from `variants.ts`, and apply the test cleanup rule of Task 3.
  - Edit the `state-replay` delta as listed under Files.
  - Run: `bun test tests/replay/ && openspec validate effort-reply-by-context --strict`. Expected: PASS and valid.
- [ ] **Step 6: Verify all and commit**
  - Run: `bun test && bun check && bun run lint && bun run fmt:check`.
  - Commit: `git commit -m "feat(state): stop sending prompt length to Jev"`

---

## Scenario → test

**state-replay**
- One change per variant / Add-one variant → `tests/replay/variants.test.ts` "add-one" (existing)
- One change per variant / Reversed options → `tests/replay/variants.test.ts` "reversed options" (existing)
- One change per variant / No prompt length variant → `tests/replay/variants.test.ts` "no-prompt-chars variant" (Task 1)
- One change per variant / New variants need the snapshot → `tests/replay/variants.test.ts` "new variants need the snapshot" and "new ids are valid without a snapshot", plus `tests/replay/cli.test.ts` "new variants without a snapshot are skipped" (Task 1)
- One change per variant / Only a new variant → `tests/replay/variants.test.ts` "only a new variant" (Task 1)
- One change per variant / Full-based noise → `tests/replay/compare.test.ts` "full-based noise" (Task 1)
- One change per variant / Reruns present → `tests/replay/variants.test.ts` existing reruns test
- Turn size of a sample / Large turn → `tests/replay/corpus.test.ts` "turn size joins the own turn's ledger line" (Task 1)
- Turn size of a sample / Boundary below → `tests/replay/corpus.test.ts` "turn size joins the own turn's ledger line" (14) and `tests/replay/sessions.test.ts` "keeps toolCalls only as a non-negative integer" (0)
- Turn size of a sample / Invalid count → `tests/replay/sessions.test.ts` "keeps toolCalls only as a non-negative integer"
- Turn size of a sample / Next turn not borrowed → `tests/replay/corpus.test.ts` "next turn not borrowed"
- (Ledger read from `<agentDir>/jev`, design D4) → `tests/replay/cli.test.ts` "pass 1 joins turn size from the jev ledger"
- Turn size side measure / Raised on a large turn → `tests/replay/compare.test.ts` "raised on a large turn"
- Turn size side measure / Lowered on a small turn → `tests/replay/compare.test.ts` "lowered on a small turn"
- Turn size side measure / Same level → `tests/replay/compare.test.ts` "same level"
- Turn size side measure / Unknown size → `tests/replay/compare.test.ts` "unknown size"
- Turn size side measure / Miss not counted → `tests/replay/compare.test.ts` "miss not counted"
- Turn size side measure / Bases carry no size → `tests/replay/compare.test.ts` "bases carry no size"
- Turn size side measure / Size holds no text → `tests/replay/compare.test.ts` "size holds no text"

**main-effort** (only if `role-rule` ships)
- Reply rated by the work it approves / Role rule in the main instruction → `tests/jev/questions.test.ts` "main effort instruction rates replies by context", plus the existing verbatim-docs test
- Reply rule leaves the rest unchanged / Criteria unchanged → `tests/jev/questions.test.ts` "criteria unchanged"
- Reply rule leaves the rest unchanged / Worker instruction unchanged → `tests/jev/questions.test.ts` "worker instruction unchanged"
- Reply rule leaves the rest unchanged / Jev fails on a reply → `tests/host/main-effort.test.ts` "jev down 500 on a reply changes nothing" (Task 3)

**main-state**: not shipped (`no-prompt-chars` lost), so its delta was removed from the change and no scenario remains.
