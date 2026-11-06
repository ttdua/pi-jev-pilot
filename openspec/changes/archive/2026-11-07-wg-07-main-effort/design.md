## Context

WG-03 to WG-06 left everything a main decision needs except the decision itself: `askJev` (`src/jev/client.ts`) returns `ok`, `miss` or `cancelled` and never throws; `readAnswers` (`src/policy/answers.ts`) validates each question; `appendLedger` (`src/store/ledger.ts`) validates and appends one line and never throws; `loadSnapshot` (`src/host/readiness.ts`) gives settings, key and config validity per call; `isChild` (`src/host/child.ts`) tells a worker's session apart; `drawStatus` (`src/host/status.ts`) draws the base line. `src/host/setup.ts` wires `session_start`, `session_shutdown` and `/jev`.

Pi 1.5.0 facts this design rests on, read from the installed source (`agent-session.js`, `agent.js`, `agent-loop.js`):

- `_startRun` awaits every `before_agent_start` handler inside `_prepareRun`, then calls `agent.prompt`. The loop config, including `reasoning` from the current thinking level, is built when `agent.prompt` starts, so a level set inside `before_agent_start` reaches the first request (verified by WG-02 Q6).
- `ctx.signal` reads `agent.signal`, which exists only once a run is active. It is `undefined` throughout `before_agent_start`.
- Esc while handlers run sets `_agentRunAbortRequested`; Pi aborts the run on `agent_start`, before any provider request. `agent_settled` then fires with `aborted: true`.
- `pi.setThinkingLevel` clamps to the model's supported levels and appends a `thinking_level_change` entry only when the level changes. `pi.getThinkingLevel()` returns the effective level.
- `pi-coding-agent` does not re-export `clampThinkingLevel` or `getSupportedThinkingLevels` from `pi-ai`, and the package has no `pi-ai` dependency.
- The documented question wire format (docs.typesafe.ai, Choice and Noul): a choice has `type`, `instructions` and `criteria` as a map from option to description; a noul has `type`, `instructions` and optional `criteria` with `true` and `false`.

The brainstorm fixed the behaviour and the operator's five decisions. This document covers module layout, per-turn bookkeeping and the exact mechanics.

## Goals / Non-Goals

**Goals:**

- Pure, table-testable effort policy, question builder and state builder; one host module that owns the turn lifecycle.
- One `main` ledger line per decided turn, written once and never rewritten.
- Host tests that prove the Done-when conditions through the real CLI.

**Non-Goals:**

- Hold, skills, advice, worker routing, tally and log lines.
- Any change to the ledger schema, the client, answer reading or the stores.

## Decisions

### D1. Module layout

| File | Role | Imports Pi |
|---|---|---|
| `src/policy/effort.ts` | `decideEffort({ choice, risky, supported })` → `{ requested, target }` (the host owns the current level: same-level and `max` rules live in `host/main.ts`); `supportedLevels({ reasoning, thinkingLevelMap })`; `EFFORT_LEVELS`, `RISK_FLOOR = 0.7`, `EFFORT_CEILING = "xhigh"`, `CORRECTION_THRESHOLD = 0.7` | No |
| `src/jev/questions.ts` | `mainQuestions({ askEffort })` → wire questions plus the matching `QuestionSpec` map for `readAnswers`; wording from `docs/jev-questions.md` as data | No |
| `src/jev/state.ts` | `mainState({ prompt, branch, platforms })` → the minimal main state; `requestSignals(prompt)`; `recentMessages(...)`; `recentTools(...)` | No |
| `src/host/context.ts` | Turns `ctx.sessionManager.getBranch()` into plain `{ role, text, tools }` items; scans `ctx.cwd` for platform markers; finds the previous turn id on the branch | Types only |
| `src/host/main.ts` | `before_agent_start`, `before_provider_request`, `turn_end`, `agent_settled` handlers; the per-turn record; ledger and status calls | Yes |
| `src/host/status.ts` | `statusText(snapshot, decision?)` gains an optional suffix | Types only |
| `src/host/setup.ts` | Registers the `main.ts` handlers | Yes |

`jev/` receives plain inputs only, so `scripts/replay` (WG-16) can reuse `questions.ts` and `state.ts`. `policy/effort.ts` is shared later by WG-08 and WG-11 (worker effort adds the `fast` cap there).

### D2. Supported levels without `pi-ai`

`supportedLevels` re-implements Pi's documented rule (`docs/models-configuration.md`, `thinkingLevelMap`): a non-reasoning model supports only `off`; otherwise every level whose map value is not `null`, where `xhigh` and `max` also need a defined map value. `decideEffort` clamps with Pi's own order: the requested level if supported, else the nearest supported level above, else the nearest below. After `pi.setThinkingLevel(target)` the host reads `pi.getThinkingLevel()` and records that as `effective`, so the ledger is truthful even if the rule drifts from Pi's. A unit test pins the rule against a table taken from Pi 1.5.0's source.

