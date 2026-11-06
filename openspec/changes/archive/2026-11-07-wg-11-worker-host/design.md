## Context

`wg-11-worker-policy` left these pure building blocks, which nothing calls yet:

| Module | Provides |
|---|---|
| `src/host/agents.ts` | `readAgent` |
| `src/policy/launch.ts` | `effectiveLaunch`, `isFieldLocked` |
| `src/jev/state.ts` | `buildWorkerState` |
| `src/jev/questions.ts` | `offeredTiers`, `buildWorkerQuestions` |
| `src/policy/worker.ts` | `readWorkerOutcome` |
| `src/policy/tier.ts` | `decideTier`, `chooseFallback` |
| `src/policy/effort.ts` | `workerEffort` |

Existing modules this change builds on:

- `src/jev/client.ts` `askJev` never throws and honours a timeout and an abort signal.
- `src/host/readiness.ts` `loadSnapshot` reads config, state, key presence and executor presence fresh on each call.
- `src/store/ledger.ts` `appendLedger` validates against `ledger-schema.ts` and never throws.
- `src/host/child.ts` knows child sessions.

Host seams, verified in WG-02:

- `message_end` completes before `tool_call` preflight (Q2).
- Mutating `tool_call` `event.input.model` and `event.input.thinking` reaches the child, foreground and background (Q1). With `locked: model`, the agent's model wins and thinking still applies.
- Forked launches accept both mutations (Q7).

Executor facts, from `@gotgenes/pi-subagents` 25.0.5:

- `subagents:completed` and `subagents:failed` carry `{ id, status, toolUses, durationMs, tokens?: { total } }`.
- A resumed run ends on `subagents:resumed` instead.
- Status values are `completed`, `aborted`, `stopped`, `error`, the same set as the ledger's.
- The tool result's `details.agentId` is set for foreground and background launches.
- The child applies thinking with `setThinkingLevel`, which clamps to the model.

Pi 1.5.0 facts:

- `ctx.modelRegistry` offers `find(provider, id)` and `hasConfiguredAuth(model)`.
- Nested calls carry `parentToolCallId`, and their ids are `<parent>/<n>`.
- Pi does not export `clampThinkingLevel` or `getSupportedThinkingLevels`. They live in `@earendil-works/pi-ai`, which is not a dependency of this package.

## Goals / Non-Goals

**Goals:**
- Every `subagent` launch in a main session is classified once and routed by one pure function.
- Forked, resumed and locked launches follow the operator's decisions.
- An unusable tier cascades down with a warning. Every failure leaves the launch unchanged.
- At most one ledger line per classified or untouched launch, carrying the executor's outcome.

**Non-Goals:**
- Slots, `slot::` options and slot fallback (WG-13).
- Modes other than `standard`, `/jev mode`, Fable rules for `budget` and `premium` (WG-12).
- Tool assessment in children (WG-14).
- Tally, log lines and verbose output (WG-17).
- Retrying a failed child.
- Changing the ledger format.

## Decisions

### 1. Pure launch route in `src/policy/route.ts`

`routeLaunch` combines the change 1 functions for one launch.

**Input (plain values):**
- the worker answers;
- the offered tiers;
- the usable tiers (which offered tiers pass the registry check);
- the effective launch;
- `forkedLaunch`;
- the supported thinking levels of each usable tier's model.

**Output, one of:**
- `untouched`: nothing is written;
- `skip`: cancelled, nothing is written or recorded;
- `routed`: what to write and what to record:
  - `model?` and `thinking?` to write;
  - `tier?`, `reason`, `fallback?`, `effort?`, `locked`.

Order inside `routeLaunch`:

1. Untouched, decided before Jev is asked, through an exported `launchKind` that the host also calls at `message_end`:
   - resume;
   - forked with `forkedLaunch: untouched`;
   - both model and thinking locked;
   - `thinking` locked and the launch is forked with `thinking` or has no tier offered.

   An untouched result still carries `locked` for the ledger.
