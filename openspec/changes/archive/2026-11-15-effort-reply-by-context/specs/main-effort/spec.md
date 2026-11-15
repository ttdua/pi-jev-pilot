## ADDED Requirements

### Requirement: Reply rated by the work it approves
The main `effort` instruction SHALL tell Jev to rate a reply to the assistant's own question, proposal, review or approval request by the size of the work it approves or starts, read from the recent conversation, whatever the reply's length and format. It MUST NOT use reply length as a criterion: no `short`, and no examples chosen for their brevity.

#### Scenario: Role rule in the main instruction
- **WHEN** a main request asking `effort` is built
- **THEN** its `effort.instructions` equals the shipped main instruction with its last sentence replaced by the candidate sentence of this change's `design.md` (D2), equals the main instruction in `docs/jev-questions.md`, and has no word `short`

### Requirement: Reply rule leaves the rest unchanged
The worker `effort` instruction, the five level criteria and their option order MUST stay unchanged by the reply rule. When Jev's answer misses, *Jev failure changes nothing* SHALL apply unchanged.

#### Scenario: Criteria unchanged
- **WHEN** a main request asking `effort` is built
- **THEN** its `effort.criteria` keys, their order and their values equal those of the same request built before this change, and each value equals the level criterion in `docs/jev-questions.md`

#### Scenario: Worker instruction unchanged
- **WHEN** a worker request asking `effort` is built
- **THEN** its `effort.instructions` equals the worker instruction in `docs/jev-questions.md`, unchanged by this change

#### Scenario: Jev fails on a reply
- **WHEN** the prompt replies to the assistant's question and the Jev fixture answers HTTP 500
- **THEN** the thinking level is unchanged
