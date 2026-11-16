// End-to-end check of the prepaid-electricity chain against a REAL PostgreSQL
// with every migration applied: the real receipt processor (parse -> encrypt ->
// store), the real linking (including the trigger), and the real reveal path
// (authorised RPC -> decrypt with the AAD-bound key). Only the HTTP hop
// (capture endpoint, PostgREST) is absent. Run by run_migration_tests.sh when
// `deno` is available; it inherits PGHOST/PGPORT/PGUSER. SYNTHETIC data only.

import {
  open,
  parseKeyring,
} from "../../functions/_shared/sensitive-crypto.ts";
import {
  processUtilityReceipt,
  type UtilityDeps,
} from "../../functions/process-raw-events/utility.ts";
import { detectProvider } from "../../functions/_shared/providers.ts";

const DB = Deno.env.get("E2E_DB") ?? "pfe_rls";
let failures = 0;
const ok = (m: string) => console.log(`PASS: ${m}`);
const bad = (m: string) => {
  failures++;
  console.error(`FAIL: ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : bad(m));

async function psql(sql: string): Promise<string> {
  const out = await new Deno.Command("psql", {
    args: ["-d", DB, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", "|", "-c", sql],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(new TextDecoder().decode(out.stderr).trim());
  }
  return new TextDecoder().decode(out.stdout).split("\n").filter((l) =>
    l && !/^(SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+)$/.test(l)
  ).pop() ?? "";
}
const asUser = (uid: string, sql: string) =>
  psql(
    `set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false); select set_config('request.jwt.claims','{"sub":"${uid}","aal":"aal1"}',false); ${sql}`,
  );

const KEY = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);
const ring = await parseKeyring(`k1:${KEY}`);

const TOKEN_EN = "0000-1111-2222-3333-4444";
const TOKEN_RW = "5555-6666-7777-8888-9999";
const EN = (amount: string) =>
  `Cashpower Token:\n${TOKEN_EN}\nPurchased 11.90 KWh for ${amount} RWF,\nMeter# 10000000001\nTxID: 20000000000001`;
const RW = (amount: string) =>
  `18/07/2026:\nTokeni:\n${TOKEN_RW}\nKonteri: 10000000001\n(TEST CUSTOMER NAME)\n${amount} RWF = 2.4 kWh\nTXNID: K1700000000000001`;

// --- fixture: a fresh user with a personal workspace and an account ---
const uid = await psql(
  "insert into auth.users (email) values ('e2e-utility@example.com') returning id;",
);
const ws = await psql(
  `select w.id from public.workspaces w join public.workspace_memberships m on m.workspace_id=w.id where m.user_id='${uid}' and w.kind='personal';`,
);
const acct = crypto.randomUUID();
await psql(
  `insert into public.accounts (id, workspace_id, name, provider, currency) values ('${acct}','${ws}','E2E','mtn_momo','RWF');`,
);

async function addPayment(
  amount: number,
  minutesAgo: number,
  type = "merchant_payment",
) {
  const msg = crypto.randomUUID(), tx = crypto.randomUUID();
  await psql(
    `insert into public.momo_messages (id, raw_message, processing_status) values ('${msg}','e2e','processed');
    insert into public.transactions (id, momo_message_id, account_id, workspace_id, transaction_type, direction, status, amount_rwf, fee_rwf, occurred_at, parser_version, counterparty_name, settlement_state, affects_balance, principal_effect_rwf, fee_effect_rwf, effect_reason)
    values ('${tx}','${msg}','${acct}','${ws}','${type}','out','success',${amount},0, now() - interval '${minutesAgo} minutes','test','EUCL','settled',true,-${amount},0,'settled_outgoing_with_fee');`,
  );
  return tx;
}

type Stored = { id: string; status: string; created: boolean };
function deps(
  captured: { finalized: { parseStatus: string; rawMessage: string | null }[] },
  last: { v?: Stored },
): UtilityDeps {
  return {
    storeReceipt: async (a) => {
      const q = (v: string | null) => (v === null ? "null" : `'${v}'`);
      const row = await psql(
        `select receipt_id || '|' || status || '|' || created from public.store_utility_receipt('${a.id}','${a.workspaceId}','${a.format}',${a.amountRwf},${a.kwhMilli},${
          q(a.meterLast4)
        },'${a.vendorRefHash}','${a.receiptAt}',${q(a.tokenKeyId)},${
          q(a.tokenNonce)
        },${q(a.tokenCiphertext)});`,
      );
      const [id, status, created] = row.split("|");
      last.v = { id, status, created: created === "true" };
      return { ok: true, created: created === "true", status };
    },
    finalize: (p) => {
      captured.finalized.push(p);
      return Promise.resolve();
    },
  };
}
const base = (rawMessage: string) => ({
  rawMessage,
  deviceReceivedAt: new Date().toISOString(),
  eventReceivedAt: new Date().toISOString(),
  workspaceId: ws,
  attempts: 0,
  captureEnabled: true,
  ring,
});

// The phone and the server agree these are receipts (and not MoMo).
check(
  detectProvider(EN("9101"))?.providerKey === "utility_receipt",
  "capture detection routes the English receipt to utility_receipt (before MTN)",
);
check(
  detectProvider(RW("9102"))?.providerKey === "utility_receipt",
  "capture detection routes the Kinyarwanda receipt to utility_receipt",
);

// A) payment first, then the English receipt -> linked at once
const txA = await addPayment(9101, 4);
const capA = {
    finalized: [] as { parseStatus: string; rawMessage: string | null }[],
  },
  lastA: { v?: Stored } = {};
check(
  (await processUtilityReceipt({
    ...base(EN("9,101")),
    deps: deps(capA, lastA),
  })) === "processed",
  "English receipt processed",
);
check(
  await psql(
    `select status || '|' || transaction_id || '|' || matched_by from public.utility_receipts where id='${
      lastA.v!.id
    }';`,
  ) === `matched|${txA}|auto`,
  "receipt linked to the earlier MoMo payment",
);
check(
  !capA.finalized[0].rawMessage!.includes("0000-1111"),
  "the raw evidence is rewritten without the token",
);

// B) receipt first (Kinyarwanda), then the payment arrives -> the trigger links it
const capB = {
    finalized: [] as { parseStatus: string; rawMessage: string | null }[],
  },
  lastB: { v?: Stored } = {};
await processUtilityReceipt({ ...base(RW("9,102")), deps: deps(capB, lastB) });
check(
  lastB.v!.status === "unmatched",
  "a receipt with no payment yet waits as unmatched",
);
const txB = await addPayment(9102, 0);
check(
  await psql(
    `select status || '|' || transaction_id from public.utility_receipts where id='${
      lastB.v!.id
    }';`,
  ) === `matched|${txB}`,
  "the payment arriving later links the waiting receipt (trigger)",
);

// C) re-delivery is a no-op
const capC = {
    finalized: [] as { parseStatus: string; rawMessage: string | null }[],
  },
  lastC: { v?: Stored } = {};
check(
  (await processUtilityReceipt({
    ...base(EN("9,101")),
    deps: deps(capC, lastC),
  })) === "superseded",
  "a re-delivered receipt is superseded",
);
check(
  await psql(
    `select count(*) from public.utility_receipts where workspace_id='${ws}';`,
  ) === "2",
  "still exactly two receipts",
);

// D) nothing sensitive in the database in plaintext
const dump = await psql(
  `select string_agg(t::text, ' ') from public.utility_receipts t where workspace_id='${ws}';`,
);
check(
  !/0000-?1111|5555-?6666|00001111222233334444|55556666777788889999/.test(dump),
  "no token appears in plaintext anywhere in utility_receipts",
);
check(
  !dump.includes("10000000001") && dump.includes("0001"),
  "only the last 4 digits of the meter are stored",
);
check(
  !dump.includes("TEST CUSTOMER"),
  "the meter owner's name is never stored",
);

// E) reveal through the audited RPC, decrypt with the AAD-bound key
for (
  const [tx, receipt, token] of [[txA, lastA.v!.id, "00001111222233334444"], [
    txB,
    lastB.v!.id,
    "55556666777788889999",
  ]] as const
) {
  const row = await asUser(
    uid,
    `select source || '|' || row_id || '|' || key_id || '|' || nonce || '|' || ciphertext from public.reveal_transaction_sensitive_detail('${tx}');`,
  );
  const [source, rowId, keyId, nonce, ciphertext] = row.split("|");
  check(
    source === "receipt" && rowId === receipt,
    "reveal returns the sealed value and names the receipt row",
  );
  check(
    await open(
      { keyId, nonce, ciphertext },
      ring!,
      `${rowId}:utility_receipt`,
    ) === token,
    "the revealed ciphertext decrypts to the original token",
  );
  let swapped = false;
  try {
    await open({ keyId, nonce, ciphertext }, ring!, `${tx}:utility_token`);
  } catch {
    swapped = true;
  }
  check(
    swapped,
    "the same ciphertext does NOT decrypt under another row's binding",
  );
}
check(
  await psql(
    `select count(*) from public.space_audit_events where workspace_id='${ws}' and event_type='transaction.sensitive_revealed';`,
  ) === "2",
  "each reveal was audited",
);

// F) a stranger cannot reveal
const other = await psql(
  "insert into auth.users (email) values ('e2e-utility-other@example.com') returning id;",
);
let denied = false;
try {
  await asUser(
    other,
    `select * from public.reveal_transaction_sensitive_detail('${txA}');`,
  );
} catch (e) {
  denied = String(e).includes("sensitive_detail_not_found");
}
check(denied, "another user's reveal is refused with the generic error");

// G) with capture off, the receipt is still recorded and linked but no token is kept
const txG = await addPayment(9103, 2);
const capG = {
    finalized: [] as { parseStatus: string; rawMessage: string | null }[],
  },
  lastG: { v?: Stored } = {};
await processUtilityReceipt({
  ...base(EN("9,103").replace("20000000000001", "20000000000002")),
  captureEnabled: false,
  deps: deps(capG, lastG),
});
check(
  await psql(
    `select status || '|' || has_token from public.utility_receipts where id='${
      lastG.v!.id
    }';`,
  ) === "matched|false",
  "capture off: receipt linked, no token kept",
);
let none = false;
try {
  await asUser(
    uid,
    `select * from public.reveal_transaction_sensitive_detail('${txG}');`,
  );
} catch (e) {
  none = String(e).includes("sensitive_detail_not_found");
}
check(none, "capture off: there is nothing to reveal");

console.log(
  failures === 0
    ? "E2E: all checks passed"
    : `E2E: ${failures} check(s) FAILED`,
);
Deno.exit(failures === 0 ? 0 : 1);