Alternative considered: add `@earendil-works/pi-ai` as a peer and import `clampThinkingLevel`. Rejected: it adds a dependency (operator approval needed) for one small function, and Pi still clamps on its own.

### D3. Eligibility and the request

`before_agent_start` proceeds only when all hold: `event.messageType === "user"`; `event.prompt.trim()` is not empty; the session is not a child; the snapshot has a valid config and the key set; `switches.effort` is on; `ctx.model` is defined. Otherwise it returns at once with no request, no line and no status change.

`askEffort` is true when the model supports at least two levels from `low` upward. When false, only `corrects` is asked. The request carries `effort` (choice over the five levels, main instruction and criteria), `risky` (noul with `true`/`false` criteria) and `corrects` (noul with criteria), in that key order. The API key is read from `process.env` at call time and passed to `askJev`; `signal` is `ctx.signal` (always `undefined` today, kept so a future Pi signal works without change).

### D4. Applying, discarding and the per-turn record

The handler keeps one record per main session instance, replaced at every eligible prompt:

```text
{ turnId, at, from, applied?, requested?, effective?, answered, ms, miss?,
  effortP?, risky?, corrects?, sawRequest, toolCalls, failures,
  inputTokens, outputTokens, decided }
```

1. Read `from = pi.getThinkingLevel()` before calling Jev.
2. After `askJev` returns: if the outcome is `cancelled`, drop the record (no line). If `miss`, keep `answered: false` and `miss`.
3. On `ok`, read the answers. If `effort` was answered, compute `{ requested, target }`.
4. **Discard check:** if `pi.getThinkingLevel() !== from`, the operator changed the level meanwhile. Nothing is applied; `requested` and `effortP` stay, `effective` stays unset.
5. **Max kept:** if `from === "max"`, nothing is applied; `effective = "max"`.
6. Otherwise call `pi.setThinkingLevel(target)` when `target !== from`, then `effective = pi.getThinkingLevel()` and `applied = effective`.

The discard check compares levels rather than listening to `thinking_level_select`, because the package's own `setThinkingLevel` also emits that event and a listener would have to filter it out. A change made and undone during the wait is not detected; the result then applies, which is harmless.

### D5. Esc restore

`before_provider_request` sets `sawRequest = true` on the current record. On `agent_settled` with `aborted: true` and `sawRequest === false`: if `applied` is set and `pi.getThinkingLevel() === applied`, call `pi.setThinkingLevel(from)`. The record is then dropped: no ledger line, no status change, no turn entry. If the operator changed the level after the apply, the guard leaves it alone.

This writes a second `thinking_level_change` entry to the session when it restores. Alternatives (accept the gap, wait for Pi) are in the brainstorm. The drafted upstream issue lives at `openspec/changes/wg-07-main-effort/upstream-issue.md` and is posted only with the operator's go-ahead.

### D6. Turn outcome and the ledger line

- `turn_end`: add `toolResults.length` to `toolCalls` and the count with `isError` to `failures`; add the assistant message's `usage.input` and `usage.output` to the token counts when present.
- `agent_settled`: if the record is dropped or the run settled aborted before any provider request (D5), write nothing. A run that settles not aborted without a provider request (for example a provider error before sending) still gets its line, with `outcome: error`. Otherwise compute `outcome`: `aborted` when `event.aborted`, else `error` when the last assistant message on the branch has `stopReason: "error"`, else `ok`. `durationMs = now - at`. Append one `main` line with the fields of the record that are set, `mode` from the snapshot taken at the prompt, and `session` from `ctx.sessionManager.getSessionId()`.

Writing the whole line at the end keeps "lines are never rewritten" without a second line kind. A process killed mid-turn loses that turn's line, which is acceptable for a local log.

A `main` line is written only when a request was made. Ineligible prompts write nothing, matching the lifecycle's `Skipped` state.

### D7. Turn ids and correction lines

`turnId` is `crypto.randomUUID()` (36 characters, matches the ledger `ID` pattern). After the `main` line is written, `pi.appendEntry("jev-turn", { turnId })` records it on the current branch. At the next eligible prompt, `host/context.ts` walks `getBranch()` from the leaf back and takes the newest `custom` entry with `customType: "jev-turn"` and a valid `turnId`. The id found is kept on the record. When `corrects ≥ .7` and such an entry exists, a `correction` line `{ turnId: <previous>, corrects }` is appended at `agent_settled`, just before the `main` line, so a turn cancelled before any provider request writes neither. `corrects` is also stored on the current turn's `main` line.

