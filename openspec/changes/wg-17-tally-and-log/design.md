## Context

Two writers build ledger lines in the main session today:

- `createMain` in `src/host/main.ts`. When a run settles, `write()` calls `deps.append` for an optional `correction` line and then a `main` line, then calls `pi.appendEntry("jev-turn", …)`.
- `registerWorkerRouting` in `src/host/worker.ts`. Its `write()` builds one `worker` line per launch, once the executor outcome is joined, and calls `append` (`deps.append` or `appendLedger`).

`setup.ts` wires both, with `append: (e) => appendLedger(jevDir(), e)` for main. Worker routing uses its own default. `runJev` in `src/host/commands.ts` receives `load` and `decision` callbacks and calls `drawStatus`. `statusText` in `src/host/status.ts` builds the line from the snapshot and the latest `Decision`.

Constraints: only `host/` touches Pi; nothing adds a dependency (`@earendil-works/pi-tui` is not imported, a renderer returns a plain `{ render, invalidate }` component as `drawStatus` already does); fail open; no free text leaves the ledger's rules.

## Goals / Non-Goals

**Goals:**
- One session observer that both writers feed with the same line they give the ledger.
- Tally text and log-line text as pure functions in `host/status.ts`, unit-testable without Pi.
- A host test that proves a `jev-log` entry exists in the session file and is absent from the next provider request.

**Non-Goals:**
- `tools flagged` and tool assessment lines (WG-14).
- Persisting or rebuilding the tally.
- Changing the ledger schema, `state.json` or `config.json`.

## Decisions

### D1. Observer at the append seam, not at decision points

A new `src/host/tally.ts` exports `createSessionLog(pi)`, which returns:

- `record(line)`: update the counts and, while `verbose` is on, append the log entry.
- `reset(sessionId)`
- `tally()`
- `prompts()`

`setup.ts` passes `(e) => { const r = appendLedger(jevDir(), e); log.record(e); return r; }` to `createMain`, and the same wrapper to `registerWorkerRouting` through its existing `deps.append`.

Why: both writers already funnel every line through one callback, so there are no new branches in `main.ts` or `worker.ts`. The tally and the log see exactly what the ledger sees.

Alternative rejected: separate calls at each decision point, which would give a second set of facts.

The observer records a line whether or not the ledger write succeeded. The tally counts decisions made, not lines stored, and a failed write is already invisible to the turn. It never records a line that fails `validateLedgerEntry`, because such a line has no guaranteed shape: it is checked once, and an invalid line is ignored. This also keeps the log under the ledger's no-free-text rule.

### D2. What the tally counts

| Count | Source |
|---|---|
| prompts | `main` lines |
| workers by model | `worker` lines with `model`, grouped by `model`; lines without `model` are counted as `unrouted` |
| worker tokens | sum of `tokens` on `worker` lines |
| fallbacks | `worker` lines with both `tier` and `fallback`, where they differ |

The "nothing could run" case records `fallback` equal to `tier` (see the worker-ledger spec), so it is not a fallback that moved. It is reported as `unrouted`, since no model was written.

`correction` lines change no count. They are still logged.

The model map has one key per distinct model id. A session uses a handful of configured tiers and slots, so there is no cap.

### D3. Every 10th prompt

The tally form is a display overlay, not a `Decision`:

- `createMain` keeps `current` (the level suffix) as today and adds `overlay: string | undefined`.
- When an eligible prompt's Jev request completes (not cancelled), `decide` asks a new dependency `tallyText(): string | undefined`. It returns the compact form when `log.prompts() + 1` is a multiple of 10. The `main` line is written only at settle, so `+ 1` counts this prompt.
- If it returns text, `overlay` is set and the line is drawn as `statusText(s, current, overlay)`, whether or not this prompt's result set `current`.
- At the start of the next eligible prompt, `overlay` is cleared before deciding. If that prompt leaves `current` unchanged (discarded, or answered without `effort`), it redraws with `current`.
- `main.decision()` stays the same. A new `main.overlay()` lets `/jev` redraw the same text.
- `session_start` clears both.

Why: this matches the operator's "until the next prompt" exactly, and keeps the level suffix rules of the status-line spec untouched underneath.

The compact form is `<P> prompts · <W> workers · <F> fallbacks`, with `P` counting this prompt, for example `Jev · standard · 10 prompts · 3 workers · 1 fallbacks`. Each count is always shown, even at 0, and the plural is fixed. The model breakdown and tokens are left to `/jev`, because the line has to stay short.

Prompts with `effort` off return before any request, so they never show the overlay. An aborted 10th prompt (no `main` line) makes the next prompt the 10th again. This is accepted, since the cadence follows the count shown.

The off-by-one risk is covered by tests at prompts 9, 10 and 11.

### D4. Log entry and renderer

- Custom type `jev-log`.
- Data: the validated ledger line object, unchanged.
- `setup.ts` registers `pi.registerEntryRenderer("jev-log", …)` once. The renderer calls the pure `logLine(data)` from `status.ts` and returns a one-line component, cut to the width.
- `logLine` returns `undefined` for unknown data. The renderer then returns `undefined` and Pi draws nothing.

The exact line forms (main, worker, correction) are fixed in `specs/verbose-log/spec.md`. They start with `jev · `, followed by the subject (`main`, the agent name or `correction`) and the facts in a fixed order, with raw probabilities to two decimals.

Whether `verbose` is on is read from `loadSnapshot` when the line is recorded, so `/jev verbose on` applies from the next line.

Why the raw line as data: the schema already bounds it, and the renderer can change without a migration.

### D5. Main session only, reset on start

The observer is created per extension instance in `setup.ts`.

- The main `session_start` handler calls `log.reset(ctx.sessionManager.getSessionId())`, next to `main.sessionStart()`.
- `record` ignores any line whose `session` differs from that id. This covers a late worker line from a replaced session, and any line from a child.
- Before the first `session_start` the id is unset, and every line is ignored.
- A `reload` keeps the same session id, so a line that settles across the reload is still counted. This is accepted: it is the same session, and the line is real.

### D6. `/jev` report

`runJev` gains a `tally: () => Tally` dependency. `formatStatus` appends a `session:` line and two-space-indented lines from the pure `tallyLines(t)`:

- `prompts N`
- `workers N`, followed by ` (<model> <n>, …)` in first-seen order, with `unrouted <n>` for lines without a model
- `worker tokens N`
- `fallbacks N`

No dollars, and no line for tools.

## Risks / Trade-offs

- [The log could leak into the model's context if Pi changed how custom entries are treated] → the host test asserts this on every run, and the version policy reruns it on upgrades.
- [Worker log lines appear late (at completion), and an interrupted worker never gets one] → accepted in the brainstorm. The tally is a count of finished decisions.
- [The 10th-prompt form hides the level for one prompt] → by design (operator choice). The level is still in `/jev` and in the log.
- [`verbose` lines are kept in Pi session files and travel with `/share` or export] → they hold only ledger fields (labels and numbers). `docs/privacy.md` says so.
- [A renderer throw] → the renderer wraps `logLine` in try/catch and returns `undefined`.

## Migration Plan

None. No stored format changes. Older session files have no `jev-log` entries, and nothing reads them.

## Open Questions

None.
