## 1. Agent pin `inherit_skills`

Blocked by: none

- [x] 1.1 `src/types.ts`: `AgentConfig` gains `inheritSkills?: false`. `src/config/custom-agents.ts`: parse frontmatter `inherit_skills`; only `false` pins, a non-boolean value writes a debug note (design D3)
- [x] 1.2 `src/seams/registry.ts` and `src/service/service.ts`: `AgentTypeSnapshot.inheritSkills?: false`, copied into the frozen snapshot only when declared
- [x] 1.3 Tests in `test/seams/registry.test.ts`: the "Pinned skills in the snapshot" scenario (executor-agent-registry delta), the non-boolean debug note, and the existing snapshot scenarios unchanged

## 2. Launch-resource validation seam

Blocked by: none

- [x] 2.1 Add the public types to `src/service/service.ts`: `LaunchSkills` and the `SpawnOptions` fields `skills`, `excludeExtensionPackages`, `cwd` and `contextFiles`
- [x] 2.2 Add `src/seams/launch-resources.ts`:
  - `parseLaunchResources(options, io)`, with D2 rules 1–4 in order: shape, absolute, cwd directory, then skill load through Pi's `loadSkills`, including the explicit-path collision refusal. It returns a frozen `LaunchResources` (`skills` as given, deduplicated `paths`, resolved `skillFiles`, `excludeExtensionPackages`, `cwd`, `contextFiles`), or `undefined` when no field is given.
  - `effectiveSkillChoice(resources, pinned)` (D3).
  - `assertFreshOnly({ resources, agentName, pinned, context })`: D2 rule 5.
  - `recheckLaunchResources(resources, io)`: checks that `cwd` is still a directory and reloads `skillFiles` (exist, no warning). On failure it throws `Launch resources no longer valid: <path>`.
  - The file-system and `loadSkills` access goes through a small IO object, so the tests stub it.
- [x] 2.3 Add `test/seams/launch-resources.test.ts`, covering the "Launch resource validation", "Launch resources are immutable", "Effective skill choice", "Skill name collisions refused" (explicit paths) and "Run-start re-check" scenarios of `specs/launch-resources`, plus the `assertFreshOnly` matrix. Use real temp dirs and real `SKILL.md` files for the load and re-check rules.

## 3. Carry resources to the child

Blocked by: 1, 2

- [x] 3.1 `src/service/service-adapter.ts`: in `spawn()`, call `parseLaunchResources` right after `parseLaunchMetadata`, then pass `resources` on the spawn config
- [x] 3.2 `src/lifecycle/subagent-manager.ts`:
  - forward `resources` to the execution;
  - call `assertFreshOnly` right after `resolveLaunchContext` in `create()`, so it judges the context after the fallback, from both doors, before the record exists (design D1, D3);
  - check that `src/tools/background-spawner.ts` and `src/tools/foreground-runner.ts` already return the throw as the tool result.
- [x] 3.3 `src/lifecycle/workspace.ts`: `WorkspacePrepareContext` gains `requestedCwd?` and `metadata?`.
- [x] 3.4 `src/lifecycle/subagent.ts`, in `run()`, before the provider (design D7):
  - run `recheckLaunchResources`; a failure goes through `this.fail(run, err)`;
  - pass `requestedCwd` and `metadata` to the provider;
  - resolve `cwd`: provider cwd, else `requestedCwd`, else the parent cwd;
  - pass `resources` to `createSubagentSession`;
  - keep the no-provider path free of added awaits.
- [x] 3.5 New `src/session/launch-skills.ts` holds the skill loader options, the catalog-collision check and the reported resource facts, with unit tests. `src/lifecycle/create-subagent-session.ts` only orchestrates:
  - `ResourceLoaderOptions` gains `noSkills`, `additionalSkillPaths` and `skillsOverride`;
  - `freshSetup` adds the D4 loader options from `params.resources`: `additionalSkillPaths` is the resolved `skillFiles`, the allowlist applies when the launch does not inherit, and an inheriting launch with explicit files gets a late-collision debug note;
  - after `loader.reload()`, fail the launch on a `collision` diagnostic whose loser is one of `skillFiles` (D4);
  - `createLoaderSettingsManager` takes the launch's extra exclusions.
