# initial threat model

**status: design guidance; read-only project discovery controls are implemented and covered by tests. Phase 3+ controls remain proposals.**

## assets to protect

- source code and private project files
- credentials, tokens, environment variables, and signing keys
- user approval and intent
- integrity of the selected workspace
- integrity of the local machine
- availability of the cli and any optional sandbox resources

## trust boundaries

### model output

model output can be incorrect, manipulative, or malformed. treat it as data, not authority. model-generated plans and commands must pass deterministic validation and must not approve themselves.

### repository content

source files, comments, readmes, dependency scripts, and test fixtures can contain prompt injection or malicious instructions. content read from a repository must never override application rules or user approval requirements.

Phase 2 sends only selected, bounded project context to loopback Ollama for a summary. The summarization prompt explicitly treats repository content as untrusted data. Discovery skips `.gitignore`-excluded files, common generated/dependency and credential directories, likely credential/key files, symlinks, binary/invalid UTF-8 files, and content beyond configured limits. It does not execute project code or write files.

### local tools

file writes and shell commands can damage the workspace or machine. start with read-only inspection. require explicit approval for generated commands and file changes. apply timeouts, scope checks, and clear output capture.

### network providers

local inference should use loopback by default. a user-configured non-loopback endpoint can receive prompts and project context, so show the destination and disclose the data boundary. do not silently route to remote providers.

### remote sandbox

the sandbox client is only a provisional handshake scaffold. a real service needs authenticated requests, short-lived leases, server-side isolation, resource quotas, cancellation, audit-friendly logs, and reliable cleanup. client-side checks are not a substitute for server enforcement.

## principal threats and mitigations

| threat | required mitigation |
| --- | --- |
| path traversal or symlink escape | phase 2 canonical root and in-root file checks, no-follow file opens where supported, and skipped symlinks; phase 3 must repeat checks at write time |
| malicious generated shell command | approval by default; scoped cwd; timeout and cancellation |
| prompt injection in repository files | treat file content as untrusted data; keep policy outside retrieved content |
| accidental secret disclosure | skip likely credential/key files and directories, redact sensitive errors, avoid prompt/log secrets, and require loopback for project summaries |
| malicious or malformed model response | schema validation; fail closed; do not execute raw model output |
| request sent to wrong endpoint | explicit provider configuration; safe local defaults; reject non-loopback endpoints for project summaries |
| sandbox verification-code guessing | short-lived lease binding, rate limiting, one-time use, server-side authorization |
| sandbox resource exhaustion | server-side cpu, memory, time, storage, and concurrency quotas |
| interrupted multi-file edit | backups or transaction journal; report partial failures; support recovery |
| dependency compromise | minimal dependencies, lockfile review, and dependency updates with checks |

## minimum safe defaults

- bounded, read-only project inspection before editing features exist
- project summaries sent to loopback Ollama only
- no generated command execution without approval
- no automatic cloud fallback
- no secret collection or transmission by default
- clear distinction between proposed, approved, applied, and verified actions
- timeouts on network and subprocess operations
- no success claims without corresponding operation results

## incident-friendly behavior

when an operation fails, report what was attempted, what completed, and what remains uncertain. avoid printing environment variables, bearer tokens, verification codes, or full secret-bearing command lines. preserve recovery information when writes may have partially completed.

this threat model should be revisited before enabling automatic edits, command execution, or remote sandbox use.
