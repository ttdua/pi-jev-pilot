## MODIFIED Requirements

### Requirement: Review tool in the main session only
In a fresh child session, `jev_review` MUST be removed from the session's selected tools before the child's first provider request, whatever the CLI review setting. In a fork (see `subagent-context-mode`), `jev_review` SHALL stay declared when the parent declares it, so the fork's tool list stays the parent's, and every call to it MUST be refused. If it is called in any child session anyway, it MUST return an error result without running any process.

#### Scenario: Offered in the main session
- **WHEN** the CLI review is on, the package is loaded in a main session, and the first provider request is sent
- **THEN** the request's tools include `jev_review`

#### Scenario: Absent in a child session
- **WHEN** the CLI review is on and the executor starts a fresh child session with the package loaded
- **THEN** the child's first provider request has no tool named `jev_review`

#### Scenario: Refused in a child session
- **WHEN** `jev_review` executes with a session id the child registry holds
- **THEN** it returns an error result and runs no process

#### Scenario: Declared but refused in a fork
- **WHEN** the CLI review is on, the parent declares `jev_review`, and a fork of that parent calls `jev_review`
- **THEN** the fork's first provider request includes `jev_review`, the call is refused, and no process runs
