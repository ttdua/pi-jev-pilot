## Why

Inside each layer nothing groups a capability: `src/host/` is 40 flat files for seven capabilities,
found only by filename prefix, and five pure units sit in `host/`, where lint cannot keep them pure.
The coding-standards refactor is about to split worker routing and the `/jev` command, which would
add more prefixed files, so the folder convention has to be settled first. With one folder per
capability per layer, a capability is found in one place and every pure unit is under the existing
`policy/` lint rule.

## What Changes

**Source layout inside layers**
- From: `src/host/` and `src/policy/` are flat; capabilities are told apart by filename prefix.
- To: `src/host/<capability>/` (`main`, `worker`, `tools`, `review`, `tuning`, `commands`, plus
  `platform` for shared host plumbing) and `src/policy/<capability>/` (`main`, `worker`, `tools`,
  `tuning`, `review`), with rules shared by several capabilities at the `policy/` root.
- Reason: discoverability; one place per capability per layer.
- Impact: non-breaking; file moves and import rewrites only. No behaviour, seam, ledger, settings
  or message change.

**Pure units out of host**
- From: `host/main-outcome.ts`, `host/main-line.ts`, `host/worker-line.ts`, `host/tuning-text.ts`,
  `host/review-cli.ts` are pure but live in `host/`.
- To: they live under `policy/<capability>/`, so the `policy/` boundary rule keeps them pure.
- Reason: the architecture principle "policy/ is pure; only host/ touches Pi" becomes lint-checked
  for them.
- Impact: non-breaking. A pure unit that today names a Pi or `jev/` type gets a plain type instead.

**Cross-capability imports**
- From: any file may import any other file of the same layer.
- To: a file outside a capability folder imports that capability only through its `index.ts`
  (named exports only); a resolved-path check in `bun run test` fails on a deep import, whatever its
  spelling, and lint flags the plain spelling early. Files inside one folder import each other freely.
- Reason: keeps each capability's public surface small and its internals free to change.
- Impact: non-breaking for users; new check failures only for code that reaches into another
  capability's internals.

**Tests**
- Unit tests of moved files follow `src/` folders; cross-cutting host and seam tests stay in place.

The layer direction rules (`host` → `jev`/`policy`/`store`/`shared`, `jev` → `policy`/`shared`, …),
`jev/`, `store/` and `shared/` are unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `quality-checks`: adds three requirements, checked on resolved paths by `bun run test`: capability
  folders are entered only through their `index.ts`; layer rules hold whatever the spelling; relative
  imports in `host/` and `policy/` take the shortest path. Lint keeps flagging the plain spellings. *Dependency boundaries are enforced by lint* is narrowed to the shortest-path
  spelling, since the resolved-path check now covers every spelling; *Pi imports are confined to
  host* keeps its text.
- `skill-delivery`: *Host wiring only* names `src/policy/main/skill.ts` instead of
  `src/policy/skill.ts`; meaning unchanged.
- `skill-pick`: *Pure and Pi-free* names `src/policy/main/skill.ts` in its scenario; meaning
  unchanged.

## Impact

- **Code**: about 45 files under `src/host/` and `src/policy/` move; imports change in `src/`,
  `scripts/replay/` and `tests/`. `src/extension.ts` keeps importing `host/setup.ts`.
- **Checks**: a resolved-path import check (`tests/support/import-graph.ts`, its test and
  `tests/fixtures/import-graph/`); `.oxlintrc.json` gains per-depth `no-restricted-imports` patterns;
  `tests/fixtures/boundaries/` gains good and bad cross-capability fixtures.
- **Tests that locate source by path**: `tests/host-stores.test.ts`, `tests/host/review-cli.test.ts`,
  `tests/manifest.test.ts`, `tests/store/boundaries.test.ts`, `tests/boundaries.test.ts`.
- **Dependencies**: one devDependency, `typescript` pinned at `6.0.3`, used only by the import check
  in `tests/support/import-graph.ts` (approved by the reviewer; nothing ships with the package).
- **Docs updated**: `docs/architecture.md` (module layout, dependency rules), `CONTRIBUTING.md`
  (where code goes).
