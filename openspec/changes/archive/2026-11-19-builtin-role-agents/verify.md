# Verification Report

**Change**: `builtin-role-agents`
**Verified at**: `2026-11-18 23:37`
**Iteration**: `1`
**Verifier**: parent session (fresh commands below) + read-only verifier agent (`Explore`, static scenario mapping, spot-checked by the parent)

---

## 1. Structural Validation

- [x] `openspec validate builtin-role-agents --strict` → `Change 'builtin-role-agents' is valid` (exit 0)

## 2. Task Completion

- [x] 15/15 ticked (`openspec instructions apply` progress `{"total":15,"complete":15,"remaining":0}`)

## 3. Requirement Evidence

- [x] ADDED / MODIFIED: implementation evidence
- [x] REMOVED: baseline gone (`rg -n "DEFAULT_AGENTS|default-agents|toolGuideline|isDefault" packages/pi-subagents/src src` → no hits; `src/config/default-agents.ts` deleted)
- [x] Renamed requirements (ADDED + REMOVED) keep behaviour under the new names

| Requirement (capability) | Status | Evidence |
|---|---|---|
| Package agent manifest key, Which packages are read, Project trust, Paths stay inside the package, Package discovery fails quiet (package-agents) | Pass | `packages/pi-subagents/src/config/package-agents.ts` (manifest reader, configured packages, trust seed/session, containment, cache) |
| Built-in agents are markdown files, Role agent tool boundaries, Tool description lists effective agents, Role bodies are flow-neutral (builtin-role-agents) | Pass | `packages/pi-subagents/agents/*.md`, `package.json` `pi.subagents.agents` + `files`, `src/tools/helpers.ts` |
| Agent registry lookup, Agent sources and override, Agent name resolution, Missing fallback agent refused, History display never needs the fallback, Agent snapshot content, Deprecated inherit_context in snapshots (executor-agent-registry) | Pass | `src/config/custom-agents.ts` (`setReplacing`, frontmatter `name:`, malformed-frontmatter skip), `src/config/agent-types.ts` (`FALLBACK_AGENT`, alias, `MissingFallbackAgentError`, `findAgentConfig`), `src/ui/display.ts`, `src/seams/registry.ts`, `src/service/service.ts` |
| Agent facts from the snapshot, Thinking counts as set only when known (agent-metadata) | Pass | `src/policy/launch.ts` (`source` gains `package`), `src/host/platform/agents.ts`, `scripts/replay/inputs.ts` |
| Rename-only MODIFIED blocks (executor-launch-identity, executor-launch-policy, worker-routing, subagent-context-mode) | Pass | behaviour unchanged; samples renamed |

## 4. Scenario Coverage

- [ ] Every scenario maps to a test — 82 of 83 (see WARNING 1–2)
- [x] Fresh test runs (cwd: worktree, HEAD afe2b627)

| Command | Exit | Result |
|---|---|---|
| `bun run typecheck` | 0 | no type errors in 292 files |
| `bun run lint` | 0 | clean |
| `bun run fmt:check` | 0 | clean |
| `bun run test:executor` | 0 | 107 files, 2517 tests passed |
| `bun test` | 0 | 2637 pass, 0 fail, 141 files |
| `bun run --cwd packages/pi-subagents verify:public-types` | 0 | external consumer type-checks |

**E2E (real pi 1.5.2 print run, temporary test not committed)**: checkout + pi-superspec installed into a temp agent dir, fixture provider on loopback:
- `subagent_type: "superspec.scout"` → child ran with pi-superspec's `agents/scout.md` body (package agent, frontmatter `name:`), tools `read, grep, find, ls, bash, ask_parent, notify_parent`.
- `subagent_type: "explore"` → child's first provider request offers `read, grep, find, ls, ask_parent, notify_parent` (no bash/edit/write).
- `subagent_type: "Plan"` → child ran; the main model's next request carries the note `using general`.
Result: 2 pass, 0 fail.

Static mapping (83 non-REMOVED scenarios; executor tests are not named after scenarios): 46 covered by a direct assertion, 12 partial, 1 without a direct test; the E2E above covers "Name from frontmatter", "Removed Plan falls back with a note", "Read-only explore" end to end and "Declared directory loaded" end to end.

## 5. Design and Contract Coherence

- [x] Decisions in design.md match the code (cache description updated in the final fix wave)
- [x] Contracts match the code with the deviations recorded in apply.md (no `globalDir` option; per-session package cache; regenerated `dist/public.d.ts`)

Drift warnings: none.

## 6. Clean Tree and Commit Range

- [x] `git status --porcelain` empty before writing this receipt
- **Commit range**: `289849c5..afe2b627`

---

## Issues

### CRITICAL
- None.

### WARNING
1. **Partial unit coverage** for: Verifier cannot edit (fresh) (session factory tools, not the provider request — the E2E covers the equivalent for `explore`), Verifier fork refuses edits (guard, not a real call), Package over built-in / Global over package / Package source (loader, not the registry snapshot), Frontmatter name over file name (no `Explore.md` with `name: other` case), Display without general (widget only for missing, not disabled), Malformed manifest / Package API unavailable (discovery only, not the registry), Old prompt mode ignored (parser only). Recommendation: add registry-level assertions in `test/seams/registry.test.ts` for the source and override cases, and an `Explore.md`/`name: other` case in `test/config/custom-agents.test.ts`.
2. **"Name from frontmatter"** has no unit test (package `scout.md` declaring `superspec.scout`); verified only by the E2E above. Recommendation: add it to `test/config/custom-agents.test.ts`.
3. **Executor `bun run lint`** fails on the base commit too (biome schema/format, missing eslint config) and is not in CI; not counted. Recommendation: separate chore.

### SUGGESTION
1. `.superpowers/` is not git-ignored; SDD scratch files were committed by mistake twice (here and in #88). Add `.superpowers/` to `.gitignore`.
2. Project `.pi/agents/*.md` load regardless of project trust while project-scope packages are gated — pre-existing asymmetry; consider a follow-up issue.

---

## Overall Decision

- [x] PASS_WITH_WARNINGS: no CRITICAL issue, fresh tests and E2E green; some scenarios have only partial unit assertions.

**Next step**: `/opsx-continue builtin-role-agents` in the worktree to create finalize, then `/opsx-archive`.
