import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { checkOllama, generateLocal, streamLocal } from "../src/model/ollama.js";

type MockHandler = (request: IncomingMessage, response: ServerResponse) => void;

async function withMockOllama<T>(handler: MockHandler, run: () => Promise<T>): Promise<T> {
  const server: Server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert(address && typeof address !== "string");
  const previousUrl = process.env.OMNIDEV_OLLAMA_URL;
  process.env.OMNIDEV_OLLAMA_URL = `http://127.0.0.1:${address.port}`;

  try {
    return await run();
  } finally {
    if (previousUrl === undefined) delete process.env.OMNIDEV_OLLAMA_URL;
    else process.env.OMNIDEV_OLLAMA_URL = previousUrl;
    server.closeAllConnections();
    server.close();
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function ndjson(response: ServerResponse, items: unknown[]): void {
  response.writeHead(200, { "content-type": "application/x-ndjson" });
  response.end(items.map((item) => JSON.stringify(item)).join("\n") + "\n");
}

async function requestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function runCli(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
    cwd: process.cwd(),
    env
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const [status] = await once(child, "close") as [number | null];
  return { status, stdout, stderr };
}

test("checkOllama parses installed models and rejects malformed model lists", async () => {
  await withMockOllama((_request, response) => {
    json(response, 200, { models: [{ name: "qwen2.5-coder:7b" }] });
  }, async () => {
    const status = await checkOllama();
    assert.equal(status.ok, true);
    assert.deepEqual(status.models, ["qwen2.5-coder:7b"]);
  });

  await withMockOllama((_request, response) => {
    json(response, 200, { models: "not-an-array" });
  }, async () => {
    const status = await checkOllama();
    assert.equal(status.ok, false);
    assert.match(status.message ?? "", /invalid model list/);
  });
});

test("generation sends the full prompt and selected model", async () => {
  let received: Record<string, unknown> | undefined;
  await withMockOllama(async (request, response) => {
    received = await requestBody(request);
    json(response, 200, { response: "answer" });
  }, async () => {
    assert.equal(await generateLocal("a multiword prompt", "selected-model"), "answer");
  });

  assert.deepEqual(received, {
    model: "selected-model",
    prompt: "a multiword prompt",
    stream: false
  });
});

test("generation reports model-not-found without echoing Ollama error details", async () => {
  await withMockOllama((_request, response) => {
    json(response, 404, { error: "model 'secret-model' not found; credential=private-value" });
  }, async () => {
    await assert.rejects(generateLocal("prompt", "secret-model"), (error: Error) => {
      assert.match(error.message, /model not found/);
      assert.match(error.message, /ollama pull/);
      assert.doesNotMatch(error.message, /secret-model|private-value/);
      return true;
    });
  });
});

test("generation reports HTTP and malformed response errors safely", async () => {
  await withMockOllama((_request, response) => {
    json(response, 500, { error: "internal failure with credential=private-value" });
  }, async () => {
    await assert.rejects(generateLocal("prompt", "model"), (error: Error) => {
      assert.match(error.message, /HTTP 500/);
      assert.doesNotMatch(error.message, /private-value/);
      return true;
    });
  });

  await withMockOllama((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{malformed");
  }, async () => {
    await assert.rejects(generateLocal("prompt", "model"), /malformed JSON/);
  });

  await withMockOllama((_request, response) => {
    json(response, 200, { unexpected: "shape" });
  }, async () => {
    await assert.rejects(generateLocal("prompt", "model"), /invalid generation response/);
  });
});

test("generation reports timeouts and the status check reports offline Ollama", async () => {
  await withMockOllama((_request, _response) => {}, async () => {
    await assert.rejects(generateLocal("prompt", "model", 20), /timed out/);
  });

  await withMockOllama((_request, response) => {
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.flushHeaders();
  }, async () => {
    await assert.rejects(streamLocal("prompt", "model", () => {}, 20), /timed out/);
  });

  const previousUrl = process.env.OMNIDEV_OLLAMA_URL;
  process.env.OMNIDEV_OLLAMA_URL = "http://127.0.0.1:1";
  try {
    const status = await checkOllama(1_000);
    assert.equal(status.ok, false);
    assert.match(status.message ?? "", /could not connect/);
  } finally {
    if (previousUrl === undefined) delete process.env.OMNIDEV_OLLAMA_URL;
    else process.env.OMNIDEV_OLLAMA_URL = previousUrl;
  }
});

test("streamLocal parses Ollama NDJSON and reports malformed or incomplete streams", async () => {
  await withMockOllama((_request, response) => {
    ndjson(response, [{ response: "hello " }, { response: "there", done: true }]);
  }, async () => {
    const chunks: string[] = [];
    await streamLocal("prompt", "model", (chunk) => chunks.push(chunk));
    assert.deepEqual(chunks, ["hello ", "there"]);
  });

  await withMockOllama((_request, response) => {
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.end("{malformed\n");
  }, async () => {
    await assert.rejects(streamLocal("prompt", "model", () => {}), /malformed streaming data/);
  });

  await withMockOllama((_request, response) => {
    ndjson(response, [{ response: "partial", done: false }]);
  }, async () => {
    await assert.rejects(streamLocal("prompt", "model", () => {}), /incomplete streaming response/);
  });
});

test("CLI preserves a multiword prompt and --model overrides OMNIDEV_MODEL", async () => {
  let received: Record<string, unknown> | undefined;
  await withMockOllama(async (request, response) => {
    if (request.url === "/api/tags") {
      json(response, 200, { models: [{ name: "discovered-model" }] });
      return;
    }
    received = await requestBody(request);
    ndjson(response, [{ response: "answer", done: true }]);
  }, async () => {
    const result = await runCli([
      "ask",
      "keep this",
      "quoted phrase 'intact'",
      "--model",
      "explicit-model"
    ], { ...process.env, OMNIDEV_MODEL: "environment-model" });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(received, {
      model: "explicit-model",
      prompt: "keep this quoted phrase 'intact'",
      stream: true
    });
    assert.match(result.stdout, /answer/);
  });
});

test("CLI respects OMNIDEV_MODEL and explains when no local model is installed", async () => {
  let generationRequested = false;
  await withMockOllama(async (request, response) => {
    if (request.url === "/api/tags") {
      json(response, 200, { models: [] });
      return;
    }
    generationRequested = true;
    const body = await requestBody(request);
    ndjson(response, [{ response: String(body.model), done: true }]);
  }, async () => {
    const result = await runCli(
      ["ask", "use configured model"],
      { ...process.env, OMNIDEV_MODEL: "environment-model" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /environment-model/);
    assert.equal(generationRequested, true);
  });

  await withMockOllama((_request, response) => {
    json(response, 200, { models: [] });
  }, async () => {
    const env = { ...process.env };
    delete env.OMNIDEV_MODEL;
    const result = await runCli(["ask", "no model"], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no local models found/);
  });
});
