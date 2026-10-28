# OmniDev

github copilot + cursor + steroids

OmniDev is an open-source, local-first autonomous developer engine. The first milestone is a small TypeScript CLI with a local Ollama connector and a pluggable client for the future remote sandbox pool.

## requirements

- Node.js 20+
- npm
- [Ollama](https://ollama.com/) for local model access (optional for the CLI itself)

## quick start

```sh
npm install
npm run dev -- hello
npm run dev -- model status
```

Build the CLI:

```sh
npm run build
npm start -- hello
```

## local model

OmniDev connects to Ollama at `http://127.0.0.1:11434` by default. Override it with `OMNIDEV_OLLAMA_URL`.

The local generation helper is available from `src/model/ollama.ts`. It does not require a cloud API key.

## sandbox handshake client

The client functions `virtual_run(task)` and `virtual_connect(slotId, code)` are in `src/sandbox/client.ts`.

Configure:

- `OMNIDEV_SERVER_URL`: HTTPS base URL of the sandbox service (localhost HTTP is allowed for development).
- `OMNIDEV_SERVER_TOKEN`: optional bearer token if the server requires authentication.

The initial client expects these endpoints:

- `POST /v1/virtual/run` with `{ "task": "..." }`, returning `{ "slot_id": 4, "verification_code": "7749" }`.
- `POST /v1/virtual/connect` with `{ "slot_id": "4", "verification_code": "7749" }`, returning `{ "connected": true, "stream_url": "..." }`.

These are provisional client contracts, not a deployed server. We still need to align them with the actual server API before real sandbox use. Streaming container logs will be implemented after the server's streaming protocol is defined.

## safety notes

- Local model inference stays local by default.
- Sandbox tasks are sent to the configured remote server. Never send secrets or private project files unless you explicitly intend to upload them.
- Do not treat a verification code as authentication by itself; the server should bind it to a short-lived slot lease, rate-limit attempts, and expire it after use.
