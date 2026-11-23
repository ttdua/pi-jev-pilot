## MODIFIED Requirements

### Requirement: Ledger value domains
Every ledger value SHALL belong to one of these domains, and a value outside its domain MUST be rejected:

| Domain | Rule |
|---|---|
| id | string matching `^[A-Za-z0-9._:-]{1,64}$` |
| agent | string matching `^[A-Za-z0-9._-]{1,64}$` |
| skill | string matching `^[a-z0-9][a-z0-9-]{0,63}$` |
| model | string matching `^[A-Za-z0-9._-]+/[^\s]+$`, at most 128 characters |
| caller model | string matching `^[A-Za-z0-9._:/-]{1,128}$` |
| target | one of `basic`, `broad`, `deep`, `frontier`, the legacy names `fast`, `balanced`, `expert` (accepted on read only), or `slot::` followed by a string matching `^[a-z][a-z0-9-]{0,23}$` |
| level | one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| mode | one of `budget`, `standard`, `premium` |
| probability | finite number from 0 to 1 |
| count | integer from 0 to 1000000000 |
| time | integer from 0 to 8640000000000000 |
| flag | boolean |
| effort distribution | object whose keys are some of `low`, `medium`, `high`, `xhigh`, `max`, each a probability |
| turns distribution | object whose keys are some of `short`, `medium`, `long`, `very_long`, each a probability |
| target distribution | object of at most 12 keys, each a target, each value a probability |
| score | finite number from 0 to 3.5 |
| rubric version | integer from 1 to 99 |

#### Scenario: NaN probability rejected
- **WHEN** an entry's `risky` is `NaN`
- **THEN** validation fails with an issue at `risky`

#### Scenario: Slot target accepted
- **WHEN** a worker entry's `tier` is `slot::reviewer` and `tierP` has the keys `broad` and `slot::reviewer`
- **THEN** validation passes

#### Scenario: Target distribution capped at 12
- **WHEN** a worker entry's `tierP` has 13 keys
- **THEN** validation fails with an issue at `tierP`

#### Scenario: Score out of range rejected
- **WHEN** a worker entry's `score` is 3.6
- **THEN** validation fails with an issue at `score`

#### Scenario: Fractional rubric rejected
- **WHEN** a worker entry's `rubric` is 2.5
- **THEN** validation fails with an issue at `rubric`

#### Scenario: Malformed target rejected
- **WHEN** a worker entry's `fallback` is `slot::Code Reviewer`
- **THEN** validation fails with an issue at `fallback`

#### Scenario: Unknown band rejected
- **WHEN** a worker entry's `turnsP` has the key `huge`
- **THEN** validation fails with an issue at `turnsP.huge`

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
| worker | `frontierOffered`, `expertOffered` | flag | |
| worker | `tier`, `fallback` | target | |
| worker | `model` | model | |
| worker | `effort` | level | |
| worker | `reason` | `frontier`, `cut`, `slot`, `expert`, `expert-admitted`, `risky`, `expert-denied`, `fast-unsure`, `choice`, `untouched` or `miss` | yes |
| worker | `callerModel` | caller model | |
| worker | `locked` | flag | |
| worker | `requestedTurns`, `turnFloor` | count | |
| worker | `turnsP` | turns distribution | |
| worker | `turnsUsed` | count | |
| worker | `turnPhase` | `within`, `warned` or `exhausted` | |
| worker | `toolsScored`, `toolsFlagged`, `toolsGranted`, `tokens`, `toolUses` | count | |
| worker | `effectiveModel` | model | |
| worker | `effectiveThinking` | level | |
| worker | `status` | `completed`, `aborted`, `stopped` or `error` | yes |
| correction | `turnId` | id | yes |
| correction | `corrects` | probability | yes |

Writers MUST emit only the names `basic`, `broad`, `deep` and `frontier` and the field `frontierOffered`; `expertOffered` and the legacy target names stay allowed so lines written before the rename still validate. The schema module MUST export the allowed field names per kind, so that tests can assert the exact field set. `toolsScored`, `toolsFlagged` and `toolsGranted` stay allowed so lines written before tool assessment was removed still validate; no writer emits them (see `worker-ledger`).

#### Scenario: Valid main line accepted
- **WHEN** a main entry with `v` 1, `at`, `session`, `mode` `standard`, `answered` true, `turnId`, `effortP`, `requested` `high`, `effective` `high` and `outcome` `ok` is validated
- **THEN** validation passes with no issues

#### Scenario: Valid worker line accepted
- **WHEN** a worker entry with the required common fields, `agent` `worker`, `briefChars` 812, `tier` `slot::reviewer`, `model` `anthropic/claude-sonnet-4-6`, `reason` `slot` and `status` `completed` is validated
- **THEN** validation passes with no issues

#### Scenario: Worker line with cut-point fields accepted
- **WHEN** a worker entry with the required fields has `reason` `cut`, `tier` `broad`, `score` 1.3, `rubric` 3 and `frontierOffered` true
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
- **WHEN** a worker entry with the required fields has `effectiveModel` `fixture/fixture-basic`, `effectiveThinking` `medium`, `toolsScored` 6, `toolsFlagged` 1 and `toolsGranted` 2
- **THEN** validation passes with no issues

#### Scenario: Bad effective thinking rejected
- **WHEN** a worker entry's `effectiveThinking` is `huge`
- **THEN** validation fails with an issue at `effectiveThinking`

#### Scenario: Worker line with turn fields accepted
- **WHEN** a worker entry with the required fields has `requestedTurns` 20, `turnsP` with the keys `short`, `medium`, `long` and `very_long`, and `turnFloor` 100
- **THEN** validation passes with no issues

#### Scenario: Worker line with turn use accepted
- **WHEN** a worker entry with the required fields has `turnsUsed` 37 and `turnPhase` `warned`
- **THEN** validation passes with no issues

#### Scenario: Bad turn phase rejected
- **WHEN** a worker entry's `turnPhase` is `paused`
- **THEN** validation fails with an issue at `turnPhase`
