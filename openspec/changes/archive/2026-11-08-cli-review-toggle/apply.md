# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `cli-review-toggle`
**Iteration**: `2`
**Applied at**: `2026-11-07 18:33` (UTC, `2026-11-07T18:33:04Z`)
**Executor**: `subagent-driven-development`. Per the user's decision in the Inbox thread `cli-review-toggle`, `general-purpose` agents served as implementer and reviewer, because the canonical `superspec.*` roles are not loaded by `@gotgenes/pi-subagents`.

Iteration 2 extends the change: the user decided to remove the unused `review` feature switch in this change. The artifacts were revised in `c843d66`, and the re-opened gate (brainstorm plus the five later artifacts) was approved. Tasks 7.1 to 7.5 were then implemented.

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.cli-review-toggle`
- **Worktree branch**: `cli-review-toggle`
- **Feature branch**: `support-turn-off-review-cli`
- **Base branch**: `main`

---

## Commits

- **Range**: `7049daf..9ed8d0b`. `7049daf` is the step 0 scaffold commit on the feature branch. This receipt commit comes on top of the range.
  - Iteration 1: `7049daf..8df4796`.
  - Iteration 2: `8df4796..9ed8d0b`.
- **Count**: `29`

---

## Tasks

- **Completed**: `21 of 21` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Review

- **Iteration 1.** Each of units A to E had a task review covering spec and quality.
  - C and E each needed one fix round.
  - The final whole-branch review over `7049daf..2d38ad2` found it ready to merge, and its two Minor coverage gaps were fixed in `32f0552`.
- **Iteration 2.** Unit F (Tasks 13 to 15) had a task review, which approved it with one Minor finding.
  - The finding was a legacy-state write test that could not tell a migration from the malformed fallback.
  - It was fixed in `b207f10`, with a real RED shown.
- **Final whole-branch review 2** over `7049daf..352bb5f`: Ready to merge, Yes, with no Critical or Important findings.
  - Minor 1 (artifact wording "nine feature switches") was fixed in `9ed8d0b`.
  - Minor 2 was left as is; see ruling 5.
  - The reviewer confirmed that no living spec would keep `review` as a feature after archive.
- **Gate** at `352bb5f`: typecheck, lint and fmt:check pass, and `bun test` gives 1840 pass, 0 fail. `9ed8d0b` changes only artifact prose.

### Rulings

1. Tasks were batched into units A to F by area, and T6 and T7 were run together to settle the order of the status text. Cost if wrong: larger review surfaces per unit.
2. The host test for "Refused while off" flips the state during the first request, so the tool is declared while the setting is off. The spec says "executes while off", and the order is deterministic through the request and response. Cost if wrong: one test rewrite.
3. The controller checked the two-line docs fix (Task 11) directly, without a re-review seat. Cost if wrong: a wording miss.
4. The controller checked the one-file test fix (Tasks 13 to 15) directly, without a re-review seat, because its RED was demonstrated. Cost if wrong: a weak assertion.
5. The two `"review"` literals in `src/store/state-file.ts` were not folded into a `LEGACY_SWITCHES` constant. Only one key is retired, and both sites are adjacent and tested. Cost if wrong: a future retirement edits two lines instead of one.

---

## Contract deviations

None. The four contracts added in iteration 2 (feature list, six decision features, legacy `switches.review`, `FEATURES`/`DECISION_FEATURES`) went into plan.md before implementation, and the user approved them at the re-opened gate.

---

## Next step

Run `/opsx-verify`.
