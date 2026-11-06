## Context

`src/extension.ts` is an empty factory. WG-03 left complete stores: `readConfig`, `readState`, `updateState`, `resetState` and the pure `resolveSettings` under `src/store/`, plus `jevDir()` in `src/host/stores.ts`. WG-02 verified that `subagents:child:session-created` reaches a main-session subscriber before the child's `session_start`, carrying the child's session id ([Q4](../../../docs/evidence/2026-11-05-host-seams.md#q4)). The brainstorm fixed the behaviour (base status line, `/jev` subset, notify channel, real registry) and the approach of reading the files again at every refresh. This document covers how the host code is laid out and wired.

## Goals / Non-Goals

**Goals:**

- Four small `host/` modules with pure cores that can be unit tested without Pi, and one thin wiring layer in `extension.ts`.
- Correct behaviour in all four Pi modes (`tui`, `rpc`, `json`, `print`), proven through the real CLI.

**Non-Goals:**

- Anything that calls Jev or reads the conversation.
- A UI component library, colours or theming. The line is plain text.

## Decisions

### D1. Module layout

| File | Role | Imports Pi |
|---|---|---|
| `src/host/child.ts` | Registry on `globalThis[Symbol.for("pi-jev-pilot.children")]` (`Set<string>`); `subscribeChildren(events)`; `isChild(sessionId)` | No |
| `src/host/readiness.ts` | Pure `buildSnapshot(...)`, `isKeySet(env, varName)`, `hasExecutor(toolNames)`; `loadSnapshot(pi)` reads the files | Types only |
| `src/host/status.ts` | Pure `statusText(snapshot)`; `drawStatus(ctx, snapshot)` | Types only |
| `src/host/commands.ts` | Pure `parseJevArgs(text)`, pure `formatStatus(snapshot)`, `usageText()`; `runJev(args, ctx, deps)` | Types only |
| `src/host/setup.ts` | `setup(pi)`: subscribes, registers handlers and `/jev` | Yes |
| `src/extension.ts` | Default export delegating to `setup` | No |

`.oxlintrc.json` forbids `src/extension.ts` from importing Pi or anything but `host/`, so the wiring lives in `host/setup.ts` and the entry point stays a one-line delegation. `architecture.md` lists `host/status.ts`, `host/commands.ts` and `host/child.ts` already. `host/readiness.ts` is new because the key and executor checks are used by both the status line and `/jev`, and later by WG-07 and WG-11 to decide whether to act. Alternative considered: putting the checks in `status.ts`. Rejected, because the checks would then live in a display module.

### D2. One snapshot per refresh

`loadSnapshot(pi)` (in `readiness.ts`, the only function there that is given I/O) reads `readConfig(jevDir())` and `readState(jevDir())`, resolves the settings when the config is valid, and adds `keySet` (`process.env[settings.classifier.apiKeyEnv]` is a non-empty string) and `executor` (`pi.getAllTools()` contains a tool named `subagent`). Everything after that is a pure function of the snapshot.

- When the config is invalid, `settings` is resolved from an empty config and the state, so `/jev` can still show the switches. The status line still says `config error`.
- The executor is checked at refresh time, not at factory time, so it does not matter which extension loads first.
- Alternative considered: `ctx.modelRegistry` or the executor's events to detect the executor. Rejected: the tool name is the seam the package depends on for worker routing (`tool_call` on `subagent`), so its presence is the right signal.

`loadSnapshot` is never called from the factory: `pi.getAllTools()` is only valid once extensions are bound, which `session_start` and command handlers guarantee.

### D3. Refresh points

The status line is redrawn on `session_start` (every reason: `startup`, `reload`, `new`, `resume`, `fork`) and at the end of every `/jev` run. No timers and no file watchers. A hand edit to `config.json` shows at the next refresh.

### D4. Drawing by mode

`drawStatus` does nothing unless `ctx.hasUI`. With `ctx.mode === "tui"` it passes a component factory whose `render(width)` returns the text padded on the left to `width`, so it appears right-aligned. The text is the package's own ASCII plus `·` (one column), so its string length is its column width and `@earendil-works/pi-tui` is not needed. In `rpc` mode it passes `string[]`, which RPC requires, and alignment is left to the client. Clearing uses `setWidget("jev", undefined)`. The widget key is `jev`, distinct from the executor's widgets.

### D5. Child sessions

Each extension instance calls `subscribeChildren(pi)` from the factory and keeps the two unsubscribe functions `pi.events.on` returns; its `session_shutdown` handler calls them. Subscribing in the factory, not in `session_start`, is required: Q4 shows `session-created` arrives before the child's `session_start`, so the main instance must already be listening. The registry is a `Set` on `globalThis`, so several instances subscribing is harmless. `subagents:child:disposed` removes the id, so the set does not grow for the life of the process. The `session_start` handler and the `/jev` handler return at once when `isChild(ctx.sessionManager.getSessionId())`. `/jev` is not unregistered in children (a child cannot type commands anyway); the check is a guard, not a feature.

### D6. `/jev` parsing

Arguments are trimmed and split on whitespace. Accepted forms, exactly: empty; `<feature> on|off` with `<feature>` from `FEATURES`; `all on|off`; `reset`. Matching is case-sensitive, like the rest of the documented vocabulary. Every other input, including `mode`, slot names, `cli-review`, `tune` and extra words, gives the usage text with notify type `warning`. `all` writes the seven decision features in one `updateState` call, so a failure leaves no half-applied state. After a change, the command shows the new status, as with an empty argument.

### D7. Output and severities

`ctx.ui.notify` only when `ctx.hasUI`. Types: the status report and the report after a successful change are `info`; usage text after unknown input is `warning`; a refused or failed write (unreadable state, write error) is `error`. A malformed `state.json`, an invalid config and a missing executor are lines inside the status report, not separate notifications. Problem messages reuse the stores' `{ path, message }` issues, which never contain the value found.

### D8. Errors stay inside the package

The `session_start` handler and the `/jev` handler each wrap their whole body in one `try`/`catch`. A refresh error is swallowed (the line stays as it was); a `/jev` error becomes one `error` notification when `ctx.hasUI`. Nothing is written to stdout or stderr, so print and JSON output stay unchanged. Error text uses the error's `code` or class name, never file contents.

### D9. Status line precedence

`config error` (config invalid) > `no key` > `off` (all seven decision features off) > `<mode>`. The `status` switch off clears the line whatever the state.

## Risks / Trade-offs

- [The executor is renamed, or another package registers `subagent`] → `/jev` would report the wrong presence. `usage-guide.md` already requires removing `naicoi92/pi-subagents`; the executor is pinned (`25.0.5`), and the host test checks presence against the real package.
- [Right alignment breaks if later text uses wide characters] → WG-07 adds the decision text; the alignment helper is one function, so switching to `visibleWidth` from `pi-tui` then is a local change.
- [RPC clients ignore placement or alignment] → acceptable: RPC is used for tests and IDE clients; only TUI promises right alignment.
- [`/jev` in print mode] → Pi's print mode sends `-p` text through `session.prompt`, which runs extension commands first (`agent-session.js` `_tryExecuteExtensionCommand`), so `pi -p "/jev skills off"` applies the change. The host test proves this through the real CLI.
- [Two file reads per refresh] → refreshes happen only at session start and per `/jev`, so the cost is negligible.

## Migration Plan

Nothing to migrate: no release exists and the file formats are unchanged. Rollback is reverting the change; `state.json` written by `/jev` stays valid for the WG-03 stores.

## Open Questions

None.
