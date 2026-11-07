# decision-ledger Specification

## Purpose
`ledger.jsonl` records one line per main or worker decision and its outcome, with a strict schema that holds no free text, lock-free appends that several Pi processes share without losing a line, retention of at least the latest 2000 lines across two rotating files, and tolerant reads.

## Requirements

### Requirement: Ledger value domains
Every ledger value SHALL belong to one of these domains, and a value outside its domain MUST be rejected:

| Domain | Rule |
|---|---|
| id | string matching `^[A-Za-z0-9._:-]{1,64}$` |
| agent | string matching `^[A-Za-z0-9._-]{1,64}$` |
| skill | string matching `^[a-z0-9][a-z0-9-]{0,63}$` |
| model | string matching `^[A-Za-z0-9._-]+/[^\s]+$`, at most 128 characters |
| caller model | string matching `^[A-Za-z0-9._:/-]{1,128}$` |
| target | one of `fast`, `balanced`, `deep`, `expert`, or `slot::` followed by a string matching `^[a-z][a-z0-9-]{0,23}$` |
| level | one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| mode | one of `budget`, `standard`, `premium` |
| probability | finite number from 0 to 1 |
| count | integer from 0 to 1000000000 |
| time | integer from 0 to 8640000000000000 |
| flag | boolean |
| effort distribution | object whose keys are some of `low`, `medium`, `high`, `xhigh`, `max`, each a probability |
| target distribution | object of at most 12 keys, each a target, each value a probability |
| score | finite number from 0 to 3.5 |
| rubric version | integer from 1 to 99 |

#### Scenario: NaN probability rejected
- **WHEN** an entry's `risky` is `NaN`
- **THEN** validation fails with an issue at `risky`

#### Scenario: Slot target accepted
- **WHEN** a worker entry's `tier` is `slot::reviewer` and `tierP` has the keys `balanced` and `slot::reviewer`
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

### Requirement: Worker decisions record their tier
A worker line whose `reason` is `expert`, `cut`, `expert-admitted`, `risky`, `slot`, `expert-denied`, `fast-unsure` or `choice` SHALL carry `tier`. A worker line whose `reason` is `untouched` or `miss` MAY omit it. The worker `reason` MUST be one of `expert`, `cut`, `expert-admitted`, `risky`, `slot`, `expert-denied`, `fast-unsure`, `choice`, `untouched` or `miss`; no value names a model. The names `expert-admitted`, `expert-denied`, `fast-unsure` and `choice` are accepted so that older lines stay valid; the package MUST NOT write them.

#### Scenario: Deciding worker without a tier rejected
- **WHEN** a worker entry has `reason` `cut` and no `tier`
- **THEN** validation fails with an issue at `tier`

#### Scenario: Retired reason without a tier rejected
- **WHEN** a worker entry has `reason` `choice` and no `tier`
- **THEN** validation fails with an issue at `tier`

#### Scenario: Untouched worker without a tier accepted
- **WHEN** a worker entry has `reason` `untouched` and no `tier`
- **THEN** validation passes

#### Scenario: Expert accepted
- **WHEN** a worker entry with the required fields has `reason` `expert` and `tier` `expert`
- **THEN** validation passes

#### Scenario: Expert admitted accepted
- **WHEN** a worker entry with the required fields has `reason` `expert-admitted` and `tier` `expert`
- **THEN** validation passes

#### Scenario: Old reason name rejected
- **WHEN** a worker entry has `reason` `fable`
- **THEN** validation fails with an issue at `reason`, and a read skips and counts that line like any invalid line

### Requirement: Misses are unanswered
A main or worker line that carries `miss` SHALL have `answered` `false`.

#### Scenario: Miss with an answer rejected
- **WHEN** a main entry has `answered` true and `miss` `timeout`
- **THEN** validation fails with an issue at `miss`

### Requirement: Ledger rejects free text
The schema SHALL reject any key not defined for the line's kind, any value outside its domain, any entry that is not a plain object, and any line whose serialized form exceeds 4096 bytes. A rejected entry MUST NOT be written and MUST NOT be truncated to fit, and its issues MUST name the field path without including the value.

