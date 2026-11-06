## Design Summary

WG-06 ([#7](https://github.com/ttdua/pi-jev-pilot/issues/7)) gives the package its first visible behaviour: a status line above the editor and the base `/jev` command. Until now `src/extension.ts` does nothing. After this change, an operator who installs the package can see whether it is ready (key, config, executor), turn features on and off, and have those switches survive a restart. Nothing decides yet. Effort, routing and skills arrive in WG-07 and later, and they will reuse what this change builds.

**Why now.** WG-07 and WG-11 depend on WG-06. They need switches the operator can change, a status line they can write their decision to, and a way to tell the main session from a worker's child session.

**Goals**

- A status line in the main session, drawn only when Pi has a UI. It shows the base state: `Jev · standard` (the active mode), or `Jev · no key`, `Jev · config error` or `Jev · off`.
- `/jev` shows the status: mode, every feature switch, whether the key is set, whether the config is valid, whether the executor is installed, and any `state.json` problem.
- `/jev <feature> on|off`, `/jev all on|off` and `/jev reset` change `state.json` through the existing stores, then refresh the status line.
- Any other `/jev` input prints usage text that lists only the commands that exist in this change.
- A real child-session registry: the subscription to `subagents:child:session-created`, ids kept on `globalThis` under a `Symbol.for` key, and an `isChild(sessionId)` check against `ctx.sessionManager.getSessionId()`. In a child session, the status line and `/jev` do nothing.
- Presence checks for the key and the executor. Neither check makes a network call.

**Non-goals**

- No Jev calls. No effort, routing, skill or advice decisions.
- `/jev mode`, slot commands, `cli-review` and `tune` belong to WG-12, WG-13, WG-15 and WG-18. Here they are treated as unknown input.
- No tally, log entries or verbose output (WG-17).

**Anti-goals**

- Drawing anything, or printing anything, in print (`-p`) or JSON mode. The roadmap names this as a done criterion.
- Making the package fail closed. A malformed `state.json` must not stop the status line or `/jev` from working.
- Using `sendMessage` or any other channel that puts `/jev` output into the model's context.

**Constraints**

- Public Pi APIs only. Only `host/` imports Pi.
- `/jev` output goes through `ctx.ui.notify`, and only when `ctx.hasUI` is true.
- Done when: the real CLI shows the status, switches persist across a restart, and print and JSON modes draw nothing.

## Alternatives Considered

### Alternative A: Read the files again at every refresh

- **Approach**: whenever the status line is drawn (at session start and after each `/jev`), and whenever `/jev` runs, read `config.json` and `state.json` and resolve the settings again. No settings are kept in memory.
- **Pros**: always matches the files, including edits the operator makes by hand. Nothing to invalidate. A main session and its child sessions, being separate extension instances, cannot disagree.
- **Cons**: two small file reads per refresh.
- **Why chosen**: see Agreed Approach.

### Alternative B: Load the settings once and keep them in memory

- **Approach**: read the files at `session_start` and keep the resolved settings in module state; `/jev` updates memory and writes through to the file.
- **Pros**: no reads after start.
- **Cons**: a hand edit to `config.json` is ignored until the next restart. Module state is not shared between the main and child extension instances, so later work groups would have to keep the two in sync.
- **Why not chosen**: refreshes are rare (session start and commands), so the cost of reading again is trivial. Keeping state in memory adds a source of drift for no measurable gain.

### Alternative C: Watch the files

- **Approach**: like B, plus a file watcher that reloads on change.
- **Pros**: hand edits show up at once.
- **Cons**: a watcher is a long-lived resource that must be cleaned up on shutdown and child disposal. It behaves differently on different platforms, and nobody has asked for live reloading.
- **Why not chosen**: complexity with no requirement behind it.

## Agreed Approach

Alternative A. Every refresh and every `/jev` run reads the config and state from disk, resolves them with `resolveSettings`, and works from that snapshot. The executor and key checks run at the same moments. Because these checks run when the status is drawn and not when the extension loads, extension load order does not matter.

## Key Decisions

Decisions the operator made in the explore thread:

1. The status line shows only the base state until WG-07 adds decisions.
2. `/jev` commands owned by later work groups are treated as unknown, and the usage text lists only the commands that exist.
3. `/jev` output goes through `ctx.ui.notify` when `ctx.hasUI`, and is silent in print and JSON mode.
4. The child registry is real now: subscription, registry and `isChild(sessionId)`. The status line and `/jev` do nothing in a child session.

Proposed by the agent; correct these at the gate:

5. **Priority of the status line text**: `config error` > `no key` > `off` > `<mode>`. `off` means every feature switch except `status` and `verbose` is off, so the package would do nothing.
6. **The `status` switch** controls only the status line. With `status` off the widget is cleared, but `/jev` still works.
7. **A malformed `state.json`** does not change the status line text, since defaults apply. `/jev` reports the problem. An unreadable `state.json` makes `/jev` changes report a refusal, as the state-file spec already requires.
8. **No executor** is reported by `/jev` as `no executor`, with a note that worker routing and tool assessment are off. The status line does not show it.
9. **Feature words** come from the existing `FEATURES` list. `on` and `off` are the only values accepted.
10. **`/jev all on|off`** sets the seven decision features (`effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review`) and leaves `status` and `verbose` alone. If it also turned `status` off, the line would disappear and `Jev · off` would never be seen. `docs/usage-guide.md` will say this explicitly.

## Open Questions

None that block the design. Exact wording of the usage text and of `/jev` status lines is left to the builder, within the vocabulary of `docs/usage-guide.md`.
