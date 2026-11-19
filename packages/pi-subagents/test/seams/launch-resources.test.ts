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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertFreshOnly,
	defaultLaunchResourcesIO,
	effectiveSkillChoice,
	type LaunchResources,
	parseLaunchResources,
	recheckLaunchResources,
} from "#src/seams/launch-resources";

let root: string;
let io: ReturnType<typeof defaultLaunchResourcesIO>;

function skill(
	dir: string,
	name: string,
	description = "does a thing",
): string {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "SKILL.md");
	const desc = description ? `description: ${description}\n` : "";
	writeFileSync(file, `---\nname: ${name}\n${desc}---\nBody\n`);
	return file;
}

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "launch-res-")));
	io = defaultLaunchResourcesIO(join(root, "agent"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("parseLaunchResources", () => {
	it("returns undefined with no fields", () => {
		expect(parseLaunchResources({}, io)).toBeUndefined();
	});

	it.each([
		[{ skills: { inherit: "no" } }, /skills\.inherit/],
		[{ skills: { inherit: true, paths: "x" } }, /skills\.paths/],
		[{ excludeExtensionPackages: [""] }, /excludeExtensionPackages/],
		[{ cwd: 1 }, /cwd/],
		[{ contextFiles: "no" }, /contextFiles/],
	])("refuses wrong shapes %#", (input, rule) => {
		// biome-ignore lint/suspicious/noExplicitAny: deliberately wrong shapes
		expect(() => parseLaunchResources(input as any, io)).toThrow(rule);
	});

	it("refuses a relative cwd", () => {
		expect(() => parseLaunchResources({ cwd: "worktrees/u1" }, io)).toThrow(
			/must be absolute.*worktrees\/u1/,
		);
	});

	it("refuses a missing cwd", () => {
		const cwd = join(root, "gone");
		expect(() => parseLaunchResources({ cwd }, io)).toThrow(
			new RegExp(`cwd.*${cwd}`),
		);
	});

	it("refuses a file as cwd", () => {
		const cwd = join(root, "file");
		writeFileSync(cwd, "x");
		expect(() => parseLaunchResources({ cwd }, io)).toThrow(
			new RegExp(`cwd.*${cwd}`),
		);
	});

	it("refuses a relative skill path", () => {
		expect(() =>
			parseLaunchResources(
				{ skills: { inherit: false, paths: ["a/SKILL.md"] } },
				io,
			),
		).toThrow(/must be absolute.*a\/SKILL\.md/);
	});

	it("refuses a missing skill path", () => {
		const p = join(root, "missing", "SKILL.md");
		expect(() =>
			parseLaunchResources({ skills: { inherit: false, paths: [p] } }, io),
		).toThrow(new RegExp(p));
	});

	it("refuses a skill without description", () => {
		const f = skill(join(root, "nodesc"), "nodesc", "");
		expect(() =>
			parseLaunchResources({ skills: { inherit: false, paths: [f] } }, io),
		).toThrow(new RegExp(f));
	});

	it("refuses an empty skill directory", () => {
		const d = join(root, "empty");
		mkdirSync(d);
		expect(() =>
			parseLaunchResources({ skills: { inherit: false, paths: [d] } }, io),
		).toThrow(new RegExp(`no skill.*${d}`));
	});

	it("directory yields every skill", () => {
		const dir = join(root, "skills");
		const a = skill(join(dir, "a"), "a");
		const b = skill(join(dir, "b"), "b");
		const r = parseLaunchResources(
			{ skills: { inherit: false, paths: [dir] } },
			io,
		);
		expect([...(r?.skills?.skillFiles ?? [])].sort()).toEqual([a, b].sort());
	});

	it("dedupes a repeated path keeping first order", () => {
		const a = skill(join(root, "a"), "a");
		const b = skill(join(root, "b"), "b");
		const r = parseLaunchResources(
			{ skills: { inherit: false, paths: [a, b, a] } },
			io,
		);
		expect(r?.skills?.paths).toEqual([a, b]);
	});

	it("dedupes a symlinked duplicate", () => {
		const a = skill(join(root, "a"), "a");
		const link = join(root, "link.md");
		symlinkSync(a, link);
		const r = parseLaunchResources(
			{ skills: { inherit: false, paths: [a, link] } },
			io,
		);
		expect(r?.skills?.paths).toEqual([a]);
	});

	it("refuses two files with one skill name", () => {
		const a = skill(join(root, "x", "a"), "plan");
		const b = skill(join(root, "y", "a"), "plan");
		expect(() =>
			parseLaunchResources({ skills: { inherit: false, paths: [a, b] } }, io),
		).toThrow(new RegExp(`^Skill name collision:.*plan.*${a}.*${b}`));
	});

	it("freezes and detaches", () => {
		const a = skill(join(root, "a"), "a");
		const paths = [a];
		const r = parseLaunchResources({ skills: { inherit: false, paths } }, io);
		paths.push("/nope");
		expect(r?.skills?.paths).toEqual([a]);
		expect(Object.isFrozen(r)).toBe(true);
		expect(Object.isFrozen(r?.skills)).toBe(true);
		expect(Object.isFrozen(r?.skills?.paths)).toBe(true);
		expect(Object.isFrozen(r?.skills?.skillFiles)).toBe(true);
	});

	it("keeps cwd, contextFiles and exclusions", () => {
		const r = parseLaunchResources(
			{ cwd: root, contextFiles: false, excludeExtensionPackages: ["npm:x"] },
			io,
		);
		expect(r).toEqual({
			cwd: root,
			contextFiles: false,
			excludeExtensionPackages: ["npm:x"],
		});
		expect(Object.isFrozen(r?.excludeExtensionPackages)).toBe(true);
	});
});

describe("effectiveSkillChoice", () => {
	it("is undefined without skills and pin", () => {
		expect(effectiveSkillChoice(undefined, false)).toBeUndefined();
		expect(effectiveSkillChoice({ cwd: "/x" }, false)).toBeUndefined();
	});

	it("pin alone loads nothing", () => {
		expect(effectiveSkillChoice(undefined, true)).toEqual({
			inherit: false,
			paths: [],
			skillFiles: [],
		});
	});

	it("pin forces inherit false but keeps caller paths", () => {
		const r: LaunchResources = {
			skills: { inherit: true, paths: ["/p"], skillFiles: ["/p/SKILL.md"] },
		};
		expect(effectiveSkillChoice(r, true)).toEqual({
			inherit: false,
			paths: ["/p"],
			skillFiles: ["/p/SKILL.md"],
		});
		expect(effectiveSkillChoice(r, false)?.inherit).toBe(true);
	});
});

describe("assertFreshOnly", () => {
	const base = { agentName: "explore", pinned: false };

	it.each([
		[{ skills: { inherit: false, paths: [], skillFiles: [] } }, "skills"],
		[{ excludeExtensionPackages: [] }, "excludeExtensionPackages"],
		[{ cwd: "/x" }, "cwd"],
		[{ contextFiles: true }, "contextFiles"],
	])("refuses %# on fork", (resources, field) => {
		expect(() =>
			assertFreshOnly({ ...base, resources, context: "fork" }),
		).toThrow(
			new RegExp(`^Launch resources apply to fresh launches only.*${field}`),
		);
	});

	it("refuses a pinned agent on fork", () => {
		expect(() =>
			assertFreshOnly({
				resources: undefined,
				agentName: "planner",
				pinned: true,
				context: "fork",
			}),
		).toThrow(/planner/);
	});

	it("passes anything on fresh and nothing on fork", () => {
		expect(() =>
			assertFreshOnly({
				...base,
				resources: { cwd: "/x", contextFiles: false },
				pinned: true,
				context: "fresh",
			}),
		).not.toThrow();
		expect(() =>
			assertFreshOnly({ ...base, resources: undefined, context: "fork" }),
		).not.toThrow();
	});
});

describe("recheckLaunchResources", () => {
	it("passes unchanged and for undefined", () => {
		const dir = join(root, "skills");
		skill(join(dir, "a"), "a");
		const r = parseLaunchResources(
			{ cwd: root, skills: { inherit: false, paths: [dir] } },
			io,
		);
		expect(() => recheckLaunchResources(r, io)).not.toThrow();
		expect(() => recheckLaunchResources(undefined, io)).not.toThrow();
	});

	it("fails when cwd is removed", () => {
		const cwd = join(root, "w");
		mkdirSync(cwd);
		const r = parseLaunchResources({ cwd }, io);
		rmSync(cwd, { recursive: true });
		expect(() => recheckLaunchResources(r, io)).toThrow(
			new RegExp(`^Launch resources no longer valid:.*${cwd}`),
		);
	});

	it("fails when a skill is removed from a listed directory", () => {
		const dir = join(root, "skills");
		const a = skill(join(dir, "a"), "a");
		skill(join(dir, "b"), "b");
		const r = parseLaunchResources(
			{ skills: { inherit: false, paths: [dir] } },
			io,
		);
		rmSync(join(dir, "a"), { recursive: true });
		expect(() => recheckLaunchResources(r, io)).toThrow(
			new RegExp(`^Launch resources no longer valid:.*${a}`),
		);
	});

	it("fails when a skill turns invalid", () => {
		const a = skill(join(root, "a"), "a");
		const r = parseLaunchResources(
			{ skills: { inherit: false, paths: [a] } },
			io,
		);
		skill(join(root, "a"), "a", "");
		expect(() => recheckLaunchResources(r, io)).toThrow(
			new RegExp(`^Launch resources no longer valid:.*${a}`),
		);
	});
});
