## MODIFIED Requirements

### Requirement: Fresh child prompt
A `fresh` child's system prompt SHALL be the prompt Pi builds for the child's own session (its tools, its `APPEND_SYSTEM.md`, the project context files for the child's working directory unless the launch sets `contextFiles: false`, and the skills catalog it loads, which follows the launch's effective skill choice; see `launch-resources`), followed by one last section `<agent>…</agent>`. That section SHALL hold, in order, the `<active_agent name="<agent>"/>` tag, the environment header and the agent body.

#### Scenario: Project instructions present
- **WHEN** the child's working directory has an `AGENTS.md` with a unique marker, and the launch's `contextFiles` is omitted or `true`
- **THEN** the fresh child's system prompt contains that marker before the agent body

#### Scenario: Append file applied once
- **WHEN** the child's project has an `APPEND_SYSTEM.md` with a unique marker
- **THEN** the fresh child's system prompt contains that marker exactly once

#### Scenario: Agent body last
- **WHEN** a fresh child of an agent with body `BODY-MARKER` starts
- **THEN** the system prompt ends with the `<agent>` section, that section ends with `BODY-MARKER`, and it contains `<active_agent name="<agent>"/>` before the body

#### Scenario: Context files turned off
- **WHEN** the child's working directory has an `AGENTS.md` with a unique marker, and the launch sets `contextFiles: false`
- **THEN** the fresh child's system prompt does not contain that marker, and still ends with the `<agent>` section

#### Scenario: Explicit skills in the catalog
- **WHEN** the launch sets `skills` `{ inherit: false, paths: [<one skill file>] }`
- **THEN** the fresh child's skills catalog lists only that skill
