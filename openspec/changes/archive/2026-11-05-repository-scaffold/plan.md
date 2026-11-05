# Repository Scaffold Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Make the repository an empty Pi package that Pi provably loads, with type check, lint, format, dependency-boundary rules, tests and CI.

**Architecture:** `package.json` points Pi at `src/extension.ts`, a factory that registers nothing. Tests drive the pinned Pi devDependency: `pi install` into a temporary `PI_CODING_AGENT_DIR`, then `DefaultResourceLoader`. They also drive the pinned oxlint and oxfmt binaries against temporary copies of the fixtures. CI runs the same five scripts.

**Tech Stack:** TypeScript checked by `bun check` (TypeScript 7), Bun 1.4.4 (`bun test`), oxlint 1.91, oxfmt 0.76, `@earendil-works/pi-coding-agent` 1.5.0, GitHub Actions, Node 22.

## Global Constraints

- Runtime `dependencies`: none. Host package: `"*"` peer only.
- Dev dependencies, exact versions: `@earendil-works/pi-coding-agent` `1.5.0`, `oxlint` `1.91.0`, `oxfmt` `0.76.0`, `@types/bun` `1.4.4`. No other dependency may be added, and `typescript` is not a dependency, since `bun check` is built in.
- Bun `>=1.4.4` (`engines.bun`). CI pins `bun-version: 1.4.4`.
- Tests need no secrets, paid calls or network beyond loopback. Every Pi invocation sets `PI_OFFLINE=1` and a temporary `PI_CODING_AGENT_DIR`, and never touches `~/.pi/agent`.
- Repository content is in English. Commits are small, with imperative subjects.
- Work happens in the change's worktree, never on `main`.

## Review Focus

- **Global `pi` on PATH instead of the pinned one.** Tests must call `node_modules/.bin/pi` by absolute path. Covered in Task 2, Step 1 (`PI_BIN` constant).
- **macOS `/var` → `/private/var` symlink makes path equality fail.** Compare `realpathSync` on both sides. Covered in Task 2, Step 1.
- **The developer's own `~/.pi/agent` packages leak into the loader.** The isolated agent directory and a separate empty `cwd` prevent this. The load test asserts that exactly one extension resolves to our entry, so it ignores others by path. Covered in Task 2.
- **Fixtures accidentally linted or type-checked in the real run.** `tests/fixtures/**` is ignored by oxlint and excluded from `tsconfig`. `bun run lint` and `typecheck` on the tree, in Task 3 Step 6, prove it.
- **A rule matching nothing passes silently.** Every forbidden edge has its own fixture file, and the test asserts the exact set of flagged files. Covered in Task 3.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `package.json` `pi` manifest | new | `{ "pi": { "extensions": ["./src/extension.ts"] }, "keywords": ["pi-package"], "license": "MIT", "type": "module", "private": true, "peerDependencies": { "@earendil-works/pi-coding-agent": "*" } }`, with no `dependencies` key | yes |
| `src/extension.ts` default export | new | `export default function jevPilot(): void {}`, with no parameters and no imports. Pi calls it with its API, which is ignored. Only `host/` may import Pi, so the typed `ExtensionAPI` parameter arrives when `extension.ts` starts wiring `host/` in a later group | yes (Pi entry point) |
| npm scripts | new | `typecheck`: `bun check`; `lint`: `oxlint --deny-warnings .`; `fmt`: `oxfmt --write .`; `fmt:check`: `oxfmt --check .`; `test`: `bun test` | no (contributor commands) |
| `.oxlintrc.json` | new | `ignorePatterns: ["tests/fixtures/**", "node_modules/**"]`, plus one `overrides` entry per design D3 row, each `{ files: [<glob>], rules: { "no-restricted-imports": ["error", { patterns: [{ group: [...], message: "<rule from docs/architecture.md#dependency-rules>" }] }] } }` | no |
| `.oxfmtrc.json` | new | `{ "ignorePatterns": ["openspec/**", "docs/**", "*.md", "tests/fixtures/**"] }`, so only code and config are formatted. Docs and fixtures stay hand-written. A probe confirmed the key works in oxfmt 0.76 | no |
| `.github/workflows/ci.yml` | new | `on: [push, pull_request]`; top-level `permissions: contents: read` (added during apply: least-privilege token, no secret, internal); job `check` on `ubuntu-latest`; steps: checkout, `oven-sh/setup-bun@v2` with `bun-version: 1.4.4`, `actions/setup-node@v4` with `node-version: 22`, then `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun run test` | no |

