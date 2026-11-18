## MODIFIED Requirements

### Requirement: Agent snapshot fields
Each snapshot SHALL be a frozen, plain serializable object, never a live executor object, holding:
- `name`, and `source`, one of `builtin`, `global` or `project`;
- `description`, and `instructions`, the agent file's body;
- `tools`: the list the agent declares, or `null` when it declares no `tools` field, even though the executor then gives it the default tools;
- `defaultTools`: the tools the executor gives the agent when it declares none;
- `disallowedTools`;
- `model` and `thinking` as declared, or absent;
- `locked`: `true`, a list of lockable fields, or absent;
- `maxTurns`, `runInBackground` and `context` (`fresh` or `fork`) as declared, or absent. A deprecated `inherit_context` declaration SHALL appear as `context`, and the snapshot MUST NOT carry `inheritContext`.

Changing a returned snapshot MUST NOT change the executor's state.

#### Scenario: Built-in Explore
- **WHEN** no file defines `Explore` and `getAgentType("Explore")` is called
- **THEN** the snapshot has `source` `builtin`, `tools` `read`, `bash`, `grep`, `find`, `ls`, an empty `disallowedTools`, no `locked`, no `context`, and `instructions` the executor's built-in prompt for `Explore`

#### Scenario: Snapshot is detached
- **WHEN** a caller tries to push a tool name onto a returned snapshot's `tools`
- **THEN** the push fails or has no effect, and a later `getAgentType` for the same agent returns the original list

#### Scenario: Absent tools kept distinct from defaults
- **WHEN** an agent file has no `tools` field
- **THEN** its snapshot has `tools` `null` and `defaultTools` the seven built-ins

#### Scenario: Deprecated inherit_context declared
- **WHEN** an agent file declares `inherit_context: true`
- **THEN** its snapshot has `context` `fork` and no `inheritContext`

### Requirement: Disallowed tools in agent files
An agent file SHALL accept `disallowed_tools` in its frontmatter, in the same forms as `tools`: a YAML list or a comma-separated string. The executor SHALL remove every named tool from the child's tool set after all other sources (declared or default tools, launch policy grants) are applied. A tool named in both `tools` and `disallowed_tools` MUST be absent from the child, and the executor SHALL write a debug note naming the agent and the tool. For a fork (see `subagent-context-mode`), "removed" and "absent" mean refused when called: the tool stays declared and is not callable.

#### Scenario: Default tool denied
- **WHEN** an agent declares no `tools` and `disallowed_tools: bash`, and is launched fresh
- **THEN** the child's first provider request offers the default tools without `bash`

#### Scenario: Denied wins over declared
- **WHEN** an agent declares `tools: read, edit` and `disallowed_tools: [edit]`, and is launched fresh
- **THEN** the child offers `read` and not `edit`

#### Scenario: Denied wins over a grant
- **WHEN** an agent declares `disallowed_tools: web_search`, the launch policy adds `web_search`, and the launch is fresh
- **THEN** the child does not offer `web_search`

#### Scenario: Snapshot lists denied tools
- **WHEN** an agent declares `disallowed_tools: "bash, edit"`
- **THEN** its snapshot's `disallowedTools` is `bash`, `edit`

#### Scenario: Denied in a fork
- **WHEN** an agent declares `disallowed_tools: bash` and is forked from a parent with `bash`
- **THEN** the fork offers `bash`, and a call to `bash` is refused
