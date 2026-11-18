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

For `fresh`, the loader runs with project context files enabled for the child's cwd. There is no `systemPromptOverride` and `appendSystemPromptOverride` passes through, so Pi renders its own sections: preamble, tools, rules, docs, addendum (`APPEND_SYSTEM.md`), `<project_context>`, `<skills>` and `<cwd>`.

The agent's part goes into a custom section. An internal child extension handles `before_agent_start` and sets `event.systemPromptOptions.sections.agent = composeAgentSection(header, body)`. Pi renders custom sections after `<cwd>`, so `<agent>…</agent>` is the last section.

- `header` is the `<active_agent name="…"/>` tag plus the env block, which `@gotgenes/pi-permission-system` still parses.
- `body` is the agent body.

**Why a section, not a preamble override.** `systemPromptOverride` replaces only the preamble, which Pi renders before the project context and skills. A forced `systemPrompt` from `before_agent_start` would end exactly with the body, but it is per-turn, unstructured, and replaced by any other extension's override. The section keeps Pi's per-section diffing (cache-stable) and puts the body last. This was decided at Task 3; the spec scenario "Agent body last" was amended to "ends with the `<agent>` section".

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

**System prompt.** The fork's internal extension returns `{ systemPrompt: parentSystemPrompt }` from `before_agent_start` on every run (Pi's forced-prompt projection), so each request's leading system message is the parent's text. *Changed at Task 4:* the planned `systemPromptOverride: () => parentSystemPrompt` does not work on SDK 1.5.0, which treats the override as the preamble and still renders its own `<cwd>` section after it; the fork's system message then differed from the parent's. The fork sets no `systemPromptOverride`.

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

