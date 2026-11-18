/**
 * package-agents.ts — Discover agent directories that installed pi packages declare.
 *
 * Reduced port of `src/package-resources.ts` from tintinweb/pi-subagents
 * 0.26.1 (commit 9a1b37dff9c6626a48912d23efabfa13e3c53ddb), MIT License,
 * Copyright (c) 2026 tintinweb. Kept: the configured-package listing, canonical
 * containment, and project-trust seeding. Dropped: the cache, the gate,
 * workflows, `!` exclusions, single-file entries and alternate manifest spellings.
 *
 * Only `package.json` -> `pi.subagents.agents` (an array of strings) is read.
 * Pi's configured packages are the only source; `node_modules` is never scanned.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultPackageManager, getAgentDir, ProjectTrustStore, SettingsManager } from "@earendil-works/pi-coding-agent";
import { debugLog } from "#src/debug";

/** A canonical agent directory and the canonical package root it must stay inside. */
export interface PackageAgentDir {
  dir: string;
  root: string;
}

/** One configured package as pi lists it. */
export interface ConfiguredPackageRow {
  source: string;
  scope: "user" | "project";
  installedPath?: string;
}

/** Lists pi's configured packages for a cwd and trust answer; injectable for tests. */
export type PackageLister = (cwd: string, projectTrusted: boolean) => ConfiguredPackageRow[];

let projectTrustedState = false;

/**
 * Seed the trust state from pi's saved decision before any session exists, so
 * the tool description built at activation already sees trusted project packages.
 * No saved decision falls back to the global `defaultProjectTrust === "always"`.
 * Best effort: any failure leaves the state untrusted.
 */
export function seedProjectTrust(cwd: string): void {
  try {
    if (typeof ProjectTrustStore !== "function") return;
    const agentDir = getAgentDir();
    const saved = new ProjectTrustStore(agentDir).get(cwd);
    if (typeof saved === "boolean") {
      setProjectTrusted(saved);
      return;
    }
    const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
    setProjectTrusted(settings.getGlobalSettings().defaultProjectTrust === "always");
  } catch (err) {
    debugLog("seedProjectTrust", err);
  }
}

/** The last package listing, kept so a reload re-reads agent files without re-listing packages. */
let cached: { cwd: string; trusted: boolean; lister: PackageLister; dirs: PackageAgentDir[] } | undefined;

/** Drop the cached package listing; the next `packageAgentDirs` lists packages again. */
export function invalidatePackageCache(): void {
  cached = undefined;
}

/** Record the session's project-trust answer. Always drops the cache: it runs at every `session_start`. */
export function setProjectTrusted(trusted: boolean): void {
  projectTrustedState = trusted;
  invalidatePackageCache();
}

/** The declared `pi.subagents.agents` entries, or undefined for any other shape. */
export function readSubagentManifest(pkg: unknown): string[] | undefined {
  if (!isRecord(pkg) || !isRecord(pkg.pi) || !isRecord(pkg.pi.subagents)) return undefined;
  const agents = pkg.pi.subagents.agents;
  if (!Array.isArray(agents) || !agents.every((entry) => typeof entry === "string")) return undefined;
  return agents as string[];
}

/** Agent directories of the executor itself, from its own manifest. */
export function builtinAgentDirs(): PackageAgentDir[] {
  const manifest = fileURLToPath(new URL("../../package.json", import.meta.url));
  return agentDirsOf(dirname(manifest));
}

/**
 * Agent directories of every configured package, never throwing. The listing is
 * cached per (cwd, trust, lister) because it builds pi's settings and package
 * managers (file locks, possible `npm root -g`); callers still re-read the agent files.
 */
export function packageAgentDirs(cwd: string, lister: PackageLister = configuredPackages): PackageAgentDir[] {
  if (cached && cached.cwd === cwd && cached.trusted === projectTrustedState && cached.lister === lister) {
    return cached.dirs;
  }
  const dirs = listPackageAgentDirs(cwd, lister);
  cached = { cwd, trusted: projectTrustedState, lister, dirs };
  return dirs;
}

function listPackageAgentDirs(cwd: string, lister: PackageLister): PackageAgentDir[] {
  try {
    const dirs: PackageAgentDir[] = [];
    const seen = new Set<string>();
    for (const row of lister(cwd, projectTrustedState)) {
      if (row.scope === "project" && !projectTrustedState) continue;
      if (!row.installedPath || seen.has(row.installedPath)) continue;
      seen.add(row.installedPath);
      dirs.push(...agentDirsOf(row.installedPath));
    }
    return dirs;
  } catch (err) {
    debugLog("packageAgentDirs", err);
    return [];
  }
}

function agentDirsOf(packageRoot: string): PackageAgentDir[] {
  const entries = readSubagentManifest(readPackageJson(packageRoot));
  if (!entries) return [];
  const root = realOrSelf(packageRoot);
  const dirs: PackageAgentDir[] = [];
  for (const entry of entries) {
    const dir = realOrSelf(resolve(root, entry));
    if (!isInside(root, dir)) {
      debugLog("package agents", `entry ${entry} resolves outside ${root}`);
      continue;
    }
    if (isDirectory(dir) && !dirs.some((known) => known.dir === dir)) dirs.push({ dir, root });
  }
  return dirs;
}

/** pi's configured packages, feature-detected so a changed pi API yields none. */
function configuredPackages(cwd: string, projectTrusted: boolean): ConfiguredPackageRow[] {
  if (typeof DefaultPackageManager !== "function") return [];
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
  const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  if (typeof manager.listConfiguredPackages !== "function") return [];
  return manager.listConfiguredPackages();
}

/** Canonical path of `path`, or of its nearest existing ancestor plus the rest. */
export function realOrSelf(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(realOrSelf(parent), basename(abs));
  }
}

/** True when `candidate` is strictly inside `root`; both are canonicalised here, so raw paths are fine. */
export function isInside(root: string, candidate: string): boolean {
  const rel = relative(realOrSelf(root), realOrSelf(candidate));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function readPackageJson(root: string): unknown {
  try {
    const file = join(root, "package.json");
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as unknown) : undefined;
  } catch (err) {
    debugLog("package.json", err);
    return undefined;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}
