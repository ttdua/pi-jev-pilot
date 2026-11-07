## 1. Store: state, config and settings

- [x] 1.1 Add the optional boolean `cliReviewEnabled` to `State` and its validator in `src/store/state-file.ts`, with tests in `tests/store/state-file.test.ts` (read, non-boolean rejected, reset clears it)
- [x] 1.2 Add the optional boolean `review.enabled` to `Config` and its validator in `src/store/config.ts`, with tests in `tests/store/config-read.test.ts`
- [x] 1.3 Add `enabled` to `Settings.review` in `src/store/settings.ts` (`state.cliReviewEnabled ?? config.review.enabled ?? false`) and add the code default `review.enabled: false` in `src/store/defaults.ts`. Make the state's `cliReview` replace only `cli`, `model` and `effort`. Tests in `tests/store/settings.test.ts`

## 2. Review tool availability

- [x] 2.1 Add the execution guard to `jev_review` in `src/host/review.ts`: off, or unreadable settings, returns the off error result and runs no process. Pass only `cli`, `model` and `effort` to `effectiveChoice`. Tests in `tests/host/review-tool.test.ts`
- [x] 2.2 Add `syncReviewTool` in `src/host/review.ts`: add or remove `jev_review` in `pi.setActiveTools` only on a mismatch, keeping the order of the other tools, and swallow errors. Tests in `tests/host/review-tool.test.ts`
- [x] 2.3 Call `syncReviewTool` from the main `before_agent_start` in `src/host/setup.ts`, before the main decision. Children keep `hideReviewInChild`. Tests in `tests/host/setup.test.ts`

## 3. `/jev` command

- [x] 3.1 Parse `/jev cli-review on|off` in `src/host/commands.ts`, apply it through `updateState`, and add the form to the usage text. Tests in `tests/host/commands.test.ts`
- [x] 3.2 Make the reviewer form write `cliReviewEnabled: true` in the same update. A refused change writes nothing. Tests in `tests/host/commands.test.ts`
- [x] 3.3 Change the status line to `cli review: <on|off> (<cli>, <details>)`. Tests in `tests/host/commands.test.ts`
- [x] 3.4 Sync the active tools after every successful `/jev` state change (a `sync` dependency of `runJev`, wired in `src/host/setup.ts`). Tests in `tests/host/commands.test.ts` and `tests/host/setup.test.ts`

## 4. Host tests through the real Pi

- [ ] 4.1 Add a harness option that writes `review.enabled` into the test `config.json` (`tests/host/harness.ts`)
- [ ] 4.2 Update `tests/host/cli-review.test.ts`: turn the review on for the existing flows, and add scenarios for off by default, the config, state over config, and toggling mid-session in both directions
- [ ] 4.3 Update `tests/host/jev-base.test.ts`, `tests/host/main-effort.test.ts` and `tests/host/strategy-advice.test.ts`: with the default off, compare raw bodies with no `withoutReview` filter, and assert that `jev_review` is absent. Remove `withoutReview` from `tests/host/bodies.ts` if nothing uses it any more

## 5. Docs

- [ ] 5.1 Update `docs/usage-guide.md`: the `/jev cli-review on|off` form, off by default, choosing a reviewer turns it on, reset, `all` leaves it alone, the status line, and a breaking-change note
- [ ] 5.2 Update `docs/configuration.md` (`review.enabled`, `cliReviewEnabled`, the rollback note), `docs/privacy.md` (off by default), `docs/testing.md` (the Jev-down comparison has no tool exception) and `docs/architecture.md` (`review.ts` syncs the tool, `state-file.ts` holds the switch)

## 6. Verification

- [ ] 6.1 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`. All pass
