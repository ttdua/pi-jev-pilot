# Verification Report

**Change**: `blocked-tools-by-grant`
**Verified at**: `2026-11-12 19:05`
**Iteration**: `1`
**Verifier**: `parent session, inline (all commands run fresh in this invocation, cwd = the worktree)`

---

## 1. Structural Validation (`openspec validate <change>`)

- [x] The command passes for this change

**Result**:

```text
$ openspec validate blocked-tools-by-grant --strict
Change 'blocked-tools-by-grant' is valid   (exit 0)
```

---

## 2. Task Completion (`tasks.md`)

- [x] Every box is ticked, or each open box has a recorded reason

`grep -c '^- \[x\]'` = 7, `grep -c '^- \[ \]'` = 0. `openspec instructions apply` reports progress 7 of 7.

| Open task | Reason | Blocks archive? |
|---|---|---|
| — | — | — |

---

## 3. Requirement Evidence

- [x] ADDED / MODIFIED: implementation evidence (file / line)
- [x] REMOVED: evidence the baseline behavior is gone (main spec, else git history)
- [x] RENAMED: not applicable

| Requirement | Operation | Status | Evidence (file:line) or reason |
|---|---|---|---|
| Blocked tool count is the rest of the total | ADDED | Pass | `packages/pi-subagents/src/seams/registry.ts:139-148` (set difference of parent ∪ active minus active); `src/lifecycle/create-subagent-session.ts:241-246` (`computeToolFacts` reads active names once, passes `parentToolNames`), `:250-256` (`reportToolFacts` publishes only after a successful read), `:311` (parent names snapshotted), `:412` (called after bind and the grant check). Unknown before bind: `reportToolFacts` is the only writer of the facts and runs after bind. |
| Every tool the child lacks is blocked | ADDED | Pass | Same function: any name in the total that is not active counts, with no per-cause branch; `grep` finds no `RECURSION_DENYLIST`, `BlockedToolInput` or `BUILTIN_EXTENSION_TOOL_NAMES` left in `src/`, `test/` or `tests/`. |
| Blocked tool count fact | REMOVED | Pass | Baseline read from `git show d2fbf871:packages/pi-subagents/src/seams/registry.ts`: the per-source `blockedToolCount` with `RECURSION_DENYLIST` and `isKnown`. None of it remains in `registry.ts` (lines 135-148 are the new function); the old `candidates`, `policyRemoved`, `grantedTools` inputs are gone from `ToolFactsInput` (`create-subagent-session.ts:235-239`). |

---

## 4. Scenario Coverage

- [x] Every scenario maps to a test
- [x] The project test command was run fresh in this step

**Test commands and results (all run in this invocation):**

| Command | cwd | Exit | Result |
|---|---|---|---|
| `bun run check` | `packages/pi-subagents` | 0 | `tsc --noEmit` clean |
| `bun run test` | `packages/pi-subagents` | 0 | 99 files, 2412 tests passed |
| `bun run --cwd packages/pi-subagents verify:public-types` | repo root | 0 | external consumer type-checks |
| `bun test` | repo root | 0 | 2659 pass, 0 fail, 143 files |

| Scenario | Test |
|---|---|
| Allowlist narrows the child | `test/seams/registry.test.ts:437` "allowlist narrows the child" (30 parent, 3 active → 28); `test/lifecycle/create-subagent-session.test.ts:580` "reports tool facts after the grant check" |
| Disallowed tool is blocked | `registry.test.ts:452`; `create-subagent-session.test.ts:632` "counts every tool the child lacks, whatever the cause" (`{1, 3}`) |
| Policy removal is blocked | `registry.test.ts:462`; `create-subagent-session.test.ts:661` "counts a policy-removed tool as blocked" |
| Removal re-granted is not blocked | `registry.test.ts:471`; `create-subagent-session.test.ts:685` "does not count a removed tool that is granted back" |
| Unknown before bind | `test/seams/identity.test.ts` "queued record has none" (no `blockedToolCount` property); `create-subagent-session.test.ts:736` "reports nothing while the child is still binding" |
| Recursion guard tools are blocked | `registry.test.ts:481`; `tests/host/run-facts-offline.test.ts` (`blockedToolCount` ≥ 4, includes the three guard tools and `bash`) |
| Child's own tools are granted | `registry.test.ts:490`; `create-subagent-session.test.ts:709` "counts both protocol tools as granted, not blocked" (`{3, 3}`) |
| Granted plus blocked is the total | `registry.test.ts:496`; `tests/host/run-facts-offline.test.ts` (`toolCount + blockedToolCount == parentToolCount + 2`, recorded 8 + 8 = 14 + 2) |
| Nothing blocked | `registry.test.ts:504` |

