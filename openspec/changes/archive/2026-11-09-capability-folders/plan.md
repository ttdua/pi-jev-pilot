# Capability Folders Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Group `src/host/` and `src/policy/` into one folder per capability, move pure units into
`policy/`, and make the checks fail on deep imports across capability folders — with no behaviour
change.

**Architecture:** Layers and their import directions stay. Inside `host/` and `policy/`, each
capability gets a folder whose `index.ts` (named re-exports only) is its public surface. A
resolved-path import check in `bun run test` is the authoritative boundary check (capability entry,
layer edges, shortest paths); oxlint `no-restricted-imports` patterns give early feedback on plain
spellings. Moves are `git mv`-only commits, followed by import-rewrite commits.

**Tech Stack:** TypeScript, Bun 1.4.4 (`bun test`, `bun check`, `Bun.Transpiler`), `typescript` 6.0.3
(parser for the import check), oxlint 1.91.0, oxfmt 0.76.0.

## Global Constraints

- No behaviour change: Pi seams, ledger lines (fields and key order), settings, `/jev` output and
  messages stay byte-identical. The full suite (2043 tests at base) stays green after every commit
  except the rename-only `git mv` commits (design D7).
- No new runtime dependency. One devDependency: `typescript` at exactly `6.0.3` (approved), imported
  only by `tests/support/import-graph.ts`.
- The specified layer edges of `quality-checks` stay exactly as written.
- `index.ts`: named re-exports only (`export { a, type B } from "./x.ts";`); no `export *`, no logic.
- Tests need no secrets, paid calls or network beyond loopback.
- `bun run lint` keeps its `--max-warnings` cap (53); the cap may only go down.
- Docs and code in English.

## Review Focus

1. **A re-export that changes identity.** `index.ts` must re-export the same binding; a module with
   global state (`child.ts` registry, `main-cwd.ts`, `tools/counts.ts`, `tools/service.ts` on
   `globalThis` via `Symbol.for`) must exist once. Checked by the existing child, tool-service,
   tool-counts and setup tests passing unchanged in content.
2. **A path read from disk.** Tests that build `src/...` paths (`tests/host-stores.test.ts`, the
   `review-cli` "imports nothing from Pi" test) must point at the new paths; a stale path makes a test
   pass vacuously. Each is fixed in the task that moves its file (Task 2: `review-cli`; Task 3:
   `stores`); Task 3 step 5 checks moved basenames as path segments.
3. **A moved pure unit that quietly changes type.** D3 swaps outer types for local ones; a field
   rename would silently drop a ledger field. Covered by the unchanged `tests/host/main.test.ts`,
   `worker-ledger.test.ts` and the key-order tests in `tests/policy/main/ledger-line.test.ts`.
4. **An import form the scanner misses.** The resolved-path check is only as good as
   `moduleSpecifiers`; Task 1 cross-checks it against `Bun.Transpiler.scanImports` over all of `src/`
   and `scripts/`, and adds a type-only fixture the transpiler would miss.
5. **A barrel creeping in.** Reviewers check each `index.ts` against the D4 rule; Task 3 step 6
   greps for `export \*` in `src/`.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `moduleSpecifiers` (`tests/support/import-graph.ts`) | new | `moduleSpecifiers(source: string): string[]` — `ts.createSourceFile(name, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)` + AST walk (design D5): import/export declarations with a specifier, `import x = require("…")`, `import("…")` calls (first argument; non-literal → `"<non-literal>"`), `import("…").T` type nodes; string and no-substitution template literals give decoded text | no (test support) |
