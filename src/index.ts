#!/usr/bin/env node

import { Command } from "commander";
import { checkOllama, streamLocal } from "./model/ollama.js";

const cli = new Command();

cli
  .name("omnidev")
  .description("local-first autonomous developer engine")
  .version("0.1.0");

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
  .command("ask")
  .description("send a prompt to a local Ollama model")
  .argument("<prompt...>", "prompt to send to the model")
  .option("-m, --model <name>", "Ollama model to use")
  .action(async (promptParts: string[], options: { model?: string }) => {
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

    const modelName = options.model?.trim() || process.env.OMNIDEV_MODEL?.trim() || status.models[0];
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
      if (!receivedOutput) process.stdout.write("(the model returned an empty response)");
      process.stdout.write("\n");
    } catch (error) {
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
      } else {
        console.log("available models:");
        for (const name of result.models) console.log(`  - ${name}`);
      }
    } else {
      console.error(`ollama: offline (${result.message})`);
      console.error("start Ollama and try again. OmniDev does not require a cloud API.");
      process.exitCode = 1;
    }
  });

cli.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`omnidev: ${message}`);
  process.exitCode = 1;
});
