## Design Summary

WG-01 from `docs/roadmap.md`: turn the documentation-only repository into an empty Pi package that Pi can load and CI checks. It is the base every later work group builds on, so it fixes the toolchain and the guard rails, and adds no behavior.

**Intent.** Later groups (WG-02 onward) need a place to put code, a test runner, and CI that keeps the documented rules true from the first commit. The most important rule to protect early is the architecture's dependency direction (`docs/architecture.md#dependency-rules`), because it is cheap to enforce now and expensive to repair later.

**Goals**
- `package.json` with the `pi` manifest pointing at `src/extension.ts`, whose default export is a factory that does nothing.
- TypeScript type check, `bun test`, lint and format, each as a package script.
- Lint rules that enforce the dependency boundaries between `policy/`, `jev/`, `host/`, `store/`, `extension.ts` and `scripts/replay`.
- MIT `LICENSE`.
- A CI workflow that runs type check, lint, format check and tests on every push and pull request.
- A host-level test proving that Pi loads the package: a real `pi install` of the checkout into an isolated `PI_CODING_AGENT_DIR`, then Pi's own `DefaultResourceLoader` lists our extension path with zero load errors.

**Non-goals**
- Any `/jev` command, status line, store, Jev call or other behavior (WG-02 onward).
- Publishing, tarball acceptance, `CHANGELOG.md` (WG-19).
- Installing the package into the operator's real `~/.pi/agent`.

**Anti-goals**
- A "loads" claim that would also pass if the extension were skipped.
- Any runtime dependency, network access beyond loopback, secrets or paid calls in tests or CI.
- Boundary rules that exist only in prose.

**Constraints**
- Bun for tooling and tests; Pi requires Node ≥ 22.19, so the host test and CI also need Node.
- Host-provided packages (`@earendil-works/pi-coding-agent`) are a `"*"` peer and never a runtime dependency (Pi packages guide).
- Host tests pin Pi (`docs/testing.md#version-policy`); Pi 1.5.0 is the version the usage guide requires.
- Dependencies need the operator's approval (`CONTRIBUTING.md`); approved for this change: dev-only tooling listed under Key Decisions.

## Alternatives Considered

### Alternative A: Biome for lint and format
- **Approach**: one devDependency covering lint and format, `noRestrictedImports` per-folder override.
- **Pros**: fewest dependencies, stable 2.x line, one config file.
- **Cons**: differs from the toolchain the operator already knows from the older port.
- **Why not chosen**: the operator chose oxlint + oxfmt.

### Alternative B: ESLint + Prettier
- **Approach**: ESLint with a boundaries plugin, Prettier for format.
- **Pros**: most mature boundary plugins.
- **Cons**: several devDependencies, slower.
- **Why not chosen**: more dependencies for no need the scaffold has.

### Alternative C: Prove loading through the CLI in RPC mode
- **Approach**: run `pi --mode rpc` and either look for a placeholder `/jev` command through `get_commands`, or only check that no extension load error appears.
- **Pros**: exercises the full CLI process.
- **Cons**: the first needs a public command that belongs to WG-06, so the extension would no longer "do nothing"; the second cannot tell "loaded" apart from "skipped".
- **Why not chosen**: the loader check keeps the extension empty and still distinguishes loaded, failed and absent (verified by a probe: a throwing factory is reported in `errors` with no extension listed).

## Agreed Approach

- Lint and format with **oxlint + oxfmt** (operator's choice), the same toolchain as the older port.
- Load proof through **real `pi install` + `DefaultResourceLoader`** (operator's choice, as recommended), run by `bun test` against the pinned Pi devDependency, offline, in a temporary agent directory.
- The rest of the scaffold follows `docs/roadmap.md#wg-01-repository-scaffold` and `docs/architecture.md` as written.

## Key Decisions

- **Toolchain (operator):** oxlint + oxfmt.
- **Load proof (operator):** `pi install` of the checkout into an isolated `PI_CODING_AGENT_DIR`, then `DefaultResourceLoader` lists `src/extension.ts` with zero errors.
- **Dev-only dependencies (operator approved the set by choosing the options):** `oxlint`, `oxfmt`, `@types/bun`, `@earendil-works/pi-coding-agent` pinned to 1.5.0. Runtime dependencies stay at zero.
- **Type check (operator, final-gate review):** `bun check` instead of `tsc --noEmit`, so there is no `typescript` dependency.
- **My call:** boundary rules are proven by a test that lints deliberately violating fixture files and expects each to fail, so a rule that silently stops matching is caught.
- **My call:** no empty module folders are committed; the boundary rules are configured for the documented layout and later groups add the folders.
- **My call:** `LICENSE` names the repository owner, ttdua, as copyright holder; upstream notices stay in `NOTICE.md`.
- **My call:** documents that say "no code yet" (README status note, usage guide note) are left until there is something to use; only the roadmap status of WG-01 and `CONTRIBUTING.md` (how to run the checks) change.

## Open Questions

None.
