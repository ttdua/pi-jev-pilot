import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	assertNoCatalogCollision,
	resourceFacts,
	skillLoaderOptions,
} from "#src/session/launch-skills";
import { excludedPackageUnion } from "#src/session/package-exclusions";

let root: string;
const io = { realPath: (p: string) => realpathSync(p) };

function file(dir: string): string {
	mkdirSync(dir, { recursive: true });
	const f = join(dir, "SKILL.md");
	writeFileSync(f, "x");
	return f;
}
// biome-ignore lint/suspicious/noExplicitAny: loader skill shape is wide; tests need only name and path
const sk = (name: string, filePath: string): any => ({ name, filePath });

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "launch-skills-")));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("skillLoaderOptions", () => {
	it("gives nothing for no choice", () => {
		expect(skillLoaderOptions(undefined, io)).toEqual({});
	});

	it("inherit false: noSkills, the resolved files, and an allowlist override", () => {
		const keep = file(join(root, "real", "k"));
		const link = join(root, "link");
		symlinkSync(join(root, "real", "k"), link);
		const drop = file(join(root, "other"));
		const out = skillLoaderOptions(
			{ inherit: false, paths: [join(root, "orig")], skillFiles: [keep] },
			io,
		);
		expect(out.noSkills).toBe(true);
		expect(out.additionalSkillPaths).toEqual([keep]);
		const res = out.skillsOverride?.({
			skills: [sk("k", join(link, "SKILL.md")), sk("d", drop)],
			diagnostics: [],
		});
		expect(res?.skills.map((s) => s.name)).toEqual(["k"]);
	});

	it("inherit true with files: keeps everything and notes a late collision won by an explicit file", () => {
		vi.stubEnv("PI_SUBAGENTS_DEBUG", "1");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const win = file(join(root, "w"));
		const lose = file(join(root, "l"));
		const out = skillLoaderOptions(
			{ inherit: true, paths: [win], skillFiles: [win] },
			io,
		);
		expect(out.noSkills).toBeUndefined();
		expect(out.additionalSkillPaths).toEqual([win]);
		const base = {
			skills: [sk("plan", win), sk("x", lose)],
			diagnostics: [
				{
					type: "collision" as const,
					message: "m",
					collision: {
						resourceType: "skill" as const,
						name: "plan",
						winnerPath: win,
						loserPath: lose,
					},
				},
			],
		};
		expect(out.skillsOverride?.(base).skills).toHaveLength(2);
		expect(warn.mock.calls.flat().join(" ")).toContain(lose);
		vi.unstubAllEnvs();
	});

	it("inherit true with no files gives nothing", () => {
		expect(
			skillLoaderOptions({ inherit: true, paths: [], skillFiles: [] }, io),
		).toEqual({});
	});
});

describe("assertNoCatalogCollision", () => {
	const diag = (winnerPath: string, loserPath: string) => [
		{ type: "collision", collision: { name: "plan", winnerPath, loserPath } },
	];

	it("throws when the explicit file loses", () => {
		const cat = file(join(root, "cat"));
		const exp = file(join(root, "exp"));
		expect(() =>
			assertNoCatalogCollision(
				{ inherit: true, paths: [exp], skillFiles: [exp] },
				diag(cat, exp),
				io,
			),
		).toThrow(`Skill name collision: plan (${cat}, ${exp})`);
	});

	it("passes when the explicit file wins", () => {
		const cat = file(join(root, "cat"));
		const exp = file(join(root, "exp"));
		expect(() =>
			assertNoCatalogCollision(
				{ inherit: true, paths: [exp], skillFiles: [exp] },
				diag(exp, cat),
				io,
			),
		).not.toThrow();
	});

	it("passes for two catalog files", () => {
		const a = file(join(root, "a"));
		const b = file(join(root, "b"));
		const exp = file(join(root, "exp"));
		expect(() =>
			assertNoCatalogCollision(
				{ inherit: true, paths: [exp], skillFiles: [exp] },
				diag(a, b),
				io,
			),
		).not.toThrow();
	});
});

describe("resourceFacts", () => {
	it("reported false gives only cwd", () => {
		expect(
			resourceFacts({
				cwd: "/c",
				reported: false,
				choice: undefined,
				skills: [],
				excluded: [],
				contextFiles: true,
			}),
		).toEqual({ cwd: "/c" });
	});

	it("reported true gives all five fields", () => {
		const facts = resourceFacts({
			cwd: "/c",
			reported: true,
			choice: undefined,
			skills: [{ filePath: "/s/SKILL.md" }],
			excluded: ["npm:a"],
			contextFiles: false,
		});
		expect(facts).toEqual({
			cwd: "/c",
			inheritSkills: true,
			skillPaths: ["/s/SKILL.md"],
			excludedExtensionPackages: ["npm:a"],
			contextFiles: false,
		});
		expect(Object.isFrozen(facts)).toBe(true);
	});

	it("takes inheritSkills from the choice", () => {
		const facts = resourceFacts({
			cwd: "/c",
			reported: true,
			choice: { inherit: false, paths: [], skillFiles: [] },
			skills: [],
			excluded: [],
			contextFiles: true,
		});
		expect(facts.inheritSkills).toBe(false);
	});
});

describe("excludedPackageUnion", () => {
	it("union keeps setting order, no duplicates", () => {
		expect(excludedPackageUnion(["a", "b"], ["b", "c"])).toEqual([
			"a",
			"b",
			"c",
		]);
	});
});
