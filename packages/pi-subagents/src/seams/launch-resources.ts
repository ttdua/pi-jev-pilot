/**
 * launch-resources.ts — Validation of caller-supplied launch resources
 * (skills, extension exclusions, cwd, context files).
 *
 * The service is the trust boundary: resources are refused here, before any
 * record or session exists. Nothing is dropped, coerced or downgraded.
 */

import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import type { SpawnOptions } from "#src/service/service";
import type { ContextMode } from "#src/types";

export interface LaunchResources {
	readonly skills?: {
		readonly inherit: boolean;
		readonly paths: readonly string[];
		readonly skillFiles: readonly string[];
	};
	readonly excludeExtensionPackages?: readonly string[];
	readonly cwd?: string;
	readonly contextFiles?: boolean;
}

export interface LaunchResourcesIO {
	isDirectory(path: string): boolean;
	realPath(path: string): string;
	loadSkills(paths: readonly string[]): {
		skills: readonly { name: string; filePath: string }[];
		diagnostics: readonly {
			type: string;
			message: string;
			path?: string;
			collision?: { name: string; winnerPath: string; loserPath: string };
		}[];
	};
}

export interface EffectiveSkills {
	inherit: boolean;
	paths: readonly string[];
	skillFiles: readonly string[];
}

type ParseInput = Pick<
	SpawnOptions,
	"skills" | "excludeExtensionPackages" | "cwd" | "contextFiles"
>;

export function defaultLaunchResourcesIO(agentDir: string): LaunchResourcesIO {
	return {
		isDirectory(path) {
			try {
				return statSync(path).isDirectory();
			} catch {
				return false;
			}
		},
		realPath(path) {
			try {
				return realpathSync(path);
			} catch {
				return path;
			}
		},
		loadSkills(paths) {
			return loadSkills({
				cwd: agentDir,
				agentDir,
				skillPaths: [...paths],
				includeDefaults: false,
			});
		},
	};
}

function refuse(message: string): never {
	throw new Error(message);
}

/** Bounded rendering of a caller-supplied value for error text. */
function show(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	const s = String(text);
	return JSON.stringify(s.length > 200 ? `${s.slice(0, 200)}…` : s);
}

function parseShapes(options: ParseInput): void {
	const { skills, excludeExtensionPackages, cwd, contextFiles } = options;
	if (skills !== undefined) {
		if (
			typeof skills !== "object" ||
			skills === null ||
			Array.isArray(skills)
		) {
			refuse("Launch resources: skills must be an object");
		}
		if (typeof skills.inherit !== "boolean") {
			refuse("Launch resources: skills.inherit must be a boolean");
		}
		const { paths } = skills;
		if (
			paths !== undefined &&
			(!Array.isArray(paths) ||
				paths.some((p) => typeof p !== "string" || p === ""))
		) {
			refuse(
				"Launch resources: skills.paths must be an array of non-empty strings",
			);
		}
	}
	if (
		excludeExtensionPackages !== undefined &&
		(!Array.isArray(excludeExtensionPackages) ||
			excludeExtensionPackages.some((p) => typeof p !== "string" || p === ""))
	) {
		refuse(
			"Launch resources: excludeExtensionPackages must be an array of non-empty strings",
		);
	}
	if (cwd !== undefined && typeof cwd !== "string") {
		refuse("Launch resources: cwd must be a string");
	}
	if (contextFiles !== undefined && typeof contextFiles !== "boolean") {
		refuse("Launch resources: contextFiles must be a boolean");
	}
}

function parseAbsolute(options: ParseInput): void {
	const { cwd, skills } = options;
	if (cwd !== undefined && !isAbsolute(cwd)) {
		refuse(`Launch resources: cwd must be absolute: ${show(cwd)}`);
	}
	for (const p of skills?.paths ?? []) {
		if (!isAbsolute(p)) {
			refuse(
				`Launch resources: skills.paths entry must be absolute: ${show(p)}`,
			);
		}
	}
}

function parseCwd(cwd: string, io: LaunchResourcesIO): void {
	if (!io.isDirectory(cwd)) {
		refuse(`Launch resources: cwd is not an existing directory: ${show(cwd)}`);
	}
}

function isUnder(file: string, root: string): boolean {
	return (
		file === root || file.startsWith(root.endsWith(sep) ? root : root + sep)
	);
}

function dedupeByRealPath(
	paths: readonly string[],
	io: LaunchResourcesIO,
): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const p of paths) {
		const key = io.realPath(p);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(p);
	}
	return out;
}

