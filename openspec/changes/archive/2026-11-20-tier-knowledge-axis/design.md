## Context

Worker routing (ADR 0008) turns Jev's worker answers into a score, cuts it per mode with a rolling window, and adds rules `expert`, `risky`, `slot`, `cut`. The tier and effort rubrics overlap, the score mixes both axes, and three rules read one axis to decide the other. The brainstorm (approved) fixed the product decisions; this file records how they land in code and data.

Pure policy lives in `src/policy/`; Jev wording in `src/jev/rubrics.ts`; tier names in `src/policy/launch.ts` (`TierName`, `TIER_LADDER`) and `src/store/defaults.ts` (`TIERS`, `FEATURES`). Both lists must change together.

## Goals / Non-Goals

**Goals:**
- One rename of the tier vocabulary across policy, store, host, scripts and docs, with a non-breaking read path for old config, state and ledger data.
- Tier-only score and a frontier cut that no longer reads effort.
- Main strategy gate on effort, with effort asked only for the gate when the level must not change.

**Non-Goals:**
- Changing window size, `WINDOW_MIN`, fallback order, slot bar, risk floor value, effort ceiling, effort option order.
- Rewriting the replay tool beyond the renamed fields.

## Decisions

### D1. Rename map, single source
`fast→basic`, `balanced→broad`, `deep→deep`, `expert→frontier`. `TIER_LADDER` in policy and `TIERS` in store stay the two lists, with the existing test asserting they are equal. The feature switch `expert` becomes `frontier`; `DECISION_FEATURES` and `RESERVED_SLOT_NAMES` follow (`frontier` added; `expert` kept reserved so an old command never parses as a slot).
- Why not keep keys and change labels: the names are what operators and Jev read; keeping `fast` keeps the wrong meaning.

### D2. Legacy names on read only
A single pure map `LEGACY_TIER` (`fast→basic`, `balanced→broad`, `expert→frontier`) is used by:
- **config read**: `tiers.fast|balanced|expert` move onto the new key with a notice, the same pattern as `subagents.forkedLaunch`. Both old and new key for one tier is a problem at the old key.
- **state read**: `switches.expert` moves onto `switches.frontier` (both present: `frontier` wins, `expert` dropped), so it is gone after the next write.
- **command parse**: `/jev expert on|off` acts as `/jev frontier on|off` and the report adds `notice: /jev expert is deprecated; use /jev frontier`.
- **ledger schema**: the target domain accepts both old and new names, and reason accepts `expert` and `frontier`; `expertOffered` and `frontierOffered` are both allowed. Writers only emit new names.
- **slot name `frontier`**: newly reserved. The config read keeps an existing `frontier` slot (notice to rename) so an upgrade never invalidates a config; the slot writer refuses to write one. The command parser checks feature names before slot names, so `/jev frontier on|off` is the switch; showing or removing an old `frontier` slot needs a manual config edit (named in the notice).

Marked `DEPRECATED(remove next minor)` like the existing alias.

### D2b. Migrate on disk at session start
At every main `session_start`, before the status line is drawn, a host step `migrateLegacyNames()` runs:
- **config**: a pure `migrateTierKeys(raw)` returns the raw object with `tiers.fast|balanced|expert` renamed in place (same position, values untouched) and the list of renames, or nothing when the file is invalid, conflicting or already clean. The store writes it with `writeFileAtomic`, keeping the file mode; this becomes the second permitted `config.json` writer next to the slot writer. A `frontier` slot is never renamed (the operator picks its new name).
- **state**: `updateState` with a mutate that moves `switches.expert` to `switches.frontier`; the existing read already does the move, so the mutate is the identity and the write drops the old key.
- One info notification after a config rewrite, listing renames and the path. Failures are swallowed; the read aliases (D2) keep everything working and the next start retries.
- Why on start and not on read: reads stay side-effect free (config-file "Read leaves the file untouched"), and a single place owns the write.
- Why keep the read aliases: the write can fail (read-only dir, invalid file), and the replay tool reads config without the host. Old ledger lines never enter the window anyway (rubric version check), so the window code reads only new names.

### D3. Score and cuts
`difficultyScore` = rounded `Σ rank(t)·P̂(t)`; the effort term and `EFFORT_DIVISOR` are removed. Range stays 0–3, so the ledger `score` domain (0–3.5) is unchanged.
`CutPoints` becomes `{ basicMax, broadMax, frontierMin }`. `frontierCut` uses every window entry with score > `broadMax` (no effort filter), same cap math and tie rule. `WindowEntry.effort` and `modalEffort` are removed since nothing reads them.
- Risk: tier-only scores are coarser; many launches may share a score so a quantile cut overshoots a share. Mitigation: the replay task measures it; if a mode misses its range, the fallback (brainstorm Alternative B) is a tiebreak `rank(effort)/100`, decided with the operator before shipping the seed.

### D4. Decision rules
Order `frontier`, `slot`, `cut`. `riskRule` and its `risky` reason are deleted from the decision (the ledger still accepts `risky` for old lines). `workerEffort` drops the tier parameter's cap; it keeps the risk lift and the `xhigh` ceiling and `xhigh` after fallback. The `tier` field of `EffortInput` is removed.
- Partial answers: without a score only `slot` can match; with `tier` unanswered and `risky` .9 nothing is decided and the thinking-only route still writes the risk-lifted effort.

