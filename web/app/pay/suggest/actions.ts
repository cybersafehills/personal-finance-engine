"use server";

import { supabaseSession } from "../../../lib/supabase-session-server";
import { getActiveWorkspaceId } from "../../../lib/queries";
import {
  assertDirectorySuggestionsEnabled,
  FeatureDisabledError,
} from "../../../lib/pay/gate";
import { trackDirectoryEvent } from "../../../lib/directory/analytics";

export type SuggestResult = { ok: true } | { ok: false; error: string };

const SUGGESTION_TYPES = [
  "new_service",
  "new_route",
  "menu_update",
  "fee_limit_diff",
  "other",
] as const;

const CHANNELS = [
  "ussd",
  "mobile_app",
  "internet_banking",
  "provider_website",
  "qr",
  "other",
] as const;

export type SuggestionInput = {
  suggestion_type: string;
  payment_network_slug?: string;
  institution_name?: string;
  channel?: string;
  device?: string;
  last_tested_date?: string;
  body: string;
};

export async function submitDirectorySuggestion(
  input: SuggestionInput,
): Promise<SuggestResult> {
  try {
    const workspaceId = await getActiveWorkspaceId();
    assertDirectorySuggestionsEnabled(workspaceId);

    if (!(SUGGESTION_TYPES as readonly string[]).includes(input.suggestion_type)) {
      return { ok: false, error: "Choose what you're suggesting." };
    }
    if (input.channel && !(CHANNELS as readonly string[]).includes(input.channel)) {
      return { ok: false, error: "That channel isn't valid." };
    }
    const body = input.body.trim();
    if (body.length < 10) {
      return { ok: false, error: "Add a bit more detail (at least 10 characters)." };
    }
    // Cheap sensitive-data guard: reject anything that looks like a PIN /
    // full number the user shouldn't be sending us (master prompt section 10).
    if (/\bpin\b|\botp\b|password/i.test(body) && /\d{3,}/.test(body)) {
      return {
        ok: false,
        error:
          "Please don't include a PIN, OTP, or full account number — describe the problem instead.",
      };
    }

    const supabase = await supabaseSession();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to send a suggestion." };

    const { error } = await supabase.from("directory_suggestions").insert({
      suggester_user_id: user.id,
      workspace_id: workspaceId,
      suggestion_type: input.suggestion_type,
      payment_network_slug: input.payment_network_slug?.trim() || null,
      institution_name: input.institution_name?.trim().slice(0, 200) || null,
      channel: input.channel || null,
      device: input.device?.trim().slice(0, 120) || null,
      last_tested_date: input.last_tested_date || null,
      body: body.slice(0, 2000),
    });

    if (error) {
      if (/rate_limited/i.test(error.message)) {
        return {
          ok: false,
          error: "You've sent several suggestions recently. Try again in a little while.",
        };
      }
      return { ok: false, error: "Could not send your suggestion." };
    }

    trackDirectoryEvent("suggestion_submitted", {
      suggestion_type: input.suggestion_type,
      network: input.payment_network_slug,
      channel: input.channel,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof FeatureDisabledError) {
      return { ok: false, error: "Suggestions aren't open yet." };
    }
    return { ok: false, error: "Something went wrong." };
  }
}
