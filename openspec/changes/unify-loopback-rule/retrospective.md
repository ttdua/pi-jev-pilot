# Retrospective: unify-loopback-rule

## Wins

- The disagreement was found while resolving the merge conflict between WG-03 and WG-04 in `docs/configuration.md`, not in production. It took one small change to fix.
- A scratch oxlint run before the plan was written showed that negated patterns work. The same run showed that `policy/sub/` needs a second negation (`!../../shared/**`), so the plan was right on the first try.
- All four tasks passed their task reviews on the first round. The whole-branch review returned "Ready to merge" with nothing to fix.

## Misses

- The first plan used a bare `export … from` for the re-export, which would have left `askJev` with no local binding. The plan reviewer caught it before apply.

## Plan deviations

- None. No contracts changed.

## Skill/workflow compliance

- Ran `/opsx-ff`, then apply (subagent-driven), verify and finalize. Each gate went through the Inbox: the location choice, brainstorm, the final packet, and code review together with the push/PR decision.

## Surprises

- WG-03 and WG-04 were built in parallel worktrees, and each wrote its own URL rule for the same setting. Nothing in the process compared the two rules before merge.

## Promote candidates

- When two work groups touch the same setting, the second one to merge should check that both enforce the same rule. A cross-group check in the roadmap's working agreements would catch this earlier.
- Keep `src/shared/` limited to dependency-free rules that more than one module needs.
