# Per-launch Resources Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`specs/launch-resources/spec.md`, `specs/executor-launch-policy/spec.md`, `specs/subagent-context-mode/spec.md`, `specs/executor-agent-registry/spec.md`) and `design.md`.

**Goal:** For each service launch, decide a child's skills, excluded extension packages, working directory and context files. The executor validates these up front, refuses rather than falls back, and reports the effective values on `session-created`.

**Architecture:**
- A new seam, `src/seams/launch-resources.ts`, parses, freezes, fresh-checks and re-checks the four fields. The vendored executor's IO stays behind a small `LaunchResourcesIO`.
- The frozen `LaunchResources` travels: `spawn()` → `AgentSpawnConfig` → `SubagentExecution` → `CreateSubagentSessionParams`. There, `freshSetup` turns it into Pi loader options (`noSkills`, `additionalSkillPaths`, `skillsOverride`, `noContextFiles`), and the composition root turns it into a per-launch settings view.
- The workspace provider receives `requestedCwd` and `metadata`.
- Skill loader options, collision checks and the reported resource facts live in their own module, `src/session/launch-skills.ts`. `create-subagent-session.ts` only orchestrates.

**Tech Stack:** TypeScript, vitest (vendored package), Pi `@earendil-works/pi-coding-agent` 1.5.0 public API (`DefaultResourceLoader`, `loadSkills`). Code and tests live under `packages/pi-subagents/`; Task 4 also edits two root docs (`docs/architecture.md`, `docs/decisions/0009-vendored-executor.md`).

## Global Constraints

- Every new field is optional. Omitted fields keep today's child exactly (`executor-launch-identity` "Identity fields are additive").
- Launch resources exist on `SpawnOptions` only. They are not on the `subagent` tool schema or on `ResumeOptions`. A resume does not apply them again.
- A refusal at `spawn()` throws synchronously and leaves no record, no event and no policy call. A run-start failure fails the run before any workspace or child session exists. The executor never falls back to the parent's cwd, drops a skill or downgrades a fork.
- Fixed error-message prefixes:
  - `Launch resources apply to fresh launches only`
  - `Launch resources no longer valid:`
  - `Skill name collision:`
- An excluded package's extension module is never imported: the exclusion goes through the existing prevent-load settings view (`package-exclusions.ts`), never through `extensionsOverride`.
- Pi APIs used: public exports only.
- Every edited upstream file gets a `VENDORED.md` row.
- Tests use no secrets and no paid calls, and no network beyond loopback.

## Review Focus

