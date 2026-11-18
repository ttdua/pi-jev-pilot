## Design Summary

Replace the executor's built-in agents with a lowercase roster of role agents written as markdown, and let any installed pi package ship agents the same way (issues #82, #87, #91).

**Why.** The built-ins (`general-purpose`, `Explore`, `Plan`) do not match the roles delegation workflows use, are read-only by prompt only (`bash`, no `disallowed_tools`), pin a model, and live as TypeScript objects in a different shape from agent files. Packages such as pi-superspec declare agents in `package.json`, which `@tintinweb/pi-subagents` and `nicobailon/pi-subagents` load but the vendored executor ignores. Role agents are also used by several workflow packages, so a body that names one flow's skills sends children conflicting procedures.

**Goals**
- Six built-in role agents, each with a minimal `tools` allowlist and explicit `disallowed_tools`; anything outside its tools or scope goes through `ask_parent`.
- Agent bodies describe only the role: purpose, boundaries, tool limits, escalation rule, neutral report shape. Process and task come from the caller at launch.
- One agent format and one loading path for built-in, package, global and project agents.
- pi-superspec's bundled agents load on jev-pilot without changes to pi-superspec.

**Non-goals**
- A setting to gate package agents.
- Checking user override files for skill names (a user may couple a role to a flow on purpose).
- Per-launch skills, extension exclusion or cwd (#84).

**Anti-goals**
- A second manifest spelling or a convention-directory fallback that makes a package contribute agents it did not declare.
- Scanning `node_modules`, or reading files outside a package's install root.
- Any TypeScript agent definition or silent code fallback that hides a missing built-in.

**Roster**

| Agent | Role | `tools` | `disallowed_tools` |
|---|---|---|---|
| `general` | parent twin for general tasks | the 7 default tools | none |
| `implementer` | writer for one scoped task; edits only in-scope files | read, grep, find, ls, bash, edit, write | none |
| `explore` | fast lookup, short answers | read, grep, find, ls | bash, edit, write |
| `scout` | bounded investigation with an evidence report | read, grep, find, ls | bash, edit, write |
| `reviewer` | spec, plan or diff review; the caller supplies the diff as a file | read, grep, find, ls | bash, edit, write |
| `verifier` | runs tests and checks, never edits source | read, grep, find, ls, bash | edit, write |

No agent sets `model` or `thinking`; model routing decides.

**Living specs touched** (these specified requirements change explicitly):
- `executor-agent-registry`: "Agent registry query" (sources, case-insensitive override, fallback to `general`, `general-purpose` alias), "Agent snapshot fields" (`source` gains `package`; the built-in `Explore` scenario becomes the built-in roster), and a new requirement for package agent discovery.
- `agent-metadata`: "Agent facts from the executor" scenario "Built-in Explore".
- `executor-launch-identity`, `executor-launch-policy`, `worker-routing`, `subagent-context-mode`: scenarios that use `Explore` or `Plan` as sample built-ins change to roster names.
- `fleet-view` and `verbose-log` use `Explore` / `general-purpose` only as display data and stay unchanged.

## Alternatives Considered

### Alternative A: Keep built-ins in TypeScript, add the roster there
- **Approach**: Rewrite `DEFAULT_AGENTS` with the six roles; no package loading.
- **Pros**: Smallest diff; no file I/O for built-ins.
- **Cons**: Built-ins keep a different shape from agent files and a separate path; package agents (pi-superspec) still do not load; body checks scan TypeScript strings.
- **Why not chosen**: Leaves two formats and no package support.

### Alternative B: Markdown built-ins read from a fixed executor directory
- **Approach**: Ship `src/agents/*.md` and load them with the existing parser as `builtin`.
- **Pros**: One format; small change.
- **Cons**: Other packages still cannot ship agents; pi-superspec still does not load.
- **Why not chosen**: Solves half the problem; package loading would later add a second path.

### Alternative C: Port package agents and ship the built-ins as the executor's own package agents
- **Approach**: Read `pi.subagents.agents` from pi's configured packages (ported from `tintinweb/pi-subagents` 0.26.1, MIT) and from the executor's own `package.json`; built-ins become markdown loaded through the same path.
- **Pros**: One format, one loader, one manifest key; pi-superspec agents work; user override is copying a file.
- **Cons**: Larger change in the vendored tree; ported code to record.
- **Why not chosen**: Chosen.

## Agreed Approach

Alternative C, in one change covering #82, #87 and #91.

## Key Decisions

- Manifest key, the only one read: `"pi": { "subagents": { "agents": ["./agents"] } }`. No top-level `pi-subagents` key, no array shorthand.
- Packages come from pi's `DefaultPackageManager.listConfiguredPackages()`; project-scope packages are ignored while the project is not trusted; paths outside the package install root, including through symlinks, are refused.
- Load order, later wins, names compared case-insensitively: builtin < package < global < project. An override file `Explore.md` replaces built-in `explore` instead of adding a second agent.
- An agent's name is its frontmatter `name:`, else its file name.
- Built-ins ship in the executor package and are declared by its own `package.json` under the same key. `DEFAULT_AGENTS` and the code fallback agent are removed.
- Missing `general` refuses the launch with an error naming `general` (user choice 2a); a test checks the six files are packed.
- Unknown names fall back to `general`, with the existing note now naming `general`; `general-purpose` is an alias of `general`; `Plan` is removed and falls back like any unknown name.
- Bodies MUST NOT name skills, slash commands or workflow procedures, and set no `skills` field; a test scans the built-in bodies.
- No gate setting for package agents (user choice 3a).
- Ported code is listed in `VENDORED.md` and credited in `NOTICE.md`.
- A user's `~/.pi/agent/agents/implementer.md` keeps overriding the built-in `implementer`; this is expected behaviour.

## Open Questions

- How `toolGuideline` (the per-agent hint in the `subagent` tool description) is produced from markdown agents is left to design.
