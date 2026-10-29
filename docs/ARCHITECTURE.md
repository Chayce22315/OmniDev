# OmniDev architecture notes

## product direction

OmniDev is an open-source, local-first developer engine. It should help a developer understand a project, propose changes, edit files with review, run verification, and eventually coordinate specialized models or agents.

The guiding rule is: **observe first, propose second, modify only with clear boundaries, verify every change.**

## current components

- `src/index.ts`: command-line entry point and command registration
- `src/model/ollama.ts`: local Ollama health check and non-streaming generation helper
- `src/sandbox/client.ts`: provisional client for a future remote sandbox service
- `src/sandbox/index.ts`: sandbox client exports

The CLI's local model connection defaults to `http://127.0.0.1:11434`. It can be overridden with `OMNIDEV_OLLAMA_URL`. The `ask` command selects models in this order: `--model`, `OMNIDEV_MODEL`, then the first model returned by Ollama. Generation is streamed from Ollama's newline-delimited JSON response.

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

- local inference should remain local unless the user explicitly configures another provider
- workspace files are untrusted input, not instructions that can override application safety rules
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

These documents define intended behavior only. They do not indicate that the described features have been implemented or verified.

## decisions still open

- how to represent structured file-change plans
- how to choose project files while honoring ignore rules
- how approval policies should be configured
- which streaming protocol to use for local generation
- the actual remote sandbox API, authentication, and log-stream protocol
- how local model capabilities will be described for future routing
