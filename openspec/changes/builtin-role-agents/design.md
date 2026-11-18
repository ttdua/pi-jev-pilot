## Context

`AgentTypeRegistry.reload()` seeds a map from `DEFAULT_AGENTS` (TypeScript objects in `src/config/default-agents.ts`) and then overlays `loadCustomAgents(cwd)`, which reads `~/.pi/agent/agents/*.md` and then `.pi/agents/*.md` with `loadFromDir`. Keys are set case-sensitively by file name, while lookups (`resolveKey`) are case-insensitive. So `.pi/agents/explore.md` adds a second agent beside `Explore` instead of replacing it. The string `"general-purpose"` is hard-coded as the fallback in four places (`agent-types.ts`, `seams/registry.ts`, `tools/spawn-config.ts`, `lifecycle/subagent-manager.ts`). `buildTypeListText` and `buildAgentGuidelines` (`tools/helpers.ts`) build the `subagent` tool description from `isDefault` agents and their `toolGuideline`.

Since #88, a `fresh` child's prompt is its own session prompt followed by the agent body, so a body only needs to describe the role.

`tintinweb/pi-subagents` 0.26.1 (MIT, commit `9a1b37df`) discovers package agents in `src/package-resources.ts`, through pi's `DefaultPackageManager.listConfiguredPackages()`, `SettingsManager` and `ProjectTrustStore`. All three are exported by `@earendil-works/pi-coding-agent` 1.5.0.

## Goals / Non-Goals

**Goals:**
- One loader and one format for every agent source.
- A small, auditable port of package discovery.

**Non-Goals:**
- The parts of tintinweb's module that this change does not need: the gate, workflows, `!` exclusions, single-file entries, the array shorthand and the top-level `pi-subagents` key.
- Any change to how `fresh` and `fork` prompts are built.

## Decisions

**Sources as an ordered list of directories.** `loadCustomAgents(cwd, opts)` loads, in order, into one map:
1. the executor's own `agents/` (`source: "builtin"`), resolved from the executor package root with `import.meta.url`;
2. every package agent directory (`source: "package"`);
3. the global directory;
4. the project directory.

Each later entry replaces an earlier one with the same name compared case-insensitively. The replaced key is deleted, so the map never holds two spellings of one name. The registry no longer seeds anything itself. Alternative: keep built-ins as a separate seed in the registry. Rejected because it keeps two paths.

**Built-ins are read from the executor's own manifest.** The executor's `package.json` declares `"pi": { "subagents": { "agents": ["./agents"] } }`. The built-in step reads that manifest with the same reader that reads package manifests, so built-ins and package agents share the manifest rules. The executor root is not taken from pi's package list, because jev-pilot loads the executor as an extension path, not as an installed package. Alternative: hard-code `agents/`. Rejected because the manifest key should be the single declaration.

**Package discovery (new module `src/config/package-agents.ts`).** This is a reduced port of tintinweb's `package-resources.ts`:
- `listConfiguredPackages()` through a `DefaultPackageManager` built for `cwd`, with a `SettingsManager` that carries the project-trust answer. Each `installedPath` is used once.
- The manifest reader accepts only `pi.subagents.agents` as an array of strings. Anything else contributes nothing.
- Each entry is resolved against the package root, both paths are canonicalised (realpath of the nearest existing ancestor), and an entry outside the root is dropped with a debug note. Only existing directories are kept. Each `.md` file is canonicalised again before it is read, so a file symlinked out of the root is skipped.
- Project trust: `session_start` records `ctx.isProjectTrusted()`. Before the first session, the saved decision from `ProjectTrustStore` is read; with no saved decision, the global `defaultProjectTrust === "always"` decides. Untrusted hides project-scope packages.
- Any failure (missing API, unreadable settings) yields no package directories. The loader never throws.
- The package listing is cached per (cwd, trust, lister) for the session and invalidated on a trust change and at `session_start`. Agent files are re-read on every load, so edits show up on `reload()`.

