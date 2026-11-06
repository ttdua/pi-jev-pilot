# WG-06 Status Line and `/jev` Base Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Give the package a status line above the editor, a base `/jev` command with persistent feature switches, a real child-session registry, and key and executor presence checks, without calling Jev.

**Architecture:** Four `src/host/` modules, each with a pure core and a thin Pi-facing edge: `child.ts`, `readiness.ts`, `status.ts` and `commands.ts`. `src/host/setup.ts` wires them; `src/extension.ts` only delegates to it, because lint forbids Pi imports in the entry point. Every refresh reads `config.json` and `state.json` again through the WG-03 stores (design D2).

**Tech Stack:** TypeScript run by Pi 1.5.0, Bun 1.4.4 test runner, `@gotgenes/pi-subagents` 25.0.5 (dev only), oxlint and oxfmt.

## Global Constraints

- Public Pi APIs only. Only `src/host/` imports `@earendil-works/pi-coding-agent`. `src/extension.ts` imports only `./host/setup.ts` (`.oxlintrc.json` override for `src/extension*.ts`).
- No new dependency. `@earendil-works/pi-tui` is not imported (design D4).
- No Jev call and no network call beyond the loopback provider fixture in tests. Tests need no secrets; the key is a dummy value such as `test-key`.
- Never display, store or log the key's value, prompt text, tool arguments or tool output.
- Widget key `jev`; placement `aboveEditor`. Texts: `Jev · config error`, `Jev · no key`, `Jev · off`, `Jev · <mode>`. The separator is U+00B7 with one space either side.
- Decision features (for `all` and `off`): `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review`. `status` and `verbose` are never touched by `all`.
- Output only through `ctx.ui.notify` and only when `ctx.hasUI`. Nothing is written to stdout or stderr.
- English in code, comments, docs and commit messages.

## Review Focus

1. **`/jev` while the agent is streaming.** RPC runs extension commands immediately even during a run. Expected: the change applies and the line refreshes without disturbing the run. Test added to Task 6 (`/jev` sent after a prompt has started).
2. **The `jev` directory missing on first `/jev skills off`.** Expected: `updateState` creates it owner-only and the change applies. Test added to Task 4.
3. **Session replacement (`/new`, `/resume`, `/fork`).** Expected: `session_start` redraws for every reason, and `session_shutdown` unsubscribes the old handlers without clearing the shared registry. Test added to Task 5 (unit: shutdown then start again keeps one subscription).
4. **Config file present but empty object `{}`.** Expected: valid, line shows the mode. Test added to Task 2.
5. **Key variable set to whitespace only.** Expected: counts as set, since the spec says non-empty; the client decides later whether it works. Test added to Task 2, pinning that choice.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `/jev` command | new | `/jev` · `/jev <feature> on\|off` with `<feature>` in `effort subagents skills strategy tools expert review status verbose` · `/jev all on\|off` · `/jev reset`; anything else → usage text, `warning` | yes |
| Status line widget | new | `setWidget("jev", …, { placement: "aboveEditor" })`; RPC `widgetLines: [text]`; TUI component, one line right-aligned; text per Global Constraints | yes |
| `CHILDREN_KEY` | new | `Symbol.for("pi-jev-pilot.children")` → `Set<string>` on `globalThis` | yes (shared with later work groups and other instances) |
| `isChild` | new | `(sessionId: string) => boolean` | no |
| `subscribeChildren` | new | `(events: { on(ch: string, h: (d: unknown) => void): () => void }) => () => void` | no |
| `Snapshot` | new | `{ config: { valid: true } \| { valid: false; issues: Issue[] }; state: { kind: StateRead["kind"]; issues: Issue[] }; settings: Settings; keyVar: string; keySet: boolean; executor: boolean }` | no |
| `isKeySet` | new | `(env: Record<string, string \| undefined>, varName: string) => boolean` (non-empty string) | no |
| `hasExecutor` | new | `(toolNames: readonly string[]) => boolean` (contains `subagent`) | no |
| `buildSnapshot` | new | `(input: { configRead: ConfigRead; stateRead: StateRead; env: Record<string, string \| undefined>; toolNames: string[] }) => Snapshot` | no |
| `loadSnapshot` | new | `(pi: Pick<ExtensionAPI, "getAllTools">) => Snapshot` | no |
| `statusText` | new | `(s: Snapshot) => string` | no |
| `alignRight` | new | `(text: string, width: number) => string` | no |
| `drawStatus` | new | `(ctx: Pick<ExtensionContext, "hasUI" \| "mode" \| "ui">, s: Snapshot) => void` | no |
| `JevArgs` | new | `{ kind: "status" } \| { kind: "set"; feature: Feature; on: boolean } \| { kind: "all"; on: boolean } \| { kind: "reset" } \| { kind: "usage" }` | no |
| `parseJevArgs` | new | `(text: string) => JevArgs` | no |
| `usageText` / `formatStatus` | new | `() => string` / `(s: Snapshot) => string` | no |
| `runJev` | new | `(args: string, ctx: ExtensionCommandContext, deps: { dir: string; load: () => Snapshot }) => Promise<void>` | no |
| `setup` | new | `(pi: ExtensionAPI) => void` in `src/host/setup.ts`; `src/extension.ts` default export is `(pi: Parameters<typeof setup>[0]) => setup(pi)` | no |
| `DECISION_FEATURES` | new | `readonly Feature[]` of the seven decision features, in `src/store/defaults.ts` | no |

