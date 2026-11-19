# launch-resources Specification

## Purpose
A service launch can choose, per child, the skills it sees, the extension packages kept out, its working directory and whether context files load; the executor validates these up front, applies them to fresh launches only, refuses rather than falls back, and reports the effective values on `session-created`.

## Requirements

### Requirement: Launch resources on service launches
`SpawnOptions` SHALL accept four optional launch resources: `skills` (`{ inherit: boolean; paths?: readonly string[] }`), `excludeExtensionPackages` (`readonly string[]`), `cwd` (`string`) and `contextFiles` (`boolean`). The `subagent` tool and `ResumeOptions` MUST NOT accept them; a resume SHALL continue the session as created. A launch that omits all four, of an unpinned agent, SHALL build its child exactly as before this change.

#### Scenario: Omitted fields keep today's child
- **WHEN** no workspace provider is registered, and an extension calls `spawn("explore", brief)` with none of the four fields for an agent that is not pinned and resolves to `fresh`
- **THEN** the child loads the skill catalog, every extension not in `excludedExtensionPackages`, and the context files it loaded before this change, and runs in the parent's cwd

#### Scenario: Tool cannot set resources
- **WHEN** the model calls `subagent` with a `cwd` or `skills` argument
- **THEN** the argument is not part of the tool's schema and has no effect on the child

### Requirement: Effective skill choice
The effective `inherit` SHALL be `false` for a pinned agent, otherwise the caller's `skills.inherit`, otherwise `true`. The effective `paths` SHALL be the caller's `skills.paths` in order, keeping only the first occurrence of each file (symlinks resolved).

#### Scenario: Duplicate path kept once
- **WHEN** an extension spawns with `skills` `{ inherit: false, paths: ["/x/a/SKILL.md", "/x/b/SKILL.md", "/x/a/SKILL.md"] }`
- **THEN** the child lists the skill from `/x/a/SKILL.md` first, then the skill from `/x/b/SKILL.md`, each once

### Requirement: Inherited catalog
The inherited catalog SHALL be the catalog the child's own session discovers when `skills` is omitted: global, settings, package and project skills for the child's working directory, plus skills the child's extensions add through `resources_discover`.

#### Scenario: Catalog follows the child's directory
- **WHEN** the parent's project has skill `a`, the child runs with `cwd` `/w/u1` whose project has skill `b`, and the launch inherits
- **THEN** the child lists `b` and not `a`

### Requirement: Explicit skills only
When the effective choice does not inherit, the child's skill catalog SHALL be exactly the skills loaded from `paths`. A path MAY lie outside any skill catalog. No other skill MAY enter the catalog: not from settings or packages, and not from an extension's `resources_discover`, before or after the child binds its extensions.

#### Scenario: Only the given skill
- **WHEN** the parent has skills `a` and `b`, and an extension spawns with `skills` `{ inherit: false, paths: ["/x/flow/plan/SKILL.md"] }`
- **THEN** the child's system prompt lists exactly the skill from `/x/flow/plan/SKILL.md`, and lists neither `a` nor `b`

#### Scenario: No skills at all
- **WHEN** an extension spawns with `skills` `{ inherit: false }`
- **THEN** the child's system prompt lists no skills

#### Scenario: Discovered skill kept out
- **WHEN** an extension the child loads returns skill `/x/extra/SKILL.md` from `resources_discover`, and the launch spawns with `skills` `{ inherit: false, paths: ["/x/p/SKILL.md"] }`
- **THEN** the child's first provider request lists only the skill from `/x/p/SKILL.md`

### Requirement: Inherited catalog plus explicit skills
When the effective choice inherits and `paths` is given, the child SHALL load, in order: the catalog known before the session is created, then the skills from `paths`, then skills the child's extensions discover while binding. A file already listed SHALL appear once. A skill discovered while binding whose name collides with an explicit skill SHALL be dropped, so the explicit skill stays, with a debug note naming both files.

#### Scenario: Catalog plus extra skill
- **WHEN** the child's catalog has skill `a`, and an extension spawns with `skills` `{ inherit: true, paths: ["/x/extra/SKILL.md"] }`
- **THEN** the child lists `a` and then the skill from `/x/extra/SKILL.md`