| `package.json` devDependencies | modified | adds `"typescript": "6.0.3"` (exact) | no |
| `checkImport` on `"<non-literal>"` | new | checked before the bare-package branch; reason `"Import with a string literal."` | no |
| `Location` | new | `{ kind: "entry" } \| { kind: "layer"; layer: "host" \| "jev" \| "policy" \| "store" \| "shared"; capability: string \| undefined; file: string } \| { kind: "scripts" } \| { kind: "tests" } \| { kind: "outside" }` | no |
| `locate` | new | `locate(repoPath: string): Location`; `capability` set only for a file inside a direct subfolder of `src/host/` or `src/policy/` | no |
| `ImportViolation` | new | `{ file: string; specifier: string; reason: string }` | no |
| `checkImport` | new | `checkImport(root: string, file: string, specifier: string): string \| undefined` — `@earendil-works/*` = Pi; other bare name = package (ignored); absolute path or `file:` URL → violation; relative without `.ts`/`.json` → violation; relative resolved lexically (target need not exist). Then in order: non-shortest relative path in `host/`/`policy/` (reason contains the shortest path); Pi outside `host/`; target `outside`/`tests`; layer edge not in `docs/architecture.md`; capability target ≠ `<cap>/index.ts` from outside that capability | no |
| `nestingViolations` | new | `nestingViolations(repoPaths: readonly string[]): string[]` — paths under `src/host/` or `src/policy/` more than three segments below the layer folder, and paths in a subfolder of `src/jev/`, `src/store/` or `src/shared/` | no |
| `importViolations` | new | `importViolations(root: string, files: readonly string[]): Promise<ImportViolation[]>` | no |
| `.oxlintrc.json` layer overrides | modified | `src/host/**` and `src/policy/**` overrides replaced by one override per importer depth 0–2, each with the full layer rule set plus `deepInto`; `src/extension*.ts`, `src/jev/**`, `scripts/**` gain one `deepInto` group; the `src/host/review-cli.ts` override is removed in Task 2 | no (repo tooling) |
| `deepInto(prefix)` lint group | new | `{ group: ["<prefix>[!.]*/**", "!<prefix>[!.]*/index.ts"], message: "Use the capability's index.ts." }` | no |
| Capability `index.ts` (each folder in D1) | new | named re-exports of the symbols other folders import today | no (internal module surface) |
| `ClassifierReply` (`policy/main/outcome.ts`) | new, replaces `Answered` | `{ kind: "ok"; ms: number; body: unknown } \| { kind: "miss"; miss: string; reason: string; ms: number }` | no |
| `planOutcome` (`policy/main/outcome.ts`) | modified | `planOutcome(flags: OutcomeFlags, outcome: ClassifierReply, read: ReadResult \| undefined, currentAdvice: Strategy \| undefined): OutcomePlan` | no |
| `OutcomePlan` advice | modified | each variant's `message: BeforeAgentStartEventResult \| undefined` → `adviceBlock: string \| undefined`; `host/main/apply.ts` builds `{ message: { customType: "jev-advice", content: adviceBlock, display: false } }` | no |
| `decisionFields` (`policy/worker/ledger-line.ts`) | modified | `decisionFields(input: { answers: WorkerAnswers \| undefined; offered: readonly TierName[]; tierQuestion: boolean; rubric: number }): DecisionFields`; `host/worker/routing.ts` passes `RUBRIC_VERSION` | no |
| `Issue` (`policy/tuning/text.ts`) | new (local) | `{ path: string; message: string }`, structurally equal to `store/validate.ts` `Issue` | no |

Package exports, Pi seams, ledger schema and CLI are unchanged.

Spikes: the resolved-path check (`/tmp/cs-scan/spike6/boundaries2.ts` with the TypeScript reader
`ts-specifiers.ts`) matched 101 fixtures (87 canonical, 14 resolver-only; `bad-non-literal` is added by Task 1) and finds 0 violations in
today's tree; the lint generator (`/tmp/cs-scan/spike2/gen-final.ts`) flags every
canonical `bad-` fixture and no `ok-` one.

---

## Task 1: Import checks and fixtures — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4
**Difficulty:** Hard
**Blocked by:** none

