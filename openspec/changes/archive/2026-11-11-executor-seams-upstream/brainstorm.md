## Design Summary

### Intent

pi-jev-pilot routes every worker launch through `@gotgenes/pi-subagents` (the executor), but it can only reach the executor through seams the executor happens to expose. Several of its features are built on guesses rather than contracts:

- A worker's launch is joined to its child session by matching the session file against `listAgents()[].outputFile`, and to its outcome through `tool_result.details.agentId`.
- Agent definitions are re-read from disk with a parser that mirrors the executor's, plus a hard-coded table of built-in agents that must be checked by hand on every executor upgrade.
- Launches that do not go through the `subagent` tool call (`SubagentsService.spawn()`) are never routed.
- Routing depends on `message_end` finishing before `tool_call` (WG-02 Q2) and on rewriting `event.input`.
- Tool assessment can only remove tools from a child, only for agents that declare no `tools`, and can never grant an extension tool the task needs (ADR 0006 consequence).
- The ledger records the model and thinking jev-pilot asked for, not what the child actually ran after `locked` fields and resolution.

The operator wants these replaced by explicit executor contracts, delivered together, and is willing to own the executor to get them.

### What gets built

**A vendored fork of the executor inside this repository.** `@gotgenes/pi-subagents` is brought into `packages/pi-subagents/` as its own workspace, kept in sync with upstream through `git subtree`. The root package manifest lists both extensions, so one `pi install` of this repository installs jev-pilot and its executor together.

**Six additions to the fork's core**, kept generic (no jev-pilot vocabulary):

1. **Launch identity on lifecycle events.** Child lifecycle and `subagents:*` events carry the agent id, agent type and, when launched from a tool call, the `toolCallId`, so a consumer can join launch, child session and outcome without heuristics.
2. **Effective launch facts.** The executor reports the model and thinking level a child actually runs with, after agent-file `locked` fields and model resolution.
3. **Agent registry query.** The executor service exposes the agent definitions it resolves (built-in, global, project), with the fields jev-pilot reads today, so jev-pilot stops parsing agent files and keeping a built-in table.
4. **Launch policy provider.** An extension can register one provider that the executor consults for every launch, whatever the entry point (tool call or service `spawn`), and that may set model, thinking and tools for that launch.
5. **Tool grant per launch.** Through the launch policy, a launch can be given tools beyond its agent's default set, including extension tools of the parent session, not only have tools removed.
6. **`disallowed_tools` in agent frontmatter.** An agent can name tools it must never have. The executor enforces it against every source of tools, including a policy grant.

**jev-pilot moves onto these seams** and deletes the code that only existed to work around their absence.

### Tool decisions (operator's rule)

For each launch, every candidate tool falls into exactly one group:

```
  agent declares in `tools`        -> always kept      (Jev never asked)
  agent declares in `disallowed_tools` -> never present (Jev never asked)
  everything else                  -> Jev decides: block or add
    (default built-ins the agent did not name,
     extension tools of the parent session)
```

This applies to every agent, including ones that declare `tools`, and is decided at launch time, before the child starts. The tool assessment request therefore changes: Jev is shown the undecided tools and judges each one, which is a new question (the worker `tier` rubric version is unchanged; see design.md D11). "Assessment MUST NOT add a tool" no longer holds.

### Which launches jev-pilot routes (operator's rule)

- Launches started from the main session, by tool call or by service `spawn`, are routed.
- A `spawn` by another extension that names an explicit model keeps that model.
- Launches started from inside a worker (child session) are left alone, as today.

### Goals

- Every worker launch is joined to its child and outcome through identifiers the executor supplies.
- Every main-session launch path is routable.
- Agent facts come from the executor, never from a parallel parser.
- Tool assessment can both grant and block tools within the operator's rule, when enforcement is on.
- The ledger can record effective model and thinking.
- One install gives a working jev-pilot with its executor.

### Non-goals

- Upstream pull requests to `gotgenes/pi-packages`.
- Running jev-pilot's worker features against the original `@gotgenes/pi-subagents`. That support is dropped, along with the code paths that served it.
- Forking `@gotgenes/pi-permission-system` or reading its `permission:` frontmatter.
- Changing how worker difficulty, tiers or main-session decisions are scored. Only tool assessment's question changes.

### Anti-goals

- Seams that leak jev-pilot concepts (tiers, modes, Jev) into the executor.
- A fork so entangled with jev-pilot that a `git subtree pull` from upstream becomes a rewrite.
- Losing fail-open: a policy provider that throws, times out or is slow must not block or fail a launch; the launch proceeds as the agent file defines it.
- Granting a tool an agent author ruled out, or removing a tool an agent author asked for.

### Constraints

- jev-pilot invariants hold: public Pi APIs only, fail open, `policy/` pure, no prompt text, tool arguments or tool output stored.
- The vendored package keeps its own toolchain (upstream uses pnpm, vitest, biome, eslint) and its own test command; jev-pilot keeps Bun. CI runs both.
- The fork's MIT license and upstream attribution are recorded in `NOTICE.md`.
- Both packages are public; their content is in English.
- If the original `@gotgenes/pi-subagents` is also installed, two `subagent` tools collide. This must be detected and reported in `/jev`, not silently tolerated.

### Existing requirements this change alters

