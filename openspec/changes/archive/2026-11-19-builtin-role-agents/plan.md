# Built-in Role Agents and Package Agents Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md` (`openspec/changes/builtin-role-agents/`).

**Goal:** Replace the executor's TypeScript built-ins with six markdown role agents and load agents from installed pi packages, through one loader with case-insensitive overrides.

**Architecture:** `loadCustomAgents` becomes the only agent source: built-in directory (from the executor's own `package.json`), package directories (new `package-agents.ts`, a reduced port of tintinweb's `package-resources.ts`), global, then project, each later source replacing a same-named agent case-insensitively. The registry stops seeding `DEFAULT_AGENTS`; the fallback is `general`, and a missing `general` throws. jev-pilot only widens `AgentFacts.source`.

**Tech Stack:** TypeScript; executor tests on vitest (`bun run test:executor`), jev-pilot tests on `bun test`; `@earendil-works/pi-coding-agent` 1.5.0 (`DefaultPackageManager`, `SettingsManager`, `ProjectTrustStore`, `parseFrontmatter`, `getAgentDir`).

## Global Constraints

- Only manifest key read: `"pi": { "subagents": { "agents": [<string>...] } }`. No top-level `pi-subagents`, no array shorthand.
- Load order builtin < package < global < project; names compared case-insensitively; name = frontmatter `name:` (non-empty string) else file name.
- Fallback agent `general`; `general-purpose` is an alias only when no agent of that name exists; missing or disabled `general` refuses the launch with an error naming `general`.
- No agent defined in code; `src/config/default-agents.ts` deleted.
- Built-in bodies name no skill, slash command or workflow procedure; no `skills` field; no `model`, `thinking` or `locked`.
- `node_modules` is never scanned; entries and each agent file must canonicalise inside the package root.
- Every edited, added or deleted file under `packages/pi-subagents/` gets a `VENDORED.md` row; the port is credited in `NOTICE.md` (tintinweb/pi-subagents 0.26.1, commit `9a1b37dff9c6626a48912d23efabfa13e3c53ddb`, MIT).
- Public repository: English only.

## Review Focus

