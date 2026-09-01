import { assertEquals } from "jsr:@std/assert@1";
import {
  normalizeRegistrationEmail,
  registrationErrorMessage,
  validateRegistration,
} from "./registration.ts";

Deno.test("registration normalizes email without changing the password", () => {
  assertEquals(
    normalizeRegistrationEmail("  Person@Example.COM "),
    "person@example.com",
  );
  assertEquals(validateRegistration(" Person@Example.COM ", "long enough"), {
    email: "person@example.com",
    error: null,
  });
});

Deno.test("registration rejects invalid email and password input", () => {
  assertEquals(
    validateRegistration("not-an-email", "long enough").error,
    "Enter a valid email address.",
  );
  assertEquals(
    validateRegistration("person@example.com", "short").error,
    "Use at least 8 characters for your password.",
  );
  assertEquals(
    validateRegistration("person@example.com", "x".repeat(257)).error,
    "Use no more than 256 characters for your password.",
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