function parseSkills(
	skills: NonNullable<ParseInput["skills"]>,
	io: LaunchResourcesIO,
): NonNullable<LaunchResources["skills"]> {
	const requested = skills.paths ?? [];
	const paths = dedupeByRealPath(requested, io);
	const loaded = paths.length
		? io.loadSkills(paths)
		: { skills: [], diagnostics: [] };

	for (const d of loaded.diagnostics) {
		if (d.type === "collision" && d.collision) {
			const { name, winnerPath, loserPath } = d.collision;
			refuse(`Skill name collision: ${name} (${winnerPath}, ${loserPath})`);
		}
	}
	for (const d of loaded.diagnostics) {
		if (d.type !== "collision") {
			refuse(
				`Launch resources: skill path is invalid: ${d.path ?? paths.join(", ")} (${d.message})`,
			);
		}
	}
	const skillFiles = [
		...new Set(loaded.skills.map((s) => io.realPath(s.filePath))),
	];
	// Coverage uses the discovery path the loader reports, before symlinks are
	// resolved, against the lexically normalized request: a skill reached through a symlink inside a directory still counts.
	for (const p of paths) {
		if (!loaded.skills.some((s) => isUnder(s.filePath, resolve(p)))) {
			refuse(`Launch resources: skill path loads no skill: ${show(p)}`);
		}
	}
	return Object.freeze({
		inherit: skills.inherit,
		paths: Object.freeze(paths),
		skillFiles: Object.freeze(skillFiles),
	});
}

/**
 * Validate and copy launch resources. Returns `undefined` when no field is
 * given; otherwise a deep-frozen copy. Throws `Error` on any refusal.
 */
export function parseLaunchResources(
	options: ParseInput,
	io: LaunchResourcesIO,
): LaunchResources | undefined {
	const { skills, excludeExtensionPackages, cwd, contextFiles } = options;
	if (
		skills === undefined &&
		excludeExtensionPackages === undefined &&
		cwd === undefined &&
		contextFiles === undefined
	) {
		return undefined;
	}
	parseShapes(options);
	parseAbsolute(options);
	if (cwd !== undefined) parseCwd(cwd, io);
	const out: {
		-readonly [K in keyof LaunchResources]: LaunchResources[K];
	} = {};
	if (skills !== undefined) out.skills = parseSkills(skills, io);
	if (excludeExtensionPackages !== undefined) {
		out.excludeExtensionPackages = Object.freeze([...excludeExtensionPackages]);
	}
	if (cwd !== undefined) out.cwd = cwd;
	if (contextFiles !== undefined) out.contextFiles = contextFiles;
	return Object.freeze(out);
}

/**
 * The skill choice a launch ends up with. A pin forces `inherit: false`.
 * `undefined` means the loader stays untouched.
 */
export function effectiveSkillChoice(
	resources: LaunchResources | undefined,
	pinned: boolean,
): EffectiveSkills | undefined {
	const skills = resources?.skills;
	if (!skills && !pinned) return undefined;
	return {
		inherit: pinned ? false : (skills?.inherit ?? true),
		paths: skills?.paths ?? [],
		skillFiles: skills?.skillFiles ?? [],
	};
}

/** Refuse resources or a pinned agent on a launch that resolves to `fork`. */
export function assertFreshOnly(input: {
	resources: LaunchResources | undefined;
	agentName: string;
	pinned: boolean;
	context: ContextMode;
}): void {
	const { resources, agentName, pinned, context } = input;
	if (context !== "fork") return;
	const fields = (
		["skills", "excludeExtensionPackages", "cwd", "contextFiles"] as const
	).filter((k) => resources?.[k] !== undefined);
	if (fields.length > 0) {
		refuse(
			`Launch resources apply to fresh launches only: ${fields.join(", ")}`,
		);
	}
	if (pinned) {
		refuse(`Agent ${agentName} pins inherit_skills: false and cannot fork`);
	}
}

function stale(path: string, reason: string): never {
	refuse(`Launch resources no longer valid: ${path} (${reason})`);
}

/** Run-start re-check of everything `parseLaunchResources` accepted. */
export function recheckLaunchResources(
	resources: LaunchResources | undefined,
	io: LaunchResourcesIO,
): void {
	if (!resources) return;
	if (resources.cwd !== undefined && !io.isDirectory(resources.cwd)) {
		stale(resources.cwd, "cwd is no longer an existing directory");
	}
	const files = resources.skills?.skillFiles ?? [];
	if (files.length === 0) return;
	const loaded = io.loadSkills(files);
	const warning = loaded.diagnostics.find((d) => d.type !== "collision");
	if (warning) stale(warning.path ?? files.join(", "), warning.message);
	const present = new Set(loaded.skills.map((s) => io.realPath(s.filePath)));
	for (const f of files) {
		if (!present.has(f)) stale(f, "skill no longer loads");
	}
}
