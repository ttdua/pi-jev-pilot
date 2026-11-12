## Design Summary

CI checks that the vendored executor's published type surface (`dist/public.d.ts`, `dist/settings.d.ts`) is consumable from the packed tarball, by running the existing `verify:public-types` script on every push and pull request.

- **Why:** issue #68 showed the script had been broken since the package rename, and nothing noticed, because CI never ran it. jev-pilot imports executor types (`import type` from `@ttdua/pi-subagents`), so a broken or incomplete declaration bundle is a real regression that `test:executor` does not catch: it type-checks sources, not the packed declarations.
- **Goal:** a CI failure when the packed declarations stop being self-contained, lose a public symbol, or stop type-checking for an external consumer.
- **Non-goals:** changing what the script checks; publishing the package; changing the probe's peer version ranges.
- **Anti-goal:** coupling the network-dependent consumer install into the root `test` or `test:executor` scripts, which developers run offline and often.

Specified requirement altered: `executor-vendoring` / "Vendored tests run on their own" says "The CI workflow SHALL run both `test` and `test:executor`". This change extends it so CI also runs the vendored package's public-types check, after `test:executor`. No other requirement changes.

Depends on the fix for #68 (branch `fix/68`, commit `b0681ac0`), which makes the script pass; this change is based on that branch.

## Alternatives Considered

### Alternative A: Fold into `test:executor`
- **Approach**: append `&& bun run --cwd packages/pi-subagents verify:public-types` to the root `test:executor` script.
- **Pros**: no workflow edit; one command covers the executor.
- **Cons**: every local `test:executor` run packs, hits the npm registry and installs ~144 packages; fails offline; slows the inner loop.
- **Why not chosen**: hits the anti-goal above.

### Alternative B: Separate CI job
- **Approach**: a second job in `ci.yml` that installs and runs only the public-types check.
- **Pros**: runs in parallel with the main job.
- **Cons**: duplicates checkout/setup steps; `tests/ci.test.ts` assumes one ordered command list; little time saved for a short check.
- **Why not chosen**: more workflow surface for no meaningful gain.

### Alternative C: New step in the existing job (chosen)
- **Approach**: add one step after `bun run test:executor` in `ci.yml` that runs the vendored package's `verify:public-types` script.
- **Pros**: smallest change; keeps the local scripts offline; ordered after the cheaper checks so they fail first.
- **Cons**: CI needs registry access for the consumer install (already true for `bun install`).

## Agreed Approach

Alternative C: one extra step in the existing CI job, last in order, with the `executor-vendoring` requirement and `tests/ci.test.ts` extended to require it.

## Key Decisions

- The check runs only in CI and on demand, never inside `test` or `test:executor`.
- It runs after `test:executor`, as the last step.
- The repository test guarding the CI workflow asserts the new command is present and ordered last.

## Open Questions

None.