- **Symlinked or relative-looking skill paths:** `/x/link/SKILL.md` → `/x/real/SKILL.md` must count as the same file for dedupe and for the allowlist. Pinned in Task 2 (`dedupes a symlinked duplicate`) and Task 3 Step 0 (`allowlist matches a symlinked path`).
- **A directory in `paths` holding several skills:** all of them are allowed and re-checked one by one. Pinned in Task 2 (`directory yields every skill`) and in the re-check test.
- **`cwd` given as a file, not a directory:** refused, naming the path. Pinned in Task 2 (`refuses a file as cwd`).
- **Provider wraps `requestedCwd`:** the child runs where the provider says, and `session-created.cwd` reports that directory, not the requested one. Pinned in Task 3 (`provider wrap is reported`).
- **Global exclusion and launch exclusion overlap:** a package named in both is listed once, in the setting's position. Pinned in Task 3 Step 0 (`union keeps setting order, no duplicates`).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `LaunchSkills` | new | `interface LaunchSkills { inherit: boolean; paths?: readonly string[] }` (exported from `src/service/service.ts`) | yes |
| `SpawnOptions` | modified | adds `skills?: LaunchSkills; excludeExtensionPackages?: readonly string[]; cwd?: string; contextFiles?: boolean` | yes |
| `AgentTypeSnapshot.inheritSkills` | modified | `inheritSkills?: false`, present only when the agent file declares `inherit_skills: false` | yes |
| `WorkspacePrepareContext` | modified | adds `requestedCwd?: string; metadata?: LaunchMetadata` (each present only when the launch has it) | yes |
| `ChildSessionCreatedEvent` | modified | adds `cwd?: string` (always set by this executor; optional in the type for compatibility), plus `inheritSkills?: boolean; skillPaths?: readonly string[]; excludedExtensionPackages?: readonly string[]; contextFiles?: boolean` (set only for a launch with resources or a pinned agent) | yes |
| agent frontmatter `inherit_skills` | new | `inherit_skills: false` pins; any other value is not pinned, and a non-boolean value writes a debug note | yes (file format) |
| `AgentConfig.inheritSkills` (`src/types.ts`) | modified | `inheritSkills?: false` | no |
| `LaunchResources` (`src/seams/launch-resources.ts`) | new | `interface LaunchResources { readonly skills?: { readonly inherit: boolean; readonly paths: readonly string[]; readonly skillFiles: readonly string[] }; readonly excludeExtensionPackages?: readonly string[]; readonly cwd?: string; readonly contextFiles?: boolean }`, deep-frozen. `paths` is deduplicated by real path; `skillFiles` holds the real paths of every skill loaded from `paths`, in load order | no |
| `LaunchResourcesIO` | new | `interface LaunchResourcesIO { isDirectory(path: string): boolean; realPath(path: string): string; loadSkills(paths: readonly string[]): { skills: readonly { name: string; filePath: string }[]; diagnostics: readonly { type: string; message: string; path?: string; collision?: { name: string; winnerPath: string; loserPath: string } }[] } }`, plus `defaultLaunchResourcesIO(agentDir: string): LaunchResourcesIO` over `node:fs` and Pi's `loadSkills` (`includeDefaults: false`) | no |
| `parseLaunchResources` | new | `parseLaunchResources(options: Pick<SpawnOptions, "skills" \| "excludeExtensionPackages" \| "cwd" \| "contextFiles">, io: LaunchResourcesIO): LaunchResources \| undefined`; throws `Error`; returns `undefined` when all four fields are `undefined` | no |
| `EffectiveSkills` / `effectiveSkillChoice` | new | `interface EffectiveSkills { inherit: boolean; paths: readonly string[]; skillFiles: readonly string[] }`; `effectiveSkillChoice(resources: LaunchResources \| undefined, pinned: boolean): EffectiveSkills \| undefined`. Returns `undefined` when there is no `skills` and no pin (loader untouched). A pin forces `inherit: false` | no |
| `assertFreshOnly` | new | `assertFreshOnly(input: { resources: LaunchResources \| undefined; agentName: string; pinned: boolean; context: ContextMode }): void`; throws `Error("Launch resources apply to fresh launches only: <fields>")` or `Error("Agent <agentName> pins inherit_skills: false and cannot fork")` | no |
| `recheckLaunchResources` | new | `recheckLaunchResources(resources: LaunchResources \| undefined, io: LaunchResourcesIO): void`; throws `Error("Launch resources no longer valid: <path> (<reason>)")` | no |
| `AgentSpawnConfig.resources`, `SubagentExecution.resources`, `CreateSubagentSessionParams.resources` | modified | `resources?: LaunchResources` each | no |
| `SubagentExecution.launchResourcesIO` | modified | `launchResourcesIO?: LaunchResourcesIO`; the manager supplies it, and an absent value skips the re-check (unit tests only) | no |
| `SkillsOverride` (`src/session/launch-skills.ts`) | new | `type SkillsOverride = NonNullable<ConstructorParameters<typeof DefaultResourceLoader>[0]["skillsOverride"]>` (derived from the public class; no deep import) | no |
| `ResourceLoaderOptions` (`create-subagent-session.ts`) | modified | adds `noSkills?: boolean; additionalSkillPaths?: string[]; skillsOverride?: SkillsOverride` | no |
| `ContextSetup.loader` (`create-subagent-session.ts`) | modified | `Pick<ResourceLoaderOptions, "noContextFiles" \| "appendSystemPromptOverride" \| "extensionFactories" \| "noSkills" \| "additionalSkillPaths" \| "skillsOverride">` | no |
| `ResourceLoaderLike.getSkills` | modified | **required** `getSkills(): { skills: readonly { name: string; filePath: string }[]; diagnostics: readonly { type: string; path?: string; collision?: { name: string; winnerPath: string; loserPath: string } }[] }`; every test loader stub (`test/helpers/subagent-session-io.ts`, `test/helpers/mock-session.ts`) returns `{ skills: [], diagnostics: [] }` by default | no |
| `LoaderSettings` / `SessionFactoryIO.createLoaderSettingsManager` | modified | `createLoaderSettingsManager(parent: SettingsManager, extraExcluded: readonly string[]): LoaderSettings`, where `interface LoaderSettings { settingsManager: SettingsManager; excludedExtensionPackages: readonly string[] }`; `excludedExtensionPackages` is `excludedPackageUnion(setting, extraExcluded)`, including setting entries that match no installed package | no |
| `skillLoaderOptions` (`src/session/launch-skills.ts`) | new | `skillLoaderOptions(choice: EffectiveSkills \| undefined, io: { realPath(path: string): string }): Pick<ResourceLoaderOptions, "noSkills" \| "additionalSkillPaths" \| "skillsOverride">`; returns `{}` for `undefined`; `additionalSkillPaths` is `[...choice.skillFiles]`; the override filters to `skillFiles` when `inherit` is false and notes late collisions won by a `skillFiles` entry when `inherit` is true | no |
| `assertNoCatalogCollision` (`src/session/launch-skills.ts`) | new | `assertNoCatalogCollision(choice: EffectiveSkills \| undefined, diagnostics: ReturnType<ResourceLoaderLike["getSkills"]>["diagnostics"], io: { realPath(path: string): string }): void`; throws `Error("Skill name collision: <name> (<winner>, <loser>)")` when a collision's loser is in `skillFiles` | no |
| `StartInput.resourceFacts` (`create-subagent-session.ts`) | modified | `resourceFacts: ResourceFacts`; built in the assembly after `loader.reload()` and before `startSession`, which only spreads it into `sessionCreated` | no |
| `ResourceFacts` / `resourceFacts` (`src/session/launch-skills.ts`) | new | `interface ResourceFacts { cwd: string; inheritSkills?: boolean; skillPaths?: readonly string[]; excludedExtensionPackages?: readonly string[]; contextFiles?: boolean }`; `resourceFacts(input: { cwd: string; reported: boolean; choice: EffectiveSkills \| undefined; skills: readonly { filePath: string }[]; excluded: readonly string[]; contextFiles: boolean }): ResourceFacts`, frozen; the four optional fields are present only when `reported` (resources or pin) is true | no |
| `excludedPackageUnion` (`src/session/package-exclusions.ts`) | new | `excludedPackageUnion(setting: readonly string[], launch: readonly string[]): string[]`: setting order first, then new launch entries | no |
| `noteUnknownPackages` (`src/session/package-exclusions.ts`) | new | `noteUnknownPackages(parent: ParentSettingsView, launch: readonly string[]): void`; writes one `debugNote` per `launch` entry that matches no global or project `packages` source. Added during apply (internal; it splits the D5 debug-note duty out of `index.ts`) | no |
| `LaunchFacts.excludeExtensionPackages` (`src/seams/launch-gate.ts`) | modified | `excludeExtensionPackages?: readonly string[]` | no |
| `dist/public.d.ts` | modified | regenerated; exports the public rows above | yes |