A fork declares exactly the parent's tools and gets no protocol tools. The **callable set** is computed by the existing tool pipeline as if the child were fresh, then intersected with the parent's tools. The pipeline covers declared/expanded tools, policy grants and removals and `disallowed_tools` (Jev tool assessment was removed upstream in #89); the recursion guard is always excluded.

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

## Spike results

Plan task 1. Run against `@earendil-works/pi-coding-agent` 1.5.0 and `pi-ai` 1.5.0 with a local loopback provider (`openai-completions`) and a real probe through the 9router. The probe code was throwaway and is deleted.

**Step 4 runs** (cwd `packages/pi-subagents`, vitest 4.1.12):

- `bun run test test/spike`: 1 file (`fork-probe.test.ts`), 2 tests, 2 passed (declarations + block + header rewrite; payload `prompt_cache_key` rewrite). A first run failed on the header assertion (the handler tried to rewrite existing keys of an empty header object); after switching the handler to set the names, it passed.
- `bun run test test/spike/router-probe`: 1 test passed (9router probe, numbers below).
- `bun run test test/spike/synthetic`: 1 test passed (synthetic tool result, added in fix round 1).

All spike files were deleted before the commit.

### Where the session id reaches the provider

Source: `node_modules/@earendil-works/pi-ai/dist/api/*.js`. `options.sessionId` is the session's own id; `cacheRetention: "none"` drops it.

| API | Headers | Payload | Condition |
| --- | --- | --- | --- |
| `anthropic-messages` | `x-session-affinity` (or `x-session-id` when `compat.sessionAffinityFormat === "openrouter"`) | none (`metadata.user_id` is a separate option, not the session id) | only when `compat.sendSessionAffinityHeaders` (default: OpenRouter only) |
| `openai-completions` | `x-client-request-id` + `x-session-affinity`; plus `session_id` when `sessionAffinityFormat === "openai"`; `x-session-id` only for `openrouter` format | `prompt_cache_key` (clamped) | headers only when `compat.sendSessionAffinityHeaders` (default: OpenRouter only); payload key only when `baseUrl` contains `api.openai.com` and retention is not `none`, or retention is `long` and `compat.supportsLongCacheRetention` |
| `openai-responses` | `x-client-request-id`; `session_id` for `openai` format (the default for non-OpenRouter); `x-session-id` for `openrouter` | `prompt_cache_key` (clamped, unless retention `none`) | headers always when a session id exists |
| `openai-codex-responses` | `session-id` and `x-client-request-id` (SSE); the WebSocket path sets the same two from the request id, which equals the cache session id | `prompt_cache_key` | always when a session id exists; the WebSocket session cache is also keyed by this id |
| `azure-openai-responses`, `mistral-conversations` (not registered here) | Mistral: `x-affinity` | `prompt_cache_key` / `promptCacheKey` | listed for completeness |

Header-name set the D3 handler must cover: `x-session-affinity`, `x-session-id`, `session_id`, `session-id`, `x-client-request-id`, and `x-affinity`. Payload: `prompt_cache_key` (and Mistral's `promptCacheKey`).

### Can the hooks rewrite them

- **`before_provider_headers`.** Pi calls it through `transformHeaders` in `ModelRuntime.prepareRequest`, **before** the provider builds its client. The handler sees only `{}` plus auth/option headers, so there is nothing to rewrite in place: it must **set** the headers. `pi-ai` merges `options.headers` last (`Object.assign(headers, optionsHeaders)`), so the handler's values win over the provider's own session headers. Verified on the wire: a handler that set `session_id`, `x-session-affinity`, `x-client-request-id` and `x-session-id` to the parent id changed every one (fork's own id replaced). Consequence: the handler must set all names unconditionally; where the parent sent none (`sendSessionAffinityHeaders` off), the fork adds harmless extra headers. `null` deletes a header. **`openai-codex-responses` is not covered.** `buildBaseCodexHeaders` applies `options.headers`, but `buildSSEHeaders` then calls `headers.set("session-id", sessionId)` and `headers.set("x-client-request-id", sessionId)` with the fork's own id, overwriting the hook's values (`openai-codex-responses.js:1301-1311`). `buildWebSocketHeaders` does the same with `requestId` (`:1312-1321`), and the WebSocket cache and SSE-fallback state are keyed by `cacheSessionId`. Read from source only; not exercised on the wire. Both Codex transports therefore keep the fork id in `session-id` / `x-client-request-id` with the current hook; the `prompt_cache_key` payload rewrite is the only lever that reaches them (also not verified).
- **`before_provider_request`.** Verified: a handler returning `{ ...payload, prompt_cache_key: parentId }` changed the wire value (`openai-completions`, retention `long`). The handler must only rewrite the key when present, so as not to add it where the parent had none.
- Anthropic puts nothing in the payload, so headers cover it. A provider that derives routing from something other than these fields (e.g. `metadata.user_id`) is not covered.

### Fork mechanics

- **Declarations identical.** A second session built through the real `createAgentSession` with `systemPromptOverride: () => parentPrompt`, `appendSystemPromptOverride: () => []`, `noContextFiles: true` and `tools: parentToolNames` sent a first request whose system messages and `tools` JSON were byte-identical to the parent's last request (`JSON.stringify` equal, tools `read, edit`).
- **`tool_call` block.** A handler returning `{ block: true, reason }` for `edit`, with the scripted model calling `edit`: the tool did not execute (the file was unchanged), the next request carried a tool message with the reason text, and the session's `toolResult` message had `isError: true`.
- **Session id.** A second `SessionManager.create(cwd, dir)` + `newSession({ parentSession })` has its own id (differs from the parent's), with parent branch messages appended via `appendMessage`.
- **Copied completed branch.** In the first probe the fork was built from the parent's already-completed branch (the parent really executed `read`; the fork appended those messages via `appendMessage`). That probe did **not** test a synthetic tool result.
- **Synthetic tool result after a pending call (separate probe, loopback fixture).** The parent ran a turn whose first reply was a `read` call (executed: 1 `toolResult`, content `hello`, `isError: false`). The fork branch was cut at the assistant message holding that call, so the call was pending, and a synthetic `toolResult` (`toolCallId` of the pending call, text `Forked: this branch continues as a subagent.`, `isError: false`) was appended with `appendMessage`, followed by `session.prompt("You are the fork. Continue.")`. The fork's first request had roles `[system, user, assistant, tool, user]`; the `tool` message was `{"content":"Forked: this branch continues as a subagent.","tool_call_id":"call_1"}`; the real result `hello` was absent from the request; the fork replied normally. Command: `bun run test test/spike/synthetic --reporter=verbose --silent=false` (cwd `packages/pi-subagents`), 1 test passed. Only `openai-completions` was exercised.

### SDK API relied on (reuse in Task 4)

- `import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory } from "@earendil-works/pi-coding-agent"`.
- `new DefaultResourceLoader({ cwd, agentDir, settingsManager, noExtensions, noSkills, noPromptTemplates, noThemes, noContextFiles, systemPromptOverride: () => string, appendSystemPromptOverride: () => [], extensionFactories: [{ name, factory }] })`, then `await loader.reload()`.
- `SessionManager.create(cwd, sessionDir)`, `.newSession({ parentSession })`, `.appendMessage(message)`, `.getBranch()` (entries with `type: "message"` carry `.message`), `.getSessionId()`.
- `createAgentSession({ cwd, agentDir, modelRuntime, model, sessionManager, settingsManager, resourceLoader, tools })` then `await session.bindExtensions({})`; `session.prompt(text)`, `session.messages`, `session.sessionId`.
- `ModelRuntime.create({ authPath, modelsPath })`, `.getModel(providerId, modelId)`.
- In an extension factory: `pi.on("tool_call", (ev) => ({ block: true, reason }))` (`ev.toolName`, `ev.input`), `pi.on("before_provider_headers", (ev) => { ev.headers[name] = value })` (mutate in place, return ignored), `pi.on("before_provider_request", (ev) => newPayload)` (return replaces the payload; `undefined` keeps it).
- Message shape of Pi branches is the `AgentMessage` union; usage fields are `input`, `output`, `cacheRead`, `cacheWrite`.

### Real-provider probe (9router, `gpt-6-luna`)

Through a recording pass-through proxy to `http://127.0.0.1:20128` (key read from `~/.pi/agent/9router-config.json`, never printed). The 9router extension registers `openai-completions`; the probe's provider entry set `compat.sendSessionAffinityHeaders: true` and `sessionAffinityFormat: "openai"` because the default (non-OpenRouter) sends none.

| Value | Result |
| --- | --- |
| Parent first turn | 18394 input tokens (P), `cacheRead` 0 |
| Fork first turn, guard active | `input` 2153, `cacheRead` 16256 |
| `cacheRead / P` | **0.884** |
| `session_id`, `x-session-affinity`, `x-client-request-id` received | all equal the parent id: **yes** |
| `prompt_cache_key` in body | absent (9router base URL is not `api.openai.com`) |

The ratio is below 0.90: reported, not a stop condition (Task 7 enforces the bound). Hypothesis, not tested: the shortfall is cache block granularity (`16256 = 127 x 128`) plus the fork's own new user turn and the parent's last assistant text, which sit after the cached prefix. One parent turn with a long system prompt, no tool results; one measurement only.

### Outcome

No stop condition: declarations stay identical, and `{ block: true }` prevents execution. Design impact: (1) D3's `before_provider_headers` handler sets the full header-name set, it cannot "rewrite"; (2) `openai-codex-responses` is a known header-routing gap on **both** SSE and WebSocket: the provider overwrites `session-id` and `x-client-request-id` after the hook, so the full header set does not cover it. Task 4 must not claim Codex cache sharing from the header handler; it needs another mechanism or an explicit documented gap in the evidence document; (3) a provider with default affinity headers off gets extra headers, which is harmless.
