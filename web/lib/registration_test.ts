import { assertEquals } from "jsr:@std/assert@1";
import {
  normalizeRegistrationEmail,
  passwordError,
  registrationErrorMessage,
  validateRegistration,
} from "./registration.ts";

Deno.test("registration normalizes email without changing the password", () => {
  assertEquals(
    normalizeRegistrationEmail("  Person@Example.COM "),
    "person@example.com",
  );
  assertEquals(validateRegistration(" Person@Example.COM ", "longenough1"), {
    email: "person@example.com",
    error: null,
  });
});

Deno.test("registration rejects invalid email and password input", () => {
  assertEquals(
    validateRegistration("not-an-email", "longenough1").error,
    "Enter a valid email address.",
  );
  assertEquals(
    validateRegistration("person@example.com", "short1").error,
    "Use at least 8 characters for your password.",
  );
  assertEquals(
    validateRegistration("person@example.com", ("x1").repeat(200)).error,
    "Use no more than 256 characters for your password.",
  );
});

Deno.test("passwordError enforces the letters-and-digits floor (audit F3, parity with config.toml)", () => {
  assertEquals(passwordError("plenty long enough"), // no digit
    "Include at least one letter and one number in your password.");
  assertEquals(passwordError("1234567890"), // no letter
    "Include at least one letter and one number in your password.");
  assertEquals(passwordError("correcthorse9"), null);
  // Length is checked before complexity so the more actionable message wins.
  assertEquals(
    passwordError("ab1"),
    "Use at least 8 characters for your password.",
  );
});

Deno.test("registration maps provider errors to safe user-facing messages", () => {
  assertEquals(
    registrationErrorMessage("email rate limit exceeded"),
    "Too many attempts. Wait a minute, then try again.",
  );
  assertEquals(
    registrationErrorMessage("database unavailable"),
    "We couldn't create your account right now. Please try again.",
  );
});
