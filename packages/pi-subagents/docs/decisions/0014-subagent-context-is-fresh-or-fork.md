---
status: accepted
date: 2026-11-18
---

# 0014 — A subagent's context is fresh or fork

## Status

Accepted.
Supersedes [ADR 0008].
Amends [ADR 0006], [ADR 0009], [ADR 0010] and [ADR 0011]: their rules stand as history, but no longer describe any child, because a child no longer inherits part of the parent's prompt.

## Context

Until now a child was built one way: a cut of the parent's system prompt (the "identity"), the agent body appended after it, and, with `inherit_context`, the parent conversation rendered as text in the first prompt.
Two settings described one fact: `prompt_mode` (`append` or `replace`) and `inherit_context`.
The inherited cut was the source of most of the prompt machinery: identity truncation, a portable strategy, directory-resolved project context and session-resolved tool sections ([ADR 0006] to [ADR 0011]).
It bought little: the shared prefix was worthless on hosts whose cache covers the tool definitions, and a child never had the parent's tool list.

## Decision

One setting, `context`, with two values and no mixed state.

- **`fresh`** (default): the child is a new session. Pi builds the child's own system prompt: its preamble, tools, rules, project context, skills and working directory. The agent's part is the last section, `<agent>…</agent>`, added by an internal child extension in `before_agent_start`. The child sees no parent identity and no parent conversation.
- **`fork`**: the child is an in-memory clone of the parent's live branch.
  - The child's first provider request starts like the parent's last one: the same system prompt (forced through `before_agent_start`), the same tool declarations, the same messages, and the parent's session id sent to the provider as the cache-routing key.
  - Every tool call still pending in the parent's last message gets a fixed result, then a `<subagent_instructions>` user message carries the agent header, the working directory, the body and the task.
  - The fork keeps its own session id for its transcript, record and events.

Rules that follow:

- **Resolution:** locked agent value, then the call's `context`, then the call's deprecated `inherit_context`, then the agent's `context`, then `fresh`.
- **Tools in a fork:** the declarations are the parent's, unchanged. The tools the agent may call are the fresh callable set intersected with the parent's tools; any other call is refused at call time with `Tool "<name>" is not available to this subagent.` A fork cannot start subagents. Tools only the agent has are not added (that would change the declarations); the instructions block names them as unavailable.
- **Model and thinking:** locked agent value, then the launch policy, then the call, then the parent's. An unlocked agent default is ignored.
- **Fallback:** an explicit `fork` from a call fails when the parent has no session. A `fork` that came from an agent file runs `fresh` and is labelled `fork → fresh`.
- **jev root:** `subagents.forkLaunch` replaces `subagents.forkedLaunch` (the old key is read as a deprecated alias) and routing keys on the launch's `context`.
- **Deprecations, one minor release:** `prompt_mode` is ignored with a warning; `inherit_context` (tool parameter, frontmatter, `locked`) and the service option `inheritContext` map to `context` with a warning.

## Consequences

- The inherited-identity machinery, the portable strategy and the text parent context are deleted.
- The cache holds for a fork only under conditions the [evidence](../../../../docs/evidence/2026-11-18-fork-cache.md) records: the same model, a parent of at least 25 000 tokens, and a provider whose cache floor (about 2 150 tokens on the measured route) leaves a high ratio. A fork on `openai-codex-responses` is a known gap: the provider overwrites the session headers after the hook.
- A fresh child loses the shared identity prefix, so local-inference users see more prompt processing per fresh child; `fork` is the option when the context is worth reusing.
- An extension in the child that rewrites the system prompt in `before_agent_start` breaks a fork's cache. This is documented, not enforced.

[ADR 0006]: 0006-inherited-prompt-is-identity-only.md
[ADR 0008]: 0008-inherited-region-is-shared-parts.md
[ADR 0009]: 0009-portable-inheritance-is-provider-scoped.md
[ADR 0010]: 0010-project-context-is-directory-resolved.md
[ADR 0011]: 0011-tool-surface-sections-are-session-resolved.md
