## ADDED Requirements

### Requirement: Cut-point window
In a main session, routing SHALL keep the cut-point window in memory. At every main `session_start` it MUST be loaded from the ledger with the window entry rules of `mode-cutpoints`. After that, each worker line this session builds and that passes ledger validation SHALL be added to it when eligible, whether or not the ledger write succeeded. A ledger that cannot be read MUST leave the window empty, so the seed applies, and MUST NOT block or fail any launch. The ledger MUST NOT be read on the launch path. Child sessions keep no window.

#### Scenario: Window loaded at session start
- **WHEN** the ledger holds 150 eligible worker lines and a main session starts
- **THEN** the window holds those 150 entries and the cut points are computed from them

#### Scenario: Window grows during the session
- **WHEN** the window holds 99 entries and a routed launch writes an eligible line
- **THEN** the window holds 100 entries, and the next launch uses computed cut points instead of the seed

#### Scenario: Unreadable ledger
- **WHEN** the ledger cannot be read at session start
- **THEN** the window is empty, launches use the seed, and routing otherwise works

#### Scenario: Write failure still counts
- **WHEN** an eligible line passes validation but the ledger write fails
- **THEN** the line is still added to the window

#### Scenario: No ledger read per launch
- **WHEN** three launches are routed in one session
- **THEN** the ledger is read only at session start

### Requirement: Cut points of a launch
Routing SHALL compute each launch's cut points once, from the window and the mode read for that launch, when its worker request is built. Sibling launches classified together at the end of one assistant message MUST use the window as it was at that moment. A launch classified at its own tool call MUST use the window as it is then. The decision and the ledger line MUST use those cut points even if the window changes before the launch runs.

#### Scenario: Siblings share a window state
- **WHEN** an assistant message ends with two `subagent` calls
- **THEN** both launches use cut points computed from the window as it was when the message ended

#### Scenario: Launch classified alone
- **WHEN** a codemode script calls `subagent` after an earlier launch of the session added a line to the window
- **THEN** that launch's cut points include the added line

## MODIFIED Requirements

### Requirement: Mode of a launch
Routing SHALL read the mode once per launch, when its worker request is built, and MUST use that same mode for the launch's cut points and its ledger line. A mode change after the request is built MUST NOT affect that launch. A launch left untouched or not asked SHALL record the mode read when it was classified.

#### Scenario: Premium launch end to end
- **WHEN** the mode is `premium`, all four tiers are configured, the window uses the seed (`premium` `expertMin` 2.12), and Jev answers `tier` with probabilities `deep` .9 and `balanced` .1, and `effort` `xhigh`
- **THEN** the request is the same as in `standard`, the child runs on `tiers.expert`, and the ledger line has `mode` `premium`, `reason` `expert` and a `score` of 2.275

#### Scenario: Mode changed between message end and launch
- **WHEN** a worker request is built in `standard`, then `state.json` is changed to `premium` before the `subagent` call runs
- **THEN** the decision uses the `standard` cut points and the ledger line has `mode` `standard`

#### Scenario: Jev down in premium
- **WHEN** the mode is `premium` and Jev does not answer
- **THEN** the launch keeps the caller's input, and the ledger line has `mode` `premium`, `reason` `miss` and no `score`
