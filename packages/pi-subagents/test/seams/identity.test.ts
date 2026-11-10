import { describe, expect, it } from "vitest";
import { createChildLifecyclePublisher } from "#src/lifecycle/child-lifecycle";
import { createSubagentSession } from "#src/lifecycle/create-subagent-session";
import { SubagentEventsObserver } from "#src/observation/subagent-events-observer";
import { effectiveFacts, launchIdentity } from "#src/seams/identity";
import { toSubagentRecord } from "#src/service/service-adapter";
import { createTestSubagent } from "#test/helpers/make-subagent";
import { STUB_SNAPSHOT } from "#test/helpers/stub-ctx";
import {
  createAgentLookup,
  createFactorySession,
  createSubagentSessionDeps,
  createSubagentSessionIO,
} from "#test/helpers/subagent-session-io";

const noNotifications = {
  sendCompletion: () => undefined,
  sendUpdate: () => undefined,
  sendWorkspaceNotice: () => undefined,
  dispose: () => undefined,
};

async function createChild(parentToolCallId: string | undefined, session = createFactorySession()) {
  const io = createSubagentSessionIO();
  io.createSession.mockResolvedValue({ session });
  const events: Array<{ channel: string; data: Record<string, unknown> }> = [];
  const lifecycle = createChildLifecyclePublisher((channel, data) =>
    events.push({ channel, data: data as Record<string, unknown> }),
  );
  await createSubagentSession(
    {
      agentId: "a1",
      snapshot: STUB_SNAPSHOT,
      type: "Explore",
      parentSession: { parentSessionId: "p1", toolCallId: parentToolCallId },
    },
    createSubagentSessionDeps({ io, exec: () => undefined as never, registry: createAgentLookup(), lifecycle: lifecycle as never }),
  );
  return events;
}

describe("launch identity on child events", () => {
  it("tool-call launch", async () => {
    const events = await createChild("call_1");
    const created = events.find((e) => e.channel === "subagents:child:session-created");

    expect(created?.data).toMatchObject({
      sessionId: "child-session-id",
      agentId: "a1",
      agentType: "Explore",
      toolCallId: "call_1",
    });
    for (const channel of ["subagents:child:spawning", "subagents:child:bound"]) {
      expect(events.find((e) => e.channel === channel)?.data).toMatchObject({
        agentId: "a1",
        agentType: "Explore",
        toolCallId: "call_1",
      });
    }
  });

  it("service launch", async () => {
    const events = await createChild(undefined);
    const created = events.find((e) => e.channel === "subagents:child:session-created");

    expect(created?.data).toMatchObject({ agentId: "a1", agentType: "Explore" });
    expect(created?.data).not.toHaveProperty("toolCallId");
  });

  it("launchIdentity omits an absent toolCallId", () => {
    expect(launchIdentity({ id: "a1", type: "Plan" })).toEqual({ agentId: "a1", agentType: "Plan" });
  });
});

describe("record events carry the tool call id", () => {
  function observe() {
    const emitted: Array<{ channel: string; data: Record<string, unknown> }> = [];
    const observer = new SubagentEventsObserver({
      emit: (channel, data) => emitted.push({ channel, data: data as Record<string, unknown> }),
      appendEntry: () => undefined,
      notifications: noNotifications,
    });
    return { emitted, observer };
  }

  it("completion of a tool-call launch carries it", () => {
    const { emitted, observer } = observe();
    const record = createTestSubagent({ id: "a1", toolCallId: "call_2", status: "completed" });

    observer.onSubagentRunFinished(record, "initial");

    expect(emitted[0]?.channel).toBe("subagents:completed");
    expect(emitted[0]?.data).toMatchObject({ id: "a1", toolCallId: "call_2" });
  });

  it("resume from a tool call carries the resume's call id", () => {
    const { emitted, observer } = observe();
    const record = createTestSubagent({ id: "a1", toolCallId: "call_1", status: "running" });
    Object.defineProperty(record, "currentToolCallId", { value: "call_3" });

    observer.onSubagentRunStarted(record, "resume");
    observer.onSubagentRunFinished(record, "resume");

    expect(emitted.map((e) => e.channel)).toEqual(["subagents:resuming", "subagents:resumed"]);
    for (const e of emitted) expect(e.data).toMatchObject({ id: "a1", toolCallId: "call_3" });
  });

  it("service launches omit it", () => {
    const { emitted, observer } = observe();

    observer.onSubagentCreated(createTestSubagent({ id: "a2" }));
    observer.onSubagentRunStarted(createTestSubagent({ id: "a2" }), "initial");

    for (const e of emitted) expect(e.data).not.toHaveProperty("toolCallId");
  });
});

describe("effective launch facts", () => {
  it("records provider/id and thinking from the created session", async () => {
    const session = createFactorySession();
    Object.assign(session, { model: { provider: "fixture", id: "fixture-fast" }, thinkingLevel: "medium" });

    const events = await createChild(undefined, session);

    expect(events.find((e) => e.channel === "subagents:child:session-created")?.data).toMatchObject({
      effectiveModel: "fixture/fixture-fast",
      effectiveThinking: "medium",
    });
  });

  it("locked model wins: the session's model is what is reported", () => {
    expect(effectiveFacts({ model: { provider: "fixture", id: "fixture-deep" }, thinkingLevel: "high" })).toEqual({
      effectiveModel: "fixture/fixture-deep",
      effectiveThinking: "high",
    });
  });

  it("queued record has neither effective field", () => {
    const record = toSubagentRecord(createTestSubagent({ id: "q1", status: "queued" }));

    expect(record).not.toHaveProperty("effectiveModel");
    expect(record).not.toHaveProperty("effectiveThinking");
  });

  it("record snapshot carries them once the session exists", () => {
    const agent = createTestSubagent({ id: "a1" });
    Object.defineProperty(agent, "effective", {
      value: { effectiveModel: "fixture/fixture-fast", effectiveThinking: "medium" },
    });

    expect(toSubagentRecord(agent)).toMatchObject({
      effectiveModel: "fixture/fixture-fast",
      effectiveThinking: "medium",
    });
  });
});
