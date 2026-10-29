import { isLocalOllamaConfigured, streamLocal } from "../model/ollama.js";
import {
  buildProjectSummaryPrompt,
  collectProjectContext,
  type ProjectContextOptions
} from "./context.js";

export async function streamProjectSummary(
  root: string,
  model: string,
  onChunk: (chunk: string) => void,
  options: ProjectContextOptions = {},
  signal?: AbortSignal
): Promise<{ root: string; fileCount: number; skippedFiles: number; truncated: boolean }> {
  if (!isLocalOllamaConfigured()) {
    throw new Error("project summaries require a loopback Ollama URL; project files are never sent to remote services");
  }

  const context = await collectProjectContext(root, options, signal);
  if (context.files.length === 0) {
    throw new Error("no readable project files found within the discovery limits");
  }

  await streamLocal(buildProjectSummaryPrompt(context), model, onChunk, 120_000, signal);
  return {
    root: context.root,
    fileCount: context.files.length,
    skippedFiles: context.skippedFiles,
    truncated: context.truncated
  };
}
