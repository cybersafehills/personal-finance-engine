// Phase 4.2 integration-boundary tests.
//
// Not a re-test of computeAccountingEffect() itself (see
// supabase/functions/_shared/tests/accounting_test.ts for that - already
// exhaustive) and not a re-test of parseMomoMessage() (see
// parser_test.ts). This file proves the one thing that is actually new in
// index.ts: parsed MTN message fields feed correctly into
// computeAccountingEffect() the same way index.ts wires them, for the
// message shapes that actually reach that call.

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { parseMomoMessage } from "../parser.ts";
import {
  failedTransactionMessage,
  merchantPaymentMessage,
  moneyReceivedMessage,
  sendMoneyMessage,
} from "./fixtures.ts";
import { computeAccountingEffect } from "../../_shared/accounting.ts";

function accountingInputFromRaw(raw: string) {
  const parsed = parseMomoMessage(raw);
  if (!parsed) throw new Error("expected message to parse");
  return {
    direction: parsed.direction,
    status: parsed.status,
    amount_rwf: parsed.amount_rwf,
    fee_rwf: parsed.fee_rwf,
  };
}

Deno.test("integration: valid incoming transaction (money received) receives correct accounting fields", () => {
  const effect = computeAccountingEffect(
    accountingInputFromRaw(moneyReceivedMessage.raw),
  );

  assertEquals(effect.principal_effect_rwf, 7500);
  assertEquals(effect.fee_effect_rwf, 0);
  assertEquals(effect.net_effect_rwf, 7500);
  assertEquals(effect.settlement_state, "settled");
  assertEquals(effect.affects_balance, true);
  assertEquals(effect.effect_reason, "settled_incoming_no_fee");
});

Deno.test("integration: valid outgoing transaction (merchant payment, no fee) receives correct accounting fields", () => {
  const effect = computeAccountingEffect(
    accountingInputFromRaw(merchantPaymentMessage.raw),
  );

  assertEquals(effect.principal_effect_rwf, -4000);
  assertEquals(effect.fee_effect_rwf, 0);
  assertEquals(effect.net_effect_rwf, -4000);
  assertEquals(effect.settlement_state, "settled");
  assertEquals(effect.affects_balance, true);
  assertEquals(effect.effect_reason, "settled_outgoing_no_fee");
});

Deno.test("integration: outgoing transaction with a fee (send money) receives correct accounting fields", () => {
  const effect = computeAccountingEffect(
    accountingInputFromRaw(sendMoneyMessage.raw),
  );

  assertEquals(effect.principal_effect_rwf, -1000);
  assertEquals(effect.fee_effect_rwf, -20);
  assertEquals(effect.net_effect_rwf, -1020);
  assertEquals(effect.settlement_state, "settled");
  assertEquals(effect.affects_balance, true);
  assertEquals(effect.effect_reason, "settled_outgoing_with_fee");
});

Deno.test("integration: a failed transaction is processed to a definite zero-effect state, not skipped", () => {
  const effect = computeAccountingEffect(
    accountingInputFromRaw(failedTransactionMessage.raw),
  );

  assertEquals(effect.principal_effect_rwf, 0);
  assertEquals(effect.fee_effect_rwf, 0);
  assertEquals(effect.net_effect_rwf, 0);
  assertEquals(effect.settlement_state, "failed");
  assertEquals(effect.affects_balance, false);
});

Deno.test("integration: an unrecognized status reaching the same call index.ts makes throws rather than silently succeeding", () => {
  const malformed = {
    direction: "out" as const,
    status: "voided" as unknown as "success",
    amount_rwf: 100,
    fee_rwf: 0,
  };

  assertThrows(() => computeAccountingEffect(malformed), RangeError);
});
