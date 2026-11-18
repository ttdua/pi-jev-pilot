## Design Summary

Tracked in issue #88.

**Intent.** A subagent's starting context is set by two overlapping knobs today, `prompt_mode` (`replace` | `append`) and `inherit_context` (boolean). Neither does what its name says:

- `replace` still puts the parent's identity first.
- `inherit_context` pastes a lossy text rendering of the parent conversation into the first user message, under the child's own system prompt, so the provider prompt cache misses on the whole history.

The goal is one axis with names that match behaviour, plus a fork cheap enough to use routinely because it reuses the parent's prompt cache.

**What the user gets.** One setting, `context`, with two values:

- **`fresh` (default).** A clean child:
  - system prompt: the prompt Pi builds for the child's own session (its tools, the project instructions for its own working directory, its skills catalog), followed by the agent's body;
  - no parent identity and no parent conversation;
  - the first message is the task.
- **`fork`.** The child continues the parent's conversation as it really is:
  - the same messages, tool calls and tool results;
  - the same system prompt, tool declarations and model as the parent.

  The agent's instructions and the task arrive as the child's next message. Its first turn reads the inherited history from the parent's prompt cache, and parallel forks share that cache.

**Where it is set.**

- On the `subagent` tool call, as `context`.
- In an agent file's frontmatter, as the agent's default. The agent file can lock it.
- Resolution order: call, then agent file, then `fresh`.

**Goals.**

- Fresh is the default for every launch that does not ask for fork.
- A fork's first turn is served from the parent's prompt cache on providers that cache by prefix (Anthropic, OpenAI-compatible).
- Parallel forks from one parent turn share one cache entry.
- A fork's tool limits still hold: a tool the agent may not use is refused when called. Removing it from the declarations would break the cache.
- Names line up across the stack:
  - the `subagent` tool, agent frontmatter and the pi-subagents service API (`spawn(..., { context })`);
  - the jev root setting: `subagents.forkedLaunch` becomes `subagents.forkLaunch`.
- **Every display shows the run's context the same way.** A fork run shows `fork`; a fresh run may show nothing. The name `twin` is removed everywhere, along with the separate `inherit context` tag. This covers:
  - the running and finished lines in the agent widget;
  - the tool-call and tool-result stats;
  - the session navigator heading;
  - run facts.
- The label describes **the run**, not the agent type. An agent whose file defaults to fork but was launched fresh shows no `fork` label, and vice versa. Today `twin` is read from the agent type, which would be wrong once the context is chosen per launch.

**Non-goals.**