The Contracts table changes no existing public API or CLI. The `pi` manifest and entry point are new public surface, recorded in design D1 and D2.

---

## File structure

```text
package.json  bun.lock  tsconfig.json  .gitignore  LICENSE
.oxlintrc.json  .oxfmtrc.json
.github/workflows/ci.yml
src/extension.ts
tests/helpers.ts                     REPO_ROOT, PI_BIN, OXLINT_BIN, OXFMT_BIN, tempDir(), run()
tests/manifest.test.ts
tests/load.test.ts
tests/boundaries.test.ts
tests/ci.test.ts
tests/fixtures/throwing-extension/   package.json + index.ts (factory throws)
tests/fixtures/boundaries/           mirrors src/ and scripts/ (see Task 3)
```

---

## Task 1: Package and toolchain — implements 1.1, 1.2

**Files:** create `package.json` (without the `pi`, `keywords`, `license` and `peerDependencies` keys, which Task 2 adds test-first), `tsconfig.json`, `.gitignore`, `.oxlintrc.json` (only `ignorePatterns` for now), `.oxfmtrc.json` and `tests/helpers.ts`. `bun install` creates `bun.lock`.

**Interfaces — produces** (`tests/helpers.ts`):
- `REPO_ROOT: string`: the absolute repository root, from `import.meta.dir`.
- `PI_BIN`, `OXLINT_BIN`, `OXFMT_BIN: string`: absolute paths under `node_modules/.bin/`.
- `tempDir(prefix: string): string`: `mkdtempSync` under `os.tmpdir()`, with the result passed through `realpathSync`.
- `run(cmd: string[], opts: { cwd: string; env?: Record<string, string> }): { code: number; stdout: string; stderr: string }`: `Bun.spawnSync`, with `env` merged over `process.env`.

- [ ] **Step 1:** Write `package.json` with `name` `pi-jev-pilot`, `version` `0.0.0`, `type` `module`, `private` `true`, `engines.bun` `>=1.4.4`, the scripts, and the exact devDependencies from Global Constraints.
- [ ] **Step 2:** Run `bun install`. Expected: `bun.lock` is created, and `node_modules/.bin/{pi,oxlint,oxfmt}` exist.
- [ ] **Step 3:** Write `tsconfig.json`: `target` ES2023, `module` ESNext, `moduleResolution` Bundler, `strict`, `noEmit`, `allowImportingTsExtensions`, `skipLibCheck`, `types: ["bun"]`, `include: ["src", "tests", "scripts"]`, `exclude: ["tests/fixtures"]`.
- [ ] **Step 4:** Write `.gitignore` (`node_modules/`, `*.tgz`, `.DS_Store`).
- [ ] **Step 5:** Write `.oxlintrc.json` with `ignorePatterns` only, and `.oxfmtrc.json` per the Contracts table. Write `tests/helpers.ts`.
- [ ] **Step 6:** Run `bun run fmt && bun run typecheck && bun run lint && bun run fmt:check`. Expected: every command exits 0, and `fmt:check` does not list any `docs/` or `openspec/` file. `bun check` exits 1 when it has nothing to check, so `typecheck` passes only once `tests/helpers.ts` exists. That is why this step comes after Step 5.
- [ ] **Step 7:** Commit: "Add package manifest and toolchain for the empty Pi package".

## Task 2: Package loading — implements 2.1, 2.2, 2.3

**Files:** create `tests/manifest.test.ts`, `tests/load.test.ts`, `src/extension.ts`, `LICENSE`, `tests/fixtures/throwing-extension/package.json`, and `tests/fixtures/throwing-extension/index.ts`. Modify `package.json` to add the `pi` manifest keys.

**Interfaces — consumes:** `tests/helpers.ts` (Task 1). **Produces:** `src/extension.ts` default export (Contracts).

