## Context

The layers (`host/`, `jev/`, `policy/`, `store/`, `shared/`) and their import directions are fixed by
`docs/architecture.md` and enforced by `.oxlintrc.json`, proven by `tests/boundaries.test.ts` over
`tests/fixtures/boundaries/`. Inside `host/` (40 files) and `policy/` (18 files) there is no
grouping. The import graph shows seven host capabilities plus shared plumbing, and five pure host
units: `main-line`, `main-record`, `main-outcome` (names a Pi and a `jev/` type), `worker-line`
(reads `RUBRIC_VERSION` from `jev/`), `tuning-text` (names `Issue` from `store/`) and `review-cli`
(guarded today by a file-specific lint override).

A spike against oxlint 1.91 (temp dir, not committed) showed that one `no-restricted-imports`
pattern pair, `["../*/*", "!../*/index.ts"]`, flags `../worker/route.ts` and allows
`../worker/index.ts`, `./gate.ts` and `../../policy/answers.ts`.

## Goals / Non-Goals

**Goals:**
- One folder per capability inside `host/` and `policy/`; capabilities used from outside only via
  `index.ts`, enforced by a resolved-path check in `bun run test` over `src/` and `scripts/`.
- Every pure decision rule and data transform under `policy/`.
- Behaviour, Pi seams, ledger lines and messages unchanged; full suite green after every commit
  except the rename-only `git mv` commits (D7).

**Non-Goals:**
- Splitting large functions (`worker.ts`, `commands.ts`, `setup.ts`): later refactor waves.
- Changing `jev/`, `store/`, `shared/` layout or any layer direction.

## Decisions

### D1. Folder map

`policy/` (pure):

| Folder | Files (old name → new name) |
|---|---|
| root (shared by several capabilities) | `answers.ts`, `effort.ts`, `launch.ts` |
| `main/` | `hold.ts`, `skill.ts`, `strategy.ts`, host `main-record.ts` → `record.ts`, host `main-line.ts` → `ledger-line.ts`, host `main-outcome.ts` → `outcome.ts` |
| `worker/` | `route.ts`, `tier.ts`, `score.ts`, `worker.ts` → `answers.ts`, `cutpoints.ts`, `cut-window.ts`, `seed.ts`, `modes.ts`, host `worker-line.ts` → `ledger-line.ts` |
| `tools/` | `tools.ts` → `assess.ts` |
| `tuning/` | `tuning.ts` → `rules.ts`, `tuning-window.ts` → `window.ts`, `tuning-signals.ts` → `signals.ts`, host `tuning-text.ts` → `text.ts` |
| `review/` | host `review-cli.ts` → `cli.ts` |

`host/` (Pi shell):

| Folder | Files |
|---|---|
| root | `setup.ts` (wiring; the only file `extension.ts` imports) |
| `platform/` | `readiness.ts`, `child.ts`, `stores.ts`, `main-cwd.ts`, `context.ts`, `agents.ts`, `models.ts` |
| `status/` | `status.ts` → `line.ts`, `tally.ts` |
| `main/` | `main.ts` → `create.ts`, `main-start.ts` → `start.ts`, `main-gate.ts` → `gate.ts`, `main-apply.ts` → `apply.ts`, `main-settled.ts` → `settled.ts`, `main-session.ts` → `session.ts`, `main-host.ts` → `host.ts`, `main-skills.ts` → `skills.ts`, `skills.ts` → `catalog.ts`, `rich.ts` |
| `worker/` | `worker.ts` → `routing.ts`, `cutpoint-window.ts` |
| `tools/` | `tools.ts` → `assessment.ts`, `tool-counts.ts` → `counts.ts`, `tool-facts.ts` → `facts.ts`, `tool-service.ts` → `service.ts` |
| `review/` | `review.ts` → `tool.ts` |
| `tuning/` | `tune-command.ts` → `command.ts`, `tuning-deps.ts` → `deps.ts`, `tuning-seen.ts` → `seen.ts`, `tuning-step.ts` → `step.ts` |
| `commands/` | `commands.ts` → `jev.ts`, `local-mode-command.ts` → `local-mode.ts`, `slots.ts` |

Why these borders: each folder matches a glossary/roadmap capability; a file goes where its users
are (`skills.ts`, `rich.ts` are used only by main; `agents.ts`, `models.ts` by worker, tools and
slot commands, so `platform/`). `effort.ts`, `answers.ts` and `launch.ts` are imported by three or
more capabilities and by `jev/`, so they stay at the `policy/` root rather than in one owner. A file
name no longer repeats its folder.

*Alternative considered:* `host/shared/` instead of `platform/`. Rejected because `shared/` is
already a top-level layer with a different meaning.

### D2. What counts as pure

