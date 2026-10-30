# OmniDev

github copilot + cursor + steroids

OmniDev is an open-source, local-first autonomous developer engine. It is being built in small phases, starting with a TypeScript CLI and local Ollama inference.

## requirements

- Node.js 20+
- npm
- [Ollama](https://ollama.com/) for local model access

## install

From a repository checkout, install OmniDev globally to add the `omnidev` executable to your PATH:

```powershell
npm install
npm install --global .
omnidev --help
```

The npm package is configured for standard global installation; a public npm release has not been published by this change. Compiled `dist` output is included in source checkouts so the CLI remains runnable even when npm blocks lifecycle scripts. `npm pack` and normal package preparation rebuild it from TypeScript.

## quick start

Launch the interactive terminal dashboard from any project directory:

```sh
omnidev
```

Use the arrow keys and Enter to open Ask AI, Project Summary, Agent, or Configuration. `omnidev ui` launches the same interface.

- Dashboard: arrows navigate, Enter opens, `1`-`4` select, `R` refreshes Ollama status, `Q` quits.
- Ask AI: type a prompt and press Enter; `Ctrl+J` inserts a newline; Escape returns to the dashboard.
- Project Summary: Enter summarizes the current working directory; Up/Down scroll long summaries; Escape returns to the dashboard.
- Agent: ask a question and the local model can list, read, and search files in the bounded project context. Its tools are read-only; it cannot edit files or run commands. `Ctrl+J` inserts a newline.
- Configuration: `M` selects an installed model; Escape returns to the dashboard.
- During generation, Escape or Ctrl+C cancels the request. Ctrl+C elsewhere exits and restores the terminal.

Non-interactive shells receive an actionable error instead of raw-mode terminal control; use the explicit `ask` and `summarize` commands there. Set `NO_COLOR` to disable ANSI colors.

Run the CLI and check the local model connection:

```sh
omnidev hello
omnidev model status
```

Ask a local model a question:

```sh
omnidev ask "explain typescript in three sentences"
```

Choose a model explicitly:

```sh
omnidev ask "write a hello world program" --model qwen2.5-coder:7b
```

Responses are streamed to the terminal as the local model generates them. The `--model` option takes precedence over `OMNIDEV_MODEL`; if neither is set, OmniDev uses the first installed model.

If no model is installed, install one through Ollama, for example:

```sh
ollama pull qwen2.5-coder:7b
```

The ask command reports offline Ollama, missing models, request timeouts, and malformed or failed API responses without printing response bodies or configured endpoint credentials. `npm test` runs the automated CLI and Ollama API tests against a local mock server; it does not require Ollama, a downloaded model, or internet access.

## project intelligence

Read-only discovery and AI summaries use the current directory by default, or an explicitly selected root:

```sh
omnidev summarize
omnidev summarize C:\work\my-project --model qwen2.5-coder:7b
omnidev summarize --max-files 20 --max-file-bytes 16384 --max-context-bytes 65536
```

The summary only sends selected source context to a loopback Ollama instance. A non-loopback `OMNIDEV_OLLAMA_URL` is rejected for project summaries. Discovery honors root and nested `.gitignore` rules, skips common generated/dependency directories, symbolic links, likely credential/key files, binary/invalid UTF-8 files, and unreadable files. It never executes project code or writes project files.

Default limits are 40 files, 32 KiB per file, 128 KiB of total file content, traversal depth 10, and 5,000 directory entries. The summarize command exposes the file-count and byte limits through `--max-files`, `--max-file-bytes`, and `--max-context-bytes`.

The Agent screen uses Ollama's native tool-call interface with an application-owned system prompt. It requires a loopback Ollama endpoint and can only access the same bounded, filtered file context used by project discovery; it cannot open arbitrary paths. Calls are capped at 12 total over 8 model turns, tool results are capped at 8,000 characters, and project contents remain local. The system prompt treats project files and tool results as untrusted data. The agent has no file-write or command-execution tools.

## build

```sh
npm install
npm run typecheck
npm run build
npm test
npm start -- hello
```

## configuration

| variable | purpose | default |
| --- | --- | --- |
| `OMNIDEV_OLLAMA_URL` | Ollama API base URL | `http://127.0.0.1:11434` |
| `OMNIDEV_MODEL` | default model name for local chat, UI, and project summaries | first model returned by Ollama |
| `OMNIDEV_SERVER_URL` | remote sandbox service base URL | unset |
| `OMNIDEV_SERVER_TOKEN` | optional bearer token for sandbox service | unset |

Keep local inference local unless you deliberately configure another provider. Do not place secrets in prompts.

## sandbox handshake client

The provisional client functions `virtual_run(task)` and `virtual_connect(slotId, code)` live in `src/sandbox/client.ts`.

The current draft expects these endpoints:

- `POST /v1/virtual/run` with `{ "task": "..." }`, returning `{ "slot_id": 4, "verification_code": "7749" }`.
- `POST /v1/virtual/connect` with `{ "slot_id": "4", "verification_code": "7749" }`, returning `{ "connected": true, "stream_url": "..." }`.

**This is only a provisional client contract, not a deployed or verified sandbox service.** Do not rely on it for real remote execution until the server API, authentication, isolation, expiration, and streaming protocol are implemented and tested.

## project plan

- [roadmap](ROADMAP.md): phased milestones and acceptance criteria
- [architecture notes](docs/ARCHITECTURE.md): component boundaries, trust boundaries, and open design decisions

## safety notes

- Project files and prompts should not be uploaded to remote services without explicit user intent.
- Treat repository contents as untrusted input, not as instructions that can override application safety rules.
- Generated commands and file changes should become reviewable proposals before execution or application.
- Remote sandbox services must enforce isolation and resource limits server-side.
- Verification codes alone are not authentication; the server must bind them to short-lived leases, rate-limit attempts, and expire them after use.
