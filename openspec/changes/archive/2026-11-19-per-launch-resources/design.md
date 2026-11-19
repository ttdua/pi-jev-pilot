## Context

The approach and the user's decisions are in `brainstorm.md`. This file records the technical choices.

How the executor builds a child today (`packages/pi-subagents/`):

- `SubagentsServiceAdapter.spawn()` validates `metadata` first, resolves `context` through `resolveContext`, then calls `SubagentManager.spawn()`.
- `SubagentManager.create()` checks `fork` against the parent branch with `resolveLaunchContext`.
- `Subagent.run()` runs after dequeue. It consults the launch policy, then the `WorkspaceBracket` (only when a provider is registered), then calls `createSubagentSession({ cwd, ... })`.
- `createSubagentSession` builds:
  - `SessionConfig` (`effectiveCwd = params.cwd ?? snapshot.cwd`);
  - a `ContextSetup`, `fresh` or `fork`, with the loader's `noContextFiles`, `appendSystemPromptOverride` and `extensionFactories`;
  - a settings view through `io.createLoaderSettingsManager(sessionSettings)`;
  - a `DefaultResourceLoader`.
- The global exclusion is resolved once at the composition root (`index.ts`), and `createExcludedPackagesStorage` serves the view that turns off the excluded packages' extensions.
- Pi's `DefaultResourceLoader` already supports `noSkills`, `additionalSkillPaths` and `noContextFiles`. With `noSkills: true`, the skill paths are exactly `additionalSkillPaths` (plus CLI `--skill`, which a child never has). A missing path becomes a diagnostic, not an error.

## Goals / Non-Goals

**Goals:**
- Validate, freeze and carry four per-launch fields from `spawn()` to the child's loader and workspace, all optional and additive.
- Refuse early when the request cannot be met. Check again at run start, and never fall back.
- Report the effective values on `subagents:child:session-created`.

**Non-Goals:**
- Worktree creation, resume re-application, and exposure through the `subagent` tool.
- Putting the resources on the `LaunchRequest`. The policy cannot change them, so it does not need them. If needed, they can be added later as read-only fields.
- Persisting the resources in `subagents:record`.

## Decisions

### D1. One validation seam: `src/seams/launch-resources.ts`

The new seam file holds three functions:
- `parseLaunchResources(options, io)` checks the caller's fields (D2 rules 1–4) and returns a frozen `LaunchResources`, or throws. `spawn()` calls it right after `parseLaunchMetadata`, before anything is built.
- `assertFreshOnly({ resources, agentName, pinned, context })` applies D2 rule 5. `SubagentManager.create()` calls it right after `resolveLaunchContext`, so it judges the context after the fork fallback. It throws before the record exists, and it serves both doors.
- `recheckLaunchResources(resources, io)` runs at run start (D7).

The functions live in a new file because seams go in new files (ADR 0009), which keeps upstream merges small.

Field checks stay at the service door, since only that door has the fields. The fork check sits in the shared `create()`, because the fallback is decided there and the pinned-agent rule covers both doors. `manager.spawn()` is synchronous, so a refusal still throws out of `spawn()` with no record.

### D2. Rules the parser enforces, in order

Each refusal is an `Error` whose message names the rule and, where one applies, the offending path or entry.

1. Shapes:
   - `skills` is an object with a boolean `inherit` and an optional array of strings `paths`;
   - `excludeExtensionPackages` is an array of non-empty strings;
   - `cwd` is a string;
   - `contextFiles` is a boolean.
2. Every path, in `skills.paths` and `cwd`, is absolute (`path.isAbsolute`).
3. `cwd` is an existing directory (`statSync(...).isDirectory()`).
4. Skill paths:
   - every skill path exists and loads as at least one skill, with no `warning` diagnostic, through Pi's public `loadSkills({ skillPaths: paths, includeDefaults: false, cwd, agentDir })`. Pi accepts both directories and `SKILL.md` files, and so does the executor; a directory counts when it yields at least one skill;
   - a `collision` diagnostic between two different files is refused, naming the skill and both paths;
   - the resolved skill files (real paths, in load order) are kept on `LaunchResources.skillFiles`, for the re-check and the allowlist.
