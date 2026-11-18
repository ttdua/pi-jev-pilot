# Fork cache evidence (2026-11-18)

**Result: FAIL.** Every included same-model OpenAI-compatible row is below the 0.90 bound (0.841 to 0.850, two runs). Anthropic was not run. The bound was not lowered and the measurement was not adjusted.

Command (`scripts/fork-cache-evidence.ts`, manual, not run by `bun test`):

```
FORK_EVIDENCE_OPENAI_API_KEY=… FORK_EVIDENCE_OPENAI_BASE_URL=http://127.0.0.1:20128/v1 \
FORK_EVIDENCE_OPENAI_OVERRIDE=gpt-6-sol \
bun scripts/fork-cache-evidence.ts --anthropic anthropic/claude-sonnet-4-5 --openai 9router/gpt-6-luna
```

Keys come from the environment and are never printed. The OpenAI-compatible provider is the local 9router (`openai-completions`) with `compat.sendSessionAffinityHeaders: true`, `sessionAffinityFormat: "openai"`, as the spike found necessary.

## Results

Second of two identical runs; the first gave 0.841 / 0.850 / 0.841 for the three included rows.

| provider | kind | P | cacheRead | ratio | elapsed s | result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Anthropic | one fork | - | - | - | - | not run: no credentials |
| Anthropic | parallel forks | - | - | - | - | not run: no credentials |
| Anthropic | model override | - | - | - | - | not run: no credentials |
| OpenAI-compatible (`9router/gpt-6-luna`) | one fork | 13550 | 11392 | 0.841 | 1.4 | included: FAIL |
| OpenAI-compatible | parallel forks (1/2) | 13550 | 11392 | 0.841 | 1.8 | included: FAIL |
| OpenAI-compatible | parallel forks (2/2) | 13550 | 11392 | 0.841 | 1.8 | included: FAIL |
| OpenAI-compatible | model override (`gpt-6-sol`) | 13552 | 0 | 0.000 | 1.5 | recorded, no bound |

## Conditions

- Parent: one turn holding a generated filler document (about 36 000 characters); `P` is the parent's last request `input + cacheRead + cacheWrite` from its usage. A run is excluded when `P < 8000`; all runs here had `P` above 13 000.
- Fork: started by the service's `spawn` with `context: "fork"`, no thinking or tool override, within 60 seconds of the parent's last request (elapsed is measured from that assistant message's timestamp to the fork launch). Elapsed was under 2 s in every run.
- `cacheRead` is the first assistant message of the fork transcript; ratio is `cacheRead / P`.
- Model override row: the fork runs on a different model, so a zero read is expected; it is recorded without a bound.

## Denominators and exclusions

- Denominator: `P` of each run, column above. No run was excluded by `P` or by elapsed time.
- Anthropic: no credential on this machine (`ANTHROPIC_API_KEY` unset; the stored OAuth token in `auth.json` expired long ago), so all three rows are "not run: no credentials". The specification's Anthropic bound is **unverified**.

## Reading the shortfall

Root cause: provider behaviour, not the fork's construction. Two experiments through a throwaway recording proxy in front of 9router (not committed):

1. **Fork vs parent request.** The parent's last request (2 messages: system, user filler; P = 13 549) and the fork's first request (4 messages) were compared as parsed JSON and as raw text. `tools` are equal, every other top-level field is equal (only `prompt_cache_key` is absent in both), and the parent's messages are a strict prefix of the fork's: the first raw difference is at byte 39 804 of 48 343, exactly where the parent's body ends and the fork's synthetic assistant `OK` message begins. Headers: `session_id`, `x-session-affinity` and `x-client-request-id` equal the parent id in both; the fork also sends `session-id`, `x-session-id`, `x-affinity` (the guard's full set, all the parent id).
2. **Does the provider cache a whole prompt?** The same request sent three times on one fresh session id (`prompt_tokens` / `cached_tokens`):
   - 13 596-token prompt: 11 392 on the repeat (gap 2 204, ratio 0.838), with no change on a third send.
   - 23 019-token prompt: 20 864 on the repeat (gap 2 155, ratio 0.906).
   - The parent's own request replayed: first send 0, second 11 392 (gap 2 166).

An **identical** repeat leaves about 2 150 to 2 200 tokens uncached, so the provider (through 9router) caches only up to about `P - 2 150` rounded down to 128-token blocks, whatever the prefix. The fork reads the same 11 392 (0.841) the identical parent request reads: it loses nothing to divergence. The ratio is therefore `1 - ~2 150 / P`, and 0.90 is reached only for `P` of about 21 500 or more on this route. The conditions' `P >= 8000` is too small for this provider; at `P = 13 500` no fork can pass, because even a byte-identical request does not.

Decision for the controller: raise the minimum `P` for the bound (about 25 000 for this route), relax the bound for this provider, or treat the 9router row as a provider limit. No code change is warranted.

## Known gap: Codex

`openai-codex-responses` overwrites `session-id` and `x-client-request-id` after the `before_provider_headers` hook, so a fork on that API keeps its own session id in both SSE and WebSocket requests. The guard rewrites `prompt_cache_key` only where the provider set one. No Codex row was run; cache sharing there is not claimed.