2. Cancelled → `skip`.
3. Miss → `routed` with reason `miss`, nothing written.
4. Thinking-only:
   - Applies to a forked launch with `thinking`, no tier offered, no tier decided, or a model-locked agent.
   - Effort is `workerEffort` without a tier, so no `fast` cap.
   - It is written unclamped, because the model that runs is unknown here; the child's `setThinkingLevel` clamps it.
   - The reason is `untouched`, except for a model-locked agent with a decided tier, which records that tier and its reason.
5. Otherwise:
   - `decideTier`, then `chooseFallback` over the usable tiers, then `workerEffort` with `movedByFallback`, then clamp to the final tier's supported levels.
   - A thinking lock suppresses the thinking write and the recorded effort.
   - When nothing can run, the decided tier and reason are recorded with `fallback` equal to that tier, and nothing is written. This keeps the ledger rule that a deciding reason carries `tier`.

Why one function: every branch above gets a table test without Pi, and the host has nothing left to decide (operator choice A).

### 2. Thinking clamp as a pure copy

`supportedLevels(model)` and `clampLevel(model, level)` live in `src/policy/effort.ts`. `model` is `{ reasoning, thinkingLevelMap }`, the call shape of pi-ai's functions. They mirror the pi-ai 1.5.0 algorithm:

- exact match;
- else the next higher supported level;
- else the next lower;
- else the first supported level.

A parity test imports pi-ai's functions in `tests/` and compares results over every level and a set of model shapes. It fails if Pi changes the rule.

Alternative rejected: depending on `@earendil-works/pi-ai` directly. That adds a dependency (a working-agreement stop) and a version coupling for six lines.

### 3. Ledger `reason` for kept models

The ledger enum is fixed, and changing it is a format change. A line where the model was left as the caller asked uses `reason: untouched`, whether or not thinking was written. This covers:

- resumed launches;
- forked launches with `untouched` or `thinking`;
- both fields locked;
- no tier offered;
- no tier decided.

`effort` shows whether thinking changed. The domain model's ledger table is updated to say `reason` describes the model decision. This keeps the schema as it is.

### 4. Model lock

When `model` is locked:

- Jev is still asked the full questions.
- The decision, `tier` and `reason` are recorded with `locked: true`.
- `model` is neither written nor recorded.
- Thinking is written unless it is locked too.

This keeps the tier distribution measurable even for locked agents.

### 5. Host adapter `src/host/worker.ts`

**Gate, read fresh via `loadSnapshot` on each `message_end` and on each launch classified at its own `tool_call`.** Nothing happens in a child session, or when any of these holds:
- the config is invalid;
- the key is unset;
- the executor is absent;
- the `subagents` switch is off.

**At `message_end`** (assistant message with `subagent` tool calls):

1. For each call, read the agent with `readAgent(subagent_type, { cwd: ctx.cwd, agentDir })` and compute `effectiveLaunch`.
2. If `launchKind` says untouched, cache that and ask nothing.
3. Otherwise build the state and questions:
   - thinking-only launches get `effort` and `risky` only;
   - tier display names come from `ctx.modelRegistry.find(...).name`;
   - `parent_request` is included when `state.parentRequest` is on, taken from the latest user message on the branch.
4. Call `askJev` for all launches concurrently with `ctx.signal` and await them all.
5. Cache each outcome by `toolCallId`, together with the facts needed later.

**At `tool_call` for `subagent`:**

1. Take the cached entry. With none, classify this one launch now: the nested `parentToolCallId` case, or a `message_end` that saw no call.
2. When the route can write a model (the request asked `tier` and `model` is not locked), check each offered tier: split `provider/id` at the first `/`, then `find`, then `hasConfiguredAuth`. Other launches are not checked and never warn.
3. Call `routeLaunch`.
4. Show warnings, mutate `event.input`, and keep a ledger draft by `toolCallId`.

**At `tool_result` for `subagent`:**

- Move the draft to a map keyed by `details.agentId`.
- With no `agentId` (refused launch), write the line now with `status: error`.

