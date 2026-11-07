## Context

Worker routing (WG-11) builds the worker questions in `src/jev/questions.ts`, sends them at the end of the assistant message (`classify` in `src/host/worker.ts`), and decides at the `subagent` tool call through `routeLaunch` (`src/policy/route.ts`) and `decideTier` (`src/policy/tier.ts`). The mode is already in `Settings.mode` (`src/store/settings.ts`) and is copied to the ledger entry at tool-call time. `src/policy/modes.ts` is named in `docs/architecture.md` but does not exist yet. The dependency rules allow `jev/` to import `policy/`, never the reverse, and keep `policy/` pure.

## Goals / Non-Goals

**Goals:**
- One mode value flows from settings into question building, the tier decision and the ledger line of the same launch.
- Rubric text stays data in `jev/rubrics.ts`; gates stay pure functions in `policy/modes.ts`.
- `standard` requests stay byte-identical to today's.

**Non-Goals:**
- Any per-mode change to effort, risk, slots, fallback, tool assessment or the main request.
- A replay script in this repository.

## Decisions

**D1. The mode is captured once per launch, at classification.** `classify` reads `settings.mode` from the snapshot it already uses, stores it on the launch entry, builds the questions with it, and the tool-call handler passes the same stored mode to `routeLaunch` and the ledger. Today the ledger copies the mode at tool-call time; with modes now changing the questions, a `/jev mode` between the message end and the tool call could pair `budget` questions with a `premium` gate and record either. Capturing once keeps request, gate and record consistent. A launch classified at its own tool call (no cached result) captures it there, which is the same moment.

**D2. Mode names live in `policy/modes.ts`; `store/defaults.ts` keeps its own list.** `policy/` cannot import `store/`. `modes.ts` exports `MODE_NAMES` and the `ModeName` type; a unit test asserts it equals `store/defaults.ts` `MODES`, so the two lists cannot drift. Alternative rejected: moving the list to `shared/`, which is reserved for dependency-free rules used across layers and would widen this change into the store.

**D3. The expert gate is a function selected by mode.** `expertAdmitted(mode, answers): boolean` in `policy/modes.ts` implements the per-mode table and reads raw answers only (`tier.choice`, `tier.probabilities.expert`, `expert_needed`, `effort.choice`). `decideTier` gains a `mode` parameter and calls it as rule 1, still requiring `expert` to be offered. An unanswered field the gate reads counts as not passing. Alternative rejected: a data table of thresholds, since the `premium` gate is a conjunction over three different answers, not a threshold.

**D4. `premium` can admit `expert` from a `deep` choice.** When the gate passes, the decision is `expert` regardless of whether `tier.choice` was `deep` or `expert`, and it still wins over the risk floor, as the documented order says. When `expert` is not offered, the gate cannot pass, and rules 2 to 5 apply to the actual choice: a `deep` choice stays `deep` with reason `choice`.

**D5. Rubrics are records keyed by mode.** `rubrics.ts` exports `TIER_CRITERIA: Record<ModeName, Record<TierName, string>>` and `EXPERT_NEEDED_QUESTIONS: Record<ModeName, WireQuestion>`, with `budget.expert` and the `budget`/`standard` `expert_needed` sharing the `standard` text by reference. `buildWorkerQuestions` takes the mode. The main request, which never sends a `tier` question today, is unaffected. Existing tests that compare every string with `docs/jev-questions.md` extend to all three modes.

**D6. `/jev mode <m>` follows the feature-switch path.** `parseJevArgs` gains `{ kind: "mode"; mode }` for exactly two words with a known mode name; anything else in that shape is usage. The command writes through `updateState`, keeping other fields, then reports and redraws like the other forms. Usage text lists the new form. Reserved slot names already include the three mode names and `mode`, so no slot conflict is possible.

**D7. Reason rename is a plain replacement.** `fable` becomes `expert-admitted` in `TierDecision`, `RouteReason`, the ledger schema's reason list and the "worker decisions record their tier" set. The ledger `v` stays `1`: the format is unreleased and no file written by this package exists outside test runs (the installed earlier port writes `~/.pi/agent/jev-pilot/ledger.json`, a different file and schema). A stray old line would be skipped and counted by the tolerant read like any invalid line.

## Risks / Trade-offs

- [Rubric wording drift between code and docs] → the existing verbatim test covers every mode's strings.
- [`premium` gate fires more often than replay suggested, increasing cost] → the gate and its numbers come from replay; the manual replay task checks the distribution before the roadmap marks WG-12 done; the operator can switch `expert` off.
- [`budget` routes real code to the cheapest tier] → documented as the riskiest mode in the usage guide; quality is a roadmap item, not this change.
- [Mode list duplicated in policy and store] → equality test (D2).

## Migration Plan

None. No released format changes; no state or config field is added. Rollback is a revert of the change.

## Open Questions

None.
