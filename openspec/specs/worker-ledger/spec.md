# worker-ledger Specification

## Purpose
The one worker ledger line per launch, joined to the executor's outcome, with no prompt text.

## Requirements

### Requirement: One line per launch
Routing SHALL append at most one `worker` ledger line for each launch its policy routed, recorded as a miss, or left untouched, and none for a cancelled launch, for a resumed launch (which never reaches the policy), or when routing did not run. The line MUST be written once the launch's outcome is known, and never rewritten; a launch whose outcome never arrives, for example because Pi exits first, has no line.

#### Scenario: Routed launch recorded
- **WHEN** a routed worker completes
- **THEN** the ledger gains one `worker` line for it

#### Scenario: Not running means no line
- **WHEN** the `subagents` switch is off and a worker runs
- **THEN** the ledger gains no `worker` line

#### Scenario: Cancelled turn
- **WHEN** the turn is cancelled while the worker request is outstanding
- **THEN** the ledger gains no `worker` line


#### Scenario: Resume writes no line
- **WHEN** the main model resumes a routed worker and it completes
- **THEN** the ledger gains no `worker` line for the resume

### Requirement: Outcome joined from the executor
The line's `status`, `durationMs`, `tokens` and `toolUses` SHALL come from the executor's `subagents:completed` or `subagents:failed` event, matched to the launch by the `agentId` in its launch request. Its `effectiveModel` and `effectiveThinking` SHALL come from the `subagents:child:session-created` event with the same `agentId`, when that event carries them. A launch whose policy call ran but whose session was never created SHALL be written with `status` `error` when its `subagents:failed` event arrives, without `effectiveModel` or `effectiveThinking`. A launch the executor refuses before the policy runs (a disabled agent, an unknown model named by the caller) never reached routing and SHALL have no line.

#### Scenario: Foreground completion
- **WHEN** a foreground worker completes with 3 tool uses
- **THEN** its line has `status` `completed` and `toolUses` 3

#### Scenario: Background completion
- **WHEN** a background worker completes
- **THEN** its line is written on completion with `status` `completed`

#### Scenario: Failed worker
- **WHEN** a worker ends in error
- **THEN** its line has `status` `error`

#### Scenario: Refused launch
- **WHEN** a launch's policy call ran and its session creation then fails
- **THEN** a line with `status` `error` and no `effectiveModel` is written; a launch refused before its policy call has no line

#### Scenario: Effective values joined
- **WHEN** a worker's `session-created` event carries `effectiveModel` `fixture/fixture-deep` and `effectiveThinking` `high`, and the worker completes
- **THEN** its line has `effectiveModel` `fixture/fixture-deep` and `effectiveThinking` `high`

#### Scenario: Concurrent workers joined correctly
- **WHEN** two background workers of different agents complete in the reverse order of their launch
- **THEN** each line carries its own agent and its own outcome

#### Scenario: Service launch recorded
- **WHEN** an extension's `spawn()` launch is routed and completes
- **THEN** one `worker` line is written for it with its outcome

### Requirement: Caller model field
The line's `callerModel` SHALL hold the caller's `model` input when it is present and fits the ledger's rule, and MUST be omitted otherwise.

#### Scenario: Caller model outside the rule
- **WHEN** the caller's `model` input contains a space
- **THEN** the line has no `callerModel` and is otherwise written

#### Scenario: No caller model
- **WHEN** the caller sets no `model`
- **THEN** the line has no `callerModel`

### Requirement: Ledger failures do not affect the launch
A ledger line that fails validation or cannot be written SHALL be dropped without affecting the launch or its result.

#### Scenario: Agent name outside the ledger rule
- **WHEN** a launch uses an agent named `my agent!` and completes
- **THEN** the launch is routed normally and no line for it is written

### Requirement: Worker decision fields
The line SHALL carry the route fields: `score` when scored; `rubric` and `frontierOffered` whenever `tier` was asked, and never `expertOffered`; `tier` and `fallback` as a tier or `slot::<name>`; and `tierP` keyed by every offered target Jev returned. It SHALL also carry `effectiveModel` and `effectiveThinking` as joined from the executor.

