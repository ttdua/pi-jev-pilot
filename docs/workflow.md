# Workflows

What happens at each moment, step by step. For the rules applied, see the [domain model](domain-model.md). For the exact requests, see the [Jev contract](jev-contract.md).

## 1. A main prompt

```mermaid
sequenceDiagram
    actor O as Operator
    participant P as Pi
    participant X as pi-jev-pilot
    participant J as Jev
    participant M as Main model

    O->>P: prompt
    P->>X: before_agent_start
    X->>X: eligible? which features apply?
    alt nothing to ask
        X-->>P: nothing
    else
        X->>J: state + questions (timeout 1500 ms)
        alt answered
            J-->>X: answers
            X->>X: policy: effort, skill, advice, correction
            X->>P: setThinkingLevel
            X-->>P: message (display: false)
        else timeout or error
            X->>X: record miss
            X-->>P: nothing
        end
    end
    P->>M: request
    M-->>P: response and tool calls
    P->>X: turn end: outcome
    X->>X: ledger line, status line
```

**Skipped when** the run was started by a custom message, the prompt is empty, the session is a child, or every applicable feature is off. Skills apply only with a catalog and no explicit `/skill:name`.

**While held** (provider in `effort.holdProviders`, and the newest decision after the latest compaction was made on the same provider and model), `effort` and `risky` are not asked. Only `corrects` is asked. The thinking level is never touched, and the status line shows the level in force, also when Jev misses.

**If the operator changes the thinking level while waiting**, that result is discarded. The next prompt decides again. With a catalog over 254 skills the effort level is applied only once every batch has answered (still within one timeout), so a manual level change during that wait also discards the effort result.

**If the operator presses Esc before the first provider request**, Pi aborts the run. When the run settles aborted with no provider request, the package puts back the level it replaced, only if the current level is still the one it set, and the status line returns to its previous text. No ledger line is written. Esc after a provider request started is a normal turn with `outcome: aborted`.

**Ledger and status:** one `main` line per decided turn, written when the turn settles, and a `correction` line for the previous turn when `corrects` is at least .7. A `jev-turn` entry holding the turn id is added to the session so the next correction finds it. When the turn produced an effective level without being held and without a compaction, the entry also carries `decided` (provider, model, level); that is the anchor of the hold. The status line shows the decided level (`Jev · standard · high`) or `Jev · no answer`.

**Effect on the session:**

- A `thinking_level_change` entry when the level changes, and the footer shows the new level.
- A hidden custom message when a skill or advice applies. It stays in history until compaction.
- A skill picked again while its body is still in context is sent as a one-line reference.
- About 0.5 s of waiting per prompt.

## 2. A worker launch

```mermaid
sequenceDiagram
    participant M as Main model
    participant P as Pi
    participant X as pi-jev-pilot
    participant J as Jev
    participant E as Executor

    M-->>P: assistant message with subagent calls
    P->>X: message_end
    X->>J: one request per launch, concurrently
    J-->>X: answers
    X->>X: cache by toolCallId
    loop each subagent call
        P->>X: tool_call
        alt resume, forked with untouched, both locked, or switched off
            X-->>P: leave input unchanged
        else forked with thinking
            X->>X: policy: thinking only
            X->>P: mutate input.thinking
        else
            X->>X: policy: model, then effort
            X->>X: check registry and credentials
            X->>P: mutate input.model, input.thinking
        end
    end
    P->>E: execute subagent
    E-->>X: subagents:completed, failed or resumed
    X->>X: ledger: status, tokens, tool uses
```

