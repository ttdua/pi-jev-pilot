## MODIFIED Requirements

### Requirement: One context setting per launch
Every subagent launch SHALL resolve exactly one context: `fresh` or `fork`. Three inputs SHALL accept only these two values:
- the `subagent` tool parameter `context`;
- the agent frontmatter field `context`;
- the service `spawn` option `context`.

#### Scenario: Invalid value
- **WHEN** a caller passes `context: "twin"`
- **THEN** the tool call is rejected by its parameter schema and no child starts

#### Scenario: Invalid service value
- **WHEN** an extension calls `spawn("explore", brief, { context: "twin" })`
- **THEN** `spawn` throws an error naming `context` and no child starts

#### Scenario: Invalid frontmatter value
- **WHEN** an agent file declares `context: twin`
- **THEN** the agent loads with no declared context, and a warning names the file and `context`

### Requirement: Context resolution order
The context MUST resolve in this order:
1. an agent file that locks `context`;
2. the caller's value;
3. the agent file's value;
4. `fresh`.

The resolved context SHALL be carried on the launch request and the subagent record.

#### Scenario: Default is fresh
- **WHEN** a launch names no context and its agent file declares none
- **THEN** the launch runs `fresh`

#### Scenario: Caller wins over agent default
- **WHEN** an agent file declares `context: fork` without locking it and the caller passes `context: "fresh"`
- **THEN** the launch runs `fresh`

#### Scenario: Locked agent wins over caller
- **WHEN** an agent file declares `context: fork` and locks `context`, and the caller passes `context: "fresh"`
- **THEN** the launch runs `fork`

#### Scenario: Service option
- **WHEN** an extension calls `spawn("explore", brief, { context: "fork" })` from a session with history
- **THEN** the launch runs `fork`

### Requirement: Deprecated context fields
For one minor release, the executor SHALL accept the old fields:
- `inherit_context: true` (tool parameter or frontmatter) and service `inheritContext: true` SHALL mean `fork`; `false` SHALL mean `fresh`;
- `context` MUST win when both `context` and the old field are given;
- frontmatter `prompt_mode` SHALL be ignored.

A deprecated field given by the caller SHALL count as a caller value.

#### Scenario: Old tool parameter
- **WHEN** a caller passes `inherit_context: true` and no `context`
- **THEN** the launch runs `fork` and a deprecation warning naming `context` is emitted

#### Scenario: Both given
- **WHEN** a caller passes `context: "fresh"` and `inherit_context: true`
- **THEN** the launch runs `fresh`

#### Scenario: Old service option
- **WHEN** an extension calls `spawn("explore", brief, { inheritContext: false })`
- **THEN** the launch runs `fresh` and a deprecation warning naming `context` is emitted

#### Scenario: Old prompt mode ignored
- **WHEN** an agent file declares `prompt_mode: append` and no `context`
- **THEN** the agent loads, runs `fresh`, and a deprecation warning naming `prompt_mode` is emitted
