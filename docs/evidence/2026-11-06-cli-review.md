# Evidence: CLI review, 2026-11-06

One manual run of [WG-15](../roadmap.md#wg-15-cli-review)'s `runReview` against the operator's real Codex and OpenCode CLIs, through `bun tests/host/manual/cli-review-real.ts`. Counts only: no brief, prompt, review text, account or provider details.

**Read with care:** this is one controlled operator run, not a general rule. The fake-CLI host tests in `tests/host/cli-review.test.ts` are the repeatable evidence; this run shows that the command lines the package builds are accepted by the real CLIs at these versions.

Versions: Codex CLI 0.159.0, OpenCode 2.2.5, Bun-spawned `Exec` mirroring Pi 1.5.0's `pi.exec` (no stdin, timeout, output cap).

| CLI | Model | Outcome | Attempts | Exit code | Output length |
|---|---|---|---|---|---|
| Codex | CLI default (operator's config) | `ok` | 1 | 0 | 218 |
| OpenCode | `9router/gpt-6-luna` (`JEV_REVIEW_OPENCODE_MODEL`) | `ok` | 1 | 0 | 237 |

The brief was a fixed "Review the last commit." on a throwaway repository with one small committed change. Both outputs ended with a verdict line.

## What the earlier attempts showed

Before the operator fixed their local CLI configuration, the same script reported `exit-error`, attempt 1, exit code 1, for both CLIs: an invalid provider key for Codex, and a provider URL using the wrong scheme for OpenCode. The package reported each as "did not run" with the exit code, did not retry, and did not switch reviewer, as specified. No package change was needed.
