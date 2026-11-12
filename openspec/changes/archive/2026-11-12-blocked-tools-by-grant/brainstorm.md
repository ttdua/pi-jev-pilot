## Design Summary

Every tool in pi is either **granted** to the child or **blocked** from it. The run facts `🔧N ⊘M` report exactly that split, and `N + M` is the total number of tools in pi (the same for every child launched from the same parent).

**Why.** Shipped in #65, `⊘M` counts only tools removed by the agent file's `disallowed_tools` or the launch policy's `removeTools`. In the operator's real setup this is always 0 and the part is hidden: the Jev ledger scores 32 tools per launch with 0 flagged, and the agents declare no `disallowed_tools`. Yet `code-reviewer` declares `tools:` with 10 names, so it is denied most of what the parent has. The operator cannot see that. The operator's rule: a child's tools are of two kinds, granted and blocked; do not make it more complicated.

**What the operator sees.** Unchanged format, new meaning for `⊘`:

```
anthropic/claude-haiku-4-5 · thinking: high · 🔧10 · ⊘13
```

- **🔧N** (granted): tools the child can call once it has started. Unchanged.
- **⊘M** (blocked): every other tool in the total (confirmed by the operator: count everything known; tools the subagent may use are granted, the rest are blocked). That covers tools left out of the agent's `tools:` allowlist, tools removed by `disallowed_tools`, tools removed by the launch policy, and the executor's recursion denylist (`subagent`, `get_subagent_result`, `steer_subagent`), which no child can call.
- **Total** = the tools of pi (the parent's tools) plus the subagent's own tools: the protocol tools the launch installs for the child (`ask_parent`, `notify_parent`). The subagent's own tools are granted, so they are in the total and never blocked.
- Invariant: `N + M` = total, always. Nothing is excluded from the count.
- `⊘` stays omitted when M is 0, and unknown before the child binds.
- Format, order, surfaces (inline result, `Agents` widget, fleet row) and the `SubagentRecord` fields do not change.

**Goals.** `⊘M` is non-zero whenever the child has fewer tools than its parent, so the operator sees how restricted a child is.

**Non-goals.** Listing tool names; a third category; any change to how tools are granted or removed; changing the Jev tool assessment.

**Anti-goals.** A blocked count that drifts from reality because it needs per-source bookkeeping; a tool that is neither granted nor blocked; a new glyph or field.

**Existing specs involved.** `subagent-run-facts`:
- "Blocked tool count fact" is **replaced**: it counts only `disallowed_tools` and policy removals, and ignores the allowlist. Several of its scenarios (Unknown name not counted, Unregistered MCP name not counted, Rejected removal not counted, Both sources remove the same tool, Tool appears after the policy ran, Recursion denylist not counted) describe the old source-by-source counting and are rewritten or removed.
- "Tool count fact", "Tool facts survive the session", "Run facts format" and the three surface requirements are **unchanged**.

## Alternatives Considered

### Alternative A: Parent tools minus child tools
- **Approach**: total = parent's tools ∪ child's active tools; blocked = total − child's active tools, read once after bind.
- **Pros**: one rule, one computation, no per-source bookkeeping; `N + M` = total by construction; automatically right for allowlists, `disallowed_tools`, policy removals and re-grants.
- **Cons**: the number depends on which tools the parent has; a tool that registers in the parent after bind is not counted.
- **Why not chosen**: chosen (see Agreed Approach).

### Alternative B: Keep the narrow count and add a second number for the allowlist
- **Approach**: keep `⊘` as shipped and show a new part for tools outside the allowlist.
- **Pros**: keeps the old meaning.
- **Cons**: two kinds of "not allowed", a new glyph, a longer row; the operator asked for two kinds only.
- **Why not chosen**: more complicated than the operator wants.

### Alternative C: Keep as is and document
- **Approach**: state in docs that `⊘` counts only `disallowed_tools` and policy removals.
- **Pros**: no code change.
- **Cons**: `⊘` stays 0 in practice; the question the operator wants answered stays unanswered.
- **Why not chosen**: does not meet the need.

## Agreed Approach

Alternative A. The operator answered the design question in the Inbox ("a child's tools are granted or blocked; do not make it more complicated") and A is the only option with one rule and no extra kind.

## Key Decisions

- `⊘M` = total − `🔧N`, where total = parent's tools ∪ child's active tools. The recursion denylist counts as blocked.
- Protocol tools are in the total and granted, never blocked.
- This reverses the earlier, narrower rule that excluded the recursion denylist; `⊘` is at least 3 for a child whose parent has those three tools.
- The parent tool list is read at the same moment as today's tool facts (after bind); a tool that registers in the parent later is not counted.
- No change to the `SubagentRecord` shape, the formatter or the surfaces; only the meaning and the computation of `blockedToolCount`.

## Open Questions

None. The operator confirmed that the three orchestration tools are counted as blocked.
