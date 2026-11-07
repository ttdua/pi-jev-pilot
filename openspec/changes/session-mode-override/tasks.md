## 1. Resolver session layer

- [x] 1.1 Add the optional `sessionMode` input to `resolveSettings` and return `mode`, `modeSource` and `savedMode` (`settings-resolution` "One resolver for effective settings", "State overrides"; design D1), with store tests for every new scenario

## 2. Session entry reader

- [x] 2.1 Add a pure reader in `src/jev/` that returns the session mode from branch entries: newest valid `jev-mode` entry, `null` clears it, invalid entries skipped (`session-mode` "Session mode from the branch"; design D3), with unit tests for the damaged and clear scenarios

## 3. Host holder and snapshot

- [x] 3.1 Add `src/host/session-mode.ts`: an in-memory holder tagged with its session id, offering rebuild-from-branch and set-after-append (`session-mode` "Session mode entry", "Session mode belongs to its session"; design D2)
- [x] 3.2 Make `loadSnapshot` pass the holder's mode to the resolver only for the current main session id, leaving every call site unchanged (design D2)
- [x] 3.3 Rebuild the holder at every main `session_start` and at `session_tree`, then redraw the status line after the tree rebuild; skip child sessions (`session-mode` "Session mode from the branch", "Inert in a child session")

## 4. Command forms

- [x] 4.1 Parse `/jev mode <m> session` and `/jev mode session off`, keep every other extra-word form as usage, and update the usage text (`jev-command` "Usage text for other input"; design D4)
- [x] 4.2 Run the set and clear forms: append the `jev-mode` entry, update the holder after the append succeeds, report `no session mode set` when there is nothing to clear, never touch `state.json` (`session-mode` "Set a session mode", "Clear the session mode", "Session mode entry")
- [x] 4.3 `/jev mode <m>` while a session mode is set: save, keep the session mode, add the `still applies here` report line (`jev-command` "Mode"; design D5)
- [x] 4.4 `/jev reset` clears the session mode only after a successful state reset (`jev-command` "Reset"; design D6)

## 5. Visible text

- [x] 5.1 Status line `(session)` marker in the base form and the tally form (`status-line` "Status line text"; design D7)
- [x] 5.2 `/jev` report `mode: <m> (session; saved <s>)`, with the mix line using the effective mode (`jev-command` "Status report")

## 6. End-to-end host tests

- [x] 6.1 Host-harness tests for resume, reload, fork, `/tree` before the entry, new session, worker routed with the session mode and its ledger `mode`, other process keeps the saved mode, child inert, append failure

## 7. Docs

- [x] 7.1 Update `docs/usage-guide.md`, `README.md`, `docs/architecture.md` (precedence and the `jev-mode` entry) and `docs/glossary.md` (session mode)
- [x] 7.2 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass
