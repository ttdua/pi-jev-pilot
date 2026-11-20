## MODIFIED Requirements

### Requirement: Mode targets
Each mode SHALL have a target table of whole percents for `basic`, `broad`, `deep` and a frontier cap, which together sum to 100:

| Mode | `basic` | `broad` | `deep` | frontier cap |
|---|---|---|---|---|
| `budget` | 50 | 40 | 10 | 0 |
| `standard` | 20 | 53 | 26 | 1 |
| `premium` | 0 | 50 | 47 | 3 |

The table SHALL live in the pure policy layer as data. The frontier cap is a ceiling on the share of `frontier`, not a quota. (Goal, not a requirement: each share of recent tier-routed launches within 10 points of its target.)

#### Scenario: Shares sum to 100
- **WHEN** the `basic`, `broad`, `deep` and frontier cap of each mode are added up
- **THEN** each sum is 100

#### Scenario: Budget never routes expert
<!-- Intentional change: `expert` is renamed `frontier`. -->
- **WHEN** the `budget` table is read
- **THEN** its frontier cap is 0

#### Scenario: Frontier caps
- **WHEN** the `standard` and `premium` tables are read
- **THEN** their frontier caps are 1 and 3

### Requirement: Mode selects a target table
A mode SHALL select exactly one target table, for worker requests only. Every question, threshold and rule other than the cut points derived from that table MUST be the same in every mode: the whole worker request, the difficulty score, slot handling, effort rules, fallback and the whole main request.

#### Scenario: Worker request ignores the mode
- **WHEN** worker questions offering all four tiers are built while the mode is `budget`, then `premium`
- **THEN** the two sets of questions are identical

#### Scenario: Same score, different tiers
- **WHEN** a launch scores 1.6 and the cut points of `budget` put 1.6 on `broad` while those of `premium` put it on `deep`
- **THEN** the tier is `broad` in `budget` and `deep` in `premium`

#### Scenario: Main request ignores the mode
- **WHEN** the main questions are built
- **THEN** the builder takes no mode input
