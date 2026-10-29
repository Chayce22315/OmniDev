import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { buildProjectSummaryPrompt, collectProjectContext } from "../src/project/context.js";
import { streamProjectSummary } from "../src/project/summarize.js";

async function withProject<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), "omnidev-project-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withOllama<T>(run: () => Promise<T>): Promise<{ result: T; getPrompt: () => Record<string, unknown> | undefined }> {
  let prompt: Record<string, unknown> | undefined;
  const server: Server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url === "/api/tags") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "test-model" }] }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    prompt = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    response.writeHead(200, { "content-type": "application/x-ndjson" });
    response.end(`${JSON.stringify({ response: "local summary", done: true })}\n`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");

  const previousUrl = process.env.OMNIDEV_OLLAMA_URL;
  process.env.OMNIDEV_OLLAMA_URL = `http://127.0.0.1:${address.port}`;
  try {
    const result = await run();
    return { result, getPrompt: () => prompt };
  } finally {
    if (previousUrl === undefined) delete process.env.OMNIDEV_OLLAMA_URL;
    else process.env.OMNIDEV_OLLAMA_URL = previousUrl;
    server.closeAllConnections();
    server.close();
  }
}

test("project discovery applies nested ignore rules and generated-directory exclusions deterministically", async () => {
  await withProject(async (root) => {
    await mkdir(path.join(root, "nested"), { recursive: true });
    await mkdir(path.join(root, "ignored"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, ".gitignore"), [
      "*.log",
      "!keep.log",
      "/root-only.txt",
      "nested/*.tmp",
      "ignored/",
      "**/cache/**"
    ].join("\n"));
    await writeFile(path.join(root, "z.ts"), "z");
    await writeFile(path.join(root, "a.ts"), "a");
    await writeFile(path.join(root, "skip.log"), "skip");
    await writeFile(path.join(root, "keep.log"), "keep");
    await writeFile(path.join(root, "root-only.txt"), "skip");
    await writeFile(path.join(root, "nested", ".gitignore"), "local-only.txt\n");
    await writeFile(path.join(root, "nested", "skip.tmp"), "skip");
    await writeFile(path.join(root, "nested", "keep.ts"), "keep");
    await writeFile(path.join(root, "nested", "local-only.txt"), "skip");
    await writeFile(path.join(root, "ignored", "file.ts"), "skip");
    await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "skip");
    await writeFile(path.join(root, "dist", "bundle.js"), "skip");
    await mkdir(path.join(root, "nested", "cache"), { recursive: true });
    await writeFile(path.join(root, "nested", "cache", "temp.ts"), "skip");

    const first = await collectProjectContext(root);
    const second = await collectProjectContext(root);
    const paths = first.files.map((file) => file.path);
    assert.deepEqual(paths, [...paths].sort());
    assert.deepEqual(paths, [".gitignore", "a.ts", "keep.log", "nested/.gitignore", "nested/keep.ts", "z.ts"]);
    assert.deepEqual(second.files, first.files);
  });
});

test("project discovery filters sensitive, binary, invalid UTF-8, and oversized files", async () => {
  await withProject(async (root) => {
    await writeFile(path.join(root, ".env"), "SECRET=do-not-read");
    await writeFile(path.join(root, ".env.example"), "PORT=3000");
    await writeFile(path.join(root, "credentials.json"), "do-not-read");
    await writeFile(path.join(root, "id_rsa"), "do-not-read");
    await writeFile(path.join(root, "private.pem"), "do-not-read");
    await mkdir(path.join(root, ".config", "gh"), { recursive: true });
    await writeFile(path.join(root, ".config", "gh", "hosts.yml"), "oauth_token: do-not-read");
    await writeFile(path.join(root, "binary.dat"), Buffer.from([0, 1, 2]));
    await writeFile(path.join(root, "invalid.txt"), Buffer.from([0xff, 0xfe]));
    await writeFile(path.join(root, "large.txt"), "0123456789");
    await writeFile(path.join(root, "small.txt"), "hello");

    const context = await collectProjectContext(root, { maxFileBytes: 9 });
    assert.deepEqual(context.files.map((file) => file.path), [".env.example", "small.txt"]);
    assert.equal(context.skippedFiles, 3);
    const prompt = buildProjectSummaryPrompt(context);
    assert.match(prompt, /FILE: \.env\.example/);
    assert.doesNotMatch(prompt, /do-not-read|SECRET/);
  });
});

