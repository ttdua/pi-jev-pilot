// Turns Pi session data into the plain inputs of the pure state builder.
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { BranchItem } from "../jev/state.ts";

type Part = { type?: string; text?: string; name?: string; id?: string };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Part[])
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

/** Text and tool names only; never arguments, results, thinking or images. */
export function branchItems(entries: readonly SessionEntry[]): BranchItem[] {
  const items: BranchItem[] = [];
  const calls = new Map<string, { name: string; failed?: true }>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message as unknown as {
      role: string;
      content?: unknown;
      toolCallId?: string;
      isError?: boolean;
    };
    if (message.role === "user") {
      items.push({ role: "user", text: textOf(message.content), tools: [] });
    } else if (message.role === "assistant") {
      const tools: { name: string; failed?: true }[] = [];
      if (Array.isArray(message.content)) {
        for (const part of message.content as Part[]) {
          if (part?.type !== "toolCall" || typeof part.name !== "string") continue;
          const tool: { name: string; failed?: true } = { name: part.name };
          tools.push(tool);
          if (typeof part.id === "string") calls.set(part.id, tool);
        }
      }
      items.push({ role: "assistant", text: textOf(message.content), tools });
    } else if (message.role === "toolResult") {
      const isError = message.isError === true;
      if (isError && message.toolCallId) {
        const call = calls.get(message.toolCallId);
        if (call) call.failed = true;
      }
      items.push({ role: "toolResult", text: "", tools: [], ...(isError ? { isError } : {}) });
    }
  }
  return items;
}

/** The turn id of the newest `jev-turn` entry on the given branch. */
export function previousTurnId(entries: readonly SessionEntry[]): string | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.type !== "custom" || entry.customType !== "jev-turn") continue;
    const data = entry.data as { turnId?: unknown } | undefined;
    if (typeof data?.turnId === "string") return data.turnId;
  }
  return undefined;
}

type Marker = { platform: string; files?: RegExp; dirs?: string[]; paths?: string[] };

// Order follows docs/jev-contract.md `workspace.platforms`.
const MARKERS: Marker[] = [
  { platform: "Vercel", files: /^vercel\.json$/, dirs: [".vercel"] },
  { platform: "AWS CDK", files: /^cdk\.json$/ },
  { platform: "AWS Serverless", files: /^serverless\.(yml|yaml|ts|js)$/ },
  { platform: "AWS SAM", files: /^(template\.ya?ml|samconfig\.toml)$/ },
  { platform: "AWS CodeBuild", files: /^buildspec\.ya?ml$/ },
  { platform: "AWS Amplify", files: /^amplify\.ya?ml$/, dirs: ["amplify"] },
  { platform: "Netlify", files: /^netlify\.toml$/ },
  { platform: "Firebase", files: /^firebase\.json$/ },
  { platform: "Supabase", paths: ["supabase/config.toml"] },
  { platform: "Fly.io", files: /^fly\.toml$/ },
  { platform: "Cloudflare Workers", files: /^wrangler\.(toml|json|jsonc)$/ },
  { platform: "Google Cloud", files: /^(app|cloudbuild)\.ya?ml$/ },
  { platform: "Render", files: /^render\.ya?ml$/ },
  { platform: "Railway", files: /^railway\.(json|toml)$/ },
  { platform: "Docker Compose", files: /^(docker-)?compose\.ya?ml$/ },
  { platform: "Docker", files: /^Dockerfile$/ },
  { platform: "GitHub Actions", paths: [".github/workflows"] },
  { platform: "Bitbucket Pipelines", files: /^bitbucket-pipelines\.yml$/ },
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  "cdk.out",
  "vendor",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
]);

function isDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function listDir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Platform markers by file name at `cwd` and one level below; never file contents. */
export function scanPlatforms(cwd: string): string[] {
  const found = new Set<string>();
  try {
    const roots = [cwd];
    for (const entry of listDir(cwd)) {
      if (entry.isSymbolicLink() || !entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      roots.push(join(cwd, entry.name));
    }
    for (const root of roots) {
      const entries = listDir(root).filter((e) => !e.isSymbolicLink());
      for (const marker of MARKERS) {
        if (found.has(marker.platform)) continue;
        const byName = entries.some(
          (e) =>
            (marker.files !== undefined && e.isFile() && marker.files.test(e.name)) ||
            (marker.dirs !== undefined && e.isDirectory() && marker.dirs.includes(e.name)),
        );
        const byPath = (marker.paths ?? []).some((p) => {
          const full = join(root, p);
          return p.endsWith(".toml") ? isFile(full) : isDir(full);
        });
        if (byName || byPath) found.add(marker.platform);
      }
    }
  } catch {
    // Scanning is best effort and never throws.
  }
  return found.size === 0
    ? ["none found"]
    : MARKERS.map((m) => m.platform).filter((p) => found.has(p));
}