- A package agent dir with nested sub-directories → only top-level `*.md` load (Task 1, `package-agents.test.ts`).
- A frontmatter `name:` that is not a string (`name: 3`) → falls back to the file name (Task 1, `custom-agents.test.ts`).
- Two package agents with the same name from two packages → the later package in pi's order wins, one entry (Task 1, `custom-agents.test.ts`).
- `subagent_type: "GENERAL-PURPOSE"` (case variant of the alias) → resolves to `general` (Task 1, `registry.test.ts`).
- The tool description built at activation before `session_start` already lists built-ins (Task 1, `composition-root.test.ts`).
- History rendering of legacy types (`Plan`, `Explore`, `general-purpose`) with `general` present, missing and disabled (Task 1, `display.test.ts`, `ui/session-navigation.test.ts`, `widget-renderer.test.ts`).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `AgentConfig.source` (`src/types.ts`) | modified | `"builtin" \| "package" \| "global" \| "project"`; `"default"` removed | no |
| `AgentConfig.isDefault`, `AgentConfig.toolGuideline` | modified | removed | no |
| `AgentTypeSnapshot.source` (`src/service/service.ts`) | modified | `"builtin" \| "package" \| "global" \| "project"` | yes (`@ttdua/pi-subagents` type) |
| `loadCustomAgents` (`src/config/custom-agents.ts`) | modified | `(cwd: string, opts?: { builtinDirs?: PackageAgentDir[]; packageDirs?: PackageAgentDir[] }) => Map<string, AgentConfig>` — keys are canonical names; replacement case-insensitive | no |
| `PackageAgentDir` (`src/config/package-agents.ts`) | new | `{ dir: string; root: string }` (canonical agent dir and its package root) | no |
| `packageAgentDirs` | new | `(cwd: string) => PackageAgentDir[]`, never throws | no |
| `builtinAgentDirs` | new | `() => PackageAgentDir[]` from the executor's own `package.json` | no |
| `readSubagentManifest` | new | `(pkg: unknown) => string[] \| undefined` (only `pi.subagents.agents` string arrays) | no |
| `setProjectTrusted` / `seedProjectTrust` | new | `(trusted: boolean) => void` / `(cwd: string) => void` | no |
| `FALLBACK_AGENT` | new | `"general"` exported from `src/config/agent-types.ts`; the four `"general-purpose"` literals removed | no |
| `MissingFallbackAgentError` | new | `class extends Error`; message `Agent type "general" is not available; the built-in agents are missing or disabled` | no |
| `AgentTypeRegistry.resolveAgentConfig` | modified | same signature; throws `MissingFallbackAgentError` instead of returning a code fallback | no |
| `AgentTypeRegistry.findAgentConfig` | new | `(type: string) => AgentConfig \| undefined` — exact then case-insensitive, no alias, no fallback; used by display paths | no |
| `getDisplayName` (`src/ui/display.ts`) | modified | uses `findAgentConfig`; returns the recorded type when it does not resolve | no |
| `AgentTypeRegistry.resolveType` | modified | maps `general-purpose` (case-insensitive) to `general` when no agent of that name exists | no |
| `AgentTypeRegistry.DEFAULT_AGENT_NAMES`, `getDefaultAgentNames` | modified | `DEFAULT_AGENT_NAMES` removed; `getDefaultAgentNames` returns enabled agents with `source === "builtin"` | no |
| Spawn fallback note | modified | `Note: Unknown agent type "<name>" — using general.` | yes (model-visible text) |
| Guideline line | modified | `- Use <name> for <description>` per enabled built-in | yes (model-visible text) |
| executor `package.json` | modified | adds `"pi": { "subagents": { "agents": ["./agents"] } }` (beside `extensions`) and `"agents"` in `files` | yes (manifest) |
| `agents/*.md` (executor) | new | six files; frontmatter `name`, `description`, `tools`, `disallowed_tools` per spec | yes |
| `AgentFacts.source` (`src/policy/launch.ts`, jev-pilot) | modified | `"project" \| "global" \| "builtin" \| "package"` | no |

---
## Task 1: Executor — one loader and the six role agents — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10
**Difficulty:** Very Hard
**Blocked by:** none

The loader and the roster ship together. Once `DEFAULT_AGENTS` is gone, a launch that falls back needs `agents/general.md` on disk, so the two cannot become separately green commits.

**Files:**
- Create:
  - `packages/pi-subagents/src/config/package-agents.ts`
  - `packages/pi-subagents/agents/{general,implementer,explore,scout,reviewer,verifier}.md`
  - `packages/pi-subagents/test/config/package-agents.test.ts`
  - `packages/pi-subagents/test/config/builtin-agents.test.ts`
- Modify (under `packages/pi-subagents/src/`):
  - `config/custom-agents.ts`, `config/agent-types.ts`, `types.ts`
  - `seams/registry.ts`, `service/service.ts`
  - `lifecycle/subagent-manager.ts`
  - `tools/spawn-config.ts`, `tools/helpers.ts`
  - `ui/display.ts`, and its presentation callers only where they bypass `getDisplayName`: `tools/agent-tool.ts`, `ui/widget-renderer.ts`, `ui/fleet-roster.ts`, `tools/get-result-tool.ts`, `ui/session-navigation.ts`, `ui/session-navigator.ts`
  - `index.ts`