---

## Task 1: Agent pin `inherit_skills` — implements 1

**Covers:** 1.1, 1.2, 1.3
**Difficulty:** Easy
**Blocked by:** none

**Files:**
- Modify: `packages/pi-subagents/src/types.ts`, `packages/pi-subagents/src/config/custom-agents.ts`, `packages/pi-subagents/src/seams/registry.ts`, `packages/pi-subagents/src/service/service.ts` (only `AgentTypeSnapshot.inheritSkills`)
- Test: `packages/pi-subagents/test/seams/registry.test.ts`

**Interfaces:**
- Produces: `AgentConfig.inheritSkills`, `AgentTypeSnapshot.inheritSkills` (see Contracts).

- [ ] **Step 1: Write the failing tests** in `test/seams/registry.test.ts`, inside a new `describe("inherit_skills")`:
  - `pins with inherit_skills: false`: an agent file with `inherit_skills: false` gives `getAgentType(name).inheritSkills === false`;
  - `absent when not declared`: `"inheritSkills" in snapshot` is `false`;
  - `true is not a pin`: with `inherit_skills: true`, the field is absent;
  - `reports a package agent's source in the snapshot`: an agent loaded from a package dir has snapshot `source` `package` (it closes a mapping gap for the existing scenario);
  - `non-boolean noted`: with `inherit_skills: "no"`, the field is absent and the debug output (`PI_SUBAGENTS_DEBUG=1`, captured with `capture-warn`) names the agent.
- [ ] **Step 2: Run the tests to verify they fail.** Run `bun run --cwd packages/pi-subagents test test/seams/registry.test.ts`. Expected: FAIL in the `inherit_skills` describe.
- [ ] **Step 3: Implement.**
  - In `custom-agents.ts`, add `inheritSkills: inheritSkillsField(fm.inherit_skills, name)`, returning `false | undefined`.
  - In `registry.ts`, the snapshot builder copies `inheritSkills` only when it is `false`.
- [ ] **Step 4: Run the tests to verify they pass.** Same command. Expected: PASS, and the existing snapshot tests are unchanged.
- [ ] **Step 5: Commit.** `feat(executor): inherit_skills agent pin`

---

## Task 2: Launch-resource validation seam — implements 2

**Covers:** 2.1, 2.2, 2.3
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Create: `packages/pi-subagents/src/seams/launch-resources.ts`, `packages/pi-subagents/test/seams/launch-resources.test.ts`
- Modify: `packages/pi-subagents/src/service/service.ts` (`LaunchSkills`, the `SpawnOptions` fields)

**Interfaces:**
- Produces: `LaunchResources`, `LaunchResourcesIO`, `defaultLaunchResourcesIO`, `parseLaunchResources`, `EffectiveSkills`, `effectiveSkillChoice`, `assertFreshOnly`, `recheckLaunchResources` (see Contracts).

Tests use real temp dirs (`mkdtempSync`) and real `SKILL.md` files with `name` and `description` frontmatter, through `defaultLaunchResourcesIO(agentDir)`.

- [ ] **Step 1: Write the failing tests: parse.** Each refusal asserts `toThrow(/<rule>.*<path or field>/)`.
  - `returns undefined with no fields`.
  - `refuses wrong shapes`, as a table: `skills: { inherit: "no" }`, `skills: { inherit: true, paths: "x" }`, `excludeExtensionPackages: [""]`, `cwd: 1`, `contextFiles: "no"`. Each message names its field.
  - `refuses a relative cwd`: `worktrees/u1`, with the message naming the rule `must be absolute`.
  - `refuses a missing cwd`, naming the path.
  - `refuses a file as cwd`, naming the path.
  - `refuses a relative skill path`.
  - `refuses a missing skill path`, naming `/…/missing/SKILL.md`.
  - `refuses a skill without description`, naming the file.
  - `refuses an empty skill directory`.
  - `directory yields every skill`: a directory with `a/SKILL.md` and `b/SKILL.md` gives `skillFiles` with both real paths.
  - `dedupes a repeated path keeping first order`: `[a, b, a]` gives `paths` `[a, b]`.
  - `dedupes a symlinked duplicate`: `link → a` gives `[a, link]` → `paths` `[a]`.
  - `refuses two files with one skill name`: the message starts `Skill name collision:` and names `plan` and both paths.
  - `freezes and detaches`: mutating the input `paths` after the call leaves the result unchanged, and `Object.isFrozen(result.skills.paths)` holds.
