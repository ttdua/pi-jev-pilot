/**
 * service-identity.ts — Which extension instance owns the published service.
 *
 * Every session, including every child, loads its own instance of this
 * extension. Only the main session's instance may publish the service, and an
 * instance may only remove a service it published itself.
 *
 * The executor emits `subagents:child:session-created` before it binds the
 * child's extensions, so the ids recorded here are known by the time a child's
 * `session_start` runs. The set is process-wide (a `Symbol.for` global) because
 * the child's instance is a different module copy from the parent's.
 */

import {
  SUBAGENT_CHILD_DISPOSED,
  SUBAGENT_CHILD_SESSION_CREATED,
  type LifecycleEmit,
} from "#src/lifecycle/child-lifecycle";
import {
  getSubagentsService,
  publishSubagentsService,
  unpublishSubagentsService,
  type SubagentsService,
} from "#src/service/service";

const CHILDREN_KEY = Symbol.for("@ttdua/pi-subagents:children");

function childSet(): Set<string> {
  const holder = globalThis as Record<symbol, unknown>;
  let set = holder[CHILDREN_KEY] as Set<string> | undefined;
  if (!set) {
    set = new Set<string>();
    holder[CHILDREN_KEY] = set;
  }
  return set;
}

/** Ids of the child sessions this process has created and not yet disposed. */
export function childSessionIds(): ReadonlySet<string> {
  return childSet();
}

/** Wrap an emit so child session ids are recorded as the executor announces them. */
export function trackChildSessions(emit: LifecycleEmit): LifecycleEmit {
  return (channel, data) => {
    const sessionId = (data as { sessionId?: unknown } | undefined)?.sessionId;
    if (typeof sessionId === "string") {
      if (channel === SUBAGENT_CHILD_SESSION_CREATED) childSet().add(sessionId);
      if (channel === SUBAGENT_CHILD_DISPOSED) childSet().delete(sessionId);
    }
    emit(channel, data);
  };
}

/** Publish `service` unless `sessionId` is a child session. Returns whether it published. */
export function publishIfMain(service: SubagentsService, sessionId: string): boolean {
  if (childSet().has(sessionId)) return false;
  publishSubagentsService(service);
  return true;
}

/** Remove the published service only when it is `service`. */
export function unpublishIfOwn(service: SubagentsService | undefined): void {
  if (service && getSubagentsService() === service) unpublishSubagentsService();
}

/** One instance's claim on the published service, from `session_start` to shutdown. */
export class ServicePublication {
  private published: SubagentsService | undefined;

  /** Publish the service built for `sessionId`, if that session is a main session. */
  start(sessionId: string, build: (sessionId: string) => SubagentsService): void {
    if (childSet().has(sessionId)) return;
    const service = build(sessionId);
    if (publishIfMain(service, sessionId)) this.published = service;
  }

  /** Remove the service this instance published, leaving any other in place. */
  stop(): void {
    unpublishIfOwn(this.published);
    this.published = undefined;
  }
}
