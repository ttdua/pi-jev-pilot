## Context

The repository holds a no-op extension (`src/extension.ts`), unit-level tests under `tests/`, and a `package loading` test that installs the checkout into a temporary `PI_CODING_AGENT_DIR` with `pi install` and loads it with `DefaultResourceLoader`. Pi `1.5.0` is a pinned devDependency and its CLI is at `node_modules/.bin/pi`. Nothing yet starts a Pi session, talks to a provider, or runs the executor.

The executor, `@gotgenes/pi-subagents` `25.0.5`, ships TypeScript sources with a `pi.extensions` entry, so `pi install` from `node_modules` can load it like any package. Reading its source shows where each seam lives (`resolveAgentInvocationConfig` for caller parameters and `locked`, `subagents:child:session-created` emitted synchronously before `bindExtensions`), which guides the probes but does not count as an answer.

Pi's documentation gives the relevant hook ordering: `tool_call` waits for earlier agent events to drain, and sibling calls are preflighted sequentially. `before_agent_start` may edit `systemPromptOptions.selectedTools`, which updates both prompt and executable tools. Questions 1 to 7 need a run to confirm these in combination with the executor. Question 8 needs a real provider.

## Goals / Non-Goals

**Goals:**
- One harness that any later host test can use to start the real CLI with chosen extensions, script the model's replies, and read back what each provider request contained.
- One host test per WG-02 question 1 to 7, each asserting on recorded provider requests or on probe-recorded events, never on source reading.
- A repeatable manual procedure for question 8, with its results recorded.
- An evidence report, and documents brought into agreement with it.

**Non-Goals:**
- Any package behavior in `src/`.
- Testing a second executor or a second Pi version.
- Testing providers other than the fixture and, for question 8, `claude-code`.

## Decisions

### D1. Recording provider: a loopback OpenAI-compatible HTTP server

A Bun HTTP server on `127.0.0.1`, port 0, implements `POST /v1/chat/completions` with streaming SSE. The isolated agent dir's `models.json` declares a provider `fixture` with `api: "openai-completions"`, `baseUrl` pointing at the server, a dummy `apiKey`, `thinkingFormat: "openai"`, and models whose ids name tiers (for example `fixture-main`, `fixture-balanced`, `fixture-fast`), each with `reasoning: true`.

- **Why OpenAI completions:** the simplest well-documented streaming format Pi already supports; `reasoning_effort`, `model`, `tools` and `messages` appear as plain top-level fields in the request body, which is exactly what the questions ask about.
- **Why tier-named models:** a child's request then names its model directly, so question 1 reads the answer from the `model` field.
- **Alternatives:** the `pi-ai` faux provider and an in-process SDK session were rejected in the brainstorm because they stop before serialization.

The server records every request body, with the arrival order and a session hint. It answers from a script: an ordered list of replies, each either text or one or more tool calls. A reply can be chosen by a matcher on the request (for example, "the first request whose `model` is `fixture-fast`") so main and child sessions, which run concurrently, each get the right reply.

### D2. Session driver: Pi CLI in RPC mode

The harness spawns `node_modules/.bin/pi --mode rpc` with `PI_CODING_AGENT_DIR` set to a fresh temporary dir, `PI_OFFLINE=1`, a temporary cwd, and `--no-session` unless a test needs persistence (question 5 does, for compaction). It writes JSONL commands (`prompt`, `set_thinking_level`, `compact`, `get_state`) and reads events until the run settles.

- **Why RPC over print mode:** RPC exposes `compact` and state queries and does not depend on a terminal, so it covers every question with one driver.
- **Why the CLI binary rather than the SDK:** host tests must prove the path a user's run takes (`docs/testing.md`).

### D3. Installing extensions into the isolated agent dir

Each test's agent dir is prepared with `pi install` for the executor (from `node_modules/@gotgenes/pi-subagents`) and for the probe extension the test needs, as `tests/load.test.ts` already does for the checkout. Agent definitions the tests launch are written as files into the agent dir, so their frontmatter (`model`, `thinking`, `locked`, `tools`) is under test control.

### D4. Probe extensions report through a side file