- [ ] **Step 2: Write the failing tests: choice, fresh-only and re-check.**
  - `effectiveSkillChoice`:
    - `(undefined, false)` gives `undefined`;
    - `(undefined, true)` gives `{ inherit: false, paths: [], skillFiles: [] }`;
    - `({skills:{inherit:true,…}}, true)` gives `inherit: false` with the caller's paths;
    - `({cwd}, false)` gives `undefined`.
  - `assertFreshOnly`:
    - `fork` with each single field (including `contextFiles: true` and `excludeExtensionPackages: []`) throws `Launch resources apply to fresh launches only`, naming the field;
    - a pinned agent on `fork` throws, naming the agent;
    - anything on `fresh` passes;
    - `undefined` with no pin on `fork` passes.
  - `recheckLaunchResources`:
    - `cwd removed` throws `Launch resources no longer valid:`, naming the cwd;
    - `skill removed from a listed directory` names the removed `a/SKILL.md`;
    - `skill turned invalid` (its description is deleted) names the file;
    - `unchanged passes`.
- [ ] **Step 3: Run the tests to verify they fail.** Run `bun run --cwd packages/pi-subagents test test/seams/launch-resources.test.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 4: Implement `src/seams/launch-resources.ts`** with the Contracts signatures and the D2 rule order.
  - Collisions come from the `collision` diagnostics of one `loadSkills` call over all paths.
  - A `warning` diagnostic whose `path` lies under a requested path refuses.
  - `recheckLaunchResources` reloads `skillFiles` with one `loadSkills` call: any warning, or a missing file in the result, throws.
  - Add the public `LaunchSkills` and the `SpawnOptions` fields in `service.ts`, with JSDoc stating fresh-only and the refusals.
- [ ] **Step 5: Run the tests to verify they pass.** Same command, then `bun run --cwd packages/pi-subagents check`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(executor): launch-resources validation seam`

---

## Task 3: Carry resources to the child — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
**Difficulty:** Hard
**Blocked by:** Task 1, Task 2

**Files:**
- Modify: `packages/pi-subagents/src/service/service-adapter.ts`, `src/lifecycle/subagent-manager.ts`, `src/lifecycle/subagent.ts`, `src/lifecycle/workspace.ts`, `src/lifecycle/create-subagent-session.ts`, `src/lifecycle/child-lifecycle.ts`, `src/index.ts`, `src/session/package-exclusions.ts`, `src/seams/launch-gate.ts`
- Create: `packages/pi-subagents/src/session/launch-skills.ts`, `packages/pi-subagents/test/session/launch-skills.test.ts`
- Create: `packages/pi-subagents/test/seams/launch-resources-flow.test.ts` (service door → manager → run, recording factory), `packages/pi-subagents/test/lifecycle/launch-resources-prompt.test.ts` (real loader and loopback, built on the `fresh-prompt.test.ts` harness), `packages/pi-subagents/test/seams/launch-resources-extensions.test.ts` (real `index.ts` composition root, real loader, local package fixture)
- Modify tests:
  - `test/helpers/subagent-session-io.ts`, `test/helpers/subagent-session-io.test.ts` and `test/helpers/mock-session.ts`: the `LoaderSettings` return value, and the required `getSkills` on loader stubs;
  - `test/lifecycle/create-subagent-session.test.ts`, `test/lifecycle/fresh-prompt.test.ts`, `test/lifecycle/fork-prompt.test.ts` and `test/lifecycle/fork-tools.test.ts`: the same loader-stub shape;
  - `test/lifecycle/child-lifecycle.test.ts`, `test/lifecycle/subagent.test.ts` and `test/seams/identity.test.ts`: `session-created` now carries `cwd`. Use `objectContaining`, or add `cwd` to the exact payload.

**Interfaces:**
- Consumes: Task 1 `AgentConfig.inheritSkills`; Task 2 `parseLaunchResources`, `effectiveSkillChoice`, `assertFreshOnly`, `recheckLaunchResources`, `defaultLaunchResourcesIO`, `LaunchResources`.
- Produces: the `WorkspacePrepareContext` and `ChildSessionCreatedEvent` fields, `excludedPackageUnion`, `LoaderSettings`, `SkillsOverride`, `skillLoaderOptions`, `assertNoCatalogCollision`, `ResourceFacts` and `resourceFacts` (see Contracts).

- [ ] **Step 0: Write the failing unit tests** in `test/session/launch-skills.test.ts`. They use real temp files and the real `realpathSync`.
  - `skillLoaderOptions`:
    - `undefined` gives `{}`;
    - `inherit: false` gives `noSkills: true`, `additionalSkillPaths` equal to `skillFiles` (not the original `paths`), and an override that drops a skill outside `skillFiles` and keeps one reached through a symlink (`allowlist matches a symlinked path`);
    - `inherit: true` with files gives no `noSkills`, and an override that passes every skill through and writes a debug note for a collision whose winner is in `skillFiles`;
    - `inherit: true` with no files gives `{}`.
  - `assertNoCatalogCollision`:
    - throws `Skill name collision: plan (<catalog>, <explicit>)` when the loser is explicit;
    - passes when the winner is explicit;
    - passes for a collision between two catalog files.
  - `resourceFacts`:
    - `reported: false` gives only `{ cwd }`;
    - `reported: true` gives all five fields, with `contextFiles` as supplied and `inheritSkills` from the choice (`true` when the choice is `undefined`);
    - the result is frozen.
  - `excludedPackageUnion`: `["a","b"]` + `["b","c"]` gives `["a","b","c"]` (`union keeps setting order, no duplicates`).

  Run `bun run --cwd packages/pi-subagents test test/session/launch-skills.test.ts`. Expected: FAIL (the module is missing). Implement `src/session/launch-skills.ts` and `excludedPackageUnion` per Contracts. Run again. Expected: PASS.

