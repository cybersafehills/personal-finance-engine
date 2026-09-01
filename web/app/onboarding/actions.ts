"use server";

import { revalidatePath } from "next/cache";
import { supabaseSession } from "../../lib/supabase-session-server";
import { isValidReportTimezone } from "../../lib/timezones";
import {
  isOnboardingCountry,
  isOnboardingCurrency,
  isOnboardingLocale,
} from "../../lib/profile-onboarding";

export type ProfileOnboardingActionResult =
  | { ok: true }
  | { ok: false; error: string };

async function authenticatedClient() {
  const supabase = await supabaseSession();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? supabase : null;
}

export async function saveProfileOnboarding(input: {
  firstName: string;
  lastName: string;
  countryCode: string;
  locale: string;
}): Promise<ProfileOnboardingActionResult> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const countryCode = input.countryCode.toUpperCase();
  const locale = input.locale.toLowerCase();

  if (!firstName || firstName.length > 80) {
    return { ok: false, error: "Enter a first name of 80 characters or fewer." };
  }
  if (lastName.length > 80) {
    return { ok: false, error: "Last name must be 80 characters or fewer." };
  }
  if (!isOnboardingCountry(countryCode)) {
    return { ok: false, error: "Choose a supported country." };
  }
  if (!isOnboardingLocale(locale)) {
    return { ok: false, error: "Choose a supported language." };
  }

  const supabase = await authenticatedClient();
  if (!supabase) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("save_onboarding_profile", {
    p_first_name: firstName,
    p_last_name: lastName || null,
    p_country_code: countryCode,
    p_locale: locale,
  });
  if (error) {
    console.error("saveProfileOnboarding failed:", error.message);
    return { ok: false, error: "Could not save your profile. Try again." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveFinancialPreferences(input: {
  preferredCurrency: string;
  timezone: string;
  locale: string;
}): Promise<ProfileOnboardingActionResult> {
  const preferredCurrency = input.preferredCurrency.toUpperCase();
  const locale = input.locale.toLowerCase();
  if (!isOnboardingCurrency(preferredCurrency)) {
    return { ok: false, error: "Choose a supported currency." };
  }
  if (!isValidReportTimezone(input.timezone)) {
    return { ok: false, error: "Choose a supported timezone." };
  }
  if (!isOnboardingLocale(locale)) {
    return { ok: false, error: "Choose a supported language." };
  }

  const supabase = await authenticatedClient();
  if (!supabase) return { ok: false, error: "Not signed in." };

  const { error } = await supabase.rpc("save_onboarding_preferences", {
    p_preferred_currency: preferredCurrency,
    p_timezone: input.timezone,
    p_locale: locale,
  });
  if (error) {
    console.error("saveFinancialPreferences failed:", error.message);
    return { ok: false, error: "Could not save your preferences. Try again." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function completeProfileOnboarding(): Promise<ProfileOnboardingActionResult> {
  const supabase = await authenticatedClient();
  if (!supabase) return { ok: false, error: "Not signed in." };
  const { error } = await supabase.rpc("complete_profile_onboarding");
  if (error) {
    console.error("completeProfileOnboarding failed:", error.message);
    return { ok: false, error: "Could not finish setup. Try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

