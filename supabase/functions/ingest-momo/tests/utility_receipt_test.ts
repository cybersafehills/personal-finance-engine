import { assertEquals, assertNotMatch } from "jsr:@std/assert@1";
import { parseMomoMessage } from "../parser.ts";
import { parseUtilityReceipt } from "../utility-receipt.ts";

// SYNTHETIC messages: the layout and wording mirror the two real vendor formats
// the owner supplied, but every value (token, meter, name, transaction ids) is
// invented. Do NOT paste real receipts here - a token is a bearer value.

const EN = `Cashpower Token:
0000-1111-2222-3333-4444
Purchased 11.90 KWh for 5,000 RWF,
Meter# 10000000001
TxID: 20000000000001`;

const RW = `18/07/2026:
Tokeni:
5555-6666-7777-8888-9999
Konteri: 10000000001
(TEST CUSTOMER NAME)
1,000 RWF = 2.4 kWh
TXNID: K1700000000000001`;

Deno.test("English Cashpower receipt", () => {
  assertEquals(parseUtilityReceipt(EN), {
    format: "cashpower_en",
    token: "00001111222233334444",
    kwh: "11.9",
    amountRwf: 5000,
    meter: "10000000001",
    vendorTxId: "20000000000001",
    receiptDate: null,
  });
});

Deno.test("Kinyarwanda Tokeni receipt (date, token, kWh, amount; owner name never extracted)", () => {
  const r = parseUtilityReceipt(RW)!;
  assertEquals(r, {
    format: "tokeni_rw",
    token: "55556666777788889999",
    kwh: "2.4",
    amountRwf: 1000,
    meter: "10000000001",
    vendorTxId: "K1700000000000001",
    receiptDate: "2026-07-18",
  });
  assertNotMatch(JSON.stringify(r), /TEST CUSTOMER/i);
});

Deno.test("variants seen in the wild: CRLF, extra spaces, 13-digit meter, comma kWh, big amounts", () => {
  const v = RW.replace(/\n/g, "\r\n").replace("10000000001", "0215000718977")
    .replace("2.4 kWh", "6,9 kWh").replace("1,000 RWF", "10,000 RWF");
  const r = parseUtilityReceipt(v)!;
  assertEquals([r.meter, r.kwh, r.amountRwf], ["0215000718977", "6.9", 10000]);
  assertEquals(
    parseUtilityReceipt(EN.replace("11.90", "23.80").replace("KWh", "kWh"))!
      .kwh,
    "23.8",
  );
  assertEquals(
    parseUtilityReceipt(
      EN.replace("0000-1111-2222-3333-4444", "0000 1111 2222 3333 4444"),
    )!.token,
    "00001111222233334444",
  );
});

Deno.test("never guesses: any missing or malformed required field -> null", () => {
  const bad = [
    EN.replace("0000-1111-2222-3333-4444", "0000-1111-2222-3333"), // short token
    EN.replace("0000-1111-2222-3333-4444", "0000-1111-2222-3333-4444-5555"), // long token
    EN.replace("0000-1111-2222-3333-4444", "00001111222233334444"), // ungrouped
    EN.replace(
      "Purchased 11.90 KWh for 5,000 RWF,",
      "Purchased for 5,000 RWF,",
    ), // no kWh
    EN.replace("5,000 RWF", "0 RWF"),
    RW.replace("1,000 RWF = 2.4 kWh", "1,000 RWF"),
    RW.replace("Tokeni:", "Code:"),
    "Your payment of 5,000 RWF to EUCL was completed at 2026-08-10 14:05:33.",
    "",
  ];
  for (const m of bad) assertEquals(parseUtilityReceipt(m), null, m);
  // ambiguous: both wordings in one text
  assertEquals(parseUtilityReceipt(EN + "\n" + RW), null);
});

Deno.test("optional fields are null when absent; an impossible date is dropped, not guessed", () => {
  const r = parseUtilityReceipt(
    EN.replace("Meter# 10000000001\n", "").replace(
      "\nTxID: 20000000000001",
      "",
    ),
  )!;
  assertEquals([r.meter, r.vendorTxId], [null, null]);
  assertEquals(
    parseUtilityReceipt(RW.replace("18/07/2026", "31/02/2026"))!.receiptDate,
    null,
  );
});

Deno.test("status quo: the MoMo parser does not claim these vendor messages", () => {
  assertEquals(parseMomoMessage(EN), null);
  assertEquals(parseMomoMessage(RW), null);
});
