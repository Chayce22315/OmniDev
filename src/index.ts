#!/usr/bin/env node

import { Command } from "commander";
import { checkOllama } from "./model/ollama.js";

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
    console.log("next: run `omnidev model status` to check your local model.");
  });

const model = cli.command("model").description("manage your local model connection");

model
  .command("status")
  .description("check whether the local Ollama API is reachable")
  .action(async () => {
    const result = await checkOllama();
    if (result.ok) {
      console.log(`ollama: online (${result.url})`);
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
