import { assertEquals } from "jsr:@std/assert@1";
import {
  isOnboardingCountry,
  isOnboardingCurrency,
  isOnboardingLocale,
  ONBOARDING_COUNTRIES,
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
  }
});
