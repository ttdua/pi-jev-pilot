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
		// The guard's cancellation state exists before the policy runs, so an
		// abort during the call (watchdog or run cancel) always discards its result.
		const guard = new ConsultGuard(registration.timeoutMs, runSignal);
		try {
			if (guard.signal.aborted) return undefined;
			const outcome = await guard.race(
				callPolicy(registration.policy, request, guard.signal),
			);
			return adjustmentOf(outcome, guard);
		} catch (err) {
			// Reading the returned value can throw (a getter, a Proxy): fail open.
			debugLog("launch policy adjustment unreadable; launch unchanged", err);
			guard.abort();
			return undefined;
		} finally {
			guard.dispose();
		}
	}
}

/** How a policy call ended, seen through the guard. */
type PolicyOutcome =
	| { kind: "value"; value: unknown }
	| { kind: "error"; error: unknown }
	| { kind: "aborted" };

/** The outcome as an adjustment; anything but a valid value before abort is none. */
function adjustmentOf(
	outcome: PolicyOutcome,
	guard: ConsultGuard,
): LaunchAdjustment | undefined {
	// Checked first: a result produced once the guard aborted is discarded,
	// whichever promise won the race.
	if (outcome.kind === "aborted" || guard.signal.aborted) return undefined;
	if (outcome.kind === "error") {
		debugLog("launch policy failed; launch unchanged", outcome.error);
		guard.abort();
		return undefined;
	}
	const adjustment = validAdjustment(outcome.value);
	if (adjustment === undefined && outcome.value !== undefined) {
		debugNote("launch policy returned a malformed adjustment; ignored");
		guard.abort();
	}
	return adjustment;
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

	/**
	 * Settle with how `work` ended, or `aborted` once the guard aborts. The
	 * rejection of `work` is observed on every path, including after an abort.
	 */
	race(work: Promise<unknown>): Promise<PolicyOutcome> {
		const settled = work.then(
			(value): PolicyOutcome => ({ kind: "value", value }),
			(error: unknown): PolicyOutcome => ({ kind: "error", error }),
		);
		const signal = this.controller.signal;
		if (signal.aborted) return Promise.resolve({ kind: "aborted" });
		const aborted = new Promise<PolicyOutcome>((resolve) => {
			signal.addEventListener("abort", () => resolve({ kind: "aborted" }), {
				once: true,
			});
		});
		return Promise.race([settled, aborted]);
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
