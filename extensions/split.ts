import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";

/**
 * /split — fork the current Pi session into a new Ghostty split pane.
 *
 * Ghostty + macOS only. On other terminals or platforms the command no-ops
 * silently rather than registering a broken `/split`.
 */
export default function splitExtension(pi: ExtensionAPI): void {
  // Ghostty-specific: uses AppleScript to drive a Ghostty "new split pane" key
  // chord. Skip registration entirely on non-Ghostty / non-macOS environments.
  if (process.platform !== "darwin") return;
  if (process.env.TERM_PROGRAM !== "ghostty") return;

  pi.registerCommand("split", {
    description: "Fork session into a new Ghostty split pane",
    handler: async (_args, ctx) => {
      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("No active session file — nothing to fork", "error");
        return;
      }

      const cwd = ctx.sessionManager.getCwd();
      const cmd = `cd ${cwd} && pi --fork ${sessionFile}`;

      // AppleScript uses backslash-escaped quotes inside strings
      const escapedCmd = cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      const script = [
        'tell application "Ghostty" to activate',
        "delay 0.3",
        'tell application "System Events"',
        '  tell process "Ghostty"',
        '    keystroke "d" using command down',
        "    delay 0.4",
        `    keystroke "${escapedCmd}"`,
        "    keystroke return",
        "  end tell",
        "end tell",
      ].join("\n");

      try {
        execFileSync("osascript", ["-e", script], {
          stdio: "pipe",
          timeout: 10_000,
        });
        ctx.ui.notify("Opened forked session in Ghostty split");
      } catch (e) {
        ctx.ui.notify(
          `Split failed: ${e instanceof Error ? e.message : e}`,
          "error",
        );
      }
    },
  });
}
