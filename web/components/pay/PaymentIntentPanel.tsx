"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "../Badge";
import { CopyIcon, PayIcon } from "../icons";
import { PaymentQr } from "./PaymentQr";
import { messages } from "../../lib/ussd/messages";
import {
  buildTelHref,
  detectDialerCapability,
  fillUssdTemplate,
  type DialerCapability,
  type ParamSpec,
} from "../../lib/ussd/capability";
import {
  describeMatchedOn,
  statusDescription,
  statusLabel,
  statusTone,
  type IntentStatusInput,
} from "../../lib/pay/state";
import {
  applyReconciliation,
  cancelIntent,
  linkPaymentManually,
  manuallyConfirm,
  markIntentFailed,
  payAgain,
  recordHandoff,
  rejectReconciliation,
} from "../../app/pay/assisted-actions";

const t = messages().pay.assisted;

export type PanelIntent = IntentStatusInput & {
  id: string;
  source: string;
  payment_type: string;
  provider: string | null;
  currency: string;
  amount_minor: number;
  recipient_name: string | null;
  recipient_msisdn_normalized: string | null;
  recipient_msisdn_masked: string | null;
  merchant_code: string | null;
  meter_number: string | null;
  billing_reference: string | null;
  government_reference: string | null;
  note: string | null;
  category: string | null;
  handoff_method: string;
  linked_transaction_id: string | null;
};

export type PanelServiceCode = {
  ussd_template: string;
  accepts_parameters: boolean;
  slug: string;
  parameters: {
    key: string;
    kind: ParamSpec["kind"];
    required: boolean;
    format_regex: string | null;
    min_length: number | null;
    max_length: number | null;
  }[];
};

const TONE_VARIANT = {
  positive: "positive",
  attention: "attention",
  neutral: "neutral",
} as const;

const TYPE_LABEL: Record<string, string> = {
  pay_person: "Pay a person",
  pay_merchant: "Pay a merchant",
  pay_bill: "Pay a bill",
  buy_electricity: "Buy electricity",
  buy_airtime: "Buy airtime or data",
  government: "Government services",
};

export type PanelReconciliation = {
  id: string;
  transaction_id: string;
  match_method: string;
  status: string;
  applied_at: string | null;
  matched_on: Record<string, unknown>;
};

export type PanelLinkedTxn = {
  id: string;
  occurred_at: string;
  amount_rwf: number;
  fee_rwf: number;
  counterparty_name: string | null;
};

export type PanelUnlinkedTxn = {
  id: string;
  occurred_at: string;
  amount_rwf: number;
  counterparty_name: string | null;
};

