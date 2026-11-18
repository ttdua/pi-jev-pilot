/**
 * fresh-prompt-extension.ts — puts the agent's header and body in a fresh
 * child's own session prompt.
 *
 * Pi renders custom sections after `<cwd>`, so the `<agent>` section is the
 * last one and the agent body ends the prompt.
 */

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

/** An internal child extension that sets `sections.agent` before each run. */
export function freshPromptExtension(section: string): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => {
      event.systemPromptOptions.sections.agent = section;
    });
  };
}
