## Context

`createSubagentSession` already reads the child's tool facts once, after `bindExtensions` and the grant check (`reportToolFacts` → `computeToolFacts`). `toolCount` is `session.getActiveToolNames().length`. `blockedToolCount` comes from `blockedToolCount()` in `src/seams/registry.ts`, which merges `disallowed_tools` and policy removals, filtered by a "known tools" set and the recursion denylist. The parent's tool names come from `deps.listParentToolNames()` (`pi.getAllTools()`, which includes tools that are registered but not active).

## Goals / Non-Goals

**Goals:**
- `blockedToolCount` = size of (total − child's active tools), where total = parent tool names ∪ child's active tool names.
- One computation, no per-source bookkeeping, same read moment as today.

**Non-Goals:**
- Any change to how tools are granted, removed or assessed; to the formatter, surfaces or record shape; listing tool names.

## Decisions

- **Difference of sets, not per-source counting.** `blocked = |(parentToolNames ∪ active) − active|`. The child's own tools (`ask_parent`, `notify_parent`) and anything its extensions install appear in `active`, so they join the total as granted and `🔧N + ⊘M = |parentToolNames ∪ active|` holds by construction. Alternative kept out: keep `blockedToolCount()` and add the allowlist as a third source. It keeps the old rules (known-name filter, refused removals, re-grants) that exist only because the count was assembled from sources, and it does not guarantee that the two numbers add up to the total.
- **The recursion denylist is not special-cased.** `subagent`, `get_subagent_result` and `steer_subagent` are parent tools the child lacks, so they fall out as blocked. The `RECURSION_DENYLIST` constant and the `isKnown` filter in `registry.ts` become unused and are deleted with `BlockedToolInput`.
- **Two read moments.** The parent's tool names are snapshotted when the child session is created (before extensions load and bind), and the child's active tools are read after bind and the grant check. Tools registered in the parent after the snapshot are not counted; `toolCount` and `blockedToolCount` stay fixed once bound and survive release (`Tool facts survive the session` is unchanged).
- **No new input.** `ToolFactsInput` loses `candidates`, `protocolNames`, `disallowed`, `policyRemoved` and `grantedTools` and keeps `session` and `parentToolNames`; the call site in `createSubagentSession` shrinks accordingly. `ToolFacts` and `onToolFacts` keep their shape, so nothing else in `pi-subagents` or in jev-pilot changes.
- **No `public` contract changes.** `SubagentRecord.blockedToolCount` keeps its name and type; only its documented meaning changes (doc comments in `service.ts`, `identity.ts`, `display.ts`), so `dist/public.d.ts` is regenerated with the new comment.

## Risks / Trade-offs

- [`⊘` is no longer 0 in the common case, so the part is almost always shown] → Intended: the operator wants to see the split. The width cost is one more part, already budgeted by the narrow fleet row truncation rules.
- [The total depends on what the parent has registered at bind time, so two children of different parents show different totals] → Accepted: the total is "the tools of pi" at that moment.
- [Existing tests assert the old per-source numbers] → Replaced in the same change; the offline loopback test is updated to the new value.
