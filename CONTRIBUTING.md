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

## Where code goes

- **Layer, then capability folder:** pick the layer (`host/`, `policy/`, `jev/`, `store/`, `shared/`), then the capability folder under it (`policy/main/`, `host/tuning/`). `jev/`, `store/` and `shared/` stay flat.
- **Pure code in `policy/`:** decision rules and data transforms with no Pi import, no I/O, no clock and no global state. Mutable session state stays in `host/`.
- **Cross-capability use through `index.ts`:** import another capability only from its `index.ts`, with named re-exports (no `export *`). Relative imports take the shortest path. Capability folders nest at most one level.
- **Enforcement:** `bun run test` runs `tests/import-graph.test.ts`, which resolves every import path and is authoritative. `bun run lint` catches the plain spellings early.

## Running the checks

- `bun install`: install the pinned dependencies.
- `bun run typecheck`: type-check the whole project.
- `bun run lint`: run oxlint, including the early dependency-boundary rules (the resolved-path check in `bun run test` is authoritative) and the function-size rules as errors: at most 50 lines, complexity 12, 4 params, 25 statements and depth 4 per function in `src/` and `scripts/` (off for `tests/`). Split a function that grows past them; the only disable directive is the `max-params` on `jev_review`'s `execute`, whose arity Pi fixes.
- `bun run fmt`: format every file in place.
- `bun run fmt:check`: fail if any file is unformatted.
- `bun run test`: run all tests.

The load test needs Node ≥ 22.19, because the pinned `pi` binary runs on Node.

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
