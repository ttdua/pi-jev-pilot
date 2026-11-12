# Blocked tools are the rest of the total, end to end (2026-11-12)

Change `blocked-tools-by-grant` (follows `subagent-row-details`, #65). A real interactive Pi in tmux (120x40) against the loopback fixture `tests/host/manual/fleet-fixture.ts`, executor-only install from this worktree, `PI_OFFLINE=1`.

## Setup

- Same as `2026-11-12-row-details.md`, except the project agent `.pi/agents/fleet-probe.md` is replaced after the fixture starts by an allowlist-only agent with **no** `disallowed_tools`:

  ```
  ---
  description: Fleet probe
  tools: read, grep
  ---
  ```

- Before this change that agent showed no `⊘` (the old count only saw `disallowed_tools` and policy removals).
- Child tools, read from the child session files: `read`, `grep`, `ask_parent`, `notify_parent`.

## Result (7 s after `launch`, both children running)

```
 ⠋ fixture/fixture-fast · twin · thinking: low · 🔧4 · ⊘11 · ↻0
● Agents
└─ ⠸ fleet-probe (twin) [fixture/fixture-fast · thinking: low · 🔧4 · ⊘11]  fleet FLEET-BG · ↻0 · 8.9s
  ○ fleet-probe  fleet FLEET-BG  fixture/fixture-fast · thinking: low · 🔧4 · ⊘11   9s · ↓ 0 tokens
```

After both finished: `✓ fixture/fixture-fast · twin · thinking: low · 🔧4 · ⊘11 · ↻1 · 15 token · 20.1s`.

- `🔧4` is the four tools the child has. `⊘11` is every other tool in the total: 4 + 11 = 15 = the parent's registered tools plus the child's own `ask_parent` and `notify_parent`.
- The three surfaces (inline result, `Agents` widget, fleet row) show the same `🔧4 · ⊘11`.

## Limits

- The total (15) is derived from `🔧4 + ⊘11`; the parent's registered tool list is not printed by Pi in this setup, and the parent's request lists only its active tools (7). The unit tests cover the `granted + blocked = total` invariant, `tests/host/run-facts-offline.test.ts` covers the host path with a lower bound.
