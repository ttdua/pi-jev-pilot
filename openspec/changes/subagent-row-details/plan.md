# Subagent Row Details Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`specs/subagent-run-facts/spec.md`, `specs/fleet-view/spec.md`) and `design.md`.

**Goal:** Every surface that draws a subagent (inline result, `Agents` widget, fleet row) shows the same live model, thinking, tool count and blocked tool count. All three come from one pure formatter, and no existing detail is removed.

**Architecture:** A pure `run-facts.ts` builds named parts from a record. The executor captures `toolCount`/`blockedToolCount` once after the child binds and keeps them on the `Subagent` record, which exposes them on `SubagentRecord`. The blocked count is built from explicit provenance: accepted policy removals carried on `LaunchPlan.removed` minus grants that took effect, plus disallowed names from the pre-filter candidate list that are known tools. Each renderer places the named parts in its existing slots.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` 1.5.0, vitest (executor package), bun test (root).

## Global Constraints

- All code changes are under `packages/pi-subagents/`, plus `tests/host/`, `docs/usage-guide.md`, `docs/evidence/` and `CHANGELOG.md`. No file under the root `src/` changes, and Jev is not called.
- Additive only (operator): every part a surface shows today keeps its wording and relative order. Tests that pin today's output stay green, except the expectations the plan names explicitly (the inline `thinking:` source).
- Exact strings:
  - parts `provider/id`, `thinking: <level>`, `🔧<N>`, `⊘<M>`
  - widget tag ` [<parts joined by " · ">]`
  - fleet separator `  ` between description and facts, ` · ` between parts
- Glyphs: `GLYPHS.tools = "🔧"` (U+1F527, width 2 in pi-tui `visibleWidth`), `GLYPHS.blocked = "⊘"` (U+2298, width 1, Menlo-covered).
- Recursion denylist, never counted as blocked: `subagent`, `get_subagent_result`, `steer_subagent`.
- Record fields are optional and absent until bind; only counts are stored, never tool names.
- Every new or edited file in `packages/pi-subagents/` gets a `VENDORED.md` row in the same commit, or `tests/vendoring.test.ts` fails. Tasks 1–4 all edit `VENDORED.md`, so they never run as parallel writer lanes: run them one after another in plan order (1, 2, 3, 4).
- Baseline (2026-11-12): `bun run --cwd packages/pi-subagents test` passes 98 files / 2370 tests.
- Gates: root `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun run test`, and `bun run test:executor`. Tests need no secrets, paid calls or network beyond loopback.

## Review Focus

1. A policy that removes and grants back the same tool must not show `⊘` → test `removal granted back is not blocked` in Task 2.
2. An MCP tool registering between the policy and session creation must not count as blocked → test `tool registered after the policy is not blocked` in Task 2.
3. The inline stats keep today's order with every tag present (`twin`, `inherit context`, `background`, `max turns`) → test `keeps the existing order with run facts` in Task 3.
4. A very narrow fleet row (width 10) with long run facts never exceeds the width → test `clamps a row with run facts at width 10` in Task 4.
5. A queued background agent shows no `🔧`/`⊘` and no placeholder in the widget → test `omits unknown tool facts for a queued agent` in Task 4.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `GLYPHS.tools`, `GLYPHS.blocked` | new | `tools: "🔧"`, `blocked: "⊘"` in `src/ui/glyphs.ts` | no |
| `RunFacts` | new | `interface RunFacts { readonly model?: string; readonly thinking?: ThinkingLevel; readonly toolCount?: number; readonly blockedToolCount?: number }` in `src/ui/run-facts.ts` | no |
| `RunFactsSource` | new | `{ readonly model?: ModelIdentity; readonly thinkingLevel?: ThinkingLevel; readonly toolFacts?: { readonly toolCount: number; readonly blockedToolCount: number } }` (structural, so `run-facts.ts` imports nothing from `seams/`); `Subagent` satisfies it | no |
| `RunFactParts` | new | `{ readonly model?: string; readonly thinking?: string; readonly tools?: string; readonly blocked?: string }` | no |
| `runFactsOf` / `formatRunFacts` / `runFactParts` | new | `runFactsOf(source: RunFactsSource): RunFacts`; `formatRunFacts(facts: RunFacts): RunFactParts`; `runFactParts(facts: RunFacts): string[]` (model, thinking, tools, blocked; absent omitted) | no |
| `ToolFacts` | new | `interface ToolFacts { readonly toolCount: number; readonly blockedToolCount: number }` in `src/seams/identity.ts`, created by Task 2 only; structurally equal to `RunFactsSource.toolFacts` | no |
| `LaunchPlan.removed` | modified | adds `removed: string[]` (accepted removals that were in `toolSet.defaults`, deduplicated) | no |
| `LaunchOverrides.tools` / `CreateSubagentSessionParams.tools` | modified | `{ toolNames; grants; removed: readonly string[] }` | no |
| `CreateSubagentSessionParams.onToolFacts` | new | `onToolFacts?: (facts: ToolFacts) => void` | no |
| `BUILTIN_EXTENSION_TOOL_NAMES` | new | `ReadonlySet<string>` of `codemode`, `tool_search`, `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` in `src/session/builtin-extensions.ts`; the `codemode`/`tool-search` predicates and `MCP_RESOURCE_TOOLS` use it | no |
| `blockedToolCount` | new | `blockedToolCount(p: { candidates: readonly string[]; disallowed: readonly string[]; policyRemoved: readonly string[]; grantedTools: readonly string[]; isKnown: (name: string) => boolean }): number` in `src/seams/registry.ts` | no |
| `Subagent.toolFacts` | new | `get toolFacts(): ToolFacts \| undefined`; set once from `onToolFacts`, kept across `releaseSession()` | no |
| `SubagentRecord.toolCount`, `SubagentRecord.blockedToolCount` | new | `toolCount?: number; blockedToolCount?: number` on `SubagentRecord` (`src/service/service.ts`), absent until bind | yes |
| `AgentDetails` | modified | adds `modeLabel?: string; thinking?: ThinkingLevel; toolCount?: number; blockedToolCount?: number`; `tags` no longer contains the mode label or `thinking: …` (only invocation tags: `inherit context`, `background`, `max turns: N`) | no |
| `SpawnPresentation.detailBase` | modified | adds `modeLabel?: string` (from `getPromptModeLabel`) and `thinking?: ThinkingLevel` (pre-session fallback); `tags` holds invocation tags only. `SpawnPresentation.agentTags` keeps its current value (mode label first) for its other readers | no |
| `buildInvocationTags` | modified | stops emitting `thinking: <level>`; other tags unchanged | no |
| `WidgetAgent` | modified | adds `thinkingLevel?: ThinkingLevel; toolFacts?: ToolFacts` (keeps `model?`) | no |
| `FleetAgent` | modified | `NavigableSubagent & { lifetimeUsage; model?; thinkingLevel?; toolFacts? }` (a `Subagent` satisfies it) | no |

---

## Task 1: Run-facts formatter and glyphs — implements 1

**Covers:** 1.1, 1.2, 1.3
**Difficulty:** Easy
**Blocked by:** none

**Files:**
- Create: `packages/pi-subagents/src/ui/run-facts.ts`, `packages/pi-subagents/test/ui/run-facts.test.ts`
- Modify: `packages/pi-subagents/src/ui/glyphs.ts`, `packages/pi-subagents/VENDORED.md`

**Interfaces:** Produces `RunFacts`, `RunFactsSource`, `RunFactParts`, `runFactsOf`, `formatRunFacts`, `runFactParts`, `GLYPHS.tools`, `GLYPHS.blocked`. Consumes nothing from other tasks: `RunFactsSource.toolFacts` is a structural type, and Task 2's `ToolFacts` matches it without either file importing the other.

- [ ] **Step 1:** Write `test/ui/run-facts.test.ts`:
  - `all facts known`: `runFactParts({ model: "anthropic/claude-haiku-4-5", thinking: "high", toolCount: 12, blockedToolCount: 3 })` → `["anthropic/claude-haiku-4-5", "thinking: high", "🔧12", "⊘3"]`
  - `nothing blocked`: with `blockedToolCount: 0` → no element starting with `⊘`, and `formatRunFacts(...).blocked` is `undefined`
  - `unknown facts`: `{ model: "a/b" }` → `["a/b"]`; `{}` → `[]`
  - `runFactsOf reads a record`: `{ model: { provider: "a", id: "b" }, thinkingLevel: "low", toolFacts: { toolCount: 4, blockedToolCount: 1 } }` → `{ model: "a/b", thinking: "low", toolCount: 4, blockedToolCount: 1 }`; an empty source gives `{}`
- [ ] **Step 2:** Run `bun run --cwd packages/pi-subagents test -- run-facts`; expect FAIL (module missing).
- [ ] **Step 3:** Add both glyphs to `GLYPHS`, with coverage lines in the header comment (`⊘ U+2298 blocked tools: Menlo and 9+ families`; `🔧 U+1F527 tool count: Apple Color Emoji, width 2, not a #669 case`). Implement `run-facts.ts` using `formatModel` from `display.ts`.
- [ ] **Step 4:** Rerun the tests and `bun run --cwd packages/pi-subagents check`; expect PASS.
- [ ] **Step 5:** Add `VENDORED.md` rows (`src/ui/run-facts.ts` seam, `test/ui/run-facts.test.ts` seam, `src/ui/glyphs.ts` edit), then commit `feat(executor): shared run-facts formatter`.

