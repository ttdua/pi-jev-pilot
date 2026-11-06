## Design Summary

**Intent.** WG-07 (main effort) and WG-11 (worker routing) build on host seams that the documentation marks **verify** (`docs/architecture.md#host-seams`) or does not settle at all. WG-02 replaces those assumptions with evidence from real runs before anything is built on them, so that a wrong assumption costs a document edit now rather than a rework of a large work group later. The roadmap says this group may change later groups.

**What it answers.** The eight questions of `docs/roadmap.md#wg-02-host-seam-verification`:

1. Do `input.model` and `input.thinking` mutations in `tool_call` reach the child, for foreground and background launches?
2. Does `message_end` finish before `tool_call` preflight?
3. Can a child's `before_agent_start` remove tools through `selectedTools`, and does the model then lack them?
4. Is `subagents:child:session-created` visible to the extension, in time, with a usable session id?
5. Is a hidden `before_agent_start` message sent to the model and kept across compaction as expected?
6. Does `setThinkingLevel` in `before_agent_start` apply to that same turn's first request?
7. Does a mutated `model` still behave with `inherit_context`, or should it be skipped?
8. How do `thinking_level_change` and the prompt cache behave on `claude-code` in a controlled run?

**What it produces.**

- A reusable host-test harness under `tests/host/`: the real Pi CLI in RPC mode, an isolated `PI_CODING_AGENT_DIR`, the pinned executor, and a loopback provider fixture that records every request Pi sends. WG-07 and WG-11 reuse it, which is why it is kept instead of thrown away.
- Probe extensions, test-only, that exercise each seam. They are fixtures, not package code.
- Host tests for Q1 to Q7 that run in CI and assert on what the provider fixture received.
- A manual, out-of-CI run for Q8 against the real `claude-code` provider.
- One evidence report in `docs/evidence/` with an answer, the run that supports it, and the tested versions for each question.
- Updates to `docs/architecture.md`, `docs/roadmap.md` and any other document that an answer contradicts, including the **verify** markers in the host seams table.

**Goals.**

- Each of the eight questions has an answer from a real run, named by the testing level that supports it (`docs/testing.md`).
- Answers that later groups depend on are protected by host tests, so an upgrade of Pi or the executor that breaks a seam fails CI.
- The documents agree with the evidence when the group ends.

**Non-goals.**

- Any package behavior: no `/jev`, no Jev calls, no decisions, no stores. `src/extension.ts` stays a no-op.
- Verifying a second executor. Only `@gotgenes/pi-subagents` is tested.
- Measuring routing quality, model quality or cost.
- Verifying seams already marked **Documented** unless a probe touches them anyway.

**Anti-goals.**

- Reading source code and calling that an answer. Source reading guides the probes; only a run counts as evidence.
- A harness that only works on the operator's machine. Q1 to Q7 must run in CI with no secrets and no network beyond loopback.
- Any real prompt, secret or session content committed to the public repository.
- Quietly changing later groups. A contradicted assumption is recorded in the report and the documents, with the affected work groups named.

**Constraints.**

- Public Pi APIs only (ADR 0001); probes use the same seams the package will use.
- Tested versions are pinned: Pi `1.5.0` (already a devDependency) and `@gotgenes/pi-subagents` `25.0.5`.
- Q8 sends real requests: a few small ones, run by hand, never in CI.
- The repository's existing checks (`typecheck`, `lint`, `fmt:check`, `test`) keep passing, and the dependency-boundary rules still hold.

## Alternatives Considered

### Alternative A: Loopback HTTP provider fixture recording requests
- **Approach**: The real Pi CLI runs in RPC mode in an isolated agent dir. A custom provider in that dir's `models.json` points at a small HTTP server on `127.0.0.1`. The server records each request body and answers from a script, including `subagent` tool calls that make the main session launch children.
- **Pros**: Exercises the whole path a user's run takes, including serialization of model, thinking, tools and messages. Matches the **Host** level in `docs/testing.md`. Reusable by WG-07, WG-11 and later host tests.
- **Cons**: Needs a small streaming server and scripted responses, so it is more work than the others.
- **Why not chosen**: Chosen.

### Alternative B: `pi-ai` faux provider registered by a test-only extension
- **Approach**: A test extension inside the CLI registers the `pi-ai` faux provider and inspects the `Model` and options it is called with.
- **Pros**: Less code; no HTTP server.
- **Cons**: Sees objects before serialization, not what a provider actually receives. Unclear whether thinking appears as a real provider would get it.
- **Why not chosen**: Stops short of the boundary that Q1, Q3, Q5 and Q6 ask about.

### Alternative C: In-process SDK session
- **Approach**: `createAgentSession` with a faux provider inside the test process.
- **Pros**: Fastest and simplest.
- **Cons**: Skips the CLI and the way the executor creates children in a real run, so it is not a host test.
- **Why not chosen**: Its evidence could not support the claims the later groups need.

## Agreed Approach

Alternative A, chosen by the operator. One harness under `tests/host/` runs the real CLI against a loopback provider that records requests. Q1 to Q7 become host tests on top of it. Q8 is a manual run against the real `claude-code` provider, recorded in the same report.

## Key Decisions

- **Executor**: only `@gotgenes/pi-subagents`, pinned at `25.0.5`, as ADR 0006 chose. The fork installed in the operator's own Pi (`naicoi92/pi-subagents`) is out of scope.
- **Dependency**: `@gotgenes/pi-subagents@25.0.5` is added as an exact-pinned devDependency (operator approved), so host tests are reproducible and CI installs it from the lockfile.
- **Q8**: real calls to `claude-code/claude-haiku-5-5`, a few small requests, run by hand outside CI (operator approved). The provider comes from the `git:github.com/earendil-works/pi-claude-code` package installed into the isolated agent dir for that run, pinned at commit `47f9e2b` (version `0.1.0`), and recorded in the report. It is not a repository dependency.
- **Harness location**: `tests/host/`, kept as reusable infrastructure for WG-07 and WG-11 (operator approved). This makes the group larger than a throwaway probe, which the M size still covers.
- **Provider fixture**: loopback HTTP server recording requests (Alternative A, operator approved).
- **Evidence standard**: each answer cites the run and the testing level. A question that a run cannot settle is reported as unsettled with the reason, never answered from source reading.

## Open Questions

- Whether Q2's answer forces per-call classification instead of batching at `message_end` in WG-11. Settled by the run; the roadmap already allows either.
- Whether Q8 shows thinking changes breaking the prompt cache on `claude-code` enough to change WG-08's provider list. Settled by the run.
- If a probe shows that a seam does not work as documented upstream (Pi or executor), whether to report it upstream. Decided when it happens.
