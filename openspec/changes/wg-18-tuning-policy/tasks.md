## 1. Settings resolver

- [x] 1.1 Change the tuning layer in `src/store/settings.ts` to `{ timeoutMs?: { value, base } }`. The tuned value applies only when both are integers from 300 to 5000 and `base` equals the untuned value. Update `tests/store/settings.test.ts` for every `settings-resolution` scenario (tuning over config, non-integer, out of range, config edited after tuning, tuned from the default, invalid base, missing base)

## 2. Tuning file

- [x] 2.1 Add the validator and `readTuning` in `src/store/tuning-file.ts`: content and values per `tuning-file` (required inner keys, ranges, `before.timeouts ≤ asked`, history ≤ 50, unknown keys), with `missing`, `malformed` and `unreadable` reads. Tests in `tests/store/tuning-file.test.ts` cover every read scenario, including `history[3].cause` and the value not echoed
- [ ] 2.2 Add `updateTuning(dir, mutate)` with an atomic write through `writeFileAtomic`. A malformed file moves to `tuning.json.bad`; an unreadable file is refused; an invalid result or a throwing mutate is refused. Tests cover the update scenarios, including modes `0600`/`0700` and `config.json`/`state.json` left untouched

## 3. Tuning rules

- [ ] 3.1 Add `src/policy/tuning-window.ts` (counting helpers, `DecisionLine`) and `src/policy/tuning.ts` (`TuningRecord`, `TuningEvent`, `TUNING`): decision selection, ordering by `at` with the tie-break, "after an event" counts, asked/timeout counts, the window, nearest-rank p90 and the integer share comparisons. Unit tests in `tests/policy/tuning-window.test.ts` (correction lines ignored, line order, unasked lines, lines without `ms`)
- [ ] 3.2 Add the timeout rule and the new value: fire threshold, `max(current+200, ceil100(p90×1.25))`, clamp, block, no-change check. Tests cover every scenario of "The timeout rule", "The new value" and "Block after a revert or an undo"
- [ ] 3.3 Add the pending evaluation, the revert and `supersede`, plus apply (pending `from`/`to`/`at`/`before`, `rule` entry) and the bounded history. Tests cover "Applying a change", "Evaluating a pending change", "Reverting a change" and "Bounded history"
- [ ] 3.4 Add `stepTuning`, which composes off, superseded, evaluation, cooldown and fire in the order of design D3 and returns the events. Tests cover "Pure tuning step", "Cooldown", "Config edit supersedes tuning" and "Tuning off" (step side), including inputs left unchanged
- [ ] 3.5 Add `undoTuning`, `resetTuning` and `setTuningOff`. Tests cover "Undo" (after a revert, twice in a row), "Reset" and "Tuning off" (transition side)
- [ ] 3.6 Add the type-level test, in `tests/store/tuning-file.test.ts` or `tests/policy/tuning.test.ts`, that the store document type and `TuningRecord` can be assigned to each other. Check with `bun run lint` that `policy/` imports nothing outside itself and `shared/`

## 4. Docs and gate

- [ ] 4.1 Update `docs/domain-model.md` (timeout-only signal, block after revert or undo, base value, tuning record), `docs/configuration.md` (`tuning.json` content, missing/malformed/unreadable cases, precedence with base), `docs/usage-guide.md` (a config edit wins over tuning; undo blocks the same raise), `docs/workflow.md` §5 (superseded step, block) and `docs/roadmap.md` (WG-18 split: `wg-18-tuning-policy` and the host change)
- [ ] 4.2 Run the full gate: `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test`