- [ ] **Step 1: Write the failing flow tests** in `test/seams/launch-resources-flow.test.ts`. They drive `SubagentsServiceAdapter.spawn()` → real `SubagentManager` → `Subagent.run` → a recording `createSubagentSession`, with the stubs from `make-deps`/`manager-stubs`, as `launch-metadata-flow.test.ts` does.
  - `refusal leaves nothing`, as a table of two rows (a missing cwd, and a missing skill path): each throws from `spawn()`; `listAgents()` is empty, no `subagents:*` event fired, and the policy was not called.
  - `no-provider timing kept`: with no policy and no provider, the recording factory has been called before `spawn()` returns control to the next microtask (assert synchronously after `spawn()`, as `launch-policy.test.ts` "with no policy the launch runs as upstream" does).
  - `queued launch keeps its frozen resources`: with `maxConcurrent` 1, the second launch's `skills.paths` array is mutated after `spawn()`. When it dequeues, the factory gets the original frozen `resources`.
  - `skill removed while queued` and `skill turned invalid while queued`: same queue set-up. A listed skill file is deleted, or loses its `description`, before dequeue. The run ends `error` with `Launch resources no longer valid:` naming the file, and neither the factory nor the provider is called.
  - `pin reaches the factory`: a pinned agent spawned with `skills` `{ inherit: true, paths: [p] }` reaches the factory with `params.resources` and the pinned agent type, so `effectiveSkillChoice` resolves `inherit: false`.
  - `fresh-only after fallback`, as a table:
    - caller fork with a branch and `cwd` throws;
    - caller fork with a branch and `contextFiles: true` throws;
    - locked fork with a branch and `skills` throws;
    - agent fork (locked and unlocked) without a branch and `cwd` runs `fresh` with `contextFallback` `no-parent-session`, and the factory gets `cwd`;
    - a pinned agent fork without a branch runs fresh, and the factory gets the pin.
  - `pinned agent forked from the tool`: `AgentTool` with `context: "fork"` and a branch returns the refusal text, and no record exists.
  - `pinned agent from the tool reaches the factory`: `AgentTool` launches a pinned agent `fresh`. The factory gets no `resources` and the pinned type; the real-loader test below proves that this input gives no skills.
  - `cwd without a provider`: the factory gets `cwd: "/…/u1"`.
  - `provider sees the request`: `prepare` gets `requestedCwd` and `metadata`.
  - `provider returns nothing`: the factory gets the requested cwd.
  - `provider refuses`: the run is `error`, and the factory is never called.
  - `provider wrap is reported`: the factory gets the provider's directory.
  - `worktree removed while queued`: with `maxConcurrent` 1 and a blocking first run, the second launch's cwd is removed. It ends `error` with `Launch resources no longer valid:`, and neither the factory nor the provider is called.
  - `policy cannot change resources`: a policy returning `{ model, cwd: "/tmp" }` leaves the factory with the requested cwd and the policy's model.
  - `launch-excluded tool not offered`: a parent tool whose `sourceInfo` is `{ origin: "package", source: "npm:flow-pack" }` is absent from `request.toolSet.parentTools` for a launch excluding `npm:flow-pack`, and present for a sibling.
  - `resume does not reapply`: `resume()` on a settled record does not call the factory again with `resources`.
  - Type-level: `// @ts-expect-error` for `ResumeOptions["cwd"]`, plus an assertion that the `subagent` tool's parameter schema keys include none of `skills`, `excludeExtensionPackages`, `cwd` or `contextFiles`.
- [ ] **Step 2: Write the failing real-loader tests** in `test/lifecycle/launch-resources-prompt.test.ts`. They reuse the loopback server and the `createSubagentSession` setup from `fresh-prompt.test.ts`, with temp `agentDir`, `projectDir` and skill dirs, and assert on the first request body.
  - `only the given skill`: the system prompt lists the explicit skill's name, but not global skill `a` or project skill `b`.
  - `no skills at all`: there is no `<available_skills>` block.
  - `catalog plus extra skill`: `a`, then the extra skill.
  - `duplicate path kept once`: the skill name occurs once.
  - `allowlist matches a symlinked path`.
  - `discovered skill kept out`: an inline extension factory registers `resources_discover` returning `/…/extra/SKILL.md`. With `inherit: false` it is absent from the first request; with `inherit: true` it is present.
  - `catalog follows the child's directory`: the child's `cwd` project has skill `b`; `b` is listed.
  - `explicit skill collides with the catalog`: the factory rejects with `Skill name collision:`, naming both paths, and no session is created (`createSession` is not called).
  - `late discovery never displaces an explicit skill`: with `inherit: true`, explicit `plan`, and a discovering extension returning another `plan`, the first request lists the explicit file's description, and the debug output names both files.
  - `listed directory changes shape while queued`: the factory is called with resources whose `skillFiles` hold `dir/a/SKILL.md`, after `dir/SKILL.md` was added; only `a` is listed.
  - `pinned agent from the tool`: the factory is called as the tool door calls it (no `resources`, pinned agent type, origin `tool`), and the first request has no `<available_skills>` block.
  - `pin overrides caller inherit`: a pinned agent with `resources.skills` `{ inherit: true, paths: [p] }` lists only `p`'s skill, and `session-created` has `inheritSkills: false`.
  - `omitted fields keep today's child`: with no resources and an unpinned agent, global skill `a` and project skill `b` are listed, and the project `AGENTS.md` marker is present.
  - `no AGENTS.md`: with `contextFiles: false` there is no global or project marker, and the prompt still ends with the `<agent>` section.
  - `project instructions present`: the existing scenario, with `contextFiles` omitted, is unchanged.
  - `session-created carries effective values`, with all four fields plus setting `["npm:noisy"]`: `cwd`, `inheritSkills: false`, `skillPaths: [<real path>]`, `excludedExtensionPackages: ["npm:noisy", "<pkg>"]`, `contextFiles: false`, `context: "fresh"`.
  - `only cwd given`: `inheritSkills: true`, `skillPaths` the loaded catalog, `excludedExtensionPackages` the setting, `contextFiles: true`.
  - `plain launch`: only `cwd` among the new fields.
  - `explicit skills are final`: with `inherit: false` and a discovering extension, `skillPaths` equals `session.resourceLoader.getSkills().skills` file paths after bind. All fixtures are model-invocable skills.
  - `inherited skills before bind`: with `inherit: true`, `skillPaths` lacks the discovered path.
