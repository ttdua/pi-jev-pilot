## ADDED Requirements

### Requirement: Mode targets
Each mode SHALL have a target table of whole percents for `fast`, `balanced`, `deep` and an expert cap, which together sum to 100:

| Mode | `fast` | `balanced` | `deep` | expert cap |
|---|---|---|---|---|
| `budget` | 50 | 40 | 10 | 0 |
| `standard` | 20 | 53 | 25 | 2 |
| `premium` | 0 | 50 | 45 | 5 |

The table SHALL live in the pure policy layer as data. The expert cap is a ceiling on the share of `expert`, not a quota. (Goal, not a requirement: each share of recent tier-routed launches within 10 points of its target.)

#### Scenario: Shares sum to 100
- **WHEN** the `fast`, `balanced`, `deep` and expert cap of each mode are added up
- **THEN** each sum is 100

#### Scenario: Budget never routes expert
- **WHEN** the `budget` table is read
- **THEN** its expert cap is 0

### Requirement: Mode selects a target table
A mode SHALL select exactly one target table, for worker requests only. Every question, threshold and rule other than the cut points derived from that table MUST be the same in every mode: the whole worker request, the difficulty score, the risk floor, slot handling, effort rules, fallback, tool assessment and the whole main request.

#### Scenario: Worker request ignores the mode
- **WHEN** worker questions offering all four tiers are built while the mode is `budget`, then `premium`
- **THEN** the two sets of questions are identical

#### Scenario: Same score, different tiers
- **WHEN** a launch scores 1.85 and the cut points of `budget` put 1.85 on `balanced` while those of `premium` put it on `deep`
- **THEN** the tier is `balanced` in `budget` and `deep` in `premium`

#### Scenario: Main request ignores the mode
- **WHEN** the main questions are built
- **THEN** the builder takes no mode input, and its output is unchanged by this change

## REMOVED Requirements

### Requirement: Expert gate per mode

**Reason**: The expert tier is now reached through the mode's expert cut point and an effort of `xhigh` or `max` (see `worker-decision` and `mode-cutpoints`). The per-mode gates read `expert_needed`, which never exceeded .5 in `standard` replay answers, and so could not reach any target share.

**Migration**: Remove `expertAdmitted` and both gates from `src/policy/modes.ts`. Ledger lines with reason `expert-admitted` stay valid but are no longer written.

### Requirement: What a mode selects

**Reason**: A mode no longer selects a rubric, an `expert_needed` wording or an expert gate. Replaced by "Mode selects a target table".

**Migration**: Remove the mode parameter from the worker question builder.
