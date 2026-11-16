// Answers from the /api/mobile/spaces/* write routes. The server sends a
// fixed, user-facing `message` for every refusal (never database text), so a
// 4xx message can be shown as is; anything else gets a generic line.

export type WriteFailure = {
  ok: false;
  reason: "unavailable" | "unauthorized" | "mfa_required" | "error";
  message: string;
};

export type WriteResult<T extends object = object> = ({ ok: true } & T) | WriteFailure;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const GENERIC = "Couldn't do that. Check your connection and try again.";

export function parseWriteFailure(status: number, body: unknown): WriteFailure {
  const b = isRecord(body) ? body : {};
  if (status === 404 && b.error === "not_found" && typeof b.message === "string") {
    return { ok: false, reason: "error", message: b.message };
  }
  if (status === 404) return { ok: false, reason: "unavailable", message: "This isn't available yet." };
  if (status === 401) return { ok: false, reason: "unauthorized", message: "Please sign in again." };
  if (status === 403 && b.error === "mfa_required") {
    return { ok: false, reason: "mfa_required", message: "Finish two-step verification to do that." };
  }
  if (status >= 400 && status < 500 && typeof b.message === "string" && b.message) {
    return { ok: false, reason: "error", message: b.message };
  }
  return { ok: false, reason: "error", message: GENERIC };
}

export function parseSimpleWrite(status: number, body: unknown): WriteResult {
  if (status === 200 && isRecord(body) && body.ok === true) return { ok: true };
  return parseWriteFailure(status, body);
}

export function parseInviteResponse(
  status: number,
  body: unknown,
): WriteResult<{ link: string | null; emailSent: boolean }> {
  if (status === 200 && isRecord(body) && body.ok === true) {
    return {
      ok: true,
      link: typeof body.link === "string" ? body.link : null,
      emailSent: body.emailSent === true,
    };
  }
  return parseWriteFailure(status, body);
}