Scenarios under the REMOVED requirement are skipped. End to end: `docs/evidence/2026-11-12-blocked-tools.md` (real Pi in tmux, `tools: read, grep`, no `disallowed_tools`, `🔧4 · ⊘11` on all three surfaces; child session files show exactly `read`, `grep`, `ask_parent`, `notify_parent`).

---

## 5. Design and Contract Coherence (warning only)

- [x] Decisions in design.md match the code
- [x] Contracts in plan.md, with the Contract deviations recorded in apply.md, match the code

Design decisions: set difference (`registry.ts:139-148`); no special case for the guard tools; two read moments (`create-subagent-session.ts:311` parent snapshot, `:412` active read after bind); `ToolFactsInput` reduced to `session` and `parentToolNames` (`:235-239`).

Contracts (apply.md "Contract deviations": none):

| Contract | Result |
|---|---|
| `blockedToolCount(input)` | Matches: `registry.ts:139-142` has the exact signature |
| `ToolFactsInput` | Matches: `create-subagent-session.ts:235-239` |
| `ToolFacts` / `onToolFacts` | Matches, unchanged |
| `SubagentRecord.blockedToolCount` (public, meaning only) | Matches: `dist/public.d.ts` differs from `main` only by the doc comment (`git diff d2fbf871..HEAD -- dist/public.d.ts`) |
| `BlockedToolInput`, `RECURSION_DENYLIST` (removed) | Matches: no occurrence left |

**Drift warnings** (non-blocking):

- None in the contracts.

---

## 6. Clean Tree and Commit Range

- [x] Working tree is clean (`git status --porcelain` empty)

**Commit range**: `786e42c1..b0059a96` (11 commits; the base of the branch is `d2fbf871`, feature branch `docs/blocked-tools-by-grant`)

---

## Issues

**CRITICAL**: none.

**WARNING**: none.

**SUGGESTION**
1. `packages/pi-subagents/src/lifecycle/create-subagent-session.ts:308-309`: the comment says `disallowed_tools` applies "before the recursion denylist". It still describes `finalToolNames` ordering correctly (the guard is applied by the SDK denylist), so it is not wrong, but the word is now unrelated to the count. Recommendation: leave it, or reword to "before the SDK's recursion denylist".
2. Scenario "Policy removal is blocked" and "Nothing blocked" in `registry.test.ts` give the same result under the old rule; the lifecycle tests at `create-subagent-session.test.ts:661` and `:632` carry the discriminating assertions. Recommendation: none needed; noted for transparency.
3. `bun run lint` fails repo-wide on files this change does not touch (`dist/*.d.ts`, `package.json`, `biome.json`, `vitest.config.ts`), as on `main`. Recommendation: track separately; not part of this change.

---

## Overall Decision

- [ ] PASS: proceed with `/opsx-continue` to finalize
- [x] PASS_WITH_WARNINGS: proceed, noting: only suggestions remain (comment wording, a repo-wide lint failure that predates the change); no warnings, no CRITICAL issue
- [ ] FAIL: fix the cause, then re-apply (iteration N+1)

**Next step**:

Run `/opsx-continue` with the worktree as the working directory to create the finalize artifact, then `/opsx-archive`.