- [x] 3.6 `src/index.ts`: build the loader settings view from `excludedExtensionPackages ∪ extra`, and write a debug note for each extra entry that matches no configured package (design D5).
- [x] 3.7 `src/seams/launch-gate.ts`: the launch facts carry the launch's excluded packages, and `buildLaunchRequest` receives the global list plus the launch's list (design D6).
- [x] 3.8 `src/lifecycle/child-lifecycle.ts` and `create-subagent-session.ts`: `ChildSessionCreatedEvent` gains `cwd` (always), plus `inheritSkills`, `skillPaths` (from `loader.getSkills()`), `excludedExtensionPackages` and `contextFiles`, only for a launch with resources or a pin (design D8).
- [x] 3.9 Add three suites:
  - `test/seams/launch-resources-flow.test.ts`: service and tool door → manager → `Subagent.run` → a recording factory (refusals, queue, provider, policy, timing);
  - `test/lifecycle/launch-resources-prompt.test.ts`: the real factory with the real `DefaultResourceLoader` and a loopback provider (prompt contents, `session-created`);
  - `test/seams/launch-resources-extensions.test.ts`: the real `index.ts` composition root with a local package fixture (extension exclusion).

  Together they cover:
  - skills: explicit only, none, catalog plus extra, duplicate path, pin over caller, pinned tool-call launch, a temp extension's `resources_discover` skill kept out of an explicit-only child (checked on the first provider request), and an explicit skill colliding with the catalog, a late-discovered skill colliding with an explicit one, and a listed directory gaining a root `SKILL.md` while queued;
  - extensions: exclusion keeps a temp package's `before_agent_start` marker out of one child, but not its sibling, and an unknown package gets a note;
  - context files: `contextFiles: false` against global and project `AGENTS.md` markers;
  - cwd: without a provider, provider sees the request, provider returns nothing, provider refuses;
  - run-start re-check: worktree removed, skill removed from a listed directory, and skill turned invalid, each while queued;
  - fresh-only after the fallback: an agent fork with no parent branch runs fresh and keeps its resources, a pinned agent in the same case runs fresh with no skills, and a pinned agent forked from the tool door with a branch is refused;
  - launch policy: returning `cwd` is ignored, and a launch-excluded package's tool is not offered;
  - `session-created`: effective values on a launch with resources, defaults when only `cwd` is given, and `cwd` only on a plain launch;
  - omitted fields keep today's child;
  - pinned fork from the tool door.
- [x] 3.10 Add a type-level check that the `subagent` tool schema and `ResumeOptions` have no resource fields. Then run `bun run test:executor` and fix any exact-payload test the new `cwd` field breaks.

## 4. Records, generated types and docs

Blocked by: 3

- [ ] 4.1 `packages/pi-subagents/VENDORED.md`: add rows for the new seam and test files and for every edited upstream file, each with a one-line reason
- [ ] 4.2 Regenerate `dist/public.d.ts` with `bun run --cwd packages/pi-subagents build:types`, then run `verify:public-types`
- [ ] 4.3 Update `packages/pi-subagents/README.md`:
  - the `spawn` contract: the four fields, fresh-only, refusals and the run-start re-check;
  - Events: the new `session-created` fields;
  - Worktree Isolation: `requestedCwd` and `metadata` for providers.
- [ ] 4.4 Update `packages/pi-subagents/docs/configuration.md`: the `inherit_skills` frontmatter row, and the per-launch `excludeExtensionPackages` next to "Excluding package extensions from children"
- [ ] 4.5 Update the seam names in `docs/architecture.md` (seams line) and `docs/decisions/0009-vendored-executor.md` (seam list) to cover per-launch resources
- [ ] 4.6 Run `bun run test`, `bun run test:executor`, `bun run lint`, `bun run typecheck` and the vendoring test; all must pass
