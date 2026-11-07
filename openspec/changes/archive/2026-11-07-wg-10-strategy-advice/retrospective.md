# Retrospective: wg-10-strategy-advice

## Wins
- The design was settled in explore, through Inbox questions, before any artifact was written. The brainstorm gate and the final planning gate passed on the first try.
- Pure gates in `src/policy/strategy.ts` made every boundary a one-line table row. There are 718 tests at finish (673 at baseline).
- Real-CLI host tests prove that the advice block reaches the provider, and that a Jev failure leaves provider bodies identical to a run without the package.

## Misses
- The worktree's copied `node_modules` was incomplete at first, so the first baseline run showed 64 failures. A fresh `bun install` fixed it. Check dependencies before the baseline run.
- The plan first left open the option of importing the ledger's `Strategy` into `policy/`, which the lint boundary forbids. The plan reviewer caught it.

## Plan deviations
- None in contracts. Task 4 needed one fix round: a test claimed to cover "strategy off leaves advice" while using two separate instances.
- The final-review minors: the effort-off assertion was hardened, and the unused `withDecision` `prev` parameter was documented. The length of `decide()` is a follow-up.

## Skill/workflow compliance
- Subagent-driven development, with a per-task review seat and one whole-branch review. Every gate went through the Inbox.

## Surprises
- The two specs "Jev failure changes nothing" (main-effort) and "Effort unanswered" (strategy-advice) contradicted each other until the spec reviewer flagged it.
- `main` gained WG-11 (#30) during the change. The merge is clean.

## Promote candidates
- Run `bun install` after `wt switch -c` in this repo before taking the test baseline.
- Follow-up: extract an effort helper from `decide()` in `src/host/main.ts`.
