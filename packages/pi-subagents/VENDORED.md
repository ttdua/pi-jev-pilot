# Vendored executor

This directory is a vendored copy of `@gotgenes/pi-subagents`, kept in the tree so that jev-pilot can add seams to it. Behavior is unchanged from upstream apart from the changes listed below.

## Upstream

- Repository: `gotgenes/pi-packages` (https://github.com/gotgenes/pi-packages)
- Path: `packages/pi-subagents`
- Tag: `pi-subagents-v25.0.5`
- Commit: `a4dd5f7611a2d7687a50899e99be7bd727ddc2b0`
- Upstream tree commit: `dbaae7983b000d9916645856b524465a4d953153`, kept reachable by the tag `vendor/pi-subagents-v25.0.5`
- Upstream split commit: `e6b408e8c5a1036c00a8b5f233549cedcb83f77c`
- License: MIT, see `LICENSE` (unchanged)

"Upstream tree commit" is the squash commit `git subtree add --squash` created for the vendored tree (archive it for the pristine upstream tree). A squash merge of the pull request leaves it out of `main`'s history, so a `vendor/pi-subagents-v<version>` tag must point at it; the tests read it. "Upstream split commit" is the `git subtree split --prefix packages/pi-subagents` commit of the tag; it is not in this repository's history. `.upstream-manifest` lists the blob id of every file at that tree (`bun scripts/vendor-manifest.ts <commit>`); `tests/vendoring.test.ts` fails when a file differs from it without a row below.

## Local changes

| File | Kind | Reason |
|---|---|---|
| `package.json` | edit | Rename to private `@ttdua/pi-subagents`; drop `publishConfig`; replace `catalog:` versions with the exact versions from upstream `pnpm-workspace.yaml` at the tag; pin the `@earendil-works/*` dev dependencies to `1.5.0` to match the root; `lint` without markdown lint; `prepack` through `bun`. |
| `tsconfig.json` | edit | Inline upstream's `tsconfig.base.json` compiler options, since the base file lives outside the subtree. |
| `test/ui/widget-viewport.test.ts` | edit | `fakeTerminal` gains `setProgramStatus`, required by the `Terminal` type in pi-tui 1.5.0. |
| `test/ui/session-navigator.test.ts` | edit | Bind top/bottom to `home`/`end` in the test keybindings; pi-tui 1.5.0 defaults them to `ctrl+home`/`ctrl+end`. Cover `openTranscript`. |
| `src/ui/session-navigation.ts` | edit | Add `navigationEntryFor`, the per-record live/snapshot entry, shared by `listNavigableAgents` and the fleet list. |
| `src/ui/session-navigator.ts` | edit | Add `openTranscript`, the source/mount step of the session pane, shared by the picker handler and the fleet list. |
| `test/ui/session-navigation.test.ts` | edit | Cover `navigationEntryFor`. |
| `src/settings.ts` | edit | Add the `fleetView` setting (default on, boolean-only load, always in the snapshot, `toggleFleetView`) for the below-editor fleet list. |
| `src/ui/subagents-settings.ts` | edit | Add the `Fleet view` toggle row after the mid-run updates row. |
| `src/seams/identity.ts` | seam | Launch identity (`agentId`, `agentType`, `toolCallId`) and effective model/thinking facts. Add `ToolFacts` (tool count and blocked tool count). |
| `src/seams/service-identity.ts` | seam | Publish the service at load unless this implementation's service already holds the slot; remove only one's own. |
| `src/index.ts` | edit | Publish the service at load through `ServicePublication` (not over an existing vendored service); bind the session id at `session_start`; unpublish only the instance's own service. Hand the service an `AgentTypeCatalog` over the registry. Give the manager the launch context (parent `getAllTools()`, `excludedExtensionPackages`). Construct the `FleetList`, add it as an observer, hand it the UI at `session_start`, refresh on `subagents:settings_changed`, dispose at `session_shutdown`. |
| `src/service/service.ts` | edit | Add `implementation`, `sessionId` to `SubagentsService` and `effectiveModel`, `effectiveThinking` to `SubagentRecord`. Add `AgentTypeSnapshot`, `listAgentTypes`, `getAgentType`; re-export `LockableField`. Add `LaunchPolicy`, `LaunchRequest`, `LaunchAdjustment`, `LaunchOrigin` and `registerLaunchPolicy`. Add optional `toolCount` and `blockedToolCount` to `SubagentRecord`. |
| `src/service/service-adapter.ts` | edit | Carry `implementation` and `sessionId` (bound at first `session_start`); map the effective facts into the record snapshot. Serve `listAgentTypes`/`getAgentType` through the injected catalog. Forward `registerLaunchPolicy`; service spawns carry `origin: service`. Copy the tool facts into the record snapshot. |
| `src/lifecycle/child-lifecycle.ts` | edit | Child events carry `agentId`, `agentType`, `toolCallId`; `session-created` carries the effective facts; `bound` carries `grantedTools`. |
| `src/lifecycle/create-subagent-session.ts` | edit | Take `agentId`; publish launch identity and effective facts on child events. Apply `disallowed_tools` through `finalToolNames` before the recursion denylist. Take the launch policy's tool plan; check grants after bind and report `grantedTools` on `bound`; dispose the child if not even the pre-grant tool set can be restored. Report tool count and blocked tool count (`onToolFacts`) after the grant check; carry `tools.removed`. |
| `src/lifecycle/subagent.ts` | edit | Pass `agentId` to the session factory, store effective facts, track the resume's tool call id. Consult the launch policy after dequeue and before session creation (new launches only); a launch cancelled meanwhile ends `stopped`. With a policy registered, the gate's model/thinking (locks and adjustment applied) are authoritative. Store the tool facts (`toolFacts`), kept across `releaseSession()`. |
| `src/lifecycle/subagent-manager.ts` | edit | Forward the resume's `toolCallId` to the record. Own the launch policy slot; `AgentSpawnConfig.origin`; hand each record the launch gate. |
| `src/tools/agent-tool.ts` | edit | Pass the `subagent` call's tool call id to `startResume`; launches carry `origin: tool`. |
| `src/observation/subagent-events-observer.ts` | edit | Record events carry `toolCallId` when launched or resumed from a tool call. |
| `test/lifecycle/child-lifecycle.test.ts` | edit | Child event payloads now include launch identity fields. |
| `test/lifecycle/create-subagent-session.test.ts` | edit | Pass the required `agentId`; event expectations use `objectContaining` for the added identity fields. Tool facts tests; `tools` carries `removed`. |
| `test/composition-root.test.ts` | edit | Clear the published service after each test; a later load no longer replaces an earlier vendored service. The recording UI gains `onTerminalInput`/`getEditorText`, and `agents` widget assertions check the last call for that key. |
| `test/tools/agent-tool.test.ts` | edit | Resume now forwards `toolCallId`; expectations include it. Fixtures carry `toolsDeclared`/`disallowedTools`. |
| `dist/public.d.ts` | seam | Regenerated by `build:types`; exports the extended service, record and event types. Includes `AgentTypeSnapshot` and the registry methods, and the launch policy types and `registerLaunchPolicy`. `SubagentRecord` gains optional `toolCount` and `blockedToolCount`. |
| `dist/settings.d.ts` | seam | Generated alongside `public.d.ts` by `build:types`. |
| `test/seams/identity.test.ts` | seam | Tests for launch identity and effective facts (spawn fixtures carry `origin`). Tool facts on the record snapshot. |
| `test/seams/service-identity.test.ts` | seam | Tests for service ownership across main and child sessions. |
| `test/seams/fleet-wiring.test.ts` | seam | Fleet list wiring through the real `index.ts`: widget placement, settings switch, input listener, shutdown. |
| `test/seams/service-wiring.test.ts` | seam | Service publication at load and session binding through the real `index.ts` wiring. The UI stub gains `onTerminalInput`/`getEditorText`. |
| `test/print-mode.test.ts` | edit | The headless UI stub gains `onTerminalInput`/`getEditorText`, which the fleet list needs at `session_start`. |
| `src/seams/registry.ts` | seam | Agent registry query (`AgentTypeCatalog`, deep-frozen `AgentTypeSnapshot`) and `finalToolNames`, the single place `disallowed_tools` applies. Add `blockedToolCount`. |
| `src/types.ts` | edit | `AgentConfig` gains `toolsDeclared` and `disallowedTools`. |
| `src/config/custom-agents.ts` | edit | Parse `disallowed_tools` with `listField`, record `toolsDeclared`, debug-note tools both declared and disallowed. |
| `src/config/agent-types.ts` | edit | Absolute fallback config sets `toolsDeclared`/`disallowedTools`. |
| `src/config/default-agents.ts` | edit | Built-ins set `toolsDeclared`/`disallowedTools`. |
| `test/seams/registry.test.ts` | seam | Tests for the registry query, snapshot fields, `disallowed_tools` parsing and the child allowlist. Blocked tool count and `BUILTIN_EXTENSION_TOOL_NAMES` tests. |
| `test/settings.test.ts` | edit | Tests for the `fleetView` setting; existing snapshot and written-file expectations include `fleetView: true`. |
| `test/ui/subagents-settings.test.ts` | edit | Tests for the `Fleet view` toggle row; the settings fixture carries `fleetView` and `toggleFleetView`. |
| `test/display.test.ts` | edit | `AgentConfig` fixtures carry the new required fields. |
| `test/helpers/make-agent-config.ts` | edit | Fixture builder sets `toolsDeclared`/`disallowedTools`. |
| `test/helpers/make-agent-config.test.ts` | edit | Expected default fixture includes the new fields. |
| `test/helpers/make-deps.ts` | edit | Disabled-agent fixture carries the new required fields. |
| `test/helpers/subagent-session-io.ts` | edit | Default lookup config carries the new required fields. |
| `test/service/service-adapter.test.ts` | edit | Construct the adapter with a no-op agent-type catalog; the manager stub has `registerLaunchPolicy`. |
| `test/session/session-config.test.ts` | edit | `AgentConfig` fixtures carry the new required fields. |
| `test/tools/spawn-config.test.ts` | edit | `AgentConfig` fixtures carry the new required fields. |
| `src/seams/launch-policy.ts` | seam | `LaunchPolicySlot` (one policy, fail-open consult with watchdog and run signal) and `validAdjustment`. |
| `src/seams/launch-request.ts` | seam | Build the frozen `LaunchRequest`; grantable parent tools (minus orchestration tools and excluded packages' tools). |
| `src/seams/locked-launch.ts` | seam | `lockedFields`/`applyLocks`: one lock precedence for the tool and service doors, applied by the launch gate only while a policy is registered. |
| `src/seams/launch-plan.ts` | seam | `applyAdjustment`: precedence rules for model, thinking, grants and removals. `LaunchPlan.removed` lists accepted removals of defaults. |
| `src/seams/launch-gate.ts` | seam | `LaunchPolicyGate`: apply locks, request, consult, apply and resolve the policy model for one launch. Pass `removed` on `LaunchOverrides.tools`. |
| `src/seams/grant-check.ts` | seam | `checkGrants`/`enforceGrants`: keep grants the child registered with a model-callable exposure. |
| `src/tools/background-spawner.ts` | edit | Pass the launch `origin` to the manager. |
| `src/tools/foreground-runner.ts` | edit | Pass the launch `origin` to the manager. |
| `test/seams/launch-policy.test.ts` | seam | Tests for the launch policy slot, request, adjustment rules (incl. effective facts after a rewrite), fail-open and cancellation. Accepted removals and policy-changed thinking tests. |
| `test/seams/grant-check.test.ts` | seam | Tests for the in-child grant check and `grantedTools`. Tool plan carries `removed`. |
| `test/helpers/make-deps.test.ts` | edit | Spawn fixtures carry the now-required `origin`. |
| `test/lifecycle/subagent-manager.test.ts` | edit | Spawn fixtures carry the now-required `origin`. |
| `test/tools/background-spawner.test.ts` | edit | Params carry the launch `origin`. |
| `test/tools/foreground-runner.test.ts` | edit | Params carry the launch `origin`. |
| `src/ui/fleet-roster.ts` | seam | Pure fleet roster and renderer: row filter, ordering, windowing and width-clamped lines. List behavior ported from tintinweb/pi-subagents 0.23.2. |
| `test/ui/fleet-roster.test.ts` | seam | Tests for the fleet roster filter, ordering, formats, layout, overflow windowing and width clamping. |
| `src/ui/fleet-list.ts` | seam | Pi adapter for the below-editor fleet list: active and selection state, 1 s refresh timer, `fleet` widget, terminal-input listener with focus guard, and Enter opening the session pane. Key mechanics ported from tintinweb/pi-subagents 0.23.2. |
| `test/ui/fleet-list.test.ts` | seam | Tests for the fleet list's visibility, activation, navigation, focus guard, open and reselect, observer hooks, and lifecycle with a fake UI and TUI. |
| `docs/decisions/0013-fleet-list-opens-the-session-pane.md` | seam | ADR for the fleet list: it opens the read-only session pane and lists foreground runs; the ported behavior is credited to tintinweb/pi-subagents 0.23.2. |
| `README.md` | edit | Fleet list feature bullet, the `Fleet view` row in the settings description, and a `Fleet list` section with its keys. |
| `docs/configuration.md` | edit | `fleetView` in persistent settings, its default, and the example JSON. |
| `src/ui/run-facts.ts` | seam | Pure run-facts formatter (model, thinking, tool counts) shared by every subagent row surface. |
| `test/ui/run-facts.test.ts` | seam | Tests for the run-facts formatter. |
| `src/ui/glyphs.ts` | edit | Add the `tools` and `blocked` glyphs for the run-facts parts. |
| `src/ui/agent-widget.ts` | edit | `toWidgetAgent` carries the record's `thinkingLevel` and `toolFacts` into the widget snapshot. |
| `src/ui/widget-renderer.ts` | edit | The `[provider/id]` tag becomes the shared run-facts tag (model, thinking, tools, blocked) after the name and mode label. |
| `test/ui/agent-widget.test.ts` | edit | Tests that the widget snapshot carries thinking and tool facts into the rendered tag. |
| `test/widget-renderer.test.ts` | edit | Tests for the run-facts tag on running and finished lines, and omission of unknown facts. |
| `src/session/builtin-extensions.ts` | edit | Export `BUILTIN_EXTENSION_TOOL_NAMES`, the fixed tool names the built-in extensions supply; the `supplies` predicates reuse it. Selection behavior unchanged. |
| `src/ui/display.ts` | edit | `AgentDetails` gains `modeLabel`, `thinking`, `toolCount`, `blockedToolCount`; `buildInvocationTags` no longer emits the thinking tag. |
| `src/tools/spawn-config.ts` | edit | `detailBase` carries `modeLabel` and `thinking`; its `tags` hold invocation tags only. |
| `src/tools/helpers.ts` | edit | `buildDetails` copies the live thinking and tool facts. |
| `src/tools/progress-stream.ts` | edit | Streamed updates carry the record's live thinking and tool facts. |
| `src/tools/result-renderer.ts` | edit | `renderStats` places mode label, thinking and tool parts in the existing order. |
| `test/tools/result-renderer.test.ts` | edit | Run-facts order tests; thinking comes from `details.thinking`. |
| `test/tools/spawn-config.test.ts` | edit | Thinking and mode label on `detailBase`, not in tags. |
| `test/tools/helpers.test.ts` | edit | `buildDetails` copies thinking and tool facts. |
| `test/tools/progress-stream.test.ts` | edit | Streamed update uses the record's live thinking. |
