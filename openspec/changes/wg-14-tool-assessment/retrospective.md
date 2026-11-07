# Retrospective: wg-14-tool-assessment

## Wins

- Explore resolved the core mechanism before any artifact was written. Executor 25.0.5 already exposes `getSubagentsService().listAgents()` with `outputFile`, so the worker can find its own launch exactly, with no brief matching and no upstream change. The host test confirmed it: the record is present at the worker's first `before_agent_start`.
- Reading the executor source before the design caught a trap. A worker session loads its own executor instance, which overwrites the global service with an empty one and clears it on shutdown. Capturing the service at the main session's `session_start` avoided a lookup that would always miss.
- The host tests prove all three issue acceptance criteria end to end, with the real Pi CLI and executor: `observe` keeps tools and records counts, `enforce` removes `edit` and a call to it fails, and a Jev failure keeps every tool.
- All nine tasks passed their task reviews with no Critical or Important findings. The whole-branch review found 3 Minor ones.

## Misses

- `dispose()` was added in Task 6 to prune the per-session outcome map and removed after the final review. Each worker session has its own extension instance, so the map ends with the session and the `subagents:child:disposed` listener only ever reached the main instance. The controller ruling in Task 5 missed this. The question to ask was which instance holds the state.
- An implementer ran `bun run fmt` repo-wide, which reverted a `tasks.md` tick. Later dispatches had to say "format only your files".
- One dispatch told the implementer a plan.md note was committed before it was.

## Plan deviations

- Internal contract: `createToolAssessment` gained `dispose`, which was later removed. The net shape matches the plan. Recorded in plan.md and apply.md.
- The plan's Task 4 split into four host files (tool-service, tool-counts, tool-facts, tools) came from the plan review, not the original design. The design was updated before apply.

## Skill/workflow compliance

- The brainstorm and final planning gates, the per-task reviews, the whole-branch review with a single fix wave and scoped re-review, a fresh verify run, and the code review gate before touching the feature branch all ran in order.
- AGENTS.md overrides the schema: nothing is pushed and no PR is opened without the operator's explicit go-ahead in chat. Finalize stops before step 10.

## Surprises

- `wt remove` reports a branch "unmerged" when it is merged into the feature branch but not into `main`. Deleting it needs `git branch -d` after an ancestry check.
- The worktree's copied `node_modules` was incomplete, so the baseline failed until `bun install --frozen-lockfile` ran.

## Promote candidates

- Subagent dispatch template: "Never run repo-wide formatters; format only the files you changed; never touch `openspec/`."
- Design checklist for Pi extensions: for each piece of process-wide or per-instance state, name which extension instance (main or worker) owns it and when it ends.
