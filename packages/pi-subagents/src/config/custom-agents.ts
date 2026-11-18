/**
 * custom-agents.ts — Load user-defined agents from project (.pi/agents/) and global ($PI_CODING_AGENT_DIR/agents/, default ~/.pi/agent/agents/) locations.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOL_NAMES } from "#src/config/agent-types";
import { warnDeprecatedIn } from "#src/config/deprecations";
import { isLockableField, type LockDeclaration, lockedFieldName } from "#src/config/invocation-config";
import { builtinAgentDirs, isInside, type PackageAgentDir, packageAgentDirs, realOrSelf } from "#src/config/package-agents";
import { parseThinkingLevel, thinkingLevelError } from "#src/config/thinking-level";
import { debugLog } from "#src/debug";
import { noteDeclaredAndDisallowed } from "#src/seams/registry";
import type { AgentConfig, ContextMode } from "#src/types";

/** Injectable agent directories, so unit tests need no pi settings or installed packages. */
export interface LoadCustomAgentsOptions {
  builtinDirs?: PackageAgentDir[];
  packageDirs?: PackageAgentDir[];
}

/**
 * Load every agent from four sources, lowest priority first:
 *   1. builtin: the executor's own declared agent directories
 *   2. package: directories declared by pi's configured packages
 *   3. global:  $PI_CODING_AGENT_DIR/agents/*.md (default: ~/.pi/agent/agents/*.md)
 *   4. project: <cwd>/.pi/agents/*.md
 *
 * A later source replaces an agent of the same name, compared case-insensitively,
 * so the map never holds two spellings of one name.
 */
export function loadCustomAgents(cwd: string, opts: LoadCustomAgentsOptions = {}): Map<string, AgentConfig> {
  const agents = new Map<string, AgentConfig>();
  const warned = new Set<string>();
  for (const { dir, root } of opts.builtinDirs ?? builtinAgentDirs()) loadFromDir(dir, agents, "builtin", warned, root);
  for (const { dir, root } of opts.packageDirs ?? packageAgentDirs(cwd)) loadFromDir(dir, agents, "package", warned, root);
  loadFromDir(join(getAgentDir(), "agents"), agents, "global", warned);
  loadFromDir(join(cwd, ".pi", "agents"), agents, "project", warned);
  return agents;
}

/** Set `config` under its name, first deleting any key that equals it case-insensitively. */
function setReplacing(agents: Map<string, AgentConfig>, config: AgentConfig): void {
  const lower = config.name.toLowerCase();
  for (const key of [...agents.keys()]) {
    if (key.toLowerCase() === lower) agents.delete(key);
  }
  agents.set(config.name, config);
}

/**
 * Load agent configs from a directory into the map. With a `root`, each file must
 * canonicalise inside it, so a file symlinked out of a package is skipped.
 */
function loadFromDir(
  dir: string,
  agents: Map<string, AgentConfig>,
  source: AgentConfig["source"] & string,
  warned: Set<string>,
  root?: string,
): void {
  if (!existsSync(dir)) return;

  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith(".md"));
  } catch (err) {
    debugLog("readdirSync agents dir", err);
    return;
  }

  for (const file of files) {
    const path = join(dir, file);
    if (root !== undefined && !isInside(root, realOrSelf(path))) {
      debugLog("agent file outside package root", path);
      continue;
    }

    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch (err) {
      debugLog("readFileSync agent file", err);
      continue;
    }

    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(content);
    } catch (err) {
      debugLog(`malformed frontmatter, skipping ${path}`, err);
      continue;
    }
    const { frontmatter: fm, body } = parsed;
    const name = (typeof fm.name === "string" && fm.name.trim() !== "" ? fm.name.trim() : undefined) ?? basename(file, ".md");
    const toolNames = listField(fm.tools, BUILTIN_TOOL_NAMES);
    const toolsDeclared = fm.tools != null;
    const disallowedTools = listField(fm.disallowed_tools, []);
    if (toolsDeclared) noteDeclaredAndDisallowed(name, toolNames, disallowedTools);

    setReplacing(agents, {
      name,
      displayName: str(fm.display_name),
      description: str(fm.description) ?? name,
      toolNames,
      toolsDeclared,
      disallowedTools,
      model: str(fm.model),
      thinking: thinkingLevel(fm.thinking, name),
      maxTurns: nonNegativeInt(fm.max_turns),
      systemPrompt: body.trim(),
      context: contextField(fm, path, warned),
      runInBackground: fm.run_in_background != null ? fm.run_in_background === true : undefined,
      locked: lockDeclaration(fm.locked, name, path, warned),
      enabled: fm.enabled !== false,  // default true; explicitly false disables
      source,
    });
  }
}

