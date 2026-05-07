import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname, extname } from "node:path";
import { spawn } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateTail, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";

const TOOL_NAME = "codex_image";
const AUTH_PATH = join(homedir(), ".codex", "auth.json");
const GENERATED_IMAGES_DIR = "generated_images";
const DEFAULT_TIMEOUT_SEC = 180;
const MAX_TIMEOUT_SEC = 900;

const TOOL_PARAMS = Type.Object({
  prompt: Type.String({
    description: "What image to generate or how to edit the attached reference image(s).",
  }),
  inputImages: Type.Optional(
    Type.Array(Type.String({ description: "Local image path. Can be relative, absolute, or start with @." }), {
      description: "Optional local image paths to attach as references or edit targets.",
    }),
  ),
  outputPath: Type.Optional(
    Type.String({
      description:
        "Optional exact path to copy the generated image to. If Codex produces multiple images, omit this and let the agent choose one later.",
    }),
  ),
  overwrite: Type.Optional(
    Type.Boolean({
      description: "Whether to overwrite outputPath if it already exists. Default: false.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description: "Optional Codex model override. If omitted, Codex uses its default configured model.",
    }),
  ),
  timeoutSec: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_TIMEOUT_SEC,
      description: `Timeout for the Codex run in seconds. Default: ${DEFAULT_TIMEOUT_SEC}.`,
    }),
  ),
});

type ToolParams = Static<typeof TOOL_PARAMS>;

function stripAtPrefix(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function resolveUserPath(path: string, cwd: string): string {
  return resolve(cwd, stripAtPrefix(path));
}

async function ensureFileExists(path: string, description: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`${description} not found: ${path}`);
  }
}

async function collectFilesRecursive(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  await walk(root);
  return results;
}

function imageMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function buildCodexPrompt(params: ToolParams): string {
  const sections = [
    "Use Codex's built-in image_generation tool for this request.",
    "Generate the requested raster image output and then answer briefly with what you made.",
    "Do not edit or create files in the workspace.",
  ];

  if ((params.inputImages?.length ?? 0) > 0) {
    sections.push(
      `There ${params.inputImages!.length === 1 ? "is" : "are"} ${params.inputImages!.length} attached input image${params.inputImages!.length === 1 ? "" : "s"}. Use them as references or edit targets according to the user's request.`,
    );
  }

  sections.push(`User request:\n${params.prompt}`);
  return sections.join("\n\n");
}

function tail(text: string, maxLines = 40, maxBytes = 12_000): string {
  return truncateTail(text, { maxLines, maxBytes }).content.trim();
}

async function runCodex(
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    onStatus?: (text: string) => void;
    signal?: AbortSignal;
  },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("codex", args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (options.signal && abortHandler) {
        options.signal.removeEventListener("abort", abortHandler);
      }
      fn();
    };

    const requestTerminate = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 2_000);
    };

    const abortHandler = () => {
      requestTerminate();
    };

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      options.onStatus?.("Codex timed out; stopping process...");
      requestTerminate();
    }, options.timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) {
        timedOut = false;
        requestTerminate();
      } else {
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    child.on("error", (error) => {
      settle(() => rejectPromise(error));
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const last = lines.at(-1);
      if (last) {
        options.onStatus?.(`Codex: ${last}`);
      }
    });

    child.on("close", (code) => {
      settle(() => resolvePromise({ code, stdout, stderr, timedOut }));
    });
  });
}

