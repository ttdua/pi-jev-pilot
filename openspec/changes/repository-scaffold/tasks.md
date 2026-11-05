## 1. Package and toolchain

- [x] 1.1 Add `package.json` (scripts and exact dev-only dependencies), `bun.lock`, `.gitignore` and `tsconfig.json`.
- [x] 1.2 Add `.oxlintrc.json` and `.oxfmtrc.json`, with the fixture directories ignored, so that `lint` and `fmt:check` pass on the tree.

## 2. Package loading

- [ ] 2.1 Add a manifest test covering the `package.json` requirements and `LICENSE`, then make it pass by adding the `pi` manifest keys, the peer and the MIT `LICENSE`.
- [ ] 2.2 Add the load test: real `pi install` into a temporary agent directory, `DefaultResourceLoader`, one extension at `src/extension.ts`, zero errors, nothing registered. Then add the no-op `src/extension.ts`.
- [ ] 2.3 Add the throwing-extension fixture package and the negative-control case in the load test.

## 3. Dependency boundaries

- [ ] 3.1 Add boundary fixtures under `tests/fixtures/boundaries/` (one violating file per forbidden edge and Pi import, plus allowed files) and the boundary test, which runs oxlint over them.
- [ ] 3.2 Add the `no-restricted-imports` overrides from design D3 to `.oxlintrc.json` until the boundary test passes.
- [ ] 3.3 Add a test that `oxfmt --check` rejects an unformatted file written to a temporary directory.

## 4. CI and docs

- [ ] 4.1 Add `.github/workflows/ci.yml` (Bun and Node 22, frozen install, typecheck, lint, fmt:check, test, no secrets) and a test asserting its trigger and step order.
- [ ] 4.2 Update `CONTRIBUTING.md` with the check commands, and set WG-01 to Done in `docs/roadmap.md`.
