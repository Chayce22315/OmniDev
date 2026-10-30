# OmniDev architecture notes

## product direction

OmniDev is an open-source, local-first developer engine. It should help a developer understand a project, propose changes, edit files with review, run verification, and eventually coordinate specialized models or agents.

The guiding rule is: **observe first, propose second, modify only with clear boundaries, verify every change.**

## current components

- `src/index.ts`: command-line entry point and command registration
- `src/model/ollama.ts`: local Ollama health checks, model selection, and streamed generation
- `src/project/context.ts`: bounded, read-only project file discovery and summary prompt construction
- `src/project/summarize.ts`: local-only project summary streaming
- `src/agent.ts`: bounded Ollama tool-call loop with an application-owned system prompt and a deterministic read-only tool allowlist
- `src/tui.ts`: interactive local developer dashboard
- `src/sandbox/client.ts`: provisional client for a future remote sandbox service
- `src/sandbox/index.ts`: sandbox client exports

The CLI's local model connection defaults to `http://127.0.0.1:11434`. It can be overridden with `OMNIDEV_OLLAMA_URL`. The `ask` command selects models in this order: `--model`, `OMNIDEV_MODEL`, then the first model returned by Ollama. Generation is streamed from Ollama's newline-delimited JSON response.

The `summarize` command and TUI share the same project context collector and summary service. Discovery is deterministic and bounded to 40 files, 32 KiB per file, 128 KiB total source content, depth 10, and 5,000 visited entries by default. It honors nested `.gitignore` rules, skips common generated/dependency and credential directories, likely secret/key files, symlinks, binary and invalid UTF-8 files, and inaccessible content. Summary generation is refused unless Ollama is configured on a loopback host. The TUI requires an interactive TTY, restores raw/alternate-screen state on exit, supports cancellation, and preserves readable response history.

The Agent screen uses Ollama's native `/api/chat` tool-call protocol and a fixed system prompt. It requires a loopback endpoint, loads only the same bounded and filtered project context, and exposes only `list_project_files`, `read_project_file`, and literal `search_project` operations over that in-memory context. Tool requests cannot access arbitrary paths, write files, or execute commands. The loop is limited to 8 model turns, 12 tool calls, and 8,000 characters per tool result; cancellation and errors are reported in the TUI.

The npm package exposes the compiled `dist/index.js` through its `bin` mapping. `npm pack` builds the TypeScript output before packaging and includes only the runtime distribution, license, and user-facing documentation.

## intended layers

1. **cli layer**: parse arguments, print output, return useful exit codes.
2. **application layer**: coordinate a user task without depending directly on a specific model vendor.
3. **model adapter layer**: provide a small, consistent interface for local and optional future providers.
4. **project context layer**: inspect only the selected workspace, with ignore and size limits.
5. **change layer**: represent edits as reviewable plans and apply them within the workspace boundary.
6. **verification layer**: run configured checks and report their actual outcomes.
7. **sandbox adapter layer**: optional remote execution behind a versioned API contract.

Do not prematurely create all layers as empty abstractions. Add each when a concrete milestone needs it.

## trust boundaries

- local inference should remain local unless the user explicitly configures another provider; project summaries require loopback
- workspace files are untrusted input, not instructions that can override application safety rules
- the agent system prompt and deterministic tool allowlist are application-controlled; model output cannot expand tool permissions
- agent tools read only files already admitted to the bounded project context and never perform writes or command execution
- generated shell commands and file edits are proposals, not automatically trusted actions
- remote sandbox requests can expose task content; disclose this before sending project data
- secrets must not be included in prompts, logs, test fixtures, or remote requests
- verification codes are not sufficient authentication by themselves; the server must bind them to short-lived leases, rate-limit attempts, and expire them after use
- a remote service must enforce isolation and resource limits server-side; client-side checks are not a security boundary

## implementation principles

- TypeScript strict mode and small modules
- no mandatory cloud API keys
- explicit timeouts for network operations
- actionable errors without dumping secrets
- mock network boundaries in automated tests
- no claim of success unless the underlying operation actually succeeded
- prefer standard platform APIs and minimal dependencies

## design references

- [roadmap](../ROADMAP.md): milestones and acceptance criteria
- [change plan format](CHANGE_PLAN_FORMAT.md): proposed safe edit format for phase 3
- [model routing](MODEL_ROUTING.md): local-first provider selection proposal for phase 5
- [threat model](THREAT_MODEL.md): initial threats and required mitigations

The change-plan and model-routing documents remain proposals for later phases. The read-only project discovery, local summaries, terminal UI, and npm CLI packaging described above are implemented in the current phase.

## decisions still open

- how to represent structured file-change plans
- how approval policies should be configured
- which streaming protocol to use for local generation
- the actual remote sandbox API, authentication, and log-stream protocol
- how local model capabilities will be described for future routing