### D5. Mode targets
`budget` 50/40/10/0, `standard` 20/53/26/1, `premium` 0/50/47/3. The cap reduction goes to `deep`, so shares still sum to 100 and the `basic`/`broad` targets are unchanged.

### D6. Main questions and the strategy gate
`mainQuestions` takes `applyEffort` (old `askEffort`: feature on, not held, model supports levels) and `askStrategy`. It asks `effort` when `applyEffort || askStrategy`, `risky` only when `applyEffort`, then `strategy`, then `corrects`. `MAIN_TIER_QUESTION`, `MAIN_TIER_CRITERIA` are deleted.
`adviseStrategy` takes Jev's raw effort choice (before the risk lift or ceiling): `delegate` and `parallel` need effort at least `medium`, `graph` at least `xhigh`. Unanswered effort blocks `parallel` and `graph` but not `delegate`, mirroring today's "tier unanswered" rule, where `delegate` had no tier condition.
`OutcomeFlags` gets `applyEffort` (effort-eligible). The effort plan, the status `no answer` rule and ledger `effortP`/`risky`/`requested` run only when `applyEffort`; the existing applied/kept/discarded outcomes are unchanged within it. A gate-only effort answer is used for advice and not recorded (no new ledger field), and on a held turn it never becomes the anchor.
- Why the eligibility flag and not "was `effort` asked": since `effort` is now asked for the gate, "asked" no longer implies "may change the level".
- Why not keep a main `tier`: it would be the only remaining reader of the old meaning, and Jev answers one question fewer.

### D7. Rubric wording
New `WORKER_TIER_CRITERIA` keyed by the new names, instruction "Which is the least knowledgeable model tier that has the knowledge this task needs?". Each criterion names the knowledge level and says length, file count, care and risk are effort, not tier. The effort instruction and criteria are reworded around amount of work and verification and say rare knowledge is a tier matter. `RUBRIC_VERSION` = 3; the wording snapshot test is updated. Exact text goes in `docs/jev-questions.md` and is copied verbatim into `rubrics.ts` (existing rule).

### D8. Seed and evidence
Replay (`scripts/replay`, `--pass report`) is rerun by the operator on the 2026-11-07 worker corpus with the new rubric; the seed is computed with the new cut rules from the `standard` run, as before, and published with the mix by mode in `docs/evidence/<date>-knowledge-tier-mix.md`. Until the operator runs it, the plan ships a provisional seed derived offline from the new rules over the fixture corpus and the task stays open; the change is not archived with a provisional seed.

### D8b. Scenario names
OpenSpec requires a MODIFIED requirement to keep every baseline scenario name. Scenarios whose behaviour changed keep their old heading with an `<!-- Intentional change: ... -->` comment; tests are named after the behaviour, and the plan's scenario map lists both.

### D9. ADR
`docs/decisions/0010-knowledge-tiers.md` records D1–D6 and marks ADR 0008's rubric, expert-effort and risk-to-tier parts superseded.

## Risks / Trade-offs

- [Coarse scores break the quantile targets] → measured in the replay; tiebreak fallback (D3).
- [Dropping risk-to-tier sends risky deploy work to `basic`] → effort is lifted to `high`; deploying is procedural, not knowledge-heavy. Revisit if field data shows errors (`lowWorkerErrors` signal).
- [Operators with `tiers.fast` etc.] → aliases with a notice for one minor (D2).
- [Window resets on rubric 3] → seed applies for the first 100 launches; expected and documented.
- [Asking `effort` on non-reasoning models when `strategy` is on adds one question] → small latency; skipped when `strategy` is off.

## Migration Plan

1. Ship with the start-up migration and the read aliases; `CHANGELOG.md` names the renames, the automatic rewrite of `config.json`/`state.json`, and the deprecated keys.

**Config and state** (D2b): migrated on disk at the first main `session_start` after the upgrade; the read-path aliases remain as the fallback when the write fails or before it runs.

**Tuning** (auto-tuning, `/jev tune`, cut-point window):
- `tuning.json` holds only `timeoutMs`, its pending change, block and history; no field names a tier or the `expert` switch, so the file needs no migration and a file written by the previous version reads unchanged.
- Tuning signals read the shared ledger: `lowWorkerErrors` counts both `basic` and legacy `fast` lines as low, so its window stays continuous across the upgrade. `corrected`, `largeAtLow` and `highSmall` read no tier.
- A pending `timeoutMs` change made before the upgrade is judged on the next 40 decisions, which may include requests of the new shape. The shape barely changes (the main request trades `tier` for `effort` when `strategy` is on; the worker request asks the same three questions), so no reset is forced; the operator can run `/jev tune undo` or `/jev tune reset` as today.
- The cut-point window is the other self-calibrating state. Raising the rubric version to 3 excludes every older worker line, so the shipped seed applies until 100 new lines exist; nothing is rewritten in the ledger.
2. Next minor: remove the alias and migration code marked `DEPRECATED(remove next minor)`.
Rollback: revert the release. A migrated `config.json` uses keys the old version rejects as unknown, so the operator restores the old keys by hand (`CHANGELOG.md` lists them); ledger lines written with new names are skipped by the old tolerant read.

## Open Questions

- Whether the tiebreak in D3 is needed; resolved by the replay.
