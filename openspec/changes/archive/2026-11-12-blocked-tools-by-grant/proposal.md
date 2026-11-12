## Why

The `⊘M` run fact shipped in #65 counts only tools removed by `disallowed_tools` or the launch policy. In real use it is always 0 and hidden: agents declare no `disallowed_tools`, Jev flags no tool, and a narrow `tools:` allowlist (`code-reviewer` has 10 tools of 32) is not counted. The operator cannot see how much a subagent may use. A subagent's tools are of two kinds only: granted or blocked.

## What Changes

**Blocked tool count**
- From: `⊘M` = known tools removed by the agent's `disallowed_tools` or an accepted launch-policy removal, excluding the recursion denylist, unknown names and refused removals.
- To: `⊘M` = every tool in the total that the subagent cannot call. The total is the tools of pi (the parent's registered tools) plus the subagent's own tools (`ask_parent`, `notify_parent`). `🔧N + ⊘M` = total. The three orchestration tools (`subagent`, `get_subagent_result`, `steer_subagent`) count as blocked.
- Reason: the old count hides the main restriction (the allowlist) and needs per-source bookkeeping.
- Impact: non-breaking display and record-value change; `⊘` becomes at least 3 whenever the parent has the three orchestration tools. The format, the three surfaces and the `SubagentRecord` fields are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `subagent-run-facts`: the "Blocked tool count fact" requirement is removed and replaced by "Blocked tool count is the rest of the total". The old per-source scenarios (disallowed, protocol and built-in extension tools counted by name; unknown or unregistered name not counted; rejected removal; re-grant; both sources; late tool; recursion denylist not counted) are dropped on purpose, because the count is no longer assembled from sources. All other requirements stay; their examples keep their numbers.

## Impact

- `packages/pi-subagents/src/lifecycle/create-subagent-session.ts` and `src/seams/registry.ts`: how `blockedToolCount` is computed.
- `packages/pi-subagents/src/service/service.ts`, `src/seams/identity.ts`, `src/ui/display.ts`: doc comments of `blockedToolCount`; the vendored `dist/public.d.ts` is regenerated.
- Tests of the old per-source counting are replaced; the offline loopback test expects the new value.
- No new dependency, no schema, CLI or config change.
