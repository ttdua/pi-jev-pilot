## MODIFIED Requirements

### Requirement: Capabilities
`capabilities.tools` SHALL list the active tools in name order, at most 40, each as `{ name, summary }`. `summary` MUST be the first sentence of the description, at most 200 code points. `capabilities.subagents` SHALL list the agents the executor's `listAgentTypes()` returns (see `executor-agent-registry`), in name order, at most 30, each as `{ name, description, tools }`, with `description` cut to 200 code points. An agent's `model` and `thinking` MUST NOT be sent. Without the executor, or when `listAgentTypes()` throws, `capabilities.subagents` SHALL be empty and the main request is still sent.

#### Scenario: First sentence
- **WHEN** a tool's description is `Read a file. Supports images.`
- **THEN** its `summary` is `Read a file.`

#### Scenario: Caps
- **WHEN** 50 tools are active
- **THEN** `capabilities.tools` has the first 40 by name

#### Scenario: Agent caps
- **WHEN** 35 agents are available and one has a 300-code-point description
- **THEN** `capabilities.subagents` has the first 30 by name, and that description, if among them, has 200 code points


#### Scenario: No executor
- **WHEN** the executor is absent and a main prompt is decided
- **THEN** `capabilities.subagents` is empty and the main request is sent