- [ ] **Step 2b: Write the failing extension-exclusion tests** in `test/seams/launch-resources-extensions.test.ts`. They load the real `src/index.ts` with a recording `pi` stub, as `service-wiring.test.ts` does, but keep the real `createSubagentSession` IO (real `DefaultResourceLoader` and `createAgentSession` against the loopback server).
  - Fixture: a temp local package `flow-pack/` with `package.json` `{ "name": "flow-pack", "pi": { "extensions": ["./ext.ts"] } }`. `ext.ts` does two things:
    - at module top level, it appends `imported` to a marker file whose path is in an env var set by the test;
    - its default factory registers `before_agent_start`, appending `BOOT-MARKER` to the system prompt.
  - The project settings `.pi/settings.json` list `packages: ["<absolute flow-pack path>"]`. The marker file is reset in `beforeEach`.
  - `bootstrap kept out of one child`: a service launch with `excludeExtensionPackages: ["<flow-pack path>"]` sends a first request without `BOOT-MARKER`, and the marker file is empty. A sibling launch without the field sends `BOOT-MARKER`, and the marker file holds `imported`.
  - `unknown package noted`: a launch excluding `npm:not-installed` runs, and the debug output (`PI_SUBAGENTS_DEBUG=1`) names it.
  - `setting exclusion reported even when not installed`: with the setting `excludedExtensionPackages: ["npm:noisy"]` and a launch excluding the flow-pack path, `session-created.excludedExtensionPackages` is `["npm:noisy", "<flow-pack path>"]`.
