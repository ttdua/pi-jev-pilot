## Design Summary

**Intent.** Make the two worker routing axes mean what the underlying models actually differ in, so Jev answers each question about one thing and routing picks model and effort more accurately.

- **Tier = how much the model knows.** The model ladder (haiku < sonnet < opus < fable) differs mainly in trained knowledge: how broad and how deep. The tier question asks how much knowledge the task needs, not how long or careful the work is.
- **Effort = how hard the agent works.** `low` to `max` is how much the agent reasons, how many tools it calls, how far it traces and verifies. The effort question asks how much work and care the task needs, not how rare the knowledge is.

Today both rubrics describe the same thing (task difficulty and length): "a bug whose cause is unknown" appears under tier `deep` and effort `xhigh`; "novel architecture" under `expert` and `max`. The score adds the two, `expert` requires high effort, `fast` caps effort at `medium`, and the main strategy gate reads tier as "size of work". All of these encode the old, merged meaning.

The decision still comes from Jev reading the full context; this change only corrects the names, the rubric wording and the rules that tie the two axes together.

**Goals**
- Rename the tiers to knowledge names: `basic`, `broad`, `deep`, `frontier` (was `fast`, `balanced`, `deep`, `expert`).
- Rewrite the tier rubric around required knowledge and the effort rubric around required work and care, removing the overlap.
- Decide tier and effort independently: tier from the tier answer only, effort from the effort answer only.
- Lower the `frontier` cap: `standard` 2% to 1%, `premium` 5% to 3%. Other mode shares stay.
- Re-derive the seed cut points from a fresh replay with the new rubric.

**Non-goals**
- No change to modes (`budget`, `standard`, `premium`), the window size, the slot mechanism, fallback order, the risk floor value, or the effort ceiling.
- No new classifier question for workers; the worker request keeps `tier`, `effort`, `risky` (plus slots).
- No probability gate for `frontier` (the old `expert_needed > 0.9` gate was removed by ADR 0008; it is not restored).

**Anti-goals**
- Routing more work to `frontier` than the cap, or treating "long" or "important" work as needing a bigger model.
- Breaking an operator's existing `config.json` or `state.json` on upgrade.

## Alternatives Considered

### Alternative A: Rewording only
- **Approach**: Keep keys `fast/balanced/deep/expert` and every rule; rewrite display text and rubric wording toward the knowledge meaning.
- **Pros**: No config migration; smallest diff.
- **Cons**: Names keep suggesting speed and size; the score, the expert effort condition, the `fast` effort cap and the strategy tier gate still enforce the merged meaning, so the new wording would fight the rules.
- **Why not chosen**: Does not make the axes independent, which is the point of the change.

### Alternative B: Independent axes, effort kept as a score tiebreak
- **Approach**: As the agreed approach, but the score stays `tierRank + effortRank / 8` (or a smaller divisor) to keep scores fine-grained for the quantile cut.
- **Pros**: Scores stay spread out, so the cut points hit target shares more easily.
- **Cons**: Effort still pushes a launch toward a bigger model, which is exactly the coupling being removed.
- **Why not chosen**: Kept only as a fallback if the replay shows the tier-only score is too clumped to hold the targets (see Open Questions).

### Alternative C: Independent axes, renamed tiers (chosen)
- **Approach**: Rename tiers, rewrite both rubrics, score from tier only, `frontier` gated by its cap only, effort decided on its own, strategy gate moved from tier to effort, main `tier` question dropped.
- **Pros**: Each question measures one thing; each rule reads the axis it is about; the main request asks one question fewer.
- **Cons**: Public config keys, the feature switch and the command name change; the seed must be re-derived by a paid replay; many specs and docs change wording.
- **Why not chosen**: Chosen.

## Agreed Approach

Alternative C. The operator agreed each point below in the conversation; it is the only option where the rubric wording and the routing rules agree on what tier and effort mean.

## Key Decisions

Changes to specified requirements are named with their capability.

1. **Tier names** become `basic`, `broad`, `deep`, `frontier`, in that ladder order. This alters the tier names in `worker-decision`, `worker-request`, `mode-cutpoints`, `worker-modes`, `worker-routing`, `worker-ledger`, `config-file` (`tiers.*`), `status-line`, `session-tally`, `tuning-signals` and others that name a tier. The `expert` feature switch and its command follow the tier: `frontier`.
2. **Upgrade is non-breaking.** Old `tiers.fast|balanced|deep|expert` keys and the old `expert` switch keep working as deprecated aliases for one minor version (operator's anti-goal; the repo already uses this pattern for `subagents.forkedLaunch`).
3. **Tier rubric** describes required knowledge: common, well-documented programming knowledge (`basic`); broad engineering knowledge across stacks and libraries (`broad`); specialist depth in a domain (`deep`); rare, frontier-level expertise where weaker models are likely to be wrong (`frontier`). Length, number of files, care needed and risk are explicitly not tier signals. This alters the rubric text in `worker-request` and bumps the rubric version.
4. **Effort rubric** (worker and main) describes required work and care: steps, tracing, verification, tool calls. Rare knowledge is explicitly not an effort signal.
5. **Difficulty score = probability-weighted tier rank only.** Effort no longer adds to it. Alters requirement "Difficulty score" in `mode-cutpoints`.
6. **`frontier` rule**: a launch reaches `frontier` when its score is at or above `frontierMin`, the lowest score whose share in the window fits the mode cap. The effort condition (`xhigh` or `max`) is removed, in the rule and in the cut. Alters `worker-decision` (rule `expert`) and `mode-cutpoints` (`expertMin`).
7. **Caps**: `standard` frontier cap 1%, `premium` 3%; `budget` stays 0%. All other shares unchanged. Alters `worker-modes`.
8. **`risky` raises effort only.** `risky > .7` no longer lifts the tier to `deep`; it still lifts worker effort to at least `high`. Alters rule `risky` in `worker-decision`.
9. **No effort cap on `basic`.** The `fast ⇒ effort ≤ medium` rule is removed. Alters worker effort rules in `worker-decision`.
10. **Strategy gate reads effort**: `delegate` and `parallel` need effort at least `medium`, `graph` needs effort at least `xhigh` (probability bars unchanged). The main request no longer asks `tier`. When `strategy` is on, the main request asks `effort` even if the `effort` feature is off, but then only uses it for the gate. Alters `strategy-advice` and `main-effort` ("Main questions").
11. **Seed re-derived** from an operator replay of the same worker corpus with the new rubric; published as a new tier-mix evidence note. Until then, the window ignores lines with the old rubric version.

## Open Questions

- **Score granularity.** With effort removed, scores come only from Jev's tier probabilities. If the replay shows too many launches sharing one score to hold the mode targets within ±10 points, fall back to Alternative B with a small effort tiebreak. Resolved by the replay, not ahead of it.
- **Effort when held.** If `effort` is on but the prompt is held (`effort-hold`), the strategy gate still reads the effort answer; design to confirm this does not change the hold behaviour.
