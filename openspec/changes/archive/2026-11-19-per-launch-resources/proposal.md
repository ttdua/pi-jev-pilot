## Why

A child launched with `SubagentsService.spawn()` inherits the parent's whole skill catalog, every extension not excluded globally, the parent's context files and the parent's cwd. A workflow extension that dispatches role work therefore leaks the previous flow's skills and bootstrap into the child and cannot run a child in a per-unit worktree (#84, with the #88 follow-up). The caller should decide, per launch, what a child sees and where it runs.

## What Changes

**Per-launch resources on service launches**
- From: `SpawnOptions` has no say over a child's skills, extensions, context files or cwd.
- To: four optional fields, on service launches only. The `subagent` tool does not gain them.
  - `skills: { inherit, paths? }`: `inherit: false` gives exactly `paths`; `inherit: true` gives the catalog a child normally inherits (discovered for the child's own working directory) plus `paths`.
  - `excludeExtensionPackages`: added to `excludedExtensionPackages` for this child only.
  - `cwd`: an absolute path to an existing directory.
  - `contextFiles: false`: no global or project context files.
- Reason: a workflow chooses the child's environment without global settings or project trust.
- Impact: additive. Omitted fields keep today's behaviour exactly.

**Refusals, never fallbacks**
- `spawn()` throws synchronously, with no record, event or policy call, when:
  - a skill path is invalid;
  - `cwd` is not an absolute path to an existing directory;
  - any of the four fields meets a launch that resolves to `fork`.
- A queued launch is checked again at run start. A failure there fails the run, and the child never falls back to the parent's cwd.

**Agent pin: `inherit_skills: false`**
- An agent file can pin itself to explicit skills only. It overrides a caller's `inherit: true`, keeps the caller's `paths`, and gives a tool-call launch no skills.
- A launch of such an agent that resolves to `fork` is refused.
- The agent snapshot carries `inheritSkills`.

**Workspace provider and launch policy**
- `WorkspacePrepareContext` gains `requestedCwd` and `metadata`, so a registered provider can honour, wrap or refuse the requested cwd. With no provider, or a provider that returns nothing, `cwd` is used as is.
- The launch policy cannot change any of these fields. Its grantable parent tools also leave out the launch's own excluded packages.

**Evidence**
- `subagents:child:session-created` reports the effective skill paths, excluded packages, cwd and context-files choice. It already reports `context`.

**Out of scope**
- Creating or removing worktrees (the executor stays git-agnostic, ADR 0002).
- Re-applying the fields on resume.
- jev-pilot `src/` using the fields.

## Capabilities

### New Capabilities
- `launch-resources`: per-launch skills, extension exclusion, cwd and context files on service launches. Covers validation, refusal, the run-start re-check, the `inherit_skills` agent pin, the workspace provider hand-off, immunity to the launch policy and the effective values on `session-created`.

### Modified Capabilities
- `executor-launch-policy`: "Launch request given to the policy": `parentTools` also leaves out tools of the launch's own excluded packages.
- `subagent-context-mode`: "Fresh child prompt": the context files and skills catalog follow the launch's `contextFiles` and effective skill set.
- `executor-agent-registry`: "Agent snapshot content": the snapshot carries `inheritSkills` as declared.

## Impact

- **Vendored executor (`packages/pi-subagents/`):**
  - `src/service/service.ts` and `src/service/service-adapter.ts` (`SpawnOptions`, validation at `spawn()`)
  - `src/lifecycle/subagent-manager.ts`, `src/lifecycle/subagent.ts`, `src/lifecycle/workspace.ts` (run-start check, provider context)
  - `src/lifecycle/create-subagent-session.ts`, `src/lifecycle/child-lifecycle.ts` (loader options, per-launch exclusion, `session-created` fields)
  - `src/index.ts` (the loader settings view takes the per-launch exclusions)
  - `src/session/package-exclusions.ts`, `src/seams/launch-request.ts`, `src/seams/launch-gate.ts`
  - `src/config/custom-agents.ts`, `src/types.ts`, `src/seams/registry.ts` (`inherit_skills`)
  - new seam file for launch-resource validation
  - tests
- **Records:** add a `VENDORED.md` row for every edited upstream file. Regenerate `dist/public.d.ts`; `verify:public-types` must pass.
- **Docs:**
  - `packages/pi-subagents/README.md`: `spawn` contract, Events, Worktree Isolation;
  - `packages/pi-subagents/docs/configuration.md`: frontmatter `inherit_skills`, per-launch exclusion next to `excludedExtensionPackages`;
  - `docs/architecture.md`: the seams line;
  - `docs/decisions/0009-vendored-executor.md`: the seam list.
- **jev-pilot `src/`:** no change. Jev is not called, so there is no Jev-failure path.
