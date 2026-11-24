import "server-only";

import type { supabaseSession } from "../../supabase-session-server";
import { parseSavingsReport, type SavingsReport } from "./savings-report";

type Session = Awaited<ReturnType<typeof supabaseSession>>;

/**
 * The Save On savings report for one Space, computed live by public.save_on_report()
 * under the caller's own RLS (so only their own Spaces can ever be read). null when the
 * report can't be read: callers hide the section rather than show a made-up zero.
 */
export async function loadSaveOnReport(
  supabase: Session,
  workspaceId: string,
): Promise<SavingsReport | null> {
  const { data, error } = await supabase.rpc("save_on_report", { p_workspace: workspaceId });
  if (error) return null;
  return parseSavingsReport(data);
}