export default function codexImage(pi: ExtensionAPI) {
  pi.registerTool({
    name: TOOL_NAME,
    label: "Codex image",
    description:
      "Generate or edit raster images via the local Codex CLI using Codex's built-in image_generation tool. Requires `codex` to be installed and logged in with ChatGPT.",
    promptSnippet:
      "Generate or edit a bitmap image via the local Codex CLI and its built-in image_generation tool; supports optional local reference images and an optional output copy path.",
    promptGuidelines: [
      "Use this tool when the user wants a raster image and specifically wants Codex's image-generation capability.",
      "Pass inputImages when the user provides local references or wants an existing local image edited.",
      "If outputPath is set, this tool copies the generated image there after Codex finishes. Otherwise it returns the image inline only.",
    ],
    parameters: TOOL_PARAMS,
    async execute(_toolCallId, params: ToolParams, signal, onUpdate, ctx) {
      await ensureFileExists(AUTH_PATH, "Codex auth file (~/.codex/auth.json)");

      const inputImages = params.inputImages ?? [];
      const resolvedInputImages = await Promise.all(
        inputImages.map(async (path) => {
          const resolvedPath = resolveUserPath(path, ctx.cwd);
          await ensureFileExists(resolvedPath, "Input image");
          return resolvedPath;
        }),
      );

      const resolvedOutputPath = params.outputPath
        ? resolveUserPath(params.outputPath, ctx.cwd)
        : undefined;

      if (resolvedOutputPath && params.outputPath && (params.outputPath.endsWith("/") || params.outputPath.endsWith("\\"))) {
        throw new Error("outputPath must be a file path, not a directory path.");
      }

      const codexHome = await mkdtemp(join(tmpdir(), "pi-codex-image-"));
      const lastMessagePath = join(codexHome, "last-message.txt");
      const timeoutSec = Math.min(Math.max(params.timeoutSec ?? DEFAULT_TIMEOUT_SEC, 1), MAX_TIMEOUT_SEC);

      try {
        await copyFile(AUTH_PATH, join(codexHome, "auth.json"));

        const prompt = buildCodexPrompt(params);
        const args = [
          "exec",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          "--ephemeral",
          "--sandbox",
          "read-only",
          "--enable",
          "image_generation",
          "--color",
          "never",
          "--cd",
          ctx.cwd,
          "--output-last-message",
          lastMessagePath,
        ];

        if (params.model) {
          args.push("--model", params.model);
        }

        for (const imagePath of resolvedInputImages) {
          args.push("--image", imagePath);
        }

        args.push(prompt);

        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Launching Codex image run${params.model ? ` with model ${params.model}` : ""}${resolvedInputImages.length > 0 ? ` using ${resolvedInputImages.length} input image${resolvedInputImages.length === 1 ? "" : "s"}` : ""}...`,
            },
          ],
          details: {
            tool: TOOL_NAME,
            inputImages: resolvedInputImages,
            outputPath: resolvedOutputPath,
          },
        });

        const result = await runCodex(args, {
          cwd: ctx.cwd,
          env: {
            ...process.env,
            CODEX_HOME: codexHome,
          },
          timeoutMs: timeoutSec * 1000,
          signal,
          onStatus: (text) => {
            onUpdate?.({
              content: [{ type: "text", text }],
              details: { tool: TOOL_NAME },
            });
          },
        });

        const finalMessage = await readFile(lastMessagePath, "utf8").catch(() => "");
        const generatedRoot = join(codexHome, GENERATED_IMAGES_DIR);
        const generatedFiles = (await collectFilesRecursive(generatedRoot))
          .filter((path) => /\.(png|jpe?g|gif|webp)$/i.test(path))
          .sort();

        if (result.timedOut) {
          throw new Error(`Codex timed out after ${timeoutSec}s.`);
        }

        if ((result.code ?? 1) !== 0) {
          const stderrTail = tail(result.stderr);
          const stdoutTail = tail(result.stdout);
          throw new Error(
            [
              `Codex exited with code ${result.code ?? "unknown"}.`,
              stderrTail ? `stderr:\n${stderrTail}` : "",
              stdoutTail ? `stdout:\n${stdoutTail}` : "",
              finalMessage.trim() ? `last message:\n${finalMessage.trim()}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          );
        }

        if (generatedFiles.length === 0) {
          throw new Error(
            [
              "Codex finished but no generated image was found.",
              finalMessage.trim() ? `last message:\n${finalMessage.trim()}` : "",
              result.stderr.trim() ? `stderr:\n${tail(result.stderr)}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          );
        }

        if (resolvedOutputPath && generatedFiles.length !== 1) {
          throw new Error(
            `outputPath requires exactly one generated image, but Codex produced ${generatedFiles.length}.`,
          );
        }

        let copiedPath: string | undefined;
        if (resolvedOutputPath) {
          const overwrite = params.overwrite ?? false;
          if (!overwrite) {
            try {
              await access(resolvedOutputPath);
              throw new Error(
                `outputPath already exists: ${resolvedOutputPath}. Pass overwrite=true to replace it.`,
              );
            } catch (error) {
              if (!(error instanceof Error) || !error.message.startsWith("outputPath already exists:")) {
                // File does not exist, which is what we want.
              } else {
                throw error;
              }
            }
          }

          copiedPath = resolvedOutputPath;
          const sourcePath = generatedFiles[0]!;
          await withFileMutationQueue(resolvedOutputPath, async () => {
            await mkdir(dirname(resolvedOutputPath), { recursive: true });
            await copyFile(sourcePath, resolvedOutputPath);
          });
        }

        const imageBuffers = await Promise.all(generatedFiles.map((path) => readFile(path)));
        const textParts = [
          `Codex generated ${generatedFiles.length} image${generatedFiles.length === 1 ? "" : "s"}.`,
          finalMessage.trim() ? `Codex summary: ${finalMessage.trim()}` : "",
          copiedPath ? `Copied final image to: ${copiedPath}` : "",
        ].filter(Boolean);

        return {
          content: [
            { type: "text", text: textParts.join(" ") },
            ...imageBuffers.map((buffer, index) => ({
              type: "image" as const,
              data: buffer.toString("base64"),
              mimeType: imageMimeType(generatedFiles[index]!),
            })),
          ],
          details: {
            tool: TOOL_NAME,
            generatedImageCount: generatedFiles.length,
            copiedPath,
            finalMessage: finalMessage.trim() || undefined,
            stdoutTail: result.stdout.trim() ? tail(result.stdout) : undefined,
            stderrTail: result.stderr.trim() ? tail(result.stderr) : undefined,
          },
        };
      } finally {
        await rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  });
}
