/**
 * prompts.ts — System prompt builder for fresh child agents.
 */

import type { EnvInfo } from "#src/session/env";
import type { AgentPromptConfig } from "#src/types";

/**
 * Compose the content of a fresh child's `<agent>` section: the per-call
 * header, then the agent body last. A blank body is omitted.
 */
export function composeAgentSection(header: string, body: string): string {
  return header + (body.trim() ? "\n\n" + body : "");
}

/**
 * Build the header a fresh child carries: the `<active_agent>` tag and the
 * environment block. Both vary per invocation, so they sit in the agent section.
 *
 * `<active_agent>` lets downstream extensions (e.g.
 * `@gotgenes/pi-permission-system`) resolve per-agent policy from the prompt.
 */
export function buildAgentPrompt(config: AgentPromptConfig, cwd: string, env: EnvInfo): string {
  return buildPromptHeader(config.name, cwd, env);
}

/**
 * The per-call header: the `<active_agent>` tag and the environment block.
 */
function buildPromptHeader(agentName: string, cwd: string, env: EnvInfo): string {
  const activeAgentTag = `<active_agent name="${agentName}"/>`;

  const envBlock = `# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;

  return `${activeAgentTag}\n\n${envBlock}`;
}
