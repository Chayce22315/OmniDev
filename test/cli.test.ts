import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<CliResult> {
  const entry = path.resolve("src/index.ts");
  const child = spawn(process.execPath, ["--import", "tsx", entry, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const [status] = await once(child, "close") as [number | null];
  return { status, stdout, stderr };
}

async function withMockOllama<T>(run: (url: string, requests: Record<string, unknown>[]) => Promise<T>): Promise<T> {
  const requests: Record<string, unknown>[] = [];
  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url === "/api/tags") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "discovered-model" }] }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.end(`${JSON.stringify({ response: "mocked answer", done: true })}\n`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const previousUrl = process.env.OMNIDEV_OLLAMA_URL;
  process.env.OMNIDEV_OLLAMA_URL = `http://127.0.0.1:${address.port}`;
  try {
    return await run(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    if (previousUrl === undefined) delete process.env.OMNIDEV_OLLAMA_URL;
    else process.env.OMNIDEV_OLLAMA_URL = previousUrl;
    server.closeAllConnections();
    server.close();
  }
}

test("legacy hello and model status commands remain available", async () => {
  const hello = await runCli(["hello"]);
  assert.equal(hello.status, 0, hello.stderr);
  assert.match(hello.stdout, /cli foundation: online/);

  await withMockOllama(async (_url) => {
    const status = await runCli(["model", "status"]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /ollama: online/);
    assert.match(status.stdout, /discovered-model/);
  });
});

test("summarize uses the selected current directory, local model, and configured limits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "omnidev-cli-project-"));
  try {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "main.ts"), "export const app = true;");
    await withMockOllama(async (_url, requests) => {
      const result = await runCli(
        ["summarize", "--model", "chosen-model", "--max-files", "5", "--max-file-bytes", "256", "--max-context-bytes", "512"],
        {
          cwd: root,
          env: { ...process.env, OMNIDEV_MODEL: "environment-model" }
        }
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /mocked answer/);
      assert.match(result.stderr, /files summarized from/);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.model, "chosen-model");
      assert.match(requests[0]?.prompt as string, /FILE: src\/main\.ts/);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("root UI, ui, and tui aliases fail clearly without an interactive terminal", async () => {
  for (const command of [[], ["ui"], ["tui"]]) {
    const result = await runCli(command);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /interactive terminal required/);
  }
});

test("summarize refuses a remote configured endpoint without sending a request", async () => {
  const previousUrl = process.env.OMNIDEV_OLLAMA_URL;
  process.env.OMNIDEV_OLLAMA_URL = "https://example.invalid";
  try {
    const result = await runCli(["summarize", process.cwd()]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /require a loopback Ollama URL/);
  } finally {
    if (previousUrl === undefined) delete process.env.OMNIDEV_OLLAMA_URL;
    else process.env.OMNIDEV_OLLAMA_URL = previousUrl;
  }
});