- Modify: `packages/pi-subagents/package.json`, `packages/pi-subagents/VENDORED.md`, `NOTICE.md`
- Delete: `packages/pi-subagents/src/config/default-agents.ts`
- Tests to update for built-in names, removed fields and the fallback note text (all under `packages/pi-subagents/test/`):
  - `composition-root.test.ts` (also add `isProjectTrusted` to `makeSessionStartCtx`)
  - `config/agent-types.test.ts`, `config/custom-agents.test.ts`
  - `display.test.ts`
  - `helpers/make-deps.ts` (the `isDefault` fixture), `helpers/make-deps.test.ts`
  - `helpers/make-navigable.ts`, `helpers/make-navigable.test.ts`
  - `helpers/make-spawn-config.ts`, `helpers/make-spawn-config.test.ts`
  - `helpers/make-subagent.ts`, `helpers/make-subagent.test.ts`
  - `helpers/make-workspace.test.ts`
  - `helpers/subagent-session-io.ts`, `helpers/subagent-session-io.test.ts`
  - `helpers/turn-loop-result.ts`, `helpers/turn-loop-result.test.ts`
  - `lifecycle/child-lifecycle.test.ts`, `lifecycle/create-subagent-session.test.ts`
  - `lifecycle/fork-prompt.test.ts`, `lifecycle/fork-session.test.ts`, `lifecycle/fork-tools.test.ts`
  - `lifecycle/subagent-manager.test.ts`, `lifecycle/subagent-session.test.ts`, `lifecycle/subagent.test.ts`
  - `lifecycle/workspace-bracket.test.ts`
  - `observation/notification.test.ts`, `observation/subagent-events-observer.test.ts`
  - `persisted-record.test.ts`, `print-mode.test.ts`
  - `seams/fleet-wiring.test.ts`, `seams/grant-check.test.ts`, `seams/identity.test.ts`
  - `seams/launch-policy.test.ts`, `seams/registry.test.ts`, `seams/service-wiring.test.ts`
  - `service/service-adapter.test.ts`
  - `session/prompts.test.ts`, `session/session-config.test.ts`
  - `tools/agent-tool.test.ts`, `tools/background-spawner.test.ts`, `tools/foreground-runner.test.ts`
  - `tools/get-result-renderer.test.ts`, `tools/helpers.test.ts`, `tools/progress-stream.test.ts`
  - `tools/result-renderer.test.ts`, `tools/spawn-config.test.ts`
  - `ui/fleet-list.test.ts`, `ui/fleet-roster.test.ts`, `ui/labeled-rule.test.ts`
  - `ui/session-navigation.test.ts`, `ui/session-navigator.test.ts`
  - `widget-renderer.test.ts`

  Many of these files use `Explore` or `general-purpose` only as display data or as fixture agent names. Change a file only when it relies on the TypeScript built-ins or the old note text. Keep legacy names where the test is about history.

**Interfaces:**
- Produces: every executor Contracts row.

- [ ] **Step 1: Declarations.**
  - Add `PackageAgentDir`, `FALLBACK_AGENT`, `MissingFallbackAgentError` and `findAgentConfig`.
  - Widen the `source` types and add the new `loadCustomAgents` options.
  - Remove `isDefault`, `toolGuideline` and `DEFAULT_AGENT_NAMES`.
  - Run `bun run --cwd packages/pi-subagents check` and record the errors.
- [ ] **Step 2: Failing tests for package discovery** in `package-agents.test.ts`, one per `package-agents` scenario:
  - "Declared directory loaded", "Other spellings ignored", "Non-string entry"
  - "Unconfigured package ignored", "Untrusted project package", "Package in both scopes"
  - "Saved trust before a session", "Session answer wins"
  - "Parent path refused", "Symlink out of the package refused", "Symlinked file out of the package skipped", "Missing directory"
  - "Malformed manifest", "Package API unavailable"

  Inject the package lister for the manifest, containment and error cases. Keep at least one contract test with the real `SettingsManager` and `DefaultPackageManager`. That test uses absolute local package paths in the `settings.json` of a temp `PI_CODING_AGENT_DIR`, so it runs offline. It covers both scopes and both trust answers.
