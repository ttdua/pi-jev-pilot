## Context

The vendored executor (`packages/pi-subagents/`) draws a subagent in three places:

- **Inline result** (`src/tools/result-renderer.ts` `renderStats`), fed by `AgentDetails`. `AgentDetails` is built from `SpawnPresentation.detailBase` (`src/tools/spawn-config.ts`), `buildDetails` (`src/tools/helpers.ts`) and `startProgressStream` (`src/tools/progress-stream.ts`). Its model comes from `modelLabel(record.model) ?? detailBase.modelName`. Its thinking comes from `buildInvocationTags` (`src/ui/display.ts`) as a `thinking: <level>` tag frozen at spawn.
- **`Agents` widget** (`src/ui/widget-renderer.ts`), fed by `WidgetAgent`, which is projected in `AgentWidget.toWidgetAgent` (`src/ui/agent-widget.ts`). The model appears as a `[provider/id]` tag (`modelTag`). Thinking is not shown.
- **Fleet row** (`src/ui/fleet-roster.ts` `renderAgentRow`), fed by `FleetAgent`. It shows the name, the description, and elapsed time and tokens right-aligned.

The live values already exist. `Subagent.model` and `Subagent.thinkingLevel` (`src/lifecycle/subagent.ts`) resolve in this order: the live session, then the value captured at `releaseSession()`, then the spawn's `execution` value. Tool facts do not exist anywhere. `createSubagentSession` (`src/lifecycle/create-subagent-session.ts`) computes the child's tool list (`finalToolNames`, then `enforceGrants`), but only `grantedTools` leaves the function, on the `bound` event. When a launch policy is registered, its removals are applied in `applyAdjustment` (`src/seams/launch-plan.ts`). They reach the session factory only as the reduced `params.tools.toolNames`.

## Goals / Non-Goals

**Goals:**
- Build the four facts (model, thinking, tool count, blocked count) and their wording in one pure module.
- Show the run's live model and thinking on all three surfaces.
- Record the tool count and blocked count once per child, so they survive session release and appear on `SubagentRecord`.
- Keep the change additive: every detail a surface shows today stays.

**Non-Goals:**
- Unifying other details (context %, compaction count, turn budget, tags, elapsed and token formats).
- Showing tool names, or publishing tool facts on lifecycle events.
- Any change to how tools are granted, removed or checked.
- Any change to jev-pilot's `src/`.

## Decisions

### D1. One pure run-facts module
Add `src/ui/run-facts.ts` with:
- `RunFacts` (`model?: string`, `thinking?: ThinkingLevel`, `toolCount?: number`, `blockedToolCount?: number`)
- `runFactsOf(source)`, which reads a `Subagent`-shaped source (`model`, `thinkingLevel`, `toolFacts`)
- `formatRunFacts(facts)`, which returns named parts `{ model?, thinking?, tools?, blocked? }` (`provider/id`, `thinking: <level>`, `🔧N`, `⊘M`), plus `runFactParts(facts): string[]` for them in that order. A missing fact has no part, and `blocked` is absent when M is 0.

Each surface joins the parts in its own style:
- inline: dim parts joined by ` · `, as `renderStats` does today
- widget: one bracket tag ` [a · b · c]`
- fleet: ` · `-joined text after the description

*Why over three copies:* the three copies drifting is the defect itself. A pure module is also unit-testable without a TUI, like `widget-renderer.ts` and `fleet-roster.ts`.

### D2. Model and thinking come from the record's resolution order
Every surface reads `Subagent.model` and `Subagent.thinkingLevel`. Once the session exists, these are the run's actual values. Before that (a queued or just-started run) they fall back to the values the launch resolved, which is what the inline model already does today.

The spawn-call `thinking: <level>` tag is removed from `buildInvocationTags`'s output. The inline result's thinking now comes from the record, as `AgentDetails.thinking`. `detailBase` carries the launch's resolved thinking only as the pre-session fallback, the same way `detailBase.modelName` works today.

`renderStats` keeps today's order: model, then mode label, then the thinking part (in the slot where the tag stood), then the tool parts, then the remaining tags, turn budget, tool uses and tokens. To make this possible, `formatRunFacts` returns named parts (`model`, `thinking`, `tools`, `blocked`), so a surface can place each part where it belongs.

This matches the brainstorm's "Before the session exists" clarification: until a session exists, the values the launch resolved are shown, then replaced by the live values. Omitting them would remove information the inline result shows today, which the additive-only rule forbids.

*Why not `effectiveModel`/`effectiveThinking`:* those are frozen at session creation. The live getters also follow a mid-run switch, and they already survive release.