---

## Task 2: Tool facts captured on the record — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4, 2.5
**Difficulty:** Hard
**Blocked by:** none

**Files:**
- Modify: `packages/pi-subagents/src/seams/launch-plan.ts`, `src/seams/launch-gate.ts`, `src/seams/registry.ts`, `src/seams/identity.ts`, `src/session/builtin-extensions.ts`, `src/lifecycle/create-subagent-session.ts`, `src/lifecycle/subagent.ts`, `src/service/service.ts`, `src/service/service-adapter.ts`, `VENDORED.md`
- Test: `packages/pi-subagents/test/seams/launch-policy.test.ts`, `test/seams/registry.test.ts`, `test/lifecycle/create-subagent-session.test.ts`, `test/seams/identity.test.ts`, `test/service/` (the existing `toSubagentRecord` test file)

**Interfaces:** Produces `ToolFacts`, `LaunchPlan.removed`, `tools.removed`, `onToolFacts`, `BUILTIN_EXTENSION_TOOL_NAMES`, `blockedToolCount`, `Subagent.toolFacts`, `SubagentRecord.toolCount`/`blockedToolCount`.

- [ ] **Step 1:** In `launch-policy.test.ts` ("applying the adjustment"), write failing tests:
  - `lists an accepted removal of a default`: defaults `read, edit`, `removeTools: ["edit"]` → `plan.removed` is `["edit"]`
  - `does not list a refused removal`: declared `read, edit`, `removeTools: ["edit"]` → `removed` is `[]`
  - `does not list a removal outside the defaults`: `removeTools: ["web_search"]` → `[]`