#### Scenario: Long text field rejected
- **WHEN** a worker entry's `agent` is a 300-character sentence containing spaces
- **THEN** the append returns an issue at `agent`, the issue message does not contain the sentence, and the ledger files are unchanged

#### Scenario: Prompt field rejected
- **WHEN** a main entry has an extra key `prompt` holding text
- **THEN** the append returns an issue at `prompt` reading `unknown key`, and nothing is written

#### Scenario: Probability out of range rejected
- **WHEN** `effortP.high` is 1.2
- **THEN** validation fails with an issue at `effortP.high`

#### Scenario: Widest valid entry fits
- **WHEN** a main entry and a worker entry carry every allowed field at its longest valid value
- **THEN** each serializes to at most 4096 bytes, so the size limit never rejects a valid entry

#### Scenario: Oversized line rejected
- **WHEN** a line in `ledger.jsonl` is longer than 4096 bytes
- **THEN** a read skips it and counts it, even if its fields are otherwise valid

#### Scenario: Non-object entry rejected
- **WHEN** the entry is `null`, a string or an array
- **THEN** the append returns an issue at `""` and nothing is written

### Requirement: Append writes one whole line
Appending a valid entry SHALL write its JSON followed by `\n` to `ledger.jsonl` in a single write opened in append mode, creating the jev directory and the file if needed. A write shorter than the line MUST be reported as a failure. Lines from earlier appends MUST be kept unchanged, the append MUST NOT take a lock, and it MUST NOT leave a temporary file.

#### Scenario: Lines accumulate in order
- **WHEN** three valid entries are appended one after another
- **THEN** `ledger.jsonl` holds three lines, each parsing to the matching entry, in append order, and the jev directory holds no temporary file

#### Scenario: First append creates the file
- **WHEN** the jev directory does not exist and a valid entry is appended
- **THEN** the directory exists with mode `0700`, `ledger.jsonl` exists with mode `0600`, and it holds one line

### Requirement: Ledger retention by two segments
Once `ledger.jsonl` holds 2000 or more lines after an append, the writer SHALL rename it over `ledger.1.jsonl`, so the next append starts a new `ledger.jsonl`. A rotation failure MUST NOT fail the append.

#### Scenario: Rotation at 2000 lines
- **WHEN** 2000 entries are appended to an empty ledger
- **THEN** `ledger.1.jsonl` holds those 2000 lines, `ledger.jsonl` does not exist or is empty, and `ledger.rotate.lock` does not exist

#### Scenario: Oldest segment dropped
- **WHEN** 4500 entries are appended to an empty ledger
- **THEN** the files hold, together, exactly the latest 2500 entries, and reading returns the latest 2000

#### Scenario: Failed rotation keeps the append
- **WHEN** the rename fails because `ledger.1.jsonl` is a non-empty directory, and an append brings `ledger.jsonl` to 2000 lines
- **THEN** the append succeeds, its line is in `ledger.jsonl`, and the lock is removed

### Requirement: One rotator at a time
A writer SHALL rotate only while holding `ledger.rotate.lock`, created exclusively, and MUST remove it afterwards. It MUST count the lines of `ledger.jsonl` again while holding the lock, and rename nothing if the count is now below 2000. A lock younger than 60 seconds MUST make the writer skip rotation for that append. An older lock MUST be cleared, and rotation is skipped for that append.

#### Scenario: Another process rotated first
- **WHEN** the writer takes the lock after seeing 2000 lines, but `ledger.jsonl` was renamed meanwhile and the new one holds 3 lines
- **THEN** no rename happens and `ledger.1.jsonl` is unchanged

#### Scenario: Held lock skips rotation
- **WHEN** `ledger.rotate.lock` exists and is fresh, and an append brings `ledger.jsonl` to 2000 lines
- **THEN** the append succeeds, no rename happens, and the lock is left in place

#### Scenario: Stale lock cleared
- **WHEN** `ledger.rotate.lock` is older than 60 seconds and an append brings `ledger.jsonl` to 2000 lines
- **THEN** the append succeeds and the stale lock is removed, and a following append rotates

