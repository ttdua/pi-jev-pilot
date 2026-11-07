## MODIFIED Requirements

### Requirement: Ledger line schema
Every ledger line SHALL be one JSON object whose fields are exactly those allowed for its `kind` below; any other key MUST be rejected as `unknown key`. Fields marked required MUST be present.

| Kind | Field | Domain | Required |
|---|---|---|---|
| all | `v` | the number `1` | yes |
| all | `at` | time | yes |
| all | `kind` | `main`, `worker` or `correction` | yes |
| all | `session` | id | yes |
| main, worker | `mode` | mode | yes |
| main, worker | `answered` | flag | yes |
| main, worker | `ms` | count | |
| main, worker | `miss` | `timeout`, `error` or `schema` | |
| main, worker | `effortP` | effort distribution | |
| main, worker | `risky` | probability | |
| main, worker | `durationMs` | count | |
| main | `turnId` | id | yes |
| main | `requested`, `effective`, `from` | level | |
| main | `held`, `advised` | flag | |
| main | `strategy` | `direct`, `delegate`, `parallel` or `graph` | |
| main | `strategyP`, `skillP`, `gate`, `corrects` | probability | |
| main | `skill` | skill | |
| main | `toolCalls`, `failures`, `inputTokens`, `outputTokens` | count | |
| main | `outcome` | `ok`, `error` or `aborted` | yes |
| worker | `agent` | agent | yes |
| worker | `briefChars` | count | yes |
| worker | `tierP` | target distribution | |
| worker | `expertNeeded` | probability | |
| worker | `tier`, `fallback` | target | |
| worker | `model` | model | |
| worker | `effort` | level | |
| worker | `reason` | `expert-admitted`, `risky`, `slot`, `expert-denied`, `fast-unsure`, `choice`, `untouched` or `miss` | yes |
| worker | `callerModel` | caller model | |
| worker | `locked` | flag | |
| worker | `toolsScored`, `toolsFlagged`, `tokens`, `toolUses` | count | |
| worker | `status` | `completed`, `aborted`, `stopped` or `error` | yes |
| correction | `turnId` | id | yes |
| correction | `corrects` | probability | yes |

The schema module MUST export the allowed field names per kind, so that tests can assert the exact field set.

#### Scenario: Valid main line accepted
- **WHEN** a main entry with `v` 1, `at`, `session`, `mode` `standard`, `answered` true, `turnId`, `effortP`, `requested` `high`, `effective` `high` and `outcome` `ok` is validated
- **THEN** validation passes with no issues

#### Scenario: Valid worker line accepted
- **WHEN** a worker entry with the required common fields, `agent` `worker`, `briefChars` 812, `tier` `slot::reviewer`, `model` `anthropic/claude-sonnet-4-6`, `reason` `slot` and `status` `completed` is validated
- **THEN** validation passes with no issues

#### Scenario: Valid correction line accepted
- **WHEN** a correction entry with `v` 1, `at`, `session`, `turnId` and `corrects` 0.82 is validated
- **THEN** validation passes with no issues

#### Scenario: Unknown kind rejected
- **WHEN** an entry has `kind` `tool`
- **THEN** validation fails with an issue at `kind`

#### Scenario: Field from another kind rejected
- **WHEN** a correction entry carries `agent`
- **THEN** validation fails with an issue at `agent` reading `unknown key`

#### Scenario: Missing required field rejected
- **WHEN** a main entry has no `outcome`
- **THEN** validation fails with an issue at `outcome`

#### Scenario: Exported field sets match the table
- **WHEN** the exported field names for `main`, `worker` and `correction` are compared with the table above
- **THEN** they are equal

#### Scenario: Unknown agent value is still an identifier
- **WHEN** a worker entry has `agent` `unknown`
- **THEN** validation passes, since the writer and not the schema is responsible for naming the agent

### Requirement: Worker decisions record their tier
A worker line whose `reason` is `expert-admitted`, `risky`, `slot`, `expert-denied`, `fast-unsure` or `choice` SHALL carry `tier`. A worker line whose `reason` is `untouched` or `miss` MAY omit it. The worker `reason` MUST be one of `expert-admitted`, `risky`, `slot`, `expert-denied`, `fast-unsure`, `choice`, `untouched` or `miss`; no value names a model.

#### Scenario: Deciding worker without a tier rejected
- **WHEN** a worker entry has `reason` `choice` and no `tier`
- **THEN** validation fails with an issue at `tier`

#### Scenario: Untouched worker without a tier accepted
- **WHEN** a worker entry has `reason` `untouched` and no `tier`
- **THEN** validation passes

#### Scenario: Expert admitted accepted
- **WHEN** a worker entry with the required fields has `reason` `expert-admitted` and `tier` `expert`
- **THEN** validation passes

#### Scenario: Old reason name rejected
- **WHEN** a worker entry has `reason` `fable`
- **THEN** validation fails with an issue at `reason`, and a read skips and counts that line like any invalid line
