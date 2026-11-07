# WG-17 Tally and Log Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Add a per-session tally (shown by `/jev` and, on every 10th decided prompt, on the status line) and `verbose`-gated `jev-log` transcript entries that never reach a provider.

**Task order:** 1, 2, 3 (`/jev`), 4 (main), 5 (setup wiring), 6, 7. Each task is green on its own.

**Architecture:** A main-session observer (`src/host/tally.ts`) sits at the existing ledger-append seam. Every validated `main`, `worker` and `correction` line is counted there and, while `verbose` is on, appended as a `jev-log` custom entry (design D1). Pure text builders live in `src/host/status.ts`. `createMain` keeps a display overlay for the 10th-prompt tally (design D3), and `/jev` reads the tally and the overlay through new dependencies.

**Tech Stack:** TypeScript on Bun (`bun test`, `oxlint`, `oxfmt`), official Pi extension API (`pi.appendEntry`, `pi.registerEntryRenderer`, `ctx.ui.setWidget`), the existing host harness in `tests/host/`.

## Global Constraints

- No new dependency; do not import `@earendil-works/pi-tui`. A renderer returns `{ render(width): string[]; invalidate(): void }`, as `drawStatus` already does.
- Only `src/host/` imports Pi. `policy/`, `store/`, `jev/` and `shared/` stay unchanged.
- No change to `ledger.jsonl`, `state.json`, `config.json`, `FEATURES` or `/jev` argument forms.
- Fail open: tally, log and renderer errors are swallowed and never affect a turn, a launch or a ledger line.
- Never put prompt text, brief text or tool arguments in a log entry. Data is the validated ledger line only.
- Tests need no secrets, paid calls or network beyond loopback.
- Public repository: code, comments, tests and docs in English.
- Read and apply `~/.agents/skills/coding-standards/SKILL.md` and the stacks it dispatches.

## Review Focus

- Late worker completion after `/new` (session replaced). The new session's tally must stay 0. Pinned in Task 2 (`late line from replaced session`).
- `verbose` flipped between a prompt and its settle. The switch is read at record time, so a line recorded after `/jev verbose on` is logged. Pinned in Task 2 (`switch read at record time`).
- A 10th prompt whose classification is cancelled with Esc. No overlay is drawn, and the next prompt is still the 10th. Pinned in Task 4 (`cancelled 10th prompt shows no tally`, `cancelled 11th prompt keeps the overlay`).
- A tally overlay while the base state changes to `off` or `no key`. The base state wins. Pinned in Task 1 (`overlay ignored for base states`).
- A renderer given a hand-crafted or old entry (wrong shape or `v`). It renders nothing and does not throw. Pinned in Task 1 (`logLine rejects invalid data`) and Task 5 (`renderer swallows`).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `Tally` (`src/host/status.ts`) | new | `{ prompts: number; workers: number; byModel: ReadonlyArray<readonly [model: string, count: number]>; unrouted: number; workerTokens: number; fallbacks: number }` (`byModel` in first-seen order) | no |
| `compactTally(t: Tally, prompts: number): string` | new | returns `` `${prompts} prompts · ${t.workers} workers · ${t.fallbacks} fallbacks` `` | no |
| `tallyLines(t: Tally): string[]` | new | `["session:", "  prompts P", "  workers W[ (m n, …, unrouted n)]", "  worker tokens T", "  fallbacks F"]` | no |
| `logLine(data: unknown): string \| undefined` | new | text per verbose-log spec; `undefined` unless `validateLedgerEntry(data).ok` | no |
| `statusText(s, decision?, overlay?)` / `drawStatus(ctx, s, decision?, overlay?)` | modified | new optional `overlay?: string`; when set and the base form is `Jev · <mode>` with `effort` on, the text is `` `Jev · ${mode} · ${overlay}` `` | no |
| `SessionLog` (`src/host/tally.ts`) | new | `{ reset(sessionId: string): void; record(line: unknown): void; tally(): Tally; prompts(): number }` | no |
| `createSessionLog(pi: Pick<ExtensionAPI, "appendEntry">, deps: { verbose: () => boolean }): SessionLog` | new | `record` validates, applies the session-id guard, counts, then appends `jev-log` when `deps.verbose()` | no |
| `MainDeps.tallyText` | modified (new field) | `tallyText?: () => string \| undefined` | no |
| `createMain(...)` return | modified | adds `overlay(): string \| undefined` | no |
| `runJev` deps | modified | adds optional `tally?: () => Tally; overlay?: () => string \| undefined` (defaults: `EMPTY_TALLY`, no overlay) | no |
| `formatStatus(s: Snapshot, t?: Tally)` | modified | appends `tallyLines(t)` when `t` is given; the first line stays `statusText(s)` without overlay | no |
| `EMPTY_TALLY` (`src/host/status.ts`) | new | `Tally` with all counts 0 and `byModel` `[]` | no |
| `jev-log` custom entry | new | `pi.appendEntry("jev-log", <validated ledger line>)`; stored in Pi session files, not in model context | yes |
| `/jev` report text | modified | ends with the `session:` block (jev-command spec) | yes |
| Status line text | modified | 10th-prompt form `Jev · <mode> · <P> prompts · <W> workers · <F> fallbacks` (status-line spec) | yes |