Classification of sibling launches happens at `message_end`, which finishes before `tool_call` preflight (verified, [Q2](evidence/2026-11-05-host-seams.md#q2)). Launches issued by another tool (nested, with `parentToolCallId`) have no `message_end` batch, so they are classified at `tool_call`. The outcome is read from `subagents:completed`, `subagents:failed` or `subagents:resumed`.

**Model selection example** with the default `standard` mode:

| Brief reads as | Jev answers | Result |
|---|---|---|
| Fix three named wording issues, check named | `fast` .86 | Haiku, effort capped at `medium` |
| Same, but less certain | `fast` .52 | Sonnet |
| Implement a feature to a written spec | `balanced` .95 | Sonnet |
| Task spanning many crates | `deep` .66 | Opus |
| Review a pull request | `slot::reviewer` .92 | The `reviewer` slot's model |
| Anything that would deploy or delete data | `risky` .9 | Opus, effort at least `high` |

**Effect on the session:** worker model and effort differ from what the main model asked for, and the ledger records `callerModel`. The executor's widget shows the actual model.

## 3. A worker starts

```mermaid
sequenceDiagram
    participant E as Executor
    participant X as pi-jev-pilot (parent)
    participant C as pi-jev-pilot (child)
    participant J as Jev

    E->>X: subagents:child:session-created
    X->>X: add session id to registry
    E->>C: bindExtensions, session_start
    E->>C: before_agent_start
    C->>C: is a child: only tool assessment runs
    alt agent declares tools, or feature off
        C-->>E: nothing
    else
        C->>J: task + agent + tools (one noul per tool)
        J-->>C: scores
        alt observe mode
            C->>C: record would-remove count
        else enforce mode
            C-->>E: selectedTools without flagged tools
        end
    end
```

Default is `observe`, so workers keep all their tools until the operator switches to `enforce`.

## 4. A mode change

1. `/jev mode budget`.
2. `state.json` is updated. No Jev call.
3. The next launch uses the `budget` rubric and expert gate. Running workers are unaffected.
4. Each ledger line records its mode, so tuning signals are never mixed across modes.

## 5. Auto-tuning

```mermaid
flowchart TD
    A["agent_settled"] --> B{"Tuning on, and<br/>cooldown passed?"}
    B -- no --> Z["Stop"]
    B -- yes --> C["Read ledger since last change"]
    C --> D{"A pending change<br/>to evaluate?"}
    D -- yes --> E{"Worse than the<br/>40 before it?"}
    E -- yes --> F["Revert, show a line"]
    E -- no --> G["Mark kept"]
    D -- no --> H{"A rule fires?"}
    G --> H
    H -- no --> Z
    H -- yes --> I{"Parameter allowlisted<br/>for automatic change?"}
    I -- no --> J["Keep as a signal for /jev tune"]
    I -- yes --> K["Apply one step, show a line"]
```

Phase 1 allowlists `timeoutMs` only. Everything else stays visible through `/jev tune`. See [ADR 0005](decisions/0005-bounded-auto-tuning.md).

## 6. A CLI review

Only when the operator asks, such as "have Codex review this".

1. The model calls `jev_review` with `brief`, and optionally `reviewer`, `model`, `effort`. The tool description tells it to call only when the user asks. Fields set in the call win over the `/jev cli-review` default for that call only. Naming another reviewer drops the default's model and effort. A new `model` drops the default's effort.
2. The extension runs the CLI through `pi.exec`, with no relaying agent. The prompt is the [review instructions](jev-questions.md#cli-review-instructions) followed by the brief, passed as one argument (no stdin):
   - Codex: `codex exec [-m <model>] [-c model_reasoning_effort="<effort>"] -s read-only --skip-git-repo-check --ephemeral -C <cwd> -o <temp file> <prompt>`. The result is read from the temp file, or from stdout when the file is empty. The file is removed after each run.
   - OpenCode: `opencode run [-m <provider/model>[#<effort>]] --agent plan <prompt>`, run in the session's directory. The result is read from stdout.
3. The tool returns findings and a verdict. On failure, the result says the review did not run, gives the reason (not found, exit code, timeout, cancelled, output over 8 MiB or could not start) and the last lines of the CLI's error output. It does not switch to the other reviewer.
4. Timeout is 10 minutes per attempt, with one retry on timeout only. A failure is not retried. A review cancelled before any CLI starts reports one attempt with outcome `cancelled`.

The review needs no Jev key and ignores the `review` switch and `/jev all off`: it runs whenever the operator asks.

Codex tier names (`sol`, `terra`, `luna`) resolve at each run to the newest model of that tier listed by `codex debug models`, so a newer model is picked up without a change here. When the list cannot be read, the stored name is passed to Codex as written. The success text names the model that ran.

This is separate from the `reviewer` slot, which routes ordinary review subagents to a chosen model. See [ADR 0004](decisions/0004-review-as-a-slot.md).

## 7. A compaction

1. `session_compact` fires.
2. A held effort is released because the anchor is now before the compaction, so the next prompt makes one new decision.
3. Skill bodies that the compaction dropped are sent again in full if picked again; bodies it kept are referenced.
4. Nothing else changes. The ledger is unaffected.

## 8. Session start

1. Read `config.json`. If malformed, report and stay inert.
2. Read `state.json` and `tuning.json`.
3. Check the API key's presence, without calling Jev.
4. Check for the executor; note its absence.
5. Draw the status line. In print and JSON modes, nothing is drawn.
6. Show one line if tuning changed something since the last session.

## Developer workflow

See [Contributing](../CONTRIBUTING.md) and the [roadmap](roadmap.md).

```mermaid
flowchart LR
    W["Pick the next<br/>work group"] --> B["Branch in a worktree"]
    B --> T["Failing test"]
    T --> I["Implement"]
    I --> V["Unit and host tests"]
    V --> D["Update docs"]
    D --> R["Review"]
    R --> M["Merge after approval"]
    M --> W
```
