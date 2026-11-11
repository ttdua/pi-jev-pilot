/**
 * launch-policy.ts — The single launch policy slot and its fail-open call.
 *
 * One policy may be registered at a time. Each consultation runs the policy
 * against a watchdog and the launch's own run signal, with one
 * `AbortController` aborted by either; any failure yields no adjustment.
 */

import { parseThinkingLevel } from "#src/config/thinking-level";
import { debugLog, debugNote } from "#src/debug";
import type {
	LaunchAdjustment,
	LaunchPolicy,
	LaunchRequest,
} from "#src/service/service";

interface Registration {
	policy: LaunchPolicy;
	timeoutMs: number;
}

/** Holds at most one launch policy and consults it for each new launch. */
export class LaunchPolicySlot {
	private current?: Registration;

	/** Whether a policy is registered now. */
	get registered(): boolean {
		return this.current !== undefined;
	}

	/**
	 * Register `policy`; throws while another is registered. The returned
	 * function unregisters this registration only, so a stale call is a no-op.
	 */
	register(policy: LaunchPolicy, options: { timeoutMs: number }): () => void {
		if (this.current) throw new Error("launch policy slot is taken");
		const registration: Registration = {
			policy,
			timeoutMs: options.timeoutMs,
		};
		this.current = registration;
		return () => {
			if (this.current === registration) this.current = undefined;
		};
	}

	/**
	 * Ask the registered policy for an adjustment. Resolves `undefined` when no
	 * policy is registered, or when the policy throws, rejects, returns a
	 * malformed value, outlives `timeoutMs`, or `runSignal` aborts; in each of
	 * those cases the policy's signal is aborted.
	 */
	async consult(
		request: LaunchRequest,
		runSignal?: AbortSignal,
	): Promise<LaunchAdjustment | undefined> {
		const registration = this.current;
		if (!registration) return undefined;
		const guard = new ConsultGuard(registration.timeoutMs, runSignal);
		try {
			const value = await guard.race(
				callPolicy(registration.policy, request, guard.signal),
			);
			const adjustment = validAdjustment(value);
			if (adjustment === undefined && value !== undefined) {
				debugNote("launch policy returned a malformed adjustment; ignored");
				guard.abort();
			}
			return adjustment;
		} catch (err) {
			debugLog("launch policy failed; launch unchanged", err);
			guard.abort();
			return undefined;
		} finally {
			guard.dispose();
		}
	}
}

/** One controller aborted by the watchdog or the run signal, whichever fires first. */
class ConsultGuard {
	private readonly controller = new AbortController();
	private readonly timer: ReturnType<typeof setTimeout>;
	private readonly onRunAbort = () => {
		this.abort();
	};

	constructor(
		timeoutMs: number,
		private readonly runSignal: AbortSignal | undefined,
	) {
		this.timer = setTimeout(() => {
			debugNote(`launch policy exceeded ${timeoutMs} ms; launch unchanged`);
			this.abort();
		}, timeoutMs);
		if (runSignal?.aborted) this.abort();
		else runSignal?.addEventListener("abort", this.onRunAbort, { once: true });
	}

	get signal(): AbortSignal {
		return this.controller.signal;
	}

	abort(): void {
		this.controller.abort();
	}

	/** Settle with `work`, or with `undefined` once the guard aborts. */
	race<T>(work: Promise<T>): Promise<T | undefined> {
		const signal = this.controller.signal;
		if (signal.aborted) return Promise.resolve(undefined);
		const aborted = new Promise<undefined>((resolve) => {
			signal.addEventListener("abort", () => resolve(undefined), {
				once: true,
			});
		});
		return Promise.race([work, aborted]);
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.runSignal?.removeEventListener("abort", this.onRunAbort);
	}
}

/** Call the policy, turning a synchronous throw into a rejection. */
function callPolicy(
	policy: LaunchPolicy,
	request: LaunchRequest,
	signal: AbortSignal,
): Promise<unknown> {
	try {
		return Promise.resolve(policy(request, signal));
	} catch (err) {
		return Promise.reject(err);
	}
}

/** The value as a `LaunchAdjustment`, or `undefined` when it is not one. */
export function validAdjustment(value: unknown): LaunchAdjustment | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return undefined;
	const raw = value as Record<string, unknown>;
	if (raw.model !== undefined && typeof raw.model !== "string")
		return undefined;
	const thinking =
		raw.thinking === undefined ? undefined : parseThinkingLevel(raw.thinking);
	if (raw.thinking !== undefined && thinking === undefined) return undefined;
	if (!isOptionalNameList(raw.addTools) || !isOptionalNameList(raw.removeTools))
		return undefined;
	return pickDefined({
		model: raw.model as string | undefined,
		thinking,
		addTools: raw.addTools as readonly string[] | undefined,
		removeTools: raw.removeTools as readonly string[] | undefined,
	});
}

function isOptionalNameList(value: unknown): boolean {
	return (
		value === undefined ||
		(Array.isArray(value) && value.every((name) => typeof name === "string"))
	);
}

function pickDefined(adjustment: LaunchAdjustment): LaunchAdjustment {
	const out: LaunchAdjustment = {};
	if (adjustment.model !== undefined) out.model = adjustment.model;
	if (adjustment.thinking !== undefined) out.thinking = adjustment.thinking;
	if (adjustment.addTools !== undefined)
		out.addTools = [...adjustment.addTools];
	if (adjustment.removeTools !== undefined)
		out.removeTools = [...adjustment.removeTools];
	return out;
}