---

## Task 1: Pure text builders — implements 1.1, 1.2, 1.3

**Files:**
- Modify: `src/host/status.ts`
- Test: `tests/host/status.test.ts`

**Interfaces:**
- Consumes: `validateLedgerEntry` from `src/store/ledger-schema.ts`.
- Produces: `Tally`, `compactTally`, `tallyLines`, `logLine`, and the `overlay` parameter on `statusText` and `drawStatus` (see Contracts).

- [ ] **Step 1: Write failing tests** in `tests/host/status.test.ts`:
  - `describe("compactTally")`: `compactTally({prompts:9,workers:2,byModel:[],unrouted:0,workerTokens:0,fallbacks:1}, 10)` is `"10 prompts · 2 workers · 1 fallbacks"`. With zeros and 10 it is `"10 prompts · 0 workers · 0 fallbacks"`.
  - `describe("tallyLines")`:
    - The empty tally gives `["session:","  prompts 0","  workers 0","  worker tokens 0","  fallbacks 0"]`.
    - `{prompts:2,workers:1,byModel:[["fixture/fast",1]],unrouted:0,workerTokens:120,fallbacks:0}` gives `"  workers 1 (fixture/fast 1)"` and `"  worker tokens 120"`.
    - With `unrouted:1` the pair `unrouted 1` comes last.
  - `describe("logLine")`. Build each input as a schema-valid line (`v:1`, `at`, `session`, `mode`, `answered`, plus the required kind fields), then assert the exact strings of these verbose-log scenarios: Main line text, Sparse main line, Main miss text, Worker untouched head, Worker fallback text, Worker miss text, Worker untouched text, Correction text. Also:
    - `logLine rejects invalid data`: `{kind:"other"}`, `null` and a `main` line with `v:2` all give `undefined`.
  - `describe("overlay")`:
    - `statusText(snap(), {kind:"level",level:"high"}, "10 prompts · 0 workers · 0 fallbacks")` is `"Jev · standard · 10 prompts · 0 workers · 0 fallbacks"`.
    - `overlay ignored for base states`: all-off state with an overlay gives `"Jev · off"`, and no key gives `"Jev · no key"`.
    - With `effort` off, an overlay gives `"Jev · standard"`.
- [ ] **Step 2: Run** `bun test tests/host/status.test.ts`. Expected: FAIL (missing exports).
- [ ] **Step 3: Implement** the builders in `src/host/status.ts`:
  - Seconds are `(ms/1000).toFixed(1)`.
  - Probabilities are `p.toFixed(2)`.
  - Key orders: `effortP` uses `low, medium, high, xhigh, max`; `tierP` uses `fast, balanced, deep, expert`, then the remaining keys in object order.
  - Add `overlay?: string` as the last parameter of `statusText` and `drawStatus`. Existing callers are unchanged.
