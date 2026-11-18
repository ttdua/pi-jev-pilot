/**
 * fork-session.ts — Plan a fork: the parent's live branch, a result for every
 * pending tool call, and the instructions message. Pure: no SDK calls.
 *
 * Everything up to and including the synthetic results is the same for every
 * fork from one parent turn, so parallel forks share that prefix; they differ
 * only from the instructions message on.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type { AgentConfig } from "#src/types";

/** The result every call still pending at the parent's leaf gets in a fork. */
export const FORKED_RESULT_TEXT = "Forked: this branch continues as a subagent.";

/** The fork boundary, last line of the instructions block. */
const FORK_BOUNDARY =
  "You are a forked subagent. Do the task below and reply with the result. You cannot start subagents.";

/** What a fork is planned from. */
export interface ForkInput {
  parent: ParentSnapshot;
  agent: AgentConfig;
  /** The child's working directory, named in the instructions. */
  cwd: string;
  task: string;
  /** The parent tools the fork may call; the guard refuses the rest at call time. */
  callableTools: readonly string[];
  /** Tools the agent allows that the parent does not declare; named as unavailable. */
  agentOnlyTools: readonly string[];
}

/** What the fork session is created with. */
export interface ForkPlan {
  /** The parent branch, then one synthetic result per pending call. */
  entries: SessionEntry[];
  /** The instructions block followed by the task: the fork's first prompt. */
  firstMessage: string;
  systemPrompt: string;
  toolNames: readonly string[];
}

export function buildForkSession(input: ForkInput): ForkPlan {
  const branch = [...input.parent.branch];
  return {
    entries: [...branch, ...pendingCallResults(branch)],
    firstMessage: `${instructions(input)}\n\n${input.task}`,
    systemPrompt: input.parent.systemPrompt,
    toolNames: [...input.parent.toolNames],
  };
}

/** The structural slice of a message entry this module reads. */
interface BranchMessage {
  role: string;
  content?: unknown;
  toolCallId?: string;
  timestamp?: number;
}

function messageOf(entry: SessionEntry): BranchMessage | undefined {
  return entry.type === "message" ? (entry.message as BranchMessage) : undefined;
}

interface PendingCall {
  id: string;
  name: string;
}

/** Tool calls of the branch's last assistant message that have no result after it. */
function pendingCalls(branch: readonly SessionEntry[]): { calls: PendingCall[]; timestamp: number } {
  const leafIndex = branch.findLastIndex((entry) => messageOf(entry)?.role === "assistant");
  if (leafIndex < 0) return { calls: [], timestamp: 0 };
  const leaf = messageOf(branch[leafIndex])!;
  const answered = new Set(
    branch.slice(leafIndex + 1).flatMap((entry) => {
      const message = messageOf(entry);
      return message?.role === "toolResult" && message.toolCallId ? [message.toolCallId] : [];
    }),
  );
  const content = Array.isArray(leaf.content) ? (leaf.content as { type: string; id?: string; name?: string }[]) : [];
  const calls = content
    .filter((block) => block.type === "toolCall" && block.id && !answered.has(block.id))
    .map((block) => ({ id: block.id!, name: block.name ?? "" }));
  return { calls, timestamp: leaf.timestamp ?? 0 };
}

/**
 * One synthetic tool result per pending call, deterministic so that forks from
 * one parent turn produce identical entries.
 */
function pendingCallResults(branch: readonly SessionEntry[]): SessionEntry[] {
  const { calls, timestamp } = pendingCalls(branch);
  let parentId = branch.at(-1)?.id ?? null;
  return calls.map((call) => {
    const id = `fork-result-${call.id}`;
    const entry = {
      type: "message",
      id,
      parentId,
      timestamp: new Date(timestamp).toISOString(),
      message: {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: FORKED_RESULT_TEXT }],
        isError: false,
        timestamp,
      },
    } as SessionEntry;
    parentId = id;
    return entry;
  });
}

/** The `<subagent_instructions>` block: agent, directory, body, unavailable tools, boundary. */
function instructions(input: ForkInput): string {
  const lines = [
    "<subagent_instructions>",
    `<active_agent name="${input.agent.name}"/>`,
    `Working directory: ${input.cwd}`,
  ];
  const body = input.agent.systemPrompt.trim();
  if (body) lines.push(body);
  if (input.agentOnlyTools.length > 0) {
    lines.push(`These tools are not available to you here: ${input.agentOnlyTools.join(", ")}.`);
  }
  lines.push(FORK_BOUNDARY, "</subagent_instructions>");
  return lines.join("\n");
}