5. Fork: the context is judged after `resolveLaunchContext`, which applies the fallback, so a locked fork is caught and an agent fork that falls back is not. The rule refuses:
   - any carried field on a launch that resolves to `fork` (`… applies to fresh launches only`);
   - an agent with `inheritSkills: false` that resolves to `fork`.

A caller value equal to the default (`contextFiles: true`, an empty `excludeExtensionPackages`) still counts as "present" for the fork rule. Reason: the caller asked for an environment, so the rule stays simple.

Accepted values are copied and frozen, as `metadata` is. A duplicate skill path (the same real file) is dropped, keeping the first occurrence.

### D3. Agent pin resolution

The frontmatter field is `inherit_skills: false`. Any other value, or no field at all, means not pinned; a non-boolean value gets a debug note.

`AgentConfig` gains `inheritSkills?: false`. The snapshot carries `inheritSkills: false` only when the agent declares it.

The effective skill set:
- `inherit = pinned ? false : (caller.skills?.inherit ?? true)`;
- `paths = caller.skills?.paths ?? []`.

When nothing applies (no caller `skills` and no pin), the loader options are untouched, which is today's behaviour.

The tool door has no `skills` input. A pinned agent launched from it gets `noSkills: true` with no paths.

The pinned-fork refusal is `assertFreshOnly` in `create()` (D1). The tool door already turns a throw there into an error tool result (`background-spawner.ts`, `foreground-runner.ts`), as it does for an explicit fork without a parent session.

**The inherited catalog** is the catalog the child's own session discovers, for its own working directory, the same as when `skills` is omitted. It is not a snapshot of the parent's in-memory catalog. Reasons:
- this keeps "omitted keeps today's behaviour" and "`inherit: true` plus no paths" identical;
- a child in another worktree should see that worktree's project skills, just as it sees that worktree's `AGENTS.md` (ADR 0010, project context is directory-resolved);
- Pi exposes no public way to hand one session's loaded skills to another loader.

This decision replaces the wording "the parent's catalog" in the issue and in the approved `brainstorm.md`. The two are not the same when the child's cwd differs from the parent's: a parent skill `a` from its own project is not inherited by a child in a worktree whose project has `b`. The brainstorm's intent (inherit what a child normally gets) is kept. Its literal wording is superseded, and the final gate shows this.

### D4. Loader wiring

`CreateSubagentSessionParams` gains `resources?: LaunchResources`. Only `freshSetup` reads it, because a fork never gets resources (D2). It adds to `setup.loader`:
- when `inherit` is false: `noSkills: true`, `additionalSkillPaths: skillFiles`, and a `skillsOverride` that keeps only skills whose real file path is in `skillFiles`;
- when `inherit` is true and `skillFiles` is non-empty: `additionalSkillPaths: skillFiles`;

The loader gets the resolved `skillFiles` (the files validated at `spawn()` and re-checked at run start), never the caller's original `paths`. A directory that changes shape, or a symlink retargeted while the launch is queued, therefore cannot change which files load. The original `paths` serve only error messages.
- when `contextFiles` is false: `noContextFiles: true`.

`ResourceLoaderOptions` gains `noSkills`, `additionalSkillPaths` and `skillsOverride`.

Why the override: Pi's `extendResources` (driven by `resources_discover` after `session_start`) appends skill paths even under `noSkills`. However, it rebuilds through `updateSkillsFromPaths`, which applies `skillsOverride` each time. Filtering by the allowlist there keeps the catalog explicit-only before and after bind, using only the public loader option.

Order and collisions when inheriting:
- Pi's loader lists the catalog before the additional paths, and on a name clash the first file wins.
- After `loader.reload()`, the factory checks the loader's skill diagnostics. A `collision` whose loser is one of `skillFiles` fails the launch (`Skill name collision: <name> (<winner>, <loser>)`) before the session is created.
- `extendResources` appends skills discovered during bind after the explicit files (`mergePaths(lastSkillPaths, new)`). On a clash the explicit file wins and Pi records a `collision` diagnostic. This cannot fail the launch, because the session already exists and `session-created` has fired. Instead, `freshSetup`'s `skillsOverride` (installed for inheriting launches that have explicit files) writes a debug note for a collision whose winner is in `skillFiles`.

The resulting order is: initial catalog, explicit files, late discoveries.

### D5. Per-launch extension exclusion

