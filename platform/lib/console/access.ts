import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseSession } from "../supabase/server";
import { interpretMyAccess, type Access, type AccessState } from "./permissions.ts";

type Client = Awaited<ReturnType<typeof supabaseSession>>;

export type Session = {
  supabase: Client;
  email: string | null;
  access: Access;
};

export async function getAccessState(): Promise<{
  supabase: Client;
  email: string | null;
  state: AccessState;
}> {
  const supabase = await supabaseSession();
  // getUser() validates the token with Supabase Auth (not just the cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, email: null, state: { kind: "signed_out" } };

  const { data, error } = await supabase.rpc("console_my_access");
  // Fail closed: an RPC error is never treated as access.
  const state: AccessState = error
    ? { kind: "not_staff" }
    : interpretMyAccess(data);
  return { supabase, email: user.email ?? null, state };
}

/** Gate for every console page: signed in + staff + MFA, else redirect. */
export const requireSession = cache(async (): Promise<Session> => {
  const { supabase, email, state } = await getAccessState();
  if (state.kind === "signed_out") redirect("/login");
  if (state.kind === "not_staff") redirect("/no-access");
  if (state.kind === "mfa_required") redirect("/mfa");
  return { supabase, email, access: state.access };
});

export type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "denied" | "mfa" | "error" };

/**
 * Call a console RPC. A 42501 from the database is a genuine authorization
 * denial (permission, suspension or MFA lapse); it is audited best-effort.
 */
export async function consoleRpc<T>(
  session: Session,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const { data, error } = await session.supabase.rpc(fn, args);
  if (!error) return { ok: true, data: data as T };

  if (error.code === "42501") {
    if (error.message.includes("mfa_required")) return { ok: false, reason: "mfa" };
    await session.supabase
      .rpc("console_record_audit", {
        p_action: "permission.denied",
        p_target_type: "rpc",
        p_target_id: fn,
        p_outcome: "denied",
      })
      .then(
        () => undefined,
        () => undefined,
      );
    return { ok: false, reason: "denied" };
  }
  console.error(`console rpc ${fn} failed:`, error.code, error.message);
  return { ok: false, reason: "error" };
}

/** Best-effort audit of a sensitive read (e.g. opening the audit log). */
export async function auditView(session: Session, action: string, target?: string) {
  await session.supabase
    .rpc("console_record_audit", {
      p_action: action,
      p_target_type: "page",
      p_target_id: target ?? null,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
