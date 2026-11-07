# Retrospective: wg-09-skill-host

## Wins
- The host wiring reused the merged policy unchanged. All Pi- and file-shaped work sits in `src/host/skills.ts`, and `decide()` got smaller, not larger.
- The real-CLI host test proves the "done when" criteria from issue #10:
  - the skill body is sent once across three picks;
  - `(none)` and a low gate attach nothing;
  - after a compaction, a dropped body is sent again in full and a kept body is sent as a reference.
- Test count: 939 at baseline, 1018 after apply, 1090 after rebasing onto `main`, all passing.

## Misses
- Task 4's first cut ignored context edits on the explicit `/skill:` path; the task review caught it.
- Task 8's "Jev down" test first waited on a ledger count that already held the earlier run's line, which made it flaky. Three other checks could pass on broken code. The task review caught all of these.
- Two fail-open gaps survived per-task reviews: the skill pick and the later-batch construction had no guard. They were closed in Task 7 (`safePick`) and in the final fix wave (`tryAskBatches`).

## Plan deviations
- None in contracts. The internal helpers `safePick`, `tryAskBatches` and `recordPick` were added beyond the plan's list.
- No feature branch: the worktree branch was created from `main`, because `WG-09` was stale after #33. The PR goes straight to `main`.

## Skill/workflow compliance
- Subagent-driven throughout:
  - one implementer and one task review per task;
  - fix rounds for Tasks 4 and 8 (one each);
  - one whole-branch review, then one fix wave with a scoped re-review.
- Verify was run by the parent and by `superspec.verifier` independently.

## Surprises
- Pi's `sourceInfo.baseDir` is the agent or package root, not the skill folder. The plan review caught this before any code was written, and it would have broken the duplicate check for an operator's `/skill:name`.
- `buildContextEntries` ignores context edits; `buildSessionProjection` is the seam that matches what the model sees.
- A temp-dir name containing `jev-skill` leaked into the system prompt and made a negative test fail.

## Promote candidates
- Fail-open rule: guard every awaited or constructed side path (later requests, picks) separately from the main decision. A throw in a side path must never lose the main result.
- When a check must reflect "what the model sees", use `buildSessionProjection()`, not raw branch entries.
