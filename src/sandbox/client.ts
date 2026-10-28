export interface VirtualRunResult {
  slotId: string;
  verificationCode: string;
  expiresAt?: string;
  message?: string;
}

export interface VirtualConnectResult {
  connected: boolean;
  slotId: string;
  streamUrl?: string;
  message?: string;
}

function serverUrl(): string {
  const value = process.env.OMNIDEV_SERVER_URL;
  if (!value) {
    throw new Error("OMNIDEV_SERVER_URL is not set; sandbox networking is not configured yet.");
  }

  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("the sandbox server must use HTTPS outside localhost.");
  }
  return url.toString().replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const token = process.env.OMNIDEV_SERVER_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${serverUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...authHeaders()
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`sandbox server returned HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Requests an available remote test slot. The task is sent to the configured
 * server, so callers should only include files or data they intend to upload.
 */
export async function virtual_run(task: string): Promise<VirtualRunResult> {
  if (!task.trim()) throw new Error("task must not be empty");

  const result = await postJson<{
    slot_id?: string | number;
    verification_code?: string;
    expires_at?: string;
    message?: string;
  }>("/v1/virtual/run", { task });

  if (result.slot_id === undefined || !result.verification_code) {
    throw new Error("sandbox server response is missing slot_id or verification_code");
  }

  return {
    slotId: String(result.slot_id),
    verificationCode: result.verification_code,
    ...(result.expires_at ? { expiresAt: result.expires_at } : {}),
    ...(result.message ? { message: result.message } : {})
  };
}

/**
 * Completes the device-code handshake for a slot. A successful handshake
 * returns connection metadata; log streaming will be added when the server
 * publishes its streaming transport contract.
 */
export async function virtual_connect(
  slotId: string,
  code: string
): Promise<VirtualConnectResult> {
  if (!slotId.trim() || !code.trim()) {
    throw new Error("slot ID and verification code are required");
  }

  const result = await postJson<{
    connected?: boolean;
    slot_id?: string | number;
    stream_url?: string;
    message?: string;
  }>("/v1/virtual/connect", {
    slot_id: slotId,
    verification_code: code
  });

  if (result.connected !== true) {
    throw new Error(result.message ?? "sandbox handshake was not accepted");
  }

  return {
    connected: true,
    slotId: String(result.slot_id ?? slotId),
    ...(result.stream_url ? { streamUrl: result.stream_url } : {}),
    ...(result.message ? { message: result.message } : {})
  };
}
