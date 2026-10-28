export interface OllamaStatus {
  ok: boolean;
  url: string;
  models: string[];
  message?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string }>;
}

function ollamaBaseUrl(): string {
  return (process.env.OMNIDEV_OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
}

export async function checkOllama(timeoutMs = 2_000): Promise<OllamaStatus> {
  const url = ollamaBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/api/tags`, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      return {
        ok: false,
        url,
        models: [],
        message: `Ollama returned HTTP ${response.status}`
      };
    }

    const data = (await response.json()) as OllamaTagsResponse;
    return {
      ok: true,
      url,
      models: (data.models ?? [])
        .map((model) => model.name)
        .filter((name): name is string => Boolean(name))
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "connection timed out"
        : "could not connect to the local Ollama API";
    return { ok: false, url, models: [], message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateLocal(
  prompt: string,
  model: string,
  timeoutMs = 120_000
): Promise<string> {
  const url = ollamaBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as { response?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.response ?? "";
  } finally {
    clearTimeout(timeout);
  }
}
