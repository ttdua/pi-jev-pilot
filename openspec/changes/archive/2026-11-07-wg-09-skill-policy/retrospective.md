# Retrospective: wg-09-skill-policy

## Wins
- Pure split held: every rule and text builder is in `src/policy/skill.ts`, with no Pi import; 58 new tests, 731 total, no change to existing callers.
- Docs written first, and tests parse the wording and delivery templates from `docs/jev-questions.md`, so wording drift fails a test.

## Misses
- Task 6 first built `which` options from `Object.keys`, which reorders integer-like skill names; caught by the task review and fixed in one round.
- The first brainstorm message proposed "best skill, ignoring `(none)`", which differed from upstream's measured rule; the spec reviewer caught it before the final gate.

## Plan deviations
- None in contracts. Two minor docs fixes in Task 1 and a final fix wave (`__proto__` names, a loop instead of a closure, extra failure-path tests) were applied after review.

## Skill/workflow compliance
- Subagent-driven: one implementer and one task review per task, one whole-branch review, one fix wave with a scoped re-review.
- One implementer folded the "declarations, typecheck, then failing test" order into a single pass and proved RED by revert.

## Surprises
- Upstream sends the skill gates without `criteria`, unlike the project's wire rule; recorded as an exception.
- WG-10 changes `mainQuestions` in parallel; a small merge conflict is expected.

## Promote candidates
- Build choice `options` from the source list, never from `Object.keys` of the criteria object.
