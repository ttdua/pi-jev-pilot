# Upstream issue draft: `ctx.signal` is undefined in `before_agent_start`

Status: draft. Not posted. It is posted only with the operator's go-ahead.

## Title

`ctx.signal` is undefined in `before_agent_start`

## Version

`@earendil-works/pi-coding-agent` 1.5.0 (with `@earendil-works/pi-agent-core` 1.5.0).

## Where

In `dist/core/agent-session.js`, `_startRun` awaits `_prepareRun`, which runs every `before_agent_start` handler, and only then calls `agent.prompt`. The extension context is built with `getSignal: () => this.agent.signal`. In `dist/agent.js` of `pi-agent-core`, `get signal()` returns `activeRun?.abortController.signal`, and the active run is created by `runWithLifecycle`, which has not started yet while the handlers run. So `ctx.signal` is `undefined` for the whole duration of every `before_agent_start` handler.

## Impact

An extension that awaits slow work in `before_agent_start` (for example a network request to classify the prompt) cannot react when the operator presses Esc. Pi records the request (`_agentRunAbortRequested`) and aborts the run at `agent_start`, so no provider request is sent. That part is correct. But the handler keeps waiting until its own work ends, and anything it applied in the meantime (such as a thinking level set with `setThinkingLevel`) stays on the session even though the turn never ran.

## Request

Expose a signal in `before_agent_start` that is aborted when the starting run is aborted, including an abort requested while the handlers are still running. The natural place is `ctx.signal`, so that existing code written as `fetch(url, { signal: ctx.signal })` works there without change.

## Minimal reproduction

An extension with one handler that sleeps and reports the signal:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (_event, ctx) => {
    console.error(`before_agent_start signal: ${ctx.signal === undefined ? "undefined" : "defined"}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.error("before_agent_start: sleep finished");
  });
}
```

Steps:

1. Load the extension and send any prompt.
2. Observe `before_agent_start signal: undefined`.
3. Press Esc during the five seconds. The handler is not notified; it finishes the sleep, and the run is then aborted at `agent_start` with no provider request.

Expected: `ctx.signal` is defined in `before_agent_start` and aborts at step 3, so the handler can stop early.