**On `subagents:completed`, `subagents:failed` and `subagents:resumed`** (on `pi.events`):

- Look up the draft by `id`, fill `status`, `durationMs`, `tokens.total` and `toolUses`, and append.
- Events can arrive before the tool result (foreground runs finish first). Outcomes are therefore buffered by id too, and whichever side arrives second writes. A buffered outcome keeps only `status`, `durationMs`, `toolUses` and `tokens.total`, and is joined only if it arrived after that launch's `tool_call` (order counter); a `tool_result` with a skipped or missing route drops any buffered outcome for its agent id.

**Lifetime:**

- Both maps are bounded (256 entries, oldest dropped) and cleared on `session_shutdown`.
- Event handlers are removed on `session_shutdown`, as `child.ts` does.

Alternative rejected: re-classifying at every `tool_call`. It would cost one sequential Jev wait per launch instead of one concurrent batch, against the performance budget.

### 6. Warnings

- **Channel:** `ctx.ui.notify(text, "warning")`, which does nothing without a UI.
- **Dedupe:** once per `tier` and model string per session (one extension instance serves one main session). A config edit that changes the model therefore warns again. `/jev` clears the shown set.
- **Scope:** only the decided tier warns. A lower tier skipped during the cascade does not.
- **Text when moved:**

  ```text
  Jev: tier deep (provider/id) cannot run (not in the model registry | no credentials); using balanced. Fix tiers.deep in <path>/config.json.
  ```

- **Text when nothing can run:** the same message with `; launch left unchanged.`

### 7. Setting `subagents.forkedLaunch`

- **Config:** a new `subagents` section in `config.json`, validated by `oneOf(["untouched", "thinking"])`.
- **Default:** `untouched`, set in `defaults.ts`.
- **Settings:** resolved as `settings.subagents.forkedLaunch`.
- **Name:** the operator chose it during explore. It describes the launch state rather than the executor's parameter.

### 8. Ledger line fields

| Field | Source |
|---|---|
| `briefChars` | code points of `input.prompt` |
| `agent` | the resolved agent name |
| `tierP` | `tier` probabilities |
| `effortP` | `effort` probabilities |
| `risky`, `expertNeeded` | raw values |
| `callerModel` | the input `model` before mutation, when present and fitting the field rule; otherwise omitted |
| `locked` | `true` when model or thinking is locked; omitted otherwise |
| `mode` | effective mode |
| `answered`, `ms`, `miss` | from the request; `answered` false and no `ms` or `miss` when nothing was asked |
| `fallback` | the tier that could not run |
| `model` | the written model |
| `effort` | the written thinking level |

A line that fails validation (for example an agent name outside the ledger's pattern) is dropped by `appendLedger`. The launch is unaffected.

## Risks / Trade-offs

- **[Process exits before a worker finishes]** That launch's line is lost. Accepted in brainstorm; a two-line format would need approval.
- **[pi-ai changes its clamp rule]** The parity test fails on upgrade.
- **[An agent name or caller model outside the ledger patterns]** The field is omitted, or the line is dropped. A unit test pins which.
- **[Thinking-only launches send an unclamped level]** Pi clamps in the child. The ledger records the requested level, which may be higher than the one applied.
- **[Resume tool result]** Executor 25.0.5 `resumeExisting` returns `buildDetails`, which carries `agentId`. `resumeInBackground` uses `renderBackgroundLaunch`, which also carries it. A refused resume returns text with no details; it is written as `status: error`.
- **[Cache entries for calls that never run]** Example: a blocked tool call. The bounded maps and `session_shutdown` clear them.
- **[Host behaviour differs between print/JSON and RPC]** Host tests run RPC. Warnings are UI-only by design.

## Migration Plan

- No stored file changes.
- `config.json` gains one optional key. Older files stay valid.
- Rollback: turn routing off with `/jev subagents off`, or uninstall. Nothing persists outside the ledger.

## Open Questions

None.
