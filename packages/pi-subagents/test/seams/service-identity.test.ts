import { afterEach, describe, expect, it } from "vitest";
import {
  SUBAGENT_CHILD_DISPOSED,
  SUBAGENT_CHILD_SESSION_CREATED,
} from "#src/lifecycle/child-lifecycle";
import { getSubagentsService, unpublishSubagentsService } from "#src/service/service";
import type { SubagentsService } from "#src/service/service";
import {
  childSessionIds,
  ServicePublication,
  trackChildSessions,
} from "#src/seams/service-identity";

const CHILDREN_KEY = Symbol.for("@ttdua/pi-subagents:children");

function fakeService(sessionId: string): SubagentsService {
  return { implementation: "@ttdua/pi-subagents", sessionId } as unknown as SubagentsService;
}

afterEach(() => {
  unpublishSubagentsService();
  delete (globalThis as Record<symbol, unknown>)[CHILDREN_KEY];
});

describe("service identity", () => {
  it("children do not replace the main service", () => {
    const emitted: string[] = [];
    const emit = trackChildSessions((channel) => emitted.push(channel));
    const main = new ServicePublication();
    main.start("main-1", fakeService);
    const mainService = getSubagentsService();

    for (const childId of ["child-1", "child-2"]) {
      emit(SUBAGENT_CHILD_SESSION_CREATED, { sessionId: childId });
      const child = new ServicePublication();
      child.start(childId, fakeService);
      child.stop();
      emit(SUBAGENT_CHILD_DISPOSED, { sessionId: childId });
    }

    expect(getSubagentsService()).toBe(mainService);
    expect(getSubagentsService()?.implementation).toBe("@ttdua/pi-subagents");
    expect(getSubagentsService()?.sessionId).toBe("main-1");
    expect(emitted).toHaveLength(4);
  });

  it("records child ids until disposed, process-wide", () => {
    const emit = trackChildSessions(() => undefined);
    emit(SUBAGENT_CHILD_SESSION_CREATED, { sessionId: "c1" });
    expect(childSessionIds().has("c1")).toBe(true);
    expect(((globalThis as Record<symbol, unknown>)[CHILDREN_KEY] as Set<string>).has("c1")).toBe(true);
    emit(SUBAGENT_CHILD_DISPOSED, { sessionId: "c1" });
    expect(childSessionIds().has("c1")).toBe(false);
  });

  it("shutdown removes only its own service", () => {
    const first = new ServicePublication();
    const second = new ServicePublication();
    first.start("s1", fakeService);
    second.start("s2", fakeService);
    const secondService = getSubagentsService();

    first.stop();

    expect(getSubagentsService()).toBe(secondService);
    second.stop();
    expect(getSubagentsService()).toBeUndefined();
  });
});