**Files:**
- Create: `tests/support/import-graph.ts`, `tests/import-graph.test.ts`
- Modify: `package.json`, `bun.lock` (`bun add -d -E typescript@6.0.3`)
- Create fixtures, one import each (`→` gives the import). Under `tests/fixtures/boundaries/`
  (canonical spellings; lint and the resolved-path check must both flag exactly the `bad-` ones):
  - `src/host/main/`: `bad-sibling` → `../worker/routing.ts`; `bad-sibling-nested-index` →
    `../worker/nested/index.ts`; `bad-cross-layer` → `../../policy/main/outcome.ts`;
    `bad-policy-nested-index` → `../../policy/worker/nested/index.ts`; `bad-extension` →
    `../../extension.ts`; `bad-underscore-cap` → `../_internal/file.ts`; `ok-sibling-index` →
    `../worker/index.ts`; `ok-own-index` → `./index.ts`; `ok-own-file` → `./gate.ts`;
    `ok-own-nested` → `./nested/helper.ts`; `ok-policy-root` → `../../policy/answers.ts`;
    `ok-policy-index` → `../../policy/main/index.ts`; `ok-store` → `../../store/ledger.ts`;
    `ok-jev` → `../../jev/state.ts`
  - `src/host/main/nested/`: `bad-nested-sibling` → `../../worker/routing.ts`;
    `bad-nested-cross-layer` → `../../../policy/main/outcome.ts`; `ok-nested-own` → `../gate.ts`;
    `ok-nested-own-other` → `../other/helper.ts`
  - `src/host/`: `bad-root-deep` → `./main/start.ts`; `bad-root-nested-index` →
    `./main/nested/index.ts`; `bad-root-policy-deep` → `../policy/main/outcome.ts`; `ok-root-index`
    → `./main/index.ts`; `ok-root-policy-index` → `../policy/main/index.ts`; `ok-root-policy-root`
    → `../policy/answers.ts`
  - `src/policy/main/`: `bad-sibling` → `../worker/route.ts`; `bad-host-index` →
    `../../host/main/index.ts`; `bad-store` → `../../store/ledger.ts`; `ok-policy-root` →
    `../answers.ts`; `ok-sibling-index` → `../worker/index.ts`; `ok-shared` → `../../shared/text.ts`
  - `src/policy/main/nested/`: `bad-nested-host` → `../../../host/main/index.ts`; `bad-nested-jev` →
    `../../../jev/state.ts`; `ok-nested-shared` → `../../../shared/text.ts`; `ok-nested-root` →
    `../../answers.ts`
  - `src/policy/`: `bad-root-deep` → `./worker/route.ts`; `bad-root-store` → `../store/ledger.ts`;
    `ok-root-index` → `./main/index.ts`; `ok-root-local` → `./answers.ts`
  - `src/jev/`: `bad-policy-deep` → `../policy/worker/route.ts`; `ok-policy-index` →
    `../policy/worker/index.ts`; `ok-policy-root` → `../policy/answers.ts`
  - `scripts/replay/`: `bad-src-deep` → `../../src/policy/worker/route.ts`; `ok-src-index` →
    `../../src/policy/worker/index.ts`; `ok-src-root` → `../../src/policy/answers.ts`
  - `src/`: `extension-bad-capability` → `./host/main/start.ts`; `extension-ok-cap-index` →
    `./host/main/index.ts`
  - Rename `src/policy/sub/bad-parent.ts` → `src/policy/sub/ok-parent-in-layer.ts`. Existing
    fixtures keep their file and expectation.
- Create fixtures under `tests/fixtures/import-graph/` (spellings only the resolved-path check must
  catch): `src/host/main/bad-noncanonical-sibling` → `./../worker/routing.ts`;
  `src/host/main/bad-dot-cap` → `../.internal/file.ts`; `src/host/main/bad-type-only-deep` →
  `import type { X } from "../worker/routing.ts";`; `src/policy/main/bad-absolute` →
  `/repo/src/host/main/start.ts`; `src/host/main/bad-extensionless-index` → `../worker/index`;
  `src/host/main/bad-non-literal` → `const target = "../worker/routing.ts"; await import(target);`;
  `src/host/main/bad-own-via-parent` →
  `../main/gate.ts`; `src/host/main/bad-roundtrip` → `../../host/worker/index.ts`;
  `src/host/bad-root-roundtrip` → `../host/main/index.ts`; `src/policy/main/bad-roundtrip` →
  `../../policy/worker/route.ts`; `src/policy/main/nested/bad-nested-roundtrip` →
  `../../../policy/answers.ts`; `src/policy/main/bad-src-helper` → `../../helper.ts`;
  `src/policy/bad-root-src-helper` → `../helper.ts`; `src/host/main/ok-type-only-index` →
  `import type { X } from "../worker/index.ts";`
- Modify: `.oxlintrc.json`, `tests/boundaries.test.ts` (unchanged logic; it now also sees the new
  canonical fixtures)

**Interfaces:** Produces `moduleSpecifiers`, `locate`, `checkImport`, `importViolations`,
`nestingViolations`,
`.oxlintrc.json` layer overrides, `deepInto`.

- [ ] **Step 1:** Run `bun add -d -E typescript@6.0.3`; check `package.json` shows `"typescript": "6.0.3"`
  under `devDependencies`. Write both fixture trees and rename the `policy/sub/bad-parent.ts` fixture.
