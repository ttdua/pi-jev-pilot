# mode-cutpoints Specification

## Purpose
The difficulty score of a worker launch, the cut points that turn it into a tier for each mode, the window of recent ledger lines they come from, the shipped seed, and the recent mix.

## Requirements

### Requirement: Difficulty score
A pure function SHALL compute a worker's difficulty score from the `tier` answer as `Σ rank(t) · P̂(t)`, rounded to 3 decimals. The tier ranks are `basic` 0, `broad` 1, `deep` 2, `frontier` 3. `P̂` is the `tier` probabilities of tier keys only, divided by their sum, so slot keys never shift the score. The `effort` answer MUST NOT affect the score. With `tier` unanswered, or when the tier probabilities sum to 0, there SHALL be no score. The score MUST NOT depend on the mode.

#### Scenario: Balanced with high effort
<!-- Intentional change: `balanced` is renamed `broad` and effort no longer adds to the score. -->
- **WHEN** the `tier` probabilities are `broad` 1 and `effort.choice` is `high`
- **THEN** the score is 1

#### Scenario: Mixed probabilities
- **WHEN** the `tier` probabilities are `broad` .6 and `deep` .4
- **THEN** the score is 1.4

#### Scenario: Slot keys ignored
- **WHEN** the `tier` probabilities are `slot::reviewer` .5 and `broad` .5
- **THEN** the score is 1

#### Scenario: Effort unanswered
<!-- Intentional change: effort no longer adds to the score, answered or not. -->
- **WHEN** the `tier` probabilities are `deep` 1, once with `effort.choice` `low`, once with `max` and once with `effort` unanswered
- **THEN** the score is 2 each time

#### Scenario: Rounded before use
- **WHEN** the `tier` probabilities are `basic` .3333, `broad` .3333 and `deep` .3334
- **THEN** the score is exactly 1

#### Scenario: Only slot probability
- **WHEN** the `tier` probabilities are `slot::reviewer` 1 and every tier key is 0
- **THEN** there is no score

#### Scenario: Jev failure gives no score
- **WHEN** the worker answers are a miss
- **THEN** there is no score

### Requirement: Cut points from a window
A pure function SHALL compute a mode's cut points `basicMax`, `broadMax` and `frontierMin` from a window of scores and the mode's target. Targets are whole percents. Over the `n` scores sorted ascending:
- `basicMax` is the score at position `k = ⌊(basic · n + 50) / 100⌋`, counted from 1 and kept within 1 to `n`, or −∞ when `basic` is 0.
- `broadMax` is the score at position `⌊((basic + broad) · n + 50) / 100⌋`, kept within 1 to `n`.
- `frontierMin` is the lowest score `s` in the window such that `s > broadMax` and at most `⌊frontierCap · n / 100⌋` entries have a score of at least `s`. With no such score, or a `frontierCap` of 0, it is +∞. Effort MUST NOT be read.

With an empty window all three cut points SHALL be +∞. The result MUST NOT depend on the order of the entries.

#### Scenario: Standard target on ten scores
- **WHEN** the window holds the scores .1, .2, … 1.0, and the target is `standard`
- **THEN** `basicMax` is .2, `broadMax` is .7, and `frontierMin` is +∞

#### Scenario: Budget target on ten scores
- **WHEN** the window holds the scores .1, .2, … 1.0, and the target is `budget`
- **THEN** `basicMax` is .5, `broadMax` is .9, and `frontierMin` is +∞

#### Scenario: Premium has no fast cut
<!-- Intentional change: `fast` is renamed `basic`. -->
- **WHEN** the window holds the scores .1, .2, … 1.0, and the target is `premium`
- **THEN** `basicMax` is −∞ and `broadMax` is .5

#### Scenario: Expert cap
<!-- Intentional change: `expert` is renamed `frontier` and the cut no longer reads effort. -->
- **WHEN** the window holds the 100 scores .01, .02, … 1.00, and the target is `premium`
- **THEN** `frontierMin` is .98, since 3 entries score .98 or more

#### Scenario: Frontier cap in standard
- **WHEN** the window holds the 100 scores .01, .02, … 1.00, and the target is `standard`
- **THEN** `frontierMin` is 1.00

#### Scenario: Expert never below the balanced cut
<!-- Intentional change: `expert` and `balanced` are renamed `frontier` and `broad`. -->
- **WHEN** the window holds 100 entries all scoring 0.5, and the target is `premium`
- **THEN** `frontierMin` is +∞, since no score is above `broadMax` 0.5

