## Design Summary

WG-17 (issue #18, roadmap G4 and G7) gives the operator two ways to see what Jev did in a session without opening `ledger.jsonl`:

- **Session tally.** Counts for the current main session: prompts, workers by model, tokens on workers, and fallbacks. Counts only, no dollars. It appears at the end of `/jev` output. On every 10th main prompt it also takes the place of the level suffix on the status line until the next prompt.
- **Log lines.** One short line per decision in the session transcript, shown only while `verbose` is on. They carry raw probabilities and why something was skipped or missed. They are drawn by an entry renderer and never sent to the model.

Who it serves: the operator who wants to trust or debug routing and effort without reading JSON. It also fixes a gap: the usage guide already tells people to "use `/jev verbose on`", but that switch currently does nothing.

Success: the tally matches the ledger lines written in the same session, the switch `verbose` produces visible lines, and a host test shows that no log line reaches a provider request (the roadmap's "Done when").

Goals:
- A tally in `/jev` and on the status line every 10th main prompt.
- Log lines while `verbose` is on, for main turns and worker launches.
- Proof that log lines stay out of provider requests.

Non-goals:
- `tools flagged` in the tally. It waits for WG-14, which adds the count.
- Tool assessment log lines. These come with WG-14.
- A tally that survives a reload, a resume or a new session.
- `/jev report` (G2, out of scope).

Anti-goals (failure even if it works):
- Any log content in the model's context or in a provider request.
- Prompt text, brief text, tool arguments or tool output in a log line or the tally.
- A new switch, command, config key or `state.json` field.
- A tally or log failure that changes a decision, a launch or a turn.

## Alternatives Considered

### Alternative A: Tap the ledger lines
- **Approach**: Every ledger line the package builds (main, worker, correction) also goes to a session observer. The observer updates the tally and, while `verbose` is on, appends a log entry from the same line.
- **Pros**: One source of facts, so the tally, the log and the ledger cannot disagree. The ledger schema already keeps free text out, so the log inherits the privacy rule. Little new code in `main.ts` and `worker.ts`.
- **Cons**: A log line appears when its ledger line is written: at the end of a main turn, and when a worker finishes rather than when it launches. Cases that write no ledger line (a launch skipped before routing, a cancelled classification) produce no log line.
- **Why not chosen**: Chosen.

### Alternative B: Separate hooks at each decision point
- **Approach**: `main.ts` and `worker.ts` each call the tally and the log at the moment a decision is made, with their own data.
- **Pros**: A worker log line appears at launch time. Unwritten cases could still be logged.
- **Cons**: A second set of facts parallel to the ledger, which can drift from it. Each new field needs its own privacy review. More branches in two modules that are already large.
- **Why not chosen**: Its only gain is timing, and it costs a second source of truth.

### Alternative C: Rebuild the tally from `ledger.jsonl`
- **Approach**: `/jev` reads the ledger and counts lines whose `session` matches the current session id.
- **Pros**: Counts survive a reload of the extension.
- **Cons**: File reads on every `/jev` and every 10th prompt, and a dependency on rotation and on ledger write success. Log lines would still need A or B.
- **Why not chosen**: The operator chose an in-memory tally that resets at every session start.

## Agreed Approach

Alternative A. Tapping the ledger lines keeps one source of facts and reuses the ledger's privacy schema. The tally lives in memory for the main session and resets on `session_start`. The log is gated by the existing `verbose` switch, so no public surface changes. Showing a worker's line at completion instead of at launch is an accepted cost: that is also when its tokens and status are known.

## Key Decisions

- **`verbose` is the log switch** (operator): off means no log lines, on means log lines with raw probabilities and skip or miss reasons. No new switch, config key or `state.json` field.
- **The tally is in memory only** (operator): it resets at every `session_start`, whatever the reason, and is never rebuilt from files.
- **Every 10th main prompt** (operator): the compact tally replaces the level suffix on the status line for that prompt only. The next prompt shows the normal suffix again.
- **`tools flagged` is left out** (operator) until WG-14 adds it.
- **Main session only** (my call, from the runtime contexts table): child sessions keep no tally and append no log entries.
- **Log lines come from ledger lines** (my call, Alternative A): same fields, same privacy rule. A worker line appears when the worker finishes.
- **Errors still show as they do today** (my call): warnings and `/jev` errors are not moved into the log.

## Open Questions

- None that block. The exact wording of the tally and log lines, and what counts as a "prompt", are settled in `design.md` and the specs.
