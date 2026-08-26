"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { isValidReportTimezone } from "../../../lib/timezones";

export type ReportPreferencesActionResult = { ok: true } | { ok: false; error: string };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
// Deliberately permissive (accepts any syntactically plausible address) -
// this only gates the settings form itself; the account's own sign-in
// email is never involved, and there is no email-verification
// infrastructure in this project yet to check deliverability against
// (see master prompt §59's note that this is a scope cut, not an
// oversight - a stored preference is not itself a delivery guarantee).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeTimeInput(value: string): string | null {
  if (!TIME_PATTERN.test(value)) return null;
  return `${value}:00`;
}

export async function saveReportPreferences(input: {
  dailyReportEnabled: boolean;
  timezone: string;
  generationTime: string;
  deliveryTime: string;
  emailEnabled: boolean;
  deliveryEmail: string;
  includeAiAnalysis: boolean;
}): Promise<ReportPreferencesActionResult> {
  if (!isValidReportTimezone(input.timezone)) {
    return { ok: false, error: "Unrecognized timezone." };
  }

  const generationTime = normalizeTimeInput(input.generationTime);
  if (!generationTime) {
    return { ok: false, error: "Report generation time must be a valid time (HH:MM)." };
  }

  const deliveryTime = normalizeTimeInput(input.deliveryTime);
  if (!deliveryTime) {
    return { ok: false, error: "Email delivery time must be a valid time (HH:MM)." };
  }

  const trimmedEmail = input.deliveryEmail.trim();

  if (input.emailEnabled) {
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      return { ok: false, error: "Enter a valid email address to receive reports." };
    }
  }

  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return { ok: false, error: "Could not resolve your workspace." };
  }

  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  const { error } = await supabase
    .from("report_preferences")
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: user.id,
        timezone: input.timezone,
        daily_report_enabled: input.dailyReportEnabled,
        generation_time: generationTime,
        delivery_time: deliveryTime,
        email_enabled: input.emailEnabled,
        delivery_email: input.emailEnabled ? trimmedEmail : null,
        include_ai_analysis: input.includeAiAnalysis,
      },
      { onConflict: "workspace_id,user_id" },
    );

  if (error) {
    return { ok: false, error: "Could not save your reporting preferences." };
  }

  revalidatePath("/settings/reports");

  return { ok: true };
}