#### Scenario: Late discovery never displaces an explicit skill
- **WHEN** a launch inherits with explicit skill `plan` from `/x/plan/SKILL.md`, and an extension in the child discovers another file declaring `plan` while binding
- **THEN** the launch runs, the child's first request lists `plan` from `/x/plan/SKILL.md`, and the executor writes a debug note naming both files

### Requirement: Skill name collisions refused
A launch MUST NOT lose a requested skill to a name collision. Two different files in `paths` declaring the same skill name SHALL be refused at `spawn()`. An explicit skill colliding with a skill of the catalog known before the session is created SHALL fail the run before the session exists. Both messages SHALL name the skill and both paths.

#### Scenario: Explicit paths collide
- **WHEN** `/x/a/SKILL.md` and `/y/a/SKILL.md` both declare `name: plan`, and an extension spawns with both in `skills.paths`
- **THEN** `spawn()` throws naming `plan` and both paths

#### Scenario: Explicit skill collides with the catalog
- **WHEN** the child's catalog has a skill named `plan` from `/home/u/.pi/agent/skills/plan/SKILL.md`, and an extension spawns with `skills` `{ inherit: true, paths: ["/x/plan/SKILL.md"] }`, which also declares `plan`
- **THEN** the run fails naming `plan` and both paths, and no child session is created

### Requirement: Agent pin on inherited skills
An agent file SHALL accept `inherit_skills: false` in its frontmatter. Any other value SHALL count as not pinned, and a non-boolean value SHALL produce a debug note. For a pinned agent:
- the effective choice SHALL NOT inherit, even when the caller passes `skills.inherit: true`;
- the caller's `skills.paths` SHALL still apply;
- a `subagent` tool-call launch SHALL load no skills.

#### Scenario: Pin overrides caller inherit
- **WHEN** agent `planner` declares `inherit_skills: false`, and an extension spawns it with `skills` `{ inherit: true, paths: ["/x/p/SKILL.md"] }`
- **THEN** the child lists only the skill from `/x/p/SKILL.md`, and `session-created` reports `inheritSkills` `false`

#### Scenario: Pinned agent from the tool
- **WHEN** the model launches an agent that declares `inherit_skills: false` through `subagent`
- **THEN** the child lists no skills

### Requirement: Per-launch extension exclusion
The packages in `excludeExtensionPackages` SHALL be excluded for this child in addition to the `excludedExtensionPackages` setting, matched by exact package source string. An excluded package's extension module MUST NOT be imported in the child; its skills, prompts and themes SHALL be unaffected. The exclusion MUST NOT affect the parent, any other child or any settings file. An entry matching no configured package SHALL produce a debug note, not a refusal.

#### Scenario: Bootstrap kept out of one child
- **WHEN** package `npm:flow-pack` registers a `before_agent_start` handler that adds a marker, and an extension spawns with `excludeExtensionPackages` `["npm:flow-pack"]`
- **THEN** that child's first request contains no marker, and a sibling child launched without the field contains it

#### Scenario: Unknown package noted
- **WHEN** an extension spawns with `excludeExtensionPackages` `["npm:not-installed"]`
- **THEN** the launch runs and the executor writes a debug note naming `npm:not-installed`

### Requirement: Per-launch context files
With `contextFiles: false`, a fresh child SHALL load no global or project context files (`AGENTS.md`, `CLAUDE.md`). With `contextFiles` omitted or `true`, a fresh child SHALL load the context files for its own working directory. A fork keeps the parent's prompt as `subagent-context-mode` specifies.

#### Scenario: No AGENTS.md in the child
- **WHEN** the global and project `AGENTS.md` each hold a unique marker, and an extension spawns with `contextFiles: false`
- **THEN** the child's first request contains neither marker

### Requirement: Per-launch working directory
`cwd` SHALL be the child's working directory unless a registered workspace provider decides otherwise. When the provider returns nothing, or no provider is registered, the child SHALL run in `cwd`. The executor MUST NOT fall back to the parent's cwd for a launch that has `cwd`.

#### Scenario: Provider returns nothing
- **WHEN** the registered provider returns `undefined` for a launch with `cwd` `/w/u1`
- **THEN** the child runs in `/w/u1`

#### Scenario: cwd without a provider
- **WHEN** no provider is registered and an extension spawns with `cwd` `/repo/.worktrees/u1`
- **THEN** the child's working directory, its environment header and its context files are those of `/repo/.worktrees/u1`

