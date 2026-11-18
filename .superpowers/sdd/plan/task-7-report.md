# Task 7 report

Status: BLOCKED (tests DONE; the 0.90 cache bound FAILS on the only provider that could be run).

Commits: 0cc3e210 `test: host and cache evidence for fresh and fork contexts`; 9ffbe16e `docs(evidence): fork cache run`.

## Tests added
- `tests/host/launch-policy-evidence.test.ts`: "Inherited context with a policy model" now forks with `context: "fork"` after a real `read` (marker is inside a `role: "tool"` message); new "Untouched fork keeps the parent prefix" (system message and `tools` JSON equal the parent's last request byte-for-byte, same model).
- `tests/host/context-mode.test.ts` (new, 6): fresh child has neither parent-prompt marker nor conversation marker; "Fork before the parent has persisted" (`--no-session`, no transcript file exists); two forks share the prefix up to the synthetic result, own session ids and transcript files; read-only fork `edit` refused, file unchanged; fork `jev_review` declared and refused, fake codex never ran; fork before the parent's first turn.
- `tests/host/tool-assessment.test.ts` (+3): "Observe in a fork", "Enforce in a fork", "Resumed fork keeps refusals" (one assessment request in total).
- `tests/host/probes/policy/index.ts`: `/probe-spawn` reads `JEV_SPAWN_CONTEXT` and `JEV_SPAWN_MODEL`, and records `spawn:error` instead of throwing (test support).
- The tests exercise behaviour from Tasks 2-6, so they passed on first run; no RED phase exists for them. Two failed first for test-side reasons (a probe that did not fork; `tool` content is a string).

## Deviation: "explicit fork from an empty parent fails with the fixed message"
Not reachable through a real Pi session: Pi writes a model-change entry at startup, so a real parent's branch is never empty. The refusal stays covered by `subagent-manager.test.ts` ("Cannot fork: the parent has no session..."). The host test instead shows a fork before the parent's first turn works from the startup entries.

## Evidence run
Command and table are in `docs/evidence/2026-11-18-fork-cache.md`. Ratios (`9router/gpt-6-luna`, P about 13 550, elapsed under 2.3 s; four runs, same shape):
- one fork 0.841; parallel forks 0.841 / 0.850; override 0 (no bound).
- Result: included same-model rows FAIL the 0.90 bound. Not lowered, not tuned.
- Anthropic: not run: no credentials (stored OAuth token expired; no `ANTHROPIC_API_KEY`).
- Codex: known gap documented.
- Uncached tail is about 2 150 tokens regardless of P (spike: 2 153 at P 18 394); hypothesis: constant tail plus 128-token blocks.

## Files
`scripts/fork-cache-evidence.ts` (own mini RPC driver: scripts may not import from `tests/`), `docs/evidence/2026-11-18-fork-cache.md`, the three test files and the probe above.

## Checks
`bun test` 2708 pass; `bun run typecheck`, `bun run lint` clean; `bun run test:executor` 2430 pass.

## Concerns
- Bound failure needs a decision: larger minimum P, a looser bound, or a shorter fork tail.
- Anthropic bound unverified; needs credentials.

## Root cause (follow-up)
Provider behaviour, not a fork defect. No code changed.
- Proxy capture (parent last request vs fork first request): `tools` and all non-message fields equal; parent messages are a strict prefix of the fork's; first raw byte difference is at the end of the parent body (offset 39 804), where the fork's synthetic assistant message starts. Headers: same session id in `session_id`, `x-session-affinity`, `x-client-request-id`; the fork adds `session-id`, `x-session-id`, `x-affinity`, all the parent id.
- Identical-request repeat: P 13 596 gives cached 11 392 (gap 2 204); P 23 019 gives 20 864 (gap 2 155, ratio 0.906); the parent request replayed gives 0 then 11 392. So an identical request leaves about 2 150 uncached; the fork matches that exactly (0.841).
- Ratio is about `1 - 2150 / P`; 0.90 needs P of about 21 500 or more on 9router. Bound is unreachable at P 13 500 for any request on this route.
Doc updated: `docs/evidence/2026-11-18-fork-cache.md` ("Reading the shortfall"). The evidence script was not changed.

## Evidence rerun
Status: DONE. Script updated (`scripts/fork-cache-evidence.ts`): minimum P 25000, filler 90 000 chars, recording proxy plus unchanged resend for the provider floor, `--anthropic-route` optional unbounded row, no ANTHROPIC_API_KEY; isolated env now also passes USER/LOGNAME/SHELL (the Claude Code CLI needs them for its keychain login; first claude-code attempt timed out without them).
Run (`9router/gpt-6-luna`, override `gpt-6-sol`, route `claude-code/claude-haiku-5-5`), P about 27 686: one fork 0.920 (25472), parallel 0.925 / 0.920, override 0 (no bound). Floor: identical resend cacheRead 25472, P - cacheRead 2214. Claude Code route row: P 52093, cacheRead 51747, 0.993, no bound. An earlier run gave 0.920 for all included rows. Result PASS. Anthropic API not measured. Doc rewritten; typecheck, lint, bun test green (see commit).
