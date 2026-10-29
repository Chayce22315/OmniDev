import { emitKeypressEvents } from "node:readline";
import { realpath } from "node:fs/promises";
import { checkOllama, isLocalOllamaConfigured, selectOllamaModel, streamLocal } from "./model/ollama.js";
import { DEFAULT_PROJECT_LIMITS } from "./project/context.js";
import { streamProjectSummary } from "./project/summarize.js";
const menu = [
    { label: "Ask AI", screen: "ask", description: "Chat with your local model" },
    { label: "Project summary", screen: "summary", description: "Understand the current project" },
    { label: "Configuration", screen: "config", description: "Review connection and context limits" }
];
export function wrapText(text, width) {
    const safeWidth = Math.max(1, width);
    const lines = [];
    for (const paragraph of text.split("\n")) {
        if (!paragraph) {
            lines.push("");
            continue;
        }
        let remaining = paragraph;
        while (remaining.length > safeWidth) {
            let splitAt = remaining.lastIndexOf(" ", safeWidth);
            if (splitAt <= 0)
                splitAt = safeWidth;
            lines.push(remaining.slice(0, splitAt));
            remaining = remaining.slice(splitAt).trimStart();
        }
        lines.push(remaining);
    }
    return lines;
}
function colorize(value, code, enabled) {
    return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}