Each probe is a small extension under `tests/host/probes/` using only public APIs. Probes that must observe something not visible in provider requests (event arrival, handler order, session ids) append JSON lines to a file whose path comes from an environment variable set by the harness. Tests read that file after the run.

- **Why a file:** the probe runs inside the CLI process; a file is the simplest channel back to the test that does not depend on RPC internals.
- **Privacy:** probes write only identifiers, event names, counters and timestamps, never prompt text.

### D5. What each question's test asserts

| Q | Setup | Evidence read |
|---|---|---|
| 1 | Probe's `tool_call` handler rewrites `model` and `thinking` on a `subagent` call; one foreground and one background launch | Child's first request `model` and `reasoning_effort` |
| 2 | Probe's async `message_end` handler records start and end; `tool_call` records its start; reply contains two sibling `subagent` calls | Probe log ordering |
| 3 | Probe's child `before_agent_start` removes a tool from `selectedTools` | Child's first request `tools` list lacks it; a scripted call to it fails |
| 4 | Probe subscribes to `subagents:child:session-created` and records the id; child's `session_start` records `getSessionId()` | Ids match; subscription fired before the child's first handler |
| 5 | Probe returns a `display: false` message from `before_agent_start`; then `compact` | Message in the next request; presence or absence after compaction |
| 6 | Probe calls `setThinkingLevel` in `before_agent_start` | `reasoning_effort` on that turn's first request |
| 7 | Same as 1 with `inherit_context: true` | Child request `model`, and whether the parent conversation is present and well-formed |

An answer can be "no". A test then asserts the observed behavior and the report says so; a negative answer is not a test failure.

### D6. Question 8 is a script, not a test

`tests/host/manual/q8-claude-code.ts` (excluded from `bun test` by name and location) prepares an isolated agent dir, installs `git:github.com/earendil-works/pi-claude-code` at commit `47f9e2b`, and runs a short scripted session on `claude-code/claude-haiku-5-5`: a few turns at one thinking level, a change of level, then more turns. It records per turn the thinking level, `thinking_level_change` and related events, and the usage fields (`cacheRead`, `cacheWrite`, input tokens) from `get_session_stats` or message usage. It prints an aggregate only; prompts are fixed synthetic text.

- **Why outside CI:** it needs the operator's `claude-code` login and costs quota.
- **Why a script in the repository:** the run must be repeatable on upgrades, per the version policy.

### D7. Test placement and speed

Host tests live in `tests/host/*.test.ts` and run under the existing `bun run test`, so CI covers them with no new script. Each test owns its temporary dirs and server and cleans them up. Timeouts are generous (tens of seconds) because each test starts a CLI process.

### D8. Evidence report shape

`docs/evidence/2026-11-05-host-seams.md` (date set when written): a table of the eight questions with answer, supporting test or run, testing level and tested versions; then one short section per question with what was observed, and the documents and work groups it affects. It contains no prompts, session content or account details.

## Risks / Trade-offs

- [The executor may not load from `node_modules` through `pi install`] → Fall back to installing from a packed tarball of the pinned version; both are public install paths.
- [Concurrent main and child requests make scripted replies ambiguous] → Match replies on request content (model id, presence of a marker in the system prompt) instead of global order.
- [OpenAI completions may serialize thinking differently from Anthropic-style providers] → The questions ask whether a level reaches the provider; the report states the field observed and that other providers map it differently. Question 8 covers one real provider.
- [Compaction in question 5 calls the model for a summary] → The fixture scripts a summary reply; the test identifies that request by its shape.
- [Host tests slow CI] → Accepted; they are the point of the group. Keep one CLI start per question where possible.
- [A negative answer could invalidate WG-07 or WG-11 as designed] → Intended outcome of the group: the report names the affected groups and the documents are updated before those groups start.
- [Question 8 results depend on the operator's account and the day] → Report them as a single controlled run with its date and versions, not as a general rule.

## Migration Plan

None. Nothing is deployed and no package behavior changes. Rolling back means removing `tests/host/` and the devDependency.

## Open Questions

- Whether `get_session_stats` or per-message usage gives cache figures per turn on `claude-code`; settled when the Q8 script is written.
