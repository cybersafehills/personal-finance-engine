import "server-only";

import { MobileApiError, mobileSessionFresh } from "../../mobile-request";
import { splitErrorStatus } from "../../mobile-splits";
import { getActiveWorkspaceId } from "../../queries";
import { supabaseSession } from "../../supabase-session-server";
import { isAssistedPayEnabled, isPaySplitsEnabled, paymentSessionFreshnessMinutes } from "../gate";
import type { SplitCtx, SplitResult } from "./service";

// Glue for app/api/mobile/pay/splits/*: builds the service context from the
// bearer-authenticated request and turns a service failure into the response
// the app sees. The logic itself is lib/pay/splits/service.ts, the same code the
// web server actions call.

/**
 * @param opts.offerOnly an offer is read-only: when splits are off it answers
 *   "no split" instead of refusing, exactly like the web form.
 */
export async function mobileSplitCtx(
  userId: string,
  token: string,
  opts: { offerOnly?: boolean } = {},
): Promise<{ ctx: SplitCtx; splitsOn: boolean }> {
  const workspaceId = await getActiveWorkspaceId();
  if (!isAssistedPayEnabled(workspaceId)) {
    throw new MobileApiError(403, "feature_disabled", "Assisted Quick Pay is turned off for your account.");
  }
  const splitsOn = isPaySplitsEnabled(workspaceId);
  if (!splitsOn && !opts.offerOnly) {
    throw new MobileApiError(403, "feature_disabled", "Splits are not turned on for your account.");
  }
  const supabase = await supabaseSession();
  return {
    splitsOn,
    ctx: {
      supabase,
      userId,
      workspaceId,
      sessionFresh: mobileSessionFresh(token, paymentSessionFreshnessMinutes()),
      // The mobile API has no session cookie to scope the Space, and the RPC only
      // checks membership, so a source account must be one of this Space's own.
      requireAccountInWorkspace: workspaceId,
    },
  };
}

/** The success value, or a MobileApiError carrying a safe, user-facing sentence. */
export function unwrapSplit<T extends Record<string, unknown>>(
  res: SplitResult<T>,
): Omit<Extract<SplitResult<T>, { ok: true }>, "ok"> {
  if (res.ok) {
    const rest: Record<string, unknown> = { ...res };
    delete rest.ok;
    return rest as Omit<Extract<SplitResult<T>, { ok: true }>, "ok">;
  }
  const status = splitErrorStatus(res.code);
  if (status === null) throw new Error("split failed");
  throw new MobileApiError(status, res.code, res.error);
}
