# Retrospective: wg-11-worker-host

## Wins

- Every WG-11 "done when" item is proven against the real Pi CLI and the real executor. `tests/host/worker-routing.test.ts` has 11 tests and was stable across three runs.
- Each branch of the route has a table test with no Pi involved, because the decision logic lives in the pure `src/policy/route.ts` and the host adapter only applies its result.
- No dependency was added and the ledger format is unchanged. Pi's thinking clamp was mirrored in policy code, and a parity test checks it against `pi-ai`.
- 712 tests pass, up from a baseline of 544.

## Misses

- The whole-branch review found a cross-task defect that the per-task reviews missed. An executor outcome buffered for one launch could be joined to a later resume of the same agent id. One fix wave resolved it, using an order stamp and slim buffered outcomes.
- In Task 5 the code was written before the tests. RED was captured afterwards by reverting the implementation.
- `LaunchEntry` was exported although no contract listed it. It was made private before the receipt.

## Plan deviations

- None in the contracts.
- `tests/load.test.ts` was updated in Task 6, outside the listed files, because wiring added three handlers.
- The ordering rule for buffered outcomes uses a monotonic counter, not `deps.now()`. The test clock is fixed and cannot order events. Recorded in design §5.

## Skill/workflow compliance

- Subagent-driven development ran with one implementer and one reviewer per task, a final whole-branch review, one fix wave and a scoped re-review.
- Internal spec and plan reviews each ran twice before the final gate. Their major findings were resolved inside the unattended loop.
- New worktrees briefly failed tests while Worktrunk's post-start copy of `node_modules` was still running. Waiting for the copy fixed it.

## Surprises

- Pi 1.5.0 does not export `clampThinkingLevel` to extensions.
- `pi.on` returns an unsubscribe function in Pi 1.5.
- A provider in `models.json` without `apiKey` loads, and `hasConfiguredAuth` reports it unusable.
- The executor's tool result carries `Agent ID:` in plain text for foreground, background and resume launches.

## Promote candidates

- WG-13: add a host-level "never `expert`" assertion and a parity shape with `{ high: null }`. Remove the duplicated effort and risky extraction in `route.ts`.
- When writing a plan for event joins that can arrive in either order, list "stale entry from an earlier run" as a Review Focus item.
