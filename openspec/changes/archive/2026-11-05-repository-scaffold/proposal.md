## Why

The repository holds only documentation, so no later work group can start: there is no package for Pi to load, no test runner, and nothing that enforces the documented dependency direction between modules. WG-01 adds that base now, before any behavior, because boundaries and CI are cheapest to establish on an empty package and every other group depends on them.

## What Changes

- Add `package.json` with the `pi` manifest pointing at `src/extension.ts`, the `pi-package` keyword, `@earendil-works/pi-coding-agent` as a `"*"` peer, and zero runtime dependencies.
- Add `src/extension.ts`: a default-exported extension factory that registers nothing and does nothing.
- Add TypeScript configuration and a `typecheck` script that runs `bun check`.
- Add oxlint and oxfmt configuration with `lint`, `fmt` and `fmt:check` scripts.
- Add oxlint `no-restricted-imports` overrides enforcing the dependency rules of `docs/architecture.md`.
- Add `bun test` with three tests: a load test (real `pi install` of the checkout into an isolated `PI_CODING_AGENT_DIR`, then `DefaultResourceLoader`), a boundary test that lints violating fixtures, and a manifest test.
- Add dev-only dependencies: `oxlint`, `oxfmt`, `@types/bun`, and `@earendil-works/pi-coding-agent` pinned to `1.5.0`.
- Add the MIT `LICENSE` and a GitHub Actions workflow running type check, lint, format check and tests on push and pull request.
- Update docs: WG-01 status in the roadmap, and the commands for running checks in `CONTRIBUTING.md`.

## Capabilities

### New Capabilities
- `package-loading`: the repository is a Pi package whose manifest names one extension entry point that Pi loads without error and that has no effect.
- `quality-checks`: type check, lint, format, tests and dependency-boundary rules, runnable locally and in CI without secrets or network beyond loopback.

### Modified Capabilities

None.

## Impact

- **New files:** `package.json`, `bun.lock`, `tsconfig.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore`, `LICENSE`, `src/extension.ts`, `tests/`, `.github/workflows/ci.yml`.
- **Dependencies:** dev-only, as listed above; no runtime dependency.
- **Docs updated:** `docs/roadmap.md` (WG-01 status), `CONTRIBUTING.md` (how to run the checks).
- **Docs not changed:** `README.md` and `docs/usage-guide.md` keep their "no code yet" notes, since nothing usable ships in WG-01. `docs/architecture.md` already describes the boundaries being enforced.