- [ ] **Step 2:** In `registry.test.ts` (new `describe("blocked tool count")`), write failing tests with `isKnown = n => ["read","bash","edit","grep","ask_parent"].includes(n) || BUILTIN_EXTENSION_TOOL_NAMES.has(n)`:
  - `counts a disallowed candidate`: candidates `read,bash,edit`, disallowed `bash,write` → 1
  - `counts a disallowed protocol tool`: candidates incl. `ask_parent`, disallowed `ask_parent` → 1
  - `skips a protocol tool not installed`: disallowed `notify_parent`, not in candidates → 0
  - `counts a disallowed built-in extension tool`: candidates `read,codemode`, disallowed `codemode` → 1
  - `skips an unknown name`: candidates `read,ghost`, disallowed `ghost` → 0
  - `counts a policy removal`: policyRemoved `edit` → 1
  - `removal granted back is not blocked`: policyRemoved `bash`, grantedTools `bash` → 0
  - `counts a tool both sources remove once`: disallowed `bash` in candidates, and policyRemoved `bash` → 1
  - `never counts the recursion denylist`: candidates and disallowed `subagent`, policyRemoved `steer_subagent` → 0
  - `skips an unregistered MCP name`: candidates `read,mcp__missing__ghost`, disallowed `mcp__missing__ghost` → 0
  - `BUILTIN_EXTENSION_TOOL_NAMES`: has `codemode`, `tool_search`, `read_mcp_resource`; lacks `mcp__srv__x`, `ghost`; `builtinExtensionsFor(["codemode"])` is unchanged
