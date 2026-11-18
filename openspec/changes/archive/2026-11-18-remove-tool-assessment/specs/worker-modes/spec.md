## MODIFIED Requirements

### Requirement: Mode selects a target table
A mode SHALL select exactly one target table, for worker requests only. Every question, threshold and rule other than the cut points derived from that table MUST be the same in every mode: the whole worker request, the difficulty score, the risk floor, slot handling, effort rules, fallback and the whole main request.

#### Scenario: Worker request ignores the mode
- **WHEN** worker questions offering all four tiers are built while the mode is `budget`, then `premium`
- **THEN** the two sets of questions are identical

#### Scenario: Same score, different tiers
- **WHEN** a launch scores 1.85 and the cut points of `budget` put 1.85 on `balanced` while those of `premium` put it on `deep`
- **THEN** the tier is `balanced` in `budget` and `deep` in `premium`

#### Scenario: Main request ignores the mode
- **WHEN** the main questions are built
- **THEN** the builder takes no mode input, and its output is unchanged by this change
