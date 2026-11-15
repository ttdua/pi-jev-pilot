# Evidence: effort reply replay, 2026-11-15

This is the replay for the `effort-reply-by-context` change. It decides whether two changes to the main request ship:

- **`role-rule`:** the main `effort` instruction rates a reply by the work it approves, read from the conversation, whatever the reply's length.
- **`no-prompt-chars`:** `request.prompt_chars` is no longer sent.

The figures are aggregates from one operator's data. Prompts and cases are not in this repository. The method is in [`scripts/replay`](../../scripts/replay) and [Testing](../testing.md#rich-state-replay).

**Read with care:** there is no ground truth. A variant ships only if all three hold:
- its effort flips exceed noise;
- the turn-size side measure shows it moves effort toward turns that really were large;
- the operator, after reading the changed cases, prefers the new answers.

## Data

| Item | Value |
|---|---|
| Source | Main prompts in local session files. Child sessions, slash commands, explicit skills and duplicates are excluded |
| Sample | 300 main prompts, stratified by project and recorded starting effort, seed 1 |
| Base | `full`: the shipped state, with `last_decision` and `capabilities` |
| Capabilities snapshot | 26 active tools and 9 agents, taken on the day of the run |
| Model | `jev-latest` |
| Requests | 1863, with no misses. The estimated cost is $0.19 |
| Turn size | 70 of 300 samples have the tool calls of their own turn in the ledger (15 large, at least 15 calls; 55 small). The other 230 predate the ledger |
| Workers | 46 sampled, 21 with an agent in the snapshot. Unchanged by this change; reruns only |

## Noise

Two plain reruns of `minimal` flipped effort in 16 and 13 of 300, tier in 15 and 14, strategy in 1 and 2. Noise is the larger rerun of each key. `full`-based variants are measured against the same noise.

## Variants

Each cell reads **flips / noise** against `full`.

| Variant | n | effort | tier | strategy | risky | corrects | Beyond noise |
|---|---|---|---|---|---|---|---|
| `role-rule` | 300 | **54 / 16** | 16 / 15 | 3 / 2 | 0 / 0 | 2 / 3 | effort, tier, strategy |
| `no-prompt-chars` | 300 | 14 / 16 | **23 / 15** | 2 / 2 | 0 / 0 | 2 / 3 | tier |

**Direction of effort changes** (counts of differing pairs):
- **`role-rule`:** 46 up, 8 down. The largest moves are `low→high` (27) and `low→medium` (14).
- **`no-prompt-chars`:** 8 up, 6 down.
- **Reruns, for comparison:** 6 up and 10 down, and 6 up and 7 down.

## Turn-size side measure

Effort of the variant against `full`, among samples with a known turn size:

| Variant | Large: raised / same / lowered | Small: raised / same / lowered |
|---|---|---|
| `role-rule` | **8 / 7 / 0** (53% raised) | 12 / 42 / 1 (22% raised) |
| `no-prompt-chars` | 0 / 15 / 0 | 2 / 51 / 2 |

`role-rule` raises large turns more than twice as often as small ones, so it tracks the real size of the work. It also raises some small turns, which costs tokens. `no-prompt-chars` does not move effort.

## Decision

The operator read the changed cases of both variants.

| Variant | Verdict | Reason |
|---|---|---|
| `role-rule` | **Ships** | Effort flips are more than three times noise. They lean up on turns that really were large, and the operator preferred the new answers |
| `no-prompt-chars` | **Does not ship** | Effort stays within noise. The only change beyond noise is in tier, which this change does not aim at. The variant stays in the replay so it can be measured again |

## Cost

1863 requests, about 19 US cents, estimated from size and list price, not from an invoice.
