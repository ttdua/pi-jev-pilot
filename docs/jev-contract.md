# Jev contract

The requests sent to Jev and how answers become decisions. The exact wording is in [Jev questions](jev-questions.md).

## Transport

Rules:

- Bearer token from the environment variable named by `classifier.apiKeyEnv`.
- The URL must be HTTPS or loopback. Loopback means `localhost`, an address in `127.0.0.0/8`, or `[::1]`, checked on the parsed host name. A URL with a user name or password is rejected. A rejected URL is an `error` miss and nothing is sent.
- Redirects are not followed. A `3xx` response is an `error` miss.
- No retry, since a retry cannot fit the latency budget. One call sends at most one request.
- Timeout (1500 ms by default) aborts the request, including a stalled body, and the turn continues as if unclassified. It is a `timeout` miss.
- Cancellation (`ctx.signal`) stops everything, and starts nothing. It is `cancelled`, never a miss.
- The response body is capped at 256 KB (262 144 bytes), by `Content-Length` or while reading. A larger body is an `error` miss.
- Any status outside 200–299 is an `error` miss. A body that is not valid JSON is a `schema` miss.
- The outcome is always a value: `ok`, `miss` (`timeout`, `error` or `schema`) or `cancelled`. The client never throws, and a miss reason never holds the key, headers or body.
- No key: the package is inert.

```text
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY
Content-Type: application/json

{ "model": "jev-latest", "state": { … }, "questions": { … } }
```

A successful response:

```json
{
  "model": "jev-1.14.0",
  "answers": {
    "effort": {
      "type": "choice", "choice": "low", "confidence": 0.73,
      "probabilities": { "low": 0.78, "medium": 0.15, "high": 0.06, "xhigh": 0.01, "max": 0 }
    },
    "risky": { "type": "noul", "noul": 0.08 }
  }
}
```

## Three request kinds

| | Main | Worker | Tool assessment |
|---|---|---|---|
| **When** | Eligible main prompt | Each launch | Worker starts, agent declares no tools |
| **Where** | Main session | Main session | Child session |
| **Usual size** | 7 KB, plus skills (about 60 KB with 78 skills) | 5–6 KB | 6 KB |
| **Cost** | About $0.0006 with 78 skills | About $0.00006 | About $0.00006 |

Cost is estimated from $0.042 per million input tokens at about 4 bytes per token. Output is free.

## Main state

```json
{
  "request": {
    "text": "<prompt>",
    "prompt_chars": 62, "files_mentioned": 0, "has_code_or_error": false, "is_question": false
  },
  "conversation": {
    "recent": [{ "role": "user", "text": "…", "tools": [{ "name": "bash", "failed": true }] }],
    "recent_tools": { "edits": 0, "commands": 1, "reads": 2, "subagents": 0, "failed": 1 },
    "turn_index": 7,
    "last_decision": { "effort": "high", "strategy": "direct" },
    "context_used_percent": 34
  },
  "workspace": {
    "platforms": ["Docker", "GitHub Actions"],
    "languages": ["TypeScript"],
    "git": { "changed_files": 3, "diff_lines": 84 }
  },
  "capabilities": {
    "tools": [{ "name": "read", "summary": "<first sentence of the description>" }],
    "subagents": [{ "name": "Explore", "description": "…", "tools": ["read", "bash"] }]
  }
}
```