#### Scenario: Routed fields
- **WHEN** a launch is routed by rule `cut` to `broad` with thinking `high`, with score 1.3, and the caller asked for `fixture/fixture-main`
- **THEN** the line has `tier` `broad`, `reason` `cut`, `score` 1.3, `rubric` 3, `model` the `broad` model, `effort` `high` and `callerModel` `fixture/fixture-main`

#### Scenario: Expert offered recorded
<!-- Intentional change: `expertOffered` is renamed `frontierOffered`. -->
- **WHEN** all four tiers are offered and the launch is routed
- **THEN** the line has `frontierOffered` true

#### Scenario: Expert switched off recorded
<!-- Intentional change: the `expert` switch is renamed `frontier`. -->
- **WHEN** the `frontier` switch is off and the launch is routed
- **THEN** the line has `frontierOffered` false

#### Scenario: Fallback recorded
- **WHEN** a launch cascades from `deep` to `broad`
- **THEN** the line has `tier` `broad` and `fallback` `deep`

#### Scenario: Nothing could run recorded
- **WHEN** rule `cut` decides `broad` and no tier from `broad` down can run
- **THEN** the line has `tier` `broad`, `reason` `cut`, `fallback` `broad`, and no `model` or `effort`

#### Scenario: Thinking-only recorded
- **WHEN** a forked launch with the setting `thinking` is asked and thinking `high` is written
- **THEN** the line has `answered` true, `reason` `untouched`, `effort` `high`, and no `tier`, `model`, `score` or `rubric`

#### Scenario: Untouched recorded
- **WHEN** a launch whose agent locks both `model` and `thinking` completes
- **THEN** the line has `reason` `untouched`, `answered` false, and no `tier`, `model`, `score` or `rubric`

#### Scenario: Tier asked, nothing decided
- **WHEN** tiers are offered, Jev answers `effort` but not `tier`, and no target is decided
- **THEN** the line has `reason` `untouched`, `rubric` 3, `frontierOffered`, and no `tier` or `score`

#### Scenario: Locked recorded
- **WHEN** a launch's agent locks `model`
- **THEN** the line has `locked` true and no `model`

#### Scenario: Not locked
- **WHEN** a launch's agent locks nothing and the launch is not a service launch naming a model
- **THEN** the line has no `locked` field

#### Scenario: Slot decision recorded
- **WHEN** a launch is routed to slot `reviewer` with thinking `high`
- **THEN** the line has `tier` `slot::reviewer`, `reason` `slot`, `model` the slot's model, `effort` `high`, and `tierP` with a `slot::reviewer` key

#### Scenario: Slot fallback recorded
- **WHEN** a launch decided for slot `reviewer` falls back to `broad`
- **THEN** the line has `tier` `broad`, `reason` `slot` and `fallback` `slot::reviewer`, and it passes the ledger schema

### Requirement: Worker request fields
The line SHALL carry `mode` (captured at classification, see `worker-routing`), `agent`, `briefChars` (the brief's code points), the raw `tierP`, `effortP` and `risky`, and `answered`, `ms` and `miss` from the worker request, with `answered` false and no `ms` or `miss` when no request was sent.

#### Scenario: Mode recorded
- **WHEN** a launch is classified while the mode is `budget`
- **THEN** its line has `mode` `budget`

#### Scenario: Miss recorded
- **WHEN** Jev times out for a launch
- **THEN** the line has `answered` false, `miss` `timeout`, `reason` `miss`, `rubric` 3, `frontierOffered` as offered, and no `tier` or `score`

### Requirement: Retired worker fields not written
New `worker` lines MUST NOT carry `expertNeeded`, `toolsScored`, `toolsFlagged` or `toolsGranted`.

#### Scenario: No expert needed field
- **WHEN** any new worker line is written
- **THEN** it has no `expertNeeded`

#### Scenario: No tool counts
- **WHEN** a routed launch completes, and when a launch resumes an earlier worker and completes
- **THEN** the routed launch's line has no `toolsScored`, `toolsFlagged` or `toolsGranted`, and no line is written for the resume

### Requirement: Worker line holds no text
The `worker` line MUST NOT contain the brief, the description, tool names or tool arguments.

#### Scenario: No prompt text
- **WHEN** a launch with a brief containing a unique marker is recorded
- **THEN** no ledger file contains that marker
