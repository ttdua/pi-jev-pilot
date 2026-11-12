## Why

The vendored executor draws a subagent in three places (inline tool result, `Agents` widget, fleet row) and they disagree: the inline result shows the thinking level the spawn call asked for, not the one the launch policy applied; the widget shows no thinking; the fleet row shows neither model nor thinking; and none shows how many tools the child has or how many were deliberately taken away. Tracked in ttdua/pi-jev-pilot#63, after #62 added the fleet row.

## What Changes

- New shared run-facts group, built in one place and drawn on all three surfaces: `provider/id · thinking: <level> · 🔧N · ⊘M`. A fact not yet known is omitted; `⊘` is omitted at 0.
- Model and thinking are the run's actual values once its session exists, never the spawn call's request.
- The executor records, when the child has bound, the number of tools the child can call (`toolCount`) and the number of tools deliberately removed from it (`blockedToolCount`); both survive session release and appear on the `SubagentRecord` snapshot as optional fields.
- Additive only: every detail each surface shows today stays.

**Inline tool result**
- From: `provider/id` (live, falling back to the request) and a `thinking: <level>` tag taken from the spawn call.
- To: the run-facts group, with live model and thinking, plus `🔧N · ⊘M`; every other tag and stat is kept.
- Reason: the thinking tag could disagree with the run.
- Impact: non-breaking display change.

**`Agents` widget**
- From: `[provider/id]` after the name.
- To: `[provider/id · thinking: <level> · 🔧N · ⊘M]`; every other part is kept.
- Reason: thinking and tool facts were missing.
- Impact: non-breaking display change.

**Fleet row**
- From: name, description, right-aligned elapsed and tokens.
- To: the run-facts group follows the description, truncated before the right-aligned stats.
- Reason: the row had no run facts.
- Impact: changes the `fleet-view` "Fleet list row content" requirement.

## Capabilities

### New Capabilities
- `subagent-run-facts`: the four run facts (model, thinking, tool count, blocked tool count), how each is determined, their shared format, their record fields, and their use by the inline result and the `Agents` widget.

### Modified Capabilities
- `fleet-view`: "Fleet list row content" adds the run-facts group between the description and the right-aligned stats.

## Impact

- Code (vendored executor only): new `packages/pi-subagents/src/ui/run-facts.ts`; edits to `src/lifecycle/create-subagent-session.ts` and `src/lifecycle/subagent.ts` (capture tool facts), `src/service/service.ts` and `src/service/service-adapter.ts` (record fields), `src/ui/display.ts`, `src/tools/spawn-config.ts`, `src/tools/helpers.ts`, `src/tools/progress-stream.ts`, `src/tools/result-renderer.ts`, `src/ui/agent-widget.ts`, `src/ui/widget-renderer.ts`, `src/ui/fleet-roster.ts`, `src/ui/glyphs.ts`; regenerated `dist/public.d.ts`; tests under `packages/pi-subagents/test/`. No change to jev-pilot's own `src/`; Jev is not called.
- Public type: `SubagentRecord` gains optional `toolCount` and `blockedToolCount`. No existing field changes.
- Docs updated: `packages/pi-subagents/README.md` (widget and inline examples, fleet list), `packages/pi-subagents/VENDORED.md`, `docs/usage-guide.md` (subagent list row), `CHANGELOG.md`.
- No new dependency; public Pi APIs only.
