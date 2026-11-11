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
| worker | `score` | score | |
| worker | `rubric` | rubric version | |
| worker | `expertOffered` | flag | |
| worker | `tier`, `fallback` | target | |
| worker | `model` | model | |
| worker | `effort` | level | |
| worker | `reason` | `expert`, `cut`, `expert-admitted`, `risky`, `slot`, `expert-denied`, `fast-unsure`, `choice`, `untouched` or `miss` | yes |
| worker | `callerModel` | caller model | |
| worker | `locked` | flag | |
| worker | `toolsScored`, `toolsFlagged`, `toolsGranted`, `tokens`, `toolUses` | count | |
| worker | `effectiveModel` | model | |
| worker | `effectiveThinking` | level | |
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

#### Scenario: Worker line with cut-point fields accepted
- **WHEN** a worker entry with the required fields has `reason` `cut`, `tier` `balanced`, `score` 1.3, `rubric` 2 and `expertOffered` true
- **THEN** validation passes with no issues

#### Scenario: Older worker line still accepted
- **WHEN** a worker entry with the required fields has `reason` `choice`, `tier` `deep` and `expertNeeded` .2, and no `score` or `rubric`
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


#### Scenario: Worker line with effective launch fields accepted
- **WHEN** a worker entry with the required fields has `effectiveModel` `fixture/fixture-fast`, `effectiveThinking` `medium`, `toolsScored` 6, `toolsFlagged` 1 and `toolsGranted` 2
- **THEN** validation passes with no issues

#### Scenario: Bad effective thinking rejected
- **WHEN** a worker entry's `effectiveThinking` is `huge`
- **THEN** validation fails with an issue at `effectiveThinking`