Custom entries are not sent to the model and survive resume; `/tree` moves the leaf, so the lookup follows the branch. Alternative considered: keep the last id in memory. Rejected by the operator: it breaks on resume and `/tree`.

### D8. Minimal main state

`jev/state.ts` builds, from plain inputs:

- `request.text`: the prompt as typed. `prompt_chars`, `files_mentioned`, `has_code_or_error`, `is_question` follow `docs/jev-contract.md` exactly.
- `conversation.recent`: from the branch's message entries before the current prompt, user and assistant text only (no thinking, images, tool arguments or results), at most 4 messages and 2000 characters, newest assistant about 55% of the budget keeping start and end (72% from the end), the others at least 200 characters each, oldest dropped first. Custom messages are excluded, so nothing this package or others inject is sent back. Each item carries `tools: [{ name, failed? }]` from the assistant's tool calls joined with their results.
- `conversation.recent_tools`: counts over the last 10 message entries per the contract table.
- `conversation.turn_index`: the number of user messages on the branch before the current prompt.
- `workspace.platforms`: from the marker table, at `ctx.cwd` and one level down, skipping symlinks and the listed directories; names only, never contents; `["none found"]` when empty. Scanned per prompt with `readdirSync`; at most two directory levels keeps it within a few milliseconds.

Off until WG-16 and therefore absent: `last_decision`, `context_used_percent`, `workspace.git`, `workspace.languages`, `capabilities`.

### D9. Status line suffix

`statusText(snapshot, decision?)` appends ` · <effective>` after a decision that set or kept a level, and ` · no answer` after any miss or an asked-but-unanswered `effort`. A discarded result, an answered request that did not ask `effort`, and a cancelled run leave the suffix as it was. The suffix applies only when the base text is the mode and `effort` is on, so `/jev effort off` drops it at the next redraw. The last decision is kept in the `main.ts` instance and used by every redraw, including after `/jev`; a `session_start` clears it. Drawing still requires `ctx.hasUI` and the `status` switch.

### D10. Errors stay inside the package

Each handler wraps its body in one `try`/`catch`. A failure before the apply leaves the level unchanged; a failure after it leaves the applied level and skips the line. Nothing is written to stdout or stderr. `appendLedger` and `appendEntry` failures are swallowed (verbose logging is WG-17).

### D11. Host tests

Through the real CLI in RPC mode with an isolated agent directory, a loopback Jev fixture (`tests/jev/fixture.ts`) and the recording provider fixture (`tests/host/fixture.ts`), whose `fixture-main` model is reasoning with `reasoning_effort` support and gains a `thinkingLevelMap` defining `xhigh` and `max`:

- Jev answers `effort: xhigh`: the first provider request carries `reasoning_effort` `xhigh`.
- `risky: .8` with `effort: low`: first request at `high`.
- Jev returns 500 and, separately, times out: provider requests equal a run without the package; `Jev · no answer`; one line with `answered: false`.
- Esc: the Jev fixture delays its answer; the test sends RPC `abort` during the delay (RPC handles `abort` and `set_thinking_level` while a prompt's handlers run, since `prompt` is dispatched without awaiting — `rpc-mode.js`); no provider request is recorded, the level after settle equals the level before, and no ledger line exists.
- Discard: the Jev fixture delays; the test sets the thinking level through RPC during the delay; the first request carries the operator's level and the line has no `effective`.
- Correction: two prompts, the second answered `corrects: .9`; a `correction` line names the first turn's `turnId`.
- Privacy: a `JEV-MARKER-` string in the prompt appears in no ledger line and no session custom entry.

## Risks / Trade-offs

- [`supportedLevels` drifts from Pi's rule in a later version] → `effective` is read back from Pi, and the version policy reruns host tests on a Pi upgrade.
- [Esc wait up to `timeoutMs`] → accepted by the operator; the upstream issue asks for a signal, and `ctx.signal` is already passed through.
- [The restore writes an extra session entry] → visible only in the session file; the alternative leaves a wrong level.
- [`appendEntry` at `agent_settled` adds an entry after the turn] → custom entries are outside the model's context; one entry per decided turn.
- [A level changed and changed back during the wait is not seen as a manual change] → harmless: the result then applies to the level the operator restored.
- [The RPC `abort` in the Esc test arrives after handlers finish] → the Jev fixture holds its answer until the test has sent `abort`, so the order is controlled.

## Migration Plan

Nothing to migrate: no release exists, file formats are unchanged. Rollback is reverting the change; ledger lines already written stay valid.

## Open Questions

None.
