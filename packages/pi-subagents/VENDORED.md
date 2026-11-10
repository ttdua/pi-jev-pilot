# Vendored executor

This directory is a vendored copy of `@gotgenes/pi-subagents`, kept in the tree so that jev-pilot can add seams to it. Behavior is unchanged from upstream apart from the changes listed below.

## Upstream

- Repository: `gotgenes/pi-packages` (https://github.com/gotgenes/pi-packages)
- Path: `packages/pi-subagents`
- Tag: `pi-subagents-v25.0.5`
- Commit: `a4dd5f7611a2d7687a50899e99be7bd727ddc2b0`
- Upstream tree commit: `dbaae7983b000d9916645856b524465a4d953153`
- Upstream split commit: `e6b408e8c5a1036c00a8b5f233549cedcb83f77c`
- License: MIT, see `LICENSE` (unchanged)

"Upstream tree commit" is the squash commit `git subtree add --squash` created for the vendored tree (archive it for the pristine upstream tree). "Upstream split commit" is the `git subtree split --prefix packages/pi-subagents` commit of the tag; it is not in this repository's history. `.upstream-manifest` lists the blob id of every file at that tree (`bun scripts/vendor-manifest.ts <commit>`); `tests/vendoring.test.ts` fails when a file differs from it without a row below.

## Local changes

| File | Kind | Reason |
|---|---|---|
| `package.json` | edit | Rename to private `@ttdua/pi-subagents`; drop `publishConfig`; replace `catalog:` versions with the exact versions from upstream `pnpm-workspace.yaml` at the tag; pin the `@earendil-works/*` dev dependencies to `1.5.0` to match the root; `lint` without markdown lint; `prepack` through `bun`. |
| `tsconfig.json` | edit | Inline upstream's `tsconfig.base.json` compiler options, since the base file lives outside the subtree. |
| `test/ui/widget-viewport.test.ts` | edit | `fakeTerminal` gains `setProgramStatus`, required by the `Terminal` type in pi-tui 1.5.0. |
| `test/ui/session-navigator.test.ts` | edit | Bind top/bottom to `home`/`end` in the test keybindings; pi-tui 1.5.0 defaults them to `ctrl+home`/`ctrl+end`. |
