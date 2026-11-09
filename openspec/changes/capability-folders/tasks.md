## 1. Import checks and fixtures

Blocked by: none

- [x] 1.1 Add `bad-`/`ok-` fixtures for every scenario of the three quality-checks requirements:
  canonical spellings under `tests/fixtures/boundaries/`, resolver-only spellings under
  `tests/fixtures/import-graph/`; rename `src/policy/sub/bad-parent.ts` to an `ok-` fixture
- [x] 1.2 Write the resolved-path import check and its test (real tree clean, both fixture trees,
  scanner cross-check against `Bun.Transpiler`, nesting limit); watch it fail, then pass
- [x] 1.3 Replace the host and policy overrides in `.oxlintrc.json` with per-depth overrides
  (design D5) and add the capability group to the entry point, `jev/` and `scripts/` overrides;
  `tests/boundaries.test.ts` passes
- [x] 1.4 Run `bun run lint`, `bun test tests/boundaries.test.ts tests/import-graph.test.ts` on the
  current tree: zero errors

## 2. Pure units into policy capability folders

Blocked by: 1

- [x] 2.1 `git mv` the `policy/` files into `main/`, `worker/`, `tools/`, `tuning/`, `review/` and the
  five pure host units into `policy/<capability>/` with the new names of design D1; commit with no
  content change
- [x] 2.2 Remove the outer-layer types from the moved pure units (design D3): advice block as a
  string, a local classifier reply type, `rubric` as an input, a local `Issue` type; adapt their
  host callers
- [x] 2.3 Add `index.ts` with named exports to each `policy/` capability folder; rewrite imports in
  `src/`, `scripts/replay/` and `tests/` to go through `index.ts` (tests may import internals)
- [x] 2.4 Move the unit tests of moved files to `tests/policy/<capability>/`, mirroring `src/`; fix
  the `review-cli` source path the moved test reads and drop the `review-cli.ts` lint override
- [x] 2.5 Typecheck, lint (capability rule included) and the full test suite pass

## 3. Host capability folders

Blocked by: 2

- [ ] 3.1 `git mv` the `host/` files into `platform/`, `status/`, `main/`, `worker/`, `tools/`,
  `review/`, `tuning/`, `commands/` with the new names of design D1; `setup.ts` stays at the root;
  commit with no content change
- [ ] 3.2 Add `index.ts` with named exports to each `host/` capability folder; rewrite imports in
  `src/` (including `src/extension.ts` → `host/setup.ts`) and `tests/`
- [ ] 3.3 Update `tests/host-stores.test.ts`, which locates `stores.ts` by path, and move unit
  tests of moved host files to `tests/host/<capability>/`; seam and integration tests stay (design D6)
- [ ] 3.4 Check every moved basename has no reference left at its old location
- [ ] 3.5 Typecheck, lint, format check and the full test suite pass; the extension still loads
  (`tests/load.test.ts`)

## 4. Documentation

Blocked by: 3

- [ ] 4.1 Update `docs/architecture.md`: module layout per capability folder, the capability rule
  under Dependency rules, and the pure-unit placement rule
- [ ] 4.2 Update `CONTRIBUTING.md`: where new code goes (layer, then capability folder; pure code in
  `policy/`; cross-capability use through `index.ts`)
- [ ] 4.3 Check every `src/...` path named in `docs/`, `CONTRIBUTING.md` and `README.md` exists,
  and that the `src/...` paths the `skill-delivery` and `skill-pick` deltas name exist (design D8)
