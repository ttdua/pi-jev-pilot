## Context

`brainstorm.md` holds the intent, the operator's decisions and the alternatives. This file covers how the replay measures the two candidate changes and how each one ships.

Current state:
- **Main effort instruction.** `MAIN_EFFORT_INSTRUCTION` in `src/jev/rubrics.ts` is mirrored word for word in `docs/jev-questions.md` and pinned by `tests/jev/questions.test.ts`.
- **Request signals.** `requestSignals` in `src/jev/state.ts` builds `request`, with `prompt_chars`. `tests/jev/state.test.ts` pins it, and the `main-state` spec lists it.
- **Pass 1 replay** (`scripts/replay/variants.ts`).
  - Bases: `minimal`, and `full` (every candidate group, which equals the shipped groups when a capabilities snapshot is given).
  - Noise: the two plain reruns `rerun-a` and `rerun-b` of `minimal`.
  - Variants: add-one, leave-one-out and `effort-reversed`.
- **Ledger read in replay.** `scripts/replay/sessions.ts` `readLedgerLines` keeps `effective`, `strategy` and `from` per `turnId`. `corpus.ts` finds a sample's turn through the `jev-turn` entry on the branch after the prompt.

## Goals / Non-Goals

**Goals:**
- Measure `role-rule` and `no-prompt-chars` each alone, against the state the package ships, with the existing noise floor.
- Report, in counts only, whether effort moves toward turns that really were large.
- Ship each change only after it wins. `src/` stays untouched until then.

**Non-Goals:**
- A reply flag in code, or a change to the `conversation.recent` budget.
- Splitting replay results into "reply" and "not a reply". That would need a prefix heuristic, which the brainstorm rules out even in tooling.
- Changes to the report pass.

## Decisions

### D1. Variants are based on `full`, not `minimal`
- **Decision.** `role-rule` and `no-prompt-chars` use base `full` and the groups of `full`. Like the `full-*` variants, they need the capabilities snapshot. Without `--capabilities` they are skipped and reported.
- **Why.** The live request carries `last_decision` and `capabilities`. `last_decision` is the context that makes a reply readable, so measuring on `minimal` would test the rule without the context it relies on.
- **Noise.** It stays the larger of the two `minimal` reruns, as for the existing `full-*` variants. The `state-replay` delta states this explicitly, since "two reruns of each base" could be read as reruns of `full`.
- **Selection.** `--only role-rule` or `--only no-prompt-chars` also plans `full`, as `--only full-<group>` already does.
- **Alternative rejected.** Adding reruns of `full`. They would cost two more requests per sample, and the current method already accepts `minimal` noise for `full`-based variants.
- **Code impact.** `baseOfKey` gains an explicit map for the two ids, so an excluded-only aggregate names `full` as its base.

### D2. The candidate wording lives in the replay until it wins
- **Decision.** `scripts/replay/variants.ts` holds the candidate main instruction as a constant and builds `role-rule` questions by replacing only `effort.instructions` in the shipped main questions. Criteria and option order stay the same.
- **Why.** Shipping wording before evidence would break the replay rule.
- **When it wins.** The shipping task moves the text into `MAIN_EFFORT_INSTRUCTION` and `docs/jev-questions.md`, and deletes the replay constant. The variant then equals `full` and is removed (D6). When it loses, the constant and the variant stay, so the candidate can be measured again.
- **Candidate text.** The current instruction with its last sentence replaced by:

  > A reply to the assistant's own question, proposal, review or approval request, such as approving it, picking an option, answering it or asking to continue, whatever its length and however it is formatted, takes the size of the work it approves or starts, judged from the recent conversation rather than from the reply's own text.

  It drops "short" and the quoted examples, which carry the length cue.

### D3. `no-prompt-chars` removes one key from the built state
- **Decision.** The variant builds the `full` state with `mainState` and omits `request.prompt_chars`. Every other field is equal to `full`.
- **Why.** One change per variant (`state-replay` requirement), with no change to `src/` before the decision.

