## MODIFIED Requirements

### Requirement: README explains each feature's effect
<!-- Intentional change: the CLI review is removed from the feature list and from "Every feature has an off switch". -->
`README.md` SHALL have a section that, for each user-facing feature, says what changes in the user's sessions when it is on and how to turn it off. The features are effort, effort hold, skills, strategy advice, worker routing with modes, the knowledge tiers (`basic`, `broad`, `deep`, `frontier`) and what tier versus effort means, slots, tally and verbose log, auto-tuning, and the status line. The README MUST also state what never changes (the main model, fail open when Jev is unavailable, no prompt text stored) and the per-prompt latency.

#### Scenario: Tier and effort explained
- **WHEN** `README.md` is read
- **THEN** it says that a tier picks how much the model knows and effort picks how hard it works, and names the `frontier` switch

#### Scenario: Every feature has an off switch
- **WHEN** `README.md` is read
- **THEN** it names the off command or setting of each of the five decision features (`effort`, `subagents`, `skills`, `strategy`, `frontier`) and does not mention the CLI review or `jev_review`
