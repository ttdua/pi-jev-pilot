## ADDED Requirements

### Requirement: Difficulty score
A pure function SHALL compute a worker's difficulty score from the `tier` and `effort` answers as `Σ rank(t) · P̂(t) + rank(e) / 8`, rounded to 3 decimals. The tier ranks are `fast` 0, `balanced` 1, `deep` 2, `expert` 3. `P̂` is the `tier` probabilities of tier keys only, divided by their sum, so slot keys never shift the score. The effort ranks are `low` 0, `medium` 1, `high` 2, `xhigh` 3, `max` 4, and an unanswered `effort` MUST count as `high`. With `tier` unanswered, or when the tier probabilities sum to 0, there SHALL be no score. The score MUST NOT depend on the mode.

#### Scenario: Balanced with high effort
- **WHEN** the `tier` probabilities are `balanced` 1 and `effort.choice` is `high`
- **THEN** the score is 1.25

#### Scenario: Mixed probabilities
- **WHEN** the `tier` probabilities are `balanced` .6 and `deep` .4, and `effort.choice` is `high`
- **THEN** the score is 1.65

#### Scenario: Slot keys ignored
- **WHEN** the `tier` probabilities are `slot::reviewer` .5 and `balanced` .5, and `effort.choice` is `high`
- **THEN** the score is 1.25

#### Scenario: Effort unanswered
- **WHEN** the `tier` probabilities are `deep` 1 and `effort` is unanswered
- **THEN** the score is 2.25

#### Scenario: Rounded before use
- **WHEN** the `tier` probabilities are `balanced` .45 and `deep` .55, and `effort.choice` is `high`
- **THEN** the score is exactly 1.8

#### Scenario: Only slot probability
- **WHEN** the `tier` probabilities are `slot::reviewer` 1 and every tier key is 0
- **THEN** there is no score

#### Scenario: Jev failure gives no score
- **WHEN** the worker answers are a miss
- **THEN** there is no score

### Requirement: Cut points from a window
A pure function SHALL compute a mode's cut points `fastMax`, `balancedMax` and `expertMin` from a window of entries, each with a score and an effort, and the mode's target. Targets are whole percents. Over the `n` scores sorted ascending:
- `fastMax` is the score at position `k = ⌊(fast · n + 50) / 100⌋`, counted from 1 and kept within 1 to `n`, or −∞ when `fast` is 0.
- `balancedMax` is the score at position `⌊((fast + balanced) · n + 50) / 100⌋`, kept within 1 to `n`.
- `expertMin` is the lowest score `s` held by an entry with effort `xhigh` or `max`, such that `s > balancedMax` and at most `⌊expertCap · n / 100⌋` such entries have a score of at least `s`. With no such score, or an `expertCap` of 0, it is +∞.

With an empty window all three cut points SHALL be +∞. The result MUST NOT depend on the order of the entries.

#### Scenario: Standard target on ten scores
- **WHEN** the window holds the scores .1, .2, … 1.0 with effort `high`, and the target is `standard`
- **THEN** `fastMax` is .2, `balancedMax` is .7, and `expertMin` is +∞

#### Scenario: Budget target on ten scores
- **WHEN** the window holds the scores .1, .2, … 1.0, and the target is `budget`
- **THEN** `fastMax` is .5, `balancedMax` is .9, and `expertMin` is +∞

#### Scenario: Premium has no fast cut
- **WHEN** the window holds the scores .1, .2, … 1.0, and the target is `premium`
- **THEN** `fastMax` is −∞ and `balancedMax` is .5

#### Scenario: Expert cap
- **WHEN** the window holds the 100 scores .01, .02, … 1.00, the 6 entries scoring .95 or more have effort `xhigh`, the rest have effort `high`, and the target is `premium`
- **THEN** `expertMin` is .96

#### Scenario: Expert never below the balanced cut
- **WHEN** the window holds the 100 scores .01, … 1.00, only the entries scoring .10 or less have effort `xhigh`, and the target is `standard`
- **THEN** `expertMin` is +∞

#### Scenario: Ties stay under the cap
- **WHEN** the window holds 100 entries, 97 scoring 1.0 with effort `high` and 3 scoring 2.5 with effort `max`, and the target is `standard`
- **THEN** `expertMin` is +∞, since 3 entries at 2.5 exceed the cap of 2

#### Scenario: Empty window
- **WHEN** the window is empty
- **THEN** `fastMax`, `balancedMax` and `expertMin` are +∞

#### Scenario: Order independent
- **WHEN** the same window is given in two different orders
- **THEN** the cut points are equal

### Requirement: Window entries
A pure function SHALL select the window from ledger entries. An entry SHALL be eligible only when all of the following hold:
- it is a `worker` line whose `rubric` equals the current rubric version;
- it carries a `score` and `expertOffered` true;
- its `reason` is `expert`, `risky` or `cut`.

The window SHALL be the latest 200 eligible entries by `at`; among entries with equal `at`, later input counts as later. Each window entry SHALL carry the score, the effort and the decided tier. The effort is the highest-probability key of `effortP`, the higher level on a tie, or `high` without `effortP`; Jev's `effort.choice` is that same key. The decided tier is `fallback` when present and otherwise `tier`.

#### Scenario: Slot launch left out
- **WHEN** a worker line has `reason` `slot`
- **THEN** it is not in the window

#### Scenario: Old rubric left out
- **WHEN** a worker line has no `rubric`, or a `rubric` other than the current version
- **THEN** it is not in the window

#### Scenario: Setup without expert left out
- **WHEN** a worker line has `expertOffered` false
- **THEN** it is not in the window

#### Scenario: Miss and untouched left out
- **WHEN** worker lines have `reason` `miss` or `untouched`
- **THEN** they are not in the window

#### Scenario: Latest 200
- **WHEN** 250 eligible lines are given
- **THEN** the window holds the 200 with the latest `at`

#### Scenario: Decided tier before fallback
- **WHEN** an eligible line has `tier` `balanced` and `fallback` `deep`
- **THEN** its window entry has the decided tier `deep`

#### Scenario: Equal times at the boundary
- **WHEN** 201 eligible lines are given and the two earliest share one `at`
- **THEN** the window drops the first of those two in input order

#### Scenario: Effort tie
- **WHEN** an eligible line has `effortP` with `high` .5 and `xhigh` .5
- **THEN** its window entry has effort `xhigh`

#### Scenario: Effort from the distribution
- **WHEN** an eligible line has `effortP` with `xhigh` .6 and `high` .4
- **THEN** its window entry has effort `xhigh`

### Requirement: Seed cut points
The package SHALL ship seed cut points per mode, computed offline from the 2026-11-07 replay answers with the difficulty score and cut-point rules above. A window with fewer than 100 entries SHALL use the seed for the launch's mode. A window with 100 or more entries SHALL use the cut points computed from it. The seed values MUST be published, as aggregates, in a dated `docs/evidence/` note.

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
- **THEN** `fastMax ≤ balancedMax < expertMin`, with `fastMax` −∞ for `premium` and `expertMin` +∞ for `budget`

### Requirement: Recent mix
A pure function SHALL report the window's mix: the number of entries and the share of each decided tier, `fast`, `balanced`, `deep` and `expert`, as whole percents rounded to the nearest. With an empty window, it SHALL report no shares.

#### Scenario: Mix of four entries
- **WHEN** the window holds decided tiers `fast`, `balanced`, `balanced` and `deep`
- **THEN** the mix is 4 entries, `fast` 25%, `balanced` 50%, `deep` 25%, `expert` 0%

#### Scenario: Empty window
- **WHEN** the window is empty
- **THEN** the mix has 0 entries and no shares
