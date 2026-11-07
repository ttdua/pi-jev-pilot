## 1. Policy

- [ ] 1.1 Add `src/policy/modes.ts` with `MODE_NAMES`, `ModeName` and `expertAdmitted(mode, answers)`, plus a test that `MODE_NAMES` equals `MODES` in `src/store/defaults.ts` (worker-modes: Mode names, Expert gate per mode)
- [ ] 1.2 Give `decideTier` in `src/policy/tier.ts` a `mode` parameter, use `expertAdmitted` as rule 1, rename reason `fable` to `expert-admitted`; thread `mode` through `RouteInput` and `routeLaunch` in `src/policy/route.ts`; per-mode table tests in `tests/policy/tier.test.ts`, updated `tests/policy/route.test.ts` (worker-decision: Decision order, Expert admitted rule, Expert denied rule, Partial answers in the decision)

## 2. Questions

- [ ] 2.1 Turn `src/jev/rubrics.ts` tier criteria and `expert_needed` into records keyed by mode with the wording of `docs/jev-questions.md`; give `buildWorkerQuestions` in `src/jev/questions.ts` a `mode` parameter; extend `tests/jev/questions.test.ts` to every mode (worker-request: Worker questions, Question wording; worker-modes: What a mode selects)

## 3. Ledger

- [ ] 3.1 Replace `fable` with `expert-admitted` in `src/store/ledger-schema.ts` and its tests, in the same commit as 1.2 because the route test validates reasons against the schema (decision-ledger: Ledger line schema, Worker decisions record their tier)

## 4. Host

- [ ] 4.1 In `src/host/worker.ts`, capture the mode once at classification, use it for questions, `routeLaunch` and the ledger line; tests in `tests/host/worker.test.ts` and `tests/host/worker-ledger.test.ts`, with helper changes in `tests/host/worker-fakes.ts`, `tests/host/worker-routing.test.ts` and `tests/host/fixture.ts` (worker-routing: Mode of a launch; worker-ledger: Decision fields)
- [ ] 4.2 Add `/jev mode <budget|standard|premium>` to `src/host/commands.ts`, with usage text; tests in `tests/host/commands.test.ts` (jev-command: Mode, Usage text for other input)
- [ ] 4.3 Host test with the loopback Jev fixture and the real executor: a `premium` launch with a `deep` + `xhigh` answer runs on `tiers.expert` and records `mode` `premium`, `reason` `expert-admitted`; Jev down in `premium` records `miss` (worker-routing: Mode of a launch)

## 5. Docs

- [ ] 5.1 Rename "Fable rule" to "expert gate" and `fable` to `expert-admitted` in `docs/domain-model.md`, `docs/jev-contract.md`, `docs/jev-questions.md`, `docs/glossary.md`, `docs/architecture.md`, `docs/configuration.md`, `docs/usage-guide.md`, `docs/workflow.md`, `docs/roadmap.md`, `docs/decisions/0003-rubric-per-mode.md`; leave `docs/evidence/` as recorded; drop the "until WG-12" note for `/jev mode` in `docs/usage-guide.md`
- [ ] 5.2 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass

## 6. Replay (manual, operator)

- [ ] 6.1 Ask the operator to approve a replay of real briefs per mode (data, estimated cost), outside the repository, with a plain rerun for noise; record only aggregates in `docs/evidence/`; mark WG-12 Done in `docs/roadmap.md` only if the distribution matches `docs/evidence/2026-11-05-replay.md#routing-by-mode` within noise
