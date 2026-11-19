## Design Summary

Issue #84 (with its #88 follow-up comment). Depends on `launch-metadata` (#83, archived).

**Intent.** A workflow extension that dispatches role work through `SubagentsService.spawn()` must decide, per child, what the child can see and where it runs, without touching global settings or project trust:

- **Skills**: give a child only the skills of the flow it runs, so a project that switches flows (for example from one skill pack to a Superpowers pack) does not leak the old flow's skills into the child.
- **Extensions**: keep one package's bootstrap (for example a `before_agent_start` injection) out of one child.
- **Working directory**: run a child in a given directory, typically a git worktree the caller created for one unit of parallel work.
- **Context files**: keep the user's global and project `AGENTS.md` out of a role child whose brief is already complete.

Today a child inherits the parent's whole skill catalog, every extension not excluded globally by `excludedExtensionPackages`, the parent's context files, and the parent's cwd (or whatever the single `WorkspaceProvider` returns, which cannot tell which unit a launch belongs to).

**What changes, as the user sees it.**

- `SpawnOptions` gains four optional fields: `skills` (`inherit` plus explicit `paths`), `excludeExtensionPackages`, `cwd` and `contextFiles`. They exist on service launches only. The `subagent` tool does not gain them, so the model cannot change them.
- An agent file can declare `inherit_skills: false`, pinning that agent to explicit skills only.
- `WorkspacePrepareContext` gains the requested cwd and the launch metadata, so a registered provider can honour, wrap or refuse a requested cwd.
- `subagents:child:session-created` reports the effective skill paths, excluded packages, cwd, context-files choice and context mode, so a caller can verify it got what it asked for.

**Goals.**
- A caller gets exactly the environment it asked for, or a clear refusal. Never a silent fallback (no silent parent cwd, no silent downgrade from fork to fresh, no silently missing skill).
- Omitted fields keep today's behaviour exactly; everything is optional and additive.

**Non-goals.**
- Creating or removing worktrees: the caller does that. The executor stays git-agnostic (ADR 0002).
- Exposing these fields on the `subagent` tool.
- Re-applying these fields on resume: a resume continues the session already created.
- jev-pilot (`src/`) using the fields: this change is executor-only.

**Anti-goals (a failure even if it "works").**
- A launch policy (classifier) influencing what a child can see or where it runs.
- An excluded package's extension code running at all in the child (deny-after-load is not exclusion).
- A child running in the parent's cwd because the requested directory vanished.
- A fork that silently stops sharing the parent's prompt cache.

**Existing requirements involved.**
- `executor-launch-policy` / "Applying the policy's adjustment": the adjustment fields stay `model`, `thinking`, `addTools`, `removeTools`. Unchanged; this change adds that a policy cannot alter the new fields.
- `executor-launch-policy` / "Launch request given to the policy": the grantable parent tools exclude tools of globally excluded packages. **Altered**: they must also exclude tools of the launch's own excluded packages.
- `launch-metadata` / "Refused metadata": a refusal throws synchronously from `spawn()` with no record, event or policy call. The new refusals follow the same contract.
- `subagent-context-mode` / "Fresh child prompt": the fresh prompt holds the project context files for the child's cwd and the skills catalog it loads. **Altered**: with `contextFiles: false` no context files, and the catalog is the launch's effective skill set.
- `subagent-context-mode` / "Context resolution order": an agent file that locks `context` wins. Unchanged; a caller that asks for fresh-only fields but resolves to a locked fork is refused.
- `executor-agent-registry` / "Agent snapshot content": **altered** to carry the new `inherit_skills` declaration.
- `executor-launch-identity` / "Child lifecycle events name their launch" and "Identity fields are additive": `session-created` gains the effective-resource fields, all optional.

## Alternatives Considered

