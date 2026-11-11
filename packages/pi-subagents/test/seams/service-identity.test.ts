import { afterEach, describe, expect, it } from "vitest";
import { ServicePublication } from "#src/seams/service-identity";
import type { SubagentsService } from "#src/service/service";
import {
	getSubagentsService,
	publishSubagentsService,
	unpublishSubagentsService,
} from "#src/service/service";

function fakeService(implementation = "@ttdua/pi-subagents"): SubagentsService {
	return { implementation, sessionId: "" } as unknown as SubagentsService;
}

afterEach(() => {
	unpublishSubagentsService();
});

describe("service ownership", () => {
	it("publishes when the slot is empty", () => {
		const service = fakeService();
		new ServicePublication(service).publish();
		expect(getSubagentsService()).toBe(service);
	});

	it("does not replace a service this implementation already published", () => {
		const main = fakeService();
		new ServicePublication(main).publish();
		new ServicePublication(fakeService()).publish();
		expect(getSubagentsService()).toBe(main);
	});

	it("replaces a service another implementation published", () => {
		publishSubagentsService(fakeService("@gotgenes/pi-subagents"));
		const service = fakeService();
		new ServicePublication(service).publish();
		expect(getSubagentsService()).toBe(service);
	});

	it("a non-publishing instance's stop leaves the slot alone", () => {
		const main = fakeService();
		new ServicePublication(main).publish();
		const child = new ServicePublication(fakeService());
		child.publish();
		child.stop();
		expect(getSubagentsService()).toBe(main);
	});

	it("stop removes only its own service", () => {
		const own = new ServicePublication(fakeService());
		own.publish();
		const foreign = fakeService("@gotgenes/pi-subagents");
		publishSubagentsService(foreign);
		own.stop();
		expect(getSubagentsService()).toBe(foreign);
	});

	it("stop removes the instance's own service", () => {
		const own = new ServicePublication(fakeService());
		own.publish();
		own.stop();
		expect(getSubagentsService()).toBeUndefined();
	});
});