- [ ] **Step 3: Failing tests for loading, resolution, display and the tool description.**
  - Files: `custom-agents.test.ts`, `agent-types.test.ts`, `registry.test.ts`, `spawn-config.test.ts`, `subagent-manager.test.ts`, `helpers.test.ts`, `display.test.ts`, `ui/session-navigation.test.ts`, `widget-renderer.test.ts`.
  - Cover every `executor-agent-registry` scenario. The fallback note text must be exactly `Note: Unknown agent type "Plan" — using general.`
  - Cover the "History display never needs the fallback" scenarios and the three "Tool description lists effective agents" scenarios.
  - Cover the Review Focus cases.
  - Use `builtinDirs` fixtures in unit tests.
- [ ] **Step 4: Failing tests for the roster** in `builtin-agents.test.ts`, using the real `builtinAgentDirs()`:
  - "Built-ins listed".
  - "Read-only explore", "Implementer writes", "Scout and reviewer are read-only", "General keeps the defaults".
  - "Body scan". It fails on any of:
    - `skill:` or `/skill:`;
    - a match of the regex `(^|\s)/[a-z][a-z0-9-]+`;
    - a `skills` key;
    - any of `test-driven-development`, `verification-before-completion`, `systematic-debugging`, `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `requesting-code-review`, `receiving-code-review`, `finishing-a-development-branch`, `using-git-worktrees`, `coding-standards`, `opsx-`.
  - "Escalation stated", "Override file not checked".
  - "Built-ins packed": run `npm pack --dry-run --json --ignore-scripts` in `packages/pi-subagents` and assert the six `agents/*.md` paths are listed.

  Also:
  - add "Verifier cannot edit (fresh)" to `create-subagent-session.test.ts`;
  - add "Verifier fork refuses edits" to `fork-tools.test.ts`;
  - in `composition-root.test.ts`, add `isProjectTrusted` to the session-start context and assert the trust wiring for `true` and `false`.
- [ ] **Step 5: Run** `bun run test:executor`. Expected: the new tests FAIL.
- [ ] **Step 6: Implement `package-agents.ts`.**
  - Port only these parts of tintinweb `src/package-resources.ts` (commit `9a1b37df`):
    - `configuredPackages`: a feature-detected `DefaultPackageManager.listConfiguredPackages()` with `SettingsManager.create(cwd, getAgentDir(), { projectTrusted })`;
    - `realOrSelf` and the containment check;
    - `seedProjectTrust` and `setProjectTrusted`, with the trust state at module scope.
  - The manifest reader accepts only `pi.subagents.agents` as an array of strings.
  - `builtinAgentDirs()` reads `fileURLToPath(new URL("../../package.json", import.meta.url))` with the same reader.
  - A header comment names the source file, version, commit and license.
  - Port none of: the cache, the gate, workflows, `!` exclusions, single-file entries.
- [ ] **Step 7: Implement loading.**
  - `loadCustomAgents` loads, in order: `builtinDirs ?? builtinAgentDirs()`, `packageDirs ?? packageAgentDirs(cwd)`, global, project.
  - For each source it lists the top-level `*.md` files.
  - It canonicalises each built-in or package file and skips any file outside its `root`.
  - The name is the trimmed string `fm.name` if non-empty, else the file name.
  - Before each `set`, it deletes any existing key that is equal case-insensitively.
  - `AgentTypeRegistry.reload` only overlays `loadUserAgents()`.
- [ ] **Step 8: Implement resolution and display.**
  - `resolveType`: exact match, then case-insensitive match, then `general-purpose` maps to `FALLBACK_AGENT` when no agent of that name exists.
  - `resolveAgentConfig`: the resolved agent, else the enabled `general`, else throw `MissingFallbackAgentError`.
  - `findAgentConfig`: exact or case-insensitive match, else `undefined`.
  - `getDisplayName` uses `findAgentConfig` and returns the recorded type when the name does not resolve.
  - Launch paths use `FALLBACK_AGENT`.
  - `AgentTypeCatalog.get` returns `undefined` on `MissingFallbackAgentError`.
  - The spawn note names `general`.
- [ ] **Step 9: Implement the tool description.**
  - `getDefaultAgentNames` returns the enabled agents with `source === "builtin"`, in load order.
  - Each guideline line is `- Use ${name} for ${description}`.
  - `getUserAgentNames` returns the rest.
- [ ] **Step 10: Wire trust in `src/index.ts`.**
  - Call `seedProjectTrust(process.cwd())` at load.
  - On `session_start`, call `setProjectTrusted(ctx.isProjectTrusted())` as the first action, before anything queries the registry.
- [ ] **Step 11: Write the six agents and the manifest.**
  - Frontmatter follows the spec table. `general` declares no `tools`.
  - Each body has four sections:
    - `## Role`;
    - `## Tools`;
    - `## Escalation`: call `ask_parent` when anything outside the tools or scope is needed, then stop;
    - `## Report`: Summary, Evidence with file:line, Findings or Changes, Limitations. `implementer` adds Validation and `verifier` adds Checks.
  - No skill names and no slash commands.
  - In `package.json`, add `"subagents": { "agents": ["./agents"] }` inside `pi`, and add `"agents"` to `files`.
- [ ] **Step 12: Delete `default-agents.ts`** and update the listed tests and helpers.
- [ ] **Step 13: Provenance.**
  - `VENDORED.md`: one row per added, edited or deleted file, with a one-line reason.
  - `NOTICE.md`: credit `tintinweb/pi-subagents` 0.26.1 at `9a1b37dff9c6626a48912d23efabfa13e3c53ddb`, Copyright (c) 2026 tintinweb, MIT, for `packages/pi-subagents/src/config/package-agents.ts`.
- [ ] **Step 14: Run** `bun run test:executor`, `bun run --cwd packages/pi-subagents lint` and `bun test tests/vendoring.test.ts`. Expected: PASS.
- [ ] **Step 15: Commit** `feat(executor): markdown role agents and package agents through one loader (#82, #87, #91)`

---

## Task 2: jev-pilot — source and samples — implements 2

**Covers:** 2.1, 2.2
**Difficulty:** Easy
**Blocked by:** Task 1

**Files:**
- Modify: `src/policy/launch.ts`, `src/host/platform/agents.ts`
- Test:
  - `tests/host/platform/agent-facts.test.ts`
  - `tests/host/worker/policy.test.ts`, `tests/host/worker-fakes.ts`, `tests/host/probes/policy/index.ts`
  - `tests/host/duplicate-executor.test.ts`, `tests/host/fleet-print.test.ts`, `tests/host/status/line.test.ts`
  - `tests/host/worker-ledger.test.ts`, `tests/policy/worker/worker-line.test.ts`

**Interfaces:**
- Consumes: `AgentTypeSnapshot.source` with `package` (Task 1).

- [ ] **Step 1: Failing tests** in `agent-facts.test.ts`: "Package source carried", "Built-in explore" (with roster values), "Unknown thinking not set".
- [ ] **Step 2: Run** `bun test tests/host/platform/agent-facts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `"package"` to the `AgentFacts.source` union, and make `agentFacts` pass the snapshot source through.
- [ ] **Step 4: Samples.**
  - Launches of built-ins: `Explore` becomes `explore`, and `Plan` service samples become `implementer`.
  - `general-purpose` launches in `duplicate-executor.test.ts` keep working through the alias; assert that the child runs as `general`.
  - Ledger, fleet and status display samples keep their recorded strings.
  - Run `bun run typecheck && bun test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(jev): carry the package agent source`

---

## Task 3: Docs, changelog and gates — implements 3

**Covers:** 3.1, 3.2, 3.3
**Difficulty:** Easy
**Blocked by:** Task 1, Task 2

**Files:**
- Modify (executor package):
  - `packages/pi-subagents/docs/configuration.md`, `packages/pi-subagents/README.md`, `packages/pi-subagents/docs/comparison-with-upstream.md`
  - `packages/pi-subagents/src/tools/get-result-renderer.ts` (comment sample only)
  - `packages/pi-subagents/VENDORED.md` (doc rows)
- Modify (jev-pilot): `docs/usage-guide.md`, `docs/configuration.md`, `docs/architecture.md`, `docs/glossary.md`, `docs/domain-model.md`, `docs/scenarios.md`, `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Docs.**
  - Replace `general-purpose`, `Explore` and `Plan` as the current built-ins with the roster.
  - Document the four sources and their order, the manifest key, the frontmatter `name:`, the case-insensitive override, the `general-purpose` alias and the missing-`general` error.
  - Add the rule: role in the agent file, process and task in the launch.
  - Note that the tool description is built at activation.
  - Leave `docs/evidence/`, `docs/decisions/` and dated plans untouched.
- [ ] **Step 2: CHANGELOG** `[Unreleased]` (#82, #87, #91):
  - Added: six role agents; package agents via `pi.subagents.agents`.
  - Changed: case-insensitive override; frontmatter `name:`; fallback `general` with the `general-purpose` alias.
  - Removed: `Plan`, `Explore`'s pinned model, the TypeScript built-ins.
- [ ] **Step 3: Gates.**
  - Run `bun run typecheck && bun run lint && bun run fmt:check && bun test && bun run test:executor && bun run --cwd packages/pi-subagents verify:public-types`. Expected: all PASS.
  - Then run `rg -n 'general-purpose|"Explore"|"Plan"|DEFAULT_AGENTS|toolGuideline' packages/pi-subagents/src src docs README.md`. Expected: only the alias handling and historical docs.
- [ ] **Step 4: Commit** `docs: role agents and package agents (#82, #87, #91)`

---

## Scenario → test

**agent-metadata**

- Built-in explore → `tests/host/platform/agent-facts.test.ts`
- Package source carried → `tests/host/platform/agent-facts.test.ts`
- Unknown thinking not set → `tests/host/platform/agent-facts.test.ts`
- Long instructions → `tests/host/platform/agent-facts.test.ts`
- Disallowed tools carried → `tests/host/platform/agent-facts.test.ts`
- Context carried → `tests/host/platform/agent-facts.test.ts`

**builtin-role-agents**

- Built-ins listed → `packages/pi-subagents/test/config/builtin-agents.test.ts (new)`
- Built-ins packed → `packages/pi-subagents/test/config/builtin-agents.test.ts (npm pack --dry-run --json --ignore-scripts)`
- Implementer writes → `packages/pi-subagents/test/config/builtin-agents.test.ts (new)`
- Scout and reviewer are read-only → `packages/pi-subagents/test/config/builtin-agents.test.ts (new)`
- Read-only explore → `packages/pi-subagents/test/config/builtin-agents.test.ts (new)`
- Verifier cannot edit (fresh) → `packages/pi-subagents/test/lifecycle/create-subagent-session.test.ts (new case)`
- Verifier fork refuses edits → `packages/pi-subagents/test/lifecycle/fork-tools.test.ts (new case)`
- General keeps the defaults → `packages/pi-subagents/test/config/builtin-agents.test.ts (new)`
- Built-in guidelines → `packages/pi-subagents/test/tools/helpers.test.ts`
- Package override moves the agent → `packages/pi-subagents/test/tools/helpers.test.ts`
- Disabled built-in dropped → `packages/pi-subagents/test/tools/helpers.test.ts`
- Body scan → `packages/pi-subagents/test/config/builtin-agents.test.ts (new)`
- Escalation stated → `packages/pi-subagents/test/config/builtin-agents.test.ts (new)`
- Override file not checked → `packages/pi-subagents/test/config/builtin-agents.test.ts (new)`

**executor-agent-registry**

- Disabled agent → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- New file picked up → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Project file overrides a built-in case-insensitively → `packages/pi-subagents/test/config/custom-agents.test.ts`
- Package over built-in → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Global over package → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Override by frontmatter name → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Frontmatter name over file name → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Name from frontmatter → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Case-insensitive name → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Legacy general-purpose name → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Real general-purpose agent wins → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Unknown name → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Removed Plan falls back with a note → `packages/pi-subagents/test/tools/spawn-config.test.ts`
- General disabled → `packages/pi-subagents/test/lifecycle/subagent-manager.test.ts`
- Legacy Plan run shown → `packages/pi-subagents/test/ui/session-navigation.test.ts`
- Display without general → `packages/pi-subagents/test/widget-renderer.test.ts`
- Built-in explore → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Package source → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Snapshot is detached → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Absent tools kept distinct from defaults → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`
- Deprecated inherit_context declared → `packages/pi-subagents/test/seams/registry.test.ts + test/config/custom-agents.test.ts`

**executor-launch-identity**

- Tool-call launch → `packages/pi-subagents/test/seams/identity.test.ts`
- Service launch → `packages/pi-subagents/test/seams/identity.test.ts`

**executor-launch-policy**

- Tool-call origin → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- Orchestration tools never offered → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- Excluded extension's tool not offered → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- Locked caller value not requested → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- Fork request → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- Locked fork request → `packages/pi-subagents/test/seams/launch-policy.test.ts`
- Fallen-back fork → `packages/pi-subagents/test/seams/launch-policy.test.ts`

**package-agents**

- Declared directory loaded → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Other spellings ignored → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Non-string entry → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Unconfigured package ignored → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Untrusted project package → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Package in both scopes → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Saved trust before a session → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Session answer wins → `packages/pi-subagents/test/config/package-agents.test.ts (+ index session_start wiring)`
- Parent path refused → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Symlink out of the package refused → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Symlinked file out of the package skipped → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Missing directory → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Malformed manifest → `packages/pi-subagents/test/config/package-agents.test.ts (new)`
- Package API unavailable → `packages/pi-subagents/test/config/package-agents.test.ts (new)`

**subagent-context-mode**

- Invalid value → `packages/pi-subagents/test/service/service-adapter.test.ts`
- Invalid service value → `packages/pi-subagents/test/service/service-adapter.test.ts`
- Invalid frontmatter value → `packages/pi-subagents/test/service/service-adapter.test.ts`
- Default is fresh → `packages/pi-subagents/test/service/service-adapter.test.ts`
- Caller wins over agent default → `packages/pi-subagents/test/service/service-adapter.test.ts`
- Locked agent wins over caller → `packages/pi-subagents/test/service/service-adapter.test.ts`
- Service option → `packages/pi-subagents/test/service/service-adapter.test.ts`
- Old tool parameter → `packages/pi-subagents/test/service/service-adapter.test.ts`
- Both given → `packages/pi-subagents/test/service/service-adapter.test.ts`
- Old service option → `packages/pi-subagents/test/service/service-adapter.test.ts`
- Old prompt mode ignored → `packages/pi-subagents/test/service/service-adapter.test.ts`

**worker-routing**

- Display name prefix → `tests/host/worker/policy.test.ts`
- Slot display name → `tests/host/worker/policy.test.ts`
- Parent request off → `tests/host/worker/policy.test.ts`
- Forked launch with thinking asks fewer questions → `tests/host/worker/policy.test.ts`
- Service launch content → `tests/host/worker/policy.test.ts`
- Launch from a worker → `tests/host/worker/policy.test.ts`
- Service launch with an explicit model → `tests/host/worker/policy.test.ts`
- Service launch without a model → `tests/host/worker/policy.test.ts`