- [ ] **Step 4: Run** `bun test tests/host/status.test.ts`. Expected: PASS, and the existing status tests still pass.
- [ ] **Step 5: Commit** `git add src/host/status.ts tests/host/status.test.ts && git commit -m "feat(status): tally and log line text"`

---

## Task 2: Session observer — implements 2.1, 2.2

**Files:**
- Create: `src/host/tally.ts`
- Test: `tests/host/tally.test.ts`

**Interfaces:**
- Consumes: `Tally` (Task 1) and `validateLedgerEntry`.
- Produces: `SessionLog` and `createSessionLog` (see Contracts).

- [ ] **Step 1: Write failing tests** in `tests/host/tally.test.ts`, using a fake `pi = { appendEntry: (t, d) => entries.push({t, d}) }`, `verbose` held in a mutable variable, and helpers `main(session)`, `worker(session, extra)` and `correction(session)` that build schema-valid lines.
  - `Mixed session`: the session-tally scenario, with exact counts `prompts 3`, `workers 3`, `byModel [["fixture/fast",1],["fixture/deep",1]]`, `unrouted 1`, `workerTokens 150`, `fallbacks 1`.
  - `Nothing could run is not a fallback`: `tier` `balanced` with `fallback` `balanced` and no `model` gives `fallbacks 0`, `unrouted 1`.
  - `fallback without tier not counted`.
  - `Jev down`: a `main` line with `answered` false and `miss` `error` gives `prompts 1`.
  - `Worker line logged`: with verbose on, a routed `worker` line gives one `jev-log` entry equal to it.
  - `Invalid line ignored`: a worker line with `agent` `"my agent!"` leaves `workers 0`.
  - `correction counts nothing`.
  - `reset clears`: after 4 main lines, `reset("S2")` gives `prompts 0`.
  - `late line from replaced session`: `reset("A")`, then `reset("B")`, then `record(worker("A"))` leaves `workers 0` and appends no entry.
  - `child line ignored`: a line with `session` `"child-1"` after `reset("main-1")` changes nothing.
  - `no session before reset`: a line before any `reset` is ignored.
  - `Verbose off by default`: no entries.
  - `Verbose on`: exactly one entry `{t:"jev-log", d: line}`, where `d` deep-equals the validated line.
  - `Correction logged`: record the correction, then the main line, with verbose on. Two entries, the correction first.
  - `switch read at record time`: record with verbose off, flip it on, record again. One entry.
  - `Throwing appendEntry`: `appendEntry` throws, `record` does not throw, and `prompts()` is 1.
- [ ] **Step 2: Run** `bun test tests/host/tally.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `createSessionLog`:
  - `byModel` is a `Map` kept in insertion order, exposed as an array.
  - The whole of `record` is wrapped in try/catch.
  - Counting reads no file. `deps.verbose()` is called only after the counts are updated, and together with `appendEntry` sits in its own try/catch, so neither a failure there nor reading the switch undoes the counts.
- [ ] **Step 4: Run** `bun test tests/host/tally.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/host/tally.ts tests/host/tally.test.ts && git commit -m "feat(tally): session observer and verbose log entries"`

---

## Task 3: `/jev` tally block — implements 3.3

**Files:**
- Modify: `src/host/commands.ts`
- Test: `tests/host/commands.test.ts`

**Interfaces:**
- Consumes: `Tally` and `tallyLines` (Task 1), and `drawStatus(…, overlay?)` (Task 1).
- Produces: optional `runJev` deps `tally?: () => Tally` and `overlay?: () => string | undefined`, plus `formatStatus(s, t?)`. When `tally` is omitted, the empty tally is used. When `overlay` is omitted, no overlay is drawn. Existing callers and tests stay valid.

- [ ] **Step 1: Write failing tests** in `tests/host/commands.test.ts`. Extend `run()` with optional `tally` and `overlay` arguments.
  - `Empty tally`: with no `tally` dep, the notify text ends with `"session:\n  prompts 0\n  workers 0\n  worker tokens 0\n  fallbacks 0"`.
  - `Tally after work`: the text ends with `"session:\n  prompts 2\n  workers 1 (fixture/fast 1)\n  worker tokens 120\n  fallbacks 0"`.
  - `Tally kept across /jev`: with overlay `"10 prompts · 0 workers · 0 fallbacks"`, `/jev skills off` redraws the widget with `["Jev · standard · 10 prompts · 0 workers · 0 fallbacks"]`.
  - The report's first line stays the base `statusText(s)` without the overlay. Assert that in `Tally kept across /jev`.
  - Existing scenarios still pass, with the tally block now at the end. Update the expectations that match the whole report.
- [ ] **Step 2: Run** `bun test tests/host/commands.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `runJev`:
  - `drawStatus(ctx, snapshot, deps.decision(), deps.overlay?.())`.
  - `notify(formatStatus(snapshot, deps.tally?.() ?? EMPTY_TALLY), "info")`.
  - Export `EMPTY_TALLY` from `status.ts`.
