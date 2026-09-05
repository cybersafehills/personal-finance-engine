import { assertEquals } from "jsr:@std/assert@1";
import {
  formatLocalMsisdn,
  guessProvider,
  maskMsisdn,
  normalizeRwandaMsisdn,
  providerNetworkForAccount,
} from "./phone.ts";

Deno.test("normalizeRwandaMsisdn: accepts the common input shapes", () => {
  for (const input of [
    "0781234567",
    "250781234567",
    "+250781234567",
    "250 78 123 4567",
    "078-123-4567",
    "781234567",
  ]) {
    assertEquals(normalizeRwandaMsisdn(input).normalized, "250781234567", input);
  }
});

Deno.test("normalizeRwandaMsisdn: preserves the user's input as display", () => {
  assertEquals(normalizeRwandaMsisdn("  078 123 4567 ").display, "078 123 4567");
});

Deno.test("normalizeRwandaMsisdn: rejects non-RW-mobile input", () => {
  for (const bad of ["", "12345", "0721234", "250601234567", "07812345678", "abc"]) {
    assertEquals(normalizeRwandaMsisdn(bad).normalized, null, bad);
  }
});

Deno.test("maskMsisdn: shows only the last 4 digits", () => {
  assertEquals(maskMsisdn("250781234567"), "•••• ••• 4567");
  assertEquals(maskMsisdn(null), "");
  assertEquals(maskMsisdn(""), "");
});

Deno.test("guessProvider: MTN vs Airtel by prefix", () => {
  assertEquals(guessProvider("250781234567"), "mtn");
  assertEquals(guessProvider("250791234567"), "mtn");
  assertEquals(guessProvider("250731234567"), "airtel");
  assertEquals(guessProvider("250721234567"), "airtel");
  assertEquals(guessProvider(null), null);
});

Deno.test("formatLocalMsisdn: groups a normalized number for display", () => {
  assertEquals(formatLocalMsisdn("250781234567"), "078 123 4567");
});

Deno.test("providerNetworkForAccount: maps a source account's provider to a network", () => {
  for (const p of ["mtn_momo", "mtn", "MTN MoMo", "momo"]) {
    assertEquals(providerNetworkForAccount(p), "mtn", p);
  }
  for (const p of ["airtel_money", "airtel", "Airtel Money"]) {
    assertEquals(providerNetworkForAccount(p), "airtel", p);
  }
  for (const p of ["bank", "bk", "equity", "", null, undefined]) {
    assertEquals(providerNetworkForAccount(p), null, String(p));
  }
});