- [ ] **Step 2:** Write `tests/import-graph.test.ts` with these tests:
  - `"source and scripts have no import violation"`: `importViolations(REPO_ROOT, <all .ts under src/ and scripts/>)` is `[]`.
  - `"the canonical fixtures violate exactly where named bad-"` over `tests/fixtures/boundaries`
    (root = that folder) and `"the resolver-only fixtures violate exactly where named bad-"` over
    `tests/fixtures/import-graph`: set of violating files equals set of files whose name
    includes `bad-`.
  - `"the scanner reads every import form"`: `moduleSpecifiers` of `import type { A } from "./a.ts";`,
    `import type D from "./d.ts";`, `import type * as N from "./n.ts";`,
    `import { type B as C, c } from "./b.ts"; c;`, `export type { E } from "./e.ts";`,
    `export { f } from "./f.ts";`, `import "./g.ts";`, `await import("./h.ts");` returns each path.
  - `"the scanner ignores strings, templates and comments"`: `const s = 'import("./x.ts")';`,
    a template holding `import { q } from './y.ts';`, a regex `/"import "x"/`, `{ from: "./o.ts" }`
    and `// import "./z.ts";` give `[]`; `const a = "/*";\nimport type { X } from "./w.ts";\nconst b = "*/";`
    gives `["./w.ts"]`.
  - `"the scanner reads clauses with comments and odd names"`: `// import type\nimport { r } from "./r.ts";`,
    `import /* c */ type { R } from "./c1.ts";`, `import { type /* c */ R } from "./c2.ts";` and
    `import type from "./t.ts"; type();` give `./r.ts`, `./c1.ts`, `./c2.ts`, `./t.ts`.
  - `"the scanner reads every TypeScript import syntax"`: `const r = 1 / 2; import type { R } from "./div.ts";`
    gives `./div.ts`; ``String.raw`if (ok) /import\("\.\.\/x.ts"\)/.test(s); import type { T } from "./t2.ts";` ``
    gives `["./t2.ts"]`; ``String.raw`import type { R } from "\u002e\u002e/w/r.ts";` `` gives `../w/r.ts`
    (sources with backslashes are written with `String.raw` so the test harness does not decode
    them first); ``import(`./tpl.ts`)`` gives
    `./tpl.ts`; `import X = require("./eq.ts");` and `import type Y = require("./teq.ts");` give their
    paths; `import("./opt.ts", { with: { type: "json" } })` gives `./opt.ts`;
    `let v: import("./it.ts").T;` gives `./it.ts`; `export * as ns from "./s.ts";` gives `./s.ts`;
    `const m = "./a.ts"; await import(m);` gives `["<non-literal>"]`.
  - `"the scanner finds every import the transpiler finds"`: for each `.ts` in `src/` and
    `scripts/`, every `new Bun.Transpiler({ loader: "ts" }).scanImports(text)` path is in
    `moduleSpecifiers(text)`.
  - `"violations name the file, the import and the fix"`: over the resolver-only tree,
    `bad-noncanonical-sibling.ts` gives `{ file: "src/host/main/bad-noncanonical-sibling.ts", specifier: "./../worker/routing.ts" }`
    with a reason containing `../worker/routing.ts`; `bad-type-only-deep.ts` gives specifier
    `../worker/routing.ts` with a reason containing `host/worker/index.ts`;
    `src/policy/main/nested/bad-nested-roundtrip.ts` gives a reason containing `../../answers.ts`;
    `src/host/main/bad-own-via-parent.ts` a reason containing `./gate.ts` (round trips name the
    shortest path); `bad-non-literal.ts` gives `{ specifier: "<non-literal>", reason: "Import with a string literal." }`.
  - `"capability folders nest at most one level and other layers stay flat"`:
    `nestingViolations(["src/host/main/a/b/x.ts", "src/host/main/a/y.ts", "src/policy/x.ts", "src/jev/sub/x.ts", "src/store/x.ts"])`
    is `["src/host/main/a/b/x.ts", "src/jev/sub/x.ts"]`, and `nestingViolations(<all .ts under src/>)` is `[]`.
- [ ] **Step 3:** Run `bun test tests/import-graph.test.ts`. Expected: FAIL — module
  `tests/support/import-graph.ts` not found.
- [ ] **Step 4:** Implement `tests/support/import-graph.ts` per the Contracts (design D5). Layer
  edges as a table: `host` → host, jev, policy, store, shared; `jev` → jev, policy, shared;
  `policy` → policy, shared; `store` → store, shared; `shared` → shared; entry point → host only;
  `scripts` → anything but host, store and the entry point.
- [ ] **Step 5:** Run `bun test tests/import-graph.test.ts`. Expected: PASS.
- [ ] **Step 6:** Run `bun test tests/boundaries.test.ts`. Expected: FAIL — the new canonical
  `bad-` fixtures are not flagged by lint, and `ok-parent-in-layer.ts` is.
