## Why

The package loads but does nothing visible: an operator cannot tell whether it is ready, and cannot turn features on or off. WG-07 and WG-11 need live switches, a status line to show their decisions and a way to tell a worker's child session from the main session. WG-06 adds that base, without any Jev call yet.

## What Changes

- A status line above the editor in the main session, drawn only when Pi has a UI. It shows `Jev · <mode>`, or `Jev · config error`, `Jev · no key` or `Jev · off`, and is cleared when the `status` switch is off.
- A `/jev` command: no argument shows the status; `/jev <feature> on|off`, `/jev all on|off` and `/jev reset` change `state.json`; anything else prints usage text that lists only these commands. Output goes through UI notifications and is silent in print and JSON mode.
- A child-session registry fed by the executor's `subagents:child:session-created` event, shared across extension instances. The status line and `/jev` do nothing in a child session.
- Key and executor presence checks, with no network call.

**Extension effect**
- From: the extension registers nothing and has no effect.
- To: the extension registers the `/jev` command and session and executor event handlers. It still registers no tools, flags or shortcuts, and makes no network call.
- Reason: WG-06 is the first visible behaviour.
- Impact: non-breaking. No release has shipped.

**`/jev all on|off`**
- From: `docs/usage-guide.md` says it sets "everything".
- To: it sets the seven decision features and leaves `status` and `verbose` alone.
- Reason: turning `status` off would hide the very line that says `Jev · off`.
- Impact: documentation only; the command did not exist before.

## Capabilities

### New Capabilities

- `status-line`: what the line above the editor shows, when it is drawn, cleared or suppressed.
- `jev-command`: the `/jev` command in this phase: status report, feature switches, `all`, `reset`, usage text and where output goes.
- `child-registry`: recording child session ids from the executor and answering whether a session is a child, across extension instances.
- `readiness-checks`: whether the API key and the executor are present, without a network call.

### Modified Capabilities

- `package-loading`: the "Extension has no effect" requirement becomes a bounded registration requirement (one command and event handlers; no tools, flags or shortcuts).

## Impact

- **Code**: `src/extension.ts`, `src/store/defaults.ts` (decision feature list), new `src/host/setup.ts`, `src/host/status.ts`, `src/host/commands.ts`, `src/host/child.ts`, `src/host/readiness.ts`. Existing `src/store/*` is used as is.
- **Tests**: `tests/load.test.ts` (registration expectations), new unit tests under `tests/host/`, and a host test through the real CLI in RPC, print and JSON modes.
- **Dependencies**: none added. Right alignment pads the package's own plain text by its length, so `@earendil-works/pi-tui` is not imported.
- **docs/ updated**: `docs/usage-guide.md` (`/jev all` scope, commands available in this phase), `docs/architecture.md` (module layout: `host/readiness.ts`, `host/setup.ts`; status line base states), `docs/roadmap.md` (WG-06 status).
