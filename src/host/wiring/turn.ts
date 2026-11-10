import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isChild, loadSnapshot } from "../platform/index.ts";
import { hideReviewInChild, syncReviewTool } from "../review/index.ts";
import { settleTuning } from "../tuning/index.ts";
import type { Parts } from "./parts.ts";

/** `before_agent_start`: a child hides the review tool and is assessed; main syncs it, then decides. */
function subscribeBeforeAgentStart(pi: ExtensionAPI, parts: Parts): void {
  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const sessionId = ctx.sessionManager.getSessionId();
      if (isChild(sessionId)) {
        hideReviewInChild(event, sessionId);
        await parts.tools.beforeAgentStart(event, ctx);
        return undefined;
      }
      try {
        syncReviewTool(pi, loadSnapshot(pi).settings.review.enabled);
      } catch {
        /* the turn proceeds with the loadout as it is */
      }
      return await parts.main.beforeAgentStart(event, ctx);
    } catch {
      return undefined;
    }
  });
}

/** The turn handlers that only reach main, and never for a child session. */
function subscribeMainOnly(pi: ExtensionAPI, parts: Parts): void {
  pi.on("before_provider_request", async (_event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return undefined;
      await parts.main.beforeProviderRequest();
    } catch {
      /* swallow: the request goes out unchanged */
    }
    return undefined;
  });

  pi.on("turn_end", async (event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return;
      await parts.main.turnEnd(event);
    } catch {
      /* swallow */
    }
  });
}

/** `agent_settled`: main settles first, then the tuning step; each has its own guard. */
function subscribeAgentSettled(pi: ExtensionAPI, parts: Parts): void {
  pi.on("agent_settled", async (event, ctx) => {
    try {
      if (isChild(ctx.sessionManager.getSessionId())) return;
      await parts.main.agentSettled(event);
    } catch {
      /* swallow */
    }
    try {
      settleTuning(parts.tuningDeps(), ctx);
    } catch {
      /* swallow */
    }
  });
}

/** Subscribes the four turn handlers, in Pi's event order. */
export function subscribeTurn(pi: ExtensionAPI, parts: Parts): void {
  subscribeBeforeAgentStart(pi, parts);
  subscribeMainOnly(pi, parts);
  subscribeAgentSettled(pi, parts);
}
