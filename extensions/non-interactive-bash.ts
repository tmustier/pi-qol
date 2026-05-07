/**
 * Non-Interactive Bash — prevents editors and pagers from hanging pi.
 *
 * Pi already closes stdin (stdio: ["ignore", "pipe", "pipe"]), so programs
 * reading from stdin get EOF immediately. But some programs (git, brew)
 * spawn editor/pager subprocesses that read from /dev/tty, bypassing stdin.
 * These env vars prevent that.
 *
 * GIT_EDITOR/GIT_SEQUENCE_EDITOR use "true" (exit 0 = accept content as-is).
 * EDITOR/VISUAL use "false" (exit 1 = fail loudly so the LLM knows to retry).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";

// pi-code-previews also overrides the built-in bash tool to add syntax-highlighted
// previews. Keep this extension as the sole bash override so the non-interactive
// spawn environment below remains active, while allowing code previews for the
// other built-in tools. Users can still opt into a different preview set by
// exporting CODE_PREVIEW_TOOLS before starting pi.
process.env.CODE_PREVIEW_TOOLS ??= "read,write,edit,grep,find,ls";

const NON_INTERACTIVE_ENV: Record<string, string> = {
  GIT_EDITOR: "true",
  GIT_SEQUENCE_EDITOR: "true",
  EDITOR: "false",
  VISUAL: "false",
  PAGER: "cat",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  HOMEBREW_NO_AUTO_UPDATE: "1",
};

export default function (pi: ExtensionAPI) {
  const baseBash = createBashTool(process.cwd());

  pi.registerTool({
    ...baseBash,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tool = createBashTool(ctx.cwd, {
        spawnHook: ({ command, cwd, env }) => ({
          command,
          cwd,
          env: { ...env, ...NON_INTERACTIVE_ENV },
        }),
      });
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}
