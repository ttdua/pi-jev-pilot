## Design Summary

A service caller can ask a child for a typed result instead of free text. `SpawnOptions.resultSchema` carries a JSON Schema (draft 2020-12 subset: `type` object, array, string, number, integer, boolean; `enum`, `properties`, `items`, `required`, `additionalProperties`). When it is set, the child gets one more protocol tool, `submit_result`, next to `ask_parent` and `notify_parent`.

- **Intent**: callers that need a contract (status, commits, sources, findings) stop parsing prose or fenced YAML and stop sending the child back after it has already finished. A malformed result is caught in the child while it can still fix it.
- **Who**: extensions spawning through `SubagentsService.spawn()` (jev-pilot's own executor flows and third-party callers). The `subagent` tool parameter and agent frontmatter are not touched.
- **Behaviour**:
  - `submit_result` validates its argument against the schema in the child. Invalid → the tool returns the validation errors and the run continues so the child can retry. Valid → the value is stored as `record.structuredResult` and the run ends after the current turn.
  - A run that ends without a valid submission settles with `structuredResult` absent and `structuredResultError: "missing"` (never called) or `"invalid"` (called, never valid). The free-text `result` is kept as today in every case.
  - `subagents:completed` and the `SubagentRecord` snapshot carry `structuredResult` / `structuredResultError` when present.
  - The schema belongs to the launch and applies to every run of the record. Each run starts with both fields cleared. A run that ends with a pending `ask_parent` question gets no `"missing"`: it has not finished; the resume that answers it is the run that must submit.
  - `submit_result` is part of the launch contract: `disallowed_tools` and launch-policy removals cannot remove it, and it is never offered to a policy as a grant.
  - A schema outside the supported subset, or a schema on a launch that resolves to `fork`, makes `spawn` throw before anything starts.

### Existing requirements involved

- `executor-launch-policy` / "Launch request given to the policy": `parentTools` excludes the executor's own tools (`ask_parent`, `notify_parent`, …). **Altered**: the list gains `submit_result`.
- `subagent-context-mode` / "Fork tool limits" (a fork adds no protocol tools) and "One context setting per launch" (invalid `spawn` options throw). Unchanged; the fork refusal follows from them and is stated as a new requirement.
- `subagent-run-facts` / "Tool count fact", "Every tool the child lacks is blocked": protocol tools count as the child's own tools. Unchanged; `submit_result` counts like `ask_parent` when installed.
- `launch-metadata` / "Metadata on record events and snapshots": the pattern followed for new additive record fields. Unchanged.

### Goals

- Typed child results for service launches, validated in the child.
- Zero change for launches without a schema: same tools, same counts, same events.

### Non-goals

- Schemas declared in agent frontmatter.
- A `resultSchema` parameter on the `subagent` tool.
- Structured results for `fork` launches (see Open Questions).
- Full JSON Schema support (`$ref`, `oneOf`, formats, numeric/string bounds).

### Anti-goals

- A fork's tool declarations changing, which would break its prompt-cache sharing.
- A launch without a schema seeing any new tool or field.
- The free-text `result` being replaced or dropped.

## Alternatives Considered

### Alternative A: Parse the final free-text answer after the run
- **Approach**: the caller (or the executor) extracts a fenced JSON/YAML block from `result` and validates it once the child has finished.
- **Pros**: no new tool; works for forks.
- **Cons**: errors are found after the child stops, so fixing them needs a resume round-trip; extraction from prose is fragile.
- **Why not chosen**: it is exactly the problem the issue describes.

### Alternative B: Final-turn constrained output (provider structured output / JSON mode)
- **Approach**: force the child's last response into the schema through provider response-format features.
- **Pros**: no tool call; the model cannot answer off-schema on supporting providers.
- **Cons**: provider-specific, not exposed through public Pi APIs, and the run cannot both answer in prose and in JSON.
- **Why not chosen**: violates the public-Pi-APIs invariant and is not portable across providers.

### Alternative C: Declare `submit_result` on the parent too, block it at call time (fork-compatible)
- **Approach**: keep tool lists identical between parent and fork by declaring `submit_result` everywhere and refusing it where no schema applies.
- **Pros**: structured results for forks without breaking the cache.
- **Cons**: changes every parent session's tool list and every launch's tool count; widens scope a lot.
- **Why not chosen**: out of scope; kept as the path if fork support is wanted later.

## Agreed Approach

A child protocol tool `submit_result`, installed only on `fresh` launches that pass `resultSchema` (issue #86 proposal plus the fork rule from its comment). Validation happens in the tool so the child sees errors while it can still fix them, and the outcome is recorded per run on the record. Chosen over A and B because it is the only approach that catches errors before the child finishes using public Pi APIs only; C is deferred.

## Key Decisions

- **Per-run outcome, schema per launch** (user approved): every run of the record (initial and resumes) is bound by the schema; each run clears `structuredResult` and `structuredResultError` at its start; a run ending on a pending `ask_parent` question records no error.
- **Fork + schema is refused** at `spawn` with an error naming `resultSchema` and `fork` (issue comment).
- **Unsupported schema keywords are refused** at `spawn`, not ignored, so a caller never believes a constraint is enforced when it is not (proposal by agent).
- **`submit_result` cannot be removed or granted**: immune to `disallowed_tools` and policy `removeTools`; excluded from the policy's `parentTools`.
- **Free-text `result` is unchanged** whether or not a structured result exists.
- **Service-only**: no tool parameter, no frontmatter field.

## Open Questions

- Fork support via Alternative C, if structured results for forks are wanted later (separate issue).
- Whether the jev-pilot side (`src/`) should consume `structuredResult` in its own flows: not part of this change.
