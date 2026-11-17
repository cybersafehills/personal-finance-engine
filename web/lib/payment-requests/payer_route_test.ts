import { assertEquals } from "jsr:@std/assert@1";
import { buildPayerRoute, payerRouteTarget } from "./payer-route.ts";
import type { PublicPaymentRequestView } from "./public-view.ts";

const base: Pick<
  PublicPaymentRequestView,
  "status" | "currency" | "destination" | "amountMinor"
> = {
  status: "open",
  currency: "RWF",
  amountMinor: "5000",
  destination: { type: "momo_phone", display: "+250 788 123 456", value: "250788123456" },
};

const sendMoney = {
  ussd_template: "*182*1*1*{phone}*{amount}#",
  accepts_parameters: true,
  parameters: [
    { key: "phone", kind: "phone" as const, required: true, format_regex: "^07[0-9]{8}$", min_length: null, max_length: null },
    { key: "amount", kind: "amount" as const, required: true, format_regex: null, min_length: null, max_length: null },
  ],
};

Deno.test("MTN number -> send_money on MTN; Airtel number -> Airtel", () => {
  assertEquals(payerRouteTarget(base), { network: "mtn", intent: "send_money" });
  assertEquals(
    payerRouteTarget({
      ...base,
      destination: { type: "momo_phone", display: "x", value: "250723456789" },
    }),
    { network: "airtel", intent: "send_money" },
  );
});

Deno.test("no hand-off unless open, RWF and a destination", () => {
  assertEquals(payerRouteTarget({ ...base, status: "expired" }), null);
  assertEquals(payerRouteTarget({ ...base, currency: "USD" }), null);
  assertEquals(payerRouteTarget({ ...base, destination: null }), null);
});

Deno.test("fills the published template with local number + whole RWF", () => {
  const r = buildPayerRoute(base, sendMoney)!;
  assertEquals(r.dial, "*182*1*1*0788123456*5000#");
  assertEquals(r.telHref, "tel:*182*1*1*0788123456*5000%23");
  assertEquals(r.networkLabel, "MTN Mobile Money");
});

Deno.test("merchant code uses the merchant template", () => {
  const r = buildPayerRoute(
    {
      ...base,
      destination: { type: "merchant_code", display: "093011", value: "093011" },
    },
    {
      ussd_template: "*182*8*1*{merchant}*{amount}#",
      accepts_parameters: true,
      parameters: [
        { key: "merchant", kind: "merchant_code", required: true, format_regex: null, min_length: null, max_length: null },
        { key: "amount", kind: "amount", required: true, format_regex: null, min_length: null, max_length: null },
      ],
    },
  )!;
  assertEquals(r.dial, "*182*8*1*093011*5000#");
});

Deno.test("no service code => no route", () => {
  assertEquals(buildPayerRoute(base, null), null);
});