- [ ] **Step 4: Run** `bun run typecheck && bun test tests/host/commands.test.ts tests/host/jev-base.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/host/commands.ts src/host/status.ts tests/host/commands.test.ts && git commit -m "feat(jev): session tally in the status report"`

---

## Task 4: 10th-prompt overlay in main — implements 3.2

**Files:**
- Modify: `src/host/main.ts`
- Test: `tests/host/main.test.ts`

**Interfaces:**
- Consumes: `drawStatus(ctx, s, decision?, overlay?)` (Task 1).
- Produces: `MainDeps.tallyText?: () => string | undefined`, and `createMain(...).overlay(): string | undefined`. Task 5 wires them.

- [ ] **Step 1: Write failing tests** in `tests/host/main.test.ts`. Extend its `setup()` with a `tallyText` option. Each test sets what it returns per prompt.
  - `Ninth prompt shows the level`: `tallyText` returns `undefined`. The last widget is `["Jev · standard · high"]`.
  - `Tally on the 10th prompt`: `tallyText` returns `"10 prompts · 2 workers · 1 fallbacks"`. The last widget is `["Jev · standard · 10 prompts · 2 workers · 1 fallbacks"]`, and `overlay()` returns that text.
  - `Eleventh prompt shows the level again`: after the 10th prompt, the next prompt (`tallyText` `undefined`, answer `medium`) leaves the last widget at `["Jev · standard · medium"]` and `overlay()` at `undefined`.
  - `Tally on a miss`: the 10th prompt's outcome is a `timeout` miss. The tally form is drawn.
  - `Tally on a held 10th prompt`: a held turn (listed provider with an anchor) draws the tally form.
  - `Tally on a discarded 10th prompt`: the level changes during the wait. The tally form is drawn. The 11th prompt, answered without `effort` on a non-reasoning model, redraws `["Jev · standard · high"]`.
  - `cancelled 10th prompt shows no tally`: the outcome is `cancelled`. No widget carries the tally text, and `tallyText` is not called.
  - `cancelled 11th prompt keeps the overlay`: after a 10th prompt with the overlay, the 11th is `cancelled`. `overlay()` still returns the tally text, and no widget is drawn without it.
  - `Esc before the request restores the overlay`: after a 9th prompt showing `high`, the 10th prompt sets the overlay, then `agentSettled({aborted:true})` with no provider request. The widget returns to `["Jev · standard · high"]` and `overlay()` is `undefined`.
  - `Effort off never shows the tally`: with `effort` off, `tallyText` is never called.
  - `session start clears overlay`: `sessionStart()`, then `overlay()` is `undefined`.
