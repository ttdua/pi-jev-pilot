## Context

`src/host/main.ts` (`createMain`) runs one Jev request per eligible prompt in `before_agent_start`, applies effort, and writes the `main` line and `jev-turn` entry at `agent_settled`. `src/policy/skill.ts` already has `skillBatches`, `pickSkill`, `deliveryForm` and `deliveryText`. `src/jev/questions.ts` has `mainQuestions({ askEffort, skills })` and `skillBatchQuestions(batch)`. The ledger schema accepts `skill` (`^[a-z0-9][a-z0-9-]{0,63}$`), `skillP` and `gate`.

These facts come from reading Pi 1.5.0:
- `pi.getCommands()` lists skills as `{ name: "skill:<name>", description, source: "skill", sourceInfo }`. `sourceInfo.path` is the `SKILL.md` path. `sourceInfo.baseDir` is the agent dir or package root for discovered skills (`resource-loader.js` `findSourceInfoForPath`). Pi's own block uses `skill.baseDir = dirname(filePath)`, which `getCommands` does not expose.
- `before_agent_start` receives the prompt after `/skill:name` expansion. Pi builds the block as `<skill name="N" location="P">\nReferences are relative to D.\n\n<stripFrontmatter(file).trim()>\n</skill>`, followed by `\n\n<args>` when the command has arguments.
- Each handler returns at most one `message`; Pi stores it as a `custom_message` entry with its `details`.
- `ctx.sessionManager.buildSessionProjection()` (public, on `ReadonlySessionManager`) returns `{ sourceEntry, messages }` per entry Pi sends to the model, after compaction (latest compaction, kept entries, newer entries) and after context edits (a removed entry has no messages; a rewritten one has the new content).
- `parseFrontmatter` and `stripFrontmatter` are public exports of `@earendil-works/pi-coding-agent`.

## Goals / Non-Goals

**Goals:**
- One hidden skill message per eligible prompt at most, built only from the existing policy functions.
- The duplicate check matches what the model can actually see now.
- All Pi and file access in `src/host/`; `policy/` and `jev/` unchanged in behaviour.

**Non-Goals:**
- A status-line skill suffix (follow-up).
- Removing the expanded `/skill:name` block from `request.text`. It is sent today as part of the prompt, and this change keeps that.
- Caching the catalog across prompts.
- Skill selection for workers.

## Decisions

