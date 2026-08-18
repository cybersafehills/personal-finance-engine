import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MOMO_INGEST_SECRET =
  Deno.env.get("MOMO_INGEST_SECRET") ?? "";

const PARSER_VERSION = "momo-parser-v1.1";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

type TransactionType =
  | "send_money"
  | "merchant_payment"
  | "money_received"
  | "airtime"
  | "cash_withdrawal"
  | "cash_deposit"
  | "bill_payment"
  | "bank_transfer"
  | "refund"
  | "reversal"
  | "other";

type TransactionDirection = "in" | "out" | "neutral";

type TransactionStatus =
  | "success"
  | "failed"
  | "reversed"
  | "pending"
  | "unknown";

type ParsedTransaction = {
  external_transaction_id: string | null;
  transaction_type: TransactionType;
  direction: TransactionDirection;
  status: TransactionStatus;
  amount_rwf: number;
  fee_rwf: number;
  balance_after_rwf: number | null;
  counterparty_name: string | null;
  counterparty_reference: string | null;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeMessage(input: string): string {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseNumber(value?: string | null): number | null {
  if (!value) return null;

  const cleaned = value
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function parseOccurredAt(
  date: string,
  time: string,
): string {
  // MTN Rwanda SMS timestamps are expressed in Rwanda local time.
  // Rwanda uses UTC+02:00.
  return `${date}T${time}+02:00`;
}

function extractFee(message: string): number {
  const match =
    message.match(/Fee[:.\s]*([\d,]+)\s*RWF/i) ??
    message.match(/Fee\s+([\d,]+)\s*RWF/i);

  return parseNumber(match?.[1]) ?? 0;
}

function extractBalance(message: string): number | null {
  const match =
    message.match(/Balance[:.\s]*([\d,]+)\s*RWF/i) ??
    message.match(/Balance:\s*([\d,]+)/i);

  return parseNumber(match?.[1]);
}

function extractTransactionId(
  message: string,
): string | null {
  const patterns = [
    /TxId[:.\s]*([0-9]+)/i,
    /FT\s*Id[:.\s]*([0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function parseMomoMessage(
  rawMessage: string,
): ParsedTransaction | null {
  const message = normalizeMessage(rawMessage);

  // =========================================================
  // 1. FAILED TRANSACTION
  // =========================================================

  const failed = message.match(
    /transaction with amount\s+([\d,]+)\s+RWF.*?failed at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (failed) {
    return {
      external_transaction_id:
        extractTransactionId(message),
      transaction_type: "other",
      direction: "out",
      status: "failed",
      amount_rwf:
        parseNumber(failed[1]) ?? 0,
      fee_rwf: 0,
      balance_after_rwf:
        extractBalance(message),
      counterparty_name:
        "MTN RWANDACELL LIMITED",
      counterparty_reference: null,
      occurred_at:
        parseOccurredAt(
          failed[2],
          failed[3],
        ),
      metadata: {
        parser_pattern:
          "failed_transaction",
      },
    };
  }

  // =========================================================
  // 2. MONEY RECEIVED
  // =========================================================

  const received = message.match(
    /You have received\s+([\d,]+)\s+RWF\s+from\s+(.+?)\s+\(([^)]+)\)\s+at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (received) {
    return {
      external_transaction_id:
        extractTransactionId(message),
      transaction_type:
        "money_received",
      direction: "in",
      status: "success",
      amount_rwf:
        parseNumber(received[1]) ?? 0,
      fee_rwf: 0,
      balance_after_rwf:
        extractBalance(message),
      counterparty_name:
        received[2].trim(),
      counterparty_reference:
        received[3].trim(),
      occurred_at:
        parseOccurredAt(
          received[4],
          received[5],
        ),
      metadata: {
        parser_pattern:
          "money_received",
      },
    };
  }

  // =========================================================
  // 3. SEND MONEY
  // =========================================================

  const transferred = message.match(
    /([\d,]+)\s+RWF\s+transferred to\s+(.+?)\s+\(([^)]+)\)\s+at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (transferred) {
    return {
      external_transaction_id:
        extractTransactionId(message),
      transaction_type:
        "send_money",
      direction: "out",
      status: "success",
      amount_rwf:
        parseNumber(transferred[1]) ?? 0,
      fee_rwf:
        extractFee(message),
      balance_after_rwf:
        extractBalance(message),
      counterparty_name:
        transferred[2].trim(),
      counterparty_reference:
        transferred[3].trim(),
      occurred_at:
        parseOccurredAt(
          transferred[4],
          transferred[5],
        ),
      metadata: {
        parser_pattern:
          "send_money",
      },
    };
  }

  // =========================================================
  // 4. AIRTIME
  //
  // Specific parser must run before the generic merchant parser.
  // Example:
  // Your payment of 100 RWF to Airtime with token ...
  // was completed at ...
  // =========================================================

  const airtimePayment = message.match(
    /Your payment of\s+([\d,]+)\s+RWF\s+to\s+Airtime\b.*?was completed at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (airtimePayment) {
    return {
      external_transaction_id:
        extractTransactionId(message),
      transaction_type:
        "airtime",
      direction: "out",
      status: "success",
      amount_rwf:
        parseNumber(
          airtimePayment[1],
        ) ?? 0,
      fee_rwf:
        extractFee(message),
      balance_after_rwf:
        extractBalance(message),
      counterparty_name:
        "Airtime",
      counterparty_reference:
        null,
      occurred_at:
        parseOccurredAt(
          airtimePayment[2],
          airtimePayment[3],
        ),
      metadata: {
        parser_pattern:
          "airtime_payment",
      },
    };
  }

  // =========================================================
  // 5. NORMAL MERCHANT PAYMENT
  //
  // Example:
  // Your payment of 4,000 RWF to KMLVIO CENTER AND MILK
  // ZONE SHOP 093011 was completed at ...
  // =========================================================

  const merchantPayment = message.match(
    /Your payment of\s+([\d,]+)\s+RWF\s+to\s+(.+?)\s+was completed at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
  );

  if (merchantPayment) {
    const merchantRaw =
      merchantPayment[2].trim();

    const referenceMatch =
      merchantRaw.match(/\s([0-9]{5,})$/);

    const reference =
      referenceMatch?.[1] ?? null;

    const merchantName = reference
      ? merchantRaw
          .replace(/\s+[0-9]{5,}$/, "")
          .trim()
      : merchantRaw;

    return {
      external_transaction_id:
        extractTransactionId(message),
      transaction_type:
        "merchant_payment",
      direction: "out",
      status: "success",
      amount_rwf:
        parseNumber(
          merchantPayment[1],
        ) ?? 0,
      fee_rwf:
        extractFee(message),
      balance_after_rwf:
        extractBalance(message),
      counterparty_name:
        merchantName,
      counterparty_reference:
        reference,
      occurred_at:
        parseOccurredAt(
          merchantPayment[3],
          merchantPayment[4],
        ),
      metadata: {
        parser_pattern:
          "merchant_payment",
      },
    };
  }

  // =========================================================
  // 6. GENERIC SUCCESSFUL TRANSACTION
  //
  // Example:
  // A transaction of 11520 RWF by Yego Innovision Ltd
  // was completed at ...
  // =========================================================

  const genericTransaction =
    message.match(
      /A transaction of\s+([\d,]+)\s+RWF\s+by\s+(.+?)\s+was completed at\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/i,
    );

  if (genericTransaction) {
    return {
      external_transaction_id:
        extractTransactionId(message),
      transaction_type:
        "merchant_payment",
      direction: "out",
      status: "success",
      amount_rwf:
        parseNumber(
          genericTransaction[1],
        ) ?? 0,
      fee_rwf:
        extractFee(message),
      balance_after_rwf:
        extractBalance(message),
      counterparty_name:
        genericTransaction[2].trim(),
      counterparty_reference:
        null,
      occurred_at:
        parseOccurredAt(
          genericTransaction[3],
          genericTransaction[4],
        ),
      metadata: {
        parser_pattern:
          "generic_transaction",
      },
    };
  }

  return null;
}

async function applyMerchantRule(
  counterpartyName: string | null,
): Promise<{
  normalizedMerchantName: string | null;
  category: string | null;
  subcategory: string | null;
  categorySource: string | null;
  categoryConfidence: number | null;
}> {
  if (!counterpartyName) {
    return {
      normalizedMerchantName: null,
      category: null,
      subcategory: null,
      categorySource: null,
      categoryConfidence: null,
    };
  }

  const { data: rules, error } =
    await supabase
      .from("merchant_rules")
      .select(
        `
          id,
          match_type,
          merchant_pattern,
          normalized_merchant_name,
          category,
          subcategory,
          confidence,
          usage_count
        `,
      )
      .eq("is_active", true)
      .order("priority", {
        ascending: true,
      });

  if (error || !rules) {
    console.error(
      "Merchant rule lookup failed:",
      error,
    );

    return {
      normalizedMerchantName: null,
      category: null,
      subcategory: null,
      categorySource: null,
      categoryConfidence: null,
    };
  }

  const normalizedCounterparty =
    counterpartyName
      .trim()
      .toLowerCase();

  for (const rule of rules) {
    const pattern =
      String(rule.merchant_pattern)
        .trim()
        .toLowerCase();

    let matched = false;

    switch (rule.match_type) {
      case "exact":
        matched =
          normalizedCounterparty === pattern;
        break;

      case "contains":
        matched =
          normalizedCounterparty.includes(
            pattern,
          );
        break;

      case "starts_with":
        matched =
          normalizedCounterparty.startsWith(
            pattern,
          );
        break;

      case "regex":
        try {
          matched = new RegExp(
            rule.merchant_pattern,
            "i",
          ).test(counterpartyName);
        } catch {
          matched = false;
        }
        break;
    }

    if (!matched) {
      continue;
    }

    const currentUsageCount =
      Number(rule.usage_count ?? 0);

    const { error: ruleUsageUpdateError } =
      await supabase
        .from("merchant_rules")
        .update({
          usage_count:
            currentUsageCount + 1,
          last_used_at:
            new Date().toISOString(),
        })
        .eq("id", rule.id);

    if (ruleUsageUpdateError) {
      console.error(
        "Merchant rule usage update failed:",
        ruleUsageUpdateError,
      );
    }

    return {
      normalizedMerchantName:
        rule.normalized_merchant_name ??
        counterpartyName,
      category:
        rule.category ?? null,
      subcategory:
        rule.subcategory ?? null,
      categorySource:
        "rule",
      categoryConfidence:
        Number(rule.confidence) || 1,
    };
  }

  return {
    normalizedMerchantName: null,
    category: null,
    subcategory: null,
    categorySource: null,
    categoryConfidence: null,
  };
}

Deno.serve(async (req: Request) => {
  try {
    // ========================================================
    // METHOD CONTROL
    // ========================================================

    if (req.method !== "POST") {
      return jsonResponse(
        {
          ok: false,
          error:
            "method_not_allowed",
        },
        405,
      );
    }

    // ========================================================
    // CUSTOM INGESTION AUTHENTICATION
    // ========================================================

    const suppliedSecret =
      req.headers.get(
        "x-ingest-key",
      );

    if (
      !MOMO_INGEST_SECRET ||
      !suppliedSecret ||
      suppliedSecret !==
        MOMO_INGEST_SECRET
    ) {
      return jsonResponse(
        {
          ok: false,
          error: "unauthorized",
        },
        401,
      );
    }

    // ========================================================
    // BODY VALIDATION
    // ========================================================

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_json",
        },
        400,
      );
    }

    if (
      !body ||
      typeof body !== "object"
    ) {
      return jsonResponse(
        {
          ok: false,
          error:
            "invalid_request_body",
        },
        400,
      );
    }

    const payload =
      body as Record<
        string,
        unknown
      >;

    const rawMessage =
      typeof payload.message ===
        "string"
        ? payload.message.trim()
        : "";

    if (!rawMessage) {
      return jsonResponse(
        {
          ok: false,
          error:
            "missing_message",
        },
        400,
      );
    }

    if (
      rawMessage.length > 5000
    ) {
      return jsonResponse(
        {
          ok: false,
          error:
            "message_too_large",
        },
        413,
      );
    }

    // ========================================================
    // BASIC FINANCIAL MESSAGE FILTER
    // ========================================================

    if (
      !/\bRWF\b/i.test(
        rawMessage,
      )
    ) {
      return jsonResponse(
        {
          ok: false,
          error:
            "not_rwf_message",
        },
        422,
      );
    }

    const normalizedMessage =
      normalizeMessage(rawMessage);

    const fingerprint =
      await sha256(
        normalizedMessage,
      );

    const deviceReceivedAt =
      typeof payload.received_at ===
        "string"
        ? payload.received_at
        : null;

    // ========================================================
    // RAW MESSAGE DUPLICATE CHECK
    // ========================================================

    const {
      data: existingMessage,
      error:
        duplicateLookupError,
    } = await supabase
      .from("momo_messages")
      .select(
        "id, processing_status",
      )
      .eq(
        "message_fingerprint",
        fingerprint,
      )
      .maybeSingle();

    if (
      duplicateLookupError
    ) {
      console.error(
        "Duplicate lookup error:",
        duplicateLookupError,
      );

      return jsonResponse(
        {
          ok: false,
          error:
            "database_error",
        },
        500,
      );
    }

    if (existingMessage) {
      return jsonResponse({
        ok: true,
        status: "duplicate",
      });
    }

    // ========================================================
    // STORE RAW SMS EVIDENCE
    // ========================================================

    const {
      data: insertedMessage,
      error: messageInsertError,
    } = await supabase
      .from("momo_messages")
      .insert({
        source:
          "ios_shortcuts",

        raw_message:
          rawMessage,

        message_fingerprint:
          fingerprint,

        device_received_at:
          deviceReceivedAt,

        processing_status:
          "processing",

        parser_version:
          PARSER_VERSION,

        parse_attempts: 1,

        last_parse_attempt_at:
          new Date().toISOString(),

        metadata: {
          ingestion_source:
            "iphone_shortcuts",
        },
      })
      .select("id")
      .single();

    if (
      messageInsertError ||
      !insertedMessage
    ) {
      console.error(
        "Raw message insert error:",
        messageInsertError,
      );

      return jsonResponse(
        {
          ok: false,
          error:
            "database_error",
        },
        500,
      );
    }

    const momoMessageId =
      insertedMessage.id;

    // ========================================================
    // DETERMINISTIC TRANSACTION PARSING
    // ========================================================

    const parsed =
      parseMomoMessage(
        rawMessage,
      );

    if (!parsed) {
      await supabase
        .from("momo_messages")
        .update({
          processing_status:
            "needs_review",
        })
        .eq(
          "id",
          momoMessageId,
        );

      await supabase
        .from(
          "processing_errors",
        )
        .insert({
          momo_message_id:
            momoMessageId,

          stage: "parsing",

          error_code:
            "UNRECOGNIZED_MOMO_FORMAT",

          error_message:
            "The SMS contains RWF but did not match a known MTN MoMo parser pattern.",

          parser_version:
            PARSER_VERSION,

          error_details: {
            message_fingerprint:
              fingerprint,
          },
        });

      return jsonResponse({
        ok: true,
        status:
          "needs_review",
      });
    }

    // ========================================================
    // MTN TRANSACTION-ID DUPLICATE CHECK
    // ========================================================

    if (
      parsed
        .external_transaction_id
    ) {
      const {
        data:
          existingTransaction,
        error:
          transactionLookupError,
      } = await supabase
        .from("transactions")
        .select("id")
        .eq(
          "external_transaction_id",
          parsed
            .external_transaction_id,
        )
        .maybeSingle();

      if (
        transactionLookupError
      ) {
        console.error(
          "Transaction duplicate lookup error:",
          transactionLookupError,
        );

        return jsonResponse(
          {
            ok: false,
            error:
              "database_error",
          },
          500,
        );
      }

      if (
        existingTransaction
      ) {
        await supabase
          .from("momo_messages")
          .update({
            processing_status:
              "processed",
          })
          .eq(
            "id",
            momoMessageId,
          );

        return jsonResponse({
          ok: true,
          status:
            "duplicate_transaction",
        });
      }
    }

    // ========================================================
    // MERCHANT RULE CLASSIFICATION
    // ========================================================

    const classification =
      await applyMerchantRule(
        parsed
          .counterparty_name,
      );

    // ========================================================
    // STRUCTURED FINANCIAL LEDGER INSERT
    // ========================================================

    const {
      error:
        transactionInsertError,
    } = await supabase
      .from("transactions")
      .insert({
        momo_message_id:
          momoMessageId,

        external_transaction_id:
          parsed
            .external_transaction_id,

        source: "mtn_momo",

        transaction_type:
          parsed
            .transaction_type,

        direction:
          parsed.direction,

        status:
          parsed.status,

        currency: "RWF",

        amount_rwf:
          parsed.amount_rwf,

        fee_rwf:
          parsed.fee_rwf,

        balance_after_rwf:
          parsed
            .balance_after_rwf,

        counterparty_name:
          classification
            .normalizedMerchantName ??
          parsed
            .counterparty_name,

        counterparty_reference:
          parsed
            .counterparty_reference,

        occurred_at:
          parsed.occurred_at,

        category:
          classification
            .category,

        subcategory:
          classification
            .subcategory,

        category_source:
          classification
            .categorySource,

        category_confidence:
          classification
            .categoryConfidence,

        parser_version:
          PARSER_VERSION,

        metadata: {
          ...parsed.metadata,
          original_counterparty_name:
            parsed.counterparty_name,
          merchant_rule_applied:
            classification.categorySource ===
            "rule",
        },
      });

    if (
      transactionInsertError
    ) {
      console.error(
        "Transaction insert error:",
        transactionInsertError,
      );

      await supabase
        .from("momo_messages")
        .update({
          processing_status:
            "failed",
        })
        .eq(
          "id",
          momoMessageId,
        );

      await supabase
        .from(
          "processing_errors",
        )
        .insert({
          momo_message_id:
            momoMessageId,

          stage: "database",

          error_code:
            "TRANSACTION_INSERT_FAILED",

          error_message:
            "The parsed transaction could not be saved to the ledger.",

          parser_version:
            PARSER_VERSION,

          error_details: {
            postgres_message:
              transactionInsertError
                .message,
          },
        });

      return jsonResponse(
        {
          ok: false,
          error:
            "transaction_store_failed",
        },
        500,
      );
    }

    // ========================================================
    // MARK RAW MESSAGE AS PROCESSED
    // ========================================================

    const {
      error:
        processedUpdateError,
    } = await supabase
      .from("momo_messages")
      .update({
        processing_status:
          "processed",
      })
      .eq(
        "id",
        momoMessageId,
      );

    if (
      processedUpdateError
    ) {
      console.error(
        "Processing-status update error:",
        processedUpdateError,
      );
    }

    // ========================================================
    // MINIMAL SUCCESS RESPONSE
    // ========================================================

    return jsonResponse({
      ok: true,
      status: "processed",
    });
  } catch (error) {
    console.error(
      "Unhandled ingest-momo error:",
      error,
    );

    return jsonResponse(
      {
        ok: false,
        error:
          "internal_error",
      },
      500,
    );
  }
});