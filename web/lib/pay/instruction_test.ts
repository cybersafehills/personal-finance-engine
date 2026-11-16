import { assertEquals } from "jsr:@std/assert@1";
import {
  buildUssdInstruction,
  telHrefFor,
  ussdAmountMajor,
} from "./instruction.ts";

const intent = {
  currency: "RWF",
  amount_minor: 5000,
  recipient_msisdn_normalized: "250788123456",
  merchant_code: "123456",
  meter_number: null,
  billing_reference: null,
  government_reference: null,
};
const param = (
  key: string,
  kind: string,
  over: Record<string, unknown> = {},
) => ({
  key,
  kind: kind as never,
  required: true,
  format_regex: null,
  min_length: null,
  max_length: null,
  ...over,
});

Deno.test("no service code means no instruction", () => {
  assertEquals(buildUssdInstruction(intent, null), null);
  assertEquals(telHrefFor(null), null);
});

Deno.test("a send-money code fills phone in local form and the whole-RWF amount", () => {
  const r = buildUssdInstruction(intent, {
    ussd_template: "*182*1*1*{phone}*{amount}#",
    accepts_parameters: true,
    parameters: [param("phone", "phone"), param("amount", "amount")],
  });
  assertEquals(r, {
    ok: true,
    display: "*182*1*1*0788123456*5000#",
    dial: "*182*1*1*0788123456*5000#",
  });
  assertEquals(telHrefFor(r), "tel:*182*1*1*0788123456*5000%23");
});

Deno.test("a merchant code fills from the merchant code", () => {
  const r = buildUssdInstruction(intent, {
    ussd_template: "*182*8*1*{merchant}*{amount}#",
    accepts_parameters: true,
    parameters: [param("merchant", "merchant_code"), param("amount", "amount")],
  });
  assertEquals(r?.ok && r.dial, "*182*8*1*123456*5000#");
});

Deno.test("a missing required value is reported, not dialled", () => {
  const r = buildUssdInstruction({ ...intent, merchant_code: null }, {
    ussd_template: "*182*8*1*{merchant}*{amount}#",
    accepts_parameters: true,
    parameters: [param("merchant", "merchant_code"), param("amount", "amount")],
  });
  assertEquals(r?.ok, false);
  assertEquals(telHrefFor(r), null);
});

Deno.test("a template that takes no parameters is shown as is", () => {
  const r = buildUssdInstruction(intent, {
    ussd_template: "*182#",
    accepts_parameters: false,
    parameters: [],
  });
  assertEquals(r, { ok: true, display: "*182#", dial: "*182#" });
});

Deno.test("amount units: RWF is whole, other currencies are cents", () => {
  assertEquals(ussdAmountMajor({ currency: "RWF", amount_minor: 5000 }), 5000);
  assertEquals(ussdAmountMajor({ currency: "USD", amount_minor: 5000 }), 50);
});
