## 1. Worker rubric and request

- [x] 1.1 In `src/jev/rubrics.ts`, replace `TIER_CRITERIA` and `EXPERT_NEEDED_QUESTIONS` with one `WORKER_TIER_CRITERIA` holding today's `standard` text verbatim, plus `RUBRIC_VERSION = 2`. Give `MAIN_TIER_QUESTION` its own `MAIN_TIER_CRITERIA` copy. Remove the `budget` and `premium` tier wordings and both `expert_needed` questions
- [x] 1.2 In `src/jev/questions.ts`, drop the `mode` parameter of `buildWorkerQuestions` and stop asking `expert_needed`. Update `tests/jev/questions.test.ts` for the `worker-request` scenarios: Worker question set, Question wording, Rubric version with a wording snapshot, Offered tiers "No slot, request unchanged", Slot criterion "Same in every mode", and Main criteria held apart. Update the `strategy-advice` "Strategy questions" tests in `tests/policy/strategy.test.ts` to name the main criteria

## 2. Score and cut points (pure)

- [x] 2.1 In `src/policy/modes.ts`, replace the expert gates and `expertAdmitted` with `MODE_TARGETS` (whole percents, per `worker-modes` "Mode targets"). Rewrite `tests/policy/modes.test.ts` for "Mode names", "Mode targets" and "Mode selects a target table"
- [x] 2.2 Add `src/policy/cutpoints.ts` with `difficultyScore` per `mode-cutpoints` "Difficulty score": tier-only renormalization, effort rank / 8, unanswered effort as `high`, rounding to 3 decimals, no score without tier mass. Tests in `tests/policy/cutpoints.test.ts` cover every scenario of that requirement
- [x] 2.3 Add `cutPoints(entries, target)` per "Cut points from a window": integer positions rounded half up, the expert cap above `balancedMax`, an empty window, order independence. Tests cover every scenario, including Expert cap, Ties stay under the cap and Empty window
- [ ] 2.4 Add `windowEntries(lines, rubricVersion)` per "Window entries" (eligibility, latest 200 by `at` with later input winning ties, effort argmax with a higher-level tie-break, decided tier before fallback), and `recentMix(window)` per "Recent mix". Tests cover every scenario of both
- [ ] 2.5 Compute `SEED_CUTPOINTS` offline from the 2026-11-07 replay answers with `difficultyScore` and `cutPoints`, outside the repository and printing aggregates only. Add the values as constants in `src/policy/cutpoints.ts`, and add `cutPointsFor(window, mode)` so that fewer than 100 entries use the seed. Tests cover "Seed cut points", including that the seed satisfies `fastMax ≤ balancedMax < expertMin`

## 3. Tier decision (pure)

- [ ] 3.1 Rewrite `decideTier` in `src/policy/tier.ts`: it takes cut points instead of the mode and applies rules `expert`, `risky`, `slot`, `cut` in that order. `cut` moves an unoffered tier down, then up, never to `expert`. Remove the `expert-denied` and `fast-unsure` rules, the substitute-tier step and their reasons in `TierDecision`. Rewrite `tests/policy/tier.test.ts` for every scenario of `worker-decision`: Decision order (including Table per mode), Expert rule, Cut rule, Risk floor rule, Partial answers, Fallthrough without a qualifying tier, Slot rule, Slot below the bar uses the score
- [ ] 3.2 Update `src/policy/route.ts`, `src/policy/worker.ts` and their tests (`tests/policy/route.test.ts`, `tests/policy/worker.test.ts`) for the new reasons in "Routed launch", "Nothing can run" and "Locks in the route", leaving effort, fallback and clamp unchanged

## 4. Ledger schema

- [x] 4.1 In `src/store/ledger-schema.ts`, add the `score` (0–3.5) and `rubric version` (integer 1–99) domains, the worker fields `score`, `rubric` and `expertOffered`, and the reasons `expert` and `cut`, keeping the retired names. Update the exported field sets. Update `tests/store/ledger-schema.test.ts` for the modified `decision-ledger` requirements: Ledger value domains, Ledger line schema, Worker decisions record their tier

## 5. Host wiring

- [ ] 5.1 Add `src/host/cutpoint-window.ts`: load the window from `readLedger` at main `session_start`, add each validated eligible worker line this session builds (also when the write fails), keep it empty on an unreadable ledger, and keep no window in a child. Tests in `tests/host/cutpoint-window.test.ts` cover "Cut-point window"
- [ ] 5.2 In `src/host/worker.ts`, compute each launch's cut points when its request is built (siblings share one window state; a launch classified alone uses the current window), pass them to the decision, and write `score`, `rubric` and `expertOffered` and no `expertNeeded` on the worker line. Update `tests/host/worker-routing.test.ts` and `tests/host/worker-ledger.test.ts` for "Cut points of a launch", "Mode of a launch" (Premium launch end to end, mode change, Jev down) and every `worker-ledger` "Decision fields" scenario
- [ ] 5.3 In `src/host/commands.ts`, add the `mix` line and the `cut points: seed` line to the status report, with no mix line without the executor. Update `tests/host/commands.test.ts` for every new `jev-command` "Status report" scenario
- [ ] 5.4 Hide `why cut` in the worker log line in `src/host/status.ts` (`verbose-log` "Worker log line segments") and update `tests/host/verbose-log.test.ts`
- [ ] 5.5 Update the remaining host tests that assert old reasons or per-mode requests (`tests/host/q1-q7-worker-mutation.test.ts`, `tests/host/worker.test.ts`, `tests/host/tally.test.ts`, `tests/host/status.test.ts` and any other failing file) without changing their intent

## 6. Docs, evidence and gate

- [ ] 6.1 Add `docs/decisions/0008-mode-target-cutpoints.md` replacing ADR 0003; mark ADR 0003 superseded and update `docs/decisions/README.md`
- [ ] 6.2 Update `docs/jev-questions.md` (one worker tier rubric, no `expert_needed`, main criteria apart), `docs/domain-model.md` (modes, decision order, expert rule, cut points), `docs/glossary.md` (rubric, mode, expert gate, difficulty score, cut point), `docs/jev-contract.md` (worker questions, `expert_needed` row, per-mode row), `docs/architecture.md` (rubrics as data, `modes.ts`, `cutpoints.ts`, window), `docs/configuration.md` (expert tier note, calibration row), `docs/workflow.md` (mode switch flow), `docs/usage-guide.md` (mode table, `/jev` mix line) and `docs/roadmap.md` (#39)
- [ ] 6.3 Run the done-when replay offline: route the 2026-11-07 briefs in launch order with the new code, plus a plain rerun, and check that every mode is inside every allowed range over all launches and over non-review launches. Write `docs/evidence/<date>-tier-mix.md` with aggregates only: the seed values, the mixes, the rerun noise and the windowed check
- [ ] 6.4 Run the full gate: `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test`
