/**
 * fork-stubs.ts — Declarations for parent tools the fork's own SDK session
 * cannot build.
 *
 * A fork declares exactly the parent's tools. A tool the parent registered
 * through the SDK, a parent-only extension, or a package the child excludes has
 * no definition in the fork's registry, and the SDK drops unregistered names.
 * Each such tool gets a stub with the parent's name, description and parameters
 * whose implementation refuses; it is never in the callable set.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ToolDeclaration } from "#src/lifecycle/parent-snapshot";
import { refusalReason } from "#src/lifecycle/fork-guard";
import { builtinExtensionsFor } from "#src/session/builtin-extensions";

/** The tools the SDK builds into every session. */
const SDK_TOOLS: ReadonlySet<string> = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);

/** Looks up what an extension registered under a name in the bound session. */
export type RealToolLookup = (name: string) => ToolDefinition | undefined;

/**
 * A tool that declares like the parent's. At call time it runs the real
 * implementation if the session registered one (an extension may register in
 * `session_start`, after the stub was declared), and refuses otherwise.
 */
export function refusingStub(declaration: ToolDeclaration, real: () => RealToolLookup | undefined): ToolDefinition {
  return {
    name: declaration.name,
    label: declaration.name,
    description: declaration.description,
    parameters: declaration.parameters,
    execute: async (...args: Parameters<ToolDefinition["execute"]>) => {
      const impl = real()?.(declaration.name);
      if (!impl) throw new Error(refusalReason(declaration.name));
      return impl.execute(...args);
    },
  } as ToolDefinition;
}

/**
 * The stubs for the parent's declarations the fork cannot provide: neither an
 * SDK tool, a Pi built-in extension's tool, nor a tool a loaded extension
 * registers (`loaded`).
 */
export function missingToolStubs(
  declarations: readonly ToolDeclaration[],
  loaded: ReadonlySet<string>,
  real: () => RealToolLookup | undefined,
): ToolDefinition[] {
  return declarations
    .filter((tool) => !SDK_TOOLS.has(tool.name) && !loaded.has(tool.name))
    .filter((tool) => builtinExtensionsFor([tool.name]).length === 0)
    .map((tool) => refusingStub(tool, real));
}