- [ ] **Step 3:** In `create-subagent-session.test.ts`, write failing tests:
  - `reports tool facts after the grant check`: agent `tools: read, grep`, `askParent` set, no `notifyParent`, grants `web_search` (registered, `direct`) and `parent_only` (unregistered) → `onToolFacts` gets `{ toolCount: 4, blockedToolCount: 0 }`
  - `tool registered after the policy is not blocked`: agent `tools: mcp__srv__*`, `params.tools` `{ toolNames: ["mcp__srv__a"], grants: [], removed: [] }`, `listParentToolNames` → `mcp__srv__a, mcp__srv__b` → `blockedToolCount` 0
  - `unreadable tool list leaves facts unknown`: `getActiveToolNames` throws after `enforceGrants` → `onToolFacts` is not called, the session is returned, and `bound` is emitted
- [ ] **Step 4:** In `identity.test.ts` (or a new `describe("tool facts")` next to "effective model and thinking"), write failing tests using the real manager harness:
  - `bound record carries tool facts`: `toSubagentRecord(getRecord(id))` has `toolCount` and `blockedToolCount` matching the child's active tools and the agent's `disallowed_tools: bash` (expect `blockedToolCount` 1)
  - `queued record has none`: a still-queued record has neither key
  - `facts survive release`: after `releaseSession()`, `record.toolFacts` is unchanged
  - `policy-changed thinking is the record's thinking`: the policy sets `low` on a call asking `high` → `record.thinkingLevel` is `low` once the session exists
- [ ] **Step 5:** Run `bun run --cwd packages/pi-subagents test -- launch-policy registry create-subagent-session identity`; expect the new tests to FAIL.
- [ ] **Step 6:** Implement:
  - `applyAdjustment` sets `removed`, and `overridesOf` passes it on.
  - Export `BUILTIN_EXTENSION_TOOL_NAMES` and make the existing predicates read it.
  - Add `blockedToolCount` per design D4.
  - In `createSubagentSession`, keep the pre-filter candidates (`cfg.toolNames` expanded against `listParentToolNames()`, plus the protocol tool names). After `enforceGrants`, compute both counts inside a `try` (a failure logs with `debugLog` and skips the callback), then call `params.onToolFacts`. `isKnown` is `BUILTIN_TOOL_NAMES ∪ BUILTIN_EXTENSION_TOOL_NAMES ∪ protocol names ∪ listParentToolNames()`.
  - `Subagent` passes `onToolFacts: (f) => { this._toolFacts = f; }` and exposes the `toolFacts` getter.
  - Add the optional fields to `SubagentRecord`, and copy them in `toSubagentRecord`.
- [ ] **Step 7:** Rerun the step 5 command, the full executor suite and `check`; expect PASS. Existing `create-subagent-session` and `launch-policy` expectations that build a full `tools` object gain `removed: []`; record these edits in `VENDORED.md`.
- [ ] **Step 8:** Add `VENDORED.md` rows for every edited source and test file, then commit `feat(executor): record tool and blocked tool counts`.

---

## Task 3: Inline result uses run facts — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4
**Difficulty:** Normal
**Blocked by:** Task 1, Task 2

**Files:**
- Modify: `packages/pi-subagents/src/ui/display.ts`, `src/tools/spawn-config.ts`, `src/tools/helpers.ts`, `src/tools/progress-stream.ts`, `src/tools/result-renderer.ts`, `VENDORED.md`
- Test: `packages/pi-subagents/test/tools/result-renderer.test.ts`, `test/tools/spawn-config.test.ts`, `test/tools/helpers.test.ts`, `test/tools/progress-stream.test.ts`

