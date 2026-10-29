#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { checkOllama, isLocalOllamaConfigured, selectOllamaModel, streamLocal } from "./model/ollama.js";
import { streamProjectSummary } from "./project/summarize.js";
import { runTui } from "./tui.js";
const cli = new Command();
cli
    .name("omnidev")
    .description("local-first autonomous developer engine")
    .version("0.1.0");
cli
    .action(async () => {
    try {
        await runTui();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error(`omnidev: ${message}`);
        process.exitCode = 1;
    }
});
cli
    .command("hello")
    .description("check that the OmniDev CLI is installed and running")
    .action(() => {
    console.log("");
    console.log("  omnidev // github copilot + cursor + steroids");
    console.log("  cli foundation: online");
    console.log("  local-first: enabled");
    console.log("");
    console.log("next: run `omnidev ask \"your prompt\"` to talk to your local model.");
});
cli
    .command("ui")
    .alias("tui")
    .description("open the interactive local developer console")
    .option("-m, --model <name>", "Ollama model to use")
    .action(async (options) => {
    try {
        await runTui(options.model ? { model: options.model } : {});
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error(`omnidev: ${message}`);
        process.exitCode = 1;
    }
});
cli
    .command("summarize")
    .alias("summary")
    .description("discover and summarize a project using local Ollama inference")
    .argument("[directory]", "project directory to inspect (defaults to the current directory)")
    .option("-m, --model <name>", "Ollama model to use")
    .option("--max-files <count>", "maximum project files to include")
    .option("--max-file-bytes <bytes>", "maximum bytes per file")
    .option("--max-context-bytes <bytes>", "maximum total project file bytes")
    .action(async (directory, options) => {
    try {
        if (!isLocalOllamaConfigured()) {
            throw new Error("project summaries require a loopback Ollama URL; project files are never sent to remote services");
        }
        const status = await checkOllama();
        if (!status.ok)
            throw new Error(`Ollama is offline (${status.message}); start Ollama and try again`);
        const modelName = selectOllamaModel(status.models, options.model);
        if (!modelName) {
            throw new Error("no local models found; install one with `ollama pull <model>`");
        }
        const parseLimit = (value, name) => {
            if (value === undefined)
                return undefined;
            const parsed = Number(value);
            if (!Number.isSafeInteger(parsed) || parsed < 1) {
                throw new Error(`${name} must be a positive integer`);
            }
            return parsed;
        };
        const maxFiles = parseLimit(options.maxFiles, "--max-files");
        const maxFileBytes = parseLimit(options.maxFileBytes, "--max-file-bytes");
        const maxContextBytes = parseLimit(options.maxContextBytes, "--max-context-bytes");
        const limits = {
            ...(maxFiles !== undefined ? { maxFiles } : {}),
            ...(maxFileBytes !== undefined ? { maxFileBytes } : {}),
            ...(maxContextBytes !== undefined ? { maxTotalBytes: maxContextBytes } : {})
        };
        let receivedOutput = false;
        console.log(`omnidev // project summary (${modelName})`);
        const result = await streamProjectSummary(path.resolve(directory ?? process.cwd()), modelName, (chunk) => {
            process.stdout.write(chunk);
            receivedOutput ||= chunk.length > 0;
        }, limits);
        if (!receivedOutput)
            process.stdout.write("(the model returned an empty response)");
        process.stdout.write("\n");
        console.error(`\n${result.fileCount} files summarized from ${result.root}` +
            (result.skippedFiles > 0 ? `; ${result.skippedFiles} files skipped` : "") +
            (result.truncated ? "; discovery limits reached" : ""));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error(`project summary failed: ${message}`);
        process.exitCode = 1;
    }
});
cli
    .command("ask")
    .description("send a prompt to a local Ollama model")
    .argument("<prompt...>", "prompt to send to the model")
    .option("-m, --model <name>", "Ollama model to use")
    .action(async (promptParts, options) => {
    const prompt = promptParts.join(" ").trim();
    if (!prompt) {
        console.error("please provide a prompt, e.g. omnidev ask \"explain typescript\"");
        process.exitCode = 1;
        return;
    }
    const status = await checkOllama();
    if (!status.ok) {
        console.error(`ollama: offline (${status.message})`);
        console.error("start Ollama and try again. OmniDev does not require a cloud API.");
        process.exitCode = 1;
        return;
    }
    const modelName = selectOllamaModel(status.models, options.model);
    if (!modelName) {
        console.error("no local models found. install one first, for example: ollama pull qwen2.5-coder:7b");
        process.exitCode = 1;
        return;
    }
    console.log(`omnidev // ${modelName}`);
    console.log("");
    try {
        let receivedOutput = false;
        await streamLocal(prompt, modelName, (chunk) => {
            process.stdout.write(chunk);
            receivedOutput ||= chunk.length > 0;
        });
        if (!receivedOutput)
            process.stdout.write("(the model returned an empty response)");
        process.stdout.write("\n");
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error(`model request failed: ${message}`);
        process.exitCode = 1;
    }
});
const model = cli.command("model").description("manage your local model connection");
model
    .command("status")
    .description("check whether the local Ollama API is reachable")
    .action(async () => {
    const result = await checkOllama();
    if (result.ok) {
        console.log("ollama: online");
        if (result.models.length === 0) {
            console.log("models: none found; install one with `ollama pull <model>`");
        }
        else {
            console.log("available models:");
            for (const name of result.models)
                console.log(`  - ${name}`);
        }
    }
    else {
        console.error(`ollama: offline (${result.message})`);
        console.error("start Ollama and try again. OmniDev does not require a cloud API.");
        process.exitCode = 1;
    }
});
cli.parseAsync(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`omnidev: ${message}`);
    process.exitCode = 1;
});
