## 1. Docs first

- [x] 1.1 Update `docs/jev-contract.md` "Eligibility" (a request when `effort` is on or skills apply; `corrects` on every request) and "Skill pick" (catalog exclusions including the ledger name pattern, explicit `/skill:name` from the expanded block, in-context check after compaction and context edits, failed later batch), and `docs/workflow.md` (main prompt flow and "A compaction" step 3) (When skill questions are asked, Explicit skill skips the skill questions, No duplicate body in context)
- [x] 1.2 Update `docs/architecture.md` host seams (`buildSessionProjection`, `parseFrontmatter` / `stripFrontmatter`) and `docs/privacy.md` (the hidden skill message holds the skill's own text; `details` holds name, fingerprint and form) (Host wiring only, No prompt text in the ledger or entries)

## 2. Host skill helpers

- [x] 2.1 Add `fingerprint`, `explicitSkill` and `skillBlock` in new `src/host/skills.ts`, with tests in `tests/host/skills.test.ts` (Explicit skill skips the skill questions, Skill message)
- [x] 2.2 Add `readCatalog` in `src/host/skills.ts` with an injected file reader, using `parseFrontmatter` and `stripFrontmatter` (Skill catalog, Catalog exclusions)
- [x] 2.3 Add `loadedSkills` over `buildSessionProjection().entries` in `src/host/skills.ts` (No duplicate body in context, Explicit skill counts as loaded)

## 3. Main flow wiring

- [x] 3.1 Extend `MainDeps` with `commands` and `readFile` and wire them in `src/host/setup.ts`; make eligibility `effort on || skills apply`, read the catalog only after the other conditions pass, and compute the hold only with `effort` on (Eligible main prompts, Skill catalog, Main questions)
- [x] 3.2 Send the first batch with the main questions and later batches in parallel in `src/host/main.ts`; build the pick from every batch (When skill questions are asked, Jev failure attaches no skill, Jev failure changes nothing)
- [x] 3.3 Return the `jev-skill` message from `beforeAgentStart` on every path that read the main answers, with the form from `deliveryForm` over `loadedSkills`; leave the status line and `jev-turn` data unchanged on skill-only turns (Skill message, No duplicate body in context)
- [x] 3.4 Add `skill`, `skillP` and `gate` to `TurnRecord` and the `main` line (Main line fields, One main line per decided turn)

## 4. Host test through the real CLI

- [ ] 4.1 Add `tests/host/skill-delivery.test.ts`: content once across three picks, operator `/skill:name` then a pick gives a reference, a pick after a compaction resends the body, `(none)` and gate too low attach nothing, suggest form, Jev 500 and later-batch failure attach nothing, ledger fields, no prompt marker in entries (Skill message, No duplicate body in context, Jev failure attaches no skill, Main line fields, No prompt text in the ledger or entries)

## 5. Check

- [ ] 5.1 Update `docs/roadmap.md` (WG-09 done); run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass (Host wiring only)
