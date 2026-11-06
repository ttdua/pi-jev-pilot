## 1. Agent metadata

- [x] 1.1 Add `TierName`, `TIER_LADDER`, `AgentFacts`, `LockDeclaration` and the pure lock and effective-field functions in `src/policy/launch.ts`, with a test that `TierName` matches `store/defaults.ts` `TIERS` (Locked fields, Effective launch fields)
- [x] 1.2 Add `cutCodePoints` in `src/shared/text.ts`, and the built-in agent table and the file reader in `src/host/agents.ts`: listing-based lookup, precedence, case-insensitive pass, `general-purpose` fallback, field parsing with Pi's `parseFrontmatter`, never throwing (Agent lookup order, Agent files are found by listing, Lookup never throws, Built-in agents, Agent identity fields, Declared tools, Launch fields in the agent file, Lock declaration)

## 2. Worker request

- [x] 2.1 Add the `standard` rubric, worker `effort`, `risky` and `expert_needed` wording in `src/jev/rubrics.ts`, verbatim from `docs/jev-questions.md` (Question wording)
- [x] 2.2 Add `offeredTiers` and `buildWorkerQuestions` in `src/jev/questions.ts`, returning wire questions and `QuestionSpec`s from one option list (Offered tiers, Worker questions, Question wording)
- [x] 2.3 Add `buildWorkerState` in `src/jev/state.ts` with code-point cuts (Worker state shape, Worker state text limits)
- [ ] 2.4 Add `readWorkerOutcome` in `src/policy/worker.ts`, mapping a `JevOutcome` and specs to worker answers (Reading worker answers)

## 3. Worker decision

- [ ] 3.1 Add `decideTier` in `src/policy/tier.ts` with the decision order and its fall-through rules (Decision order, Fable rule, Risk floor rule, Expert denied rule, Unsure fast rule, Partial answers in the decision, Rules without a qualifying tier, Decision on Jev failure)
- [ ] 3.2 Add `chooseFallback` in `src/policy/tier.ts` (Fallback choice)
- [ ] 3.3 Add `workerEffort` in `src/policy/effort.ts` (Worker effort, Effort after fallback)

## 4. Docs

- [ ] 4.1 Update `docs/domain-model.md` (fallback effort `xhigh` on every tier; expert-denied and risk floor without `deep`), `docs/jev-contract.md` (worker state field rules), `docs/architecture.md` (module layout: `policy/launch.ts`, `policy/worker.ts`) and `docs/roadmap.md` (WG-11 two changes; tier cascade moved from WG-13; status table for WG-04 to WG-06)
- [ ] 4.2 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass
