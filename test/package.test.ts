import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

interface PackageManifest {
  name: string;
  private?: boolean;
  bin?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  repository?: { url?: string };
  engines?: { node?: string };
}

test("npm package metadata exposes the compiled executable and only runtime dependencies", async () => {
  const root = process.cwd();
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as PackageManifest;
  const source = await readFile(path.join(root, "src", "index.ts"), "utf8");

  assert.equal(manifest.name, "omnidev");
  assert.notEqual(manifest.private, true);
  assert.equal(manifest.bin?.omnidev, "./dist/index.js");
  assert.ok(manifest.files?.includes("dist"));
  assert.equal(manifest.dependencies?.commander, "^14.0.0");
  assert.match(manifest.engines?.node ?? "", />=20/);
  assert.match(manifest.repository?.url ?? "", /Chayce22315\/OmniDev/);
  assert.match(source, /^#!\/usr\/bin\/env node/);
});

test("npm pack dry-run builds and includes the runtime executable but excludes source and tests", async () => {
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json"],
    { cwd: process.cwd(), encoding: "utf8", shell: process.platform === "win32" }
  );
  assert.equal(result.status, 0, result.stderr);

  type PackManifest = { files?: Array<{ path: string }> };
  const parsed = JSON.parse(result.stdout) as PackManifest | { omnidev: PackManifest } | PackManifest[];
  const manifest = Array.isArray(parsed)
    ? parsed[0]
    : "omnidev" in parsed ? parsed.omnidev : parsed;
  const files = manifest?.files?.map((file) => file.path) ?? [];
  assert.ok(files.includes("dist/index.js"));
  assert.ok(files.includes("dist/project/context.js"));
  assert.ok(files.includes("dist/tui.js"));
  assert.ok(files.includes("README.md"));
  assert.ok(files.includes("LICENSE"));
  assert.ok(files.includes("ROADMAP.md"));
  assert.ok(files.includes("docs/ARCHITECTURE.md"));
  assert.ok(files.includes("docs/THREAT_MODEL.md"));
  assert.ok(!files.some((file) => file.startsWith("src/")));
  assert.ok(!files.some((file) => file.startsWith("test/")));
  assert.ok(!files.some((file) => file.startsWith("node_modules/")));
  const executable = await readFile(path.join(process.cwd(), "dist", "index.js"), "utf8");
  assert.match(executable, /^#!\/usr\/bin\/env node/);
});
