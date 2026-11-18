## Why

The executor's built-in agents (`general-purpose`, `Explore`, `Plan`) do not match the roles delegation workflows use, and they are read-only by prompt only. `Explore` pins a model. The built-ins are TypeScript objects, not agent files, and installed pi packages cannot ship agents at all, so pi-superspec's agents never load here. Role agents serve several workflows, so their bodies must not carry any one flow's procedure (#82, #87, #91).

## What Changes

**Built-in agents**
- From: `general-purpose`, `Explore`, `Plan` as TypeScript objects in `DEFAULT_AGENTS`, with a code fallback agent.
- To: six markdown agents shipped in the executor package: `general`, `implementer`, `explore`, `scout`, `reviewer`, `verifier`. Each has a minimal `tools` allowlist and explicit `disallowed_tools`, and none sets `model` or `thinking`. `DEFAULT_AGENTS` and the code fallback are removed.
- Reason: one agent format and role-shaped tool boundaries.
- Impact: breaking for callers naming `Plan` (falls back to `general` with a note). `general-purpose` keeps working as an alias of `general`, and `Explore` keeps resolving case-insensitively to `explore`.

**Package agents**
- From: agents load only from `~/.pi/agent/agents` and `.pi/agents`.
- To: agents also load from installed pi packages that declare `"pi": { "subagents": { "agents": [...] } }`. The packages come from pi's configured package list. The executor declares its own built-ins the same way.
- Reason: packages such as pi-superspec ship agents.
- Impact: additive. Package agents rank below the user's global and project files.

**Resolution**
- From: case-sensitive override by file name; the fallback is `general-purpose`.
- To:
  - load order builtin < package < global < project;
  - names compared case-insensitively, taken from frontmatter `name:` or else the file name;
  - the fallback is `general`;
  - a missing `general` refuses the launch with an error.
- Reason: an override must replace an agent, not add a second one, and a missing built-in must not be hidden.
- Impact: a project file `Explore.md` now overrides `explore`, where before it added a second agent.

**Agent bodies**
- To: built-in bodies state only the role:
  - purpose and boundaries;
  - tool limits;
  - the `ask_parent` escalation rule;
  - a neutral report shape.
- They name no skill, slash command or workflow procedure, and set no `skills` field. A test enforces this.
- Reason: the caller supplies process and skills per launch.
- Impact: none for user files, which are not checked.

## Capabilities

### New Capabilities

- `package-agents`: discovery of agent files declared by installed pi packages through `pi.subagents.agents`, with path containment and project-trust rules.
- `builtin-role-agents`: the six built-in role agents, their tool boundaries, and their flow-neutral bodies.

### Modified Capabilities

- `executor-agent-registry`: agent sources and load order, case-insensitive override, frontmatter `name:`, fallback to `general` and its error, the `general-purpose` alias, the `package` snapshot source, and the built-in snapshot scenario.
- `agent-metadata`: the built-in snapshot scenario, and `source` gaining `package`.
- `executor-launch-identity`, `executor-launch-policy`, `worker-routing`, `subagent-context-mode`: scenarios that name `Explore` or `Plan` as sample built-ins now use roster names.

## Impact

- Vendored executor (`packages/pi-subagents/`):
  - new `agents/*.md` and a package-agent discovery module (ported from `tintinweb/pi-subagents` 0.26.1, MIT);
  - changes to `src/config/custom-agents.ts`, `agent-types.ts`, `types.ts`, `src/seams/registry.ts`, `src/tools/spawn-config.ts`, `src/tools/helpers.ts`, `src/lifecycle/subagent-manager.ts`, `src/service/service.ts`, `src/index.ts` and `package.json` (`pi.subagents.agents`, `files`);
  - `src/config/default-agents.ts` removed;
  - tests updated;
  - every edit listed in `VENDORED.md`.
- jev-pilot: `src/policy/launch.ts` (`AgentFacts.source` gains `package`), `src/host/platform/agents.ts`, and tests that name `Explore`, `Plan` or `general-purpose`.
- `NOTICE.md`: credit for the ported package-agent discovery.
- Docs: `docs/usage-guide.md`, `docs/configuration.md`, `docs/architecture.md`, `docs/glossary.md`, `docs/domain-model.md`, `docs/scenarios.md`, `README.md`, `packages/pi-subagents/README.md`, `packages/pi-subagents/docs/configuration.md` (add the split "role in the agent file, process and task in the launch"), `packages/pi-subagents/docs/comparison-with-upstream.md`, `CHANGELOG.md`.