### Requirement: Workspace provider sees the launch
`WorkspacePrepareContext` SHALL carry `requestedCwd` when the launch has `cwd`, and `metadata` when the launch has metadata, and MUST omit each otherwise. The provider SHALL decide: returning a workspace at `requestedCwd` honours it, returning another directory wraps it, and throwing refuses it, which fails the run as a provider error does today.

#### Scenario: Provider sees the request
- **WHEN** a provider is registered and an extension spawns with `cwd` `/w/u1` and `metadata` `{ "unit": "u1" }`
- **THEN** the provider's `prepare` receives `requestedCwd` `/w/u1` and `metadata` `{ "unit": "u1" }`

#### Scenario: Provider refuses
- **WHEN** the registered provider throws for a launch with `cwd` `/w/u1`
- **THEN** the run fails with the provider's error and no child session is created

### Requirement: Launch resource validation
`spawn()` SHALL throw synchronously, with no record, event or policy call, when a field has the wrong shape, a skill path or `cwd` is not absolute, `cwd` is not an existing directory, or a skill path is missing, loads no skill or loads with a warning. The message SHALL name the broken rule and the offending path or entry. The executor MUST NOT drop an invalid entry and launch with the rest.

#### Scenario: Wrong shape refused
- **WHEN** an extension spawns with `skills` `{ inherit: "no" }` or `excludeExtensionPackages` `[""]`
- **THEN** `spawn()` throws naming the field

#### Scenario: Missing skill path refused
- **WHEN** an extension spawns with `skills` `{ inherit: false, paths: ["/x/missing/SKILL.md"] }`
- **THEN** `spawn()` throws naming `/x/missing/SKILL.md`, and no record or event exists

#### Scenario: Relative cwd refused
- **WHEN** an extension spawns with `cwd` `worktrees/u1`
- **THEN** `spawn()` throws naming the rule that `cwd` must be absolute

#### Scenario: Missing cwd refused
- **WHEN** an extension spawns with `cwd` `/repo/.worktrees/gone`, which does not exist
- **THEN** `spawn()` throws naming `/repo/.worktrees/gone`, and the policy is not consulted

#### Scenario: Unparsable skill refused
- **WHEN** a skill path is a `SKILL.md` with no `description` in its frontmatter
- **THEN** `spawn()` throws naming that path

### Requirement: Launch resources are immutable
The executor SHALL keep its own frozen copy of the accepted launch resources. Changing the objects passed to `spawn()` afterwards MUST NOT change the child.

#### Scenario: Caller mutates paths after spawn
- **WHEN** an extension spawns with a `skills.paths` array and pushes another path onto it right after `spawn()` returns
- **THEN** the child loads only the paths present at the call

### Requirement: Launch resources are fresh-only
A launch that carries any launch resource, even at its default value, and resolves to `fork` after the fallback of "Fork without a parent session" MUST be refused, never downgraded. A launch of an agent with `inherit_skills: false` that resolves to `fork` MUST be refused from either door. A refusal SHALL leave no record, event, policy call or child session: `spawn()` throws it, and a `subagent` call returns it as its result.

#### Scenario: Caller fork with cwd
- **WHEN** the parent has a session branch, and an extension spawns with `context: "fork"` and `cwd` `/w/u1`
- **THEN** `spawn()` throws stating that launch resources apply to fresh launches only

#### Scenario: Default value still counts
- **WHEN** the parent has a session branch, and an extension spawns with `context: "fork"` and `contextFiles: true`
- **THEN** `spawn()` throws stating that launch resources apply to fresh launches only

#### Scenario: Locked fork with skills
- **WHEN** an agent locks `context: fork`, the parent has a session branch, and an extension spawns it with `skills` `{ inherit: false }`
- **THEN** `spawn()` throws, and no fork starts

#### Scenario: Agent fork falls back and keeps resources
- **WHEN** an agent declares `context: fork`, locked or not, the parent has no session branch, and an extension spawns it with `cwd` `/w/u1`
- **THEN** the launch runs `fresh` in `/w/u1` with `contextFallback` `no-parent-session`

#### Scenario: Pinned agent falls back
- **WHEN** an agent declares `context: fork` and `inherit_skills: false`, and the parent has no session branch
- **THEN** the launch runs `fresh` with no skills

