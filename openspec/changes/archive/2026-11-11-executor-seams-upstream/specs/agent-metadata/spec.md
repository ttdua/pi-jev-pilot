## ADDED Requirements

### Requirement: Agent facts from the executor
Agent facts SHALL be built by a pure function from the agent snapshot the executor supplies (see `executor-agent-registry`), never by reading agent files. The facts SHALL hold:
- `name`, `source` and `description` as in the snapshot;
- `instructionsExcerpt`: the first 500 Unicode code points of the trimmed `instructions`;
- `declaredTools`: the snapshot's `tools`, or `null`;
- `disallowedTools`;
- `maxTurns`, `runInBackground` and `inheritContext`;
- `sets`: whether `model` and `thinking` are set.

`thinking` counts as set only when it is one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

#### Scenario: Built-in Explore
- **WHEN** the snapshot is the built-in `Explore`
- **THEN** the facts have source `builtin`, description `Fast codebase exploration agent (read-only)`, declared tools `read`, `bash`, `grep`, `find`, `ls`, the first 500 code points of the built-in instructions as the excerpt, and no disallowed tools

#### Scenario: Long instructions
- **WHEN** the snapshot's `instructions` are 2000 characters long
- **THEN** the instructions excerpt is its first 500 characters

#### Scenario: Disallowed tools carried
- **WHEN** the snapshot's `disallowedTools` is `bash`
- **THEN** the facts' `disallowedTools` is `bash`

## MODIFIED Requirements

### Requirement: Model and thinking are never read out
The agent's declared `model` and `thinking` values MUST NOT be copied into the agent facts or into any Jev request. The facts SHALL record only whether each is set. The ledger's `effectiveModel` and `effectiveThinking` record what the child actually ran with, as reported by the executor (see `worker-ledger`); they are runtime facts, not agent facts, and are allowed even when they equal the agent's declared values.

#### Scenario: Model never read out
- **WHEN** the snapshot has `model` `anthropic/claude-opus` and `thinking` `high`
- **THEN** neither value appears anywhere in the facts, and both are recorded as set

#### Scenario: Invalid thinking is not set
- **WHEN** the snapshot's `thinking` is `banana`
- **THEN** thinking is recorded as not set

## REMOVED Requirements

### Requirement: Agent lookup order
**Reason**: The executor resolves agent names and exposes the result through `getAgentType`; jev-pilot no longer looks agents up itself.
**Migration**: Use the agent snapshot in the launch request (`executor-launch-policy`) or `getAgentType` (`executor-agent-registry`).

### Requirement: Case-insensitive agent match
**Reason**: Name resolution moved to the executor.
**Migration**: `executor-agent-registry` "Agent registry query".

### Requirement: Agent files are found by listing
**Reason**: jev-pilot no longer reads agent files.
**Migration**: None; the executor owns file discovery.

### Requirement: Lookup never throws
**Reason**: There is no file lookup left in jev-pilot. A failing registry call is handled where routing and assessment fail open.
**Migration**: `worker-routing` "Routing fails open".

### Requirement: Built-in agents
**Reason**: The built-in table duplicated the executor's and had to be checked by hand on upgrades.
**Migration**: Built-ins come from the executor's snapshot.

### Requirement: Agent identity fields
**Reason**: Identity fields are taken from the snapshot.
**Migration**: "Agent facts from the executor".

### Requirement: Declared tools
**Reason**: The executor parses `tools`.
**Migration**: The snapshot's `tools`.

### Requirement: Launch fields in the agent file
**Reason**: The executor parses these fields and reports the effective values in the launch request.
**Migration**: The launch request's `inheritContext` and `isBackground`.

### Requirement: Lock declaration
**Reason**: The executor parses `locked`.
**Migration**: The launch request's `locked`.

### Requirement: Locked fields
**Reason**: The executor reports which lockable fields are locked for each launch.
**Migration**: The launch request's `locked`.

### Requirement: Effective launch fields
**Reason**: The executor resolves effective launch fields before calling the policy, and a resumed launch never reaches the policy.
**Migration**: The launch request's `inheritContext`, `isBackground` and `requested`.
