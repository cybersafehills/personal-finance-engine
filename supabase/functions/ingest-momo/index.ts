import { createClient } from "npm:@supabase/supabase-js@2";
import { applyMerchantRule } from "./merchant-rules.ts";
import { parseMomoMessage } from "./parser.ts";
import { normalizeMessage, sha256 } from "./parser-utils.ts";
import { jsonResponse } from "./responses.ts";
import { computeAccountingEffect } from "../_shared/accounting.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";
const MOMO_INGEST_SECRET = Deno.env.get("MOMO_INGEST_SECRET") ?? "";

const PARSER_VERSION = "momo-parser-v1.1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

Deno.serve(async (req: Request) => {
  try {
    // ========================================================
    // METHOD CONTROL
    // ========================================================

    if (req.method !== "POST") {
      return jsonResponse(
        {
          ok: false,
          error: "method_not_allowed",
        },
        405,
      );
    }

    // ========================================================
    // CUSTOM INGESTION AUTHENTICATION
    // ========================================================

    const suppliedSecret = req.headers.get("x-ingest-key");

    if (
      !MOMO_INGEST_SECRET ||
      !suppliedSecret ||
      suppliedSecret !== MOMO_INGEST_SECRET
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

    if (!body || typeof body !== "object") {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_request_body",
        },
        400,
      );
    }

    const payload = body as Record<string, unknown>;

    const rawMessage = typeof payload.message === "string"
      ? payload.message.trim()
      : "";

    if (!rawMessage) {
      return jsonResponse(
        {
          ok: false,
          error: "missing_message",
        },
        400,
      );
    }

    if (rawMessage.length > 5000) {
      return jsonResponse(
        {
          ok: false,
          error: "message_too_large",
        },
        413,
      );
    }

    // ========================================================
    // BASIC FINANCIAL MESSAGE FILTER
    // ========================================================

    if (!/\bRWF\b/i.test(rawMessage)) {
      return jsonResponse(
        {
          ok: false,
          error: "not_rwf_message",
        },
        422,
      );
    }

    const normalizedMessage = normalizeMessage(rawMessage);

    const fingerprint = await sha256(normalizedMessage);

    const deviceReceivedAt = typeof payload.received_at === "string"
      ? payload.received_at
      : null;

    // ========================================================
    // RAW MESSAGE DUPLICATE CHECK
    // ========================================================

    const { data: existingMessage, error: duplicateLookupError } =
      await supabase
        .from("momo_messages")
        .select("id, processing_status")
        .eq("message_fingerprint", fingerprint)
        .maybeSingle();

    if (duplicateLookupError) {
      console.error("Duplicate lookup error:", duplicateLookupError);

      return jsonResponse(
        {
          ok: false,
          error: "database_error",
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

    const { data: insertedMessage, error: messageInsertError } = await supabase
      .from("momo_messages")
      .insert({
        source: "ios_shortcuts",
        raw_message: rawMessage,
        message_fingerprint: fingerprint,
        device_received_at: deviceReceivedAt,
        processing_status: "processing",
        parser_version: PARSER_VERSION,
        parse_attempts: 1,
        last_parse_attempt_at: new Date().toISOString(),
        metadata: {
          ingestion_source: "iphone_shortcuts",
        },
      })
      .select("id")
      .single();

    if (messageInsertError || !insertedMessage) {
      console.error("Raw message insert error:", messageInsertError);

      return jsonResponse(
        {
          ok: false,
          error: "database_error",
        },
        500,
      );
    }

    const momoMessageId = insertedMessage.id;

    // ========================================================
    // DETERMINISTIC TRANSACTION PARSING
    // ========================================================

    const parsed = parseMomoMessage(rawMessage);

    if (!parsed) {
      await supabase
        .from("momo_messages")
        .update({
          processing_status: "needs_review",
        })
        .eq("id", momoMessageId);

      await supabase
        .from("processing_errors")
        .insert({
          momo_message_id: momoMessageId,
          stage: "parsing",
          error_code: "UNRECOGNIZED_MOMO_FORMAT",
          error_message:
            "The SMS contains RWF but did not match a known MTN MoMo parser pattern.",
          parser_version: PARSER_VERSION,
          error_details: {
            message_fingerprint: fingerprint,
          },
        });

      return jsonResponse({
        ok: true,
        status: "needs_review",
      });
    }

    // ========================================================
    // MTN TRANSACTION-ID DUPLICATE CHECK
    // ========================================================

    if (parsed.external_transaction_id) {
      const { data: existingTransaction, error: transactionLookupError } =
        await supabase
          .from("transactions")
          .select("id")
          .eq(
            "external_transaction_id",
            parsed.external_transaction_id,
          )
          .maybeSingle();

      if (transactionLookupError) {
        console.error(
          "Transaction duplicate lookup error:",
          transactionLookupError,
        );

        return jsonResponse(
          {
            ok: false,
            error: "database_error",
          },
          500,
        );
      }

      if (existingTransaction) {
        await supabase
          .from("momo_messages")
          .update({
            processing_status: "processed",
          })
          .eq("id", momoMessageId);

        return jsonResponse({
          ok: true,
          status: "duplicate_transaction",
        });
      }
    }

    // ========================================================
    // MERCHANT RULE CLASSIFICATION
    // ========================================================

    const classification = await applyMerchantRule(
      supabase,
      parsed.counterparty_name,
    );

    // ========================================================
    // ACCOUNTING EFFECT (Phase 4.2) - the same canonical engine that
    // processed historical transactions in Phase 4.1, invoked inline here
    // rather than as a separate Edge Function. computeAccountingEffect()
    // never guesses: for the currently-parseable input shapes it always
    // returns a definite result, but is called defensively in case a
    // future parser change ever produces a status/direction it doesn't
    // recognize.
    // ========================================================

    let accountingEffect;
    try {
      accountingEffect = computeAccountingEffect({
        direction: parsed.direction,
        status: parsed.status,
        amount_rwf: parsed.amount_rwf,
        fee_rwf: parsed.fee_rwf,
      });
    } catch (accountingError) {
      console.error("Accounting computation error:", accountingError);

      await supabase
        .from("momo_messages")
        .update({
          processing_status: "failed",
        })
        .eq("id", momoMessageId);

      await supabase
        .from("processing_errors")
        .insert({
          momo_message_id: momoMessageId,
          stage: "database",
          error_code: "ACCOUNTING_COMPUTATION_FAILED",
          error_message:
            "The parsed transaction's accounting effect could not be computed.",
          parser_version: PARSER_VERSION,
          error_details: {
            message: accountingError instanceof Error
              ? accountingError.message
              : String(accountingError),
          },
        });

      return jsonResponse(
        {
          ok: false,
          error: "accounting_computation_failed",
        },
        500,
      );
    }

    // ========================================================
    // STRUCTURED FINANCIAL LEDGER INSERT
    // ========================================================
    //
    // Accounting fields are written in the SAME insert as every other
    // transaction field - never a separate update - so a row can never
    // exist mid-ingestion with source fields present but accounting
    // fields missing. net_effect_rwf is never written here; it remains a
    // database-generated column. If the computed effect ever disagreed
    // with what Postgres generates (the documented dormant incoming-
    // with-fee case - see accounting.ts), the database's own
    // transactions_net_effect_matches_new_accounting_fields constraint
    // rejects the insert outright, and that failure is handled by the
    // exact same error path as any other insert failure below - no
    // separate pre-check duplicates that invariant here.

    const { error: transactionInsertError } = await supabase
      .from("transactions")
      .insert({
        momo_message_id: momoMessageId,
        external_transaction_id: parsed.external_transaction_id,
        source: "mtn_momo",
        transaction_type: parsed.transaction_type,
        direction: parsed.direction,
        status: parsed.status,
        currency: "RWF",
        amount_rwf: parsed.amount_rwf,
        fee_rwf: parsed.fee_rwf,
        balance_after_rwf: parsed.balance_after_rwf,
        counterparty_name: classification.normalizedMerchantName ??
          parsed.counterparty_name,
        counterparty_reference: parsed.counterparty_reference,
        occurred_at: parsed.occurred_at,
        category: classification.category,
        subcategory: classification.subcategory,
        category_source: classification.categorySource,
        category_confidence: classification.categoryConfidence,
        parser_version: PARSER_VERSION,
        metadata: {
          ...parsed.metadata,
          original_counterparty_name: parsed.counterparty_name,
          merchant_rule_applied: classification.categorySource === "rule",
        },
        principal_effect_rwf: accountingEffect.principal_effect_rwf,
        fee_effect_rwf: accountingEffect.fee_effect_rwf,
        settlement_state: accountingEffect.settlement_state,
        affects_balance: accountingEffect.affects_balance,
        effect_reason: accountingEffect.effect_reason,
      });

    if (transactionInsertError) {
      console.error("Transaction insert error:", transactionInsertError);

      await supabase
        .from("momo_messages")
        .update({
          processing_status: "failed",
        })
        .eq("id", momoMessageId);

      await supabase
        .from("processing_errors")
        .insert({
          momo_message_id: momoMessageId,
          stage: "database",
          error_code: "TRANSACTION_INSERT_FAILED",
          error_message:
            "The parsed transaction could not be saved to the ledger.",
          parser_version: PARSER_VERSION,
          error_details: {
            postgres_message: transactionInsertError.message,
          },
        });

      return jsonResponse(
        {
          ok: false,
          error: "transaction_store_failed",
        },
        500,
      );
    }

    // ========================================================
    // MARK RAW MESSAGE AS PROCESSED
    // ========================================================

    const { error: processedUpdateError } = await supabase
      .from("momo_messages")
      .update({
        processing_status: "processed",
      })
      .eq("id", momoMessageId);

    if (processedUpdateError) {
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
    console.error("Unhandled ingest-momo error:", error);

    return jsonResponse(
      {
        ok: false,
        error: "internal_error",
      },
      500,
    );
  }
});
