import { getActiveWorkspaceId } from "../../lib/queries";
import { isPaySplitsEnabled } from "../../lib/pay/gate";
import { loadSaveOnReport } from "../../lib/pay/splits/savings";
import type { SavingsReport } from "../../lib/pay/splits/savings-report";
import { supabaseSession } from "../../lib/supabase-session-server";
import { SaveOnSavingsPanel } from "./SaveOnSavingsPanel";

/**
 * The Save On savings section for the active Space, used on the Save On page, Insights,
 * Reports and (compact) Home. Renders nothing when Save On is off or the report can't be
 * read: a section that can't be trusted is hidden, never shown as a made-up zero.
 */
export async function SaveOnSavings({ compact = false }: { compact?: boolean }) {
  let report: SavingsReport | null = null;
  try {
    const workspaceId = await getActiveWorkspaceId();
    if (workspaceId && isPaySplitsEnabled(workspaceId)) {
      report = await loadSaveOnReport(await supabaseSession(), workspaceId);
    }
  } catch {
    report = null;
  }
  if (!report) return null;
  return <SaveOnSavingsPanel report={report} compact={compact} />;
}