- [ ] **Step 3: Run the three test files to verify they fail.** Run `bun run --cwd packages/pi-subagents test test/seams/launch-resources-flow.test.ts test/lifecycle/launch-resources-prompt.test.ts test/seams/launch-resources-extensions.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement the service and manager door.**
  - In `service-adapter.ts`, `spawn()` calls `parseLaunchResources(options ?? {}, defaultLaunchResourcesIO(getAgentDir()))` right after `parseLaunchMetadata`, and passes `resources`.
  - In `subagent-manager.ts`, `create()` calls `assertFreshOnly({ resources: options.resources, agentName: type, pinned: agentConfig.inheritSkills === false, context: launch.context })` right after `resolveLaunchContext`, then forwards `resources` and `launchResourcesIO` to the execution.
- [ ] **Step 5: Implement the run start in `subagent.ts` (design D7).**
  - Call `recheckLaunchResources` synchronously before the provider branch; a failure calls `this.fail(run, err)`.
  - The provider's `prepare` gets `requestedCwd` and `metadata` when defined.
  - `cwd = preparedCwd ?? resources?.cwd`.
  - Pass `resources` to the factory.
  - In `consultLaunchPolicy`, set `excludeExtensionPackages: this.execution.resources?.excludeExtensionPackages` on the `LaunchFacts`.
  - Add no `await` on the no-provider path.
- [ ] **Step 6: Wire `create-subagent-session.ts` (design D4, D8).** It only orchestrates; the logic lives in `launch-skills.ts`.
  - Widen `ContextSetup.loader` per Contracts.
  - `freshSetup` spreads `skillLoaderOptions(effectiveSkillChoice(params.resources, pinned), { realPath: realpathSync })`, and sets `noContextFiles: true` when `resources.contextFiles === false`.
  - Call `const { settingsManager, excludedExtensionPackages } = createLoaderSettingsManager(sessionSettings, resources?.excludeExtensionPackages ?? [])`.
  - After `loader.reload()`, call `assertNoCatalogCollision(choice, loader.getSkills().diagnostics, …)` before `createSession`.
  - After the collision check, the assembly builds `resourceFacts({ cwd: cfg.effectiveCwd, reported: resources !== undefined || pinned, choice, skills: loader.getSkills().skills, excluded: excludedExtensionPackages, contextFiles: resources?.contextFiles !== false })` and passes it as `StartInput.resourceFacts`. `startSession` spreads it into `sessionCreated` and computes nothing. The default `contextFiles: true` is pinned by `launch-resources-prompt.test.ts` › `only cwd given`.
- [ ] **Step 7: Implement the exclusion and the policy (design D5, D6).**
  - `index.ts`: `createLoaderSettingsManager(parent, extra)` computes `excludedPackageUnion(settings.excludedExtensionPackages, extra)`, builds the view from it (or returns `parent` when it is empty), and returns `{ settingsManager, excludedExtensionPackages: union }`. It writes a `debugNote` for each `extra` entry not among the global or project `packages` sources.
  - `launch-gate.ts` passes `excludedPackageUnion(context.excludedPackages(), facts.excludeExtensionPackages ?? [])` to `buildLaunchRequest`.
- [ ] **Step 8: Run the new tests to verify they pass.** Use the Step 3 command. Expected: PASS.
- [ ] **Step 9: Run the full executor suite and fix fallout.** Run `bun run test:executor`. Expected: PASS. The expected edits are only:
  - the `LoaderSettings` return value and the required `getSkills` in the helpers listed under Files;
  - `objectContaining`, or an added `cwd`, in the three tests listed under Files that pin the exact `session-created` payload.
- [ ] **Step 10: Commit.** `feat(executor): per-launch skills, extension exclusion, cwd and context files`

---

## Task 4: Records, generated types and docs — implements 4

**Covers:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
**Difficulty:** Easy
**Blocked by:** Task 3

**Files:**
- Modify: `packages/pi-subagents/VENDORED.md`, `packages/pi-subagents/dist/public.d.ts` (generated), `packages/pi-subagents/README.md`, `packages/pi-subagents/docs/configuration.md`, `docs/architecture.md`, `docs/decisions/0009-vendored-executor.md`
- Test: `packages/pi-subagents/test/readme-contract.test.ts`

- [ ] **Step 1: Write the failing README contract test.** It asserts that `README.md` contains:
  - `Launch resources apply to fresh launches only`;
  - `requestedCwd`;
  - `inherit_skills`.
- [ ] **Step 2: Run the test to verify it fails.** Run `bun run --cwd packages/pi-subagents test test/readme-contract.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the docs.**
  - `README.md`:
    - the `spawn` contract: the four fields, the fresh-only rule, the refusals and the run-start re-check;
    - Events: the new `session-created` fields;
    - Worktree Isolation: `requestedCwd` and `metadata`, and that the caller creates the worktree.
  - `docs/configuration.md`:
    - an `inherit_skills` frontmatter row;
    - a per-launch `excludeExtensionPackages` paragraph under "Excluding package extensions from children".
  - `docs/architecture.md` (seams line) and ADR 0009 (seam list): add "per-launch resources (skills, extension exclusion, cwd, context files)".
- [ ] **Step 4: Add the `VENDORED.md` rows.** Add a row for each new seam and test file, and for each edited upstream file from Tasks 1–3, with a one-line reason each.
- [ ] **Step 5: Regenerate and verify the public types.** Run `bun run --cwd packages/pi-subagents build:types && bun run --cwd packages/pi-subagents verify:public-types`. Expected: PASS.
- [ ] **Step 6: Run the full verification.** Run `bun run test && bun run test:executor && bun run lint && bun run typecheck && bun run --cwd packages/pi-subagents lint`. Expected: all PASS, including the vendoring test (every edited upstream file has a row).
- [ ] **Step 7: Commit.** `docs(executor): per-launch resources contract`

---

## Scenario → test

