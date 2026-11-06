## Why

Every later work group reads settings: the ledger (WG-05), `/jev` and the status line (WG-06), and the decisions (WG-07, WG-11). Today there is no store, so each of them would parse `config.json` and apply precedence on its own. The docs promise that a malformed `config.json` makes the package inert and names the field, that nothing automatic rewrites it, and that the API key never lands on disk. Building the stores first gives every later group one validated source and keeps those promises in one place.

## What Changes

- Add `src/store/` modules for the files under `<agentDir>/jev/`:
  - `config.json`: strict validation with every problem reported by field path; a missing file means defaults; a malformed file makes the result inert and is never written; one atomic writer that replaces only `crew.slots`.
  - `state.json`: switches, mode and the CLI review default; atomic owner-only writes; a malformed file falls back to defaults with a warning and is moved aside as `state.json.bad` on the next write; a reset operation.
  - One resolver for effective settings, `tuning > state > config > default`, with an optional tuning layer.
- Add `src/host/stores.ts`, which locates `<agentDir>/jev/` through Pi's `getAgentDir()`, so `PI_CODING_AGENT_DIR` moves the files. It is not wired into `src/extension.ts` yet: the entry point stays a no-op until WG-06 adds `/jev` and the status line.
- No new dependency. No Jev call: these capabilities never contact Jev, so they have no Jev failure path.

**CLI review default**
- From: `docs/configuration.md` says `/jev cli-review` changes `review.cli` in `config.json`.
- To: `/jev cli-review` stores an override in `state.json`; `review.cli` in `config.json` stays the operator's default.
- Reason: only slot commands may write `config.json` (roadmap WG-03), and automatic or command writes should touch the operator's file as little as possible.
- Impact: non-breaking; no release has shipped.

## Capabilities

### New Capabilities
- `store-location`: where the package's files live, `<agentDir>/jev/`, derived from Pi's agent directory, with owner-only permissions on what it creates.
- `config-file`: reading, validating and the slot-only writing of `config.json`.
- `state-file`: reading, atomic writing, recovery and reset of `state.json`.
- `settings-resolution`: merging tuning, state, config and defaults into the effective settings.

### Modified Capabilities
None. `package-loading` still holds: the entry point registers nothing. `quality-checks` boundaries already cover `store/` and `host/`.

## Impact

- **Code:** new `src/store/` (`config.ts`, `state-file.ts`, `settings.ts`, `defaults.ts`, `atomic.ts`, `validate.ts`) and `src/host/stores.ts`; unit tests under `tests/store/` and `tests/host-stores.test.ts`. `src/extension.ts` unchanged.
- **Dependencies:** none added.
- **Docs updated:**
  - `docs/configuration.md`: the `state.json` row ("CLI review default"), CLI review default, missing, malformed and unreadable files, unknown keys, the `apiKeyEnv` rule, slot writes dropping formatting.
  - `docs/architecture.md`: the `store/` layout lines, failure model rows for `state.json`.
  - `docs/domain-model.md`: "reviewer default" becomes "CLI review default" in `Switches`.
  - `docs/usage-guide.md`: where `/jev cli-review` keeps its choice; `/jev reset` also clears the mode and CLI review default.
  - `docs/roadmap.md`: WG-03 status and notes.
