## Context

The repository is documentation only. `brainstorm.md` fixes the scope and the two operator choices: oxlint + oxfmt, and a load proof through a real `pi install` followed by Pi's `DefaultResourceLoader`. This document covers only the technical decisions needed to build that.

Probes run during brainstorming, in temporary directories with `PI_OFFLINE=1`, established the following:
- `pi install <dir>` into a fresh `PI_CODING_AGENT_DIR` needs no credentials.
- `DefaultResourceLoader.getExtensions()` lists the installed entry path with `errors: []`. A throwing factory yields no extension and one error naming the path.
- An oxlint 1.91 `no-restricted-imports` override with `group: ["../**", "@earendil-works/*"]` on `src/policy/**` reports both parent-relative and Pi imports.

## Goals / Non-Goals

**Goals:**
- Run every check with one Bun command each, identically locally and in CI.
- Make the load proof fail for a missing, skipped or throwing extension, and for an extension that registers anything.
- Back each dependency rule with a test that would catch a misconfigured rule.

**Non-Goals:**
- Pi CLI RPC host tests with provider fixtures (WG-02 onward).
- Pinning `@gotgenes/pi-subagents` (no group uses it until WG-02).

## Decisions

**D1. Pi is pinned as an exact devDependency and a `"*"` peer.** `@earendil-works/pi-coding-agent` `1.5.0` goes in `devDependencies` and `"*"` in `peerDependencies`, never in `dependencies`. This follows Pi's packages guide, gives tests a pinned `pi` binary at `node_modules/.bin/pi` and a pinned `DefaultResourceLoader`, and matches `docs/testing.md#version-policy`. Using the globally installed `pi` was rejected because its version would drift.

**D2. The load test runs the pinned CLI for install and the pinned library for loading.** The test creates a temporary agent directory and runs `node_modules/.bin/pi install <repo root>` with `PI_CODING_AGENT_DIR` and `PI_OFFLINE=1`. It then builds `SettingsManager.create(cwd, agentDir)` and `new DefaultResourceLoader({ cwd, agentDir, settingsManager })`, calls `reload()`, and checks `getExtensions()`. `cwd` is a separate empty temporary directory, so the result comes from the installed package and not from project-local discovery of the checkout. The test passes only if:
- `errors` is empty;
- exactly one extension has `resolvedPath` equal to the checkout's `src/extension.ts`, compared after `realpath` because macOS `/var` is a symlink;
- that extension's `handlers`, `tools`, `commands`, `flags` and `shortcuts` are all empty.

The last check gives "does nothing" a testable meaning. Other extensions, such as built-ins, are ignored by path.

A negative control proves the assertion can fail. A second case loads `tests/fixtures/throwing-extension/` with the same loader. That fixture is a minimal package whose factory throws, installed the same way into its own temporary agent directory. The case expects no extension resolving to the fixture's entry, and one error naming its path.

**D3. Boundaries use per-folder oxlint overrides with relative-path groups.** Each override's `files` glob is one module folder, and its `group` patterns forbid the targets that `docs/architecture.md#dependency-rules` disallows.

| Files | Forbidden |
|---|---|
| `src/policy/**` | `../**` (anything outside `policy/`), `@earendil-works/*` |
| `src/jev/**` | `../host/**`, `../store/**`, `../extension*`, `@earendil-works/*` |
| `src/store/**` | `../host/**`, `../jev/**`, `../policy/**`, `../extension*`, `@earendil-works/*` |
| `scripts/**` | `**/src/host/**`, `**/src/store/**`, `@earendil-works/*` |
| `src/host/**` | `../extension*` (no cycle back to the entry point) |
| `src/extension*.ts` | `./policy/**`, `./jev/**`, `./store/**`, `@earendil-works/*` (only `host/` is wired in) |

The entry glob `src/extension*.ts` matches the real entry point and lets fixtures test each of its edges in a separate file. Only `host/` may import `@earendil-works/*`, so the Pi import ban sits on every other folder. Relative-path matching assumes imports one directory deep, which matches the flat layout in the architecture. A deeper folder such as `src/policy/sub/` is caught by `../**` for `policy/`, and for the other folders only the `../` form is matched. A path alias was rejected because it adds resolution config for no gain on this layout.

**D4. Boundary rules are proven against fixtures, not the real tree.** `tests/fixtures/boundaries/` mirrors the `src/` layout with one violating file per forbidden edge and one allowed file per folder. `tests/fixtures/` is in `.oxlintrc.json` `ignorePatterns`, so `bun run lint` on the real tree stays clean. A probe showed that `ignorePatterns` still applies under `-c`. The boundary test therefore copies the fixture tree into a temporary directory and writes the project config there without `ignorePatterns`. It then runs the pinned `oxlint -c .oxlintrc.json -f json .` in that directory and parses `diagnostics[].filename`. It expects a `no-restricted-imports` diagnostic for each violating file and none for the allowed files.

The format-check scenario is proven the same way, with no committed unformatted file. The test writes `export const a   =1` to a temporary directory and runs the pinned `oxfmt --check` there. It expects a non-zero exit, which a probe confirmed.

**D5. CI runs on GitHub Actions with Bun and Node.** It runs on `ubuntu-latest` with `oven-sh/setup-bun` and `actions/setup-node`, using Node 22, because Pi requires Node ≥ 22.19 and the `pi` binary uses a `node` shebang. Steps: `bun install --frozen-lockfile`, `typecheck`, `lint`, `fmt:check`, `test`. The workflow uses no secrets. The repository's remote is GitHub (`ttdua/pi-jev-pilot`).

**D6. TypeScript is checked by `bun check`; Pi runs the source directly.** The type check uses `bun check`, Bun's built-in TypeScript 7 checker. It reads `tsconfig.json`, reports the same errors as `tsc` 7, and exits 1 on any error or when there is nothing to check. This replaces `tsc --noEmit` (operator's choice) and removes the `typescript` devDependency. A probe on Bun 1.4.4 passed a clean file and failed a type error with exit 1. The script is named `typecheck`, not `check`, because a `check` script would shadow `bun check`. CI pins Bun `1.4.4`, the verified version, and `package.json` declares `engines.bun` `>=1.4.4`. There is no build output. `tsconfig.json` targets ES2023 with `module: ESNext`, `moduleResolution: Bundler`, `strict` and `allowImportingTsExtensions`, and includes `src`, `tests` and `scripts`. The fixtures are excluded, because they import paths that do not exist.

## Risks / Trade-offs

- [`DefaultResourceLoader` field names change in a future Pi] → the version is pinned, and upgrading reruns this test per the version policy.
- [Relative-path patterns miss a deep or aliased import] → the layout is flat by design. The fixture test documents which forms are covered, and later groups extend the fixtures when they add depth.
- [`policy/` "imports nothing outside itself" is only partly lint-enforced: bare third-party and `node:` imports pass `../**`] → runtime dependencies are zero and need approval. A later group can add a bare-specifier pattern if `policy/` ever has a reason to import one.
- [The entry factory takes no typed `ExtensionAPI` parameter, because only `host/` may import Pi] → Pi calls it with the API, which is ignored. The parameter arrives when `extension.ts` wires `host/` in.
- [An editor's own TypeScript can disagree with `bun check`] → there is no `typescript` dependency to drift. Editors can be pointed at a matching TypeScript if a contributor wants agreement.
- [oxfmt is 0.x and may change formatting between minors] → it is pinned exactly, and `fmt:check` in CI makes any drift visible.
- [`pi install` writes into the temporary agent directory only] → the test always sets `PI_CODING_AGENT_DIR` and removes the directory afterwards. It never touches `~/.pi/agent`.
