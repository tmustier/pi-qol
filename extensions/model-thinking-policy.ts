import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Per-model thinking-effort policy.
 *
 * Each time you switch model in Pi, this extension automatically sets the
 * thinking level to your preferred value for that model.
 *
 * To use this, edit the table below with your own provider/model → effort
 * mapping. Keys are `<provider>/<id>` exactly as Pi reports them. Models that
 * are not in the table are left at whatever the user last selected.
 *
 * Example:
 *   "openai-codex/gpt-5.5": "medium",      // Codex GPT-5.5 → medium
 *   "anthropic/claude-opus-4-7": "high",   // Opus 4.7 → high
 *
 * Levels: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
 */
const THINKING_BY_MODEL: Record<string, ThinkingLevel> = {
	// Add your own entries here. Empty by default so this extension is a no-op
	// until you've expressed your own preferences.
};

export default function modelThinkingPolicy(pi: ExtensionAPI) {
	pi.on("model_select", async (event, ctx) => {
		const modelRef = `${event.model.provider}/${event.model.id}`;
		const thinkingLevel = THINKING_BY_MODEL[modelRef];

		if (!thinkingLevel) return;

		pi.setThinkingLevel(thinkingLevel);
		ctx.ui.setStatus("model-thinking-policy", `effort ${thinkingLevel}`);

		if (event.source !== "restore") {
			ctx.ui.notify(`${modelRef} → thinking ${thinkingLevel}`, "info");
		}
	});
}
