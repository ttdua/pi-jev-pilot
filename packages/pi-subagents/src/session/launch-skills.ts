/**
 * launch-skills.ts — Turn a launch's skill choice into Pi loader options, check
 * the loaded catalog against it, and build the facts `session-created` reports.
 *
 * Pure of the Pi session: `create-subagent-session.ts` only orchestrates.
 */

import type { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { debugNote } from "#src/debug";
import type { EffectiveSkills } from "#src/seams/launch-resources";

export type SkillsOverride = NonNullable<
	ConstructorParameters<typeof DefaultResourceLoader>[0]["skillsOverride"]
>;

interface RealPath {
	realPath(path: string): string;
}

/** The loader's skill diagnostics, narrowed to what a collision check reads. */
export interface SkillDiagnostic {
	type: string;
	path?: string;
	collision?: { name: string; winnerPath: string; loserPath: string };
}

export interface SkillLoaderOptions {
	noSkills?: boolean;
	additionalSkillPaths?: string[];
	skillsOverride?: SkillsOverride;
}

function safeRealPath(io: RealPath, path: string): string {
	try {
		return io.realPath(path);
	} catch {
		return path;
	}
}

/**
 * Loader options for a skill choice. `undefined`, or an inheriting launch with
 * no explicit files, leaves the loader untouched. The loader gets the resolved
 * files, never the caller's original paths.
 */
export function skillLoaderOptions(
	choice: EffectiveSkills | undefined,
	io: RealPath,
): SkillLoaderOptions {
	if (!choice) return {};
	const allowed = new Set(choice.skillFiles);
	const inAllowlist = (path: string) => allowed.has(safeRealPath(io, path));
	if (!choice.inherit) {
		return {
			noSkills: true,
			additionalSkillPaths: [...choice.skillFiles],
			skillsOverride: (base) => ({
				skills: base.skills.filter((s) => inAllowlist(s.filePath)),
				diagnostics: base.diagnostics,
			}),
		};
	}
	if (choice.skillFiles.length === 0) return {};
	return {
		additionalSkillPaths: [...choice.skillFiles],
		skillsOverride: (base) => {
			for (const d of base.diagnostics) {
				if (
					d.type === "collision" &&
					d.collision &&
					inAllowlist(d.collision.winnerPath)
				) {
					debugNote(
						`skill ${d.collision.name}: explicit ${d.collision.winnerPath} kept over ${d.collision.loserPath}`,
					);
				}
			}
			return base;
		},
	};
}

/** Refuse a launch whose explicit skill lost a name clash to the catalog. */
export function assertNoCatalogCollision(
	choice: EffectiveSkills | undefined,
	diagnostics: readonly SkillDiagnostic[],
	io: RealPath,
): void {
	if (!choice || choice.skillFiles.length === 0) return;
	const allowed = new Set(choice.skillFiles);
	for (const d of diagnostics) {
		const c = d.type === "collision" ? d.collision : undefined;
		if (c && allowed.has(safeRealPath(io, c.loserPath))) {
			throw new Error(
				`Skill name collision: ${c.name} (${c.winnerPath}, ${c.loserPath})`,
			);
		}
	}
}

/** What `session-created` reports about the child's resources. */
export interface ResourceFacts {
	cwd: string;
	inheritSkills?: boolean;
	skillPaths?: readonly string[];
	excludedExtensionPackages?: readonly string[];
	contextFiles?: boolean;
}

/** The facts to report; the four resource fields only for a launch with resources or a pin. */
export function resourceFacts(input: {
	cwd: string;
	reported: boolean;
	choice: EffectiveSkills | undefined;
	skills: readonly { filePath: string }[];
	excluded: readonly string[];
	contextFiles: boolean;
}): ResourceFacts {
	if (!input.reported) return Object.freeze({ cwd: input.cwd });
	return Object.freeze({
		cwd: input.cwd,
		inheritSkills: input.choice?.inherit ?? true,
		skillPaths: Object.freeze(input.skills.map((s) => s.filePath)),
		excludedExtensionPackages: Object.freeze([...input.excluded]),
		contextFiles: input.contextFiles,
	});
}
