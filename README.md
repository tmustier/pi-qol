# pi-qol

Some quality of life [Pi coding agent](https://github.com/badlogic/pi-mono) extensions I use, plus a curated list of recommended packages from elsewhere.

This repo ships **seven small extensions I wrote** and points at a tier-list of **other people's packages** that I'd install on every machine I run Pi on. Nothing here is essential — Pi is great out of the box — but together these make daily use noticeably nicer.

## Install the local extensions

Add to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "git:github.com/tmustier/pi-qol"
  ]
}
```

Then `pi update` (or restart Pi).

You'll get all seven extensions below. To enable only a subset, use a filter:

```json
{
  "packages": [
    {
      "source": "git:github.com/tmustier/pi-qol",
      "extensions": [
        "extensions/auto-continue-on-error.ts",
        "extensions/non-interactive-bash.ts",
        "extensions/continue-shortcut.ts"
      ]
    }
  ]
}
```

## Extensions in this repo

| File | What it does |
|---|---|
| [`auto-continue-on-error.ts`](extensions/auto-continue-on-error.ts) | Automatically resumes the agent after recoverable errors (transient provider/network failures, terminated streams, malformed tool-call JSON). Backs off on transient errors, retries malformed JSON once, paused after N consecutive resumes. Configurable via `PI_AUTO_CONTINUE_*` env vars. |
| [`non-interactive-bash.ts`](extensions/non-interactive-bash.ts) | Stops Pi from hanging when bash subprocesses (git, brew) try to launch interactive editors or pagers. Sets `GIT_EDITOR=true`, `EDITOR=false`, `PAGER=cat`, `HOMEBREW_NO_AUTO_UPDATE=1`, etc. |
| [`continue-shortcut.ts`](extensions/continue-shortcut.ts) | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> sends `continue` to the agent. |
| [`codex-image.ts`](extensions/codex-image.ts) | Adds a `codex_image` tool that generates or edits raster images via the local Codex CLI. Requires Codex installed and logged in (`~/.codex/auth.json`). |
| [`open-file.ts`](extensions/open-file.ts) | `/open <path>` opens a file or directory with the default macOS app. Tab-completes paths; `/open` with no args opens the last file Pi touched in the session. **macOS only** (no-ops elsewhere). |
| [`split.ts`](extensions/split.ts) | `/split` forks the current Pi session into a new Ghostty split pane. **Ghostty + macOS only** (no-ops elsewhere). |
| [`model-thinking-policy.ts`](extensions/model-thinking-policy.ts) | Auto-sets your preferred thinking effort per model when you switch. Ships with an empty mapping — edit the file to add your own preferences. |

## Recommended packages — install separately

These all live in their own repos with their own authors. I'd add them in roughly this order.

### Tier 1 — pretty much always worth it

| Package | What it does |
|---|---|
| [`npm:pi-custom-compaction`](https://www.npmjs.com/package/pi-custom-compaction) | Better, more controllable session compaction policy. |
| [`npm:pi-subagents`](https://www.npmjs.com/package/pi-subagents) | Delegate work to single agents, parallel agents, or chained pipelines from inside a session. |
| [`git:github.com/mitsuhiko/agent-stuff`](https://github.com/mitsuhiko/agent-stuff) | Armin's pack. I use `notify`, `session-breakdown`, `review`, and `whimsical` (random delightful "Combobulating..."-style spinner messages). |

### Tier 2 — likely

| Package | What it does |
|---|---|
| [`git:github.com/tmustier/pi-extensions`](https://github.com/tmustier/pi-extensions) | My own pack of in-terminal tooling: `files-widget` (file browser/diff/select widget), `usage-extension` (cost & token dashboard), `code-actions` (`/code` to grab snippets from messages), `raw-paste` (`/paste` for editable pasted text), `session-recap` (one-line recap when you refocus the terminal). |
| [`npm:@tmustier/pi-session-hud`](https://www.npmjs.com/package/@tmustier/pi-session-hud) | Terminal title HUD for tracking what each Pi session is doing across windows/tabs. |

### Tier 3 — situational, install if you want them

| Package | What it does |
|---|---|
| [`git:github.com/vercel-labs/agent-browser`](https://github.com/vercel-labs/agent-browser) | Browser automation for the agent (Playwright). Heavy install, but the right answer when you actually need browser control. |
| [`npm:pi-web-access`](https://www.npmjs.com/package/pi-web-access) | Adds web search / fetch / librarian tools to the agent if you don't already have these via MCP. |
| [`npm:@linioi/pi-fast-mode`](https://www.npmjs.com/package/@linioi/pi-fast-mode) | Speed/cost mode toggle. |

### One-shot install

Copy [`settings.example.json`](settings.example.json) into `~/.pi/agent/settings.json` (or merge the `packages` array into your existing one), then `pi update`.

## A note on licenses and credit

The seven extensions in [`extensions/`](extensions/) are by [Thomas Mustier](https://github.com/tmustier) and released under [MIT](LICENSE).

The packages listed under **Recommended packages** are not redistributed here — this repo just links to them. Each one is published in its own repo by its own author and inherits whatever license that author chose. If you install them, you're installing them directly from those upstream sources.

Credit and thanks to the authors I'm leaning on:

- [@badlogic / mariozechner](https://github.com/badlogic) — Pi itself.
- [@mitsuhiko (Armin Ronacher)](https://github.com/mitsuhiko) — `agent-stuff` (`notify`, `session-breakdown`, `review`, `whimsical`).
- [Nico Bailon](https://www.npmjs.com/~nicobailon) — `pi-custom-compaction`, `pi-subagents`, `pi-web-access`.
- [Vercel Labs](https://github.com/vercel-labs) — `agent-browser`.
- The [`@linioi`](https://www.npmjs.com/~linioi) author — `pi-fast-mode`.

If I've forgotten to credit anyone, please open an issue.
