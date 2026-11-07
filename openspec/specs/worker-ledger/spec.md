# worker-ledger Specification

## Purpose
The one worker ledger line per launch, joined to the executor's outcome, with no prompt text.

## Requirements

### Requirement: One line per launch
Routing SHALL append at most one `worker` ledger line for each launch it routed, recorded as a miss, or left untouched, and none for a cancelled turn or when routing did not run. The line MUST be written once the launch's outcome is known, and never rewritten; a launch whose outcome never arrives, for example because Pi exits first, has no line.

#### Scenario: Routed launch recorded
- **WHEN** a routed worker completes
- **THEN** the ledger gains one `worker` line for it

#### Scenario: Not running means no line
- **WHEN** the `subagents` switch is off and a worker runs
- **THEN** the ledger gains no `worker` line

#### Scenario: Cancelled turn
- **WHEN** the turn is cancelled while the worker request is outstanding
- **THEN** the ledger gains no `worker` line

### Requirement: Outcome joined from the executor
The line's `status`, `durationMs`, `tokens` and `toolUses` SHALL come from the executor's `subagents:completed` or `subagents:failed` event, or `subagents:resumed` for a resumed launch, matched to the launch through the agent id in the `subagent` tool result. The match MUST work whichever of the tool result and the event arrives first. A launch whose tool result carries no agent id SHALL be written with `status` `error` when its tool result arrives.

#### Scenario: Foreground completion
- **WHEN** a foreground worker completes with 3 tool uses
- **THEN** its line has `status` `completed` and `toolUses` 3

#### Scenario: Background completion
- **WHEN** a background worker completes after its tool result was returned
- **THEN** its line is written on completion with `status` `completed`

#### Scenario: Failed worker
- **WHEN** a worker ends in error
- **THEN** its line has `status` `error`

#### Scenario: Refused launch
- **WHEN** the executor rejects a launch and the tool result has no agent id
- **THEN** a line with `status` `error` is written

### Requirement: Decision fields
The line SHALL carry:
- `mode`: the mode captured when the launch was classified (see `worker-routing`);
- `answered`, `ms` and `miss` from the worker request, with `answered` false and no `ms` or `miss` when no request was sent;
- `agent`, and `briefChars` (the code points of the brief);
- the raw `tierP`, `effortP` and `risky`;
- `score`, when the launch has a difficulty score; `rubric`, the rubric version, whenever the `tier` question was asked; and `expertOffered`, whether `expert` was among the offered tiers, whenever the `tier` question was asked;
- the route's recorded fields, where `tier` and `fallback` hold a tier or a `slot::<name>` target and `tierP` holds a key for every offered tier and slot that Jev returned;
- `toolsScored` and `toolsFlagged`, when that launch started a worker session whose tool assessment got an answer, omitted otherwise. A resumed launch starts no new session.

New lines MUST NOT carry `expertNeeded`. The line MUST NOT contain the brief, the description, tool names or tool arguments.

#### Scenario: Routed fields
- **WHEN** a launch is routed by rule `cut` to `balanced` with thinking `high`, with score 1.3, and the caller asked for `fixture/fixture-main`
- **THEN** the line has `tier` `balanced`, `reason` `cut`, `score` 1.3, `rubric` 2, `model` the `balanced` model, `effort` `high` and `callerModel` `fixture/fixture-main`

#### Scenario: Expert offered recorded
- **WHEN** all four tiers are offered and the launch is routed
- **THEN** the line has `expertOffered` true

#### Scenario: Expert switched off recorded
- **WHEN** the `expert` switch is off and the launch is routed
- **THEN** the line has `expertOffered` false

#### Scenario: Fallback recorded
- **WHEN** a launch cascades from `deep` to `balanced`
- **THEN** the line has `tier` `balanced` and `fallback` `deep`

#### Scenario: Nothing could run recorded
- **WHEN** rule `cut` decides `balanced` and no tier from `balanced` down can run
- **THEN** the line has `tier` `balanced`, `reason` `cut`, `fallback` `balanced`, and no `model` or `effort`

#### Scenario: Thinking-only recorded
- **WHEN** a forked launch with the setting `thinking` is asked and thinking `high` is written
- **THEN** the line has `answered` true, `reason` `untouched`, `effort` `high`, and no `tier`, `model`, `score` or `rubric`

#### Scenario: Miss recorded
- **WHEN** Jev times out for a launch
- **THEN** the line has `answered` false, `miss` `timeout`, `reason` `miss`, `rubric` 2, `expertOffered` as offered, and no `tier` or `score`

#### Scenario: Untouched recorded
- **WHEN** a resumed launch completes
- **THEN** the line has `reason` `untouched`, `answered` false, and no `tier`, `model`, `score` or `rubric`

#### Scenario: Tier asked, nothing decided
- **WHEN** tiers are offered, Jev answers `effort` but not `tier`, and no target is decided
- **THEN** the line has `reason` `untouched`, `rubric` 2, `expertOffered`, and no `tier` or `score`

#### Scenario: No expert needed field
- **WHEN** any new worker line is written
- **THEN** it has no `expertNeeded`

#### Scenario: Locked recorded
- **WHEN** a launch's agent locks `model`
- **THEN** the line has `locked` true and no `model`

#### Scenario: Not locked
- **WHEN** a launch's agent locks nothing
- **THEN** the line has no `locked` field

#### Scenario: No prompt text
- **WHEN** a launch with a brief containing a unique marker is recorded
- **THEN** no ledger file contains that marker

#### Scenario: Mode recorded
- **WHEN** a launch is classified while the mode is `budget`
- **THEN** its line has `mode` `budget`

#### Scenario: Tool counts recorded
- **WHEN** a launch's worker was assessed with 4 tools scored and 1 flagged
- **THEN** the line has `toolsScored` 4 and `toolsFlagged` 1

#### Scenario: No assessment, no counts
- **WHEN** a launch's worker got no tool assessment answer, because its agent declares `tools`, the `tools` switch is off, or the request failed
- **THEN** the line has no `toolsScored` and no `toolsFlagged`

#### Scenario: Resumed launch carries no counts
- **WHEN** a launch resumes a worker that was assessed earlier and completes
- **THEN** its line has no `toolsScored` and no `toolsFlagged`

#### Scenario: Slot decision recorded
- **WHEN** a launch is routed to slot `reviewer` with thinking `high`
- **THEN** the line has `tier` `slot::reviewer`, `reason` `slot`, `model` the slot's model, `effort` `high`, and `tierP` with a `slot::reviewer` key

#### Scenario: Slot fallback recorded
- **WHEN** a launch decided for slot `reviewer` falls back to `balanced`
- **THEN** the line has `tier` `balanced`, `reason` `slot` and `fallback` `slot::reviewer`, and it passes the ledger schema

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
