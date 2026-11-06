## 1. Child registry

- [x] 1.1 Add `src/host/child.ts`: a `Set<string>` on `globalThis[Symbol.for("pi-jev-pilot.children")]`, `isChild(sessionId)`, and `subscribeChildren(events)` that handles `subagents:child:session-created` and `subagents:child:disposed`, ignores payloads without a string `sessionId`, and returns an unsubscribe function (specs/child-registry). Unit tests in `tests/host/child.test.ts` with a fake event bus.

## 2. Readiness snapshot

- [x] 2.1 Add `DECISION_FEATURES` to `src/store/defaults.ts`, and `src/host/readiness.ts`: pure `isKeySet(env, varName)`, `hasExecutor(toolNames)` and `buildSnapshot({ configRead, stateRead, env, toolNames })`. An invalid config resolves the settings from an empty config and the state and uses `TYPESAFE_API_KEY` (specs/readiness-checks). Unit tests in `tests/host/readiness.test.ts`.
- [x] 2.2 Add `loadSnapshot(pi)` in the same module, reading `readConfig(jevDir())`, `readState(jevDir())`, `process.env` and `pi.getAllTools()` at call time. Test it against a temporary `PI_CODING_AGENT_DIR`, including a hand-edited `state.json`.

## 3. Status line

- [x] 3.1 Add `src/host/status.ts`: pure `statusText(snapshot)` with the precedence `config error` > `no key` > `off` > mode, and `alignRight(text, width)` (pad, or cut when narrow). Unit tests in `tests/host/status.test.ts` for every status-line text scenario.
- [x] 3.2 Add `drawStatus(ctx, snapshot)`: nothing without `ctx.hasUI`; clear `jev` when `status` is off; a component factory in `tui` mode and `string[]` in `rpc` mode, placed `aboveEditor`. Unit tests with a fake `ctx.ui`.

## 4. /jev command

- [x] 4.1 Add `src/host/commands.ts`: pure `parseJevArgs(text)` returning `status`, `set`, `all`, `reset` or `usage`; `usageText()`; `formatStatus(snapshot)` (mode, nine switches, key variable name, executor, config and state problems). Unit tests in `tests/host/commands.test.ts`, including the usage cases and that the key value never appears.
- [x] 4.2 Add `runJev(args, ctx, deps)`: child guard; apply the change through `updateState`/`resetState`; one `updateState` for `all`; report refused changes as `error` only; refresh the status line after a change; notify only with `ctx.hasUI`; catch every error. Unit tests against a temporary jev directory, including `EACCES` (skipped as root) and the malformed-state recovery.

## 5. Wiring

- [x] 5.1 Add `src/host/setup.ts` with `setup(pi)`, and make `src/extension.ts` delegate to it (lint forbids Pi imports in the entry point): `subscribeChildren(pi.events)` in the factory; `session_start` (child guard, `loadSnapshot`, `drawStatus`, errors swallowed); `session_shutdown` unsubscribes; `registerCommand("jev", …)` calling `runJev`. No other registrations.
- [x] 5.2 Update `tests/load.test.ts` for the "Extension registrations are bounded" requirement (commands exactly `jev`; handlers exactly `session_start` and `session_shutdown`; no tools, flags or shortcuts).

## 6. Host tests through the real CLI

- [x] 6.1 Extend `tests/host/harness.ts` with an option to install the repository checkout itself and to reuse an agent directory, factor its setup so a helper can run the pinned `pi` once in print mode (`-p`) and in JSON mode (`--mode json`) with the same isolated agent directory and loopback fixture; add a per-entry reply delay to `tests/host/fixture.ts`.
- [x] 6.2 Add `tests/host/jev-base.test.ts` (RPC): `setWidget` for `jev` with `["Jev · standard"]` and `aboveEditor` at start; `no key` without the variable; `/jev` notifies `info` and adds no session message; `/jev review off` after the others redraws `Jev · off`; `/jev status off` clears the widget; `/jev mode premium` gives a `warning`; `/jev` with the executor installed reports it present, and without it reports `no executor`.
- [x] 6.3 Add the restart test: `/jev skills off` in one RPC process, a new process on the same agent directory, `/jev` reports `skills` `off`.
- [x] 6.4 Add print and JSON tests: one prompt with the package installed produces no `Jev ·` text and no `jev` widget record, and its provider requests match a run without the package on the same cwd and agent directory; `pi -p "/jev skills off"` prints nothing from the package and writes `switches.skills` `false`.
- [x] 6.5 Add a child smoke test with the executor and a scripted `subagent` launch: every `jev` widget request comes from the main session. The guard itself is proven by the unit test in 5.1, since a child may have no UI anyway.

## 7. Documentation

- [x] 7.1 Update `docs/usage-guide.md`: `/jev all on|off` leaves `status` and `verbose` alone; mark which `/jev` forms exist from WG-06 and which arrive later; base status texts.
- [x] 7.2 Update `docs/architecture.md`: add `host/readiness.ts` and `host/setup.ts` to the module layout; the status line base states and precedence; `/jev` output through notifications.
- [x] 7.3 Update `docs/roadmap.md`: WG-06 status, and the child registry being real rather than a stub.
- [ ] 7.4 After archive, update the Purpose line of `openspec/specs/package-loading/spec.md`, which still says the extension has no effect.

## 8. Checks

- [x] 8.1 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass with no secrets and no network beyond loopback.
