## 1. Blocked count is the rest of the total

Blocked by: none

- [x] 1.1 Replace `blockedToolCount()` in `src/seams/registry.ts` with a set-difference over the parent's tool names and the child's active tools; delete `BlockedToolInput` and `RECURSION_DENYLIST`
- [x] 1.2 Simplify `ToolFactsInput`, `computeToolFacts` and the `reportToolFacts` call site in `src/lifecycle/create-subagent-session.ts` to `session` and `parentToolNames`; drop `candidates`, `protocolNames`, `disallowed`, `policyRemoved`, `grantedTools` from the facts input and delete `ownTools` if it becomes unused
- [x] 1.3 Replace the per-source tests in `test/seams/registry.test.ts` and `test/lifecycle/create-subagent-session.test.ts` with tests for the new scenarios; update `test/seams/identity.test.ts` only if it depends on the old rule

## 2. Docs, types and end-to-end

Blocked by: 1

- [x] 2.1 Update the `blockedToolCount` doc comments in `src/service/service.ts`, `src/seams/identity.ts` and `src/ui/display.ts`, and regenerate `dist/public.d.ts`
- [x] 2.2 Update `tests/host/run-facts-offline.test.ts` to the new `blockedToolCount` value
- [x] 2.3 Run the executor checks (`bun run test:executor`), `bun run --cwd packages/pi-subagents verify:public-types` and `bun test`
- [x] 2.4 Verify in a real interactive Pi in tmux that a `tools:`-restricted agent shows `🔧N · ⊘M` with `N + M` equal to the parent's tool count plus the child's own tools, and record it in `docs/evidence/`
