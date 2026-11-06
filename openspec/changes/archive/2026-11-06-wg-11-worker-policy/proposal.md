## Why

Worker routing (WG-11, issue #12) is the largest work group and mixes pure rules with host seams. Building the parts that need no running Pi first (reading agent details, building the worker request, the decision order and the fallback choice) lets them be reviewed and table-tested alone, and leaves the second change, `wg-11-worker-host`, with wiring only.

## What Changes

- Add an agent metadata reader that finds a launch's agent the way the executor does: project file, global file, then a built-in table for `general-purpose`, `Explore` and `Plan`. It also reads `inherit_context` and `locked` so the host change can use effective values.
- Add the worker request: state (brief, description, agent block, optional parent request) and questions (`tier` with the `standard` rubric over configured tiers, `effort` with worker wording, `risky`, and `expert_needed` when `expert` is offered).
- Add the pure worker decision: the decision order from the domain model, producing a tier, a requested effort and the deciding rule.
- Add the pure fallback choice: move an unusable target down to the next tier that can run, never to `expert`.

**Fallback effort**
- From: effort after fallback follows the ordinary rules (choice, risk floor, `xhigh` ceiling, `medium` cap on `fast`).
- To: a target moved by fallback gets effort `xhigh` on every tier, `fast` included, before clamping.
- Reason: operator decision 2026-11-06; a weaker model than intended should reason as hard as it can.
- Impact: non-breaking; nothing routes workers yet.

Docs updated: `docs/domain-model.md` (fallback effort, availability order), `docs/jev-contract.md` (worker state field rules), `docs/architecture.md` (module layout), `docs/roadmap.md` (WG-11 split into two changes, pre-launch tier cascade moved from WG-13 to WG-11).

## Capabilities

### New Capabilities
- `agent-metadata`: finding a launch's agent and reading the fields routing and the worker request need, including effective `inherit_context`, `resume` and `locked`.
- `worker-request`: the state and questions of one worker request to Jev, and how its answers are read.
- `worker-decision`: the decision order, the worker effort rules and the fallback choice, as pure functions.

### Modified Capabilities
- None. The ledger and transport specs are unchanged; worker ledger lines are written by the host change.

## Impact

- New code: `src/host/agents.ts`, `src/jev/rubrics.ts`, `src/jev/questions.ts`, `src/jev/state.ts`, `src/policy/tier.ts`, `src/policy/effort.ts`, `src/policy/launch.ts`, with unit tests.
- No change to Pi wiring, `config.json`, `state.json` or the ledger. No new dependency.
- Nothing calls the new code until `wg-11-worker-host`.
