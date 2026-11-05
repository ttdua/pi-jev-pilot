# Configuration reference

## Files

All under `<agentDir>/jev/`, by default `~/.pi/agent/jev/`.

| File | Written by | Holds |
|---|---|---|
| `config.json` | You, and `/jev` for slots | Settings below |
| `state.json` | `/jev` | Switches, mode, reviewer default |
| `tuning.json` | Automatic tuning | Applied changes and history |
| `ledger.jsonl` | The package | Decisions and outcomes |

A malformed `config.json` makes the package inert, with an error naming the field. It is never overwritten.

Precedence for a value: `tuning.json`, then `state.json`, then `config.json`, then the default.

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
  "tools": { "mode": "observe" },
  "state": { "parentRequest": false },
  "review": { "cli": "codex" }
}
```

## Settings

### `classifier`

| Key | Default | Notes |
|---|---|---|
| `url` | `https://api.typesafe.ai/v1/systemone` | HTTPS or loopback only. Redirects are rejected |
| `model` | `jev-latest` | Pin a version with `jev-1.14.0` |
| `apiKeyEnv` | `TYPESAFE_API_KEY` | The variable's name. Never put the key in this file |
| `timeoutMs` | `1500` | Range 300–5000. Tuning may change it |

### `tiers`

Each is optional: an exact `provider/id`. An unset tier is never offered. With no tier and no slot, workers keep their model.

| Key | Role |
|---|---|
| `fast` | Bounded work with nothing to decide |
| `balanced` | Ordinary engineering |
| `deep` | Judgment and long work |
| `expert` | The hardest work; gated by the mode's Fable rule |

### `crew.slots`

Up to 8 entries.

| Key | Required | Notes |
|---|---|---|
| `name` | Yes | `^[a-z][a-z0-9-]{0,23}$`, not a reserved word |
| `model` | Yes | Exact `provider/id` with credentials |
| `when` | No | When Jev should choose it. Defaults to read-only bulk work |

Reserved names: `all`, `budget`, `cli-review`, `default`, `effort`, `expert`, `mode`, `off`, `on`, `premium`, `remove`, `reset`, `review`, `skills`, `standard`, `status`, `strategy`, `subagents`, `tools`, `tune`, `verbose`.

### `effort`

| Key | Default | Notes |
|---|---|---|
| `holdProviders` | `["9router"]` | Providers that keep the first effort until a compaction |

Check for yourself by watching for cache misses after thinking-level changes on your provider.

### `skills`

| Key | Default | Values |
|---|---|---|
| `inject` | `content` | `content` attaches the whole body; `suggest` only names it |

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
| `cli` | `codex` | `codex` or `opencode`. Change with `/jev cli-review` |

## Fixed, not configurable

| Value | Number | Why fixed |
|---|---|---|
| Risk floor | `risky > .7` | Safety |
| Effort ceiling | `xhigh` | Cost |
| `fast` effort cap | `medium` | Cost |
| `fast`, slot threshold | Probability .6 | Not yet calibrated; change through code and evidence |
| Fable rules | See the [domain model](domain-model.md#fable-rules) | Not yet calibrated |
| Tool removal score | .5 | Not yet calibrated |
| Skill thresholds | .5, .3, .3 | From upstream |
| Strategy thresholds | .6, .8 | From upstream |

They are constants in one file, so a measured change is a one-line commit with evidence.

## Environment

| Variable | Purpose |
|---|---|
| `TYPESAFE_API_KEY` | Jev credential; the name is configurable |
| `PI_CODING_AGENT_DIR` | Moves `<agentDir>`, and so these files. Useful for testing |