- [ ] **Step 2: Run** `bun test tests/host/main.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `createMain`:
  - **State:** add `let overlay: string | undefined`, and `previousOverlay` to the `undo` struct (captured with `previous`).
  - **One draw path:** `draw(rec, ctx, snapshot)` sets `undo.drew` when `undo.rec === rec` and calls `drawStatus(ctx, snapshot, current, overlay)`. `setDecision` sets `current` and then calls `draw`.
  - **After the ask:** in `decide`, right after the `cancelled` check and before `holdOutcome` and every other branch, compute `next` from `deps.tallyText?.()` inside its own try/catch. A throw keeps the old overlay, so the turn and its ledger line are unaffected. If `next !== overlay`, set `overlay = next` and mark a pending redraw.
  - **Redraw:** at the end of `decide`, use a `try … finally` around the branches after the ask. Keep a per-call `drawn` flag that `draw()` sets. In the `finally`, if a redraw is pending and `!drawn`, call `draw` once inside try/catch. This covers discarded results, answers without `effort`, and misses that do not touch the suffix.
  - **Cancel and throw:** a `cancelled` outcome or a throw before the ask leaves `overlay` untouched, so no clear happens without a redraw.
  - **Esc undo:** in `agentSettled`'s abort branch, restore `overlay = undo.previousOverlay` together with `current`, and redraw with both.
  - **Session start:** `sessionStart()` sets `overlay = undefined`.
  - **Accessor:** expose `overlay: () => overlay`.
- [ ] **Step 4: Run** `bun test tests/host/main.test.ts tests/host/main-effort.test.ts tests/host/effort-hold.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/host/main.ts tests/host/main.test.ts && git commit -m "feat(main): tally overlay on every 10th prompt"`

---

## Task 5: Wiring in setup — implements 3.1

**Files:**
- Modify: `src/host/setup.ts`
- Test: `tests/host/setup.test.ts`

**Interfaces:**
- Consumes: `createSessionLog` (Task 2), `logLine` and `compactTally` (Task 1), the `runJev` deps (Task 3), and `tallyText` and `overlay()` (Task 4).
- Produces: the `jev-log` renderer registration, and one `append` wrapper shared by main and worker routing.

- [ ] **Step 1: Extend `fakePi`** in `tests/host/setup.test.ts` with:
  - `registerEntryRenderer(type, r)`, capturing renderers by type.
  - `appendEntry(type, data)`, recording entries.
  - `getThinkingLevel` and `setThinkingLevel`.
  - An option to omit `registerEntryRenderer`.

  Existing tests must still pass with the extended fake.
- [ ] **Step 2: Write failing tests:**
  - `registers jev-log renderer`: the renderer is captured for `"jev-log"`. Given `{ data: <Main line text scenario line> }` and rendered at width 200, it gives the exact Main line text. At width 10 it gives one line of length 10.
  - `renderer swallows`: data `{kind:"other"}` gives `undefined`. Data with a throwing getter gives `undefined` and does not throw.
  - `older Pi without registerEntryRenderer`: `setup(pi)` does not throw, and `/jev` still works.
  - `tally counts with failed append`:
    1. Point `PI_CODING_AGENT_DIR` at a temp dir with a valid `jev/config.json` (classifier `url` at a `startJevFixture` `/ask` answering `effort` `high`) and an empty-directory `jev/ledger.jsonl`, so the append fails with `EISDIR`.
    2. Fire `session_start`, then `before_agent_start` (user prompt, ctx with `model`, `getBranch`, `cwd`, `hasUI`, `ui`), then `before_provider_request` and `agent_settled({aborted:false})`.
    3. Call the registered `jev` handler with `""`. The notify text contains `"  prompts 1"`.

    Follow the `/jev clears shown warnings` test for the fixture, ctx shape and config body (including `tiers: TIERS`). The event has `messageType: "user"` and a non-empty `prompt`, and the fake thinking level is stateful, starting at `"low"`.
  - `session_start resets the tally`: after the same flow, fire `session_start` with reason `new` and the same id, then `/jev`. The text contains `"  prompts 0"`. Repeat with reason `resume`.
- [ ] **Step 3: Run** `bun test tests/host/setup.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** in `setup()`:
  1. Before `registerWorkerRouting`, create `const log = createSessionLog(pi, { verbose: () => loadSnapshot(pi).settings.switches.verbose })`.
  2. Then `const append = (e: unknown) => { const r = appendLedger(jevDir(), e); log.record(e); return r; }`.
  3. Pass `{ append }` to `registerWorkerRouting`. Pass `append` and `tallyText: () => { const n = log.prompts() + 1; return n % 10 === 0 ? compactTally(log.tally(), n) : undefined; }` to `createMain`.
  4. In the main `session_start` handler, call `log.reset(ctx.sessionManager.getSessionId())`.
  5. Guard with `typeof pi.registerEntryRenderer === "function"` and try/catch, then register `"jev-log"`. The renderer returns `undefined`, or `{ render: (w) => [t.slice(0, Math.max(0, w))], invalidate() {} }` for `t = logLine(entry.data)`, inside try/catch.
  6. Pass `tally: log.tally` and `overlay: main.overlay` to `runJev`.
