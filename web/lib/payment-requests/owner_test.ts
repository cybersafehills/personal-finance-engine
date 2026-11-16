import { assertEquals } from "jsr:@std/assert@1";
import {
  buildShareMessage,
  friendlyRequestError,
  isAllowedExpiryHours,
  isPaymentRequestsEnabledForWorkspace,
  parseAmountMinor,
  statusBadge,
} from "./owner.ts";

Deno.test("enablement: opt-in flag plus optional workspace allowlist", () => {
  const on = { PAYMENT_REQUESTS_ENABLED: "true" };
  assertEquals(isPaymentRequestsEnabledForWorkspace({}, "w1"), false);
  assertEquals(
    isPaymentRequestsEnabledForWorkspace(
      { PAYMENT_REQUESTS_ENABLED: "TRUE" },
      "w1",
    ),
    false,
  );
  assertEquals(isPaymentRequestsEnabledForWorkspace(on, "w1"), true);
  assertEquals(isPaymentRequestsEnabledForWorkspace(on, null), true);
  const gated = { ...on, PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST: "w1, w2" };
  assertEquals(isPaymentRequestsEnabledForWorkspace(gated, "w2"), true);
  assertEquals(isPaymentRequestsEnabledForWorkspace(gated, "w3"), false);
  assertEquals(isPaymentRequestsEnabledForWorkspace(gated, null), false);
  assertEquals(
    isPaymentRequestsEnabledForWorkspace({
      ...on,
      PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST: "  ",
    }, "any"),
    true,
  );
  // allowlist alone never enables
  assertEquals(
    isPaymentRequestsEnabledForWorkspace({
      PAYMENT_REQUESTS_WORKSPACE_ALLOWLIST: "w1",
    }, "w1"),
    false,
  );
});

Deno.test("friendlyRequestError maps known codes and never echoes raw text", () => {
  assertEquals(friendlyRequestError("rate_limited").includes("wait"), true);
  assertEquals(
    friendlyRequestError("ERROR: transaction_does_not_match").includes(
      "exactly this amount",
    ),
    true,
  );
  assertEquals(
    friendlyRequestError(
      "duplicate key value violates unique constraint payment_requests_token_hash_unique",
    ).includes("duplicate"),
    false,
  );
  const secret = 'relation "payment_requests" column token_hash secretvalue';
  assertEquals(friendlyRequestError(secret).includes("secretvalue"), false);
  assertEquals(
    friendlyRequestError(null),
    "Something went wrong. Please try again.",
  );
});

Deno.test("parseAmountMinor is exact and strict", () => {
  assertEquals(parseAmountMinor("5,000", "RWF"), 5000n);
  assertEquals(parseAmountMinor(" 12 500 ", "RWF"), 12500n);
  assertEquals(parseAmountMinor("12.50", "USD"), 1250n);
  assertEquals(parseAmountMinor("1.005", "USD"), 101n); // exact half-up on digits, no float
  assertEquals(parseAmountMinor("0", "RWF"), null);
  assertEquals(parseAmountMinor("-5", "RWF"), null);
  assertEquals(parseAmountMinor("abc", "RWF"), null);
  assertEquals(parseAmountMinor("1e3", "RWF"), null);
  assertEquals(parseAmountMinor("", "RWF"), null);
  assertEquals(parseAmountMinor("5", "GBP"), null);
});

Deno.test("expiry choices are a closed set", () => {
  assertEquals(isAllowedExpiryHours(168), true);
  assertEquals(isAllowedExpiryHours(1), false);
  assertEquals(isAllowedExpiryHours(24 * 365), false);
});

Deno.test("share message states amount, requester and link, and claims nothing", () => {
  const m = buildShareMessage({
    amountMinor: 5000n,
    currency: "RWF",
    recipientDisplay: "Samuel N",
    url: "https://a.me/r/x",
  });
  assertEquals(
    m.includes("Samuel N") && m.includes("https://a.me/r/x") &&
      m.includes("5,000"),
    true,
  );
  assertEquals(/verified|paid/i.test(m), false);
});

Deno.test("status badges: only attested states read as paid, and 'by you' is explicit", () => {
  assertEquals(statusBadge("open").label, "Open");
  assertEquals(statusBadge("marked_paid_by_owner").label, "Marked paid by you");
  assertEquals(/paid/i.test(statusBadge("open").label), false);
  assertEquals(/paid/i.test(statusBadge("expired").label), false);
});

Deno.test("parseMobileCreateBody: strict shape, amounts as digit strings", async () => {
  const { parseMobileCreateBody } = await import("./owner.ts");
  const ok = {
    amount_minor: "5000",
    currency: "RWF",
    destination_type: "momo_phone",
    destination_value: "0793000439",
    recipient_display: "Sam",
    reference: "Rent",
    expires_in_hours: 168,
    idempotency_key: "abcdefgh-1234",
  };
  const v = parseMobileCreateBody(ok)!;
  assertEquals([v.amountMinor, v.currency, v.expiresInHours], [
    5000n,
    "RWF",
    168,
  ]);
  assertEquals(
    parseMobileCreateBody({ ...ok, reference: undefined })?.reference,
    "",
  );
  for (
    const bad of [
      null,
      [],
      "x",
      { ...ok, amount_minor: 5000 },
      { ...ok, amount_minor: "0" },
      { ...ok, amount_minor: "-5" },
      { ...ok, amount_minor: "1.5" },
      { ...ok, amount_minor: "01" },
      { ...ok, currency: undefined },
      { ...ok, expires_in_hours: "168" },
      { ...ok, expires_in_hours: 1.5 },
      { ...ok, recipient_display: "x".repeat(81) },
      { ...ok, idempotency_key: undefined },
    ]
  ) assertEquals(parseMobileCreateBody(bad), null, JSON.stringify(bad));
});
