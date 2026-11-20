## MODIFIED Requirements

### Requirement: Comparison against noise
In pass 1, for each variant and each decided key, the replay SHALL count the samples whose decision differs from the base. The keys are the effort level from `decideEffort`, strategy, `risky > .7`, `corrects >= CORRECTION_THRESHOLD`, and the final worker tier and effort. The noise of a key MUST be the larger flip count of the two reruns. The aggregate MUST show the flips and the noise side by side, and MUST mark a variant as beyond noise only when its flips exceed the noise. The report pass reports values with one rerun instead (*Report pass noise and misses*).

#### Scenario: No main tier key
- **WHEN** a pass 1 aggregate is written
- **THEN** it has no main tier key, since the main request no longer asks `tier`

#### Scenario: Within noise
- **WHEN** a variant flips 3 effort decisions and the reruns flip 2 and 4
- **THEN** the aggregate shows flips 3, noise 4, and does not mark it beyond noise

#### Scenario: Beyond noise
- **WHEN** a variant flips 12 strategy decisions and the reruns flip 1 and 2
- **THEN** it is marked beyond noise for strategy

### Requirement: Report pass cut-point window
Cut points SHALL come from one window per mode, variant and routing, built from the earlier routed launches of that stream in sample order with the package's `windowEntries` rules. While the window holds fewer than 100 entries, the launch MUST use the run's seed candidate for its mode (see "Report pass seed candidate") instead of `SEED_CUTPOINTS`; from 100 entries on, it MUST use `cutPoints` over the window. A launch routed to a slot MUST NOT enter the window.

#### Scenario: Seed then window
<!-- Intentional change: the first 100 launches use the run's seed candidate, so a replay with a new rubric does not route on the shipped seed of the old one. -->
- **WHEN** 150 worker answers are routed in `standard`
- **THEN** the first 100 use the run's `standard` seed candidate, and later launches use `cutPoints` over the routed launches before them

#### Scenario: Slot launch skips the window
- **WHEN** a launch routes to `slot::reviewer`
- **THEN** the window of the next launch has no entry for it


## ADDED Requirements

### Requirement: Report pass seed candidate
For each variant, the report pass SHALL compute a seed candidate per mode as `cutPoints` over the difficulty scores of every scored worker answer of that variant (the same answers serve every mode), with that mode's target. `aggregates.json` MUST hold the candidates as numbers per variant and mode, with ±∞ written as the strings `"-Infinity"` and `"Infinity"`; they are numbers, not text from prompts or briefs.

#### Scenario: Candidate per mode
- **WHEN** a report run has 120 scored worker answers in variant `report`
- **THEN** `aggregates.json` holds a `basicMax`, `broadMax` and `frontierMin` for `budget`, `standard` and `premium` under `report`, each equal to `cutPoints` over those 120 scores with the mode's target

#### Scenario: Budget candidate has no frontier
- **WHEN** the candidates are written
- **THEN** the `budget` `frontierMin` is `"Infinity"` and the `premium` `basicMax` is `"-Infinity"`

#### Scenario: Misses left out
- **WHEN** 5 of 120 worker requests miss
- **THEN** the candidates are computed over the 115 scored answers