### Alternative A: Load the parent's skills, then filter with `skillsOverride`
- **Approach**: keep the child loader's normal skill discovery and drop unwanted skills in Pi's `skillsOverride` hook.
- **Pros**: no change to how paths are discovered.
- **Cons**: cannot add a skill outside the catalog; still loads and parses every skill the parent has.
- **Why not chosen**: the issue needs explicit paths outside any catalog; the agreed approach gives exactly those.

### Alternative B: Exclude extensions by filtering after load (`extensionsOverride`)
- **Approach**: load every extension and drop the excluded package's entries from the load result.
- **Pros**: simple, per-launch by nature.
- **Cons**: the excluded package's module is already imported and its factory has already run, so a bootstrap side effect still happens.
- **Why not chosen**: it violates the anti-goal; the agreed approach extends the existing prevent-load seam instead.

### Alternative C: The executor registers a default `WorkspaceProvider` to honour `cwd`
- **Approach**: implement `cwd` as a built-in provider in the single provider slot.
- **Pros**: one code path for every cwd.
- **Cons**: occupies the only slot, so packages such as `@gotgenes/pi-subagents-worktrees` could no longer register.
- **Why not chosen**: the agreed approach keeps the slot free and hands the request to whichever provider is registered.

## Agreed Approach

Validate and freeze the new fields at `spawn()`, carry them with the launch, and apply them where the child's loader and working directory are built.

- **Refuse early.** `spawn()` throws synchronously (no record, no event, no policy call) when a skill path is not absolute, does not exist or does not parse as a skill; when `cwd` is not an absolute path to an existing directory; when any of these fields is combined with a launch that resolves to `fork`; or when the agent declares `inherit_skills: false` and the launch resolves to `fork`.
- **Check again at run start.** A queued launch can outlive its directory or skill file. At run start the executor checks again; a failure fails the run, never falls back.
- **Skills.** `inherit: false` gives the child exactly the listed skills; `inherit: true` gives the parent's catalog plus the listed skills; omitted keeps today's catalog.
- **Extensions.** The launch's packages are added to the global exclusion for that child only, through the same prevent-load seam the global setting uses.
- **Context files.** `contextFiles: false` keeps every global and project context file out of the child; the default keeps #88's behaviour.
- **cwd.** A registered provider receives the requested cwd and the launch metadata and decides; with no provider, or a provider that returns nothing, the requested cwd is used as is.
- **Launch policy.** Cannot change any of these fields.
- **Report.** `session-created` reports what the child actually got.

## Key Decisions

- **`inherit_skills: false` in an agent file wins, like a lock.** A caller's `skills.inherit: true` is forced to `false`; the caller's `paths` still apply; `session-created` reports the result. A `subagent` tool-call launch of such an agent has no skills. Such an agent resolving to `fork` is refused, because a fork always carries the parent's skill catalog. (User decision.)
- **Fresh-only fields refuse a fork, never downgrade it.** `skills`, `excludeExtensionPackages`, `cwd` and `contextFiles` with a launch that resolves to `fork` (requested or agent-locked) are refused with a clear error. (From the issue comment, confirmed.)
- **Validation happens twice:** synchronously at `spawn()`, and again at run start for directories and files that may have disappeared while queued. (User approved.)
- **The launch policy cannot change what a child can see or where it runs**, in line with the tool-assessment removal; the per-launch exclusions also shrink what the policy may grant. (From the issue.)
- **Resume does not re-apply these fields.** (Builder default, user approved.)
- **An `excludeExtensionPackages` entry matches a package source string exactly**, as `excludedExtensionPackages` does; an entry that matches no configured package is a debug note, not a refusal. (Builder default, user approved.)
- **Skill order:** parent catalog first when inherited, then `paths`; duplicate paths are dropped. (Builder default, user approved.)

## Open Questions

None blocking. Left to design: the exact shape of the run-start re-check failure message, how the effective fields appear on the `SubagentRecord` snapshot (if at all), and the error-message wording for each refusal.
