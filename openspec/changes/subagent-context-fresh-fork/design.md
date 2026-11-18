## Context

The vendored executor (`packages/pi-subagents`) builds every child the same way.

**System prompt.** `buildAgentPrompt` (`session/prompts.ts`) composes:

- the parent identity (ADR 0006/0008/0011), and project context when the cwd differs (ADR 0010);
- the `<active_agent>` header, then the agent body, which is wrapped in `<agent_instructions>` for `append`.

The loader runs with `noContextFiles: true` and `systemPromptOverride: () => cfg.systemPrompt` (`lifecycle/create-subagent-session.ts`).

**History.** `inherit_context` makes `buildParentContext` (`session/context.ts`) render the parent branch as text. `SubagentSession` prepends that text to the first prompt.

**Facts read by the jev root.** The jev root reads `inheritContext` from:

- the launch request (`seams/launch-request.ts`, mapped in `src/policy/launch.ts`);
- the agent snapshot (`seams/registry.ts`, `src/host/platform/agents.ts`).

Routing keys forked launches on `subagents.forkedLaunch` (`src/policy/worker/route.ts`).

**SDK facts this design relies on** (Pi in `~/.bun/install/global/node_modules/@earendil-works/pi-coding-agent`):

- `SessionManager.inMemory(cwd, options, entries)` loads preloaded entries, header included. The agent's `sessionId` is `sessionManager.getSessionId()` (`sdk.js`), which providers use as `prompt_cache_key` / `x-session-affinity` / the Anthropic session header (`pi-ai`).
- The `systemPromptOverride(base)` callback receives the base prompt the loader built for the session.
- A `tool_call` extension handler returning `{ block: true, reason }` stops the call before it runs.
- `before_provider_headers` and `before_provider_request` let an extension adjust headers or the payload.
- tintinweb 0.25 `mention-clone.ts` already clones a live parent conversation with `SessionManager.inMemory` plus a prompt override.

## Goals / Non-Goals

**Goals:**

- One resolved `ContextMode = "fresh" | "fork"` per launch, carried end to end:
  - in the executor: tool call, frontmatter, service, launch request, registry snapshot, record, display;
  - in the jev root: launch mapping, routing, settings.
- A fresh prompt that is Pi's own child-session prompt, followed by the agent body.
- A fork whose first provider request starts byte-for-byte like the parent's last request: the same system prompt, tool declarations, messages and session id.
- Deprecation shims for one minor release.

**Non-Goals:**

- Per-agent toggles for fresh prompt parts.
- Forking from a parent that runs in another process (only in-process parents are cloned).
- Cache warming or TTL management.
- Changing resume: a resumed child keeps its own history, as today.

## Decisions

### D1. `ContextMode` replaces `promptMode` and `inheritContext`

The resolved setting is one field, `context`, typed `ContextMode`:

- on `AgentConfig`;
- on the invocation config;
- on `LaunchRequest`, which feeds the policy request;
- on the agent snapshot;
- on the record's invocation.

**Resolution in `config/invocation-config.ts`:**

1. A locked agent value wins.
2. Then the call's `context`.
3. Then the call's deprecated `inherit_context` (`true` → `fork`, `false` → `fresh`).
4. Then the agent's `context`.
5. Otherwise `fresh`.

**Source of the value.** The resolver also returns where the value came from, `call` or `agent`, because the fork fallback differs by source (D5).

**Frontmatter (`config/custom-agents.ts`).**

- `context` is read from frontmatter.
- `inherit_context` maps to `context` with a deprecation warning.
- `prompt_mode` is ignored with a deprecation warning.

The warnings are debug-noted once per agent file per load, using the existing `debugNote` path, so they reach the user without changing any API.

*Alternative:* keep `inheritContext` internally and only rename at the edges. It was rejected because the label, routing and fallback all need the resolved value under one name, and two names for one fact is the bug being fixed.

### D2. Fresh prompt: let Pi build the child-session prompt

For `fresh`, the loader runs with project context files enabled for the child's cwd. The override is `systemPromptOverride: (base) => base + "\n\n" + header + "\n\n" + body`:

- `base` is the prompt Pi assembled for the child session: tools, guidelines, context files, skills catalog and footer.
- `header` is the `<active_agent name="…"/>` tag plus the env block, which `@gotgenes/pi-permission-system` still parses.
- `body` is the agent body.

