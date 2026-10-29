# OmniDev

github copilot + cursor + steroids

OmniDev is an open-source, local-first autonomous developer engine. It is being built in small phases, starting with a TypeScript CLI and local Ollama inference.

## requirements

- Node.js 20+
- npm
- [Ollama](https://ollama.com/) for local model access

## quick start

Install dependencies:

```sh
npm install
```

Check the CLI and local model connection:

```sh
npm run dev -- hello
npm run dev -- model status
```

Ask a local model a question:

```sh
npm run dev -- ask "explain typescript in three sentences"
```

Choose a model explicitly:

```sh
npm run dev -- ask "write a hello world program" --model qwen2.5-coder:7b
```

Responses are streamed to the terminal as the local model generates them. The `--model` option takes precedence over `OMNIDEV_MODEL`; if neither is set, OmniDev uses the first installed model.

If no model is installed, install one through Ollama, for example:

```sh
ollama pull qwen2.5-coder:7b
```

The ask command reports offline Ollama, missing models, request timeouts, and malformed or failed API responses without printing response bodies or configured endpoint credentials. `npm test` runs the automated CLI and Ollama API tests against a local mock server; it does not require Ollama, a downloaded model, or internet access.

## build

```sh
npm run typecheck
npm run build
npm start -- hello
```

## configuration

| variable | purpose | default |
| --- | --- | --- |
| `OMNIDEV_OLLAMA_URL` | Ollama API base URL | `http://127.0.0.1:11434` |
| `OMNIDEV_MODEL` | default model name for `ask` | first model returned by Ollama |
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
