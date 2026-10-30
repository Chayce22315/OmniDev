# OmniDev roadmap

OmniDev is being built in small, verifiable phases. Prefer a working foundation over speculative infrastructure.

## working agreements

- local-first by default; no mandatory paid API or cloud dependency
- keep the CLI usable while new capabilities are added
- implement one coherent milestone at a time
- tests and builds must pass before a code milestone is considered complete
- do not claim remote sandbox functionality works until a real server contract and integration test exist
- never upload project files or secrets to a remote service without an explicit user action
- avoid adding dependencies unless they solve a concrete problem

## phase 0: repository foundation

**status: scaffold exists; verify locally**

- [x] TypeScript CLI skeleton
- [x] `hello` command
- [x] Ollama status check
- [x] local generation helper
- [x] provisional sandbox client interface
- [ ] establish automated build and typecheck workflow

## phase 1: dependable local chat

**implementation owner: GitHub Copilot; verify with local tests**

- [x] make `omnidev ask` robust for prompts and model selection
- [x] handle missing Ollama, missing models, timeouts, and API errors clearly
- [x] add automated tests for CLI behavior and Ollama API responses using a mocked local server
- [x] support streaming output only after the non-streaming path is covered
- [x] document model selection and environment variables
- [x] run typecheck, build, and tests; report actual results

Acceptance: `omnidev ask "..." ` works with a local model, failure paths are understandable, and tests do not require a running model or cloud account. The mocked API contract and live generation against an installed local model are verified.

## phase 2: project intelligence, TUI, and installable CLI

**implementation owner: GitHub Copilot; verify with tests**

- [x] detect the current working directory and allow selecting a project root
- [x] add an explicit command to summarize a project using local model inference and a bounded file list
- [x] respect `.gitignore` and skip generated, sensitive, binary, and oversized files
- [x] keep project discovery read-only and prevent symlink escapes
- [x] test path handling, ignore rules, file filtering, and size limits
- [x] provide an interactive TUI for local chat, model switching, and project summaries
- [x] package the CLI using npm's standard `bin` installation mechanism

Acceptance: developers can install and run `omnidev`, interact with local models through the terminal UI, and summarize bounded project context without modifying files or sending source to a remote service.

## phase 3: safe file changes

**implementation owner: GitHub Copilot; verify with tests**

- [ ] define a structured change-plan format before editing files
- [ ] preview proposed changes before applying them
- [ ] keep edits inside the selected project root
- [ ] create backups or use reversible patch application
- [ ] reject path traversal and symlink escapes
- [ ] test apply, preview, rollback, and failure behavior

Acceptance: file changes are scoped, reviewable, and recoverable.

## phase 4: command execution and verification

**implementation owner: GitHub Copilot; verify with tests**

- [ ] design a command runner with explicit working-directory boundaries
- [ ] default to approval before executing generated commands
- [ ] capture exit code, stdout, stderr, and duration
- [ ] add timeouts and cancellation
- [ ] test denied commands, timeouts, nonzero exits, and directory boundaries

Acceptance: generated commands are never silently treated as trusted, and results are reported accurately.

## phase 5: model orchestration

**a constrained read-only tool loop is implemented; broader orchestration remains design-first**

- [x] add a bounded local agent loop using an application-owned system prompt and read-only project-context tools
- [ ] define a provider-neutral model interface
- [ ] discover locally installed models and their capabilities
- [ ] define routing rules that prefer available local models
- [ ] add optional critique/revision workflows with bounded iterations
- [ ] measure quality and latency before introducing parallel agents

The implemented Agent screen uses Ollama's native tool-call interface and exposes only bounded file listing, reading, and literal search over already-filtered project context. It has no write or command-execution tools. Acceptance for full model orchestration remains: model choice is explainable, bounded, and works without a paid cloud service.

## phase 6: remote sandbox pool

**blocked on an agreed server API and security design**

- [ ] publish and version the actual server contract
- [ ] authenticate requests and expire short-lived slot leases
- [ ] define log streaming, cancellation, resource limits, and cleanup
- [ ] test integration against a real staging service
- [ ] never represent the provisional client as a working service

Acceptance: remote execution is demonstrably isolated, authenticated, observable, and optional.

## non-test workstream

Work that can be advanced without claiming runtime correctness:

- architecture notes and phase definitions
- CLI usage and configuration documentation
- threat model and security boundaries
- provider and sandbox API contracts
- decision records for future dependencies

These documents define intent; they do not replace implementation tests.
