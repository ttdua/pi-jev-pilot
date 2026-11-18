## 1. Executor: one loader and the six role agents

Blocked by: none

- [x] 1.1 `packages/pi-subagents/src/config/package-agents.ts` (new): reduced port of tintinweb `package-resources.ts` — manifest reader for `pi.subagents.agents` only, `listConfiguredPackages()` with project trust (`setProjectTrusted`, saved-trust seed), canonical containment for entries and for each agent file, fail-quiet (specs `package-agents`).
- [x] 1.2 `src/config/custom-agents.ts`: load built-in (executor manifest, `source: "builtin"`), package, global, project in order; case-insensitive replacement; frontmatter `name:`; per-file containment (spec `executor-agent-registry` "Agent sources and override").
- [x] 1.3 `src/config/agent-types.ts`, `src/types.ts`, `src/seams/registry.ts`, `src/service/service.ts`: remove `DEFAULT_AGENTS` seeding and the code fallback; `FALLBACK_AGENT = "general"`; `general-purpose` alias; `MissingFallbackAgentError`; `findAgentConfig` for display; `source` gains `"builtin" | "package"`; `isDefault` and `toolGuideline` removed.
- [x] 1.4 `src/lifecycle/subagent-manager.ts`, `src/tools/spawn-config.ts`: fallback to `general` with the note naming `general`; refuse with an error naming `general` when it is missing or disabled.
- [x] 1.5 `src/ui/display.ts` and presentation callers: display through `findAgentConfig`, falling back to the recorded type (spec "History display never needs the fallback").
- [x] 1.6 `src/tools/helpers.ts`: Default/Custom lists by effective source; guideline `- Use <name> for <description>` per enabled built-in (spec `builtin-role-agents` "Tool description lists effective agents").
- [x] 1.7 `src/index.ts`: seed saved trust at load; record `ctx.isProjectTrusted()` on `session_start`.
- [x] 1.8 `packages/pi-subagents/agents/{general,implementer,explore,scout,reviewer,verifier}.md` with the tool boundaries and flow-neutral bodies; `package.json` declares `pi.subagents.agents` and adds `agents` to `files` (spec `builtin-role-agents`).
- [x] 1.9 Delete `src/config/default-agents.ts`; update the executor tests and helpers listed in plan Task 1; add tests for every scenario in `package-agents`, `builtin-role-agents` and `executor-agent-registry`.
- [x] 1.10 `packages/pi-subagents/VENDORED.md` rows for every edited, added or deleted file; `NOTICE.md` credit for the tintinweb port (0.26.1, commit `9a1b37df`, MIT).

## 2. jev-pilot: source and samples

Blocked by: 1

- [x] 2.1 `src/policy/launch.ts` `AgentFacts.source` gains `package`; `src/host/platform/agents.ts` passes it (spec `agent-metadata`).
- [x] 2.2 Update the jev-pilot tests listed in plan Task 2 that name `Explore`, `Plan` or `general-purpose` as built-ins; add "Package source carried" and "Unknown thinking not set".

## 3. Docs, changelog and gates

Blocked by: 1, 2

- [ ] 3.1 Docs: `packages/pi-subagents/docs/configuration.md` (sources and order, manifest key, frontmatter `name:`, "role in the agent file, process and task in the launch"), `packages/pi-subagents/README.md`, `packages/pi-subagents/docs/comparison-with-upstream.md`, `docs/usage-guide.md`, `docs/configuration.md`, `docs/architecture.md`, `docs/glossary.md`, `docs/domain-model.md`, `docs/scenarios.md`, `README.md`.
- [ ] 3.2 `CHANGELOG.md` `[Unreleased]`: added role agents and package agents; removed `Plan`, `Explore`'s pinned model, TypeScript built-ins; `general-purpose` alias (#82, #87, #91).
- [ ] 3.3 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test`, `bun run test:executor`, `bun run --cwd packages/pi-subagents verify:public-types`.
