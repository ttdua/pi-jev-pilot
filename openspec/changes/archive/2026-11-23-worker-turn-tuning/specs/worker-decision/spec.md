## MODIFIED Requirements

### Requirement: Turn floor
A pure function SHALL compute a turn floor from the `turns` probabilities and the band floors passed in, never from confidence or `turns.choice` alone. `short` has no floor; `medium`, `long` and `very_long` take the floors passed in, which are the built-in 40, 100 and 200 unless tuning changed them. From `very_long` down to `medium`, the floor MUST be that of the first band whose probability plus those of all higher bands is at least .5; otherwise, or when unanswered, there SHALL be no floor. Missing bands count as 0; no normalising. The band picked this way SHALL be the band tuning assigns to a run with the same probabilities.

#### Scenario: Long by majority
- **WHEN** the `turns` probabilities are `short` .1, `medium` .2, `long` .6 and `very_long` .1
- **THEN** the floor is 100

#### Scenario: Thin tail does not raise
- **WHEN** the `turns` probabilities are `short` .6, `medium` .1, `long` .1 and `very_long` .2
- **THEN** there is no floor

#### Scenario: Cumulative at the bar
- **WHEN** the `turns` probabilities are `short` .5, `medium` .2, `long` .2 and `very_long` .1
- **THEN** the floor is 40, since `medium` and above sum to exactly .5

#### Scenario: Choice is not enough
- **WHEN** `turns.choice` is `long` with probability .4, and the probabilities are `short` .35, `medium` .25, `long` .4, `very_long` 0
- **THEN** the floor is 40, since `long` and above sum to .4 and `medium` and above to .65

#### Scenario: Very long
- **WHEN** the `turns` probabilities are `long` .3 and `very_long` .7
- **THEN** the floor is 200

#### Scenario: Probabilities not normalised
- **WHEN** the `turns` probabilities are `short` .4, `medium` .2 and `long` .2, summing to .8
- **THEN** there is no floor, since `medium` and above sum to .4 and the probabilities are not scaled up to 1

#### Scenario: Unanswered
- **WHEN** `turns` is unanswered
- **THEN** there is no floor

#### Scenario: Tuned floors passed in
- **WHEN** the floors passed in are `medium` 40, `long` 80 and `very_long` 200, and the `turns` probabilities are `short` .1, `medium` .2, `long` .6 and `very_long` .1
- **THEN** the floor is 80 and the band is `long`
