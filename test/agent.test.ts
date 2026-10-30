import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { runAgent, AGENT_SYSTEM_PROMPT } from "../src/agent.js";

type ChatRequest = {
  model: string;
  messages: Array<{ role: string; content: string; tool_name?: string }>;
  tools: Array<{ type: string; function: { name: string } }>;
};

async function requestBody(request: IncomingMessage): Promise<ChatRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChatRequest;
}

function json(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function withMockOllama<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  run: (requests: ChatRequest[]) => Promise<T>
): Promise<T> {
  const requests: ChatRequest[] = [];
  const server: Server = createServer(async (request, response) => {
    if (request.url === "/api/chat") requests.push(await requestBody(request));
    await handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const previousUrl = process.env.OMNIDEV_OLLAMA_URL;
  process.env.OMNIDEV_OLLAMA_URL = `http://127.0.0.1:${address.port}`;
  try {
    return await run(requests);
  } finally {
    if (previousUrl === undefined) delete process.env.OMNIDEV_OLLAMA_URL;
    else process.env.OMNIDEV_OLLAMA_URL = previousUrl;
    server.closeAllConnections();
    server.close();
  }
}

test("agent uses a system prompt and bounded read-only tools before returning a final response", async () => {
  const toolEvents: string[] = [];
  await withMockOllama(async (_request, response) => {
    const requestCount = toolEvents.length;
    if (requestCount === 0) {
      json(response, {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{
            function: { name: "read_project_file", arguments: { path: "src/index.ts" } }
          }]
        },
        done: false
      });
    } else {
      json(response, { message: { role: "assistant", content: "The entry point registers the CLI commands." }, done: true });
    }
  }, async (requests) => {
    const result = await runAgent("What does the entry point do?", "local-model", {
      root: process.cwd(),
      onToolCall: ({ name, detail }) => toolEvents.push(`${name}:${detail}`)
    });

    assert.equal(result.response, "The entry point registers the CLI commands.");
    assert.equal(result.toolCalls, 1);
    assert.equal(result.turns, 2);
    assert.deepEqual(toolEvents, ["read_project_file:src/index.ts"]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.model, "local-model");
    assert.equal(requests[0]?.messages[0]?.role, "system");
    assert.equal(requests[0]?.messages[0]?.content, AGENT_SYSTEM_PROMPT);
    assert.match(AGENT_SYSTEM_PROMPT, /no write or command-execution tools/);
    assert.deepEqual(requests[0]?.tools.map((tool) => tool.function.name), [
      "list_project_files",
      "read_project_file",
      "search_project"
    ]);
    assert.equal(requests[1]?.messages.at(-1)?.role, "tool");
    assert.match(requests[1]?.messages.at(-1)?.content ?? "", /src\/index\.ts/);
    assert.match(requests[1]?.messages.at(-1)?.content ?? "", /#!/);
  });
});

test("agent refuses remote endpoints before sending a request", async () => {
  const previousUrl = process.env.OMNIDEV_OLLAMA_URL;
  process.env.OMNIDEV_OLLAMA_URL = "https://example.invalid";
  try {
    await assert.rejects(runAgent("inspect", "model"), /require a loopback Ollama URL/);
  } finally {
    if (previousUrl === undefined) delete process.env.OMNIDEV_OLLAMA_URL;
    else process.env.OMNIDEV_OLLAMA_URL = previousUrl;
  }
});

test("agent rejects traversal tool calls and bounds repeated tool calls", async () => {
  let callCount = 0;
  await withMockOllama(async (_request, response) => {
    callCount += 1;
    if (callCount === 1) {
      json(response, {
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{
            function: { name: "read_project_file", arguments: { path: "../outside.txt" } }
          }]
        },
        done: false
      });
      return;
    }
    json(response, { message: { role: "assistant", content: "The unsafe path was rejected." }, done: true });
  }, async (requests) => {
    const result = await runAgent("read outside file", "local-model", { root: process.cwd() });
    assert.match(result.response, /unsafe path was rejected/);
    assert.equal(requests[1]?.messages.at(-1)?.content, "Invalid path. Provide an exact safe project-relative file path.");
  });

  await withMockOllama(async (_request, response) => {
    json(response, {
      message: {
        role: "assistant",
        content: "",
        tool_calls: Array.from({ length: 13 }, () => ({
          function: { name: "list_project_files", arguments: {} }
        }))
      },
      done: false
    });
  }, async () => {
    await assert.rejects(runAgent("loop", "local-model", { root: process.cwd() }), /12-call safety limit/);
  });
});