- [ ] **Step 7:** Replace the `src/host/**` and `src/policy/**` overrides of `.oxlintrc.json` with
  one override per importer depth (`src/<layer>/*.ts`, `src/<layer>/*/*.ts`,
  `src/<layer>/*/*/*.ts`), each with the full layer rule set (keep each existing `message`; the
  `policy/` group becomes `["<src>**", "!<src>policy/**", "!<src>shared/**"]` with
  `<src>` = `../` × (depth + 1)) plus `deepInto` for its own layer (`./` at depth 0, `../` × depth
  otherwise) and, in `host/`, `deepInto("<src>policy/")`. Add `deepInto("./host/")` to
  `src/extension*.ts`, `deepInto("../policy/")` to `src/jev/**`, `deepInto("**/src/policy/")` to
  `scripts/**`. Keep the `src/host/review-cli.ts` override after the host overrides, carrying the
  full host depth-0 rule set plus its Pi restriction.
- [ ] **Step 8:** Run `bun test tests/boundaries.test.ts tests/import-graph.test.ts`. Expected: PASS.
- [ ] **Step 9:** Run `bun run lint`. Expected: exit 0, warnings ≤ 53.
- [ ] **Step 10:** Commit `test(checks): check capability and layer imports on resolved paths`.

---

## Task 2: Pure units into policy capability folders — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4, 2.5
**Difficulty:** Hard
**Blocked by:** Task 1

**Files:**
- Move (`git mv`, design D1): `src/policy/{hold,skill,strategy}.ts` → `src/policy/main/`;
  `src/host/main-record.ts` → `src/policy/main/record.ts`; `src/host/main-line.ts` →
  `src/policy/main/ledger-line.ts`; `src/host/main-outcome.ts` → `src/policy/main/outcome.ts`;
  `src/policy/{route,tier,score,cutpoints,cut-window,seed,modes}.ts` → `src/policy/worker/`;
  `src/policy/worker.ts` → `src/policy/worker/answers.ts`; `src/host/worker-line.ts` →
  `src/policy/worker/ledger-line.ts`; `src/policy/tools.ts` → `src/policy/tools/assess.ts`;
  `src/policy/tuning.ts` → `src/policy/tuning/rules.ts`; `src/policy/tuning-window.ts` →
  `src/policy/tuning/window.ts`; `src/policy/tuning-signals.ts` → `src/policy/tuning/signals.ts`;
  `src/host/tuning-text.ts` → `src/policy/tuning/text.ts`; `src/host/review-cli.ts` →
  `src/policy/review/cli.ts`. Root stays: `answers.ts`, `effort.ts`, `launch.ts`.
- Create: `src/policy/{main,worker,tools,tuning,review}/index.ts`
- Modify: importers in `src/host/`, `src/jev/`, `scripts/replay/`, `tests/`
- Move tests (old → new, all under `tests/`):
  `policy/hold` → `policy/main/hold`; `policy/skill` → `policy/main/skill`;
  `policy/strategy` → `policy/main/strategy`; `host/main-line` → `policy/main/ledger-line`;
  `host/main-outcome` → `policy/main/outcome`; `policy/route` → `policy/worker/route`;
  `policy/tier` → `policy/worker/tier`; `policy/score` → `policy/worker/score`;
  `policy/cutpoints` → `policy/worker/cutpoints`; `policy/cut-window` → `policy/worker/cut-window`;
  `policy/modes` → `policy/worker/modes`; `policy/worker` → `policy/worker/answers`;
  `host/worker-line` → `policy/worker/ledger-line`; `policy/tools` → `policy/tools/assess`;
  `policy/tuning` → `policy/tuning/rules`; `policy/tuning-window` → `policy/tuning/window`;
  `policy/tuning-signals` → `policy/tuning/signals`; `host/tuning-text` → `policy/tuning/text`;
  `host/review-cli` → `policy/review/cli` (each `.test.ts`); helper `policy/tuning-lines.ts` →
  `policy/tuning/lines.ts`. Stay: `policy/{answers,effort,launch,clamp-parity,tuning-seam}.test.ts`
  (`tuning-seam` checks policy/store compatibility, a seam test).
- Modify: `tests/policy/review/cli.test.ts` path read `join(REPO_ROOT, "src", "host",
  "review-cli.ts")` → `join(REPO_ROOT, "src", "policy", "review", "cli.ts")`; `.oxlintrc.json`
  removes the `src/host/review-cli.ts` override

