/**
 * service-identity.ts — Which extension instance owns the published service.
 *
 * Every session, including every child, loads its own instance of this
 * extension. An instance publishes its service when it loads, as upstream does,
 * so load-time consumers keep working; but it leaves the slot alone when a
 * service of this implementation is already there. The main session's instance
 * loads before any child's, so children never replace it. An instance only
 * removes a service it published itself.
 */

import {
  getSubagentsService,
  publishSubagentsService,
  unpublishSubagentsService,
  type SubagentsService,
} from "#src/service/service";

/** One instance's claim on the published service, from load to shutdown. */
export class ServicePublication {
  private published = false;

  constructor(private readonly service: SubagentsService) {}

  /** Publish the service unless this implementation's service already holds the slot. */
  publish(): void {
    if (getSubagentsService()?.implementation === this.service.implementation) return;
    publishSubagentsService(this.service);
    this.published = true;
  }

  /** Remove the service this instance published, leaving any other in place. */
  stop(): void {
    if (this.published && getSubagentsService() === this.service) unpublishSubagentsService();
    this.published = false;
  }
}