The IO signature changes to `createLoaderSettingsManager(parent, extraExcluded: readonly string[]): { settingsManager, excludedExtensionPackages }`.
- The composition root builds the union of `settings.excludedExtensionPackages` and `extraExcluded`, in that order.
- It returns `parent` as the `settingsManager` when the union is empty.
- It returns the union itself, so the factory can report the effective list (D8) without seeing the setting.

This keeps the prevent-load guarantee: the excluded module is never imported. The exclusion policy still sits at the composition root, as #696 intended.

An entry that matches no configured package gets one debug note, read from `parent.getGlobalSettings()` and `getProjectSettings()` package sources.

Alternative rejected: `extensionsOverride`. The extension's factory would already have run.

### D6. Grantable tools subtract the launch's packages

`LaunchFacts` gains the launch's `excludeExtensionPackages`. `LaunchPolicyGate` passes `[...context.excludedPackages(), ...launchExcluded]` to `buildLaunchRequest`, so the policy is never offered a tool the child cannot load.

The `LaunchAdjustment` shape is unchanged. `validAdjustment` keeps only `model`, `thinking`, `addTools` and `removeTools`, so a policy that returns `skills` or `cwd` has those keys ignored. A test pins that behaviour.

### D7. cwd and the workspace provider

`WorkspacePrepareContext` gains two optional fields: `requestedCwd?: string` and `metadata?: LaunchMetadata`.

In `Subagent.run()`:
1. Run `recheckLaunchResources` first, after the policy and before the provider. It checks that `cwd` is still a directory, then reloads `skillFiles` with `loadSkills`; every file must still exist and load with no warning. A failure calls `this.fail(run, err)` (no child session, no workspace). Its message starts with `Launch resources no longer valid:` and names the path.
2. With a provider:
   - its `Workspace.cwd` wins;
   - `undefined` falls back to `requestedCwd`, then to the parent cwd when no cwd was requested (today's behaviour);
   - a throw fails the run, as today.
3. With no provider: `cwd = requestedCwd`.

This keeps upstream's synchronous no-provider timing: the re-check is synchronous file-system work, with no added await.

If the provider returns a directory different from `requestedCwd`, that is the provider's decision ("wrap"). The event reports what the child actually got.

### D8. Reporting on `session-created`

`ChildSessionCreatedEvent` gains optional fields, set only on a launch that carried resources or an agent pin:
- `skillPaths`: the effective skill files, read from `loader.getSkills()` after reload and before bind;
- `inheritSkills`;
- `excludedExtensionPackages`: the setting's entries in order, then the launch's entries not already listed;
- `contextFiles`.

When the launch inherits, `skillPaths` cannot include skills that extensions discover during bind: the event has to fire before bind, and consumers rely on that order. When it does not inherit, the allowlist (D4) makes `skillPaths` final.

`cwd` is always present, because the effective cwd is a fact worth reporting for every launch, and it is additive. `context` is already present.

`skillPaths` is the loaded skills' `filePath` list. That way a caller can verify exactly what the child sees, including skills that came from an inherited catalog.

### D9. Public types

The new public types are `SpawnOptions` fields, `LaunchSkills`, the `WorkspacePrepareContext` fields, the `ChildSessionCreatedEvent` fields and `AgentTypeSnapshot.inheritSkills`. Their full shape belongs in `plan.md` under Contracts. All of them are optional, so `verify:public-types` and existing consumers keep compiling.

## Risks / Trade-offs

- [`loadSkills` validation in `spawn()` reads the disk synchronously] → It runs once per explicit path, only for service launches that pass `skills`, and is bounded by the caller's list.
- [A path can go stale between `spawn()` and run start] → `recheckLaunchResources` reloads the resolved skill files and checks `cwd` at run start. A change between the re-check and the loader's own reload, a window of a few milliseconds, is not covered.
- [An inherited catalog reported on `session-created` can grow during bind] → This is stated in the spec. A caller that needs a final list uses `inherit: false`.
- [`session-created` grows] → Every new field is optional, and `cwd` is a plain string. Consumers that destructure only known fields are unaffected.
- [A provider wraps `requestedCwd` into a directory that does not exist] → This is the same as today's provider contract ("already exists when handed back"). The executor does not re-validate provider output.

## Migration Plan

All changes are additive, and no setting or data changes, so there is no migration. Rollback is a revert.

## Open Questions

None.
