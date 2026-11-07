# Evidence: rich state replay, pass 1, 2026-11-07

This is the WG-16 pass 1 replay. It decides which [rich main-state fields](../jev-contract.md#main-state) ship. The figures are aggregates from one operator's data. Prompts, cases and scripts are not in this repository; the method is in [`scripts/replay`](../../scripts/replay) and [Testing](../testing.md#rich-state-replay).

**Read with care:** there is no ground truth. A field group stays only if it changes more decisions than noise does, **and** the operator, after reading the changed cases, prefers the new answers.

## Data

| Item | Value |
|---|---|
| Source | Main prompts in local session files, nested project folders included. Child sessions, slash commands, explicit skills and duplicates are excluded |
| Sample | 100 main prompts, stratified by project and by recorded starting effort, seed 1 |
| Request | The package's own `mainState` and `mainQuestions`, with effort, risky, tier, strategy and corrects. Skills are off |
| Capabilities snapshot | 29 active tools and 4 agents, taken on the day of the run |
| Model | `jev-latest` |
| Requests | 917, with no misses, run in 44 s. The estimated cost is $0.075 |
| Workers | Not run. 45 of the 46 sampled briefs launch agents through an executor that the package does not route, so they could not be built faithfully |

About a third of the sample is reply messages from the operator's review inbox, not typed prompts. They are kept, because they reach Jev the same way.

## Noise

There were two plain reruns of the minimal state. Effort flipped in 3 of 100 and tier in 5 of 100. Strategy, risky and corrects flipped in 0, 0 and at most 2. A single flip of strategy or risky therefore counts as "beyond noise". It is not treated as a result.

## Field groups

Each cell reads **flips / noise**, with the variant compared to the minimal state.

| Group added | n | effort | tier | Direction of change | Decision |
|---|---|---|---|---|---|
| `capabilities` | 100 | **9 / 3** | **9 / 5** | Mixed: effort 5 up and 4 down; tier 5 to `fast` and 4 deeper | **Keep** |
| `last_decision` | 100 | 5 / 3 | 6 / 5 | Mixed. Short follow-ups ("agreed", "install it") often moved | **Keep** |
| `context_used_percent` | 67 | 3 / 3 | 4 / 5 | Within noise | Remove |
| `languages` | 60 | 3 / 3 | 2 / 5 | Within noise | Remove |

- **Exclusions.**
  - 33 samples had no usable token count, either because of compaction or because the model was unknown.
  - 40 samples had a working directory that no longer exists.
- **Leave-one-out.** The leave-one-out variants (each group removed from all four) had only 38 samples. Each changed 1–4 decisions, and only removing `capabilities` came near noise. No single group carries the full state.
- **The two groups kept.** Both changed more than noise. The operator read the changed cases and preferred the new answers.
  - For `last_decision`, the operator's reason: a short reply only makes sense next to what the agent asked before. The previous turn's level is part of that context.

Most changed cases were close calls, for example `fast` .41 against `balanced` .42. The kept fields tip near ties; they do not overturn confident answers.

## Effort option order

Reversing the order of the `effort` options, with the state otherwise minimal, flipped effort in **12 of 100**, against a noise of 3. **10 of the 12 moved up**, mostly `low` to `medium`. This confirms the lean toward the first option that TypeSafe documents. The order in use, `low` first, pulls main effort down.

The operator chose `high, medium, xhigh, low, max`, which is the observed order of use, from most to least. The confirming run replayed 400 requests: 100 main prompts and 0 workers, because their agents are not in the snapshot. Effort flipped in **12**, against noise of 6 and 3. **11 of the 12 moved up**, mostly from `low`. Tier stayed within noise.

**Decision:** shipped for both the main and the worker question, which share one criteria object. The worker side is unmeasured. Policy still ranks `low` to `max`.

## Workers

The worker variants (`parent_request` on, agent description emptied, instructions emptied) were dropped from WG-16. The defaults stay: description and instructions are sent, and `parent_request` is off. Measuring them needs a corpus of launches that the package routes.

## Git

`workspace.git` was dropped without measurement. The operator's reason: measuring it needed the package installed for daily work.

## Cost

917 requests, about 7.5 US cents, estimated from size and list price, not from an invoice.