No file format changes: `state.json` and `config.json` keep their WG-03 shapes.

---

## Task 1: Child registry — implements 1.1

**Files:**
- Create: `src/host/child.ts`
- Test: `tests/host/child.test.ts`

**Interfaces:**
- Produces: `CHILDREN_KEY`, `isChild`, `subscribeChildren` (see Contracts).

- [ ] **Step 1: Write the failing tests** with a fake bus (`Map<string, Set<handler>>`, `on` returns a remover) and `afterEach` clearing `globalThis[CHILDREN_KEY]`:
  - `records created id`: emit `subagents:child:session-created` `{ sessionId: "c1" }` → `isChild("c1")` true, `isChild("main")` false.
  - `removes disposed id`: then emit `subagents:child:disposed` `{ sessionId: "c1" }` → false.
  - `ignores bad payloads`: emit both events with `{}`, `null`, `{ sessionId: 7 }` → no throw, registry size 0.
  - `shared across instances`: two buses subscribed, emit on one → `isChild` true; the `Set` holds the id once.
  - `unsubscribe stops recording`: call the returned function, emit created `c2` → `isChild("c2")` false.
- [ ] **Step 2:** `bun test tests/host/child.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** in `src/host/child.ts`. The returned function removes both handlers.
- [ ] **Step 4:** `bun test tests/host/child.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: add child session registry`.

---

## Task 2: Readiness snapshot — implements 2.1, 2.2

**Files:**
- Create: `src/host/readiness.ts`
- Modify: `src/store/defaults.ts` (add `DECISION_FEATURES`)
- Test: `tests/host/readiness.test.ts`

**Interfaces:**
- Consumes: `readConfig`, `readState`, `resolveSettings`, `jevDir`.
- Produces: `Snapshot`, `buildSnapshot`, `loadSnapshot`, `DECISION_FEATURES`.

- [ ] **Step 1: Write failing pure tests** for `buildSnapshot`:
  - `default key variable`: env `{ TYPESAFE_API_KEY: "test-key" }`, config ok `{}` → `keySet` true, `keyVar` `"TYPESAFE_API_KEY"`.
  - `configured key variable`: config `classifier.apiKeyEnv` `MY_JEV_KEY`, env has only `MY_JEV_KEY` → true.
  - `empty value`: `""` → false. `whitespace value`: `"  "` → true (Review Focus 5).
  - `executor`: `toolNames` `["read","subagent"]` → true; `["read"]` → false.
  - `invalid config keeps switches`: config invalid with one issue, state ok `{ switches: { skills: false } }`, env has `TYPESAFE_API_KEY` → `config.valid` false, issues kept, `settings.switches.skills` false, `keySet` true.
  - `empty config object`: config ok `{}` present → `config.valid` true, `settings.mode` `"standard"` (Review Focus 4).
  - `state problems kept`: state malformed with issues → `state.kind` `"malformed"`, issues kept, switches default.
  - `invalid config ignores its key variable`: config invalid (its file also names `classifier.apiKeyEnv: "OTHER"`), env has only `TYPESAFE_API_KEY` → `keyVar` `"TYPESAFE_API_KEY"`, `keySet` true.
  - `isKeySet` and `hasExecutor` directly, with the same values.
- [ ] **Step 2: Write a failing I/O test** for `loadSnapshot` with `PI_CODING_AGENT_DIR` set to a temp dir: write `jev/state.json` `{"version":1,"mode":"budget"}` by hand → `settings.mode` `"budget"`; fake `pi.getAllTools` returning `[{ name: "subagent" }]` → `executor` true.
- [ ] **Step 3:** `bun test tests/host/readiness.test.ts` → FAIL.
- [ ] **Step 4: Implement.** On an invalid config, call `resolveSettings({ config: {}, state })`, so `keyVar` falls back to `DEFAULTS.classifier.apiKeyEnv`. `loadSnapshot` reads `process.env` at call time.
- [ ] **Step 5:** `bun test tests/host/readiness.test.ts` → PASS. Commit `feat: add readiness snapshot`.

---

## Task 3: Status line — implements 3.1, 3.2

**Files:**
- Create: `src/host/status.ts`
- Test: `tests/host/status.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `DECISION_FEATURES`.
- Produces: `statusText`, `alignRight`, `drawStatus`.

