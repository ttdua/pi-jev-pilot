## Context

The pieces this change builds already have a home in `docs/architecture.md`: `host/agents.ts` reads agent files, `jev/` builds requests without Pi, `policy/` holds pure rules. Lint enforces those boundaries (`.oxlintrc.json`). `readAnswers` (`src/policy/answers.ts`) already validates answers per question against a `QuestionSpec`, and `askJev` (`src/jev/client.ts`) sends a request and never throws.

The executor (`@gotgenes/pi-subagents` 25.0.5) defines the agent semantics this change mirrors: `custom-agents.ts` loads global then project files, `default-agents.ts` holds the three built-ins, `agent-types.ts` resolves a name exactly then case-insensitively and falls back to `general-purpose`, and `invocation-config.ts` decides what `locked` withholds.

## Goals / Non-Goals

**Goals:**
- Agent lookup, effective launch fields and lock checks that match the executor.
- A worker request whose wire form follows `docs/jev-questions.md` verbatim.
- The decision order, effort rules and fallback choice as pure, table-tested functions.

**Non-Goals:**
- Any Pi event handler, mutation of `subagent` input, registry or credential check, warnings, ledger lines (all `wg-11-worker-host`).
- Slots in the request, `budget` and `premium` rubrics and Fable rules (WG-12, WG-13).
- The `subagents.forkedLaunch` setting (host change).

## Decisions

**Reader lives in `host/`, using Pi's `parseFrontmatter`.** The executor parses agent files with Pi's `parseFrontmatter`; using the same function avoids a second YAML reading that could disagree. Only `host/` may import Pi, so the reader is `host/agents.ts`. It takes `cwd` and `agentDir` as arguments, so tests point it at temporary directories. Alternative: a hand-written frontmatter parser in `policy/`, rejected because it could read a file differently from the executor.

**Lookup order mirrors the executor.** The executor keeps one map: built-ins inserted first, then global files, then project files, a later source overwriting an earlier entry in place. An exact name therefore resolves project, then global, then built-in. A case-insensitive match takes the first key in insertion order: built-in names, then global names, then project-only names. The reader reproduces both, sorting each directory listing because `readdir` order is not defined. Files are found by listing, never by joining the requested name into a path, so a path-like type cannot read outside the agents directories. An unreadable file, a directory named `*.md` and a frontmatter that fails to parse are skipped; the executor would throw on the last, and skipping is the fail-open choice. `enabled: false` is not checked: the executor rejects such a launch itself.

**Built-in table carries no instructions excerpt.** The built-ins' system prompts belong to the executor; copying them would need attribution and would drift on upgrade. Their name, description and declared tools are enough for the tier question (`Explore` and `Plan` declare read-only tools). `instructions_excerpt` is the empty string for built-ins.

**`declared_tools` is `null` when the agent declares none.** That distinguishes "all tools" (no `tools` key, as `general-purpose`) from an explicit empty list (`tools: none`), matching the executor's `listField`.

**Effective launch fields are a pure function in `policy/launch.ts`.** `resume` comes from the input only. `inherit_context` and `run_in_background` are the input value unless the agent locks the field, else the agent's value, else `false`, as `resolveAgentInvocationConfig` does. `modelLocked` and `thinkingLocked` follow `isLocked`: `locked: true` locks a field only if the file sets it; a list locks the fields it names. The policy defines its own plain `AgentFacts` type; the reader returns a value of that shape, so `policy/` imports nothing from `host/`.

**Request builder takes display names as input.** Tier criteria are prefixed with the configured model's display name from Pi's registry. The builder receives a `tier → display name` map, keeping `jev/` free of Pi. It returns both the wire `questions` and the `QuestionSpec` map for `readAnswers`, built from one option list, so what is asked and what is accepted cannot drift.

**Offered tiers.** Configured tiers in ladder order `fast`, `balanced`, `deep`, `expert`; `expert` only when configured and the `expert` switch is on. With no tier offered, neither `tier` nor `expert_needed` is asked; `effort` and `risky` still are.

**Decision and effort are separate functions.** `decideTier` returns a tier and a reason, or nothing; `workerEffort` takes the effort answer, `risky`, the final tier and whether fallback moved it. Effort returned is the requested level; clamping to the model needs Pi's `clampThinkingLevel` and happens in the host change. This keeps the effort table testable without models.

**Partial answers.** Each question counts on its own (contract). `risky > .7` decides `deep` even when `tier` is unanswered, because the floor does not depend on the tier answer. Without a `tier` answer and without the risk floor, no tier is decided and the model stays as the caller asked. Without an `effort` answer, no effort is requested unless fallback moved the tier.

**Shared literals are duplicated on purpose.** `TierName` and `EffortLevel` in `policy/` repeat `Tier` (`store/defaults.ts`) and `EffortLevel` (`store/ledger-schema.ts`), because `policy/` and `store/` may not import each other. A test asserts the lists are equal, so they cannot drift.

**Fallback is a separate pure step.** `chooseFallback(tier, offered, canRun)` keeps the decided tier when it is offered and can run, `expert` included. Otherwise it walks down the ladder from the decided tier to the first offered tier that is usable, skipping `expert`. If the decided tier is usable it is kept. If none below is usable, the result is "leave the input unchanged". A moved target sets requested effort to `xhigh` on every tier, overriding the `fast` cap. Slot fallback to `balanced` is WG-13.

## Risks / Trade-offs

- [The executor changes its lookup or lock rules on upgrade] → Tests cite the executor behavior per case; the version policy in `docs/testing.md` reruns them on any executor upgrade.
- [Display names missing from the map] → The criterion is sent without a prefix; a test pins this.
- [`fast` at `xhigh` after fallback costs more than the domain model expected] → Operator decision; the ledger's `fallback` field (host change) makes it measurable.
- [Effort unanswered while tier moves by fallback] → Fallback effort `xhigh` applies anyway, since it does not depend on the answer.

## Migration Plan

None. No stored file changes, and nothing calls the new code until the host change.

## Open Questions

None for this change.