**launch-resources**
- Omitted fields keep today's child → `launch-resources-prompt.test.ts` › `omitted fields keep today's child`; `launch-resources-flow.test.ts` › `no-provider timing kept`
- Tool cannot set resources → `launch-resources-flow.test.ts` › type-level and tool schema check
- Duplicate path kept once → `launch-resources.test.ts` › `dedupes a repeated path keeping first order`; `launch-resources-prompt.test.ts` › `duplicate path kept once`
- Catalog follows the child's directory → `launch-resources-prompt.test.ts` › `catalog follows the child's directory`
- Only the given skill → `launch-resources-prompt.test.ts` › `only the given skill`
- No skills at all → `launch-resources-prompt.test.ts` › `no skills at all`
- Discovered skill kept out → `launch-resources-prompt.test.ts` › `discovered skill kept out`
- Catalog plus extra skill → `launch-resources-prompt.test.ts` › `catalog plus extra skill`
- Late discovery never displaces an explicit skill → `launch-resources-prompt.test.ts` › `late discovery never displaces an explicit skill`
- Explicit paths collide → `launch-resources.test.ts` › `refuses two files with one skill name`
- Explicit skill collides with the catalog → `launch-resources-prompt.test.ts` › `explicit skill collides with the catalog`
- Pin overrides caller inherit → `launch-resources-flow.test.ts` › `pin reaches the factory`; `launch-resources-prompt.test.ts` › `pin overrides caller inherit`
- Pinned agent from the tool → `launch-resources-flow.test.ts` › `pinned agent from the tool reaches the factory`; `launch-resources-prompt.test.ts` › `pinned agent from the tool`
- Bootstrap kept out of one child → `launch-resources-extensions.test.ts` › `bootstrap kept out of one child`
- Unknown package noted → `launch-resources-extensions.test.ts` › `unknown package noted`
- No AGENTS.md in the child → `launch-resources-prompt.test.ts` › `no AGENTS.md`
- Provider returns nothing → `launch-resources-flow.test.ts` › `provider returns nothing`
- cwd without a provider → `launch-resources-flow.test.ts` › `cwd without a provider`; `launch-resources-prompt.test.ts` › `catalog follows the child's directory` (env header and context files of the child cwd)
- Provider sees the request → `launch-resources-flow.test.ts` › `provider sees the request`
- Provider refuses → `launch-resources-flow.test.ts` › `provider refuses`
- Wrong shape refused → `launch-resources.test.ts` › `refuses wrong shapes`
- Missing skill path refused → `launch-resources.test.ts` › `refuses a missing skill path`; `launch-resources-flow.test.ts` › `refusal leaves nothing` (skill row)
- Relative cwd refused → `launch-resources.test.ts` › `refuses a relative cwd`
- Missing cwd refused → `launch-resources.test.ts` › `refuses a missing cwd`; `launch-resources-flow.test.ts` › `refusal leaves nothing` (cwd row)
- Unparsable skill refused → `launch-resources.test.ts` › `refuses a skill without description`
- Caller mutates paths after spawn → `launch-resources.test.ts` › `freezes and detaches`; `launch-resources-flow.test.ts` › `queued launch keeps its frozen resources`
- Caller fork with cwd → `launch-resources-flow.test.ts` › `fresh-only after fallback` (row 1)
- Default value still counts → `launch-resources-flow.test.ts` › `fresh-only after fallback` (row 2)
- Locked fork with skills → `launch-resources-flow.test.ts` › `fresh-only after fallback` (row 3)
- Agent fork falls back and keeps resources → `launch-resources-flow.test.ts` › `fresh-only after fallback` (row 4)
- Pinned agent falls back → `launch-resources-flow.test.ts` › `fresh-only after fallback` (row 5)
- Pinned agent forked → `launch-resources-flow.test.ts` › `pinned agent forked from the tool`
- Worktree removed while queued → `launch-resources-flow.test.ts` › `worktree removed while queued`
- Skill removed from a listed directory → `launch-resources.test.ts` › `skill removed from a listed directory`; `launch-resources-flow.test.ts` › `skill removed while queued`
- Listed directory changes shape while queued → `launch-resources-prompt.test.ts` › `listed directory changes shape while queued`
- Skill turned invalid while queued → `launch-resources.test.ts` › `skill turned invalid`; `launch-resources-flow.test.ts` › `skill turned invalid while queued`
- Policy returns a cwd → `launch-resources-flow.test.ts` › `policy cannot change resources`
- Effective values reported → `launch-resources-prompt.test.ts` › `session-created carries effective values`; `launch-resources-extensions.test.ts` › `setting exclusion reported even when not installed`; `launch-skills.test.ts` › `resourceFacts`
- Only cwd given → `launch-resources-prompt.test.ts` › `only cwd given`
- Plain launch → `launch-resources-prompt.test.ts` › `plain launch`
- Explicit skills are final → `launch-resources-prompt.test.ts` › `explicit skills are final`
- Inherited skills before bind → `launch-resources-prompt.test.ts` › `inherited skills before bind`

**executor-launch-policy**
- Tool-call origin → `launch-policy.test.ts` › `tool-call origin, agent type and requested model`
- Orchestration tools never offered → `launch-policy.test.ts` › `orchestration tools are never offered`
- Excluded extension's tool not offered → `launch-policy.test.ts` › `an excluded extension's tool is not offered`
- Locked caller value not requested → `launch-policy.test.ts` › `a locked caller value is not requested`
- Fork request → `launch-policy.test.ts` › `Fork request: no caller model → requested is the parent's model and thinking`
- Locked fork request → `launch-policy.test.ts` › `Locked fork request: the agent's locked model is requested over the caller's`
- Fallen-back fork → `subagent-manager.test.ts` › `Fallen-back fork: the launch policy receives context fresh`
- Service launch with metadata → `launch-metadata-flow.test.ts` › `Service launch with metadata`
- No metadata in the request → `launch-metadata-flow.test.ts` › `No metadata in the request`
- Launch-excluded extension's tool not offered → `launch-resources-flow.test.ts` › `launch-excluded tool not offered`

**subagent-context-mode**
- Project instructions present → `fresh-prompt.test.ts` › `carries the project instructions for the child's directory before the body` (`contextFiles` omitted)
- Append file applied once → `fresh-prompt.test.ts` › `applies the append file exactly once`
- Agent body last → `fresh-prompt.test.ts` › `ends with the agent section, body last, header before it`
- Context files turned off → `launch-resources-prompt.test.ts` › `no AGENTS.md`
- Explicit skills in the catalog → `launch-resources-prompt.test.ts` › `only the given skill`

**executor-agent-registry**
- Built-in explore → `registry.test.ts` › `describes the built-in explore`
- Package source → `registry.test.ts` › `reports a package agent's source in the snapshot` (new in Task 1: a package-dir agent through `AgentTypeCatalog.get()` has `source` `package`)
- Snapshot is detached → `registry.test.ts` › `is deeply frozen and detached from the executor`
- Absent tools kept distinct from defaults → `registry.test.ts` › `keeps absent tools distinct from the defaults`
- Pinned skills in the snapshot → `registry.test.ts` › `pins with inherit_skills: false`, `absent when not declared`