**Interfaces:**
- Consumes: Task 1 lint patterns.
- Produces: `ClassifierReply`, `OutcomePlan` advice (`adviceBlock`), `decisionFields` with
  `rubric`, local `Issue`; `policy/<cap>/index.ts` exports used by Task 3.

- [ ] **Step 1:** `git mv` the source files and their unit tests listed above. Commit
  `refactor(policy): move files into capability folders` with no content change
  (`git diff --cached -M --stat` shows renames only).
- [ ] **Step 2:** Write the failing tests for D3 (contracts `planOutcome`, `OutcomePlan` advice,
  `decisionFields`): in `tests/policy/main/outcome.test.ts` assert
  `planOutcome(...).adviceBlock` equals `strategyBlock("delegate")` for an advised strategy and is
  `undefined` otherwise; in `tests/policy/worker/ledger-line.test.ts` pass `rubric: 7` and expect
  `{ rubric: 7, expertOffered: true, score: 1.25 }`. Add `Object.keys` order assertions to
  `ledger-line.test.ts` of `main/` if missing.
- [ ] **Step 3:** Run `bun test tests/policy/main tests/policy/worker`. Expected: FAIL on the new
  assertions (and on unresolved imports).
- [ ] **Step 4:** Implement D3 in the moved files: `outcome.ts` drops the Pi and `jev/` imports, uses
  `ClassifierReply`, returns `adviceBlock`; `host/main-apply.ts` and `host/main-start.ts` wrap the
  block into the `jev-advice` message; `worker/ledger-line.ts` takes `rubric` and `host/worker.ts`
  passes `RUBRIC_VERSION`; `tuning/text.ts` declares the local `Issue`.
- [ ] **Step 5:** Write each `policy/<cap>/index.ts` with the named exports other folders import
  (derive the list with `bun run lint` errors after step 6). Rewrite imports: within a capability
  folder use `./x.ts`; from elsewhere use `index.ts`; root files via `../answers.ts` etc.
- [ ] **Step 6:** Fix the `review-cli` path read and drop its `.oxlintrc.json` override (see Files).
- [ ] **Step 7:** Run `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test`.
  Expected: all exit 0; test count ≥ base; lint warnings ≤ 53.
- [ ] **Step 8:** Commit `refactor(policy): import capabilities through index.ts and drop outer types`.

---

## Task 3: Host capability folders — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4, 3.5
**Difficulty:** Hard
**Blocked by:** Task 2

**Files:**
- Move (`git mv`, design D1): to `src/host/platform/`: `readiness, child, stores, main-cwd, context,
  agents, models`; to `src/host/status/`: `status.ts` → `line.ts`, `tally.ts`; to `src/host/main/`:
  `main.ts` → `create.ts`, `main-start` → `start`, `main-gate` → `gate`, `main-apply` → `apply`,
  `main-settled` → `settled`, `main-session` → `session`, `main-host` → `host`, `main-skills` →
  `skills`, `skills.ts` → `catalog.ts`, `rich.ts`; to `src/host/worker/`: `worker.ts` →
  `routing.ts`, `cutpoint-window.ts`; to `src/host/tools/`: `tools.ts` → `assessment.ts`,
  `tool-counts` → `counts`, `tool-facts` → `facts`, `tool-service` → `service`; to
  `src/host/review/`: `review.ts` → `tool.ts`; to `src/host/tuning/`: `tune-command` → `command`,
  `tuning-deps` → `deps`, `tuning-seen` → `seen`, `tuning-step` → `step`; to `src/host/commands/`:
  `commands.ts` → `jev.ts`, `local-mode-command` → `local-mode`, `slots.ts`. `setup.ts` stays.
- Create: `src/host/{platform,status,main,worker,tools,review,tuning,commands}/index.ts`
- Modify: `src/host/setup.ts`; `tests/host-stores.test.ts` path `join(REPO_ROOT, "src", "host",
  "stores.ts")` → `join(REPO_ROOT, "src", "host", "platform", "stores.ts")`. `src/extension.ts`
  keeps `./host/setup.ts`
