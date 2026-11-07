# Configuration reference

## Files

All under `<agentDir>/jev/`, by default `~/.pi/agent/jev/`.

| File | Written by | Holds |
|---|---|---|
| `config.json` | You, and `/jev` for slots | Settings below |
| `state.json` | `/jev` | Switches, mode, CLI review default |
| `tuning.json` | Automatic tuning | Applied changes and history |
| `ledger.jsonl` | The package | Decisions and outcomes |
| `ledger.1.jsonl` | The package | The previous ledger segment |
| `ledger.rotate.lock` | The package | Present only during a rotation |

Precedence for a value: `tuning.json`, then `state.json`, then `config.json`, then the default.

The directory is created with mode `0700` and new files with `0600`. Writes go to a temporary file in the same directory and are renamed over the target, so a reader sees the old file or the new one. The ledger is the exception: it appends lines instead of replacing the file. An existing `config.json` keeps its mode.

### Missing and malformed files

| Case | Result |
|---|---|
| No `config.json` | Defaults apply |
| Unknown key in `config.json` | An error naming the key by path, such as `crew.slotz` |
| Malformed or unreadable `config.json` | The package is inert, with every problem listed by field path. The file is never overwritten |
| No `state.json` | Defaults apply |
| Malformed `state.json` | Defaults apply. The problem is reported to `/jev` for display. On the next change the bad file moves to `state.json.bad` (mode `0600`, replacing any earlier one) and a fresh file is written |
| Unreadable `state.json` | Defaults apply. The file is left alone and changes are refused until it can be read |

Error messages name the field and what was expected, never the value found, so a secret pasted into the wrong key stays out of logs. A `state.json` is valid or rejected whole: nothing is salvaged from a partly valid file.

## Full example

```json
{
  "classifier": {
    "url": "https://api.typesafe.ai/v1/systemone",
    "model": "jev-latest",
    "apiKeyEnv": "TYPESAFE_API_KEY",
    "timeoutMs": 1500
  },
  "tiers": {
    "fast": "claude-code/claude-haiku-5-5",
    "balanced": "claude-code/claude-sonnet-5-5",
    "deep": "claude-code/claude-opus-5-5",
    "expert": "claude-code/claude-fable-5-1"
  },
  "crew": {
    "slots": [
      {
        "name": "reviewer",
        "model": "9router/gpt-6.1-sol",
        "when": "Choose when the task is to review, audit or verify existing work and report findings without changing it: a diff, a pull request, a plan, a spec or a completed task, from a small re-review to a whole-branch review. Not for implementing, fixing or researching."
      }
    ]
  },
  "effort": { "holdProviders": ["9router"] },
  "skills": { "inject": "content" },
  "subagents": { "forkedLaunch": "untouched" },
  "tools": { "mode": "observe" },
  "state": { "parentRequest": false },
  "review": { "cli": "codex" }
}
```

## Settings

### `classifier`

| Key | Default | Notes |
|---|---|---|
| `url` | `https://api.typesafe.ai/v1/systemone` | HTTPS, or HTTP only to loopback (`localhost`, an address in `127.0.0.0/8`, `[::1]`). No username or password. Redirects are rejected |
| `model` | `jev-latest` | `^[A-Za-z0-9._-]{1,64}$`. Pin a version with `jev-1.14.0` |
| `apiKeyEnv` | `TYPESAFE_API_KEY` | The variable's name, `^[A-Z_][A-Z0-9_]{0,63}$`, so a pasted key is rejected. Never put the key in this file |
| `timeoutMs` | `1500` | Range 300–5000. Tuning may change it |

### `tiers`

Each is optional: an exact `provider/id`, at most 128 characters. An unset tier is never offered. With no tier and no slot, workers keep their model.

| Key | Role |
|---|---|
| `fast` | Bounded work with nothing to decide |
| `balanced` | Ordinary engineering |
| `deep` | Judgment and long work |
| `expert` | The hardest work; gated by the mode's expert gate |

### `crew.slots`

Up to 8 entries. Slot commands rewrite `config.json` as plain JSON with 2-space indentation and a final newline. Every other key and its order are kept, but comments and custom formatting are lost. A slot command refuses to run while the file is invalid. Removing the last slot removes `crew.slots`, and `crew` if it is then empty.

| Key | Required | Notes |
|---|---|---|
| `name` | Yes | `^[a-z][a-z0-9-]{0,23}$`, not a reserved word |
| `model` | Yes | Exact `provider/id` with credentials, at most 128 characters |
| `when` | No | When Jev should choose it, 1–500 characters after trim. Defaults to read-only bulk work |

Reserved names: `all`, `budget`, `cli-review`, `default`, `effort`, `expert`, `mode`, `off`, `on`, `premium`, `remove`, `reset`, `review`, `skills`, `standard`, `status`, `strategy`, `subagents`, `tools`, `tune`, `verbose`.

### `effort`

| Key | Default | Notes |
|---|---|---|
| `holdProviders` | `["9router"]` | Up to 32 unique names, `^[A-Za-z0-9._-]{1,64}$`. Providers that keep the first effort until a compaction. The [WG-02 Q8](evidence/2026-11-05-host-seams.md#q8) run on `claude-code` showed no cache loss on a thinking change |

Check for yourself by watching for cache misses after thinking-level changes on your provider.

### `skills`

| Key | Default | Values |
|---|---|---|
| `inject` | `content` | `content` attaches the whole body; `suggest` only names it |

### `subagents`

| Key | Default | Values |
|---|---|---|
| `forkedLaunch` | `untouched` | `untouched` leaves a forked launch (`inherit_context`) alone; `thinking` keeps its model and changes only thinking. A `resume` launch is always untouched |

### `tools`

| Key | Default | Values |
|---|---|---|
| `mode` | `observe` | `observe` records; `enforce` removes |

### `state`

Content that leaves the machine with its own switch.

| Key | Default | Sends |
|---|---|---|
| `parentRequest` | `false` | Up to 500 characters of the latest prompt with each worker request |

### `review`

| Key | Default | Values |
|---|---|---|
| `cli` | `codex` | `codex` or `opencode`. `/jev cli-review` stores an override in `state.json` and leaves this file alone |

`state.json` holds the override as `cliReview: { cli, model?, effort? }`. `cliReview.model` is 1 to 128 characters of letters, digits, `.`, `_`, `-`, `:` and `/`, and does not start with `-`, `:` or `/`, so it can never be read as a flag. It is not the word `default`: `/jev cli-review ... default` removes the field instead.

## Fixed, not configurable

| Value | Number | Why fixed |
|---|---|---|
| Risk floor | `risky > .7` | Safety |
| Effort ceiling | `xhigh` | Cost |
| `fast` effort cap | `medium` | Cost |
| `fast`, slot threshold | Probability .6 | Not yet calibrated; change through code and evidence |
| Expert gates | See the [domain model](domain-model.md#expert-gates) | Not yet calibrated |
| Tool removal score | .5 | Not yet calibrated |
| Skill thresholds | .5, .3, .3 | From upstream |
| Strategy thresholds | .6, .8 | From upstream |

They are constants in one file, so a measured change is a one-line commit with evidence.

## Environment

| Variable | Purpose |
|---|---|
| `TYPESAFE_API_KEY` | Jev credential; the name is configurable |
| `PI_CODING_AGENT_DIR` | Moves `<agentDir>`, and so these files. Useful for testing |
