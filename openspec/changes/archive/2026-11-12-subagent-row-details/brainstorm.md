## Design Summary

Every place the vendored executor draws a subagent shows the same run facts,
worded the same way: **model**, **thinking level**, **tool count** and
**blocked tool count**. Tracked in ttdua/pi-jev-pilot#63; follows #62
(fleet list).

**Why.** The executor draws a subagent in three places, and they have drifted:

| Fact | Inline tool result (foreground) | `Agents` widget (background) | Fleet row (#62) |
|---|---|---|---|
| Model | `provider/id`, live | `[provider/id]` tag, live | not shown |
| Thinking | `thinking: <level>` from the **spawn call** | not shown | not shown |
| Tool count | not shown | not shown | not shown |
| Blocked tools | not shown | not shown | not shown |

The inline result's thinking level is stale: it reads the value the `subagent`
call asked for, so when jev-pilot's launch policy changes thinking, the screen
shows a level the run does not use. The operator wants to trust what each row
says and to see at a glance how much a child was allowed to do.

**What the operator sees.** One run-facts group, the same on all three
surfaces:

```
anthropic/claude-haiku-4-5 · thinking: high · 🔧12 ⊘3
```

- **Model** and **thinking** are the values the run actually uses (after
  agent-file locks, the launch policy and model resolution), never the spawn
  call's request.
- **🔧N** is the number of tools the child can call once it has started.
- **⊘N** is the number of tools deliberately taken away from the child: tools
  it would otherwise have had (its default tools and policy grants) that the
  agent file's `disallowed_tools` or the launch policy's `removeTools` removed.
  The executor's own recursion denylist (`subagent`, `get_subagent_result`,
  `steer_subagent`), which every child loses, is not counted, and neither is a
  disallowed name the child would never have had. `⊘` is omitted when the
  count is 0.
- A fact not known yet (a queued run with no session) is omitted, not shown as
  a placeholder.
- **Before the session exists** (clarified during spec review, to reconcile
  with "additive only"): the inline result already shows the model the launch
  resolved before the child session exists. That value stays visible until the
  session exists, then the live value replaces it; thinking follows the same
  rule. Tool facts have no such value and stay omitted until the child binds.
- The facts stay correct after the run finishes and its session is released,
  so a lingering fleet row or a finished widget line still shows them.
- In the narrow fleet row the group sits after the description and is
  truncated before the right-aligned elapsed time and tokens.

**Additive only (operator).** The change adds and corrects information; it
removes none. Every detail each surface shows today stays, with its current
wording and position:

| Surface | Kept as is | Replaced by the run-facts group | Added |
|---|---|---|---|
| Inline result | spinner/status icon, tags `inherit context`, `background`, `max turns: N`, turn budget `↻N≤M`, `N tool uses`, tokens, duration, activity/result lines | `provider/id` and the spawn-call `thinking: <level>` tag (same wording, live values) | `🔧N`, `⊘M` |
| `Agents` widget | icon, name, mode label `(twin)`, description, turn budget (warning color), `N tool uses`, tokens with context % and compaction count, elapsed, activity line, error/stopped/aborted text | `[provider/id]` tag | `thinking: <level>`, `🔧N`, `⊘M` |
| Fleet row | marker, display name, description, right-aligned `<s>s · ↓ <tokens> tokens` | — | model, `thinking: <level>`, `🔧N`, `⊘M` |

`🔧N` (tools the child can call) is a different number from `N tool uses`
(calls made so far); both are shown.

**Goals.** One source for the four facts on all three surfaces; live thinking
everywhere; tool and blocked counts visible and available to consumers on the
`SubagentRecord` snapshot.

**Non-goals.** Unifying the other per-surface details (context %, compaction
count, turn budget color, `inherit context`/`background`/`max turns` tags,
mode label, elapsed and token formats); listing tool names; any change to how
tools are granted or removed.

**Anti-goals.** A row that disagrees with the run (a stale thinking level); a
blocked count that is never zero because it counts the recursion denylist;
facts that vanish when the session is released; any detail a surface shows
today disappearing or changing meaning.

**Existing specs involved.**
- `executor-launch-identity` — "Effective model and thinking" already records
  `effectiveModel`/`effectiveThinking`; this change reads them for display and
  adds tool facts alongside. "Identity fields are additive": the new record
  fields are optional and no existing field changes. Not altered.
- `executor-launch-policy` — "Applying the policy's adjustment" and "Grants are
  checked in the child" define what `removeTools` and grants do; this change
  only counts their result. Not altered.
- `fleet-view` — "Fleet list row content" is **altered**: the row gains the
  run-facts group between the description and the right-aligned stats.
- `executor-vendoring` — "Upstream provenance": every edited upstream file and
  new file gets a `VENDORED.md` row.
- No jev-pilot capability under `src/` changes; Jev is not called.

## Alternatives Considered

### Alternative A: Shared formatter, tool facts captured at bind
- **Approach**: One pure run-facts formatter used by all three surfaces; the
  executor records the child's tool count and blocked count on the record
  right after the grant check, the way it records the effective model and
  thinking.
- **Pros**: One source of truth; facts survive session release; small edits to
  the two upstream renderers (their stats assembly only).
- **Cons**: A few more upstream files edited and recorded in `VENDORED.md`;
  new optional fields on the public record type.
- **Why not chosen**: Chosen.

### Alternative B: Read tool facts from the live session at render time
- **Approach**: Renderers ask the session for its active tools when drawing.
- **Pros**: Fewer new record fields.
- **Cons**: Facts vanish once the session is released (finished, lingering
  rows); the blocked count cannot be rebuilt because the removed names are not
  kept anywhere.
- **Why not chosen**: Fails the "facts survive release" goal.

### Alternative C: One shared renderer component for all surfaces
- **Approach**: Replace the inline and widget renderers with one component.
- **Pros**: Removes all drift, not only the four facts.
- **Cons**: Rewrites most of two upstream files; large vendored diff; beyond
  #63's scope.
- **Why not chosen**: Too large for the problem; the other details are a
  non-goal.

## Agreed Approach

Alternative A, chosen by the operator: a shared run-facts formatter fed by
facts the executor records on each run (live model and thinking, tool count
and blocked count captured once the child has bound), used by the inline
result, the `Agents` widget and the fleet row.

## Key Decisions

- The four facts are model, thinking, tool count, blocked count; nothing else
  is unified (agent's call from #63's scope, accepted).
- Additive only: every detail a surface shows today stays; the change only
  adds facts and makes model and thinking live (operator).
- Blocked count = tools deliberately removed by `disallowed_tools` or the
  launch policy from what the child would otherwise have had; the recursion
  denylist and never-present names are excluded (operator).
- Model and thinking shown are the run's effective values everywhere
  (operator, #63).
- Approach A (operator).
- Display form `provider/id · thinking: <level> · 🔧N ⊘M`, `⊘` hidden at 0,
  unknown facts omitted (agent's call).
- The tool facts appear on the `SubagentRecord` snapshot as optional fields
  (agent's call, consistent with "Identity fields are additive").

## Open Questions

- None blocking. Field names and the exact capture point are left to the
  design.
