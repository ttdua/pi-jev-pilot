import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
  type AgentFacts,
  LOCKABLE_FIELDS,
  type LockableField,
  type LockDeclaration,
} from "../policy/launch.ts";
import { cutCodePoints } from "../shared/text.ts";

const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];
const EXCERPT_MAX = 500;
const FALLBACK = "general-purpose";
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function builtin(
  name: string,
  description: string,
  declaredTools: string[] | null,
  setsModel: boolean,
): [string, AgentFacts] {
  return [
    name,
    {
      name,
      source: "builtin",
      description,
      instructionsExcerpt: "",
      declaredTools,
      maxTurns: null,
      sets: { model: setsModel, thinking: false },
    },
  ];
}

export const BUILTIN_AGENTS: ReadonlyMap<string, AgentFacts> = new Map([
  builtin("general-purpose", "General-purpose agent for complex, multi-step tasks", null, false),
  builtin("Explore", "Fast codebase exploration agent (read-only)", READ_ONLY_TOOLS, true),
  builtin(
    "Plan",
    "Software architect for implementation planning (read-only)",
    READ_ONLY_TOOLS,
    false,
  ),
]);

function listAgentFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  try {
    const entries = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
    for (const file of entries) files.set(basename(file, ".md"), join(dir, file));
  } catch {
    // missing or unlistable directory: treated as empty
  }
  return files;
}

function parseList(val: unknown): string[] | undefined {
  if (val === undefined || val === null) return undefined;
  const items = Array.isArray(val)
    ? val.map((e) => String(e).trim()).filter(Boolean)
    : String(val)
        .trim()
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
  if (items.length === 0) return undefined;
  return items.length === 1 && items[0] === "none" ? undefined : items;
}

function lockDeclaration(val: unknown): LockDeclaration | undefined {
  if (typeof val === "boolean") return val ? true : undefined;
  const entries = parseList(val);
  if (entries === undefined) return undefined;
  const fields = entries.filter((e): e is LockableField =>
    (LOCKABLE_FIELDS as readonly string[]).includes(e),
  );
  return fields.length > 0 ? fields : undefined;
}

function flag(val: unknown): boolean | undefined {
  return val != null ? val === true : undefined;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function parseFile(
  name: string,
  path: string,
  source: "project" | "global",
): AgentFacts | undefined {
  try {
    const parsed = parseFrontmatter(readFileSync(path, "utf-8"));
    const fm: Record<string, unknown> = isPlainObject(parsed.frontmatter) ? parsed.frontmatter : {};
    const body = typeof parsed.body === "string" ? parsed.body : "";
    const tools = fm.tools;
    const declaredTools = tools === undefined || tools === null ? null : (parseList(tools) ?? []);
    const facts: AgentFacts = {
      name,
      source,
      description: typeof fm.description === "string" ? fm.description : name,
      instructionsExcerpt: cutCodePoints(body.trim(), EXCERPT_MAX),
      declaredTools,
      maxTurns: typeof fm.max_turns === "number" && fm.max_turns >= 0 ? fm.max_turns : null,
      sets: {
        model: typeof fm.model === "string",
        thinking: typeof fm.thinking === "string" && THINKING_LEVELS.has(fm.thinking),
      },
    };
    const runInBackground = flag(fm.run_in_background);
    if (runInBackground !== undefined) facts.runInBackground = runInBackground;
    const inheritContext = flag(fm.inherit_context);
    if (inheritContext !== undefined) facts.inheritContext = inheritContext;
    const locked = lockDeclaration(fm.locked);
    if (locked !== undefined) facts.locked = locked;
    return facts;
  } catch {
    return undefined;
  }
}

export function readAgent(name: unknown, dirs: { cwd: string; agentDir: string }): AgentFacts {
  const fallback = BUILTIN_AGENTS.get(FALLBACK) as AgentFacts;
  if (typeof name !== "string") return fallback;
  const project = listAgentFiles(join(dirs.cwd, ".pi", "agents"));
  const global = listAgentFiles(join(dirs.agentDir, "agents"));

  const resolve = (key: string): AgentFacts | undefined => {
    const p = project.get(key);
    if (p !== undefined) {
      const facts = parseFile(key, p, "project");
      if (facts) return facts;
    }
    const g = global.get(key);
    if (g !== undefined) {
      const facts = parseFile(key, g, "global");
      if (facts) return facts;
    }
    return BUILTIN_AGENTS.get(key);
  };

  const exact = resolve(name);
  if (exact) return exact;

  const keys = [...BUILTIN_AGENTS.keys()];
  for (const k of global.keys()) if (!keys.includes(k)) keys.push(k);
  for (const k of project.keys()) if (!keys.includes(k)) keys.push(k);
  const lower = name.toLowerCase();
  const match = keys.find((k) => k.toLowerCase() === lower);
  return (match === undefined ? undefined : resolve(match)) ?? fallback;
}