- [ ] **Step 1: Write failing tests** for `statusText`, building snapshots with a local helper:
  - ready default → `"Jev · standard"`; mode `premium` → `"Jev · premium"`;
  - key unset → `"Jev · no key"`; config invalid and key unset → `"Jev · config error"`;
  - all seven off → `"Jev · off"`; only `skills` off → `"Jev · standard"`;
  - executor absent → `"Jev · standard"`; state malformed → `"Jev · standard"`;
  - all seven off but `status` and `verbose` on or off → still `"Jev · off"`.
- [ ] **Step 2: Write failing tests** for `alignRight`: `("Jev · standard", 40)` has length 40 and ends with the text; width 5 → `"Jev ·"`.
- [ ] **Step 3: Write failing tests** for `drawStatus` with a fake `ui` recording `setWidget` calls:
  - `hasUI` false → no calls, whatever the mode.
  - mode `rpc` → `setWidget("jev", ["Jev · standard"], { placement: "aboveEditor" })`.
  - mode `tui` → the content is a function; calling it with stub `tui` and `theme` returns an object whose `render(40)` is `[alignRight(text, 40)]`.
  - `status` off → `setWidget("jev", undefined, …)`.
- [ ] **Step 4:** `bun test tests/host/status.test.ts` → FAIL.
- [ ] **Step 5: Implement.** Branch on `ctx.mode` before calling `setWidget`: its two overloads do not accept a union argument. The TUI factory returns `{ render, invalidate() {} }`, since `Component` requires `invalidate`. Test fakes for `ctx.ui` are cast to the Pi type.
- [ ] **Step 6:** → PASS. Commit `feat: add status line`.

---

## Task 4: `/jev` command — implements 4.1, 4.2