- [ ] **Step 5: Run** `bun test tests/host/setup.test.ts tests/host/worker-ledger.test.ts tests/host/worker-routing.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `git add src/host/setup.ts tests/host/setup.test.ts && git commit -m "feat(setup): wire session log and jev-log renderer"`

---

## Task 6: Host test, log never reaches a provider — implements 4.1

**Files:**
- Create: `tests/host/verbose-log.test.ts`

**Interfaces:**
- Consumes: `startHostSession`, `startFixture`, `startJevFixture` and `tempDir`. Follow `tests/host/effort-hold.test.ts`: `persist: true`, `self: true`, `env` `TYPESAFE_API_KEY`, and the `ownedDirs` cleanup.
- Produces: nothing.

- [ ] **Step 1: Write the test** `describe("verbose log through the real CLI")`. Each test uses fresh `tempDir`s for `agentDir` and `cwd`, pushed to `ownedDirs`.
  - `Hidden from the next request`:
    1. `mkdirSync(join(agentDir,"jev"),{recursive:true})`, then write `jev/state.json` as `{"version":1,"switches":{"verbose":true}}`.
    2. Start with `startHostSession({ agentDir, cwd, … })`. The harness keeps existing files and adds `config.json`.
    3. Run two prompts with the `turn` helper as in effort-hold.
    4. Collect the `custom` entries with `customType` `"jev-log"` from the session `.jsonl` files. Expect at least one whose `data` deep-equals the first `main` ledger line.
    5. Expect `JSON.stringify(fixture.requests[1].body)` to contain neither `"jev-log"` nor that line's `turnId`.
  - `Verbose off by default`: with no `state.json`, two prompts leave no `jev-log` entry.
  - `Jev down is logged`: with the same seed and Jev returning `{ status: 500 }`, one `jev-log` entry has `miss` `"error"`.
  - Timeout is 120000.
- [ ] **Step 2: Run** `bun test tests/host/verbose-log.test.ts`. Expected: PASS. If it fails, fix the implementation, not the assertions.
- [ ] **Step 3: Commit** `git add tests/host/verbose-log.test.ts && git commit -m "test(host): jev-log entries stay out of provider requests"`

---

## Task 7: Docs and full checks — implements 5.1, 5.2

**Files:**
- Modify: `docs/architecture.md` (Display surfaces rows Tally, Log and Verbose), `docs/usage-guide.md` (Switches, All commands, Troubleshooting), `docs/privacy.md` (What is stored locally), `docs/glossary.md`, `docs/roadmap.md` (Status table and WG-17)

- [ ] **Step 1: Edit the docs:**
  - **Tally row:** "Prompts, workers by model, tokens on workers, fallbacks. Counts only, no dollars. Tools flagged arrives with WG-14."
  - **Log row:** "Only while `verbose` is on. `pi.appendEntry("jev-log")` with `registerEntryRenderer`, not sent to the model."
  - **Usage guide:**
    - Replace `status (session tally: WG-17)` with `status and session tally`.
    - Add one paragraph on what `/jev verbose on` shows.
  - **Privacy:** add "With `verbose` on, the same labels and numbers as the ledger are also saved as `jev-log` entries in your Pi session files, which travel with session exports."
  - **Glossary:** add **Log line**.
  - **Roadmap:** set WG-17 to `Done`.
- [ ] **Step 2: Run** `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expected: all exit 0. Run `bun run fmt` if format differs, then re-run the checks.
- [ ] **Step 3: Commit** `git add docs && git commit -m "docs: tally and verbose log (WG-17)"`

