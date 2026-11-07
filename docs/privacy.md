# Privacy

## What leaves your machine

To TypeSafe, on every eligible prompt and launch:

| Sent | Details | Turn it off |
|---|---|---|
| Your prompt | Whole text | `/jev all off` |
| Recent conversation | Up to 4 messages, 2000 characters; text and tool names | Part of the same switch |
| Facts about the request | Counts and flags computed locally | Part of the same switch |
| Project platforms | Names inferred from file names, such as `Docker` | `/jev skills off` |
| Skill catalog | Each skill's name, description, first 300 code points of the body | `/jev skills off` |
| Your previous decision | Effort level and strategy of the last turn | `/jev all off` |
| Tools and agents available | Each tool's name and the first sentence of its description; each agent's name, description up to 200 characters, and tool names; no model or thinking | `/jev all off` |
| Worker briefs | First 4000 characters | `/jev subagents off` |
| Agent details | Name, description, first 500 characters of instructions, tool names | `/jev subagents off` |
| Slot details | Model id and your `when` text | Remove the slot |
| Tool descriptions | For workers under assessment | `/jev tools off` |
| Your latest prompt with worker requests | Up to 500 characters; **off by default** | `state.parentRequest` |

**Never sent:** tool arguments and results, file contents, diffs, thinking blocks, images, your API keys, the full transcript, an agent's `model` or `thinking`.

> [!WARNING]
> Prompts and briefs are sent as written. **There is no secret redaction.** A secret you type into a prompt goes to TypeSafe.

TypeSafe states that Jev is not trained on customer requests or responses. See its [data handling notes](https://docs.typesafe.ai/models.md) and legal documents.

## Other destinations

- **Your selected models** receive the injected skills and advice as part of normal Pi requests, and workers go to whichever provider the routed model uses. **A routed worker can reach a different provider than your main model**, including a slot such as `9router/gpt-6.1-sol`, so its brief and files it reads go there. Only configure models you trust with your code.
- **CLI reviews** run `codex` or `opencode` on your machine, with your own login, read-only. They read your code and talk to their own providers. They run only when you ask, and only after you turn the CLI review on. Note:
  - The instructions and your brief are passed as a command-line argument, so they are visible in the local process list while a review runs.
  - Read-only rests on the review instructions for OpenCode: its `plan` agent denies edits but allows shell commands. Codex runs in a read-only sandbox.
  - OpenCode keeps the prompt in its own session history. Codex runs with `--ephemeral`, so it keeps no session files.
  - This package stores nothing of the brief or the output. The Codex output file is a temporary file, removed after each run.

## What is stored locally

`<agentDir>/jev/ledger.jsonl` and `ledger.1.jsonl`, owner-readable only, at least the latest 2000 lines (at most about 4000):

- Labels, numbers and outcomes: levels, probabilities, tier, model id, agent name, token counts, durations.
- **Never** prompt text, briefs, tool arguments or output.

With `verbose` on, the same labels and numbers as the ledger are also saved as `jev-log` entries in your Pi session files, which travel with session exports.

Hidden skill and advice messages are saved in your Pi session files, as any context is. A skill message holds the skill's own text (its body, or only its path for `suggest`), and its details hold the skill name, a SHA-256 of the body and the form. No prompt text.

`<agentDir>/jev/replay/<run-id>/`, written only when you run the replay tool by hand with `--send` (see [Testing](testing.md#rich-state-replay)): private and owner-only. It holds counts and the prompts and briefs of differing pairs. It never leaves your machine unless you copy it; delete it after the decision.

Delete the ledger at any time (both files); nothing depends on it except tuning signals.

## Credentials

The TypeSafe key is read from the environment at call time. It is never written to config, the ledger, logs or the conversation.