// ---- Field parsers ----
// All follow the same convention: omitted → default, "none"/empty → nothing, value → exact.

/**
 * Parse `context`, falling back to the deprecated `inherit_context`; `prompt_mode` is ignored.
 *
 * Each problem warns once per file per load. An unrecognized `context` declares nothing.
 */
function contextField(fm: Record<string, unknown>, path: string, warned: Set<string>): ContextMode | undefined {
  if (fm.prompt_mode != null) {
    warnDeprecatedIn(warned, `${path}:prompt_mode`, `${path}: prompt_mode is deprecated and ignored; use context: fresh | fork`);
  }
  // DEPRECATED(remove next minor): inherit_context and prompt_mode frontmatter aliases
  if (fm.inherit_context != null) {
    warnDeprecatedIn(warned, `${path}:inherit_context`, `${path}: inherit_context is deprecated; use context: fork | fresh`);
  }
  if (fm.context != null) return declaredContext(fm.context, path, warned);
  if (fm.inherit_context == null) return undefined;
  return fm.inherit_context === true ? "fork" : "fresh";
}

function declaredContext(val: unknown, path: string, warned: Set<string>): ContextMode | undefined {
  if (val === "fresh" || val === "fork") return val;
  warnDeprecatedIn(warned, `${path}:context`, `${path}: invalid context ${JSON.stringify(val)}; expected fresh or fork`);
  return undefined;
}

/** Extract a string or undefined. */
function str(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

/**
 * Parse the `locked:` key into a lock declaration, or undefined when it claims nothing.
 *
 * `true` is the whole-file form; anything else parses as a field list, so both YAML
 * spellings `tools:` accepts work here too. An entry naming no lockable field is
 * dropped rather than failing the agent's load.
 */
function lockDeclaration(val: unknown, agentName: string, path: string, warned: Set<string>): LockDeclaration | undefined {
  if (typeof val === "boolean") return val ? true : undefined;

  const entries = parseListField(val);
  if (entries === undefined) return undefined;

  if (entries.includes("inherit_context")) {
    warnDeprecatedIn(warned, `${path}:locked:inherit_context`, `${path}: locked: inherit_context is deprecated; use locked: context`);
  }
  const names = entries.map(lockedFieldName);
  const fields = names.filter(isLockableField);
  const unknownEntries = names.filter((entry) => !isLockableField(entry));
  if (unknownEntries.length > 0) {
    debugLog(`agent ${agentName} frontmatter locked`, `unknown fields: ${unknownEntries.join(", ")}`);
  }
  return fields.length > 0 ? fields : undefined;
}

/**
 * Extract a thinking level, dropping an unrecognized one.
 *
 * Passing it through would not surface as an error: Pi clamps a level missing from
 * its own table down to `off`, silently disabling thinking for an agent whose author
 * asked for more of it. Inheriting the parent's level is the safer miss (Refs #834).
 */
function thinkingLevel(val: unknown, agentName: string): AgentConfig["thinking"] {
  const level = parseThinkingLevel(val);
  if (val != null && level === undefined) {
    debugLog(`agent ${agentName} frontmatter thinking`, thinkingLevelError(val));
  }
  return level;
}

/** Extract a non-negative integer or undefined. 0 means unlimited for max_turns. */
function nonNegativeInt(val: unknown): number | undefined {
  return typeof val === "number" && val >= 0 ? val : undefined;
}

/**
 * Parse a raw list field into items, or undefined if absent/empty/"none".
 *
 * Frontmatter is YAML, so a list field is written either as a comma-separated
 * scalar (`tools: read, grep`) or as a sequence (`tools: [read, grep]`). Both
 * are supported: a sequence keeps its entries intact, while a scalar is split
 * on commas.
 */
function parseListField(val: unknown): string[] | undefined {
  if (val === undefined || val === null) return undefined;
  const items = Array.isArray(val)
    ? val.map(entry => String(entry).trim()).filter(Boolean)
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- val is already narrowed past null/undefined; String() is the intended coercion here
    : String(val).trim().split(",").map(entry => entry.trim()).filter(Boolean);
  if (items.length === 0) return undefined;
  return items.length === 1 && items[0] === "none" ? undefined : items;
}

/**
 * Parse a list field with defaults.
 * omitted → defaults; "none"/empty → []; otherwise → listed items.
 */
function listField(val: unknown, defaults: string[]): string[] {
  if (val === undefined || val === null) return defaults;
  return parseListField(val) ?? [];
}
