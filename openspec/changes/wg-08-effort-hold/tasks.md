## 1. Hold rule and branch reading

- [x] 1.1 Add the pure hold rule `isHeld` in `src/policy/hold.ts` with unit tests in `tests/policy/hold.test.ts`
- [x] 1.2 Add `holdContext` (anchor after the latest compaction, latest compaction id) to `src/host/context.ts` with unit tests in `tests/host/context.test.ts`

## 2. Main flow

- [x] 2.1 Held prompt in `src/host/main.ts`: ask only `corrects`, never set the level, record `held` and `effective`, `held` on the `main` line, set the status suffix; unit tests in `tests/host/main.test.ts`
- [x] 2.2 Anchor marker: write `jev-turn` `{ turnId, decided }` for a non-held turn with an effective level and no compaction during the turn; unit tests in `tests/host/main.test.ts`

## 3. Host proof and docs

- [x] 3.1 Harness option for `effort.holdProviders` (with a `tests/host/harness.test.ts` case) and host test `tests/host/effort-hold.test.ts` through the real CLI: no thinking change after the anchor, exactly one decision after a compaction, `held` lines, no entry text in provider requests
- [ ] 3.2 Update `docs/workflow.md`, `docs/domain-model.md`, `docs/roadmap.md` (WG-08 Done) and `docs/usage-guide.md` if needed; run the full gate (`bun check`, `oxlint --deny-warnings .`, `oxfmt --check .`, `bun test`)
