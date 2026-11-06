# Retrospective: wg-11-worker-policy

## Wins

- All 84 scenarios map to tests named after them; 457 tests pass (baseline 356).
- Executor parity for agent lookup and frontmatter parsing was checked against `@gotgenes/pi-subagents` 25.0.5 source, not assumed.
- Internal spec and plan reviews caught real defects before code: path traversal through `subagent_type`, an `expert` choice slipping through when only `expert` is configured, and a usable `expert` being dropped by fallback.

## Misses

- Tasks 1 and 4 have no stub-first RED run; the tests assert concrete values, so the risk is low.
- The first docs pass left forked-launch text that contradicted the roadmap decision; one fix round was needed.

## Plan deviations

- `LOCKABLE_FIELDS` added to `policy/launch.ts` so `host/agents.ts` does not repeat the lockable-field list.
- `WireQuestion` declared once in `jev/rubrics.ts`, replacing an identical `RubricQuestion`.
- Four docs passages about forked launches (`domain-model.md`, `jev-contract.md`, `usage-guide.md`, `workflow.md`) were deferred to `wg-11-worker-host`, because they describe runtime behaviour this change does not implement.

## Skill/workflow compliance

- Subagent-driven development with one implementer and one reviewer per task, a final whole-branch review and one fix wave.
- The worktree's `node_modules` was incomplete at first; `bun install` was needed before tests could run.

## Surprises

- The executor resolves case-insensitive agent names in map insertion order (built-ins first), not in file precedence order.
- `parseFrontmatter` trims the body only when frontmatter is present.
- Strict `openspec validate` rejects requirements longer than 500 characters, which forced smaller, single-behaviour requirements.

## Promote candidates

- `wg-11-worker-host` tasks must include the four deferred docs passages.
- WG-13: guard the `choice.choice as TierName` cast in `src/policy/tier.ts` once `slot::` options exist.