#### Scenario: Pinned agent forked
- **WHEN** an agent declares `inherit_skills: false`, the parent has a session branch, and the model calls `subagent` for it with `context: "fork"`
- **THEN** the tool result is the refusal, and no child session exists

### Requirement: Run-start re-check
Immediately before the workspace provider is consulted, the executor SHALL check the launch resources again:
- `cwd` is still an existing directory;
- each skill file resolved at `spawn()` still exists and loads with no warning.

On failure the run SHALL fail with a message starting `Launch resources no longer valid:` and naming the path. No child session or workspace SHALL be created. The executor MUST NOT fall back to the parent's cwd or drop the skill.

#### Scenario: Worktree removed while queued
- **WHEN** a background launch with `cwd` `/w/u1` waits in the concurrency queue, and `/w/u1` is removed before it starts
- **THEN** the run fails with `Launch resources no longer valid:` naming `/w/u1`, and no child session is created

#### Scenario: Skill removed from a listed directory
- **WHEN** a launch lists directory `/x/skills`, which held `/x/skills/a/SKILL.md` at `spawn()`, and that file is removed while the launch is queued
- **THEN** the run fails naming `/x/skills/a/SKILL.md`

#### Scenario: Listed directory changes shape while queued
- **WHEN** a launch lists directory `/x/skills`, which held only `/x/skills/a/SKILL.md` at `spawn()`, and `/x/skills/SKILL.md` is added while the launch is queued
- **THEN** the child loads exactly the skill from `/x/skills/a/SKILL.md`

#### Scenario: Skill turned invalid while queued
- **WHEN** a listed `SKILL.md` loses its `description` while the launch is queued
- **THEN** the run fails naming that file

### Requirement: Launch policy cannot change launch resources
The launch policy MUST NOT change a launch's skills, excluded packages, cwd or context files. Any other key in its returned adjustment SHALL be ignored, as today. The tool names offered to the policy as grantable SHALL also leave out tools from the launch's own `excludeExtensionPackages`.

#### Scenario: Policy returns a cwd
- **WHEN** a policy returns `{ model: "fixture/fixture-fast", cwd: "/tmp" }` for a launch with `cwd` `/w/u1`
- **THEN** the child runs on `fixture-fast` in `/w/u1`

### Requirement: Effective resources on session-created
`subagents:child:session-created` SHALL carry `cwd`, the child's effective working directory, on every launch. For a launch with a launch resource or a pinned agent it SHALL also carry `inheritSkills` (effective), `skillPaths` (loaded skill files in order, before bind), `excludedExtensionPackages` (setting entries, then new launch entries) and `contextFiles` (`true` unless set `false`); otherwise it MUST omit them. All added fields SHALL be optional in the published types.

#### Scenario: Explicit skills are final
- **WHEN** a launch does not inherit, and an extension in the child adds a skill through `resources_discover`
- **THEN** `skillPaths` equals the file paths of the skills the child holds after binding

#### Scenario: Inherited skills before bind
- **WHEN** a launch inherits, and an extension in the child adds skill `/x/late/SKILL.md` through `resources_discover`
- **THEN** `skillPaths` does not contain `/x/late/SKILL.md`

#### Scenario: Effective values reported
- **WHEN** an extension spawns with `skills` `{ inherit: false, paths: ["/x/p/SKILL.md"] }`, `excludeExtensionPackages` `["npm:flow-pack"]`, `cwd` `/w/u1` and `contextFiles: false`, and `excludedExtensionPackages` is `["npm:noisy"]`
- **THEN** `session-created` carries `cwd` `/w/u1`, `inheritSkills` `false`, `skillPaths` `["/x/p/SKILL.md"]`, `excludedExtensionPackages` `["npm:noisy", "npm:flow-pack"]`, `contextFiles` `false` and `context` `fresh`

#### Scenario: Only cwd given
- **WHEN** an extension spawns with only `cwd` `/w/u1`, for an agent that is not pinned
- **THEN** `session-created` carries `cwd` `/w/u1`, `inheritSkills` `true`, `skillPaths` the catalog the child loaded, `excludedExtensionPackages` the setting's entries, and `contextFiles` `true`

#### Scenario: Plain launch
- **WHEN** a launch carries no launch resource and its agent is not pinned
- **THEN** `session-created` carries `cwd` and none of `inheritSkills`, `skillPaths`, `excludedExtensionPackages` or `contextFiles`