export function renderTuiFrame(screen, state) {
    const width = Math.max(30, state.columns || 80);
    const height = Math.max(12, state.rows || 24);
    const innerWidth = width - 4;
    const output = [
        `${colorize(" OMNIDEV ", "1;36", state.color)} ${colorize("local developer engine", "2", state.color)}`,
        `${"─".repeat(Math.max(0, width - 1))}`,
        `Project  ${state.root}`,
        `Ollama   ${state.ollamaOnline ? colorize(state.ollamaLocal ? "online (local)" : "online (remote)", "32", state.color) : colorize("offline", "31", state.color)}${state.models.length ? `  ·  ${state.models.length} model(s)` : ""}`,
        `Model    ${state.model}`,
        ""
    ];
    if (screen === "dashboard") {
        output.push(colorize("Dashboard", "1", state.color), "");
        menu.forEach((item, index) => {
            const selected = index === state.selectedMenu;
            output.push(`${selected ? colorize("›", "36", state.color) : " "} ${index + 1}. ${selected ? colorize(item.label, "1;36", state.color) : item.label}`);
            output.push(`    ${item.description}`);
        });
        if (!state.ollamaOnline && state.ollamaMessage)
            output.push("", colorize(state.ollamaMessage, "31", state.color));
    }
    else if (screen === "config") {
        output.push(colorize("Configuration & status", "1", state.color), "");
        output.push(`Project root: ${state.root}`);
        output.push(`Ollama: ${state.ollamaOnline ? (state.ollamaLocal ? "online (loopback; summaries enabled)" : "online (remote; summaries disabled)") : state.ollamaMessage ?? "offline"}`);
        output.push(`Model: ${state.model}`);
        output.push(`OMNIDEV_MODEL: ${process.env.OMNIDEV_MODEL?.trim() || "(not set)"}`);
        output.push(`OMNIDEV_OLLAMA_URL: ${process.env.OMNIDEV_OLLAMA_URL ? "(custom endpoint; hidden)" : "http://127.0.0.1:11434"}`);
        output.push("", "Project summary limits:");
        output.push(`  Files: ${DEFAULT_PROJECT_LIMITS.maxFiles}`);
        output.push(`  Per file: ${DEFAULT_PROJECT_LIMITS.maxFileBytes / 1024} KiB`);
        output.push(`  Total file content: ${DEFAULT_PROJECT_LIMITS.maxTotalBytes / 1024} KiB`);
        output.push(`  Depth / entries: ${DEFAULT_PROJECT_LIMITS.maxDepth} / ${DEFAULT_PROJECT_LIMITS.maxEntries}`);
        if (state.selectingModel) {
            output.push("", colorize("Select a model (↑/↓, Enter):", "1", state.color));
            const availableModels = Math.max(1, height - output.length - 5);
            const start = Math.max(0, Math.min(state.selectedModel - availableModels + 1, state.models.length - availableModels));
            if (start > 0)
                output.push("  ...");
            state.models.slice(start, start + availableModels).forEach((model, index) => {
                const absoluteIndex = start + index;
                output.push(`${absoluteIndex === state.selectedModel ? "›" : " "} ${model}`);
            });
            if (start + availableModels < state.models.length)
                output.push("  ...");
        }
        else {
            output.push("", state.models.length ? "Press M to change model." : "No local models detected.");
        }
    }
    else if (screen === "ask") {
        output.push(colorize("Ask AI", "1", state.color), "");
        const transcript = state.messages.flatMap((message) => {
            const label = message.role === "you" ? "you" : "omnidev";
            return [
                colorize(label, message.role === "you" ? "36" : "32", state.color),
                ...wrapText(message.text, innerWidth)
            ];
        });
        const available = Math.max(1, height - 12);
        const scrollPosition = state.scroll < 0 ? Math.max(0, transcript.length - available) : state.scroll;
        const visible = transcript.slice(scrollPosition, scrollPosition + available);
        output.push(...visible);
        if (state.busy)
            output.push("", colorize("Generating...  Esc cancels", "33", state.color));
        output.push("", colorize("Prompt (Enter sends, Ctrl+J adds a line):", "2", state.color));
        output.push(...wrapText(state.draft || "› ", innerWidth));
    }
    else {
        output.push(colorize("Project summary", "1", state.color), "");
        output.push(`Read-only discovery root: ${state.root}`);
        output.push("Files are bounded, filtered, and sent only to a loopback Ollama endpoint.");
        const summaryLines = state.messages
            .filter((message) => message.role === "omnidev")
            .flatMap((message) => wrapText(message.text, innerWidth));
        const available = Math.max(1, height - 13);
        const scrollPosition = state.scroll < 0 ? Math.max(0, summaryLines.length - available) : state.scroll;
        output.push("", ...summaryLines.slice(scrollPosition, scrollPosition + available));
        if (state.busy)
            output.push("", colorize("Discovering files and summarizing...  Esc cancels", "33", state.color));
        else
            output.push("", "Press Enter to summarize this project.");
    }
    const footer = screen === "dashboard"
        ? "↑/↓ navigate   Enter open   1-3 select   R refresh   Q quit   Ctrl+C quit"
        : screen === "ask"
            ? "Esc dashboard   ↑/↓ scroll   Ctrl+J newline   Enter send   Ctrl+C cancel/quit"
            : screen === "summary"
                ? "Esc dashboard   Enter summarize   Ctrl+C cancel/quit"
                : state.selectingModel
                    ? "↑/↓ select   Enter confirm   Esc cancel"
                    : "Esc dashboard   M change model   R refresh   Ctrl+C quit";
    output.push("", `${"─".repeat(Math.max(0, width - 1))}`, footer);
    const visibleLines = output.slice(0, height);
    if (screen === "ask") {
        const promptIndex = output.findIndex((line) => line.includes("Prompt (Enter sends"));
        const draftLines = wrapText(state.draft || "› ", innerWidth);
        const cursorRow = Math.min(height, promptIndex + draftLines.length + 2);
        const cursorColumn = Math.min(width, (draftLines[draftLines.length - 1]?.length ?? 0) + 1);
        return `\u001b[H\u001b[2J${visibleLines.join("\n")}\u001b[${cursorRow};${cursorColumn}H\u001b[?25h`;
    }
    return `\u001b[H\u001b[2J${visibleLines.join("\n")}\u001b[?25l`;
}
export async function runTui(options = {}) {
    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    const terminal = Boolean(input.isTTY && output.isTTY && input.setRawMode);
    if (!terminal) {
        throw new Error("interactive terminal required; use `omnidev ask` or `omnidev summarize` without a TTY");
    }
    const root = await realpath(options.root ?? process.cwd());
    const color = options.color ?? Boolean(output.isTTY && process.env.NO_COLOR === undefined);
    let status = await checkOllama();
    let model = selectOllamaModel(status.models, options.model) ?? "(no model)";
    let screen = "dashboard";
    let selectedMenu = 0;
    let selectedModel = Math.max(0, status.models.indexOf(model));
    let selectingModel = false;
    let messages = [];
    let draft = "";
    let busy = false;
    let scroll = -1;
    let activeController;
    let closed = false;
    let resolveClosed;
    const write = (value) => { output.write(value); };
    const refresh = () => {
        write(renderTuiFrame(screen, {
            root,
            model,
            models: status.models,
            ollamaOnline: status.ok,
            ollamaLocal: isLocalOllamaConfigured(),
            ...(status.message ? { ollamaMessage: status.message } : {}),
            selectedMenu,
            messages,
            draft,
            busy,
            scroll,
            selectingModel,
            selectedModel,
            color,
            columns: output.columns ?? process.stdout.columns ?? 80,
            rows: output.rows ?? process.stdout.rows ?? 24
        }));
    };
    const updateStatus = async () => {
        status = await checkOllama();
        if (!status.ok || !status.models.includes(model)) {
            model = selectOllamaModel(status.models, options.model) ?? "(no model)";
        }
        selectedModel = Math.max(0, status.models.indexOf(model));
    };
    const backToDashboard = () => {
        screen = "dashboard";
        selectingModel = false;
        refresh();
    };
    const request = async (prompt, summary) => {
        if (busy)
            return;
        busy = true;
        activeController = new AbortController();
        const controller = activeController;
        const result = { role: "omnidev", text: "" };
        messages.push({ role: "you", text: prompt });
        messages.push(result);
        refresh();
        try {
            if (model === "(no model)") {
                result.text = "No local models found. Install one with `ollama pull <model>` or select a model.";
            }
            else if (summary) {
                const summaryResult = await streamProjectSummary(root, model, (chunk) => {
                    result.text += chunk;
                    refresh();
                }, {}, controller.signal);
                result.text += `\n\n${summaryResult.fileCount} files from ${summaryResult.root}` +
                    (summaryResult.skippedFiles ? `; ${summaryResult.skippedFiles} skipped` : "") +
                    (summaryResult.truncated ? "; discovery limits reached" : "");
            }
            else {
                await streamLocal(prompt, model, (chunk) => {
                    result.text += chunk;
                    refresh();
                }, 120_000, controller.signal);
            }
        }
        catch (error) {
            result.text = controller.signal.aborted
                ? "Request cancelled."
                : error instanceof Error ? `Request failed: ${error.message}` : "Request failed.";
        }
        finally {
            busy = false;
            activeController = undefined;
            refresh();
        }
    };
    const finish = () => {
        if (busy)
            activeController?.abort();
        closed = true;
        resolveClosed?.();
    };
    const onSigint = () => {
        if (busy)
            activeController?.abort();
        else
            finish();
    };
    const onResize = () => refresh();
    const onKeypress = (value, key) => {
        if (closed)
            return;
        if (key.ctrl && key.name === "c") {
            if (busy)
                activeController?.abort();
            else
                finish();
            return;
        }
        if (busy) {
            if (key.name === "escape")
                activeController?.abort();
            return;
        }
        if (screen !== "dashboard" && key.name === "escape") {
            if (screen === "ask") {
                screen = "dashboard";
                draft = "";
            }
            else if (screen === "config" && selectingModel) {
                selectingModel = false;
            }
            else {
                screen = "dashboard";
            }
            refresh();
            return;
        }
        if (screen === "dashboard") {
            if (key.name === "up")
                selectedMenu = (selectedMenu + menu.length - 1) % menu.length;
            else if (key.name === "down")
                selectedMenu = (selectedMenu + 1) % menu.length;
            else if (value >= "1" && value <= "3")
                selectedMenu = Number(value) - 1;
            else if (value.toLowerCase() === "r")
                void updateStatus().then(refresh);
            else if (key.name === "return") {
                screen = menu[selectedMenu]?.screen ?? "ask";
                messages = [];
                scroll = -1;
            }
            else if (value.toLowerCase() === "q" || key.name === "escape")
                finish();
        }
        else if (screen === "ask") {
            if (key.ctrl && key.name === "j")
                draft += "\n";
            else if (key.name === "backspace")
                draft = draft.slice(0, -1);
            else if (key.name === "up") {
                const available = Math.max(1, (output.rows ?? process.stdout.rows ?? 24) - 12);
                const lineCount = messages.reduce((total, message) => total + wrapText(message.text, (output.columns ?? 80) - 4).length + 1, 0);
                scroll = Math.max(0, (scroll < 0 ? Math.max(0, lineCount - available) : scroll) - 1);
            }
            else if (key.name === "down") {
                const available = Math.max(1, (output.rows ?? process.stdout.rows ?? 24) - 12);
                const lineCount = messages.reduce((total, message) => total + wrapText(message.text, (output.columns ?? 80) - 4).length + 1, 0);
                const maxScroll = Math.max(0, lineCount - available);
                scroll = scroll < 0 ? -1 : scroll + 1 >= maxScroll ? -1 : scroll + 1;
            }
            else if (key.name === "pageup") {
                const available = Math.max(1, (output.rows ?? process.stdout.rows ?? 24) - 12);
                const lineCount = messages.reduce((total, message) => total + wrapText(message.text, (output.columns ?? 80) - 4).length + 1, 0);
                scroll = Math.max(0, (scroll < 0 ? Math.max(0, lineCount - available) : scroll) - 10);
            }
            else if (key.name === "pagedown") {
                const available = Math.max(1, (output.rows ?? process.stdout.rows ?? 24) - 12);
                const lineCount = messages.reduce((total, message) => total + wrapText(message.text, (output.columns ?? 80) - 4).length + 1, 0);
                const maxScroll = Math.max(0, lineCount - available);
                scroll = scroll < 0 || scroll + 10 >= maxScroll ? -1 : scroll + 10;
            }
            else if (key.name === "return") {
                const prompt = draft.trim();
                if (prompt) {
                    draft = "";
                    void request(prompt, false);
                }
            }
            else if (value && !key.ctrl && value !== "\u001b")
                draft += value;
        }
        else if (screen === "summary") {
            if (key.name === "up" || key.name === "down" || key.name === "pageup" || key.name === "pagedown") {
                const available = Math.max(1, (output.rows ?? process.stdout.rows ?? 24) - 13);
                const lines = messages
                    .filter((message) => message.role === "omnidev")
                    .reduce((total, message) => total + wrapText(message.text, (output.columns ?? 80) - 4).length, 0);
                const maxScroll = Math.max(0, lines - available);
                const delta = key.name === "up" ? -1 : key.name === "down" ? 1 : key.name === "pageup" ? -10 : 10;
                scroll = scroll < 0 ? Math.max(0, maxScroll + Math.min(delta, 0)) : Math.max(0, Math.min(maxScroll, scroll + delta));
                if (scroll >= maxScroll)
                    scroll = -1;
            }
            else if (key.name === "return") {
                messages = [];
                void request("Summarize the project structure, purpose, technologies, important components, and available run/test commands based only on the discovered project files.", true);
            }
        }
        else if (screen === "config") {
            if (selectingModel) {
                if (key.name === "up")
                    selectedModel = Math.max(0, selectedModel - 1);
                else if (key.name === "down")
                    selectedModel = Math.min(status.models.length - 1, selectedModel + 1);
                else if (key.name === "return") {
                    const selected = status.models[selectedModel];
                    if (selected)
                        model = selected;
                    selectingModel = false;
                }
            }
            else if (value.toLowerCase() === "m" && status.models.length > 0) {
                selectedModel = Math.max(0, status.models.indexOf(model));
                selectingModel = true;
            }
            else if (value.toLowerCase() === "r") {
                void updateStatus().then(refresh);
            }
        }
        refresh();
    };
    emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.resume();
    input.on("keypress", onKeypress);
    input.on("resize", onResize);
    output.on("resize", onResize);
    process.on("SIGINT", onSigint);
    write("\u001b[?1049h\u001b[?25h");
    refresh();
    try {
        await new Promise((resolve) => {
            resolveClosed = resolve;
            if (closed)
                resolve();
        });
    }
    finally {
        activeController?.abort();
        input.off("keypress", onKeypress);
        input.off("resize", onResize);
        output.off("resize", onResize);
        process.off("SIGINT", onSigint);
        input.setRawMode?.(false);
        write("\u001b[0m\u001b[?25h\u001b[?1049l\n");
    }
}
