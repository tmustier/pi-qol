import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type AssistantLike = {
	role?: unknown;
	stopReason?: unknown;
	errorMessage?: unknown;
	responseId?: unknown;
};

type RecoveryPolicy =
	| { action: "continue_now"; reason: string }
	| { action: "continue_after_backoff"; reason: string }
	| { action: "retry_once"; reason: string }
	| { action: "ignore" };

const DEFAULT_CONTINUE_MESSAGE = "continue";
const DEFAULT_MAX_CONSECUTIVE_RESUMES = 3;
const DEFAULT_TRANSIENT_BACKOFF_MS = [2_000, 5_000, 15_000];

function normalizeError(value: string): string {
	return value.trim().toLowerCase().replace(/^error\s*:\s*/, "").trim();
}

function configuredContinueMessage(): string {
	return process.env.PI_AUTO_CONTINUE_MESSAGE?.trim() || DEFAULT_CONTINUE_MESSAGE;
}

function configuredMaxConsecutiveResumes(): number {
	const raw = process.env.PI_AUTO_CONTINUE_MAX_CONSECUTIVE;
	if (!raw) return DEFAULT_MAX_CONSECUTIVE_RESUMES;

	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONSECUTIVE_RESUMES;
}

function configuredTransientBackoffMs(): number[] {
	const raw = process.env.PI_AUTO_CONTINUE_TRANSIENT_BACKOFF_MS;
	if (!raw?.trim()) return DEFAULT_TRANSIENT_BACKOFF_MS;

	const parsed = raw
		.split(",")
		.map((value) => Number.parseInt(value.trim(), 10))
		.filter((value) => Number.isFinite(value) && value >= 0);

	return parsed.length > 0 ? parsed : DEFAULT_TRANSIENT_BACKOFF_MS;
}

function isAssistantLike(message: unknown): message is AssistantLike {
	return !!message && typeof message === "object" && (message as AssistantLike).role === "assistant";
}

function lastAssistantMessage(messages: unknown[]): AssistantLike | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (isAssistantLike(message)) return message;
	}
	return undefined;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(value));
}

function classifyError(errorMessage: unknown): RecoveryPolicy {
	if (typeof errorMessage !== "string") return { action: "ignore" };

	const normalized = normalizeError(errorMessage);

	// 1. Interruption-like failures: resume immediately.
	if (normalized === "terminated") {
		return { action: "continue_now", reason: "terminated" };
	}

	// 2. Transient provider/network failures: resume after backoff.
	if (
		normalized === "fetch failed" ||
		normalized === "request timed out." ||
		normalized === "request timed out" ||
		normalized === "connection error." ||
		normalized === "connection error" ||
		normalized === "websocket error." ||
		normalized === "websocket error"
	) {
		return { action: "continue_after_backoff", reason: normalized };
	}

	if (
		matchesAny(normalized, [
			/"code"\s*:\s*"server_is_overloaded"/,
			/"code"\s*:\s*"server_error"/,
			/"type"\s*:\s*"overloaded_error"/,
			/"type"\s*:\s*"api_error"/,
		])
	) {
		return { action: "continue_after_backoff", reason: "transient provider error" };
	}

	// 3. Malformed model/tool-call JSON: retry once per error streak.
	if (
		matchesAny(errorMessage, [
			/Bad control character in string literal in JSON/i,
			/Expected ':' after property name in JSON/i,
		])
	) {
		return { action: "retry_once", reason: "malformed JSON/tool call" };
	}

	// Deliberately no generic terminal-error handling and no compact-then-continue path.
	return { action: "ignore" };
}

function backoffForAttempt(attempt: number, scheduleMs: number[]): number {
	const index = Math.max(0, Math.min(attempt - 1, scheduleMs.length - 1));
	return scheduleMs[index] ?? 0;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
	if (!ctx.hasUI) return;
	ctx.ui.notify(message, level);
}

export default function autoContinueOnError(pi: ExtensionAPI) {
	const continueMessage = configuredContinueMessage();
	const maxConsecutiveResumes = configuredMaxConsecutiveResumes();
	const transientBackoffMs = configuredTransientBackoffMs();
	let consecutiveResumes = 0;
	let retriedMalformedJsonInCurrentStreak = false;

	pi.on("agent_end", async (event, ctx) => {
		const lastAssistant = lastAssistantMessage(event.messages);
		if (!lastAssistant) return;

		if (lastAssistant.stopReason !== "error") {
			consecutiveResumes = 0;
			retriedMalformedJsonInCurrentStreak = false;
			return;
		}

		const policy = classifyError(lastAssistant.errorMessage);
		if (policy.action === "ignore") {
			consecutiveResumes = 0;
			retriedMalformedJsonInCurrentStreak = false;
			return;
		}

		if (policy.action === "retry_once") {
			if (retriedMalformedJsonInCurrentStreak) return;
			retriedMalformedJsonInCurrentStreak = true;
		} else {
			retriedMalformedJsonInCurrentStreak = false;
		}

		consecutiveResumes += 1;
		const errorMessage = String(lastAssistant.errorMessage ?? "unknown error");

		if (consecutiveResumes > maxConsecutiveResumes) {
			notify(
				ctx,
				`Auto-continue paused after ${maxConsecutiveResumes} consecutive recoverable errors. Last error: ${errorMessage}. Send '${continueMessage}' manually, or adjust PI_AUTO_CONTINUE_MAX_CONSECUTIVE.`,
				"warning",
			);
			return;
		}

		if (policy.action === "continue_after_backoff") {
			const backoffMs = backoffForAttempt(consecutiveResumes, transientBackoffMs);
			notify(
				ctx,
				`Auto-continuing after transient error in ${Math.round(backoffMs / 1000)}s (${consecutiveResumes}/${maxConsecutiveResumes}): ${policy.reason}`,
				"info",
			);
			await delay(backoffMs);
		} else {
			notify(
				ctx,
				`Auto-continuing after recoverable error (${consecutiveResumes}/${maxConsecutiveResumes}): ${policy.reason}`,
				"info",
			);
		}

		await pi.sendUserMessage(continueMessage, { deliverAs: "followUp" });
	});

	pi.registerCommand("auto-continue-reset", {
		description: "Reset the auto-continue-on-error consecutive resume counter",
		handler: async (_args, ctx) => {
			consecutiveResumes = 0;
			retriedMalformedJsonInCurrentStreak = false;
			notify(ctx, "Auto-continue counter reset", "info");
		},
	});

	pi.registerCommand("auto-continue-status", {
		description: "Show auto-continue-on-error configuration",
		handler: async (_args, ctx) => {
			notify(
				ctx,
				`Auto-continue policy: terminated=immediate; transient provider/network errors=backoff [${transientBackoffMs.join(", ")}ms]; malformed JSON/tool-call errors=retry once; terminal errors ignored; no compact-then-continue. Sends '${continueMessage}'. Max consecutive resumes: ${maxConsecutiveResumes}. Current streak: ${consecutiveResumes}`,
				"info",
			);
		},
	});
}
