# executor-agent-registry Specification

## Purpose
The executor exposes the agent definitions it resolves as frozen snapshots and enforces `disallowed_tools` from agent frontmatter.

## Requirements

### Requirement: Agent registry query
`SubagentsService` SHALL offer `listAgentTypes()` and `getAgentType(name)`. Each SHALL reload agent files first, as a `subagent` tool call does, and return snapshots of agent definitions as the executor resolves them for a launch. `listAgentTypes()` SHALL return every enabled agent type, built-in and file-defined, after file overrides. `getAgentType(name)` SHALL resolve `name` exactly as a launch would: exact name, then case-insensitive match, then `general-purpose`. For a name that resolves to a disabled agent it SHALL return nothing, since a launch of it is refused.

#### Scenario: Project file overrides a built-in
- **WHEN** `.pi/agents/Explore.md` exists and `getAgentType("Explore")` is called
- **THEN** the snapshot has `source` `project` and the file's description

#### Scenario: Case-insensitive name
- **WHEN** the only agent file is `.pi/agents/Worker.md` and `getAgentType("worker")` is called
- **THEN** the snapshot's `name` is `Worker`

#### Scenario: Unknown name
- **WHEN** `getAgentType("does-not-exist")` is called
- **THEN** the snapshot is the built-in `general-purpose`

#### Scenario: Disabled agent
- **WHEN** `.pi/agents/worker.md` has `enabled: false` and `getAgentType("worker")` is called
- **THEN** nothing is returned, and `listAgentTypes()` omits `worker`

#### Scenario: New file picked up
- **WHEN** an agent file is added after the session started and `listAgentTypes()` is called
- **THEN** the result includes the new agent

### Requirement: Agent snapshot fields
Each snapshot SHALL be a frozen, plain serializable object, never a live executor object, holding:
- `name`, and `source`, one of `builtin`, `global` or `project`;
- `description`, and `instructions`, the agent file's body;
- `tools`: the list the agent declares, or `null` when it declares no `tools` field, even though the executor then gives it the default tools;
- `defaultTools`: the tools the executor gives the agent when it declares none;
- `disallowedTools`;
- `model` and `thinking` as declared, or absent;
- `locked`: `true`, a list of lockable fields, or absent;
- `maxTurns`, `runInBackground` and `inheritContext` as declared, or absent.

Changing a returned snapshot MUST NOT change the executor's state.

#### Scenario: Built-in Explore
- **WHEN** no file defines `Explore` and `getAgentType("Explore")` is called
- **THEN** the snapshot has `source` `builtin`, `tools` `read`, `bash`, `grep`, `find`, `ls`, an empty `disallowedTools`, no `locked`, and `instructions` the executor's built-in prompt for `Explore`

#### Scenario: Snapshot is detached
- **WHEN** a caller tries to push a tool name onto a returned snapshot's `tools`
- **THEN** the push fails or has no effect, and a later `getAgentType` for the same agent returns the original list

#### Scenario: Absent tools kept distinct from defaults
- **WHEN** an agent file has no `tools` field
- **THEN** its snapshot has `tools` `null` and `defaultTools` the seven built-ins

### Requirement: Disallowed tools in agent files
An agent file SHALL accept `disallowed_tools` in its frontmatter, in the same forms as `tools`: a YAML list or a comma-separated string. The executor SHALL remove every named tool from the child's tool set after all other sources (declared or default tools, launch policy grants) are applied. A tool named in both `tools` and `disallowed_tools` MUST be absent from the child, and the executor SHALL write a debug note naming the agent and the tool.

#### Scenario: Default tool denied
- **WHEN** an agent declares no `tools` and `disallowed_tools: bash`
- **THEN** the child's first provider request offers the default tools without `bash`

#### Scenario: Denied wins over declared
- **WHEN** an agent declares `tools: read, edit` and `disallowed_tools: [edit]`
- **THEN** the child offers `read` and not `edit`

#### Scenario: Denied wins over a grant
- **WHEN** an agent declares `disallowed_tools: web_search` and the launch policy adds `web_search`
- **THEN** the child does not offer `web_search`

#### Scenario: Snapshot lists denied tools
- **WHEN** an agent declares `disallowed_tools: "bash, edit"`
- **THEN** its snapshot's `disallowedTools` is `bash`, `edit`
