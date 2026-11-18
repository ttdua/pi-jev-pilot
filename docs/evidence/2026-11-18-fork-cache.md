# Fork cache evidence (2026-11-18)

**Result: PASS.** Every included same-model OpenAI-compatible row is at or above the 0.90 bound (0.920 to 0.925) at `P >= 25000`. The Anthropic API is **not measured**. A model-override row and one Anthropic-model row through the Claude Code CLI are recorded without a bound.

Command (`scripts/fork-cache-evidence.ts`, manual, not run by `bun test`):

```
FORK_EVIDENCE_OPENAI_API_KEY=… FORK_EVIDENCE_OPENAI_BASE_URL=http://127.0.0.1:20128/v1 \
FORK_EVIDENCE_OPENAI_OVERRIDE=gpt-6-sol \
bun scripts/fork-cache-evidence.ts --openai 9router/gpt-6-luna \
  --anthropic-route claude-code/claude-haiku-5-5
```

Keys come from the environment and are never printed. The OpenAI-compatible provider is the local 9router (`openai-completions`) with `compat.sendSessionAffinityHeaders: true`, `sessionAffinityFormat: "openai"`, as the spike found necessary. The `one fork` run goes through a pass-through recording proxy so the parent's last request can be sent again for the floor.

## Results

| provider | kind | P | cacheRead | ratio | elapsed s | result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| OpenAI-compatible (`9router/gpt-6-luna`) | one fork | 27686 | 25472 | 0.920 | 1.9 | included: PASS |
| OpenAI-compatible | parallel forks (1/2) | 27686 | 25600 | 0.925 | 1.8 | included: PASS |
| OpenAI-compatible | parallel forks (2/2) | 27686 | 25472 | 0.920 | 1.8 | included: PASS |
| OpenAI-compatible | model override (`gpt-6-sol`) | 27685 | 0 | 0.000 | 1.5 | recorded, no bound |
| Anthropic model via `claude-code/claude-haiku-5-5` | one fork | 52093 | 51747 | 0.993 | 2.5 | recorded, no bound (other route) |

An earlier run in the same session gave 0.920 / 0.920 / 0.920 for the three included rows (P 27686 and 27684, cacheRead 25472), so the result is stable.

## Provider cache floor

The parent's last request (`one fork` run) sent again unchanged to the same route: `P = 27686`, `cacheRead = 25472`, `P - cacheRead = 2214`. This is a provider limit, not a fork defect: even a byte-identical request leaves about 2 200 tokens uncached, so the best possible ratio at this `P` is `25472 / 27686 = 0.920`, which is exactly what the fork reads.

## Conditions

- Parent: one turn holding a generated filler document (about 90 000 characters); `P` is the parent's last request `input + cacheRead + cacheWrite` from its usage. A run is excluded when `P < 25000`; every run here had `P` of 27 600 or more.
- Fork: started by the service's `spawn` with `context: "fork"`, no thinking or tool override, within 60 seconds of the parent's last request (elapsed is from that assistant message's timestamp to the fork launch). Elapsed was under 3 s in every run.
- `cacheRead` is the first assistant message of the fork transcript; ratio is `cacheRead / P`.
- Model override row: the fork runs on a different model, so a zero read is expected; recorded without a bound.
- Anthropic-model row: the Anthropic API was not called by this script. The route is the `pi-claude-code` extension (`claude-code` provider), which drives the Claude Code CLI under the operator's subscription login (the row runs with the operator's real `HOME` for that login; the OpenAI rows use an isolated one). A route through another client may not expose Pi's request prefix, so the row is reported with its route and no bound. Its 0.993 shows the fork reuses the parent's cache through that client, nothing more.

## Denominators and exclusions

- Denominator: `P` of each run, column above. No run was excluded by `P` or by elapsed time.
- Anthropic API: not measured. The specification does not bound any Anthropic row.
- The first run at `P >= 25000` on the Claude Code route timed out in the harness (the CLI did not find its keychain login because `USER`, `LOGNAME` and `SHELL` were stripped from the isolated environment); the script now passes those three variables and the row ran. Nothing else was tuned.

## Reading the shortfall

At the earlier `P` of about 13 500 this route failed the bound (0.841 to 0.850). That was not a fork defect, and the amended conditions (`P >= 25000`, floor recorded) follow from it. Evidence from that investigation, through a throwaway recording proxy in front of 9router (not committed):

Root cause: provider behaviour, not the fork's construction. Two experiments:

1. **Fork vs parent request.** The parent's last request (2 messages: system, user filler; P = 13 549) and the fork's first request (4 messages) were compared as parsed JSON and as raw text. `tools` are equal, every other top-level field is equal (only `prompt_cache_key` is absent in both), and the parent's messages are a strict prefix of the fork's: the first raw difference is at byte 39 804 of 48 343, exactly where the parent's body ends and the fork's synthetic assistant `OK` message begins. Headers: `session_id`, `x-session-affinity` and `x-client-request-id` equal the parent id in both; the fork also sends `session-id`, `x-session-id`, `x-affinity` (the guard's full set, all the parent id).
2. **Does the provider cache a whole prompt?** The same request sent three times on one fresh session id (`prompt_tokens` / `cached_tokens`):
   - 13 596-token prompt: 11 392 on the repeat (gap 2 204, ratio 0.838), with no change on a third send.
   - 23 019-token prompt: 20 864 on the repeat (gap 2 155, ratio 0.906).
   - The parent's own request replayed: first send 0, second 11 392 (gap 2 166).

An **identical** repeat leaves about 2 150 to 2 200 tokens uncached, so the provider (through 9router) caches only up to about `P - 2 150` rounded down to 128-token blocks, whatever the prefix. The fork reads the same 11 392 (0.841) the identical parent request reads: it loses nothing to divergence. The ratio is therefore `1 - ~2 150 / P`, and 0.90 is reached only for `P` of about 21 500 or more on this route. The earlier minimum `P` of 8000 was too small for this provider; at `P = 13 500` no fork can pass, because even a byte-identical request does not.

Decision (user): keep 0.90, require `P >= 25000`, record the floor. The rerun above confirms the model: ratio is `1 - ~2 200 / P`, 0.920 at `P = 27 686`.

## Known gap: Codex

`openai-codex-responses` overwrites `session-id` and `x-client-request-id` after the `before_provider_headers` hook, so a fork on that API keeps its own session id in both SSE and WebSocket requests. The guard rewrites `prompt_cache_key` only where the provider set one. No Codex row was run; cache sharing there is not claimed.
