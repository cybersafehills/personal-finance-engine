import { assertEquals } from "jsr:@std/assert@1";
import {
  formatMsisdn,
  isPaymentRequestsEnabled,
  type ResolveRow,
  toPublicView,
} from "./public-view.ts";

const open: ResolveRow = {
  status: "open",
  amount_minor: "5000",
  currency: "RWF",
  recipient_display: "Samuel N",
  reference: "Rent Nov",
  expires_at: "2026-11-22T12:00:00Z",
  destination_type: "momo_phone",
  destination_value: "250793000439",
};

Deno.test("open request shows amount, name, reference and a formatted number", () => {
  const v = toPublicView(open)!;
  assertEquals(v.status, "open");
  assertEquals(v.amountText.replace(/\s/g, " ").includes("5,000"), true);
  assertEquals(v.destination, {
    type: "momo_phone",
    display: "+250 793 000 439",
  });
  assertEquals(v.statusLabel.includes("not verified"), true);
});

Deno.test("non-open statuses never show a destination, even if the row carries one", () => {
  for (
    const status of ["expired", "cancelled", "marked_paid_by_owner", "matched"]
  ) {
    const v = toPublicView({ ...open, status })!;
    assertEquals(v.destination, null, status);
  }
});

Deno.test("merchant code destination", () => {
  const v = toPublicView({
    ...open,
    destination_type: "merchant_code",
    destination_value: "093011",
  })!;
  assertEquals(v.destination, { type: "merchant_code", display: "093011" });
});

Deno.test("anything malformed is refused rather than rendered", () => {
  assertEquals(toPublicView({ ...open, status: "paid" }), null);
  assertEquals(toPublicView({ ...open, currency: "GBP" }), null);
  assertEquals(toPublicView({ ...open, amount_minor: "abc" }), null);
  assertEquals(toPublicView({ ...open, amount_minor: "0" }), null);
  assertEquals(
    toPublicView({
      ...open,
      destination_value: "12",
      destination_type: "merchant_code",
    }),
    null,
  );
  assertEquals(
    toPublicView({ ...open, destination_value: "0693000439" }),
    null,
  );
  assertEquals(
    toPublicView({ ...open, destination_value: null }),
    toPublicView({ ...open, destination_value: null }),
  );
});

Deno.test("an open request with no destination is refused", () => {
  assertEquals(
    toPublicView({ ...open, destination_type: null, destination_value: null }),
    null,
  );
});

Deno.test("formatMsisdn + flag", () => {
  assertEquals(formatMsisdn("0793000439"), "+250 793 000 439");
  assertEquals(
    isPaymentRequestsEnabled({ PAYMENT_REQUESTS_ENABLED: "true" }),
    true,
  );
  assertEquals(
    isPaymentRequestsEnabled({ PAYMENT_REQUESTS_ENABLED: "TRUE" }),
    false,
  );
  assertEquals(isPaymentRequestsEnabled({}), false);
});
