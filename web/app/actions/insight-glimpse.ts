"use server";

import { supabaseSession } from "../../lib/supabase-session-server";
import type { InsightGlimpse } from "../../lib/intelligence/summary";

/**
 * Records the current insight signature for the caller in this workspace
 * and, when it changed and the 12h window has elapsed, enqueues one
 * `insight.forecast_update` notification. Returns true when a
 * notification was just enqueued - the signal for the layout to show the
 * ephemeral banner on this render. Never throws: a failure degrades to
 * "don't show the banner".
 */
export async function noteInsightChange(
  workspaceId: string,
  glimpse: InsightGlimpse,
): Promise<boolean> {
  try {
    const supabase = await supabaseSession();
    const { data, error } = await supabase.rpc("note_insight_change", {
      p_workspace_id: workspaceId,
      p_signature: glimpse.signature,
      p_headline: glimpse.headline,
      p_body: glimpse.body,
    });
    if (error) {
      console.error("noteInsightChange failed:", error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error("noteInsightChange threw:", e);
    return false;
  }
}