**Files:**
- Create: `src/host/commands.ts`
- Test: `tests/host/commands.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `loadSnapshot`, `statusText`, `drawStatus`, `isChild`, `updateState`, `resetState`, `FEATURES`, `DECISION_FEATURES`.
- Produces: `JevArgs`, `parseJevArgs`, `usageText`, `formatStatus`, `runJev`.

- [ ] **Step 1: Write failing tests** for `parseJevArgs`: `""` and `"   "` → status; `"skills off"` → set false; `"status on"` → set true; `"all off"` → all false; `"reset"` → reset; `"mode premium"`, `"colors off"`, `"skills maybe"`, `"skills off now"`, `"Skills off"`, `"reset now"`, `"skills"`, `"all"`, `"status"` → usage (a bare word is never the status form; only an empty argument is).
- [ ] **Step 2: Write failing tests** for `usageText`: contains `/jev`, `/jev <feature> on|off`, every one of the nine feature names, `/jev all on|off`, `/jev reset`; no line starts with `/jev mode`, `/jev cli-review`, `/jev tune` or `/jev remove`.
- [ ] **Step 3: Write failing tests** for `formatStatus`: includes `statusText`, `mode: standard`, each feature with `on`/`off`, `TYPESAFE_API_KEY` and `set`/`not set`; with the env value `test-key` the output never contains `test-key`; executor absent → contains `no executor` and `worker routing and tool assessment are off`; config issue at `classifier.timeoutMs` → contains that path; malformed state → contains each issue path.
- [ ] **Step 4: Write failing tests** for `runJev` with a fake `ctx` (`hasUI`, `mode: "rpc"`, `ui.notify`/`ui.setWidget` recorders, `sessionManager.getSessionId()`) and `deps.dir` a temp jev dir that does not exist yet:
  - `skills off` → `readState(dir)` has `switches.skills` false, directory created (Review Focus 2), one `info` notify, one `setWidget`; then `skills on` → `switches.skills` true.
  - `status off` → `setWidget("jev", undefined, …)` and one `info` notify still sent.
  - `all off` → seven decision features false, `status` and `verbose` absent from state; then `all on` → the seven true.
  - `reset` after `skills off` and `mode: premium` written by hand → state has no fields.
  - malformed `state.json` then `skills off` → `state.json.bad` exists, state is `{ switches: { skills: false } }`.
  - `chmod 000 state.json` then `skills off` (skip when `process.getuid?.() === 0`) → one `error` notify containing `EACCES`, no `setWidget`, no `.bad`.
  - `mode premium` → one `warning` notify with the usage text, state unchanged.
  - `hasUI` false → no notify, no `setWidget`, but `skills off` is still written.
  - child: register the session id via `globalThis[CHILDREN_KEY]` → no notify, no write, no `setWidget`.
  - throwing `deps.load` → returns normally, one `error` notify.
- [ ] **Step 5:** `bun test tests/host/commands.test.ts` → FAIL. **Step 6: Implement** (`all` is one `updateState` call; confirm `writeFileAtomic` in `src/store/atomic.ts` creates the directory owner-only). The fake `ctx` is cast to `ExtensionCommandContext`. **Step 7:** → PASS. Commit `feat: add base /jev command`.

---

## Task 5: Wiring — implements 5.1, 5.2

**Files:**
- Create: `src/host/setup.ts`
- Modify: `src/extension.ts`, `tests/load.test.ts`
- Test: `tests/host/setup.test.ts`

**Interfaces:**
- Consumes: every `Produces` above.

- [ ] **Step 1: Update `tests/load.test.ts`**: rename "loaded extension registers nothing" to "loaded extension registers only /jev and handlers"; expect `[...ext.commands.keys()]` to equal `["jev"]`, `[...ext.handlers.keys()].sort()` to equal `["session_shutdown", "session_start"]`, and tools, flags, shortcuts empty.
- [ ] **Step 2: Write `tests/host/setup.test.ts`** against `setup` with a fake `ExtensionAPI` (records `on`, `registerCommand`, `events.on`; `getAllTools` returns `[]`):
  - the factory subscribes to both child events before any handler runs;
  - `session_start` with `setWidget` throwing returns normally;
  - `session_start` with `hasUI` true and a child session id makes no `setWidget` call (this is the proof of the child guard);
  - `session_shutdown` then a new factory call and `session_start`: one live subscription per instance, and the registry keeps its ids (Review Focus 3).
- [ ] **Step 3:** `bun test tests/load.test.ts tests/host/setup.test.ts` → FAIL. **Step 4: Implement** `setup` (design D5, D8) and reduce `src/extension.ts` to the delegation in Contracts; `bun run lint` passes. **Step 5:** → PASS. Commit `feat: wire status line, /jev and child registry`.

---

## Task 6: Host tests through the real CLI — implements 6.1–6.5

**Files:**
- Modify: `tests/host/harness.ts`, `tests/host/fixture.ts`
- Create: `tests/host/jev-base.test.ts`

These tests verify after the fact: Tasks 1–5 already pass their unit tests, so there is no red step. Where cheap, run a new test once against `src/extension.ts` reverted to the empty factory to see it fail.

**Interfaces:**
- Produces: `startHostSession({ …, self?: boolean, agentDir?: string })` (installs the checkout with `pi install REPO_ROOT`, and reuses a given agent directory for restarts without deleting it on close); `runOnce({ fixture, mode: "print" | "json", message, self, agentDir?, cwd?, env }) → { code, stdout, stderr, agentDir, cwd }`. (Apply deviation: `startHostSession` also takes `cwd?`, and `runOnce` takes and returns `cwd`, so print runs can share the cwd for the request comparison; the caller removes directories the call created.)

- [ ] **Step 1: Extend the harness and fixture.** Add `delayMs?: number` to `ScriptEntry`, applied before the reply streams. Factor the setup of `startHostSession` (temp cwd, `home`, `models.json`, installs) into a shared function. `self` installs the checkout; a given `agentDir` and `cwd` are reused and left for the test's own `afterEach` cleanup. `runOnce` uses the same setup and spawns `pi -p <message>` or `pi --mode json <message>` with the same isolated env, `--provider fixture --model fixture-main --no-session`, and a 30 s timeout.
- [ ] **Step 2: Write RPC tests** (`TYPESAFE_API_KEY=test-key` unless stated):
  - start → exactly one `extension_ui_request` `setWidget` with `widgetKey` `jev`, `widgetLines` `["Jev · standard"]`, `widgetPlacement` `aboveEditor`;
  - no key variable → `widgetLines` `["Jev · no key"]`;
  - `/jev` (sent as a `prompt` command) → response `disposition` `handled`, one `notify` `info`; `get_messages` holds no message from it;
  - `/jev effort off` … `/jev expert off`, then `/jev review off` → last `jev` widget lines `["Jev · off"]`;
  - `/jev status off` → last `jev` widget request has no `widgetLines`;
  - `/jev mode premium` → `notify` `warning`;
  - with `executor: true` the `/jev` notify says the executor is present; without it, it contains `no executor`;
  - `/jev skills off` sent while a prompt is streaming (fixture reply delayed) → state written and the run completes (Review Focus 1).
- [ ] **Step 3: Write the restart test**: session A on agent dir D runs `/jev skills off` and closes; session B on D runs `/jev` → notify contains `skills` `off`.
- [ ] **Step 4: Write print and JSON tests**: `runOnce` print with prompt `hello` → stdout contains no `Jev ·`, and the fixture's recorded request bodies equal those of a run without `self` on the same `cwd` and `agentDir` (uninstall in between with `pi remove`, or install into a second agent dir and replace its path in the bodies before comparing); JSON mode → no stdout line contains `Jev ·` or `"widgetKey":"jev"`; `runOnce` print `"/jev skills off"` → stdout empty, `jev/state.json` has `switches.skills` false.
- [ ] **Step 5: Write the child smoke test** using the `subagent` script pattern from `tests/host/q3-q4-child.test.ts` with `executor: true`, `self: true`: after the child completes, `jev` `setWidget` requests number exactly one (the main start).
- [ ] **Step 6:** `bun test tests/host/jev-base.test.ts` → PASS (Tasks 1–5 make it pass; if a scenario fails, fix the owning module, not the test). Commit `test: cover status line and /jev through the real CLI`.

---

## Task 7: Documentation — implements 7.1–7.4

**Files:**
- Modify: `docs/usage-guide.md`, `docs/architecture.md`, `docs/roadmap.md`
- After archive: `openspec/specs/package-loading/spec.md` (Purpose line)

- [ ] **Step 1:** `docs/usage-guide.md` — Switches: `/jev all on|off` sets the seven decision features and leaves `status` and `verbose` alone; the status texts and their meaning; mark `mode`, slot, `cli-review` and `tune` forms with the work group that adds them.
- [ ] **Step 2:** `docs/architecture.md` — add `readiness.ts` and `setup.ts` under `host/`; Display surfaces: base states and precedence; `/jev` output through notifications; child detection: unsubscribe on `session_shutdown`.
- [ ] **Step 3:** `docs/roadmap.md` — WG-06 status `Done` after merge, and "child registry" instead of "child registry stub".
- [ ] **Step 4:** `bun run fmt:check`. Commit `docs: document status line and base /jev`.
- [ ] **Step 5 (after archive):** set the `package-loading` Purpose to "…loads without error and registers only the `/jev` command and its session handlers." Commit `docs: update package-loading purpose`.

---

## Task 8: Checks — implements 8.1

- [ ] **Step 1:** `bun run typecheck && bun run lint && bun run fmt:check && bun test` → all pass, run with no network except loopback and no real key.

---

## Scenario → test

**status-line**
- Ready with the default mode → `status.test.ts` ready default; `jev-base.test.ts` start
- Mode from state → `status.test.ts` premium
- No key → `status.test.ts` key unset; `jev-base.test.ts` no key variable
- Config error wins over no key → `status.test.ts` config invalid and key unset
- Everything off → `status.test.ts` all seven off
- One feature off is not off → `status.test.ts` only skills off
- No executor is not shown → `status.test.ts` executor absent
- Malformed state uses defaults → `status.test.ts` state malformed
- Drawn at session start in RPC mode → `jev-base.test.ts` start
- Right-aligned in the terminal UI → `status.test.ts` drawStatus tui render(40)
- Narrow terminal → `status.test.ts` alignRight width 5
- Refreshed after a switch change → `jev-base.test.ts` review off → `Jev · off`
- Status off → `jev-base.test.ts` status off; `commands.test.ts` status off
- Status off at start → `status.test.ts` status off clears
- Throwing widget call → `setup.test.ts` setWidget throwing
- Print mode → `jev-base.test.ts` print hello
- JSON mode → `jev-base.test.ts` JSON mode
- Child session → `setup.test.ts` child id with `hasUI` true; `jev-base.test.ts` child smoke test

**jev-command**
- Default status → `commands.test.ts` formatStatus; `jev-base.test.ts` executor present
- No executor → `commands.test.ts` executor absent; `jev-base.test.ts` without executor
- Key name, never value → `commands.test.ts` never contains `test-key`
- Malformed state reported → `commands.test.ts` malformed state issue paths
- Invalid config reported → `commands.test.ts` `classifier.timeoutMs` path
- Turn a feature off → `commands.test.ts` skills off
- Switch survives a restart → `jev-base.test.ts` restart
- Turn a feature back on → `commands.test.ts` skills off then on
- All off → `commands.test.ts` all off; `jev-base.test.ts` sequence to `Jev · off`
- All on → `commands.test.ts` all off then on
- Reset after changes → `commands.test.ts` reset
- Unreadable state → `commands.test.ts` chmod 000
- Malformed state recovered by a change → `commands.test.ts` malformed then skills off
- Command from a later work group → `commands.test.ts` mode premium; `jev-base.test.ts` warning
- Unknown feature / Bad value / Extra words / Whitespace only → `commands.test.ts` parseJevArgs cases
- Throwing tool list → `commands.test.ts` throwing `deps.load`
- RPC notify → `jev-base.test.ts` `/jev` handled, info, no message
- Print mode is silent → `jev-base.test.ts` print `/jev skills off`
- Command in a child → `commands.test.ts` child

**child-registry**
- Child recorded before its session starts → `child.test.ts` records created id (ordering itself is WG-02 evidence Q4); `jev-base.test.ts` child smoke test
- Shared across instances → `child.test.ts` shared across instances
- Disposed child removed → `child.test.ts` removes disposed id
- Bad payload ignored → `child.test.ts` ignores bad payloads
- Unsubscribed on shutdown → `child.test.ts` unsubscribe; `setup.test.ts` shutdown
- Main session / Recorded child → `child.test.ts` records created id
- Subscribing twice → `child.test.ts` shared across instances

**readiness-checks**
- Default variable set / Configured variable / Empty value → `readiness.test.ts`
- Executor installed → `readiness.test.ts` executor; `jev-base.test.ts` executor present
- Executor absent → `readiness.test.ts` executor; `jev-base.test.ts` without executor
- Hand edit picked up → `readiness.test.ts` loadSnapshot budget
- Invalid config keeps switches → `readiness.test.ts`
- Invalid config uses the default key variable → `readiness.test.ts` invalid config ignores its key variable

**package-loading**
- Loaded extension registers only /jev and handlers → `load.test.ts`
