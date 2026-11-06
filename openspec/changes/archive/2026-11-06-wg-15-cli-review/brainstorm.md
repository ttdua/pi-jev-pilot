## Design Summary

WG-15 adds feature F4: an on-demand code review by the operator's own Codex or OpenCode CLI, run read-only with that CLI's own login. The operator asks for it in words ("have Codex review this"); the main model then calls the `jev_review` tool with a brief. The extension runs the CLI itself, with no relaying agent, and hands back the findings and verdict, or a clear "the review did not run" with the exit code and error tail.

The operator sets a default reviewer, model and effort with `/jev cli-review <codex|opencode> [model] [effort]`, kept in `state.json`; `config.json` stays untouched. A Codex model can be named by tier (`sol`, `terra`, `luna`, `astra`, ...), meaning the newest model of that tier when the review runs, or by full id, which pins it. The command checks the model and effort against the CLI's own model list and suggests correct names when they are wrong.

Why: the operator wants a second opinion from a different vendor's agent on demand, without a relay agent's token cost, and without the classifier or routing being involved. The upstream package (Akramovic1/jev-pilot) has this feature; the earlier Pi port (naicoi92/pi-jev-pilot) excluded it.

**Goals**
- `jev_review` tool in the main session only; absent in child sessions.
- Codex and OpenCode, each run read-only through its current CLI (Codex CLI 0.159, OpenCode 2.2.5).
- `/jev cli-review` with tier names, full ids, `default` to clear, and validation with suggestions.
- 10-minute timeout, one retry on timeout only; no fallback to the other reviewer.
- Tests with a fake CLI covering success, failure and timeout; one real run with the operator's CLI.

**Non-goals**
- Automatic reviews, review gates, or reviews the operator did not ask for.
- ACP or any long-lived protocol session with the CLI; streaming progress.
- A relay subagent (upstream's approach).
- Switching to the other reviewer on failure.
- Hard sandboxing of OpenCode beyond its `plan` agent.

**Anti-goals**
- The review must never edit the repository on its own initiative.
- A broken or missing CLI must never break the session; it only makes the tool say the review did not run.
- No prompt text, brief or CLI output stored in the ledger or any file of ours.

## Alternatives Considered

### Alternative A: ACP (Agent Client Protocol) over stdio
- **Approach**: Start `opencode acp` and a Codex ACP adapter as child processes and drive one session over JSON-RPC.
- **Pros**: Progress updates, per-permission decisions, model and effort set through config options.
- **Cons**: Codex has no built-in ACP; needs the external `@agentclientprotocol/codex-acp` adapter installed. Needs a new dependency (`@agentclientprotocol/sdk`) or a hand-written client. `pi.exec` has no stdin, so the package must spawn processes itself, leaving a documented seam. Permission requests only reach the client for `ask` rules, so it does not make OpenCode's `plan` agent stricter.
- **Why not chosen**: Large cost for features the issue does not need.

### Alternative B: Relay subagent, as upstream
- **Approach**: Register a small model agent with only Bash that writes the brief to a temp file and runs the CLI in a shell heredoc.
- **Pros**: Proven upstream; stdin available through the shell.
- **Cons**: An extra model and its tokens per review; the shell command is prompt text a model must reproduce exactly; harder to test deterministically. Upstream's OpenCode flags (`--variant`, `--dir`) no longer exist.
- **Why not chosen**: The docs already decided on no relaying agent; the direct path is cheaper and testable.

### Alternative C: Direct one-shot run through `pi.exec`, brief in argv
- **Approach**: The tool builds the argument list and runs the CLI once through `pi.exec`, with the instructions and brief as one argument. Codex writes its last message to a temp file with `-o`.
- **Pros**: No dependency, no relay, keeps the documented `pi.exec` seam, deterministic tests with a fake CLI.
- **Cons**: The brief is visible in the local process list while the review runs; no progress updates.
- **Chosen.**

## Agreed Approach

Alternative C, chosen by the operator. It meets every goal with the smallest surface, matches the architecture's "no relaying agent" decision, and keeps the CLI review independent of Jev.

## Key Decisions

Decisions 1–4 were made by the operator during exploration; decision 5 is the agent's call from the CLI evidence, confirmed at this gate:

1. **Transport**: `pi.exec` with the instructions and brief as an argument for both CLIs; Codex returns its result through `-o <temp file>`. Replaces the stdin form in `docs/workflow.md`.
2. **OpenCode read-only**: keep `--agent plan`; document that this agent denies edits but still allows shell commands, so read-only rests on the instructions.
3. **Codex model choice**: both forms. A tier name is stored as the tier and resolved to the newest model of that tier (by the version numbers in its id) each time the review runs; a full id is pinned.
4. **Validation**: `/jev cli-review` checks the model, and the effort where the CLI lists them, against the CLI's model list. Wrong names get suggestions. If the list cannot be read, the command accepts the value as typed, with a warning.
5. **OpenCode command for v2.2.5**: `--variant` and `--dir` are gone; effort rides on the model as `provider/model#variant`, and the directory is the process working directory. An effort without a model cannot be expressed and is refused by `/jev cli-review opencode`.

## Open Questions

None blocking. Details left to the design: how the tool stays absent in children, the shape of the tool result, how the effort is validated for OpenCode, and the temp-file lifecycle.