**Interfaces:** Consumes `formatRunFacts`, `RunFacts`, `Subagent.toolFacts`, `Subagent.thinkingLevel`. Produces the modified `AgentDetails`, `detailBase.thinking` and `buildInvocationTags`.

- [ ] **Step 1:** Write failing tests:
  - `result-renderer.test.ts` `keeps the existing order with run facts`: details `{ modelName: "fixture/fixture-fast", modeLabel: "twin", tags: ["inherit context"], thinking: "low", toolCount: 12, blockedToolCount: 2, turnBudget: { used: 3 }, toolUses: 5, tokens: "1.2k token" }` → the parts appear in the order `fixture/fixture-fast`, `twin`, `thinking: low`, `🔧12`, `⊘2`, `inherit context`, `↻3`, `5 tool uses`, `1.2k token`.
  - `keeps the order without a mode label`: `{ modelName: "a/b", tags: ["inherit context", "background", "max turns: 9"], thinking: "high", toolCount: 3 }` → the order is `a/b`, `thinking: high`, `🔧3`, `inherit context`, `background`, `max turns: 9`.
  - `omits unknown run facts`: no `thinking`, no tool counts → the output has no `thinking:`, `🔧` or `⊘`.
  - The existing test `makeDetails({ tags: ["thinking: high", "inherit context"] })` becomes `makeDetails({ thinking: "high", tags: ["inherit context"] })` with the same expected `[dim:thinking: high]`.
  - `spawn-config.test.ts`: the existing `presentation.agentTags` toContain `thinking: high` test changes to: `detailBase.thinking` is `high`; neither `agentTags` nor `detailBase.tags` contains a `thinking:` entry; for an append-mode agent `detailBase.modeLabel` is `twin` and `detailBase.tags` does not contain `twin`.
  - `progress-stream.test.ts` `streams the record's live thinking`: the record has `thinkingLevel: "low"`, `detailBase.thinking: "high"` → the update's `details.thinking` is `low`.
  - `helpers.test.ts`: `buildDetails` copies `thinkingLevel` (falling back to `base.thinking`) and `toolFacts`.
- [ ] **Step 2:** Run `bun run --cwd packages/pi-subagents test -- result-renderer spawn-config helpers progress-stream`; expect FAIL.
- [ ] **Step 3:** Implement:
  - Remove the thinking push from `buildInvocationTags`. `spawn-config` puts `modeLabel` and `thinking` on `detailBase`, sets `detailBase.tags` to the invocation tags only, and keeps `agentTags` as today.
  - `buildDetails` and `streamUpdate` set `thinking: record?.thinkingLevel ?? detailBase.thinking`, plus `toolCount`/`blockedToolCount` from `record?.toolFacts`.
  - `renderStats` pushes, in order: `modelName`, `modeLabel`, the `thinking`/`tools`/`blocked` parts from `formatRunFacts`, `tags`, the turn budget, tool uses and tokens. `StreamedRecord` adds `thinkingLevel` and `toolFacts`.
- [ ] **Step 4:** Rerun the tests, the full executor suite and `check`; expect PASS.
- [ ] **Step 5:** Add `VENDORED.md` rows, then commit `feat(executor): live thinking and tool facts in the inline result`.

---

## Task 4: Widget and fleet row use run facts — implements 4

**Covers:** 4.1, 4.2
**Difficulty:** Normal
**Blocked by:** Task 1, Task 2

**Files:**
- Modify: `packages/pi-subagents/src/ui/agent-widget.ts`, `src/ui/widget-renderer.ts`, `src/ui/fleet-roster.ts`, `VENDORED.md`
- Test: `packages/pi-subagents/test/widget-renderer.test.ts`, `test/ui/agent-widget.test.ts`, `test/ui/fleet-roster.test.ts`

**Interfaces:** Consumes `runFactsOf`, `runFactParts`. Produces the modified `WidgetAgent` and `FleetAgent`.