- `agent-metadata`: lookup order, case-insensitive match, finding files by listing, the built-in table, identity fields, declared tools, launch fields and lock declaration describe reading agent files directly. They are replaced by reading the fork's registry; `disallowed_tools` is added. Locked-field and effective-launch-field logic may stay as pure functions over registry data.
- `child-registry`: child ids still come from `subagents:child:session-created`, which now also carries launch identity.
- `host-test-harness` ("Pinned executor"): the pinned devDependency `@gotgenes/pi-subagents@25.0.5` is replaced by the vendored workspace.
- `readiness-checks` ("Executor presence"): a tool named `subagent` is no longer enough; presence means the vendored executor, and a duplicate `subagent` provider is a reported problem.
- `package-loading`: the manifest lists two extensions; the peer dependencies grow to include what the executor needs (`@earendil-works/pi-ai`, `@earendil-works/pi-tui`); the handler set shrinks where the policy provider replaces `message_end`, `tool_call` and child `before_agent_start` handlers.
- `host-seam-evidence`: Q1 (input mutation), Q2 (`message_end` ordering) and Q3 (tool removal via `selectedTools`) describe seams the policy provider supersedes. Their tests and the evidence report are updated or retired.
- `decision-ledger`: worker lines may gain effective model and thinking; tool counts gain granted tools.
- Tool assessment rules in `docs/` and its spec: "MUST NOT add a tool" and "only agents without `tools`" are replaced by the operator's rule above.

ADR 0006 ("Use `@gotgenes/pi-subagents` as the executor", "No fork to maintain") is superseded by a new ADR recording the vendored fork and its maintenance cost.

## Alternatives Considered

### Alternative A: Vendored fork in this repository, all seams in its core (chosen)
- **Approach**: `git subtree` the executor into `packages/pi-subagents/`, add the seams to its core, ship both extensions from one package. No upstream pull requests.
- **Pros**: Fastest path to every seam. One change, one repository, one install. Seam and consumer land and are tested together. No dependence on upstream's ADR 0002 limit on provider seams.
- **Cons**: The operator merges upstream indefinitely, and the fork drifts. Two toolchains in one repository. Users of the original executor must switch.
- **Why chosen**: The operator prefers owning the executor to waiting on upstream, and wants it in this repository.

### Alternative B: Separate fork repository, upstream pull requests for the additive seams
- **Approach**: Fork to its own repository (`ttdua/pi-subagents`), install it separately, propose seams 1–3 upstream.
- **Pros**: Drift shrinks as upstream accepts additive seams; executor stays independently installable.
- **Cons**: Two repositories, two releases, cross-repository verification; upstream timing outside the operator's control.
- **Why not chosen**: The operator chose not to spend effort on upstream and to keep everything in this repository.

### Alternative C: Upstream-first, no fork in use
- **Approach**: Fork only to open pull requests; adopt seams once upstream releases them.
- **Pros**: No fork to maintain; keeps ADR 0006.
- **Cons**: Seam 4 conflicts with upstream ADR 0002 ("provider seams are rationed", "no vacant hooks"); seams 5–6 conflict with upstream moving tool policy to `@gotgenes/pi-permission-system`. Likely partial delivery.
- **Why not chosen**: Set aside by the operator once these conflicts surfaced.

## Agreed Approach

Alternative A. The executor is vendored into `packages/pi-subagents/` and carries all six additions in its core. The root manifest ships both extensions. jev-pilot requires this executor for worker features, routes every main-session launch through the launch policy provider, decides undecided tools with Jev under the operator's rule, and removes the heuristics and fallbacks that served the original executor.

## Key Decisions

- **Fork, no upstream pull requests** (operator).
- **All seams in one change** (operator).
- **Fork lives in this repository** at `packages/pi-subagents/`, its own workspace, both extensions in the root manifest, one `pi install` (operator).
- **No fallback to the original executor** (operator).
- **Tool grant in the fork's core** (operator), not in `@gotgenes/pi-permission-system`.
- **`disallowed_tools` added back to agent frontmatter** in the fork (operator).
- **Tool rule** (operator): declared `tools` always kept, `disallowed_tools` never present, Jev decides block or add for the rest; every agent; at launch.
- **Tool assessment gains a grant question** with candidates from the parent session's tools, bounded (operator). The operator also approved raising the rubric version; design found that version only covers the worker `tier` wording and gates the cut-point window, so it is left unchanged (see design.md D11).
- **Launch scope** (operator): main-session tool calls and spawns; another extension's explicit model kept; child-originated launches untouched.
- **Upstream sync by `git subtree`** (my call): keeps upstream history and needs no second repository.
- **Main-session features stay usable alone** (my call): if the executor fails to load, worker features are off with a note in `/jev`, as today without an executor.
- **Duplicate executor detected** (my call): both the original and the vendored executor installed is reported in `/jev`.
- **Seams stay generic** (my call): no jev-pilot vocabulary in the fork.
- **Change name kept** (my call): the change stays `executor-seams-upstream` although no upstream work is planned; renaming it buys nothing.

## Open Questions

- Which upstream version the vendored fork starts from (jev-pilot pins `25.0.5` today) and the merge cadence.
- Whether the fork keeps the `Symbol.for("@gotgenes/pi-subagents:service")` key and event names, or renames them. Keeping them eases merges; renaming avoids silent mixing with the original.
- How the policy provider orders against agent-file `locked` fields and the caller's own `model`/`thinking`, and its time bound.
- The bound on grant candidates (count, which parent tools are eligible) and how a granted extension tool is loaded in the child, since the executor today loads extension tools only when named in `tools`.
- Whether effective launch fields join the existing worker ledger line or a new line kind.
- How CI runs the vendored package's toolchain alongside Bun.
