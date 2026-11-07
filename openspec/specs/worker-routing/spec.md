# worker-routing Specification

## Purpose
When and how a main session's `subagent` launches are classified and rewritten, which launches are left alone, the tier check and warning, and failing open.

## Requirements

### Requirement: When routing runs
Worker routing SHALL act only on `subagent` tool calls in a main session. It MUST do nothing, and call Jev for nothing, when the session is a child, `config.json` is invalid, the API key is unset, the executor is absent, or the `subagents` switch is off. These conditions SHALL be read fresh at each assistant message and at each launch classified at its own tool call.

#### Scenario: Switch off
- **WHEN** the `subagents` switch is off and the main model launches a worker
- **THEN** no worker request is sent and the launch input is unchanged

#### Scenario: No key
- **WHEN** the API key is unset and the main model launches a worker
- **THEN** no worker request is sent and the launch input is unchanged

#### Scenario: Invalid config
- **WHEN** `config.json` is invalid and the main model launches a worker
- **THEN** no worker request is sent and the launch input is unchanged

#### Scenario: Executor absent
- **WHEN** the executor is not installed and a `subagent` tool call is made
- **THEN** no worker request is sent and the input is unchanged

#### Scenario: Child session
- **WHEN** a child session's assistant message calls `subagent`
- **THEN** no worker request is sent

#### Scenario: Nested launch with the switch off
- **WHEN** the `subagents` switch is off and a codemode script calls `subagent`
- **THEN** no worker request is sent and the input is unchanged

#### Scenario: Other tools ignored
- **WHEN** an assistant message calls only `read` and `bash`
- **THEN** no worker request is sent

### Requirement: Sibling launches classified together
When an assistant message ends with one or more `subagent` calls, routing SHALL send one worker request per launch that is not left untouched, all concurrently, and wait for all of them before the message's tool calls run, bounded by the classifier timeout. Each result MUST be kept for the matching tool call by its id.

#### Scenario: Two launches
- **WHEN** an assistant message launches two workers
- **THEN** two worker requests are sent before either `subagent` call runs

#### Scenario: Untouched launch not asked
- **WHEN** an assistant message launches one worker with `resume` and one without
- **THEN** exactly one worker request is sent

### Requirement: Launches without a cached result
A `subagent` call with no result from its message, such as one issued by another tool (`parentToolCallId` set), SHALL be classified at its own tool call with a single worker request, bounded by the classifier timeout, before the launch runs.

#### Scenario: Nested launch
- **WHEN** a codemode script calls `subagent`
- **THEN** one worker request is sent for that call before it runs, and its input is routed like any other launch

#### Scenario: Nested launch with Jev down
- **WHEN** a codemode script calls `subagent` and Jev does not answer
- **THEN** the launch runs with the caller's input after at most `timeoutMs` of added wait

### Requirement: Worker request content
Each worker request SHALL use the agent read for the launch's `subagent_type`, the worker state from `input.prompt` and `input.description`, and the effective `run_in_background`. The display names for the `tier` criteria (see `worker-request`) MUST come from Pi's model registry. `parent_request` MUST be included only when `state.parentRequest` is on, from the latest user message. A thinking-only launch MUST ask only `effort` and `risky`.

#### Scenario: Display name prefix
- **WHEN** `tiers.fast` names a registry model whose display name is `Fixture Fast`
- **THEN** the `fast` criterion in the request starts with `Fixture Fast. `

#### Scenario: Parent request off
- **WHEN** `state.parentRequest` is off
- **THEN** the request state has no `parent_request`

#### Scenario: Forked launch with thinking asks fewer questions
- **WHEN** a launch inherits context and `subagents.forkedLaunch` is `thinking`
- **THEN** the request asks exactly `effort` and `risky`

### Requirement: Target check before writing
For a launch whose route can write a model (its request asks the `tier` question and `model` is not locked), routing SHALL check every offered tier's model: the `provider/id` MUST name a model in Pi's model registry, and that model MUST have configured credentials. A tier failing either check SHALL count as unable to run for the fallback choice. Other launches MUST NOT be checked or warned about.

#### Scenario: Unknown model
- **WHEN** `tiers.deep` names a model the registry does not know, and Jev decides `deep`
- **THEN** `deep` counts as unable to run and the launch cascades down

#### Scenario: Missing credentials
- **WHEN** `tiers.deep` names a registry model without configured credentials, and Jev decides `deep`
- **THEN** `deep` counts as unable to run

#### Scenario: Model-locked launch not checked
- **WHEN** the agent locks `model` and `tiers.deep` has no credentials
- **THEN** no warning is shown for that launch

