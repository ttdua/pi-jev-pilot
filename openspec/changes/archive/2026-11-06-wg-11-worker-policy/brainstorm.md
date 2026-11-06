## Design Summary

WG-11 (issue #12) routes each `subagent` launch to a model tier and a thinking level chosen from Jev's answers. It ships as two changes. This first change, `wg-11-worker-policy`, builds everything that can be tested without a running Pi host:

- **Agent metadata reader.** For a launch's `subagent_type`, find the agent's details the way the executor does: the project file `.pi/agents/<name>.md`, then the global file `<agentDir>/agents/<name>.md`, then a built-in table for `general-purpose`, `Explore` and `Plan`. It yields what the worker request sends (name, source, description, an instructions excerpt, declared tools, `max_turns`, `run_in_background`) and what later routing needs (`inherit_context` and `locked` from the frontmatter). The agent's own `model` and `thinking` are never sent to Jev.
- **Worker request.** The state and the questions for one launch: the brief (first 4000 characters) and description, the agent block, and the optional parent request (off by default). Questions are `tier` with the `standard` rubric over the configured tiers, `effort` with the worker wording, `risky`, and `expert_needed` only when `tiers.expert` is configured. Wording comes verbatim from `docs/jev-questions.md`.
- **Worker decision.** A pure function from the answers and the configured tiers to a tier, an effort and the rule that decided it, following the decision order in `docs/domain-model.md`.
- **Fallback choice.** A pure function that, given which tiers can run, moves an unusable target down to the next tier that can, never to `expert`. When it moves, the effort becomes `xhigh` on every tier, without the `fast` cap, before the final clamp.

The second change, `wg-11-worker-host`, wires these into Pi: batching at `message_end`, classification at `tool_call` for nested launches, the effective `resume` and `inherit_context` check, the `subagents.forkedLaunch` setting, the registry and credential check, the warning, `locked` and outcome in the ledger, and the live host test. Its checklist is on issue #12.

## Alternatives Considered

### Alternative A: One change for all of WG-11
- **Approach**: Build the reader, request, policy and host wiring together.
- **Pros**: One review, no interface fixed before the host code exists.
- **Cons**: A very large diff mixing pure rules with host seams; the host test needs the policy anyway, so a mistake in policy found in the host test means rework across both layers.
- **Why not chosen**: The operator chose two changes; pure parts are reviewable and testable on their own.

### Alternative B: Policy only, reader and request in change 2
- **Approach**: Change 1 holds only `policy/` decision and effort rules.
- **Pros**: Smallest first change.
- **Cons**: The reader and the request builder have no host dependency either, and the policy's inputs (configured tiers, rubric, answers) are shaped by the questions. Splitting them moves untested shape decisions into the host change.
- **Why not chosen**: The questions and the decision must agree on option names; building them together keeps that contract in one review.

### Alternative C: Include slots and all modes now
- **Approach**: Offer `slot::<name>` options and the `budget` and `premium` rubrics in this change.
- **Pros**: The decision order is written once in its final form.
- **Cons**: Slots and modes are WG-13 and WG-12 on the roadmap, with their own acceptance tests and a replay that needs approval.
- **Why not chosen**: Keeps WG-11 inside its roadmap scope; the decision function takes its slot list and Fable rule as inputs so WG-12 and WG-13 extend it without rewriting it.

## Agreed Approach

Alternative choice: two changes, this one holding the agent reader, the worker request and the pure decision and fallback rules. It fits the architecture's split (`policy/` pure, `jev/` Pi-free, file reading isolated) and leaves the host change with wiring only.

## Key Decisions

- Two changes for WG-11; this is the first, and #12 closes when both are merged.
- `inherit_context` and `locked` are read from the agent file here, because the host change needs effective values: the launch input, else the agent's frontmatter. `locked` follows the executor's rule: `true` locks only fields the file sets; a list locks the named fields.
- Only the `standard` rubric ships here. The decision order runs with the `standard` Fable rule; `budget` and `premium` come with WG-12.
- No slot options here. The slot step of the decision order exists but receives no slots until WG-13.
- `expert` is offered only when `tiers.expert` is configured and the `expert` switch is on; otherwise neither the option nor `expert_needed` is asked.
- An unconfigured tier is never offered. With no tier configured, no `tier` question is asked and the worker keeps its model.
- Fallback moves down the tier ladder to the next tier that can run, never to `expert`. A moved target gets effort `xhigh` on every tier, `fast` included, then clamps to the model. This changes the effort rule in `docs/domain-model.md`.
- A Jev failure yields no decision; the caller leaves the launch unchanged.
- Model display names for rubric prefixes are inputs, so the request builder stays free of Pi imports.

## Open Questions

- None blocking this change. The host change decides how warnings are worded and where the `forkedLaunch` setting is read.
