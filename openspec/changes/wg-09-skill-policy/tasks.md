## 1. Docs first

- [ ] 1.1 Update `docs/jev-questions.md`: wire format exception for the three gates (no `criteria`); the `content`, `suggest` and `reference` delivery texts under "Text added to the model's context" (Delivery text, Which options and wording)
- [ ] 1.2 Update `docs/jev-contract.md` "Skill pick" and "Main questions": criterion fallback, batches of at most 254 of near-equal size, a batch led by `(none)` is ignored, ties, gate mean over gates read, gates sent without criteria, duplicate rule by name and fingerprint; and `docs/roadmap.md` WG-09 (two changes)

## 2. Pure skill policy

- [ ] 2.1 Add `skillCriterion` and `skillBatches` in `src/policy/skill.ts` (Skill criterion, Catalog batches)
- [ ] 2.2 Add `batchLeader`, `gateMean` and `pickSkill` in `src/policy/skill.ts`, reading `ReadResult` values from `src/policy/answers.ts` (Batch leader, Gate mean, Pick rule)
- [ ] 2.3 Add `deliveryForm` and `deliveryText` in `src/policy/skill.ts` (Delivery text, Duplicate check)

## 3. Skill questions

- [ ] 3.1 Add `WHICH_INSTRUCTION`, `NONE_CRITERION` and the gate questions in `src/jev/rubrics.ts`, verbatim from the docs, with a `BareNoulQuestion` wire type (Which options and wording, Question wire format)
- [ ] 3.2 Extend `mainQuestions` with an optional first batch and add `skillBatchQuestions` in `src/jev/questions.ts`; output without skills stays identical (Skill questions, Which options and wording, Question wire format)

## 4. Check

- [ ] 4.1 Update `docs/architecture.md` if module names changed; run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass (Pure and Pi-free)