- Move tests (old → new, under `tests/host/`, each `.test.ts`): `main-gate` → `main/gate`;
  `main-session` → `main/session`; `main-skills` → `main/skills`; `main-timing` → `main/timing`;
  `skills` → `main/catalog`; `rich` → `main/rich`; `tool-counts` → `tools/counts`;
  `tool-facts` → `tools/facts`; `tool-service` → `tools/service`; `tools` → `tools/assessment`;
  `tune-command` → `tuning/command`; `tuning-seen` → `tuning/seen`; `tuning-step` →
  `tuning/step`; `agents` → `platform/agents`; `models` → `platform/models`; `readiness` →
  `platform/readiness`; `context` → `platform/context`; `child` → `platform/child`; `status` →
  `status/line`; `tally` → `status/tally`; `commands` → `commands/jev`; `slots` →
  `commands/slots`; `cutpoint-window` → `worker/cutpoint-window`; `review` → `review/tool`. Stay: `q*-*`, `harness*`, `probes/`, `manual/`, `main.test.ts`,
  `main-effort.test.ts`, `setup.test.ts`, `worker*.test.ts`, `tool-assessment.test.ts`,
  `review-tool.test.ts`, `cli-review.test.ts`, `skill-delivery.test.ts`, `strategy-advice.test.ts`,
  `effort-hold.test.ts`, `directory-mode-e2e.test.ts`, `evidence.test.ts`, `fixture*`, `jev-base*`,
  `tuning-host.test.ts`, `verbose-log.test.ts`, `rpc*`, `bodies.ts`, `*-fakes.ts`.

**Interfaces:**
- Consumes: `policy/<cap>/index.ts` exports from Task 2.
- Produces: `host/<cap>/index.ts`; `setup.ts` imports only `index.ts` files.

- [ ] **Step 1:** `git mv` the host files and their unit tests listed above. Commit
  `refactor(host): move files into capability folders` with no content change.
- [ ] **Step 2:** Write each `host/<cap>/index.ts` with named exports of what other folders and
  `setup.ts` import; rewrite imports in `src/host/`.
- [ ] **Step 3:** Rewrite imports in `tests/` and fix the `tests/host-stores.test.ts` path read
  (see Files). `tests/manifest.test.ts` scans `src/` recursively and needs no change.
- [ ] **Step 4:** Run `bun run lint` and `bun test tests/boundaries.test.ts tests/import-graph.test.ts`.
  Expected: exit 0; no import violation and no nesting violation in the moved tree.
- [ ] **Step 5:** For every moved basename (old names from Task 2 and Task 3 move lists, e.g.
  `main-gate`, `review-cli`, `tool-counts`, `tuning-text`), run
  `git grep -nwE "<basename>(\.ts)?" -- src scripts tests` and `git grep -n '"<basename>.ts"' -- tests`
  (catches `join(...)` path segments). Expected: no hit that names the old location.
- [ ] **Step 6:** Run `git grep -n "export \*" -- src`. Expected: no output.
- [ ] **Step 7:** Run `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test`
  (includes `tests/load.test.ts` and `tests/boundaries.test.ts`). Expected: all exit 0; test count ≥
  base; lint warnings ≤ 53.
- [ ] **Step 8:** Commit `refactor(host): import capabilities through index.ts`.

---

## Task 4: Documentation — implements 4

**Covers:** 4.1, 4.2, 4.3
**Difficulty:** Easy
**Blocked by:** Task 3

**Files:**
- Modify: `docs/architecture.md`, `CONTRIBUTING.md`

- [ ] **Step 1:** Rewrite the Module layout block of `docs/architecture.md` as the D1 tree, one line
  per file; add under Dependency rules: "A capability folder is used from outside only through its
  `index.ts`", and "Pure decision rules and data transforms live in `policy/`".
- [ ] **Step 2:** Add a "Where code goes" list to `CONTRIBUTING.md`: layer, then capability folder;
  pure code in `policy/`; cross-capability use through `index.ts`, named exports only.
- [ ] **Step 3:** Run `git grep -nE "src/[a-z]+/[a-z0-9/_-]+\.ts" -- docs README.md CONTRIBUTING.md openspec/changes/capability-folders/specs/skill-delivery openspec/changes/capability-folders/specs/skill-pick`
  and check every path exists. Expected: all exist. (The `quality-checks` delta names example and
  forbidden paths on purpose; it is not checked. `openspec/specs/skill-{delivery,pick}` still name
  `src/policy/skill.ts` until archive applies the deltas, design D8.)
- [ ] **Step 4:** Run `bun run fmt:check` and `bun test tests/release.test.ts`. Expected: exit 0.
- [ ] **Step 5:** Commit `docs: describe capability folders`.

---

## Scenario → test

`IG` = `tests/import-graph.test.ts`; `LINT` = `tests/boundaries.test.ts`. Fixture paths are under
`tests/fixtures/boundaries/` (canonical, checked by both) or `tests/fixtures/import-graph/`
(resolver-only, checked by `IG`). Each fixture test asserts the violating set equals the `bad-` set.

