# builtin-role-agents Specification

## Purpose
The executor ships six markdown role agents (`general`, `implementer`, `explore`, `scout`, `reviewer`, `verifier`) with minimal tool boundaries and flow-neutral bodies; process and task come from the caller's launch.

## Requirements

### Requirement: Built-in agents are markdown files
The executor's built-in agents SHALL be markdown agent files in the executor package, declared by the executor's own `package.json` under `pi.subagents.agents` and loaded with `source` `builtin` through the same parser as every other agent file. The executor MUST NOT define any agent in code. The packed executor MUST include every built-in agent file.

#### Scenario: Built-ins listed
- **WHEN** no other agent file exists and `listAgentTypes()` is called
- **THEN** it returns exactly `general`, `implementer`, `explore`, `scout`, `reviewer` and `verifier`, each with `source` `builtin`

#### Scenario: Built-ins packed
- **WHEN** the executor package is packed
- **THEN** the packed file list contains `agents/general.md`, `agents/implementer.md`, `agents/explore.md`, `agents/scout.md`, `agents/reviewer.md` and `agents/verifier.md`

### Requirement: Role agent tool boundaries
Each built-in role agent SHALL declare the `tools` and `disallowed_tools` below, and none SHALL set `model`, `thinking` or `locked`. `general` declares no tools and denies none. `implementer` declares `read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`. `explore`, `scout` and `reviewer` declare `read`, `grep`, `find`, `ls` and deny `bash`, `edit`, `write`. `verifier` declares `read`, `grep`, `find`, `ls`, `bash` and denies `edit`, `write`.

#### Scenario: Implementer writes
- **WHEN** `getAgentType("implementer")` is called with no override file
- **THEN** the snapshot has `tools` `read`, `grep`, `find`, `ls`, `bash`, `edit`, `write` and an empty `disallowedTools`

#### Scenario: Scout and reviewer are read-only
- **WHEN** `getAgentType("scout")` and `getAgentType("reviewer")` are called with no override file
- **THEN** each snapshot has `tools` `read`, `grep`, `find`, `ls` and `disallowedTools` `bash`, `edit`, `write`

#### Scenario: Read-only explore
- **WHEN** `getAgentType("explore")` is called with no override file
- **THEN** the snapshot has `tools` `read`, `grep`, `find`, `ls`, `disallowedTools` `bash`, `edit`, `write`, and no `model` or `thinking`

#### Scenario: Verifier cannot edit (fresh)
- **WHEN** the `verifier` agent is launched `fresh` with no tool override
- **THEN** the child's first provider request offers `bash` and neither `edit` nor `write`

#### Scenario: Verifier fork refuses edits
- **WHEN** the `verifier` agent is launched as a `fork` from a parent that has `edit` and `write`
- **THEN** the child declares the parent's tools, and a call to `edit` or `write` returns `Tool "<name>" is not available to this subagent.` without changing any file

#### Scenario: General keeps the defaults
- **WHEN** `getAgentType("general")` is called with no override file
- **THEN** the snapshot has `tools` `null`, `defaultTools` the seven built-ins and an empty `disallowedTools`

### Requirement: Tool description lists effective agents
The `subagent` tool description SHALL list agents after overrides: under "Default agents" each enabled agent whose effective `source` is `builtin`, and under "Custom agents" every other enabled agent, each as `- <name>: <description>`. Its guidelines SHALL hold one line `- Use <name> for <description>` for each enabled built-in, in the order of the built-in list. A disabled or overridden built-in MUST NOT keep a built-in line.

#### Scenario: Built-in guidelines
- **WHEN** no override file exists
- **THEN** the guidelines hold one line per built-in, each starting `- Use <name> for`

#### Scenario: Package override moves the agent
- **WHEN** a configured package defines `reviewer`
- **THEN** `reviewer` appears under "Custom agents" with the package's description and has no built-in guideline line

#### Scenario: Disabled built-in dropped
- **WHEN** `.pi/agents/scout.md` has `enabled: false`
- **THEN** `scout` appears in neither list and has no guideline line

### Requirement: Role bodies are flow-neutral
Each built-in agent body SHALL state only its role: purpose and boundaries, tool limits, the rule to call `ask_parent` when something outside its tools or scope is needed, and a report shape. A built-in agent file MUST NOT name a skill, a slash command or a workflow procedure, and MUST NOT set a `skills` frontmatter field. The process and the task SHALL come from the caller's launch. User and project override files are not checked.

#### Scenario: Body scan
- **WHEN** the built-in agent files are scanned
- **THEN** none contains `skill:`, a slash command such as `/opsx-apply`, a `skills` frontmatter key, or any name from the known skill list (for example `test-driven-development`, `verification-before-completion`, `brainstorming`)

#### Scenario: Escalation stated
- **WHEN** each built-in body is read
- **THEN** it names `ask_parent` as the way to get anything outside the agent's tools or scope

#### Scenario: Override file not checked
- **WHEN** `~/.pi/agent/agents/implementer.md` names `test-driven-development`
- **THEN** it loads and replaces the built-in `implementer` without a warning