**`src/host/skills.ts` owns everything Pi-shaped about skills.** It holds these functions, each with one job, plus `skillBlock` (Pi's block, rebuilt) and the `jev-skill` type constant:
- `readCatalog(commands, read)` returns `CatalogSkill[]` (`name`, `description`, `body`, `path`, `baseDir`, `fingerprint`).
- `explicitSkill(prompt)` returns the leading block's name, or undefined.
- `loadedSkills(entries, catalog)` returns `{ name, fingerprint }[]`.
- `fingerprint(body)` is the hex SHA-256 of the body.

`main.ts` only orchestrates. Before adding skill code, `decide()` is split into `prepare` (eligibility and record), the ask, and `applyEffort`, so the skill steps (`planSkills`, `askBatches`, `skillPick`, `skillMessage`) are helpers and `decide()` returns the message once at its end. The file reader is injected (`MainDeps.commands` and `MainDeps.readFile`), so the catalog is unit-tested without Pi. Alternative: grow `context.ts`. Rejected, because that file is about conversation state and platforms.

**Catalog rules.** An entry is kept when all of these hold:
- `source` is `skill`.
- The name, without its `skill:` prefix, matches the ledger pattern.
- The file reads.
- `parseFrontmatter` does not report `disable-model-invocation: true`.

The body is `stripFrontmatter(raw).trim()`, the same text Pi puts in its block, so an explicit block and a delivered body of the same file have equal fingerprints. `description` comes from the command. `baseDir` is always `dirname(sourceInfo.path)`, matching Pi's block, so a rebuilt block equals the operator's real `/skill:name` text (plan review F1). One unreadable or malformed file drops only that entry. The catalog is read only when `skills` is on and the prompt has no explicit skill.

**Explicit skill detection** tests the prompt for a leading `<skill name="…" location="…">\nReferences are relative to `. When it matches, skill questions are skipped for this prompt and nothing else changes.

**Loaded in context.** `loadedSkills` scans `buildSessionProjection().entries`:
- A `custom_message` source entry with `customType` `jev-skill` and `details.form` `content` counts with its `details.name` and `details.fingerprint`, but only when its projected messages still contain the delivered text. A context edit that removed or rewrote it makes it not count.
- A user message counts when its first projected text part starts with an explicit block for a catalog name. It gets the current fingerprint only when that text starts with the full block rebuilt from the current catalog body (`…\n\n<body>\n</skill>`). Otherwise it gets a value that never matches.

Comparing with the rebuilt block avoids parsing where a body ends, which is ambiguous when the body itself contains `</skill>`. `suggest` and `reference` messages carry no body and never count. Alternatives:
- Scan `getBranch()` after the latest compaction. Rejected, because it ignores entries kept across the compaction.
- Scan `buildContextEntries()`. Rejected, because it returns raw entries before context edits (spec review F2).

**Message shape.** `{ customType: "jev-skill", content: deliveryText(form, skill), display: false, details: { name, fingerprint, form } }`. `details` holds no prompt text. The spec says `details` *holds* these keys, not *exactly* these, so the WG-10 merge can add advice keys. The body is already in `content`, the same as any hidden message Pi saves.

**Requests.** The first batch goes in the main request via `mainQuestions({ askEffort, skills: batches[0] })`. Batches 2 and later are sent with `skillBatchQuestions`, in parallel with the main request, with the same state, timeout and abort signal, so the wait stays within one timeout. `pickSkill` receives one `{ options, read }` per batch:
- `options` is that batch's `which` spec options, `(none)` included.
- `read` is `readAnswers` of the batch's own answers, or undefined on a miss or cancel.

The main request's outcome alone decides `answered`, `ms`, `miss` and effort, as before.

**Where skill handling sits in the flow.** After the main answers are read, the skill result is computed once. It is returned as the handler's message on every path that read the main answers: normal, held, discarded on a manual level change, `max` kept, and `effort` unanswered. `decide()` therefore computes the skill result right after `readAnswers` and before any effort branch; each effort branch then returns that one value. Effort and skill are independent. A skill-only turn calls no `setDecision` on any path (pick, miss, schema miss), so the status line stays as it was, and its `jev-turn` entry is `{ turnId }` because it has no effective level. A main miss or cancel returns no message. An Esc before any provider request already writes nothing (`agent_settled` with `sawRequest` false); Pi has already stored the message entry by then, which matches how a hidden message behaves for any extension.

**Eligibility.** `effortOn || skillsApply`, where `skillsApply = switches.skills && no explicit skill && catalog.length > 0`. The hold is computed only when `effort` is on, and `askEffort = effortOn && !held && canAskEffort(supported)`. `corrects` is always asked, as `mainQuestions` already does.

**Ledger.** `TurnRecord` gains `skill`, `skillP` and `gate`, copied from `pickSkill`'s result. `skill` is written when a skill is picked, whatever the form. `skillP` and `gate` are written when the result carries them. With no skill questions, all three are absent.

**WG-10 merge.** `jev-advice` (#31) comes from the same `decide()`. Whichever change merges second combines both into one returned message: the skill text, a blank line, then the advice. It keeps one `customType` per kind in `details`, so the duplicate check still finds `jev-skill`. This change is written so the combination is a local edit in `decide()`'s return.

## Risks / Trade-offs

- [Every eligible prompt reads every skill file] → About 78 small files on a typical install. Reads are synchronous and bounded by the catalog. Caching is left out until measured.
- [Pi's block format changes in a later version] → Explicit detection would miss, and skill questions would be asked; the duplicate check would resend the body. Both fail toward the current behaviour. The host test pins Pi 1.5.0.
- [A combined message after WG-10 merges] → The duplicate check reads `details`. The merge must keep the skill's `details`; the WG-10 rebase covers it with a test.
- [Later batches add Jev cost on catalogs over 254] → As designed in `skill-pick`; rare.

## Migration Plan

None. Defaults have `skills` on, so after upgrade eligible prompts gain the skill questions. `/jev skills off` restores the previous requests exactly.

## Open Questions

- None.