quality-checks — *Dependency boundaries are enforced by lint* (MODIFIED, shortest-path spelling):
- Forbidden edges / Each forbidden edge is reported / Allowed edges are not reported → LINT over the pre-existing `tests/fixtures/boundaries/` files (unchanged), plus the renamed `ok-parent-in-layer.ts`

quality-checks — *Capability folders are entered through their index*:
- Deep import into a sibling capability fails the checks → IG + LINT over `boundaries/src/host/main/bad-sibling.ts`, `boundaries/src/policy/main/bad-sibling.ts`
- Any spelling of the same path fails the checks → IG over `import-graph/src/host/main/bad-noncanonical-sibling.ts`, `import-graph/src/host/main/bad-type-only-deep.ts`; IG "violations name the file, the import and the fix"
- Only real imports are read → IG "the scanner ignores strings, templates and comments", "the scanner reads every import form", "the scanner reads clauses with comments and odd names", "the scanner reads every TypeScript import syntax"
- Deep import from the entry point fails the checks → IG + LINT over `boundaries/src/extension-bad-capability.ts`
- A capability folder name of any form is covered → IG + LINT over `boundaries/src/host/main/bad-underscore-cap.ts`; IG over `import-graph/src/host/main/bad-dot-cap.ts`
- A nested index is not a capability entry point → IG + LINT over `bad-sibling-nested-index.ts`, `bad-root-nested-index.ts`, `bad-policy-nested-index.ts`
- Deep import from a nested folder fails the checks → IG + LINT over `boundaries/src/host/main/nested/bad-nested-sibling.ts`
- Deep import into a capability of another layer fails the checks → IG + LINT over `bad-cross-layer.ts`, `nested/bad-nested-cross-layer.ts`, `boundaries/src/host/bad-root-policy-deep.ts`
- Deep import from a layer root, jev or scripts fails the checks → IG + LINT over `boundaries/src/host/bad-root-deep.ts`, `boundaries/src/policy/bad-root-deep.ts`, `boundaries/src/jev/bad-policy-deep.ts`, `boundaries/scripts/replay/bad-src-deep.ts`
- Allowed capability imports pass → every `ok-` fixture of both trees (IG; and LINT for the canonical tree)
- Tests may import capability internals → IG scans only `src/` and `scripts/`; `bun run lint` passes in Task 3 step 7 while `tests/host/main/gate.test.ts` imports `src/host/main/gate.ts`
- Nesting deeper than one level fails the checks → IG "capability folders nest at most one level and other layers stay flat" (names `src/host/main/a/b/x.ts`)
- The other layers stay flat → same test (names `src/jev/sub/x.ts`)
- Lint gives early feedback on the plain spelling → LINT over `boundaries/src/host/main/bad-sibling.ts`

quality-checks — *Layer rules are checked on resolved paths*:
- A policy file importing a non-layer module under src fails the checks → IG over `import-graph/src/policy/main/bad-src-helper.ts`, `import-graph/src/policy/bad-root-src-helper.ts`
- An index import that breaks a layer rule fails the checks → IG + LINT over `bad-host-index.ts`, `bad-store.ts`, `nested/bad-nested-host.ts`, `nested/bad-nested-jev.ts`, `boundaries/src/policy/bad-root-store.ts`
- The current layer edges are unchanged → IG + LINT over the pre-existing `tests/fixtures/boundaries/` files (same `bad-` set)

quality-checks — *Relative imports take the shortest path*:
- A round trip through a folder fails the checks → IG over `import-graph/src/policy/main/bad-roundtrip.ts`, `nested/bad-nested-roundtrip.ts`, `import-graph/src/host/main/bad-own-via-parent.ts`, `bad-roundtrip.ts`, `import-graph/src/host/bad-root-roundtrip.ts`; IG "violations name the file, the import and the fix"
- Absolute, extensionless and non-literal imports fail the checks → IG over `import-graph/src/policy/main/bad-absolute.ts`, `import-graph/src/host/main/bad-extensionless-index.ts` (and non-literal dynamic imports: `import-graph/src/host/main/bad-non-literal.ts`)
- Canonical paths pass → IG "source and scripts have no import violation" and the `ok-` fixtures

skill-delivery — *Host wiring only* / Lint boundaries → `bun run lint` and IG in Task 2 step 7 with `src/policy/main/skill.ts` in place

skill-pick — *Pure and Pi-free* / Lint boundaries → IG in Task 2 step 7: `src/policy/main/skill.ts` resolves only into `src/policy/` and `src/shared/`