- [ ] **Step 1:** Write failing tests:
  - `widget-renderer.test.ts` `shows the run-facts tag after name and mode label`: `makeAgent({ model: { provider: "openai", id: "gpt-6" }, thinkingLevel: "medium", toolFacts: { toolCount: 9, blockedToolCount: 2 }, toolUses: 3 })` → the header contains `[openai/gpt-6 · thinking: medium · 🔧9 · ⊘2]` before the description, and still contains `3 tool uses`. The same holds for the finished line.
  - `omits unknown tool facts for a queued agent`: model known, no thinking, no tool facts → the tag is `[provider/id]`, with no `🔧` or `⊘`. No facts at all → no `[`.
  - `agent-widget.test.ts`: `toWidgetAgent` carries `thinkingLevel` and `toolFacts` from the record.
  - `fleet-roster.test.ts` `Row with run facts`: wide width → the row contains `audit auth  anthropic/claude-haiku-4-5 · thinking: high · 🔧12 · ⊘3` and ends with `12s · ↓ 13.1k tokens`.
  - `Narrow row keeps stats`: width 40 → ends with `12s · ↓ 13.1k tokens`, the row contains `audit`, and `visibleWidth(row) <= 40`.
  - `clamps a row with run facts at width 10`: every line `visibleWidth <= 10`.
- [ ] **Step 2:** Run `bun run --cwd packages/pi-subagents test -- widget-renderer agent-widget fleet-roster`; expect FAIL.
- [ ] **Step 3:** Implement:
  - Replace `modelTag` with `runFactsTag(agent, theme)`: ` ${dim("[" + runFactParts(runFactsOf(agent)).join(" · ") + "]")}`, or `""` when there are no parts.
  - `toWidgetAgent` adds `thinkingLevel` and `toolFacts`.
  - `renderAgentRow` appends `  ${runFactParts(...).join(" · ")}` (dim when unselected) after the description, then calls `rightAlign`.
- [ ] **Step 4:** Rerun the tests, the full executor suite and `check`; expect PASS. The existing "Row text", "Narrow terminal" and widget tests stay green unchanged.
- [ ] **Step 5:** Add `VENDORED.md` rows, then commit `feat(executor): run facts in the agents widget and fleet row`.

---

## Task 5: Public types, provenance and docs — implements 5

**Covers:** 5.1, 5.2, 5.3, 5.4, 5.5
**Difficulty:** Normal
**Blocked by:** Task 3, Task 4

**Files:**
- Modify: `packages/pi-subagents/dist/public.d.ts`, `packages/pi-subagents/VENDORED.md`, `packages/pi-subagents/README.md`, `docs/usage-guide.md`, `CHANGELOG.md`, `tests/host/probes/policy/index.ts`
- Create: `tests/host/run-facts-offline.test.ts`

**Interfaces:** Consumes `SubagentRecord.toolCount`/`blockedToolCount`.

- [ ] **Step 1:** Run `bun run --cwd packages/pi-subagents build:types` and `bun run --cwd packages/pi-subagents verify:public-types`. Expect `public.d.ts` to gain the two optional fields and the verify step to pass.
- [ ] **Step 2:** In `tests/host/probes/policy/index.ts`, subscribe to `subagents:completed` and report `record:facts` with `{ agentId, toolCount, blockedToolCount }`, read from `service()?.getRecord(id)`. Counts and ids only, as the probe's existing rule requires.
- [ ] **Step 3:** Write `tests/host/run-facts-offline.test.ts`, following `tests/host/launch-policy-evidence.test.ts`:
  - setup: a loopback provider fixture; `install: "executor-only"` plus the `policy` probe, so jev-pilot and its Jev client are absent and the executor alone produces the facts; an agent file with `disallowed_tools: bash`; one foreground `subagent` launch with `PI_OFFLINE=1`
  - assert: the probe's `record:facts` has `toolCount > 0` and `blockedToolCount` 1
  - assert: every request the provider fixture recorded matches a scripted reply of the main session or the child. The run-facts code is pure in-memory (Tasks 1–4 have no I/O), so an offline, executor-only run whose facts are present is the observable evidence.
