# Apply Receipt

> Generated at the end of the apply phase to mark code-implementation
> complete and provide verify with the state it needs.
> Overwritten on each apply iteration; iteration counter grows.

**Change**: `launch-metadata`
**Iteration**: `2`
**Applied at**: `2026-11-19 02:40` (UTC)
**Executor**: `subagent-driven-development` (implementer role: `implementer`; task reviewer role: `code-reviewer`; final whole-branch review: `code-reviewer`)

---

## Workspace

- **Worktree path**: `/Users/naicoi/Projects/oss/pi-jev-pilot.launch-metadata`
- **Worktree branch**: `launch-metadata`
- **Feature branch**: `spec/launch-metadata`
- **Base branch**: `main`

---

## Commits

- **Range**: `438c100c..28aa0043` (plus this receipt commit). Iteration 2: `05dc1f34..28aa0043`.
- **Count**: `13`

---

## Tasks

- **Completed**: `17 of 17` checkboxes in tasks.md flipped to `- [x]`
- **Remaining**: none

---

## Contract deviations

- Iteration 2: `PublishedLaunchIdentity` is now re-exported by name from `src/service/service.ts` and listed in `dist/public.d.ts`, which matches its Contracts row (`public`). Iteration 1 had published it only through the event payload types. The verify warning was fixed in code, so the contract shape did not change.
- Iteration 1: none. `packages/pi-subagents/dist/public.d.ts` was regenerated with `build:types`, as planned. It adds `LaunchMetadata`, `ChildSessionInfo`, `childSession`, and `metadata` on `SpawnOptions`, `SubagentRecord`, `LaunchRequest` and the child-event identity.

---

## Lanes

| Task | Lane branch | Lane range | Review | Merge commit |
|---|---|---|---|---|
| Task 1: metadata validation and child-session registry seams | sequential | `438c100c..6f775197` | approved after 1 fix round | n/a (sequential) |
| Task 2: carry metadata through launch, events, record and policy request | sequential | `4c5f4e89..06f161c8` | approved after 1 fix round | n/a (sequential) |
| Task 3: records, generated types and docs | sequential | `52a6670e..1718aeac` | approved | n/a (sequential) |
| Final whole-branch fix wave | sequential | `a084ce73..7d2ea04d` | 3 of 4 addressed; 1 parked, then fixed in iteration 2 | n/a (sequential) |
| Iteration 2: fix of the verify warnings | sequential | `05dc1f34..28aa0043` | approved (scoped re-review) | n/a (sequential) |

---

## Notes

- **Verification run by the implementers at `7d2ea04d`** (all exited 0):
  - `bun run test`: 2637 pass;
  - `bun run test:executor`: 2578 pass, typecheck included;
  - `bun run lint`;
  - `bun run typecheck`.
- **`verify:public-types`** exited 0 at `1718aeac` with the network available. The TSDoc-only change in `7d2ea04d` regenerated `dist/public.d.ts` but did not re-run it.
- **Iteration 2 (user-requested fix of the three PASS_WITH_WARNINGS items from `verify.md`):**
  - `PublishedLaunchIdentity` is exported by name;
  - refusal messages escape DEL and C1 characters, with tests;
  - `design.md` D3 now describes the registry shape the code uses;
  - the stale test name in `plan.md` is fixed.
  - Verified at `28aa0043` from the root; each command exited 0:
    - `bun run test`: 2637 pass;
    - `bun run test:executor`: 2580 pass;
    - `lint`;
    - `typecheck`;
    - `verify:public-types` (run by the implementer).
- **Fixed in iteration 2: C1 control characters in refusal messages** (was parked). Refusal messages escape the key through `JSON.stringify` and cut it to 80 characters. DEL and C1 control characters (U+007F, U+0080 to U+009F) still appear raw. This was Minor in the final review, and there is no second fix wave.
  - Cost if left: a crafted key could put C1 control bytes into a log line written by the extension that calls `spawn()`.
- **Parked: shutdown test path.** The "Gone after the parent session shuts down" test calls `abortAll()` and `dispose()` directly. It does not go through `index.ts`'s real `session_shutdown`.
- **Parked: test typing.** The flow-test harness types payloads as `Record<string, any>`. This is test-only.
- **TDD order in Task 2.** The implementer wrote the implementation before the tests and got the RED run by stashing `src/`. The tests were reviewed and do exercise real boundaries.

---

## Next step

Run `/opsx-verify`.