- [ ] **Step 1: Failing tests.**

  `manifest.test.ts`:
  - `manifest names one entry point`: asserts `pi.extensions` deep-equals `["./src/extension.ts"]`, `keywords` contains `"pi-package"`, and `license === "MIT"`.
  - `host package is a peer, not bundled`: asserts `peerDependencies["@earendil-works/pi-coding-agent"] === "*"` and `Object.keys(dependencies ?? {}).length === 0`.
  - `LICENSE is MIT`: asserts `LICENSE` contains "MIT License" and "Permission is hereby granted".

  `load.test.ts` uses a helper `installAndLoad(pkgDir: string): Promise<LoadExtensionsResult>`. It does four things:
  - `run([PI_BIN, "install", pkgDir], { cwd: tmpCwd, env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" } })`, and expects code 0.
  - Sets `process.env.PI_OFFLINE = "1"`.
  - Builds `SettingsManager.create(tmpCwd, agentDir)` and `new DefaultResourceLoader({ cwd: tmpCwd, agentDir, settingsManager })`, then `await loader.reload()`.
  - Returns `loader.getExtensions()`.

  Both directories come from `tempDir()`. `afterEach` removes them and restores `process.env.PI_OFFLINE` to its previous value. The in-process loader gets `agentDir` explicitly, so `process.env.PI_CODING_AGENT_DIR` is never set.
  - `installed checkout is loaded`: `errors` equals `[]`, and exactly one extension has `realpathSync(resolvedPath) === realpathSync(REPO_ROOT + "/src/extension.ts")`.
  - `loaded extension registers nothing`: for that extension, `handlers.size`, `tools.size`, `commands.size`, `flags.size` and `shortcuts.size` are all `0`.
  - `failing entry point is not reported as loaded`: calls `installAndLoad` on the throwing fixture. No extension resolves to its `index.ts`, and exactly one `errors` entry has a `path` resolving to it.
- [ ] **Step 2:** Write the throwing fixture: `package.json` is `{ "name": "throwing-extension", "type": "module", "pi": { "extensions": ["./index.ts"] } }`, and `index.ts` is `export default function () { throw new Error("fixture: throwing extension"); }`.
- [ ] **Step 3:** Run `bun test tests/manifest.test.ts tests/load.test.ts`. Expected: the three manifest tests FAIL, because the keys and `LICENSE` are missing. The two checkout load tests FAIL, because no extension resolves without a manifest. The throwing-fixture test passes.
- [ ] **Step 4:** Add the `pi`, `keywords`, `license` and `peerDependencies` keys to `package.json` per the Contracts table. Write `LICENSE` with the standard MIT text, "Copyright (c) 2026 ttdua". Create `src/extension.ts` per the Contracts table, with the doc comment: "Entry point. Wires host adapters together; no logic (docs/architecture.md)."
- [ ] **Step 5:** Run `bun test`. Expected: all pass.
- [ ] **Step 6:** Run `bun run fmt && bun run typecheck && bun run lint && bun run fmt:check`. Expected: exit 0.
- [ ] **Step 7:** Commit: "Load an empty extension through a real pi install".

## Task 3: Dependency boundaries and format check — implements 3.1, 3.2, 3.3

**Files:** create `tests/boundaries.test.ts` and the fixtures below. Modify `.oxlintrc.json` (add the overrides).

Fixture tree under `tests/fixtures/boundaries/`. Each `bad-*` file holds exactly one forbidden import, and each `ok-*` file holds only allowed imports. Targets such as `../host/x.ts` need not exist, because lint does not resolve them.

| File | Import |
|---|---|
| `src/policy/bad-host.ts` | `../host/x.ts` |
| `src/policy/bad-pi.ts` | `@earendil-works/pi-coding-agent` |
| `src/policy/sub/bad-parent.ts` | `../p.ts` (deep file leaving its folder, still inside `policy/`, which is forbidden by `../**`) |
| `src/policy/ok-local.ts` | `./answers.ts` |
| `src/jev/bad-host.ts`, `bad-store.ts`, `bad-extension.ts`, `bad-pi.ts` | `../host/x.ts`, `../store/x.ts`, `../extension.ts`, Pi |
| `src/jev/ok-policy.ts` | `../policy/x.ts` |
| `src/store/bad-host.ts`, `bad-jev.ts`, `bad-policy.ts`, `bad-extension.ts`, `bad-pi.ts` | `../host/x.ts`, `../jev/x.ts`, `../policy/x.ts`, `../extension.ts`, Pi |
| `src/host/bad-extension.ts` | `../extension.ts` |
| `src/host/ok-all.ts` | `../jev/x.ts`, `../policy/x.ts`, `../store/x.ts`, Pi |
| `src/extension-bad-policy.ts`, `extension-bad-jev.ts`, `extension-bad-store.ts`, `extension-bad-pi.ts` | `./policy/x.ts`, `./jev/x.ts`, `./store/x.ts`, Pi |
| `src/extension-ok.ts` | `./host/x.ts` |
| `scripts/replay/bad-host.ts`, `bad-store.ts`, `bad-pi.ts` | `../../src/host/x.ts`, `../../src/store/x.ts`, Pi |
| `scripts/replay/ok-jev-policy.ts` | `../../src/jev/x.ts`, `../../src/policy/x.ts` |

