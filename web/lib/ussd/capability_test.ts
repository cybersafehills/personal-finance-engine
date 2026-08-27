import { assertEquals } from "jsr:@std/assert@1";
import {
  buildTelHref,
  detectDialerCapability,
  detectPlatform,
  fillUssdTemplate,
  type ParamSpec,
  redactUssdForAnalytics,
} from "./capability.ts";

const UA = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

Deno.test("detectPlatform: the four browsers the master prompt requires", () => {
  assertEquals(detectPlatform(UA.iosSafari), "ios");
  assertEquals(detectPlatform(UA.androidChrome), "android");
  assertEquals(detectPlatform(UA.macSafari), "desktop");
  assertEquals(detectPlatform(UA.desktopChrome), "desktop");
  assertEquals(detectPlatform(""), "unknown");
  assertEquals(detectPlatform(null), "unknown");
});

Deno.test("detectDialerCapability: only mobile platforms lead with the dialer", () => {
  assertEquals(detectDialerCapability(UA.iosSafari).canAttemptDialer, true);
  assertEquals(detectDialerCapability(UA.androidChrome).canAttemptDialer, true);
  assertEquals(detectDialerCapability(UA.macSafari).canAttemptDialer, false);
  assertEquals(detectDialerCapability(UA.desktopChrome).canAttemptDialer, false);
  assertEquals(detectDialerCapability(undefined).canAttemptDialer, false);
});

Deno.test("buildTelHref: encodes # as %23, leaves * and digits literal", () => {
  assertEquals(buildTelHref("*182#"), "tel:*182%23");
  assertEquals(buildTelHref("*182*1*1*0781234567*5000#"), "tel:*182*1*1*0781234567*5000%23");
});

const sendSchema: ParamSpec[] = [
  { key: "phone", kind: "phone", required: true, formatRegex: "^07[2389]\\d{7}$" },
  { key: "amount", kind: "amount", required: true, formatRegex: "^[1-9][0-9]{1,6}$" },
];

Deno.test("fillUssdTemplate: substitutes validated values", () => {
  const r = fillUssdTemplate("*182*1*1*{phone}*{amount}#", { phone: "0781234567", amount: "5000" }, sendSchema);
  assertEquals(r, { ok: true, display: "*182*1*1*0781234567*5000#", dial: "*182*1*1*0781234567*5000#" });
});

Deno.test("fillUssdTemplate: a literal code with no params is returned as-is", () => {
  const r = fillUssdTemplate("*182#", {}, []);
  assertEquals(r.ok && r.dial, "*182#");
});

Deno.test("fillUssdTemplate: missing required value is a friendly error", () => {
  const r = fillUssdTemplate("*182*1*1*{phone}*{amount}#", { phone: "0781234567" }, sendSchema);
  assertEquals(r.ok, false);
});

Deno.test("fillUssdTemplate: rejects a value that would rewrite the USSD path", () => {
  for (const bad of ["078#123", "078*123", "07 8123", "07{8}12"]) {
    const r = fillUssdTemplate("*182*1*1*{phone}*{amount}#", { phone: bad, amount: "5000" }, sendSchema);
    assertEquals(r.ok, false, `expected rejection for ${bad}`);
  }
});

Deno.test("fillUssdTemplate: rejects a value failing the per-code regex", () => {
  const r = fillUssdTemplate("*182*1*1*{phone}*{amount}#", { phone: "0601234567", amount: "5000" }, sendSchema);
  assertEquals(r.ok, false);
});

Deno.test("fillUssdTemplate: unknown placeholder is reported, not silently dropped", () => {
  const r = fillUssdTemplate("*182*{mystery}#", {}, []);
  assertEquals(r.ok, false);
});

Deno.test("fillUssdTemplate: falls back to kind rule when a stored regex is invalid", () => {
  const brokenSchema: ParamSpec[] = [{ key: "amount", kind: "amount", required: true, formatRegex: "([" }];
  const r = fillUssdTemplate("*1*{amount}#", { amount: "500" }, brokenSchema);
  assertEquals(r.ok && r.dial, "*1*500#");
});

Deno.test("redactUssdForAnalytics: never emits a real value", () => {
  assertEquals(
    redactUssdForAnalytics("*182*1*1*{phone}*{amount}#", sendSchema),
    "*182*1*1*<phone>*<amount>#",
  );
  assertEquals(redactUssdForAnalytics("*182#", []), "*182#");
});
