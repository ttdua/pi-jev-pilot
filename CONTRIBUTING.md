# Contributing

## Before you start

Read the [architecture](docs/architecture.md) and the [glossary](docs/glossary.md). Work follows the [roadmap](docs/roadmap.md), one work group at a time.

## Conventions

- **Language:** code, comments, docs, commits and pull requests are in English.
- **Words:** use the [glossary](docs/glossary.md)'s terms. A new concept gets an entry.
- **Boundaries:** `policy/` imports nothing outside itself; only `host/` touches Pi. See the [dependency rules](docs/architecture.md#dependency-rules).
- **Thresholds:** constants in one file, each with a comment pointing to its evidence. Changing one needs evidence.
- **Rubrics:** data only. Changing one needs a [replay](docs/testing.md#replay-rules).
- **Dependencies:** ask first. Keep runtime dependencies at zero where possible.

## Definition of done

A change is done when:

1. A failing test came first, at the lowest [level](docs/testing.md) that can prove the behavior.
2. Unit and host tests, lint, format and type checks pass.
3. Every affected document is updated in the same commit.
4. Claims name their evidence. "Works" needs a test or a run; unit tests are not called end-to-end.
5. New outbound data updates [Privacy](docs/privacy.md) and the field-set test.
6. A decision worth explaining has a [record](docs/decisions/README.md).

## Commits and branches

- Work in a branch, in its own worktree. Never commit directly to `main`.
- Small commits: one reason each, with the imperative subject explaining why it matters.
- Nothing is pushed, merged or published without the maintainer's explicit go-ahead.

## Data

Never commit real prompts, briefs, session files, API keys or personal paths. Evidence in `docs/evidence/` is aggregate only.