- [ ] **Step 4:** Run `bun test tests/host/run-facts-offline.test.ts`; expect PASS.
- [ ] **Step 5:** Update the docs:
  - `README.md`: widget example lines gain `· thinking: …` inside the bracket, and the inline status table gains the run-facts parts; add a short "Run facts" paragraph explaining `🔧`/`⊘`
  - `docs/usage-guide.md`: the subagent list row mentions model, thinking and tool counts
  - `CHANGELOG.md` Unreleased: an "Added" entry (Refs #63)
- [ ] **Step 6:** Ensure `VENDORED.md` lists every file Tasks 1–5 touched, then run `bun test tests/vendoring.test.ts`; expect PASS.
- [ ] **Step 7:** From the root, run `bun run test:executor`, `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test`; all must pass.
- [ ] **Step 8:** Commit `docs: run facts on subagent rows`.

---

## Task 6: End-to-end check — implements 6

**Covers:** 6.1
**Difficulty:** Normal
**Blocked by:** Task 5

**Files:**
- Modify: `tests/host/manual/fleet-fixture.ts` (add a `disallowed_tools: bash` agent if none fits)
- Create: `docs/evidence/<date>-row-details.md`

- [ ] **Step 1:** Start the fixture (`bun tests/host/manual/fleet-fixture.ts`) and Pi in tmux (120x40), as in `docs/evidence/2026-11-12-fleet-list.md`, with `PI_OFFLINE=1`.
- [ ] **Step 2:** Launch one background and one foreground subagent. Capture:
  - the `Agents` widget line with `[fixture/… · thinking: … · 🔧N · ⊘1]`
  - the fleet row with the same facts
  - the inline result with the same facts, and every tag and stat that the 2026-11-12 captures show
- [ ] **Step 3:** Write the evidence file with the commands and screens (temp paths shortened). Commit `docs(evidence): run facts on subagent rows`.

---

## Scenario → test

subagent-run-facts:
- Thinking changed by the launch policy → Task 2 `policy-changed thinking is the record's thinking` (`test/seams/identity.test.ts`)
- Released session keeps model and thinking → existing `releaseSession` tests in `test/lifecycle/` (model/thinking captured at release) plus Task 2 `facts survive release`
- Before the session exists → Task 2 `queued record has none` (`identity.test.ts`) plus the existing `buildDetails` model fallback in `test/tools/helpers.test.ts`
- Count after the grant check → Task 2 `reports tool facts after the grant check`
- Disallowed tools counted → Task 2 `counts a disallowed candidate`
- Disallowed protocol tool counted → Task 2 `counts a disallowed protocol tool`
- Protocol tool not installed → Task 2 `skips a protocol tool not installed`
- Disallowed built-in extension tool counted → Task 2 `counts a disallowed built-in extension tool`
- Unregistered MCP name not counted → Task 2 `skips an unregistered MCP name`
- Removal re-granted is not counted → Task 2 `removal granted back is not blocked`
- Unknown name not counted → Task 2 `skips an unknown name`
- Policy removal counted → Task 2 `counts a policy removal` and `lists an accepted removal of a default`
- Rejected removal not counted → Task 2 `does not list a refused removal`
- Both sources remove the same tool → Task 2 `counts a tool both sources remove once`
- Tool appears after the policy ran → Task 2 `tool registered after the policy is not blocked`
- Recursion denylist not counted → Task 2 `never counts the recursion denylist`
- Released session → Task 2 `facts survive release`
- Unreadable tool list → Task 2 `unreadable tool list leaves facts unknown`
- All facts known → Task 1 `all facts known`
- Nothing blocked → Task 1 `nothing blocked`
- Unknown facts → Task 1 `unknown facts`
- Policy-changed thinking shown live → Task 3 `streams the record's live thinking`
- Existing order kept → Task 3 `keeps the existing order with run facts`
- Running agent line → Task 4 `shows the run-facts tag after name and mode label`
- No facts known → Task 4 `omits unknown tool facts for a queued agent`
- Bound record → Task 2 `bound record carries tool facts`
- Queued record → Task 2 `queued record has none`
- Loopback launch → Task 5 `tests/host/run-facts-offline.test.ts`

fleet-view:
- Row text → existing `test/ui/fleet-roster.test.ts` row text test (unchanged)
- Row with run facts → Task 4 `Row with run facts`
- Narrow row keeps stats → Task 4 `Narrow row keeps stats`
