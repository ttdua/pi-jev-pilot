## Design Summary

**Intent.** The source tree should show what the package does. Today the layers are right
(`host/` is the Pi shell, `policy/` the pure core, `jev/` and `store/` the outer adapters, all
lint-enforced), but inside a layer nothing groups a capability: `src/host/` is 40 flat files for
seven capabilities, found only by filename prefix (`main-*`, `tool-*`, `tuning-*`), and five pure
files (`main-outcome`, `main-line`, `worker-line`, `tuning-text`, `review-cli`) live in `host/`, where
lint cannot keep them pure. The coding-standards refactor made this worse by adding ten `main-*`
files to the flat folder. Before the refactor goes on (worker routing next), the folder convention
has to be settled once, for the whole repository.

**Who it is for.** Contributors and reviewers, human or agent, who need to find "how does worker
routing work" in one place, and who rely on lint, not memory, to keep the pure core pure.

**Goals**
- Inside each layer, one folder per capability from the glossary and roadmap: main decision,
  worker routing, tool assessment, CLI review, auto-tuning, the `/jev` command and status line, plus
  one folder for host plumbing shared by them.
- Every pure unit lives in `policy/`, so the existing layer rule keeps it pure.
- A capability is used from outside its folder only through that folder's `index.ts`; lint reports
  any deep import across capability folders.
- Tests follow the same folders, so a unit and its test are found the same way.

**Non-goals**
- No behaviour change. No change to Pi seams, ledger lines, settings, `/jev` output or messages.
- No change to the layer direction rules (`host` → `jev`/`policy`/`store`/`shared`, …).
- `jev/`, `store/` and `shared/` keep their layout: each is small and already one responsibility.
- Splitting `worker.ts`, `commands.ts` and the other large functions stays in the later refactor
  waves; this change only moves files and rewrites imports.

**Anti-goals** (failure even if it builds)
- Losing file history: moves must stay traceable with `git log --follow`.
- A barrel `index.ts` that re-exports everything, which would make the new rule meaningless.
- A layout rule that lives only in docs and drifts.

**Constraints**
- Specified requirement touched: `quality-checks` › *Dependency boundaries are enforced by lint*.
  Its forbidden and allowed edges stay exactly as specified; this change **adds** a requirement for
  cross-capability imports and fixtures that prove it, using the same fixture harness
  (`tests/boundaries.test.ts`, `tests/fixtures/boundaries`). *Pi imports are confined to host* and
  *Check commands* are unchanged.
- Tests that locate source by path (`tests/host-stores.test.ts`, `tests/host/review-cli.test.ts`,
  `tests/manifest.test.ts`, `tests/store/boundaries.test.ts`) must keep finding their files.
- No new runtime dependency. One devDependency, `typescript`, was later approved for the import check
  (see design D5).

## Alternatives Considered

### Alternative A: Layers only, flat inside (today)
- **Approach**: keep `host/` and `policy/` flat; rely on filename prefixes.
- **Pros**: no moves; no new lint rule.
- **Cons**: a capability is scattered over 40 files found by prefix; pure code can sit in `host/`
  unchecked; every refactor wave adds more prefixed files.
- **Why not chosen**: it is the problem the reviewer raised on Wave 1.

### Alternative B: Feature folders replace layers
- **Approach**: `src/main/`, `src/worker/`, … each holding its Pi adapter, pure rules and stores.
- **Pros**: everything for a capability in one folder.
- **Cons**: the pure/impure split, the core architecture principle, is no longer a folder boundary;
  every lint rule and the `quality-checks` spec would be rewritten; `scripts/replay` reuses `jev/`
  and `policy/` across capabilities and would import from every feature folder.
- **Why not chosen**: trades the one boundary the project enforces for discoverability.

### Alternative C: Layers kept, capability folders inside each layer (functional core / imperative shell + slices)
- **Approach**: `src/host/<capability>/` and `src/policy/<capability>/`, shared pieces at the layer
  root (`host/platform/`, `policy/answers.ts`, `policy/effort.ts`); cross-capability use only via
  `index.ts`, lint-enforced.
- **Pros**: keeps every existing rule; adds discoverability; puts pure code under lint; matches the
  layering-plus-slices practice (Feature-Sliced Design, Nx module boundaries, FCIS with slices).
- **Cons**: about 45 file moves and many import rewrites in one change; one more lint rule.

## Agreed Approach

Alternative C, approved by the reviewer on the research note
(`structure-proposal.md`, thread "coding-standards refactor"). It is the only option that keeps the
lint-enforced pure core and also gives each capability one place per layer.

## Key Decisions

- **Capability folders.** `host/`: `main/`, `worker/`, `tools/`, `review/`, `tuning/`, `commands/`
  and `platform/` (readiness, child registry, stores, main cwd, context, status). `policy/`: `main/`,
  `worker/`, `tools/`, `tuning/`, `review/`, with rules shared by several capabilities
  (`answers.ts`, `effort.ts`) at the `policy/` root. `setup.ts` stays at the `host/` root as the
  wiring point. *(Reviewer approved the layout; exact file placement is the design's.)*
- **Pure moves to policy.** A unit with no Pi import and no I/O belongs in `policy/<capability>/`;
  this moves the Wave 1 pure units and the existing pure host files named above.
- **Public surface is `index.ts`.** Code outside a capability folder imports only its `index.ts`;
  inside a folder, files import each other freely. Applies to `src/` and `scripts/`.
  `index.ts` lists named exports; no `export *`. *(My call: keeps the rule meaningful.)*
- **Tests mirror `src/`** for unit tests of moved files. Cross-cutting host and seam tests
  (`q*-*.test.ts`, harness, probes, manual) stay where they are. *(My call: those tests are about
  the host, not one capability.)*
- **History first.** Moves are committed alone (rename only), import rewrites in a following commit.
- **Order.** Spec delta and lint fixtures first (red), then `policy/`, then `host/`, then the rule
  goes green; the coding-standards Wave 2 continues afterwards inside the new folders.

## Open Questions

- None blocking. Exact placement of borderline files (for example `context.ts`, `skills.ts`,
  `rich.ts`) is settled in `design.md` from their import graph.