### Requirement: Input mutation
Routing SHALL write the route's model to `input.model` and its thinking to `input.thinking`, replacing what the caller set, and MUST leave every other input field unchanged. A route that writes nothing MUST leave the input exactly as the caller sent it.

#### Scenario: Caller model replaced
- **WHEN** the caller set `model` `fixture/fixture-main` and the route writes `fixture/fixture-fast` with thinking `medium`
- **THEN** the child's first request uses `fixture-fast` with reasoning effort `medium`

#### Scenario: Background launch
- **WHEN** the same launch runs with `run_in_background` true
- **THEN** the child's first request uses the routed model and thinking

#### Scenario: Resume untouched
- **WHEN** a launch sets `resume`
- **THEN** the input is unchanged

### Requirement: Fallback warning
When the decided tier cannot run, routing SHALL warn through the UI, naming the tier, its model, why it cannot run (`not in the model registry` or `no credentials`), the tier used instead or that the launch is left unchanged, and the `tiers.<name>` setting to fix with the path of `config.json`. A warning for the same tier and model string MUST be shown at most once per session, until `/jev` runs or that tier's model string changes. No warning SHALL be drawn without a UI.

#### Scenario: Warning text
- **WHEN** `deep` has no credentials and the launch moves to `balanced`
- **THEN** one warning names `deep`, its model, `no credentials`, `balanced` and `tiers.deep`

#### Scenario: Once per tier
- **WHEN** three launches in one session each cascade from `deep`
- **THEN** the warning is shown once

#### Scenario: Nothing can run
- **WHEN** `balanced` is decided and neither `balanced` nor `fast` can run
- **THEN** one warning names `balanced` and says the launch is left unchanged

#### Scenario: Unknown model wording
- **WHEN** `tiers.deep` names a model the registry does not know and the launch cascades
- **THEN** the warning says `not in the model registry`

#### Scenario: Shown again after a model change
- **WHEN** a warning for `deep` was shown, `tiers.deep` is changed to another unusable model, and another launch cascades from `deep`
- **THEN** the warning is shown again

#### Scenario: No UI
- **WHEN** Pi runs without a UI and a launch cascades
- **THEN** no warning is drawn and the launch is still routed

#### Scenario: Shown again after /jev
- **WHEN** a warning for `deep` was shown, `/jev` runs, and another launch cascades from `deep`
- **THEN** the warning is shown again

### Requirement: Routing fails open
Any Jev failure (timeout, error, unreadable answers) SHALL leave the launch input unchanged. A cancelled turn MUST leave the input unchanged and record nothing. An error inside routing itself MUST be caught, leave the input unchanged, and never block or fail the launch.

#### Scenario: Jev timeout
- **WHEN** Jev does not answer within `timeoutMs`
- **THEN** the launch runs with the caller's input, after at most `timeoutMs` of added wait

#### Scenario: Jev error
- **WHEN** Jev answers HTTP 500
- **THEN** the launch runs with the caller's input

#### Scenario: Unreadable answers
- **WHEN** Jev answers a body without `answers`
- **THEN** the launch runs with the caller's input

#### Scenario: Turn cancelled
- **WHEN** the operator cancels the turn while a worker request is outstanding
- **THEN** the launch input is unchanged and no ledger line is recorded for it

#### Scenario: Internal error
- **WHEN** reading the agent throws inside routing
- **THEN** the launch runs with the caller's input and is not blocked

### Requirement: Mode of a launch
Routing SHALL read the mode once per launch, when its worker request is built, and MUST use that same mode for the request's questions, the tier decision and the launch's ledger line. A mode change after the request is built MUST NOT affect that launch. A launch left untouched or not asked SHALL record the mode read when it was classified.

#### Scenario: Premium launch end to end
- **WHEN** the mode is `premium`, all four tiers are configured, and Jev answers `tier` `deep` with `P(expert)` .3 and `effort` `xhigh`
- **THEN** the request carries the `premium` criteria, the child runs on `tiers.expert`, and the ledger line has `mode` `premium` and `reason` `expert-admitted`

#### Scenario: Mode changed between message end and launch
- **WHEN** a worker request is built in `standard`, then `state.json` is changed to `premium` before the `subagent` call runs
- **THEN** the decision uses the `standard` gate and the ledger line has `mode` `standard`

#### Scenario: Jev down in premium
- **WHEN** the mode is `premium` and Jev does not answer
- **THEN** the launch keeps the caller's input, and the ledger line has `mode` `premium` and `reason` `miss`