### D3. Tool facts are captured after the grant check
In `createSubagentSession`, right after `enforceGrants`:
- `toolCount = session.getActiveToolNames().length` (the child's real callable set, including protocol tools such as `ask_parent`)
- `blockedToolCount = blockedToolCount(...)` (D4)

The factory reports both through a new optional `onToolFacts` callback, alongside the existing `onEffectiveFacts`. `Subagent` stores them in a private `_toolFacts` and exposes a `toolFacts` getter. The values live on the record, not on the session, so `releaseSession()` does not lose them. A resume reuses the session, so the facts do not change.

*Why after `enforceGrants`:* grants dropped by the check are not callable, so counting earlier would overstate the tools.

### D4. Blocked count comes from explicit removals, not a set difference
The count is built from two recorded sources, never from comparing two tool lists:
- **Policy removals.** `applyAdjustment` (`src/seams/launch-plan.ts`) already computes the accepted removal set. `LaunchPlan` gains `removed`: accepted removals that were in `toolSet.defaults`. It travels through `LaunchOverrides.tools` to `CreateSubagentSessionParams.tools.removed`. Refused removals (declared tools) never enter it. A policy can remove a default and grant it back in the same adjustment. So the factory subtracts the grants that took effect (`grantedTools` from `enforceGrants`) before counting: a tool the child still has is not blocked.
- **Disallowed names.** In the factory, before filtering, the candidate list is the agent's own tools (`cfg.toolNames`, MCP-expanded against the parent's tools) plus the protocol tools installed for this launch. The candidate list never uses the policy's `toolNames`, which already exclude disallowed names. A disallowed name counts if it is in that list and is a known tool.
- **Known tools.** A tool is known if it is one of:
  - a core built-in (`BUILTIN_TOOL_NAMES`)
  - a fixed-name tool a Pi built-in extension supplies (`codemode`, `tool_search`, `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`). `src/session/builtin-extensions.ts` exports `BUILTIN_EXTENSION_TOOL_NAMES`, and its `supplies` predicates reuse that list, so the two cannot drift. A dynamic `mcp__<server>__<tool>` name is known only when the parent has registered it: the MCP predicate only decides whether to load the extension, and does not prove the tool exists
  - an installed protocol tool
  - a parent tool

Add `blockedToolCount({ candidates, disallowed, policyRemoved, grantedTools, isKnown })` to `src/seams/registry.ts`, next to `finalToolNames`, the single place `disallowed_tools` applies. It returns the size of the union of `{disallowed ∩ candidates, known}` and `{policyRemoved − grantedTools}`, minus `subagent`, `get_subagent_result` and `steer_subagent`.

This handles the edge cases:
- an MCP tool that registers between the policy and the session is neither disallowed nor an accepted removal, so it is never counted
- a literal unknown name (`ghost`) is not a known tool
- a protocol tool is counted only when installed
- a tool named by both sources counts once
- grants are never counted, and a removal granted back is not counted
- a disallowed built-in extension tool the parent lacks (`codemode`) is still known
- a literal `mcp__missing__ghost` the parent does not have is unknown

*Why over a set difference between the agent's and the policy's lists:* the parent's tools can change between the policy's request and the session's creation, so a difference would mistake that drift for a removal.

### D5. `SubagentRecord` gains two optional fields
`toSubagentRecord` copies `toolCount` and `blockedToolCount` when they are known. Both are optional and absent before the child binds. This satisfies ADR 0005's admission rules: serializable numbers, fixed at a lifecycle edge, meaningful outside the package, and not derived from display state. It also satisfies the "Identity fields are additive" rule. `dist/public.d.ts` is regenerated with `build:types`.

### D6. Glyphs
`GLYPHS` gains `tools: "🔧"` and `blocked: "⊘"`, with coverage recorded as `glyphs.ts` requires.

`⊘` (U+2298) is covered by Menlo and several monospace families. `🔧` (U+1F527) is an East Asian Wide emoji, drawn by Apple Color Emoji. pi-tui's `visibleWidth` counts it as 2 cells, so it does not collide with the next column (the #669 defect concerns width-1 glyphs). The operator approved `🔧`.

### D7. Fleet row placement (unchanged stats truncation)
`renderAgentRow` builds the left part as `marker name  description  facts`, and `rightAlign` truncates that left part from its end. So the facts are cut first, then the description, while the right-aligned elapsed and tokens stay whole whenever they fit the width. When they do not fit, `rightAlign` truncates them, as it does today. `FleetAgent` gains the run-facts source fields, which `Subagent` already provides.

## Risks / Trade-offs

- [`🔧` renders as a colour emoji or a tofu box in some terminals] → It is width 2 in pi-tui, so the layout holds. If a terminal shows tofu, swapping the glyph is a one-line change in `glyphs.ts`.
- [The widget's bracket tag grows and pushes the description to the right] → Lines are already truncated to the terminal width, and the tag stays short (4 parts at most).
- [`getActiveToolNames()` throws on an odd session] → `onToolFacts` is wrapped so that a failure leaves the facts unknown (omitted) and never fails the launch, in line with the executor's fail-open seams.
- [More vendored files diverge from upstream] → Every edited file gets a `VENDORED.md` row, enforced by `tests/vendoring.test.ts`.

## Open Questions

None.