---

## Scenario → test

**session-tally**
- Counted although the write failed → `tests/host/setup.test.ts` "tally counts with failed append"
- Invalid line ignored → `tests/host/tally.test.ts` "Invalid line ignored"
- Jev down → `tests/host/tally.test.ts` "Jev down" (main line with `miss` `error` counts 1), plus `tests/host/verbose-log.test.ts` "Jev down is logged"
- Mixed session → `tests/host/tally.test.ts` "Mixed session"
- Nothing could run is not a fallback → `tests/host/tally.test.ts` "Nothing could run is not a fallback"
- New session → `tests/host/setup.test.ts` "session_start resets the tally"
- Resume → `tests/host/setup.test.ts` "session_start resets the tally" (reason `resume`)
- Late worker line from a replaced session → `tests/host/tally.test.ts` "late line from replaced session"
- Child line ignored → `tests/host/tally.test.ts` "child line ignored"

**verbose-log**
- Verbose off by default → `tests/host/tally.test.ts` "Verbose off by default", `tests/host/verbose-log.test.ts` "Verbose off by default"
- Verbose on → `tests/host/tally.test.ts` "Verbose on", `tests/host/verbose-log.test.ts` "Hidden from the next request"
- Worker line logged → `tests/host/tally.test.ts` "Worker line logged"
- Correction logged → `tests/host/tally.test.ts` "Correction logged"
- Jev down is logged → `tests/host/verbose-log.test.ts` "Jev down is logged"
- Switched on mid-session → `tests/host/tally.test.ts` "switch read at record time"
- No entry in a child → `tests/host/tally.test.ts` "child line ignored"
- Throwing appendEntry → `tests/host/tally.test.ts` "Throwing appendEntry"
- Hidden from the next request → `tests/host/verbose-log.test.ts` "Hidden from the next request"
- Unknown data → `tests/host/status.test.ts` "logLine rejects invalid data", `tests/host/setup.test.ts` "renderer swallows"
- Narrow width → `tests/host/setup.test.ts` "registers jev-log renderer" (width 10)
- Main line text, Sparse main line, Main miss text → `tests/host/status.test.ts` `describe("logLine")`
- Worker untouched head, Worker fallback text, Worker miss text, Worker untouched text → `tests/host/status.test.ts` `describe("logLine")`
- Correction text → `tests/host/status.test.ts` `describe("logLine")`

**status-line** (the 19 baseline scenarios keep their current tests in `tests/host/status.test.ts`, `tests/host/main.test.ts`, `tests/host/jev-base.test.ts` and `tests/host/effort-hold.test.ts`)
- Tally on the 10th prompt → `tests/host/main.test.ts` "Tally on the 10th prompt"
- Ninth prompt shows the level → `tests/host/main.test.ts` "Ninth prompt shows the level"
- Eleventh prompt shows the level again → `tests/host/main.test.ts` "Eleventh prompt shows the level again"
- Tally kept across /jev → `tests/host/commands.test.ts` "Tally kept across /jev"
- Tally on a miss → `tests/host/main.test.ts` "Tally on a miss"
- Tally on a discarded 10th prompt → `tests/host/main.test.ts` "Tally on a discarded 10th prompt"
- Effort off never shows the tally → `tests/host/main.test.ts` "Effort off never shows the tally"
- Cancelled 11th prompt keeps the tally → `tests/host/main.test.ts` "cancelled 11th prompt keeps the overlay"

**jev-command** (the 6 baseline Status report scenarios keep their tests in `tests/host/commands.test.ts`)
- Empty tally → `tests/host/commands.test.ts` "Empty tally"
- Tally after work → `tests/host/commands.test.ts` "Tally after work"