A unit moves to `policy/` when it is a decision rule or data transform with no Pi import, no I/O,
no clock and no global state. Mutable session state stays in host even when it imports nothing from
Pi (`MainSession`, `cutpoint-window`, the `globalThis` handoffs in `child`, `main-cwd`,
`tools/counts`, `tools/service`): it is shell state, not a rule.

### D3. Pure units lose their outer-layer types

- `policy/main/outcome.ts`: the advice part of the plan becomes `adviceBlock: string | undefined`
  (the text of the `<execution_strategy>` block); `host/main` wraps it into the `jev-advice`
  message. The outcome input becomes a local
  `ClassifierReply = { kind: "ok"; ms: number; body: unknown } | { kind: "miss"; miss: string; reason: string; ms: number }`,
  which `JevOutcome` minus `cancelled` satisfies structurally; `Answered` is replaced by it.
- `policy/worker/ledger-line.ts`: takes `rubric: number` as input; `host/worker` passes
  `RUBRIC_VERSION`.
- `policy/tuning/text.ts`: declares `type Issue = { path: string; message: string }` locally; the
  store type is structurally identical.
- `policy/review/cli.ts`: the file-specific override in `.oxlintrc.json` is removed, because the
  `policy/` rule now covers it; `tests/host/review-cli.test.ts` "imports nothing from Pi" reads the
  new path.

### D4. Capability public surface

Each capability folder has an `index.ts` with named re-exports of what other folders use
(`export { createMain, type MainDeps } from "./create.ts";`). No `export *`, no logic in `index.ts`.
A single-file capability still has `index.ts` plus its file, so the rule has no exceptions.

### D5. Enforcement: a resolved-path check, with lint as early feedback

oxlint `no-restricted-imports` matches the **text** of a specifier, never the file it resolves to.
Three plan-review rounds kept finding spellings that slipped through (`./../worker/x.ts`,
`../.internal/x.ts`, `../../helper.ts` from `policy/`), and a `!` negation in one pattern group
was found to cancel matches of other groups. So the authoritative check resolves paths.

**Resolved-path check** (source `tests/support/import-graph.ts`, test `tests/import-graph.test.ts`):
- `moduleSpecifiers(source): string[]` — parses with TypeScript (`ts.createSourceFile`, devDependency
  `typescript` pinned at `6.0.3`, approved) and walks the AST for import and export declarations
  with a module specifier, `import x = require("…")`, `import("…")` calls (first argument; a
  non-literal argument yields the marker `<non-literal>`, which `checkImport` rejects before it
  treats bare names as packages) and
  `import("…").T` type nodes. String and no-substitution template literals give their decoded text.
  A regex, a hand-written lexer and `Bun.Transpiler` (which drops type-only imports) each failed
  review on new syntax; the parser passed every counterexample (20 cases), missed none of Bun's
  specifiers over `src/` + `scripts/`, and reads the repo in about 70 ms. TypeScript 7 (the Go port) has no
  in-process `createSourceFile`; its JS API is `unstable/` and runs a separate server over files on
  disk, so 6.0.3, the newest line with the stable in-process API, is pinned (spike: 20/20 cases). `Bun.Transpiler.scanImports` stays a cross-check.
- `locate(repoPath): Location` — `entry` (`src/extension*.ts`), `layer` (with `capability` for a
  file inside a direct subfolder of `host/` or `policy/`), `scripts`, `tests`, `outside` (anything
  else, including a non-layer module directly under `src/`).
- `checkImport(root, file, specifier): string | undefined` — specifier kinds: `@earendil-works/*`
  (Pi); another bare name (package, ignored); a relative path. Anything else (absolute path,
  `file:` URL) is a violation, and so is a relative path without a `.ts`/`.json` extension, so the
  text always names the file. Relative paths are resolved **lexically** with `node:path`
  `resolve`; the target need not exist (fixture trees name virtual files). Then, in order: a
  non-shortest relative path in `host/` or `policy/` (reason names the shortest path); a Pi import
  outside `host/`; a target outside the layers; a layer edge not allowed by `docs/architecture.md`;
  a capability target other than its `index.ts` from outside that capability.
- `importViolations(root, files): Promise<ImportViolation[]>`.
- Tests: the real `src/` + `scripts/` have no violation; the nesting limit (a pure
  `nestingViolations(paths): string[]` tested on given paths, then on the real tree); exact
  `{ file, specifier }` and reason assertions for representative violations; and set equality of
  violating files and `bad-` fixtures over **two fixture trees**: `tests/fixtures/boundaries/`
  (canonical spellings, checked by lint **and** this check, so both must agree) and
  `tests/fixtures/import-graph/` (spellings only this check must catch: `./../x`, `.internal`,
  round trips, `../../helper.ts` from `policy/`, a type-only deep import, an absolute path, an
  extensionless index).

