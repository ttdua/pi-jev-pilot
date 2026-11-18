## MODIFIED Requirements

### Requirement: README explains each feature's effect
`README.md` SHALL have a section that, for each user-facing feature, says what changes in the user's sessions when it is on and how to turn it off. The features are effort, effort hold, skills, strategy advice, worker routing with modes, the expert tier, slots, the CLI review, tally and verbose log, auto-tuning, and the status line. The README MUST also state what never changes (the main model, fail open when Jev is unavailable, no prompt text stored) and the per-prompt latency.

#### Scenario: Every feature has an off switch
- **WHEN** `README.md` is read
- **THEN** it names the off command or setting of each of the five decision features (`effort`, `subagents`, `skills`, `strategy`, `expert`) and of the CLI review (`/jev cli-review off`)