`appendSystemPromptOverride` stays `() => []`, so `APPEND_SYSTEM.md` is not double-applied.

**Code removed:**

- the inherited-identity machinery (`adoptedIdentity`, `inheritedIdentity`, `ownProjectContext`, the portable strategy plumbing);
- `genericBase`.

**Code kept:** `ProjectContextLoader` is no longer used by the prompt builder. `session/project-context.ts` is deleted if nothing else uses it.

*Alternative:* keep cutting the parent prompt. It was rejected per the brainstorm: the fresh child must not carry the parent's identity.

### D3. Fork: an in-memory clone of the parent's live branch

`lifecycle/fork-session.ts` (new) builds the fork. Its inputs come from the parent snapshot (`lifecycle/parent-snapshot.ts`):

- the parent's branch entries, root to leaf, header included;
- the parent's effective system prompt and active tool names;
- the parent's model and thinking.

`parentContext` (the text) is removed from the snapshot.

**Session.** The fork gets a persisted session manager with its **own** session id, created as today (`newSession({ parentSession })`). The copied entries are appended to it. That id is the fork's lifecycle id: transcript file, record, `subagents:child:*` events and the child registry. The parent is therefore never recorded as a child, and parallel forks never share a file.

The entries are copied from the parent's live branch, not from the session file, because Pi delays persisting until the first assistant message.

**Cache-routing key.** The provider sees the parent's session id. A handler in the fork's internal extension does this, depending on the provider:

- `before_provider_headers` rewrites the session headers (`x-session-id`, `session_id`, `x-session-affinity`, the Anthropic session header) to the parent's id;
- `before_provider_request` rewrites `prompt_cache_key` in the payload.

The spike (plan task 1) confirms which fields each `pi-ai` provider sends.

**System prompt.** `systemPromptOverride: () => parentSystemPrompt`, unchanged. Context files and extension prompt sections stay as Pi builds them, but the override returns the parent text.

**Tools.** The parent's tool names are the session's `tools`.

**Model and thinking.** The parent's model and thinking are used, after D6 precedence.

**Pending tool calls.** The parent's leaf is an assistant message whose `subagent` call, and possibly other tool calls in the same message, are still pending. The fork appends:

1. A tool result for every pending call, of any tool, with the fixed text `Forked: this branch continues as a subagent.` The text is identical for every fork from that turn, so parallel forks share the prefix up to and including it.
2. A user message:

   ```
   <subagent_instructions>
   <active_agent name="…"/>
   Working directory: <child cwd>
   <agent body>
   You are a forked subagent. Do the task below and reply with the result. You cannot start subagents.
   </subagent_instructions>

   <task>
   ```

   The working-directory line overrides the parent's cwd for an isolated child.

*Alternative:* fork from the session file (`SessionManager.forkFrom`). It was rejected because the file lags the live branch.

### D4. Call-time tool refusal in a fork

A fork declares exactly the parent's tools and gets no protocol tools. The **callable set** is computed by the existing tool pipeline as if the child were fresh, then intersected with the parent's tools. The pipeline covers declared/expanded tools, policy grants and removals, enforced assessment and `disallowed_tools`; the recursion guard is always excluded.

An internal extension factory, added like the existing protocol tools, registers a `tool_call` handler that returns `{ block: true, reason }` for any tool outside the callable set. Run facts count the callable set as active tools, and every other declared tool as blocked.

The refusal text is `Tool "<name>" is not available to this subagent.`

**Tools only the agent has.** These are not added to the declarations. Adding one would change the tool list and break the cache. They are named in the instructions block as unavailable, and the docs say so.

*Alternative:* send the agent's own tool list. It was rejected because it loses the cache on every provider that puts tools in the prefix.

### D5. Fallback and failure

A fork needs a parent with at least one branch entry and a live session manager.

| Context source | No parent session | Outcome |
| --- | --- | --- |
| Call (`context: "fork"`, or deprecated `inherit_context: true`) | yes | The launch fails before any child session is created, with `Cannot fork: the parent has no session to fork from.` |
| Agent file (locked or not) | yes | The launch runs `fresh`. The record carries `contextFallback: "no-parent-session"`, and the inline result and widget line show the tag `fork → fresh` in the context-label position. |

**Service launches.** These have no tool call, so `spawn(…, { context: "fork" })` counts as a call source.

### D6. Fork model and thinking precedence

For a fork:

