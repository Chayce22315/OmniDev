import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { runTui, renderTuiFrame, wrapText } from "../src/tui.js";

class TestInput extends PassThrough {
  isTTY = true;
  rawMode = false;
  setRawMode(enabled: boolean): void {
    this.rawMode = enabled;
  }
}

class TestOutput extends PassThrough {
  isTTY = true;
  columns = 80;
  rows = 24;
  text = "";

  constructor() {
    super();
    this.setEncoding("utf8");
    this.on("data", (chunk: string) => { this.text += chunk; });
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("test timed out waiting for TUI state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function key(input: TestInput, value: string, name: string, ctrl = false): void {
  input.emit("keypress", value, { name, ctrl, shift: false });
}

async function withMockOllama<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (url: string) => Promise<T>
): Promise<T> {
  const server: Server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const previousUrl = process.env.OMNIDEV_OLLAMA_URL;
  const previousModel = process.env.OMNIDEV_MODEL;
  process.env.OMNIDEV_OLLAMA_URL = `http://127.0.0.1:${address.port}`;
  delete process.env.OMNIDEV_MODEL;
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    if (previousUrl === undefined) delete process.env.OMNIDEV_OLLAMA_URL;
    else process.env.OMNIDEV_OLLAMA_URL = previousUrl;
    if (previousModel === undefined) delete process.env.OMNIDEV_MODEL;
    else process.env.OMNIDEV_MODEL = previousModel;
    server.closeAllConnections();
    server.close();
  }
}

test("colorless dashboard exposes project status, navigation, and keyboard shortcuts", () => {
  assert.deepEqual(wrapText("a long line of text\nand a second line", 8), [
    "a long",
    "line of",
    "text",
    "and a",
    "second",
    "line"
  ]);
  const frame = renderTuiFrame("dashboard", {
    root: "C:\\work\\sample",
    model: "test-model",
    models: ["test-model"],
    ollamaOnline: true,
    ollamaLocal: true,
    selectedMenu: 0,
    messages: [],
    draft: "",
    busy: false,
    scroll: -1,
    selectingModel: false,
    selectedModel: 0,
    color: false,
    columns: 60,
    rows: 24
  });
  assert.match(frame, /OMNI.*DEV.*LOCAL-FIRST DEVELOPER COCKPIT/);
  assert.match(frame, /C:\\work\\sample/);
  assert.match(frame, /Ollama\s+online/);
  assert.match(frame, /Ask AI/);
  assert.match(frame, /◆.*\[1\].*Ask AI/);
  assert.match(frame, /Project summary/);
  assert.match(frame, /Ctrl\+C quit/);
  assert.doesNotMatch(frame, /\u001b\[(?:1;)?(?:31|32|33|36)m/);
});

test("TUI refuses non-interactive input before entering raw mode", async () => {
  const input = new PassThrough() as TestInput;
  Object.defineProperty(input, "isTTY", { value: false });
  const output = new PassThrough() as TestOutput;
  await assert.rejects(runTui({ input, output }), /interactive terminal required/);
});

test("TUI navigates dashboard/config/Ask/Summary, switches models, streams replies, and restores terminal state", async () => {
  const generateRequests: Record<string, unknown>[] = [];
  await withMockOllama(async (request, response) => {
    if (request.url === "/api/tags") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "model-a" }, { name: "model-b" }] }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    generateRequests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.end(`${JSON.stringify({ response: "local answer", done: true })}\n`);
  }, async () => {
    const input = new TestInput();
    const output = new TestOutput();
    const ui = runTui({ input, output, color: false, root: process.cwd() });
    await waitFor(() => output.text.includes("Dashboard"));

    key(input, "3", "3");
    key(input, "\r", "return");
    await waitFor(() => output.text.includes("Configuration & status"));
    key(input, "m", "m");
    key(input, "\u001b[B", "down");
    key(input, "\r", "return");
    assert.match(output.text, /model-b/);

    key(input, "\u001b", "escape");
    key(input, "1", "1");
    key(input, "\r", "return");
    await waitFor(() => output.text.includes("Ask AI"));
    key(input, "hello", "h");
    key(input, "\r", "return");
    await waitFor(() => generateRequests.length === 1);
    await waitFor(() => output.text.includes("local answer"));
    assert.equal(generateRequests[0]?.model, "model-b");
    assert.equal(generateRequests[0]?.prompt, "hello");
    assert.equal(generateRequests[0]?.stream, true);

    const previousFrameLength = output.text.length;
    output.columns = 42;
    output.emit("resize");
    await waitFor(() => output.text.length > previousFrameLength);
    assert.match(output.text.slice(previousFrameLength), /─{41}/);
    key(input, "\u001b", "escape");
    key(input, "2", "2");
    key(input, "\r", "return");
    await waitFor(() => output.text.includes("Read-only discovery root"));
    key(input, "\r", "return");
    await waitFor(() => generateRequests.length === 2);
    assert.equal(generateRequests[1]?.model, "model-b");
    assert.equal(generateRequests[1]?.stream, true);
    assert.match(generateRequests[1]?.prompt as string, /FILE: src\/index\.ts/);
    await waitFor(() => (output.text.match(/local answer/g)?.length ?? 0) >= 2);
    key(input, "\u001b", "escape");
    key(input, "q", "q");
    await ui;
    assert.equal(input.rawMode, false);
    assert.match(output.text, /\u001b\[0m\u001b\[\?25h\u001b\[\?1049l/);
  });
});

test("TUI shows model errors and can cancel a pending request", async () => {
  let requestReceived = false;
  await withMockOllama((request, response) => {
    if (request.url === "/api/tags") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "test-model" }] }));
      return;
    }
    requestReceived = true;
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.flushHeaders();
    request.on("close", () => response.destroy());
  }, async () => {
    const input = new TestInput();
    const output = new TestOutput();
    const ui = runTui({ input, output, color: false });
    await waitFor(() => output.text.includes("Dashboard"));
    key(input, "1", "1");
    key(input, "\r", "return");
    key(input, "wait", "w");
    key(input, "\r", "return");
    await waitFor(() => requestReceived);
    key(input, "\u001b", "escape");
    await waitFor(() => output.text.includes("Request cancelled."));
    key(input, "\u001b", "escape");
    key(input, "q", "q");
    await ui;
    assert.equal(input.rawMode, false);
  });
});

test("TUI renders request failures and Ctrl+C exits with terminal restoration", async () => {
  await withMockOllama((request, response) => {
    if (request.url === "/api/tags") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "test-model" }] }));
      return;
    }
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "private diagnostic details" }));
  }, async () => {
    const input = new TestInput();
    const output = new TestOutput();
    const ui = runTui({ input, output, color: false });
    await waitFor(() => output.text.includes("Dashboard"));
    key(input, "1", "1");
    key(input, "\r", "return");
    key(input, "hello", "h");
    key(input, "\r", "return");
    await waitFor(() => output.text.includes("HTTP 500"));
    assert.doesNotMatch(output.text, /private diagnostic details/);
    key(input, "\u0003", "c", true);
    await ui;
    assert.equal(input.rawMode, false);
  });
});
