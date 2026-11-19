# 0010: Tiers measure knowledge, effort measures work

**Status:** Accepted, 2026-11-20. Supersedes the rubric, expert-effort and risk-to-tier parts of [0008](0008-mode-target-cutpoints.md).

## Context

Under ADR 0008, tier and effort measured the same thing: how hard or long the work is. Both worker rubrics listed "unknown bug cause" and "novel architecture", the difficulty score added effort to the tier rank, `expert` needed effort `xhigh` or `max`, `fast` capped effort at `medium`, `risky` lifted the tier to `deep`, and the strategy gates read the main `tier` answer as work size.

The model ladder (Haiku < Sonnet < Opus < Fable) differs in trained knowledge, while effort sets how hard the agent works. Asking one question per axis lets Jev answer each about one thing, and lets the package pick model and effort separately.

## Decision

**D1. Rename, one source.** `fast` → `basic`, `balanced` → `broad`, `deep` stays, `expert` → `frontier`. A tier picks how much the model knows; effort picks how hard it works. `TIER_LADDER` (policy) and `TIERS` (store) remain the two lists and a test keeps them equal. The feature switch `expert` becomes `frontier`; `frontier` is a reserved slot name, and `expert` stays reserved.

**D2. Old names on read only, for one minor release.** `tiers.fast|balanced|expert` in `config.json`, `switches.expert` in `state.json` and `/jev expert on|off` are accepted as aliases with a deprecation notice; an alias next to its new key is a problem at the alias. The ledger schema accepts the old targets, reasons and `expertOffered`. Writers emit only new names. An existing slot named `frontier` is still read and routed with a notice to rename it; slot writes are refused until it is renamed by hand.

**D2b. Rewrite on disk at main session start.** A valid `config.json` with alias keys is rewritten atomically, keys renamed in place, values, order and file mode kept, with one notification. `switches.expert` in `state.json` moves to `switches.frontier`. Invalid or conflicting files are left alone, failures are swallowed and retried at the next start, and child sessions never write. Reads stay free of side effects.

**D3. Score and cuts on the knowledge axis.** `score = Σ rank(t) · P̂(t)` over tier keys, range 0–3; effort is no longer part of it. Cut points are `basicMax`, `broadMax` and `frontierMin`. `frontierMin` counts every window entry above `broadMax`, with no effort filter. The window takes rubric-3 lines with `frontierOffered` and reason `frontier` or `cut`.

**D4. Decision order `frontier`, `slot`, `cut`.** The tier never reads `effort` or `risky`. `risky > .7` raises worker effort to at least `high` and no longer lifts the tier. The `medium` cap on the lowest tier is gone; after a fallback move effort is still `xhigh`.

**D5. Targets.** `budget` 50/40/10/0, `standard` 20/53/26/≤ 1, `premium` 0/50/47/≤ 3. The lower frontier caps go to `deep`.

**D6. Main request and strategy gates.** The main request no longer asks `tier`. With `strategy` on it asks `effort` even when the effort result will not apply (held prompt, `effort` off, non-reasoning model); that answer serves only the gate and is not recorded. Gates read Jev's raw effort choice: `delegate` and `parallel` need at least `medium`, `graph` at least `xhigh`; an unanswered effort blocks `parallel` and `graph`, not `delegate`.

Rubric wording moves to knowledge for tiers and to work and care for effort, in `docs/jev-questions.md`, as `RUBRIC_VERSION` 3. A new seed comes from a rubric-3 replay of the 2026-11-07 worker corpus ([evidence](../evidence/2026-11-20-knowledge-tier-mix.md)).

## Consequences

- Public names change: config keys, the `frontier` switch and command, ledger values. Aliases and the start-up rewrite keep an upgrade working; they are removed in the next minor release.
- Rolling back to an older build needs the old keys restored by hand, since older builds reject `tiers.basic` and the other new keys.
- Every older worker line leaves the cut-point window, so the seed applies for the first 100 launches after the upgrade.
- Tier-only scores are coarser. The replay found every mode in range without a tiebreak, but many launches share one score.
- Risky deploy or delete work may now run on `basic` or `broad` at `high` effort. Revisit if the `lowWorkerErrors` signal rises.
- With `strategy` on, a non-reasoning or held main model is asked one more question (`effort`), at the same request count.