**Frontmatter `name:`.** A non-empty string `name:` is the agent's name; otherwise the file name without `.md`. This is needed for `superspec.scout`-style names.

**Fallback and the missing-`general` error.** A single constant `FALLBACK_AGENT = "general"` replaces the four literals. `resolveType` maps `general-purpose` to `general` when no agent of that name exists, so a user file named `general-purpose.md` still wins. When `general` itself is absent or disabled and a launch falls back, `SubagentManager.resolveSpawn` throws `Agent type "general" is not available; the built-in agents are missing or disabled`. The `subagent` tool returns that error as its result. `AgentTypeCatalog.get` returns nothing in the same case. The absolute code fallback in `resolveAgentConfig` is removed. It keeps its non-null signature (about 20 call sites read it) and throws a `MissingFallbackAgentError` naming `general` when neither the name nor `general` resolves, so no stand-in agent exists. `resolveSpawn` (the choke point for every launch) calls it first, so the error surfaces as the launch error.

**Display lookup.** `AgentTypeRegistry.findAgentConfig(type): AgentConfig | undefined` does exact then case-insensitive lookup with no alias and no fallback. `getDisplayName` and every presentation path use it and fall back to the recorded type string, so history renders with `Plan`, `Explore` or a removed agent even when `general` is missing. Launch paths keep `resolveAgentConfig`.

**Tool description.** `isDefault` becomes `source === "builtin"`. The guideline line for each built-in is derived as `- Use <name> for <description>`, so `toolGuideline` and its TypeScript-only field are removed. The "Default agents" and "Custom agents" lists keep their split by source: built-in, then everything else.

**Snapshot source.** `AgentTypeSnapshot.source` becomes `"builtin" | "package" | "global" | "project"`. This is a public type in `service.ts`. jev-pilot's `AgentFacts.source` gains `package` and passes it through.

**Agent bodies.** Each file sets `name` and `description`. Every agent except `general` sets `tools`; `general` declares none and gets the seven default tools. `explore`, `scout`, `reviewer` and `verifier` set `disallowed_tools`; `general` and `implementer` deny nothing. The body has four short sections: Role (purpose and boundaries), Tools, Escalation (`ask_parent` when something outside the tools or scope is needed), Report. The body test fails on:
- `skill:` or `/skill:`;
- a slash command pattern `(^|\s)/[a-z][a-z0-9-]+`;
- a `skills` frontmatter key;
- any name from a fixed list of known skill names: the bundled Superpowers and superspec skill names, read at test time from this repo's `.pi`-free fixture list.

**Packaging.** `agents/` is added to the executor's `files`. A test runs the executor's pack listing (`npm pack --dry-run --json --ignore-scripts` in `packages/pi-subagents`) and asserts that the six files are in the packed list.

## Risks / Trade-offs

- [Pi's package API changes shape] → Feature-detect each call as tintinweb does, and fall back to no package agents. A test pins the 1.5.0 behaviour.
- [A package ships an agent named like a built-in] → It replaces the built-in by design (package > builtin). User files still win over it. The tool description lists the package agent under "Custom agents".
- [Removing the code fallback exposes a broken install as a hard error] → Intended (user choice). The error names the cause, and the packaging test guards the common case.
- [`Plan` callers break] → The fallback to `general` with a note keeps them running. The CHANGELOG names the removal.
- [The `subagent` tool description is built once at activation] → It uses the trust seeded from pi's saved decision, which matches the session answer in the common case. When the session answer differs, executions and service queries follow the session answer (they reload), but the description keeps the activation list until the next reload. Accepted for this change.
- [Larger vendored diff] → The port is a single module, and `VENDORED.md` lists each touched file.

## Migration Plan

No user action is needed:
- `general-purpose` and `Explore` keep resolving;
- `Plan` falls back with a note;
- user override files keep working and now replace built-ins case-insensitively.

Rollback is a revert of the change.

## Open Questions

None.
