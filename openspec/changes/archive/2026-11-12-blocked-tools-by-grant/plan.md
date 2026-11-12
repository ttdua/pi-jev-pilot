# Blocked tools by grant Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** `⊘M` counts every tool in pi's total that the subagent cannot call, so `🔧N + ⊘M` equals the total.

**Architecture:** `blockedToolCount` becomes a set difference between (parent tool names ∪ child active tools) and the child's active tools, read at the existing post-bind moment. The per-source bookkeeping in `registry.ts` and the facts input in `create-subagent-session.ts` are deleted; the formatter, surfaces and record shape stay.

**Tech Stack:** TypeScript, vitest (executor), bun test (host), tmux for the end-to-end check.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `blockedToolCount(input)` in `src/seams/registry.ts` | modified | `(input: { parentToolNames: readonly string[]; activeToolNames: readonly string[] }) => number`; returns `\|(parentToolNames ∪ activeToolNames) − activeToolNames\|` | no |
| `ToolFactsInput` in `src/lifecycle/create-subagent-session.ts` | modified | `{ session: Pick<AgentSession, "getActiveToolNames">; parentToolNames: readonly string[] }` | no |
| `ToolFacts` / `onToolFacts` | unchanged | `{ toolCount: number; blockedToolCount: number }` | no |
| `SubagentRecord.blockedToolCount` | modified (meaning only) | `blockedToolCount?: number`; doc: tools in the total the child cannot call | public |
| `BlockedToolInput`, `RECURSION_DENYLIST` | removed | — | no |

---

## Task 1: Blocked count is the rest of the total — implements 1

**Covers:** 1.1, 1.2, 1.3
**Difficulty:** Normal
**Blocked by:** none
**Files:** modify `packages/pi-subagents/src/seams/registry.ts`, `packages/pi-subagents/src/lifecycle/create-subagent-session.ts`, `packages/pi-subagents/test/seams/registry.test.ts`, `packages/pi-subagents/test/lifecycle/create-subagent-session.test.ts`; check `packages/pi-subagents/test/seams/identity.test.ts`

- [ ] **Step 1:** In `test/seams/registry.test.ts`, replace the `describe("blocked tool count")` cases with new cases for `blockedToolCount({ parentToolNames, activeToolNames })`: allowlist narrows (30 parent, 3 active → 28 incl. a child-only tool), disallowed tool blocked, policy removal blocked, removal re-granted not blocked, recursion guard tools blocked, child-only tools granted (in total, not blocked), tool count + blocked = distinct names, nothing blocked → 0. Run `bun run --cwd packages/pi-subagents test -- registry` and see them fail.
- [ ] **Step 2:** Replace `blockedToolCount()` in `src/seams/registry.ts` with the contract above; delete `BlockedToolInput` and `RECURSION_DENYLIST`. Run the registry tests; they pass.
- [ ] **Step 3:** In `test/lifecycle/create-subagent-session.test.ts`, "createSubagentSession — tool facts": update "reports tool facts after the grant check" (`toolCount: 4`, blocked = distinct names of parent ∪ active − 4), replace "does not count a tool registered after the policy as blocked" with a late-registration case that is not counted, and replace "counts a disallowed known tool and a policy removal" with an assertion on the new value; keep "leaves facts unknown when the tool list is unreadable". Run; they fail.
- [ ] **Step 4:** Reduce `ToolFactsInput`, `computeToolFacts` and the `reportToolFacts` call in `create-subagent-session.ts` to `session` and `parentToolNames` (remove the `known` set, `BUILTIN_TOOL_NAMES` / `BUILTIN_EXTENSION_TOOL_NAMES` imports if unused, and `ownTools` if unused). Run the lifecycle tests; they pass.
- [ ] **Step 5:** Run `bun run --cwd packages/pi-subagents check` and the whole `bun run --cwd packages/pi-subagents test`; fix any test in `test/seams/identity.test.ts` or `test/ui/*` that hard-codes the old rule (they pass counts straight in, so expect none).
- [ ] **Step 6:** Commit `feat(executor): blocked tools are the rest of the total`.

---

## Task 2: Docs, types and end-to-end — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4
**Difficulty:** Normal
**Blocked by:** Task 1
**Files:** modify `packages/pi-subagents/src/service/service.ts`, `packages/pi-subagents/src/seams/identity.ts`, `packages/pi-subagents/src/ui/display.ts`, `packages/pi-subagents/dist/public.d.ts`, `tests/host/run-facts-offline.test.ts`; create `docs/evidence/<date>-blocked-tools.md`

- [ ] **Step 1:** Update the `blockedToolCount` comments in `service.ts` (line ~105), `identity.ts` (`ToolFacts` doc) and `display.ts` (line ~49) to: tools in the total the child cannot call. Run `bun run --cwd packages/pi-subagents build:types` and check the diff of `dist/public.d.ts` is only that comment.
- [ ] **Step 2:** In `tests/host/run-facts-offline.test.ts` change `expect(data?.["blockedToolCount"]).toBe(1)` to the value of the fixture's total minus `toolCount`: assert `blockedToolCount` > 0 and that `toolCount + blockedToolCount` equals the probe's recorded total if the probe exposes it; otherwise assert the exact number observed on a first run and comment how it is derived. Run `bun test tests/host/run-facts-offline.test.ts`.
- [ ] **Step 3:** Run `bun run test:executor`, `bun run --cwd packages/pi-subagents verify:public-types` and `bun test`; all green.
- [ ] **Step 4:** Follow `docs/evidence/2026-11-12-row-details.md` (fixture + tmux, same setup, agent with `tools:` restricted and no `disallowed_tools`). Capture the three surfaces and write `docs/evidence/<date>-blocked-tools.md` showing `🔧N · ⊘M` and the total.
- [ ] **Step 5:** Commit `fix(executor): document the blocked tool count and record evidence`.

---

## Scenario → test

- Allowlist narrows the child → `test/seams/registry.test.ts` "allowlist narrows the child" and `test/lifecycle/create-subagent-session.test.ts` "reports tool facts after the grant check"
- Disallowed tool is blocked → `test/seams/registry.test.ts` "disallowed tool is blocked"
- Policy removal is blocked → `test/seams/registry.test.ts` "policy removal is blocked"
- Removal re-granted is not blocked → `test/seams/registry.test.ts` "removal re-granted is not blocked"
- Unknown before bind → existing `test/seams/identity.test.ts` "no blockedToolCount before bind" (line ~361)
- Recursion guard tools are blocked → `test/seams/registry.test.ts` "recursion guard tools are blocked"
- Child's own tools are granted → `test/seams/registry.test.ts` "child-only tools are granted" and the lifecycle "reports tool facts" case with `ask_parent`
- Granted plus blocked is the total → `test/seams/registry.test.ts` "granted plus blocked is the total" and `tests/host/run-facts-offline.test.ts`
- Nothing blocked → `test/seams/registry.test.ts` "nothing blocked"
