## 1. Run-facts formatter and glyphs

Blocked by: none

- [x] 1.1 Add `tools: "🔧"` and `blocked: "⊘"` to `GLYPHS` in `packages/pi-subagents/src/ui/glyphs.ts`, with their coverage noted in the header comment (design D6)
- [x] 1.2 Create `packages/pi-subagents/src/ui/run-facts.ts`: `RunFacts`, `runFactsOf(source)`, `formatRunFacts(facts)` (named parts) and `runFactParts(facts)` (ordered list) per design D1 and spec "Run facts format"
- [x] 1.3 Unit tests `packages/pi-subagents/test/ui/run-facts.test.ts`: all facts, `⊘` hidden at 0, unknown facts omitted, no parts when nothing is known

## 2. Tool facts captured on the record

Blocked by: none

- [x] 2.1 `LaunchPlan` gains `removed` (accepted removals that were defaults) in `packages/pi-subagents/src/seams/launch-plan.ts`; carry it through `LaunchOverrides.tools` (`src/seams/launch-gate.ts`) and `CreateSubagentSessionParams.tools` (design D4). Tests in `test/seams/launch-policy.test.ts`: accepted removal listed, refused declared-tool removal not listed, a removal of a non-default not listed
- [x] 2.2 Export `BUILTIN_EXTENSION_TOOL_NAMES` from `packages/pi-subagents/src/session/builtin-extensions.ts` (reused by its `supplies` predicates), and add `blockedToolCount({ candidates, disallowed, policyRemoved, grantedTools, isKnown })` to `packages/pi-subagents/src/seams/registry.ts` (design D4). Tests in `test/seams/registry.test.ts` for every "Blocked tool count fact" scenario: disallowed in the candidates, disallowed protocol tool, protocol tool not installed, disallowed built-in extension tool, unknown name, unregistered MCP name, policy removal, removal granted back, both sources, recursion denylist
- [x] 2.3 In `packages/pi-subagents/src/lifecycle/create-subagent-session.ts`, after `enforceGrants`, compute the tool count (`getActiveToolNames().length`) and the blocked count from the candidate list (agent tools after MCP expansion plus installed protocol tools, never the policy list), and report both through a new optional `onToolFacts` param; a throw leaves them unreported and the launch unaffected. Extend `test/lifecycle/create-subagent-session.test.ts` with "Count after the grant check", "Tool appears after the policy ran" and "Unreadable tool list"
- [x] 2.4 In `packages/pi-subagents/src/lifecycle/subagent.ts`, store the facts in `_toolFacts` with a `toolFacts` getter that survives `releaseSession()`; cover it in the existing lifecycle tests
- [x] 2.5 Add optional `toolCount` and `blockedToolCount` to `SubagentRecord` in `packages/pi-subagents/src/service/service.ts`; map them in `toSubagentRecord` (`src/service/service-adapter.ts`); test bound vs queued records in `test/service/`

## 3. Inline result uses run facts

Blocked by: 1, 2

- [x] 3.1 `AgentDetails` (`src/ui/display.ts`) gains `thinking` and the tool facts; `buildInvocationTags` stops emitting `thinking:`; `detailBase` in `src/tools/spawn-config.ts` carries the spawn thinking as the pre-session fallback (design D2)
- [x] 3.2 `buildDetails` (`src/tools/helpers.ts`) and `startProgressStream` (`src/tools/progress-stream.ts`) fill the facts from the record (`thinkingLevel`, `toolFacts`)
- [x] 3.3 `renderStats` in `src/tools/result-renderer.ts` keeps today's order: the model part, the mode label, the thinking part, the tool parts, the other tags, the turn budget, tool uses and tokens (design D2)
- [x] 3.4 Update `test/tools/result-renderer.test.ts`, `test/tools/spawn-config.test.ts`, `test/tools/helpers.test.ts` and `test/tools/progress-stream.test.ts`; add the "Policy-changed thinking shown live" and "Existing order kept" scenarios

## 4. Widget and fleet row use run facts

Blocked by: 1, 2

- [x] 4.1 `WidgetAgent` gains the run-facts fields; `AgentWidget.toWidgetAgent` (`src/ui/agent-widget.ts`) fills them; `modelTag` in `src/ui/widget-renderer.ts` becomes the bracket run-facts tag, used for both running and finished lines. Tests in `test/widget-renderer.test.ts` and `test/ui/agent-widget.test.ts`
- [x] 4.2 `FleetAgent` and `renderAgentRow` in `src/ui/fleet-roster.ts` append the run-facts parts after the description (design D7). Tests in `test/ui/fleet-roster.test.ts` for "Row with run facts" and "Narrow row keeps stats" (width 40); the existing "Row text" and "Narrow terminal" tests stay green

## 5. Public types, provenance and docs

Blocked by: 3, 4

- [x] 5.1 Regenerate `packages/pi-subagents/dist/public.d.ts` with `bun run --cwd packages/pi-subagents build:types` and run `verify:public-types`
- [x] 5.2 Add or update `VENDORED.md` rows for every new and edited file under `packages/pi-subagents/`; `tests/vendoring.test.ts` passes
- [x] 5.3 Update `packages/pi-subagents/README.md` (widget, inline result and fleet list examples), `docs/usage-guide.md` (subagent list row) and `CHANGELOG.md` (Unreleased)
- [x] 5.4 Host test `tests/host/run-facts-offline.test.ts` (executor-only install, `policy` probe reporting record counts): one subagent against the loopback provider fixture; the record carries `toolCount` and `blockedToolCount`, and the fixture sees only the run's provider requests (spec "Run facts make no outside calls")
- [x] 5.5 Run `bun run test:executor`, `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test` from the root; all pass

## 6. End-to-end check

Blocked by: 5

- [ ] 6.1 With `tests/host/manual/fleet-fixture.ts` and an agent file that sets `disallowed_tools`, run Pi interactively in tmux with `PI_OFFLINE=1` against the loopback fixture. Launch one background and one foreground subagent, and confirm that the widget, the inline result and the fleet row show the same model, `thinking:`, `🔧N` and `⊘M`, and that every detail shown before is still there. Record the evidence in `docs/evidence/<date>-row-details.md`