#### Scenario: Ties stay under the cap
- **WHEN** the window holds 100 entries, 97 scoring 1.0 and 3 scoring 2.5, and the target is `standard`
- **THEN** `frontierMin` is +∞, since 3 entries at 2.5 exceed the cap of 1

#### Scenario: Empty window
- **WHEN** the window is empty
- **THEN** `basicMax`, `broadMax` and `frontierMin` are +∞

#### Scenario: Order independent
- **WHEN** the same window is given in two different orders
- **THEN** the cut points are equal

### Requirement: Window entries
A pure function SHALL select the window from ledger entries. An entry SHALL be eligible only when all of the following hold:
- it is a `worker` line whose `rubric` equals the current rubric version;
- it carries a `score` and `frontierOffered` true;
- its `reason` is `frontier` or `cut`.

The window SHALL be the latest 200 eligible entries by `at`; among entries with equal `at`, later input counts as later. Each window entry SHALL carry the score and the decided tier. The decided tier is `fallback` when present and otherwise `tier`.

#### Scenario: Slot launch left out
- **WHEN** a worker line has `reason` `slot`
- **THEN** it is not in the window

#### Scenario: Old rubric left out
- **WHEN** a worker line has no `rubric`, or a `rubric` other than the current version
- **THEN** it is not in the window

#### Scenario: Setup without expert left out
<!-- Intentional change: `expertOffered` is renamed `frontierOffered`. -->
- **WHEN** a worker line has `frontierOffered` false, or only the legacy `expertOffered`
- **THEN** it is not in the window

#### Scenario: Miss and untouched left out
<!-- Intentional change: reasons `risky` and `expert` are no longer written. -->
- **WHEN** worker lines have `reason` `miss`, `untouched`, `risky` or `expert`
- **THEN** they are not in the window

#### Scenario: Latest 200
- **WHEN** 250 eligible lines are given
- **THEN** the window holds the 200 with the latest `at`

#### Scenario: Decided tier before fallback
- **WHEN** an eligible line has `tier` `broad` and `fallback` `deep`
- **THEN** its window entry has the decided tier `deep`

#### Scenario: Equal times at the boundary
- **WHEN** 201 eligible lines are given and the two earliest share one `at`
- **THEN** the window drops the first of those two in input order

#### Scenario: Effort tie
<!-- Intentional change: window entries no longer carry effort. -->
- **WHEN** an eligible line has `effortP` with `high` .5 and `xhigh` .5
- **THEN** its window entry carries only the score and the decided tier

#### Scenario: Effort from the distribution
<!-- Intentional change: window entries no longer carry effort. -->
- **WHEN** two eligible lines have the same score and decided tier, one with `effortP` `xhigh` .6 and one with `low` .9
- **THEN** their window entries are equal

### Requirement: Seed cut points
The package SHALL ship seed cut points per mode, computed offline from a replay of the worker corpus with rubric version 3, with the difficulty score and cut-point rules above. A window with fewer than 100 entries SHALL use the seed for the launch's mode. A window with 100 or more entries SHALL use the cut points computed from it. The seed values MUST be published, as aggregates, in a dated `docs/evidence/` note together with the resulting mix per mode.

#### Scenario: Short window uses the seed
- **WHEN** the window holds 99 entries
- **THEN** the cut points are the seed for the launch's mode

#### Scenario: Full window computed
- **WHEN** the window holds 100 entries
- **THEN** the cut points are computed from the window

#### Scenario: Seed matches the evidence note
- **WHEN** the shipped seed is compared with the cut points published in the evidence note
- **THEN** they are equal for every mode

#### Scenario: Seed is a valid result
- **WHEN** the seed for each mode is read
- **THEN** `basicMax ≤ broadMax < frontierMin`, with `basicMax` −∞ for `premium` and `frontierMin` +∞ for `budget`

### Requirement: Recent mix
A pure function SHALL report the window's mix: the number of entries and the share of each decided tier, `basic`, `broad`, `deep` and `frontier`, as whole percents rounded to the nearest. With an empty window, it SHALL report no shares.

#### Scenario: Mix of four entries
- **WHEN** the window holds decided tiers `basic`, `broad`, `broad` and `deep`
- **THEN** the mix is 4 entries, `basic` 25%, `broad` 50%, `deep` 25%, `frontier` 0%

#### Scenario: Empty window
- **WHEN** the window is empty
- **THEN** the mix has 0 entries and no shares