1. A locked agent value wins.
2. Then the launch policy's adjustment, which is already bounded by locks. This is the existing "policy replaces requested" rule.
3. Then the call's `model` / `thinking`.
4. Otherwise the parent's current model and thinking.

The requested value handed to the policy is the locked agent value, otherwise the call's value, otherwise the parent's.

An unlocked agent default is ignored. `resolveInvocationModel` gains a fork branch.

**Policy adjustment.** The jev root's `forkLaunch: untouched` returns no adjustment, so the parent's values stand. `forkLaunch: thinking` writes thinking, which is a documented possible cache miss.

### D7. Display reads the run's context

`getPromptModeLabel(type)` becomes `getContextLabel(context)`, which returns `"fork"` for `fork` and `undefined` for `fresh`.

Callers that take the label from the record or invocation, not the registry:

- `tools/spawn-config.ts`;
- `ui/widget-renderer.ts`;
- `ui/session-navigation.ts`.

`buildInvocationTags` drops `inherit context`. The `modeLabel` field keeps its name and position, so run-fact ordering is otherwise unchanged. `twin` disappears from code, tests and docs.

### D8. jev root rename

`subagents.forkLaunch` replaces `subagents.forkedLaunch` in:

- config, settings and defaults;
- `ForkedLaunch` → `ForkLaunch`.

**Old key.** The validator accepts `subagents.forkedLaunch` as a deprecated alias when `forkLaunch` is absent. It returns the value under `forkLaunch`, plus a deprecation notice that `/jev` status shows; the config read result gains an optional `notices` list for this. When both keys are present, the whole read is invalid with a problem at `subagents.forkedLaunch`, consistent with "invalid config returns no value".

**Routing.** It keys on `launch.context === "fork"` instead of `inheritContext`. Values, default (`untouched`) and routing semantics are unchanged.

**Review tool in a fork.** `ChildSessionCreatedEvent` gains `context`. The jev root's child registry records it, and `hideReviewInChild` (`src/host/wiring/turn.ts`) skips forks, so the fork's tool list stays the parent's. The existing child check in `jev_review`'s `execute` still refuses the call, and no process runs.

### D9. Decision record

`packages/pi-subagents/docs/decisions/0014-subagent-context-is-fresh-or-fork.md`:

- supersedes 0008;
- marks 0006, 0009, 0010 and 0011 as superseded for fresh children, since no parent prompt is inherited;
- states the fork prompt rule (byte-identical parent prompt).

`VENDORED.md` lists the change as a local divergence from upstream.

## Risks / Trade-offs

- [A provider sends its cache key somewhere the rewrite handler does not cover] → The spike lists the fields per provider. A missed field degrades only multi-upstream routing, and the evidence run catches it.
- [Parent tool declarations include tools whose extensions are not loaded in the child (foreground children do not load ambient extensions)] → A declared tool without an implementation is refused by D4 (it is not in the allowlist), or returns Pi's "not found". The tool list stays identical, so the cache holds.
- [An extension in the child rewrites `systemPrompt` in `before_agent_start`] → This breaks the cache. It is documented, not enforced.
- [Fresh children lose the shared identity prefix (ADR 0008), so local-model users see more prompt processing per fresh child] → This is accepted per the brainstorm. Users who want context reuse should use `fork`.
- [Signed thinking blocks sent to another model] → Pi already converts thinking to text when the model differs, so no special handling is needed. The docs note that the parent's reasoning reaches the other provider.
- [Fork of a very long parent conversation exceeds a smaller child model's window] → Only possible with a model override. The provider error surfaces as a normal run failure; no truncation is added.
- [Users keep `prompt_mode` / `inherit_context` past the deprecation window] → Warnings name the replacement. Removal lands in the next minor release with a changelog entry.

## Migration Plan

1. Release N:
   - `context` is added and `fresh` becomes the default;
   - the old fields work with warnings;
   - `forkedLaunch` is read as an alias;
   - the CHANGELOG has a migration section.
2. Release N+1: the aliases are removed.
3. Rollback: revert the change. Agent files written with `context` are then ignored by the old reader, which defaults to the old behaviour.

## Open Questions

- The spike (plan task 1) lists, per `pi-ai` provider API, where the session id reaches the provider (headers, `prompt_cache_key`, other payload fields). It confirms that the D3 rewrite handlers cover each one. A field the extension hooks cannot reach is recorded as a known gap in the evidence document.
