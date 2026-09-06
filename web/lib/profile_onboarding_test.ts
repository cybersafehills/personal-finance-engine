import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  currencyForCountry,
  isOnboardingCountry,
  isOnboardingCurrency,
  isOnboardingLocale,
  momoProvidersForCountry,
  ONBOARDING_COUNTRIES,
  timezoneForCountry,
} from "./profile-onboarding.ts";

Deno.test("profile onboarding options accept supported values and reject arbitrary input", () => {
  assertEquals(isOnboardingCountry("RW"), true);
  assertEquals(isOnboardingCountry("XX"), false);
  assertEquals(isOnboardingCurrency("RWF"), true);
  assertEquals(isOnboardingCurrency("BTC"), false);
  assertEquals(isOnboardingLocale("en"), true);
  assertEquals(isOnboardingLocale("de"), false);
});

Deno.test("every country suggestion is internally complete", () => {
  for (const country of ONBOARDING_COUNTRIES) {
    assertEquals(country.value.length, 2);
    assertEquals(isOnboardingCurrency(country.currency), true);
    assertEquals(country.timezone.includes("/"), true);
    assert(Array.isArray(country.momoProviders));
  }
});

Deno.test("country -> currency / timezone map, with a safe fallback", () => {
  assertEquals(currencyForCountry("RW"), "RWF");
  assertEquals(currencyForCountry("ke"), "KES");
  assertEquals(timezoneForCountry("UG"), "Africa/Kampala");
  // Unknown code falls back to the default country, never throws.
  assertEquals(currencyForCountry("ZZ"), "RWF");
  assertEquals(timezoneForCountry(""), "Africa/Kigali");
});

Deno.test("country -> MoMo provider recommendation is advisory, never empty-by-accident where MoMo is a thing", () => {
  assertEquals([...momoProvidersForCountry("RW")], ["mtn_momo", "airtel_money"]);
  assert(momoProvidersForCountry("KE").includes("mpesa"));
  // Non-MoMo markets legitimately return an empty recommendation.
  assertEquals([...momoProvidersForCountry("US")], []);
  // Unknown code = no recommendation, not a crash.
  assertEquals([...momoProvidersForCountry("ZZ")], []);
});