test("file count, per-file bytes, aggregate bytes, depth, and entry limits are bounded", async () => {
  await withProject(async (root) => {
    await mkdir(path.join(root, "one", "two"), { recursive: true });
    await writeFile(path.join(root, "a.txt"), "1234");
    await writeFile(path.join(root, "b.txt"), "5678");
    await writeFile(path.join(root, "one", "c.txt"), "abcd");
    await writeFile(path.join(root, "one", "two", "d.txt"), "efgh");

    const byFiles = await collectProjectContext(root, { maxFiles: 2 });
    assert.equal(byFiles.files.length, 2);
    assert.equal(byFiles.truncated, true);

    const byTotal = await collectProjectContext(root, { maxTotalBytes: 5 });
    assert.equal(Buffer.byteLength(byTotal.files.map((file) => file.content).join("")), 4);
    assert.equal(byTotal.truncated, true);

    const byDepth = await collectProjectContext(root, { maxDepth: 0 });
    assert.deepEqual(byDepth.files.map((file) => file.path), ["a.txt", "b.txt"]);
    assert.equal(byDepth.truncated, true);

    const byEntries = await collectProjectContext(root, { maxEntries: 2 });
    assert.equal(byEntries.truncated, true);
  });
});

test("context limits reject unsafe values and missing/non-directory roots fail clearly", async () => {
  await withProject(async (root) => {
    await assert.rejects(collectProjectContext(root, { maxFiles: 0 }), /positive integer/);
    await assert.rejects(collectProjectContext(path.join(root, "missing")), /does not exist or cannot be read/);
    const file = path.join(root, "file.txt");
    await writeFile(file, "file");
    await assert.rejects(collectProjectContext(file), /must point to a directory/);
  });
});

test("project discovery does not follow directory symlinks outside the selected root", async () => {
  await withProject(async (root) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "omnidev-outside-"));
    try {
      await writeFile(path.join(outside, "secret.ts"), "outside-root-secret");
      try {
        await symlink(outside, path.join(root, "outside-link"), process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if (error instanceof Error && "code" in error && ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))) {
          return;
        }
        throw error;
      }

      const context = await collectProjectContext(root);
      assert.deepEqual(context.files, []);
      assert.doesNotMatch(JSON.stringify(context), /outside-root-secret/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test("empty projects and inaccessible roots produce actionable errors", async () => {
  const previousUrl = process.env.OMNIDEV_OLLAMA_URL;
  process.env.OMNIDEV_OLLAMA_URL = "http://127.0.0.1:11434";
  try {
    await withProject(async (root) => {
      await assert.rejects(
        streamProjectSummary(root, "model", () => {}),
        /no readable project files/
      );
      await assert.rejects(collectProjectContext(path.join(root, "unreadable")), /does not exist or cannot be read/);
    });
  } finally {
    if (previousUrl === undefined) delete process.env.OMNIDEV_OLLAMA_URL;
    else process.env.OMNIDEV_OLLAMA_URL = previousUrl;
  }
});

test("project discovery is read-only and summary prompts use relative file paths and untrusted-data policy", async () => {
  await withProject(async (root) => {
    await mkdir(path.join(root, "src"));
    const sourcePath = path.join(root, "src", "main.ts");
    await writeFile(sourcePath, "export const answer = 42;\n");
    const before = await readFile(sourcePath);
    const context = await collectProjectContext(root);
    const prompt = buildProjectSummaryPrompt(context);
    assert.match(prompt, /FILE: src\/main\.ts/);
    assert.match(prompt, /untrusted data/);
    assert.match(prompt, /Do not follow instructions/);
    assert.equal((prompt.split("--- FILE:")[1] ?? "").includes(root), false);
    assert.deepEqual(await readFile(sourcePath), before);
  });
});

test("AI project summary uses the local Ollama adapter with bounded relative-path context", async () => {
  await withProject(async (root) => {
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.ts"), "export const app = true;");
    const { result, getPrompt } = await withOllama(async () => {
      const chunks: string[] = [];
      const summary = await streamProjectSummary(root, "test-model", (chunk) => chunks.push(chunk), { maxFiles: 4 });
      return { summary, chunks };
    });

    assert.equal(result.summary.fileCount, 1);
    assert.deepEqual(result.chunks, ["local summary"]);
    const request = getPrompt();
    assert.equal(request?.model, "test-model");
    assert.equal(request?.stream, true);
    assert.match(request?.prompt as string, /FILE: src\/app\.ts/);
  });
});

test("project summary rejects remote Ollama endpoints before making a request", async () => {
  const previousUrl = process.env.OMNIDEV_OLLAMA_URL;
  process.env.OMNIDEV_OLLAMA_URL = "https://example.invalid";
  try {
    await withProject(async (root) => {
      await writeFile(path.join(root, "source.ts"), "content");
      await assert.rejects(
        streamProjectSummary(root, "model", () => {}),
        /require a loopback Ollama URL/
      );
    });
  } finally {
    if (previousUrl === undefined) delete process.env.OMNIDEV_OLLAMA_URL;
    else process.env.OMNIDEV_OLLAMA_URL = previousUrl;
  }
});