> [!IMPORTANT]
> Until replay validates them ([WG-16](roadmap.md#wg-16-rich-state-replay)), these ship off: `last_decision`, `context_used_percent`, `workspace.git`, `workspace.languages`, `capabilities`. The first release's main state is `request`, `conversation.recent`, `conversation.recent_tools`, `conversation.turn_index` and `workspace.platforms`.

### How the fields are built

**`conversation.recent`**

- At most 4 messages and 2000 characters, excluding the current prompt.
- Text and tool names only, with `failed` when a call errored. Never tool arguments or results, thinking or images.
- Skill bodies and advice this package injected are excluded.
- The newest assistant message gets about 55% of the budget, and keeps both its start and its end (72% of its cap from the end), because that is where a reply asks its question.
- Other messages share the rest, at least 200 characters each. Newest wins; older ones are dropped, not squeezed.

**`request`** (computed in code, since Jev does not count reliably)

| Field | Rule |
|---|---|
| `prompt_chars` | Trimmed length |
| `files_mentioned` | Distinct matches of a path, or a file name with a known extension |
| `has_code_or_error` | Matches ` ``` `, `Traceback`, `Exception`, `error`, `failed`, `stack trace`, or `at <file>:<line>` |
| `is_question` | Ends with `?`, or starts with what, why, how, when, where, which, who, can, could, does, do, did, is, are, should, would, will |

These patterns are English. Add Vietnamese only with replay evidence.

**`conversation.recent_tools`**, over the last 10 messages:

| Count | Pi tools |
|---|---|
| `edits` | `edit`, `write` |
| `commands` | `bash` |
| `reads` | `read`, `grep`, `find`, `ls`, and web tools |
| `subagents` | `subagent` |
| `failed` | Any tool call that errored |

**`workspace.platforms`**, from file names at the project root and one level down, never file contents. Symlinks and `node_modules`, `.git`, `dist`, `build`, `.next`, `out`, `cdk.out`, `vendor`, `target`, `.venv`, `venv`, `__pycache__`, `coverage` are skipped.

| Marker | Platform |
|---|---|
| `vercel.json`, `.vercel/` | Vercel |
| `cdk.json` | AWS CDK |
| `serverless.(yml\|yaml\|ts\|js)` | AWS Serverless |
| `template.y(a)ml`, `samconfig.toml` | AWS SAM |
| `buildspec.y(a)ml` | AWS CodeBuild |
| `amplify.y(a)ml`, `amplify/` | AWS Amplify |
| `netlify.toml` | Netlify |
| `firebase.json` | Firebase |
| `supabase/config.toml` | Supabase |
| `fly.toml` | Fly.io |
| `wrangler.(toml\|json\|jsonc)` | Cloudflare Workers |
| `app.y(a)ml`, `cloudbuild.y(a)ml` | Google Cloud |
| `render.y(a)ml` | Render |
| `railway.(json\|toml)` | Railway |
| `compose.y(a)ml`, `docker-compose.y(a)ml` | Docker Compose |
| `Dockerfile` | Docker |
| `.github/workflows/` | GitHub Actions |
| `bitbucket-pipelines.yml` | Bitbucket Pipelines |

Nothing found sends `none found`.

**`workspace.git`** holds numbers only, from `git diff --shortstat`. **`capabilities.tools`** holds active tools with the first sentence of each description. **`capabilities.subagents`** holds each available agent's name, description and tools.

**Never sent:** the current model or effort, diffs, file contents.

## Eligibility

A main request is sent when `messageType` is `user`, the text is not empty, and the session is not a child. An explicit `/skill:name` skips only the skill questions. When every applicable feature is off, or held, no request is made.

Non-reasoning models, and models with one supported level, skip `effort` and `risky`. While effort is held, they are skipped too.

A worker request is skipped when the launch has `resume` or `inherit_context` set, or `subagents` is off.

## Main questions

| Key | Type | Options | Decides |
|---|---|---|---|
| `effort` | choice | `low`, `medium`, `high`, `xhigh`, `max` | Main thinking level |
| `risky` | noul | | Risk floor |
| `tier` | choice | `fast`, `balanced`, `deep` (`standard` rubric only) | Strategy gates. **Never a model** |
| `strategy` | choice | `direct`, `delegate`, `parallel`, `graph` | Advice |
| `corrects` | noul | | Marks the previous turn |
| `which` | choice | Every skill, plus `(none)` | Skill pick |
| `gate::acts_on_user_system` | noul | | Skill gate |
| `gate::would_follow_documented_procedure` | noul | | Skill gate |
| `gate::prose_suffices` | noul | | Skill gate, inverted |

A catalog over 254 skills is split into batches sent in parallel. The first batch's request carries `which` and the three gates; each later batch carries only its `which`. The gates are sent as `type` and `instructions` only.

## Worker state

```json
{
  "task": { "brief": "<first 4000 characters>", "description": "<short description>" },
  "agent": {
    "name": "worker",
    "source": "project | global | builtin",
    "description": "…",
    "instructions_excerpt": "<first 500 characters of the agent file body>",
    "declared_tools": ["read", "edit"],
    "max_turns": null,
    "run_in_background": false
  },
  "parent_request": "<latest user prompt, at most 500 characters; off by default>"
}
```

The agent's `model` and `thinking` are never sent. Replay showed no significant anchoring from them, and routing should not depend on what the file already says.

The 4000-character cap covers about 90% of real briefs. Replay at 2000 versus full length changed about as many answers as noise.

`brief` and the excerpts count code points, not UTF-16 units. Agent files are matched by listing the agents directory, so a path-like type never reaches the file system. `max_turns` is the agent's own value; `run_in_background` is the effective value of the launch. Built-in agents send an empty `instructions_excerpt`.

The agent is found by name in the listing of `.pi/agents/`, then `<agentDir>/agents/`, and otherwise from a table of the executor's built-in agents (`general-purpose`, `Explore`, `Plan`).

## Worker questions

| Key | Type | Options | Decides |
|---|---|---|---|
| `tier` | choice | Configured tiers (active mode's rubric) and `slot::<name>` | Worker model |
| `effort` | choice | Five levels, worker wording | Worker thinking level |
| `risky` | noul | | Risk floor |
| `expert_needed` | noul | Only when `tiers.expert` is set | Fable rule |

## Tool assessment

```json
{
  "task": { "brief": "…", "description": "…" },
  "agent": { "name": "general-purpose", "source": "builtin", "description": "…" },
  "tools": {
    "bash": {
      "description": "<from pi.getAllTools()>",
      "source": "builtin",
      "parameters": { "command": "Shell command to execute" }
    }
  }
}
```

One noul per tool, `tool::<name>`, asking whether that entry is dangerous or clearly inappropriate for this agent doing this task. At most 32 are scored; the rest stay allowed.

It is a separate request because tool descriptions are irrelevant to the tier question, and TypeSafe documents that unrelated state lowers accuracy.

## Skill pick

Catalog: `pi.getCommands()` entries with `source: "skill"`, read through `sourceInfo.path`. Skills with `disable-model-invocation: true` and unreadable files are excluded.

Each skill's criterion is `<description> — <first 300 code points of the body>`, both trimmed; an empty part counts as absent. With one part, use it alone; with none, `A skill named <name>.`

Batches hold at most 254 skills plus `(none)`, as few as fit, of near-equal size, in catalog order. Of a repeated name only the first is kept, and no skill is named `(none)`.

1. Take each batch's leader by probability; a batch led by `(none)` is ignored. Then the highest leader; ties go to the earlier option or batch.
2. Pick it when its probability is at least .5.
3. Otherwise pick it when both its probability and the gate mean are at least .3. The gate mean is over the gates read, with `prose_suffices` inverted; with none read it is absent, and only the .5 rule applies.
4. Otherwise no skill. A failed batch means no skill.

Delivered through `before_agent_start`'s `message` with `display: false`:

- `skills.inject: "content"`: the full body, with the skill's directory so relative references resolve.
- `skills.inject: "suggest"`: only the name and path, and the model decides whether to read it.

If a skill with the same name and the same body fingerprint is in context since the latest compaction, from a pick or an explicit `/skill:name`, a one-line reference is sent instead. Pi's own skill catalog stays in the system prompt. Workers get no skill selection.

## From answers to decisions

| Input | Rule | Effect |
|---|---|---|
| `effort.choice` | Authoritative | Effort, before floor, ceiling and clamp |
| `risky` | `> .7` | Effort at least `high`; model at least `deep` |
| `tier` probabilities | `fast` needs ≥ .6, slot needs ≥ .6 | See the [decision order](domain-model.md#workerdecision) |
| `expert_needed`, `P(expert)` | Per mode | See the [Fable rules](domain-model.md#fable-rules) |
| `strategy` probabilities | See the table below; `direct` attaches nothing | Advice |
| `which` probability | ≥ .5; or ≥ .3 with gate mean ≥ .3 | Skill pick |
| `corrects` | ≥ .7 | Marks the previous turn |
| `tool::*` | ≥ .5 | Remove, or record in `observe` mode |

Strategy gates:

| Strategy | Probability | Also |
|---|---|---|
| `delegate` | ≥ .6 | |
| `parallel` | ≥ .6 | `tier` is not `fast` |
| `graph` | ≥ .8 | `tier` is `deep` |

User and project instructions keep authority over this advice. On the ledger it was attached on 5 of 500 turns.

**How much these thresholds can be trusted** is recorded in the [evidence](evidence/2026-11-05-replay.md#threshold-provenance).

## Validation

- A choice answer counts only when `type` is `choice`, `choice` is one of the question's options, `probabilities` has exactly the options as keys, and every probability is a finite number from 0 to 1.
- A noul answer counts only when `type` is `noul` and `noul` is a finite number from 0 to 1.
- Otherwise that question is unanswered, and other answers still count. The reason is `missing`, `type`, `choice`, `probabilities` or `range`, per question. Keys that were not asked are ignored.
- A response without `answers`: the whole request is a miss.
- On a choice answer, `confidence` is kept for logging only when it is a finite number from 0 to 1. It is never read by policy, and a missing or invalid one never makes an answer unanswered.

## Known limits of Jev

From [TypeSafe's documentation](https://docs.typesafe.ai/model-jaggedness.md):

- English is the primary language; others are accepted with lower accuracy.
- It reads instructions literally, so boundary cases belong in the criteria.
- It does not count reliably, so counts are computed in code.
- Irrelevant state lowers accuracy, so each field must serve a question.
- It can lean toward the first option of a choice. `effort` lists `low` first; [WG-16](roadmap.md#wg-16-rich-state-replay) tests this.
