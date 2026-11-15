## MODIFIED Requirements

### Requirement: One change per variant
In pass 1, each variant SHALL differ from its base in exactly one thing:
- one rich group added to minimal, or removed from full;
- the reversed order of the `effort` options;
- `no-prompt-chars`: `request.prompt_chars` removed from the full state;
- for workers: `parent_request` added, the agent `description` emptied, or `instructions_excerpt` emptied.

`no-prompt-chars` MUST have base `full` and MUST need the same groups as `full`. A sample missing one of them MUST be excluded and counted. Without `--capabilities`, the variant MUST be skipped and reported, like the capabilities variants. `--only no-prompt-chars` MUST also plan `full`.

Every pass 1 run MUST include two plain reruns: `rerun-a` and `rerun-b` of `minimal` for the main side, and of `base` for the worker side. Every main variant, including those based on `full`, takes its noise from the two `minimal` reruns. The report pass follows its own requirement, *Report pass plan*.

#### Scenario: Add-one variant
- **WHEN** the replay builds the `+last_decision` variant for a sample
- **THEN** its state equals the minimal state plus `conversation.last_decision`

#### Scenario: Reversed options
- **WHEN** the replay builds the `effort-reversed` variant
- **THEN** its `effort` options are the shipped option order reversed (`max`, `low`, `xhigh`, `medium`, `high` for the shipped `high`, `medium`, `xhigh`, `low`, `max`), and the state is minimal

#### Scenario: No prompt length variant
- **WHEN** the replay builds the `no-prompt-chars` variant for a sample with a snapshot
- **THEN** its base is `full`, its questions equal those of `full`, and its state equals the `full` state with `request.prompt_chars` removed and nothing else changed

#### Scenario: New variants need the snapshot
- **WHEN** the replay runs pass 1 without `--capabilities`, with or without `--only no-prompt-chars`
- **THEN** it exits 0, no `no-prompt-chars` request is planned, and the printed `skipped:` line names `no-prompt-chars`

#### Scenario: Only a new variant
- **WHEN** the replay plans pass 1 with a snapshot and `--only no-prompt-chars`
- **THEN** the plan holds `minimal`, `rerun-a`, `rerun-b`, `full` and `no-prompt-chars` main requests, and every `no-prompt-chars` request has a `full` request for the same sample

#### Scenario: Full-based noise
- **WHEN** a `no-prompt-chars` run flips 3 effort decisions against `full`, and the `minimal` reruns flip 2 and 4
- **THEN** the aggregate shows flips 3, noise 4, and does not mark `no-prompt-chars` beyond noise for effort

#### Scenario: Reruns present
- **WHEN** a run plan is built for pass 1
- **THEN** it holds `rerun-a` and `rerun-b` for the main base and for the worker base

## ADDED Requirements

### Requirement: Turn size of a sample
Pass 1 SHALL give each main sample the tool calls of its own turn. It looks at the entries that descend from the prompt on its branch, up to the next user message. It takes the first `jev-turn` entry there and the `toolCalls` of the ledger `main` line with that `turnId`. Only a non-negative integer counts. The turn MUST be `large` at 15 or more tool calls and `small` below 15. Otherwise the sample has no size.

#### Scenario: Large turn
- **WHEN** a fixture sample's turn has a ledger line with `toolCalls` 15
- **THEN** the sample's turn size is `large`

#### Scenario: Boundary below
- **WHEN** a fixture sample's turn has `toolCalls` 14, or `toolCalls` 0
- **THEN** the sample's turn size is `small`

#### Scenario: Invalid count
- **WHEN** a sample's ledger line has `toolCalls` `-1` or `2.5`
- **THEN** the sample has no size

#### Scenario: Next turn not borrowed
- **WHEN** two prompts follow each other on one branch, only the second turn has a `jev-turn` entry with `toolCalls` 20, and a sibling branch of the first prompt has a `jev-turn` entry with `toolCalls` 30
- **THEN** the first sample has no size, and the second is `large`

### Requirement: Turn size side measure
For every pass 1 main variant other than `minimal`, `rerun-a` and `rerun-b`, `aggregates.json` SHALL hold `size`: `{ large: { raised, same, lowered }, small: { raised, same, lowered }, unknown }`, each leaf a non-negative integer. Only pairs where both sides decided an effort level MUST count. Such a pair goes in its size bucket, by the variant's level against its base's, or in `unknown` when the sample has no size.

#### Scenario: Raised on a large turn
- **WHEN** a sample's turn has `toolCalls` 20, its base decides `low` and the variant decides `high`
- **THEN** the variant's `size.large.raised` counts that sample

#### Scenario: Lowered on a small turn
- **WHEN** a sample's turn has `toolCalls` 3, its base decides `high` and the variant decides `medium`
- **THEN** the variant's `size.small.lowered` counts that sample

#### Scenario: Same level
- **WHEN** a sample's turn has `toolCalls` 3 and both sides decide `medium`
- **THEN** the variant's `size.small.same` counts that sample

#### Scenario: Unknown size
- **WHEN** both sides decide an effort level and the sample has no size
- **THEN** it is counted in `size.unknown` and in no bucket

#### Scenario: Miss not counted
- **WHEN** either side of a pair is a miss, or has no decided effort level
- **THEN** the pair is absent from `size`, `unknown` included

#### Scenario: Bases carry no size
- **WHEN** a pass 1 run completes
- **THEN** the `minimal`, `rerun-a` and `rerun-b` aggregates have no `size`

#### Scenario: Size holds no text
- **WHEN** a fixture prompt contains `JEV-MARKER-PROMPT` and a run completes
- **THEN** every leaf of every `size` object is a non-negative integer, and `aggregates.json` does not contain `JEV-MARKER-PROMPT`
