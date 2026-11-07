## ADDED Requirements

### Requirement: Log entries while verbose is on
While the effective `verbose` switch is on, the package SHALL append one `jev-log` custom entry with `pi.appendEntry` for each valid `main`, `worker` and `correction` line the session records (the lines the session tally receives), with that validated line unchanged as its data. While `verbose` is off it MUST append none. The switch MUST be read when the line is recorded. A child session MUST append no `jev-log` entry.

#### Scenario: Verbose off by default
- **WHEN** an eligible prompt is answered and settles with default switches
- **THEN** the session file holds no `jev-log` entry

#### Scenario: Verbose on
- **WHEN** `verbose` is on and an eligible prompt is answered and settles
- **THEN** the session file holds one `jev-log` entry whose data equals the `main` ledger line

#### Scenario: Worker line logged
- **WHEN** `verbose` is on and a routed worker completes
- **THEN** one `jev-log` entry carries that `worker` line

#### Scenario: Correction logged
- **WHEN** `verbose` is on and a settled turn writes a `correction` line and a `main` line
- **THEN** two `jev-log` entries are appended, the `correction` one first

#### Scenario: Jev down is logged
- **WHEN** `verbose` is on and Jev returns HTTP 500 for an eligible prompt that then settles
- **THEN** one `jev-log` entry carries the `main` line with `miss` `error`

#### Scenario: Switched on mid-session
- **WHEN** one prompt settles with `verbose` off, the operator runs `/jev verbose on`, and a second prompt settles
- **THEN** exactly one `jev-log` entry exists, for the second prompt

#### Scenario: No entry in a child
- **WHEN** `verbose` is on and the observer receives a line whose `session` is a child session id
- **THEN** no `jev-log` entry is appended

### Requirement: Log failures stay inside the package
A failure to append a `jev-log` entry MUST NOT affect the turn, the launch, the ledger line or the tally.

#### Scenario: Throwing appendEntry
- **WHEN** `verbose` is on and `appendEntry` throws for the `jev-log` entry
- **THEN** the `main` ledger line is still written, the tally counts the prompt and the turn completes normally

### Requirement: Log entries never reach a provider
A `jev-log` entry MUST NOT appear in any provider request, in the main session or in a child.

#### Scenario: Hidden from the next request
- **WHEN** in a host session with `verbose` on, a first prompt settles with a `jev-log` entry, and a second prompt is sent
- **THEN** the session file holds the `jev-log` entry, and the second provider request contains neither `jev-log` nor any `turnId` from the first prompt's line

### Requirement: Log entry renderer
The package SHALL register an entry renderer for `jev-log` that draws one line from the entry data with the log line text, cut to the render width. Data that is not a valid ledger line MUST render nothing. A renderer failure MUST render nothing and MUST NOT propagate to Pi.

#### Scenario: Unknown data
- **WHEN** the renderer receives data `{ "kind": "other" }`
- **THEN** it renders nothing and does not throw

#### Scenario: Narrow width
- **WHEN** a log line is rendered at a width smaller than its text
- **THEN** it renders one line cut to the width

### Requirement: Main log line text
A `main` line SHALL read `jev · main · <from> → <effective>`, with `-` for a missing level. It is followed, each segment only when its field is present, by ` · <s>s` (`ms` in seconds to one decimal), ` · p` followed by one ` <level> <p>` pair (two decimals) per `effortP` key present, in the order `low`, `medium`, `high`, `xhigh`, `max`; ` · held` when `held` is `true`; and ` · miss <miss>`.

#### Scenario: Main line text
- **WHEN** the data is a `main` line with `from` `low`, `effective` `high`, `ms` 512 and `effortP` `{low:0.05,medium:0.1,high:0.7,xhigh:0.1,max:0.05}`
- **THEN** the text reads `jev · main · low → high · 0.5s · p low 0.05 medium 0.10 high 0.70 xhigh 0.10 max 0.05`

#### Scenario: Sparse main line
- **WHEN** the data is a `main` line with `answered` false, `miss` `error`, `from` `low` and no `ms`, `effective` or `effortP`
- **THEN** the text reads `jev · main · low → - · miss error`

#### Scenario: Main miss text
- **WHEN** the data is a `main` line with `from` `medium`, `effective` `medium`, `ms` 1500 and `miss` `timeout`
- **THEN** the text reads `jev · main · medium → medium · 1.5s · miss timeout`

### Requirement: Worker log line text
A `worker` line SHALL read `jev · <agent> → <target> · <effort>`, where `<target>` is `tier` when present, `untouched` for reason `untouched`, and `-` otherwise, and `<effort>` is `effort` or `-`.

#### Scenario: Worker untouched head
- **WHEN** the data is a `worker` line for agent `scout` with `reason` `untouched`, no `tier`, no `effort`, no `ms` and `status` `completed`
- **THEN** the text reads `jev · scout → untouched · -`

### Requirement: Worker log line segments
After its head, a `worker` line SHALL add, each segment only when it applies and in this order: ` · <s>s` from `ms`; ` · p <key> <p> …` from `tierP` (two decimals; `fast`, `balanced`, `deep`, `expert`, then other keys in line order); ` · why <reason>` unless the reason is `choice` or `untouched`; ` · miss <miss>`; ` · fallback <fallback>` when it differs from a present `tier`; ` · locked` when `locked` is `true`; ` · <status>` unless `completed`.

#### Scenario: Worker fallback text
- **WHEN** the data is a `worker` line for agent `general-purpose` with `reason` `choice`, `tier` `balanced`, `fallback` `deep`, `effort` `high`, `ms` 480, `tierP` `{fast:0.1,balanced:0.3,deep:0.6}` and `status` `completed`
- **THEN** the text reads `jev · general-purpose → balanced · high · 0.5s · p fast 0.10 balanced 0.30 deep 0.60 · fallback deep`

#### Scenario: Worker miss text
- **WHEN** the data is a `worker` line for agent `scout` with `reason` `miss`, `miss` `timeout`, `ms` 1500, no `tier`, no `effort` and `status` `completed`
- **THEN** the text reads `jev · scout → - · - · 1.5s · why miss · miss timeout`

#### Scenario: Worker untouched text
- **WHEN** the data is a `worker` line for agent `scout` with `reason` `untouched`, no `tier`, no `effort` and `status` `aborted`
- **THEN** the text reads `jev · scout → untouched · - · aborted`

### Requirement: Correction log line text
A `correction` line SHALL read `jev · correction · <corrects>`, with `corrects` to two decimals.

#### Scenario: Correction text
- **WHEN** the data is a `correction` line with `corrects` 0.8
- **THEN** the text reads `jev · correction · 0.80`
