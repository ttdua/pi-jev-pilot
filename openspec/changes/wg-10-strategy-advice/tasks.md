## 1. Strategy policy (pure)

- [x] 1.1 Add `src/policy/strategy.ts`:
  - `STRATEGIES`, `STRATEGY_THRESHOLD` (0.6) and `GRAPH_THRESHOLD` (0.8).
  - The `<how>` texts and the block builder, verbatim from `docs/jev-questions.md`.
  - `adviseStrategy` with the gates from specs/strategy-advice "Strategy gates" and "Advice text".
- [x] 1.2 Add `tests/policy/strategy.test.ts`:
  - Every gate boundary (.6/.59, .8/.79).
  - `parallel` on `fast`, `graph` off `deep`, `tier` unanswered, `delegate` without `tier`, `direct`, `strategy` unanswered, confidence ignored.
  - The block text for each strategy compared with the docs, with no `junior`.

## 2. Main questions

- [x] 2.1 Add `STRATEGY_QUESTION` and `MAIN_TIER_QUESTION` (standard criteria for `fast`, `balanced`, `deep`, no prefix) to `src/jev/rubrics.ts`.
- [x] 2.2 Change `mainQuestions` in `src/jev/questions.ts` to take `{ askEffort, askStrategy }`, in the order `effort`, `risky`, `tier`, `strategy`, `corrects`. Update its callers.
- [x] 2.3 Extend `tests/jev/questions.test.ts`:
  - The key sets for each switch combination.
  - Wording verbatim in the docs.
  - The tier criteria without a prefix.
  - Fresh copies per call.

## 3. Status line

- [x] 3.1 Split `Decision` in `src/host/status.ts` into an effort part and an advice part. Make `statusText` render ` · <level|no answer>` (when `effort` is on) then ` · <strategy>` (when `strategy` is on).
- [x] 3.2 Extend `tests/host/status.test.ts` with the new status-line scenarios: advice with and without effort, `strategy` switched off and back on, and base states still winning.

## 4. Main decision wiring

- [x] 4.1 In `src/host/main.ts`:
  - Eligibility is `effort || strategy`.
  - `askEffort` also needs the `effort` switch.
  - Compute the advice before the effort block, and record `strategy`, `strategyP` and `advised` on `TurnRecord`.
  - Return the hidden `jev-advice` message.
  - Update the status parts per design decision 5.
  - Write the three ledger fields when `strategy` was answered.
- [x] 4.2 Extend `tests/host/main.test.ts` (unit, fake Pi):
  - Eligibility with each switch combination.
  - The returned message for delegate, direct and a miss.
  - Advice kept on a manual change, on `max`, on an unanswered `effort`, and with `effort` off.
  - Cancelled gives no advice and restores the status.
  - Ledger fields: advised true and false, and absent.
  - Status updates.
- [x] 4.3 Add a host test `tests/host/strategy-advice.test.ts` through the real CLI and the Jev fixture:
  - The `delegate` block in the first provider request.
  - `direct` leaves the request without the block.
  - Jev 500 leaves requests equal to a run without the package.
  - `effort` off with `strategy` on sends one request and writes a `main` line with no `requested`.
  - RPC `setWidget` shows `Jev · standard · high · delegate`.
- [x] 4.4 Fix the existing tests broken by the new question set and the `strategy` default: `tests/host/main.test.ts` (effort-off eligibility, non-reasoning keys, `mainQuestions` comparison). Confirm `tests/host/main-effort.test.ts` still passes unchanged.

## 5. Docs

- [ ] 5.1 Update the docs:
  - `docs/jev-questions.md`: the main `tier` has no display-name prefix.
  - `docs/jev-contract.md`: eligibility ("effort or strategy"), questions per switch, and the gate note that an unanswered `tier` attaches nothing for `parallel` and `graph`. In the precedence line, add a loaded skill.
  - `docs/domain-model.md`: the Advice row.
  - `docs/usage-guide.md`: the status line with advice; remove "Later work groups add skill and advice".
- [ ] 5.2 Add tests that the docs state precedence and the unprefixed main `tier`. Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`. All must pass.
