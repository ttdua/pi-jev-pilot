# Jev questions: full text

The exact wording sent to Jev, and the exact text added to the model's context. This is the source for `src/jev/rubrics.ts` and `src/jev/questions.ts`. Which request carries which question is in the [Jev contract](jev-contract.md).

Wording decides routing, so a change here needs a [replay](testing.md#replay-rules). Attribution is in [NOTICE.md](../NOTICE.md).

## Wire format

Questions follow the documented Choice and Noul shapes. A choice has `type`, `instructions` and `criteria`, a map from each option to its description. A noul has `type`, `instructions` and `criteria` with the keys `true` and `false`. The package always sends `criteria`, except for the three skill gates, which are sent with `type` and `instructions` only, as upstream measured them; TypeSafe treats `criteria` as optional. The instruction sent for a gate is the table cell below without the trailing "Inverted when averaged." note.

## Tier rubrics

Rubric version: `RUBRIC_VERSION` is 3 (knowledge tiers, work-and-care effort, no `expert_needed`).

Instruction, in every mode:

> Which is the least knowledgeable model tier that has the knowledge this task needs?

Each criterion is prefixed with the configured model's display name from Pi's registry, such as `Claude Haiku 5.5. `.

### Worker rubric

One rubric for every mode.

| Tier | Criterion |
|---|---|
| `basic` | Common, well-documented knowledge. The syntax, standard library and tools most programmers know or can look up in the official docs. Choose when the task needs nothing beyond that. Length, number of files, number of steps, care and risk are effort, not tier. |
| `broad` | Broad engineering knowledge across stacks and libraries: how common frameworks, databases, build tools and test runners behave, and the usual patterns for them. Choose when the task needs that knowledge, even across several of them. Length, number of files, number of steps, care and risk are effort, not tier. |
| `deep` | Specialist depth in one domain: the internals, edge cases and conventions of a particular system, runtime or protocol, which a generalist would get wrong without study. Choose when the task needs that depth. Length, number of files, number of steps, care and risk are effort, not tier. |
| `frontier` | Rare, frontier-level expertise. Knowledge that few practitioners hold and that weaker models are likely to get wrong, such as subtle interactions between systems or unusual failure modes. Choose only when the task needs that knowledge. Length, number of files, number of steps, care and risk are effort, not tier. |

The main request asks no `tier`; the strategy gate reads `effort` instead.

### Slots

Offered beside the tiers, keyed `slot::<name>`, with this criterion:

```text
<model display name> (a custom model). <when>
```

## `effort`

Choice. The same five criteria for main and worker requests. The table lists them by rank. The options are sent in the order `high`, `medium`, `xhigh`, `low`, `max`, because Jev leans toward the first option ([replay](evidence/2026-11-07-state-replay.md#effort-option-order)).

| Level | Criterion |
|---|---|
| `low` | Little or no work: a lookup, a single command, a rename or find-and-replace (even across many files), a search that lists what it finds, formatting, or a one-line change. Nothing to trace; the output is the check. |
| `medium` | A few steps: an ordinary, well-specified change to one or a few files with a check to run, or a direct question about code already in view. |
| `high` | Several steps with tracing: a change across several files that needs working out, a bug whose cause is described but has to be traced, writing tests, or reviewing a diff with care. |
| `xhigh` | Long reasoning and verification: design across several components, a bug whose cause is unknown, a refactor with many dependents to verify, or careful reasoning about concurrency, performance or failure modes. |
| `max` | Heavy care: a failure that resisted earlier attempts, or work where a subtle mistake is costly and hard to undo, such as a security or data-integrity question that must be verified step by step. |

**Main instruction:**

> How much step-by-step reasoning does the work this request asks for need? Rate the amount of work and care, not how important the topic sounds: a question or advice answered in words, even about architecture or security, is low or medium, and reviewing a small diff is medium. Rare knowledge is a tier matter, not an effort signal. A reply to the assistant's own question, proposal, review or approval request, such as approving it, picking an option, answering it or asking to continue, whatever its length and however it is formatted, takes the size of the work it approves or starts, judged from the recent conversation rather than from the reply's own text.

**Worker instruction:**

> How much work and care does a subagent need to put into carrying out this brief? Count the steps, the tracing, the tool calls and the verification, even when the brief names them. A brief that already names the files, the steps and the tests has settled the design, but carrying it out still rates by its total steps, tracing, tool use and verification. Rate higher when the brief itself asks for design, tracing an unknown cause, or reasoning that is not already written out. Rare knowledge is a tier matter, not an effort signal. Rate the work, not how important the topic sounds: reviewing a small diff is medium, even for security.

## `risky`

Noul, in main and worker requests.

> Carrying out this task would itself change production, move real money, or alter data that cannot be restored. Writing or testing code that deals with such things, without running it against the real system, does not count.

- `true`: Doing the task runs something against a real system with lasting effect: deploying or releasing, changing production data or configuration, moving money, deleting or overwriting data with no backup, or rewriting shared history (force-push).
- `false`: Reading, explaining, planning, or writing and testing code locally, even code that deals with production, payments or data, without running it against the real system.

## `strategy`

Choice, main request only.

> How should a coding assistant carry out the latest request, given the recent conversation? Prefer the simplest way that does it well.

| Option | Criterion |
|---|---|
| `direct` | The main conversation does it itself: a question, a lookup, a command, or a change to one or a few files. One job with one clear finish line. The right answer for most requests, including most follow-ups. |
| `delegate` | One subagent on a cheaper model does a broad but mechanical part first (searching or reading across many files, a codebase sweep, bulk renames) and the main conversation acts on its short report. |
| `parallel` | Fan out, then join: several independent pieces with no shared files or state (separate modules, services or investigations), each done by its own subagent at the same time, then combined in one place. |
| `graph` | Work one conversation would lose track of: parts that depend on each other in waves, or distinct specialties that hand off (build, then an independent review, then fixes), with results fanning in to be checked. Only for large builds; most work, even big work, is direct or parallel. |

## `corrects`

Noul, main request only.

> The user's latest message tells the assistant that its previous answer or work was wrong, broken, incomplete, or not what was asked, and asks for it to be fixed or redone.

- `true`: The message reports a problem with what the assistant just did or said: it doesn't work, it's wrong, it missed something, it's not what was asked, try again.
- `false`: The message approves, continues, asks something new, or gives a new task; or there was no previous answer.

## `which`

Choice, main request only.

> Which of these skills, if any, is the right one to load to help with the user's latest request? Match the kind of work the request asks for (such as debugging a failure, planning, reviewing, designing, writing a document), not only a product or technology it names. A skill for one product or platform (Vercel, Supabase, AWS, Firebase, Stripe…) fits only when the request, the conversation or the project (`workspace.platforms` in the state: what its files show it uses) shows that product is the one in use here; otherwise choose a general skill or none.

Each skill's criterion is `<description> — <first 300 code points of the body>`. Both parts are trimmed, and an empty part counts as missing. If either is missing, use what exists, or `A skill named <name>.`

The option `(none)`:

> None of these skills fits: the request is ordinary work that no listed skill is specifically about.

## Skill gates

Nouls, main request only, first batch only.

| Key | Instruction |
|---|---|
| `gate::acts_on_user_system` | Is the assistant being asked to act on the user's files, accounts, devices, or online services, rather than only to explain or advise? |
| `gate::would_follow_documented_procedure` | Would a careful expert answering this consult a specific documented procedure or set of commands, rather than answering from general understanding? |
| `gate::prose_suffices` | Could a knowledgeable generalist fully satisfy this request in prose, with no tools, no documentation, and no access to the user's files or accounts? Inverted when averaged. |

## Text added to the model's context

### Strategy advice

```text
<execution_strategy>
A fast decision model read this request as best carried out as: <strategy>.
<how>
It saw only the request and a few recent messages, not the code. If the actual work does not fit, ignore this and work directly.
</execution_strategy>
```

`<how>` per strategy:

**`delegate`**

```text
Send the broad, mechanical part (searching or reading across many files) to one subagent with a self-contained brief and a request for a short report, then do the rest here. Keep small lookups here: a subagent costs a fresh context.
```

**`parallel`**

```text
Fan out, then join. Split the work into independent pieces that share no files, and start one subagent per piece in a single message, in the background, so they run at the same time. Give each a self-contained brief naming its files and how to check its piece. Then join here: read their reports, integrate, and run the tests once. Two pieces that touch the same file are one piece.
```

**`graph`**

```text
Split the work into nodes, one subagent per independent part (a step you could do inline is not a node).
Nodes with no dependency between them start together, in one message, in the background; a dependent wave starts after its inputs join here.
Keep a plan file only if there are more than two waves. After the final join, one read-only reviewer checks the result against the tests; a failed node is redone alone.
At most 4 subagents at a time. If it cannot be explained in one breath, work directly.
```

### Skill delivery

Sent as a hidden message for a picked skill, in one of three forms. `<…>` values are inserted verbatim; lines are joined with `\n`.

**`content`**

```text
<skill_relevance>
Relevant to the current request: <name>. Ignore this if it does not fit what the user actually asked for.
<skill name="<name>" location="<path>">
References are relative to <baseDir>.

<body>
</skill>
</skill_relevance>
```

**`suggest`**

```text
<skill_relevance>
Relevant to the current request: <name>. Ignore this if it does not fit what the user actually asked for.
Its instructions are in <path>, with references relative to <baseDir>. Read that file before you start if the skill fits.
</skill_relevance>
```

**`reference`**

```text
<skill_relevance>
Relevant to the current request: <name>. Ignore this if it does not fit what the user actually asked for.
Skill <name> is already loaded above; its instructions are unchanged.
</skill_relevance>
```

## Example slot: `reviewer`

```text
Choose when the task is to review, audit or verify existing work and report findings without changing it: a diff, a pull request, a plan, a spec or a completed task, from a small re-review to a whole-branch review. Not for implementing, fixing or researching.
```