### D4. Turn-size side measure
- **Ledger read.** `readLedgerLines` also keeps `toolCalls` when it is a non-negative integer. The main sample carries `toolCalls` of its own turn, found the way `startEffortOf` finds `from`: through `walkBranch`, over descendants of the prompt and stopping at the next user message, take the first `jev-turn` entry and join it by `turnId`. A sibling branch or a later turn is never borrowed.
- **Ledger location (existing defect found in review).** `mainSamples(dir)` today reads the ledger from the sessions directory. The real ledger lives in `<agentDir>/jev/`, which the CLI already reads into `ctx.ledger`. So on real data the ledger-based start effort is empty for most samples, and the turn size would be empty too. `mainSamples` takes the ledger as a parameter, and the CLI passes `ctx.ledger`. This also restores the documented stratification by recorded start effort (`state-replay` *Corpus sampling*). Fixtures keep the ledger beside the sessions, and the tests pass it explicitly.
- **Size buckets.** A turn is `large` at 15 or more tool calls and `small` otherwise. 15 is the threshold the `largeAtLow` signal already uses, so the measure speaks the same language as `/jev tune`.
- **What is counted.** For every main variant except `minimal` and the reruns, among pairs where both sides decided an effort level, `aggregates.json` gains `size`. It holds, for `large` and `small`, the counts `raised`, `same` and `lowered` of the variant's effort against its base's. It also holds `unknown`, the samples with no size.
- **Reading it.** A variant tracks size when its `raised` share among `large` is higher than among `small`. The aggregate reports the counts only; the operator judges the result at the read-out, as the brainstorm agreed.
- **Alternatives rejected.** A correlation score, which is too few samples to be meaningful. A third bucket, which leaves too few per cell at about 100 samples.

### D5. Sampling stays as it is
- **Decision.** The stratified sample of 100 main prompts, by project and starting effort, is kept.
- **Why.** About a third of the earlier sample were inbox replies, which is enough to see flips. A dedicated reply sampler would need the prefix heuristic ruled out in the brainstorm. `--main N` can raise the count.

### D6. Shipping is conditional per variant
- **Decision.** The replay run and the evidence come first. The two shipping groups each depend on that run, and each ships only if its variant wins.
- **Win test.** Effort flips beyond noise, a side measure that tracks size (D4), and the operator's preference after reading `cases.md`.
- **If a variant wins.** The change ships into `src/` and docs. The variant then equals `full`, so it is removed from the replay. Before verify, every normative reference to it leaves the `state-replay` delta and `docs/testing.md`: its bullet, its name in the `full`-base paragraph, and its scenarios.
  - If one variant remains, shared text and scenarios are reworded to name only that one.
  - If both won, the paragraph and the shared scenarios (*New variants need the snapshot*, *Only a new variant*, *Full-based noise*) go, and *One change per variant* returns to its baseline text plus the explicit rerun sentence.
  - The turn-size requirements always stay.
- **If a variant loses.** Nothing ships, and its shipping group is closed unticked with a note. The variant stays in the replay, since it still differs from `full` in one thing and can be measured again. The product delta it would have justified is removed from `specs/` before verify: `main-effort` for `role-rule`, `main-state` for `no-prompt-chars`. The evidence records the loss.
- **Spec state at verify.** It always matches the code: the `state-replay` delta lists exactly the variants still in the replay, and only the product deltas of winners remain.
- **Alternative rejected.** Splitting into two changes. That doubles the review gates for one experiment, and the replay tooling is shared.

### D7. Contract and docs
- **Requests to Jev.** Neither change alters the request's shape for Jev beyond dropping one key and new instruction text. TypeSafe accepts any state object.
- **Ledger.** The ledger format is untouched.
- **Docs.** `docs/jev-contract.md` and `docs/jev-questions.md` change only with a winning variant. `docs/testing.md` documents the two variants and `size`. The evidence file holds aggregates only, never prompts.

## Risks / Trade-offs

- **[Risk] Jev ignores the wording and flips stay within noise.** → The evidence records it and nothing ships. Alternatives B and C of the brainstorm stay as follow-ups.
- **[Risk] The rule raises effort everywhere (anti-goal).** → The side measure shows `raised` among `small` turns. A rise that does not favour `large` turns fails the test.
- **[Risk] Few samples have a known size** (older turns have no `jev-turn` entry). → `unknown` is reported. Samples are drawn from sessions since installation, which have ledger lines. `--main` can be raised.
- **[Risk] The tool-call count reflects how the turn was actually run, not how much effort it needed.** → It is a side measure only. The operator's reading of the cases decides.
- **[Trade-off] Noise comes from `minimal`, not `full`.** → This is the accepted method for the existing `full-*` variants.
- **[Risk] Privacy.** → `size` holds counts only. `cases.md` stays private and is deleted after the decision, as `docs/testing.md` already requires.

## Migration Plan

No data migration. A winning change takes effect on the next main request after the package updates. Rollback is a revert of the shipping commit. The ledger and stores are unaffected.

## Open Questions

- **Out of scope, noted:** the living `main-effort` requirement *Main questions* says the `effort` choice is "over `low`, `medium`, `high`, `xhigh`, `max`, in that order". The shipped wire order is `high`, `medium`, `xhigh`, `low`, `max` (`EFFORT_OPTION_ORDER`, decided by the 2026-11-07 replay). The operator confirmed at the final gate that the shipped order is the decided one; the living spec sentence is what is stale. This change keeps the order and pins it only as "unchanged". Correcting that sentence belongs to a separate spec correction.

None blocking. The run date, sample size and send approval are decided by the operator at the replay task.