`extension.ts` is a single file, so its edges use sibling files that match the D3 entry glob `src/extension*.ts`. The real `src/extension.ts` matches the same glob.

- [ ] **Step 1: Failing test** in `boundaries.test.ts`, `boundary rules flag exactly the forbidden imports`:
  - copies `tests/fixtures/boundaries` into `tempDir()`;
  - writes the project `.oxlintrc.json` there with `ignorePatterns` removed;
  - runs `[OXLINT_BIN, "-c", ".oxlintrc.json", "-f", "json", "."]`;
  - collects `filename` for diagnostics whose `code` is `eslint(no-restricted-imports)`.

  Both sides are normalized to paths relative to the temporary root, with forward slashes and no leading `./`. The test asserts that the set equals every fixture path whose basename contains `bad-`, so no `ok-` file may appear.
- [ ] **Step 2:** In the same file, add `format check rejects an unformatted file`. It writes `export const a   =1\n` to `tempDir()/bad.ts`, runs `[OXFMT_BIN, "--check", "bad.ts"]` with `cwd` set to that directory, and asserts `code !== 0`.
- [ ] **Step 3:** Create the fixture files from the table.
- [ ] **Step 4:** Run `bun test tests/boundaries.test.ts`. Expected: the boundary test FAILS, with the flagged set empty. The format test passes.
- [ ] **Step 5:** Add the `overrides` from design D3 to `.oxlintrc.json`. Run `bun test tests/boundaries.test.ts`. Expected: PASS.
- [ ] **Step 6:** Run `bun run fmt && bun run lint && bun run typecheck && bun run fmt:check`. Expected: exit 0, with the fixtures ignored by lint, `bun check` and oxfmt.
- [ ] **Step 7:** Commit: "Enforce module dependency boundaries with oxlint".

## Task 4: CI and docs — implements 4.1, 4.2

**Files:** create `.github/workflows/ci.yml` and `tests/ci.test.ts`. Modify `CONTRIBUTING.md` and `docs/roadmap.md`.

- [ ] **Step 1: Failing test** `ci.test.ts`, `CI runs every check`, which reads the workflow as text with no YAML dependency:
  - the text contains `push` and `pull_request` under `on`;
  - the run commands appear in order (increasing `indexOf`): `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun run test`;
  - the text does not contain `secrets.`;
  - it contains `node-version: 22` and `bun-version: 1.4.4`.
- [ ] **Step 2:** Run `bun test tests/ci.test.ts`. Expected: FAIL, because the file is missing.
- [ ] **Step 3:** Write `ci.yml` per the Contracts table. Run `bun test`. Expected: all pass.
- [ ] **Step 4:** Update the docs:
  - `CONTRIBUTING.md`: add a "Running the checks" section listing `bun install` and the five `bun run` scripts, noting that Node ≥ 22.19 is needed for the load test.
  - `docs/roadmap.md`: change the WG-01 status from `Planned` to `Done`.
- [ ] **Step 5:** Run `bun run fmt && bun run typecheck && bun run lint && bun run fmt:check && bun run test`. Expected: all exit 0. Then run `openspec validate repository-scaffold`. Expected: valid.
- [ ] **Step 6:** Commit: "Run checks in CI and document them".

CI passing on GitHub needs a push, which waits for the operator's go-ahead. Locally, the same five commands stand in for it.

---

## Scenario → test

- Manifest names one entry point → `tests/manifest.test.ts` › `manifest names one entry point`
- Host package is a peer, not bundled → `tests/manifest.test.ts` › `host package is a peer, not bundled`
- Installed checkout is loaded → `tests/load.test.ts` › `installed checkout is loaded`
- A failing entry point is not reported as loaded → `tests/load.test.ts` › `failing entry point is not reported as loaded`
- Loaded extension registers nothing → `tests/load.test.ts` › `loaded extension registers nothing`
- Clean tree passes every check → Task 4 Step 5 command run, and CI
- Unformatted file fails the format check → `tests/boundaries.test.ts` › `format check rejects an unformatted file`
- Forbidden edges → `tests/boundaries.test.ts` › `boundary rules flag exactly the forbidden imports`
- Each forbidden edge is reported → same test (the set includes every `bad-*` file)
- Allowed edges are not reported → same test (no `ok-*` file in the set)
- Pi import outside host is reported → same test (`bad-pi.ts` in policy, jev, store and scripts, plus `extension-bad-pi.ts`)
- CI runs every check → `tests/ci.test.ts` › `CI runs every check`
- License file present → `tests/manifest.test.ts` › `LICENSE is MIT`
