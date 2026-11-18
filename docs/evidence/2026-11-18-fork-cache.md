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

`P - cacheRead` is about 2 150 tokens in every run, whatever `P` is (the spike's 18 394-token parent left 2 153 uncached). The fork's tail after the shared prefix (synthetic tool result, `<subagent_instructions>` message, task, the parent's last assistant text) plus cache block granularity (128 tokens) stays uncached. Hypothesis, not tested: the tail is roughly constant, so the ratio rises with `P`. Escalated rather than tuned: raise the minimum parent size in the conditions, relax the bound for this provider, or shorten the fork's own tail.

## Known gap: Codex

`openai-codex-responses` overwrites `session-id` and `x-client-request-id` after the `before_provider_headers` hook, so a fork on that API keeps its own session id in both SSE and WebSocket requests. The guard rewrites `prompt_cache_key` only where the provider set one. No Codex row was run; cache sharing there is not claimed.
