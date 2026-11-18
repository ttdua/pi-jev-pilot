# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `subagent-context-fresh-fork`
**Iteration**: `1`
**Applied at**: `2026-11-18 09:11` (UTC)
**Executor**: `subagent-driven-development`. Implementer seat: `implementer` agent (Task 1 on `9router/gpt-6-luna` per user ruling; others on the configured model, thinking from Difficulty). Task reviewer and final whole-branch reviewer seat: `code-reviewer` agent.

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.subagent-context-fresh-fork`
- **Worktree branch**: `subagent-context-fresh-fork`
- **Feature branch**: `prompt-mode`
- **Base branch**: `main`

---

## Commits

- **Range**: `8028e125..e6bf00d6` (this receipt commit follows)
- **Count**: `36`

---

## Tasks

- **Completed**: `33 of 33` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

Verification at `e6bf00d6`:

| Check | Result |
|---|---|
| `bun run test:executor` | 105 files, 2428 tests passed |
| `bun test` | 2710 passed, 0 failed |
| `bun run typecheck` | no type errors in 303 files |
| `bun run lint` | clean |
| `bun run fmt:check` | clean |
| `openspec validate --strict` | valid |

Manual evidence: `docs/evidence/2026-11-18-fork-cache.md` (PASS). On `9router/gpt-6-luna` with the parent at about 27.7k tokens:

- fork / parallel forks read 0.921 of the parent's prompt from cache;
- the provider floor is 2194 tokens;
- `claude-code/claude-haiku-5-5` read 0.993 (unbounded).

---

## Contract deviations

All are recorded in `plan.md` `## Contracts` with their reasons. Cumulative.

**Prompt assembly**
- `composeFreshPrompt` → `composeAgentSection` + `freshPromptExtension` (user ruling, Task 3). Pi's `systemPromptOverride` replaces only the preamble, so the agent header and body go into a custom `<agent>` section set in `before_agent_start`. Spec scenario "Agent body last" and design D2 were amended.
- `buildAgentPrompt`, `AssemblerIO`, `AssemblerContext` and `CreateSubagentSessionDeps` lose their inheritance inputs (Task 3). `session/project-context.ts` is deleted.
- `forkGuardExtension` / `ForkGuardState` gain `systemPrompt`. The fork forces the parent prompt through `before_agent_start` instead of `systemPromptOverride`, because SDK 1.5.0 renders a duplicate `<cwd>` after a preamble override (controller ruling, Task 4; design D3 note).

**Fork session**
- New `createForkSessionManager`, `CreateSubagentSessionParams.context/task`, `SubagentSessionMeta.firstMessage/forkGuard`, `buildParentSnapshot(ctx, context, toolNames)`, and parent tool declarations in the snapshot.
- `ForkStubs` (refusing stubs that delegate to late-registered, model-callable tools), `enforceForkGrants(state, granted, childTools)` and `isModelCallable` (Task 4, fix rounds 1–3).
- `ModelInfo.parentHasBranch` (Task 4): an agent-file fork that falls back to fresh resolves model and thinking as fresh.

**Records and settings**
- `AgentInvocation.contextFallback` was added in Task 2 rather than Task 4. `AgentInvocationParams` is exported.
- The persisted `subagents:record` entry gains optional `context` / `contextFallback` (internal file format, Task 5). Old entries read as fresh.
- The child registry gains a `CONTEXTS_KEY` global map beside `CHILDREN_KEY` (Task 6).
- `promptInheritanceFor` is removed; the `promptInheritance` setting is kept for round-trip, `@deprecated` and ignored (Task 8).

**Spec amendments by user ruling**
- Fork cache evidence uses P ≥ 25000 and records the provider floor; Anthropic API is optional and unbounded (Task 7).
- The old-names doc rule names historical-record exemptions explicitly (Task 8, controller ruling).

No public contract was changed against the plan.

---

## Lanes

| Task | Lane branch | Lane range | Review | Merge commit |
|---|---|---|---|---|
| 1 | sequential | `8028e125..4a56fd5d` | approved after 1 fix round | n/a |
| 2 | sequential | `1e98be9f..bb27d6b4` | approved after 1 fix round | n/a |
| 3 | sequential | `4c989dfe..04a6036c` | 1 Important ruled and carried into Task 4 (resolved there) | n/a |
| 4 | sequential | `f36e4590..8ec74f66` | approved after 3 fix rounds | n/a |
| 5 | sequential | `9416cda5..a266807e` | approved after 1 fix round | n/a |
| 6 | sequential | `4eddcd3f..a3fbb98f` | approved after 1 fix round | n/a |
| 7 | sequential | `6229ef28..d375fd1c` | approved after 1 fix round (evidence re-run after user ruling) | n/a |
| 8 | sequential | `6e6cf0a6..e754deb9` | approved after 1 fix round | n/a |
| final | sequential | `70c90a7a..e6bf00d6` | final whole-branch review: Ready with fixes. Fix wave approved; one residual (the `prompt_mode` warning text) fixed in `e6bf00d6` | n/a |

Parked from the final review (minor, not fixed):
- the `promptInheritance` setting is still fully parsed;
- the fork model decision is computed in two places, which agree within one tick.

---

## Next step

Run `/opsx-verify`.