export function PaymentIntentPanel({
  intent,
  serviceCode,
  sessionFresh,
  sourceAccountName,
  budgetName,
  trustStatus,
  reconciliations,
  linkedTransaction,
  unlinkedTransactions,
}: {
  intent: PanelIntent;
  serviceCode: PanelServiceCode | null;
  sessionFresh: boolean;
  sourceAccountName: string | null;
  budgetName: string | null;
  trustStatus: "saved" | "trusted_by_user" | null;
  reconciliations: PanelReconciliation[];
  linkedTransaction: PanelLinkedTxn | null;
  unlinkedTransactions: PanelUnlinkedTxn[];
}) {
  const router = useRouter();
  const [capability, setCapability] = useState<DialerCapability>({
    canAttemptDialer: false,
    platform: "unknown",
    reason: "ssr",
  });
  const [, startDetect] = useTransition();
  useEffect(() => {
    startDetect(() => setCapability(detectDialerCapability(navigator.userAgent)));
  }, []);

  const amountMajor =
    intent.currency === "RWF" ? intent.amount_minor : intent.amount_minor / 100;

  const filled = useMemo(() => {
    if (!serviceCode) return null;
    if (!serviceCode.accepts_parameters) {
      return { ok: true as const, display: serviceCode.ussd_template, dial: serviceCode.ussd_template };
    }
    const specs: ParamSpec[] = serviceCode.parameters.map((p) => ({
      key: p.key,
      kind: p.kind,
      required: p.required,
      formatRegex: p.format_regex,
      minLength: p.min_length,
      maxLength: p.max_length,
    }));
    // Rwandan MoMo/Airtel USSD menus expect the recipient in local
    // `07XXXXXXXX` form, which is also what the seeded service-code
    // parameter regexes match.
    const localMsisdn = intent.recipient_msisdn_normalized
      ? "0" + intent.recipient_msisdn_normalized.slice(3)
      : "";
    // Supply a value for every parameter kind a code might ask for -
    // keyed by the code's own parameter key, chosen by its kind - so a
    // merchant / meter / bill template (`*182*8*1*{merchant}*{amount}#`)
    // fills the same way a send-money one does. Previously only
    // phone + amount were passed, so any merchant code failed with
    // "Enter a merchant code" and the screen fell back to "no route".
    const valueForKind: Partial<Record<ParamSpec["kind"], string>> = {
      phone: localMsisdn,
      amount: String(Math.round(amountMajor)),
      merchant_code: intent.merchant_code ?? "",
      meter_number: intent.meter_number ?? "",
      billing_id: intent.billing_reference ?? "",
      account_reference: intent.billing_reference ?? "",
      national_id: intent.government_reference ?? "",
      reference: intent.government_reference ?? "",
      text: intent.government_reference ?? "",
    };
    const params: Record<string, string> = {};
    for (const spec of specs) {
      const v = valueForKind[spec.kind];
      if (v) params[spec.key] = v;
    }
    return fillUssdTemplate(serviceCode.ussd_template, params, specs);
  }, [
    serviceCode,
    intent.recipient_msisdn_normalized,
    intent.merchant_code,
    intent.meter_number,
    intent.billing_reference,
    intent.government_reference,
    amountMajor,
  ]);

  const dialString = filled && filled.ok ? filled.dial : null;

  const isDraftish =
    intent.state === "draft" ||
    intent.state === "initiated" ||
    intent.state === "awaiting_verification";
  const label = statusLabel(intent);
  const tone = statusTone(intent);

  const [busy, setBusy] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handoff(
    method: "copy" | "dialer" | "qr",
    outcome: "copied" | "dialer_opened" | "dialer_unsupported" | "qr_shown" | "fallback_shown",
  ) {
    await recordHandoff(intent.id, method, outcome);
    router.refresh();
  }

  async function onCopy() {
    const text = dialString ?? summaryText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
    void handoff("copy", dialString ? "copied" : "fallback_shown");
  }

  function summaryText(): string {
    return [
      TYPE_LABEL[intent.payment_type] ?? intent.payment_type,
      intent.recipient_name && `To: ${intent.recipient_name}`,
      intent.recipient_msisdn_normalized && `Number: ${intent.recipient_msisdn_normalized}`,
      intent.merchant_code && `Merchant: ${intent.merchant_code}`,
      intent.meter_number && `Meter: ${intent.meter_number}`,
      `Amount: ${amountMajor} ${intent.currency}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function run(name: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(name);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  async function onPayAgain() {
    setBusy("again");
    const res = await payAgain(intent.id);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/pay/${res.id}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={TONE_VARIANT[tone]}>{label}</Badge>
        {intent.source === "qr_scan" && (
          <Badge variant="neutral">{t.fromScan}</Badge>
        )}
        <span className="text-xs text-text-muted">{statusDescription(intent)}</span>
      </div>

      <ReconciliationSection
        intentId={intent.id}
        intentState={intent.state}
        currency={intent.currency}
        linkedTransaction={linkedTransaction}
        reconciliations={reconciliations}
        unlinkedTransactions={unlinkedTransactions}
        onDone={() => router.refresh()}
      />

      {/* Review block */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-text-muted">Type</dt>
        <dd className="text-text-primary">{TYPE_LABEL[intent.payment_type] ?? intent.payment_type}</dd>

        {sourceAccountName && (
          <>
            <dt className="text-text-muted">{t.sourceAccount}</dt>
            <dd className="text-text-primary">{sourceAccountName}</dd>
          </>
        )}

        <dt className="text-text-muted">{t.recipient}</dt>
        <dd className="text-text-primary">
          {intent.recipient_name ?? intent.merchant_code ?? intent.meter_number ?? "—"}
          {intent.recipient_msisdn_masked && (
            <span className="ml-2 text-text-muted">{intent.recipient_msisdn_masked}</span>
          )}
          {trustStatus && (
            <span className="ml-2">
              <Badge variant="neutral">
                {trustStatus === "trusted_by_user" ? t.trustBadgeTrusted : t.trustBadgeSaved}
              </Badge>
            </span>
          )}
        </dd>

        <dt className="text-text-muted">{t.amount}</dt>
        <dd className="text-text-primary">
          {amountMajor} {intent.currency}
        </dd>

        <dt className="text-text-muted">Fee</dt>
        <dd className="text-text-muted">{t.feeNotice}</dd>

        {(intent.billing_reference || intent.government_reference) && (
          <>
            <dt className="text-text-muted">Reference</dt>
            <dd className="text-text-primary">
              {intent.billing_reference ?? intent.government_reference}
            </dd>
          </>
        )}

        {intent.category && (
          <>
            <dt className="text-text-muted">Category</dt>
            <dd className="text-text-primary">{intent.category}</dd>
          </>
        )}
        {budgetName && (
          <>
            <dt className="text-text-muted">Budget</dt>
            <dd className="text-text-primary">{budgetName}</dd>
          </>
        )}
        {intent.note && (
          <>
            <dt className="text-text-muted">Note</dt>
            <dd className="text-text-primary">{intent.note}</dd>
          </>
        )}
      </dl>

      {trustStatus && (
        <p className="text-xs text-text-muted">{t.trustNotProviderVerified}</p>
      )}

      <div className="rounded-control bg-background px-3 py-2.5 text-xs text-text-secondary">
        {t.handoffNotice}
      </div>

      {isDraftish && !sessionFresh && (
        <div className="rounded-control bg-attention-bg px-3 py-2 text-xs text-attention">
          {t.sessionStale}
        </div>
      )}

      {isDraftish && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-text-primary">{t.nextAction}</p>

          {dialString ? (
            <>
              <p className="font-mono text-sm text-text-secondary">{dialString}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={onCopy}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-border-subtle bg-surface px-4 py-2.5 text-sm font-medium text-text-primary"
                >
                  <CopyIcon className="h-4 w-4" />
                  {copied ? "Copied" : t.copyCode}
                </button>
                {capability.canAttemptDialer ? (
                  <a
                    href={buildTelHref(dialString)}
                    onClick={() => void handoff("dialer", "dialer_opened")}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
                  >
                    <PayIcon className="h-4 w-4" />
                    {t.openDialer}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowQr((v) => !v);
                      void handoff("qr", "qr_shown");
                    }}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
                  >
                    {t.showQr}
                  </button>
                )}
              </div>
              {!capability.canAttemptDialer && (
                <p className="text-xs text-text-muted">{t.dialerUnavailable}</p>
              )}
              {showQr && <PaymentQr value={buildTelHref(dialString)} label={t.qrCaption} />}
            </>
          ) : (
            <div className="rounded-control border border-border-subtle px-3 py-3 text-sm text-text-secondary">
              We don&apos;t have a verified USSD route for this payment yet. Open the{" "}
              <Link href="/pay/ussd" className="font-medium text-accent underline">
                USSD directory
              </Link>{" "}
              to find the right code, then come back and confirm here.
              <div className="mt-2">
                <button
                  type="button"
                  onClick={onCopy}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-border-subtle bg-surface px-4 py-2 text-sm font-medium text-text-primary"
                >
                  <CopyIcon className="h-4 w-4" />
                  {copied ? "Copied" : "Copy the details"}
                </button>
              </div>
            </div>
          )}

          <div className="mt-2 flex flex-col gap-2 border-t border-border-subtle pt-3">
            <button
              type="button"
              onClick={() =>
                run("confirm", () => manuallyConfirm(intent.id, "confirmed with provider"))
              }
              disabled={busy !== null || intent.state === "draft"}
              className="min-h-11 rounded-control border border-border-subtle bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary disabled:opacity-50"
            >
              {busy === "confirm" ? "…" : t.confirmCta}
            </button>
            <p className="text-xs text-text-muted">{t.confirmHint}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => run("fail", () => markIntentFailed(intent.id, "user reported failure"))}
                disabled={busy !== null || intent.state === "draft"}
                className="min-h-11 flex-1 rounded-control px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50"
              >
                {t.failCta}
              </button>
              <button
                type="button"
                onClick={() => run("cancel", () => cancelIntent(intent.id))}
                disabled={busy !== null}
                className="min-h-11 flex-1 rounded-control px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50"
              >
                {t.cancelCta}
              </button>
            </div>
          </div>
        </div>
      )}

      {!isDraftish && intent.state !== "cancelled" && (
        <button
          type="button"
          onClick={onPayAgain}
          disabled={busy !== null}
          className="min-h-11 self-start rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          {busy === "again" ? "…" : t.payAgain}
        </button>
      )}

      {error && (
        <p className="text-sm text-attention" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

function fmtRwf(n: number, currency: string): string {
  const major = currency === "RWF" ? n : n / 100;
  return `${major.toLocaleString()} ${currency}`;
}

function ReconciliationSection({
  intentId,
  intentState,
  currency,
  linkedTransaction,
  reconciliations,
  unlinkedTransactions,
  onDone,
}: {
  intentId: string;
  intentState: string;
  currency: string;
  linkedTransaction: PanelLinkedTxn | null;
  reconciliations: PanelReconciliation[];
  unlinkedTransactions: PanelUnlinkedTxn[];
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  async function run(name: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(name);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      return;
    }
    onDone();
  }

  // Already linked - show the evidence.
  if (linkedTransaction) {
    const recon = reconciliations.find((r) => r.status === "linked");
    return (
      <section className="rounded-card border border-border-subtle p-3">
        <p className="text-sm font-semibold text-text-primary">{t.recon.linkedHeading}</p>
        <p className="mt-1 text-sm text-text-secondary">
          {linkedTransaction.counterparty_name ?? "Transaction"} ·{" "}
          {fmtRwf(linkedTransaction.amount_rwf + linkedTransaction.fee_rwf, currency)} ·{" "}
          {new Date(linkedTransaction.occurred_at).toLocaleString()}
        </p>
        {recon && (
          <p className="mt-0.5 text-xs text-text-muted">{describeMatchedOn(recon.matched_on)}</p>
        )}
        <Link
          href={`/transactions/${linkedTransaction.id}`}
          className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
        >
          {t.recon.viewTransaction}
        </Link>
      </section>
    );
  }

  const likely = reconciliations.find(
    (r) => r.status === "linked" && r.applied_at === null,
  );
  const conflicts = reconciliations.filter((r) => r.status === "conflict");
  const showManualOption =
    intentState === "requires_reconciliation" ||
    intentState === "awaiting_verification" ||
    intentState === "initiated";

  if (!likely && conflicts.length === 0 && !showManualOption) return null;

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border-subtle p-3">
      {likely && (
        <div>
          <p className="text-sm font-semibold text-text-primary">{t.recon.likelyHeading}</p>
          <p className="mt-1 text-sm text-text-secondary">{t.recon.likelyBody}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => run("apply", () => applyReconciliation(likely.id))}
              disabled={busy !== null}
              className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {busy === "apply" ? "…" : t.recon.apply}
            </button>
            <button
              type="button"
              onClick={() => run("reject", () => rejectReconciliation(likely.id, "not this one"))}
              disabled={busy !== null}
              className="min-h-11 rounded-control px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50"
            >
              {t.recon.reject}
            </button>
          </div>
        </div>
      )}

      {conflicts.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-attention">{t.recon.conflictHeading}</p>
          <p className="mt-1 text-sm text-text-secondary">
            Resolve this on the{" "}
            <Link href="/pay/reconciliation" className="font-medium text-accent underline">
              {t.recon.title}
            </Link>{" "}
            screen.
          </p>
        </div>
      )}

      {showManualOption && (
        <div>
          {!showManual ? (
            <button
              type="button"
              onClick={() => setShowManual(true)}
              className="text-sm font-medium text-accent hover:underline"
            >
              {t.recon.manualLinkCta}
            </button>
          ) : (
            <div>
              <p className="text-sm text-text-secondary">{t.recon.manualLinkBody}</p>
              {unlinkedTransactions.length === 0 ? (
                <p className="mt-1 text-xs text-text-muted">{t.recon.noWindowTxns}</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {unlinkedTransactions.map((tx) => (
                    <li key={tx.id}>
                      <button
                        type="button"
                        onClick={() =>
                          run(`link-${tx.id}`, () =>
                            linkPaymentManually(intentId, tx.id, "manual link"),
                          )
                        }
                        disabled={busy !== null}
                        className="flex w-full items-center justify-between gap-2 rounded-control border border-border-subtle px-3 py-2 text-left text-sm hover:border-accent disabled:opacity-50"
                      >
                        <span className="text-text-primary">
                          {tx.counterparty_name ?? "Transaction"}
                        </span>
                        <span className="text-text-muted">
                          {fmtRwf(tx.amount_rwf, currency)} ·{" "}
                          {new Date(tx.occurred_at).toLocaleDateString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-attention" role="status">
          {error}
        </p>
      )}
    </section>
  );
}
