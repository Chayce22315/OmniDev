function ollamaBaseUrl() {
    return (process.env.OMNIDEV_OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
}
export function isLocalOllamaConfigured() {
    try {
        const url = new URL(ollamaBaseUrl());
        const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
        return ((url.protocol === "http:" || url.protocol === "https:") &&
            !url.username &&
            !url.password &&
            (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"));
    }
    catch {
        return false;
    }
}
export function selectOllamaModel(models, explicitModel) {
    return explicitModel?.trim() || process.env.OMNIDEV_MODEL?.trim() || models[0];
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isModel(value) {
    return isRecord(value) && typeof value.name === "string";
}
function isModelNotFound(message) {
    return /model.{0,80}(not found|does not exist)|(?:not found|does not exist).{0,80}model/i.test(message);
}
async function readJson(response, description) {
    try {
        return await response.json();
    }
    catch {
        throw new Error(`Ollama returned malformed JSON for ${description}`);
    }
}
async function httpError(response) {
    let data;
    try {
        data = await response.json();
    }
    catch {
        return new Error(`Ollama returned HTTP ${response.status}`);
    }
    const error = isRecord(data) && typeof data.error === "string" ? data.error : "";
    if (isModelNotFound(error)) {
        return new Error("model not found; check the model name or install it with `ollama pull <model>`");
    }
    return new Error(`Ollama returned HTTP ${response.status}`);
}
function requestError(error) {
    if (error instanceof Error && error.name === "AbortError") {
        return new Error("Ollama request timed out");
    }
    return new Error("could not connect to the local Ollama API");
}
export async function checkOllama(timeoutMs = 2_000) {
    const url = ollamaBaseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${url}/api/tags`, {
            signal: controller.signal,
            headers: { accept: "application/json" }
        });
        if (!response.ok) {
            const error = await httpError(response);
            return { ok: false, url, models: [], message: error.message };
        }
        const data = await readJson(response, "model list");
        if (!isRecord(data) ||
            !Array.isArray(data.models) ||
            !data.models.every(isModel)) {
            return { ok: false, url, models: [], message: "Ollama returned an invalid model list" };
        }
        return {
            ok: true,
            url,
            models: data.models.map((model) => model.name).filter(Boolean)
        };
    }
    catch (error) {
        return { ok: false, url, models: [], message: requestError(error).message };
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function generateLocal(prompt, model, timeoutMs = 120_000) {
    const url = ollamaBaseUrl();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${url}/api/generate`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ model, prompt, stream: false }),
            signal: controller.signal
        });
        if (!response.ok)
            throw await httpError(response);
        const data = await readJson(response, "generation response");
        if (!isRecord(data))
            throw new Error("Ollama returned an invalid generation response");
        if (typeof data.error === "string" && data.error.length > 0) {
            if (isModelNotFound(data.error)) {
                throw new Error("model not found; check the model name or install it with `ollama pull <model>`");
            }
            throw new Error("Ollama could not generate a response");
        }
        if (typeof data.response !== "string")
            throw new Error("Ollama returned an invalid generation response");
        return data.response;
    }
    catch (error) {
        if (error instanceof Error && !["TypeError", "AbortError"].includes(error.name))
            throw error;
        throw requestError(error);
    }
    finally {
        controller.abort();
        clearTimeout(timeout);
    }
}
function parseStreamLine(line) {
    let data;
    try {
        data = JSON.parse(line);
    }
    catch {
        throw new Error("Ollama returned malformed streaming data");
    }
    if (!isRecord(data))
        throw new Error("Ollama returned invalid streaming data");
    if (typeof data.error === "string" && data.error.length > 0) {
        if (isModelNotFound(data.error)) {
            throw new Error("model not found; check the model name or install it with `ollama pull <model>`");
        }
        throw new Error("Ollama could not generate a response");
    }
    if (typeof data.response !== "string" || (data.done !== undefined && typeof data.done !== "boolean")) {
        throw new Error("Ollama returned invalid streaming data");
    }
    return { response: data.response, done: data.done === true };
}
export async function streamLocal(prompt, model, onChunk, timeoutMs = 120_000, signal) {
    const url = ollamaBaseUrl();
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted)
        controller.abort();
    else
        signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${url}/api/generate`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/x-ndjson" },
            body: JSON.stringify({ model, prompt, stream: true }),
            signal: controller.signal
        });
        if (!response.ok)
            throw await httpError(response);
        if (!response.body)
            throw new Error("Ollama returned an empty streaming response");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        let completed = false;
        try {
            while (true) {
                const { done, value } = await reader.read();
                pending += decoder.decode(value, { stream: !done });
                const lines = pending.split(/\r?\n/);
                pending = lines.pop() ?? "";
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    const item = parseStreamLine(line);
                    if (item.response)
                        onChunk(item.response);
                    completed ||= item.done;
                }
                if (done)
                    break;
            }
            if (pending.trim()) {
                const item = parseStreamLine(pending);
                if (item.response)
                    onChunk(item.response);
                completed ||= item.done;
            }
            if (!completed)
                throw new Error("Ollama returned an incomplete streaming response");
        }
        finally {
            reader.releaseLock();
        }
    }
    catch (error) {
        if (error instanceof Error && !["TypeError", "AbortError"].includes(error.name))
            throw error;
        throw requestError(error);
    }
    finally {
        signal?.removeEventListener("abort", abortFromCaller);
        controller.abort();
        clearTimeout(timeout);
    }
}
