import { createClient } from "npm:@supabase/supabase-js@2";
import { applyMerchantRule } from "./merchant-rules.ts";
import { parseMomoMessage } from "./parser.ts";
import { normalizeMessage, sha256 } from "./parser-utils.ts";
import { jsonResponse } from "./responses.ts";

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
    // STRUCTURED FINANCIAL LEDGER INSERT
    // ========================================================

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
