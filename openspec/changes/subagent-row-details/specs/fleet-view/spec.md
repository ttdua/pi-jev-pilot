## MODIFIED Requirements

### Requirement: Fleet list row content
Each agent row SHALL show the agent's display name, its description, the run-facts parts (from the shared run-facts formatter, joined by ` · `), and right-aligned `<s>s · ↓ <tokens> tokens`. `<s>` is whole elapsed seconds, frozen at `completedAt`. `<tokens>` is the lifetime token total in compact form (`950`, `13.1k`, `1.2M`). The run-facts parts SHALL follow the description. The description MUST be truncated before the right-aligned stats, and the left part is truncated from its end (run facts first, then the description). When the stats alone do not fit, they SHALL be truncated to the width.

#### Scenario: Row text
- **WHEN** an agent with display name `Explore` and description `audit auth` has run 12 seconds and used 13100 tokens, with no run fact known
- **THEN** its row contains `Explore`, `audit auth` and ends with `12s · ↓ 13.1k tokens`

#### Scenario: Row with run facts
- **WHEN** that agent runs `anthropic/claude-haiku-4-5` at thinking `high` with 12 tools and 3 blocked, at a width that fits everything
- **THEN** its row contains `audit auth` followed by `anthropic/claude-haiku-4-5 · thinking: high · 🔧12 · ⊘3`, and ends with `12s · ↓ 13.1k tokens`

#### Scenario: Narrow row keeps stats
- **WHEN** the same row renders at width 40, which fits the stats but not the whole left part
- **THEN** the row ends with `12s · ↓ 13.1k tokens`, the run facts are cut before the description, and the row is no wider than 40 columns