- Changing what the parent sees of a child: results, run facts and transcripts stay as they are.
- Per-agent switches for project instructions or skills in fresh mode (pi.dev's `inheritProjectContext` / `inheritSkills`). Fresh always gets the full child-session prompt.
- Nested forks: a fork may not start another fork.

**Anti-goals.**

- A fork that runs but misses the cache on the same model. This counts as a failure even if the output is correct.
- A tool-restricted agent that can run a forbidden tool because it is forked.
- An explicit fork request that silently turns into fresh.

**Constraints.**

- Existing user agent files and callers using `prompt_mode` / `inherit_context` keep loading for one minor release. They get a deprecation warning:
  - `inherit_context: true` acts as `context: fork`, `false` as `fresh`;
  - `prompt_mode` is ignored.
  - The same applies to the service API option `inheritContext`, which maps to `context`.
- The old config key `subagents.forkedLaunch` is still read for one minor release, with a warning.
- Fork needs a parent session to clone:
  - an explicit `context: "fork"` with no parent session fails before launch with a clear error. A deprecated `inherit_context: true` on the call counts as explicit;
  - a `fork` that comes from an agent file, locked or not, falls back to fresh. The fallback is recorded as a notice in the run facts, never silently.
- A fork that uses a different model than its parent still works, but is documented as a cache miss.
- **A fork's model and thinking.** A fork uses the parent's model and thinking. A model or thinking passed on the call wins (a known cache miss). An agent file's model or thinking wins only when the file locks it; an unlocked default is ignored for a fork. `subagents.forkLaunch: thinking` keeps working as an explicit opt-in, documented as a possible cache miss.
- **A fork's tools.**
  - Its declarations are the parent's.
  - A tool the agent's file does not allow is refused when called.
  - A tool only the agent has (not the parent) is unavailable in a fork; this is documented.
  - The `subagent` tool stays declared, but every call to it is refused, which keeps today's rule that children do not spawn children.
- **A fork in another directory.** A fork whose working directory differs from the parent's (for example an isolated worktree) is allowed. Its instructions message states the child's real directory, which overrides the parent's directory named in the inherited prompt.
- **Specified requirements this change alters** (each changes in a delta, none silently):
  - `subagent-run-facts`: the stats labels `twin` and `inherit context` become a single `fork` label.
  - `config-file`, `settings-resolution`, `worker-routing`, `worker-decision`, `worker-ledger`: `subagents.forkedLaunch` is renamed `subagents.forkLaunch`. Values and routing meaning are unchanged.
  - `agent-metadata`, `executor-agent-registry`, `executor-launch-policy`: the launch field `inheritContext` becomes `context` (`fresh` | `fork`).
  - `host-seam-evidence`: the probe for `inherit_context: true` becomes a probe for a fork, and gains the cache-reuse evidence below.
  - `tool-assessment`: "forked launches carry the brief without the inherited context". The behaviour is unchanged; only the wording changes.

**Evidence of success.**

- A fork's first provider request has the parent's system prompt and tool list unchanged. This is checked by an automated test against a fixture provider.
- Its `usage.cacheRead` is at least 90% of the parent's last-request input. This is measured on real Anthropic and one OpenAI-compatible provider, and recorded as an evidence document under `docs/evidence/`.
- Two parallel forks show comparable cache reads.
- A fresh child's prompt contains no parent identity and no parent conversation.

## Alternatives Considered

### Alternative A: Rename only (`context` replaces `inherit_context`, keep `prompt_mode`)
- **Approach**: Swap the boolean for `context: fresh | fork` and keep today's mechanics: the text-rendered history, and the parent identity prefix in both prompt modes.
- **Pros**:
  - Smallest change.
  - Keeps the shared identity prefix from ADR 0008.
- **Cons**:
  - "Fork" would still not be a fork: no tool results, a different system prompt, and no cache on the history.
  - Two knobs remain.
- **Why not chosen**: The names would promise something the behaviour does not deliver, which is the problem this change exists to fix.

### Alternative B: Fresh as a bare prompt (agent body and environment only)
- **Approach**: As agreed for fork, but fresh carries only the agent body and an environment header, with no Pi base prompt, project instructions or skills. This is tintinweb's `replace` mode.
- **Pros**:
  - The cleanest possible prompt.
  - The agent author controls every byte.
- **Cons**:
  - Children lose the project's AGENTS.md rules and the skills catalog, so every agent file must restate them.
  - It diverges from Claude Code, which still loads CLAUDE.md into fresh subagents.
- **Why not chosen**: The user picked the child-session prompt so that fresh children still follow project rules.

### Alternative C: Keep both knobs, add a third "real fork" mode
- **Approach**: Leave `prompt_mode` and `inherit_context` as they are, and add `fork: true` for the real fork.
- **Pros**:
  - No breaking change.
- **Cons**:
  - Three interacting settings.
  - Most combinations are meaningless.
  - The UI and the jev routing policy must model all of them.
- **Why not chosen**: It deepens the confusion the change is meant to remove.

## Agreed Approach

One axis, `context: fresh | fork`, with fresh as the default:

- **Fresh** uses the prompt Pi builds for the child's own session, plus the agent body (the user's choice over Alternative B).
- **Fork** clones the parent's real conversation and reuses its system prompt, tool declarations and model, so the prompt cache carries over.

Prior art agrees: Claude Code and pi.dev's `pi-subagents` both converged on these two names and this split. This approach won over A because only a real fork delivers what "fork" means, and over C because a single axis is what makes the names line up across the stack.

## Key Decisions

- The setting is called `context`, and its values are `fresh` and `fork` (user).
- Fresh is the default everywhere (user).
- A fresh child's system prompt is the child-session prompt Pi builds, plus the agent body (user, option 1).
- A fork inherits the real conversation, system prompt, tool declarations and model from the parent. The agent's instructions travel in the task message (user, agreed with issue #88).
- The pi-subagents service API renames `inheritContext` to `context`, with the same one-minor deprecation (user, option 1).
- Displays show `fork` for a fork run and nothing for a fresh run; `twin` and the `inherit context` tag are removed. The label comes from the run, not the agent type (user).
- Model/thinking precedence, tool handling and fallback rules for forks, as listed under Constraints (my calls from the builder check).
- A forked agent's tool limits are enforced by refusing calls, not by changing the declarations (agreed with issue #88).
- Parallel forks spawned in one parent turn must share the cache up to their own instructions (agreed with issue #88).
- An explicit fork with no parent session fails; a default fork falls back to fresh (agreed with issue #88).
- A fork cannot spawn a fork (agreed with issue #88).
- `prompt_mode`, `inherit_context` and `subagents.forkedLaunch` stay readable for one minor release with deprecation warnings, then are removed (agreed with issue #88).
- `subagents.forkLaunch` keeps today's values and default (`untouched`). Left alone, a fork stays on the parent's model, which the cache needs (my call, consistent with the cache goal).
- The shared parent identity prefix for every child (ADR 0008) is retired. A new decision record supersedes it (my call, required because fresh no longer carries the parent identity).

## Open Questions

- Can a child session send the parent's session id as its provider cache key, so that routers with several upstreams keep it on the same cache? Today Pi derives the key from the child's own session. A spike decides this before the implementation design is fixed. If it is not possible, forks on Anthropic still hit the cache, and the gap on routed OpenAI-compatible endpoints is documented.
- What should the parent's pending `subagent` tool call look like inside the fork? It needs a tool result that is identical for every fork from the same turn. The exact text is left to design.