### Requirement: Concurrent writers lose no line
Several processes appending to the same ledger at the same time, including across a rotation, SHALL lose no line, keep each process's lines in that process's order, and MUST NOT interleave bytes of two lines.

#### Scenario: Parallel processes, no rotation
- **WHEN** 8 separate processes each append 200 distinct entries to the same empty ledger at the same time
- **THEN** the two files hold, together, 1600 valid lines, and each process's 200 entries appear in that process's order

#### Scenario: Parallel processes across a rotation
- **WHEN** 8 separate processes each append 200 distinct entries at the same time to a ledger whose `ledger.jsonl` starts with 1990 lines
- **THEN** `ledger.1.jsonl` holds at least 2000 lines, the two files hold together 3590 valid lines with every earlier and new entry exactly once, each process's entries keep their order across both files, and `ledger.jsonl` holds fewer than 2000 lines

### Requirement: Tolerant ledger read
Reading SHALL return the latest 2000 valid lines across `ledger.1.jsonl` then `ledger.jsonl`, in file order, and `skipped`, the number of invalid lines in both files. A line that is not JSON, fails the schema (including the size limit), has `v` other than `1`, is empty, or is the final line without a newline MUST be skipped and counted, without affecting the lines around it.

#### Scenario: Bad lines skipped
- **WHEN** `ledger.jsonl` holds a valid line, a line `{"v":1,"kind":`, a line with `v` 2, and another valid line
- **THEN** the read returns the two valid entries and `skipped` 2

#### Scenario: Blank line skipped
- **WHEN** `ledger.jsonl` holds a valid line, an empty line, and another valid line
- **THEN** the read returns the two valid entries and `skipped` 1

#### Scenario: Torn last line skipped
- **WHEN** the last line of `ledger.jsonl` is valid JSON but has no trailing newline
- **THEN** that line is skipped and counted

#### Scenario: Both segments read in order
- **WHEN** `ledger.1.jsonl` holds entries 1–2000 and `ledger.jsonl` holds 2001–2300
- **THEN** the read returns entries 301–2300 in order, with `skipped` 0

### Requirement: Ledger read is consistent and safe
If a rotation happens during a read, the read SHALL be repeated once so that no line is returned twice or missed. Missing files MUST read as empty. Any other read error MUST return `unreadable` with the error code and MUST NOT throw.

#### Scenario: Rotation during read
- **WHEN** the old segment is replaced between reading `ledger.1.jsonl` and reading `ledger.jsonl`
- **THEN** the read returns each line once, in order

#### Scenario: No ledger
- **WHEN** neither file exists
- **THEN** the read returns no entries and `skipped` 0

#### Scenario: Unreadable ledger
- **WHEN** `ledger.jsonl` is a directory
- **THEN** the read returns `unreadable` naming `EISDIR`, and nothing is thrown

### Requirement: Ledger failures never throw
Every ledger operation SHALL return its outcome instead of throwing. An I/O failure on append MUST return one issue at `""` naming the error code, and leave existing lines unchanged.

#### Scenario: Read-only directory
- **WHEN** the jev directory is not writable, the test is not run as root, and a valid entry is appended
- **THEN** the append returns an issue at `""` naming `EACCES`, and nothing is thrown

#### Scenario: Directory cannot be created
- **WHEN** the jev directory path is an existing regular file and a valid entry is appended
- **THEN** the append returns an issue at `""` naming the error code, and nothing is thrown

### Requirement: Ledger files are owner-only
Every file the ledger creates (`ledger.jsonl`, `ledger.1.jsonl` by rename, `ledger.rotate.lock`) SHALL have mode `0600`, and a created jev directory MUST have mode `0700`.

#### Scenario: Rotated segment keeps owner-only mode
- **WHEN** the ledger rotates
- **THEN** `ledger.1.jsonl` and the new `ledger.jsonl` both have mode `0600`

#### Scenario: Lock is owner-only
- **WHEN** a writer holds `ledger.rotate.lock`
- **THEN** the lock has mode `0600`