A spike of this check over 101 fixtures (87 canonical, 14 resolver-only) matched exactly, and the
current tree has 0 violations; every relative import in `src/` and `scripts/` already carries `.ts`.

**Lint stays as early feedback**, for shortest-path spellings only (the narrowed living requirement): the existing layer overrides, split by
importer depth (`src/<layer>/*.ts`, `*/*.ts`, `*/*/*.ts`, because relative prefixes depend on depth),
each with the full layer rule set plus `deepInto(prefix) = ["<prefix>[!.]*/**", "!<prefix>[!.]*/index.ts"]`
for its own layer and, in `host/`, for `policy/`; `src/extension*.ts`, `src/jev/**` and
`scripts/**` gain one `deepInto` group. `[!.]*` never matches `..`, so a sibling pattern does not
swallow a parent path. The `policy/` layer group keeps today's
`["<src>**", "!<src>policy/**", "!<src>shared/**"]` shape. Lint is not required to catch
non-canonical spellings; the resolved-path check is. The spike (`/tmp/cs-scan/spike2/gen-final.ts`)
showed lint flags every canonical `bad-` fixture and none of the `ok-` ones.

Nesting inside a capability folder is limited to one level, and `jev/`, `store/` and `shared/`
stay flat (as today); `nestingViolations` fails on a `.ts` file deeper than
`src/{host,policy}/<cap>/<nested>/` or in any subfolder of the flat layers. That keeps every
importer at a depth the lint overrides cover: lint for the flat layers stays as it is.

The `src/host/review-cli.ts` override stays until Task 2 moves that file; while it exists it carries
the full host depth-0 rule set plus its Pi restriction.

The named-exports-only rule for `index.ts` (D4) is checked in code review, listed in the plan's
review focus.

*Alternatives considered:* `eslint-plugin-boundaries` or `dependency-cruiser` (a second lint tool
with its own config); lint-only with more conventions (each round found another spelling); a
hand-written reader (three review rounds broke it).

### D6. Tests

A test whose name matches a moved file moves to the mirrored path
(`tests/host/main-gate.test.ts` → `tests/host/main/gate.test.ts`,
`tests/policy/route.test.ts` → `tests/policy/worker/route.test.ts`). Seam and integration tests
that cover more than one capability (`q*-*.test.ts`, `harness*`, `probes/`, `manual/`,
`main.test.ts`, `main-effort.test.ts`, `setup.test.ts`, `worker-routing.test.ts`,
`tool-assessment.test.ts`, …) stay. Fixtures for the new rule go into
`tests/fixtures/boundaries/src/{host,policy}/<cap>/` (canonical cases) and
`tests/fixtures/import-graph/` (resolver-only cases), with the `bad-`/`ok-` naming the harness
already reads; `.oxlintrc.json` already ignores `tests/fixtures/**`.

### D7. Commit shape

1. Fixtures, the resolved-path check and lint patterns, each written red then green; one commit.
2. `git mv` only, per layer (`policy/`, then `host/`, then tests): no content change, so
   `git log --follow` keeps history.
3. Import rewrites, `index.ts` files and the D3 type changes, per layer; suite green.
4. Docs.

### D8. Living specs that name a moved path

`skill-delivery` (*Host wiring only*) and `skill-pick` (*Pure and Pi-free*) name
`src/policy/skill.ts`, which becomes `src/policy/main/skill.ts`. Their requirements are updated
by delta (path only, meaning unchanged), so archive syncs them.

## Risks / Trade-offs

- [A `git mv` commit does not type-check on its own] → the move and its import rewrite land in
  consecutive commits; bisect uses the rewrite commits. Accepted for traceable history.
- [oxlint glob semantics change between versions] → pinned 1.91.0; the lint fixture test fails on drift, and the resolved-path check does not depend on oxlint.
- [The reader misses an import form] → it is TypeScript's own parser; unit cases cover every form and every trap the reviews found, and a cross-check asserts it finds everything `Bun.Transpiler.scanImports` finds over `src/` and `scripts/`.
- [A new devDependency] → dev only, exact pin, used by one test file; `bun install --frozen-lockfile` in CI keeps it reproducible.
- [`index.ts` grows into a barrel] → named exports only (D4); reviewers check additions.
- [A borderline file lands in the wrong folder] → placement follows users in the import graph
  (D1); moving it later is a rename inside one layer.
- [Pure units' plain types diverge from the outer types] → `host/` passes the outer value into the
  pure function, so the type checker proves structural compatibility at every call.

## Migration Plan

Source-only; nothing ships differently. Rollback is a revert of the branch.

## Open Questions

None.
