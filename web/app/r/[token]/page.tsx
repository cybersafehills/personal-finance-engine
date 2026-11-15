import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { OneLedgerLogo } from "../../../components/brand/OneLedgerLogo";
import { createRateLimiter, clientIp } from "../../../lib/payment-requests/rate-limit";
import { isPaymentRequestsEnabled } from "../../../lib/payment-requests/public-view";
import { resolvePaymentRequestToken } from "../../../lib/payment-requests/resolve";

// Public payment-request page (/r/<token>). NON-CUSTODIAL: it shows who asked
// to be paid, how much and where - it never takes or verifies a payment, and
// nothing here changes a request's status. Dark unless PAYMENT_REQUESTS_ENABLED
// is "true". Per-IP rate limited; the 256-bit token is the real access control.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payment request",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// 30 page loads / minute / IP (per instance; resets on deploy).
const limited = createRateLimiter({ limit: 30, windowMs: 60_000 });

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-5 py-12">
      <OneLedgerLogo />
      <h1 className="text-xl font-semibold text-text-primary">Payment request</h1>
      {children}
      <p className="mt-auto text-xs text-text-muted">
        OneLedger does not process, hold or verify payments. This page only
        shows the details the sender entered, and opening it does not mean a
        payment was made. Always confirm the name and number with the sender
        before you pay.
      </p>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border-subtle py-2 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-right text-text-primary">{value}</span>
    </div>
  );
}

export default async function PaymentRequestPage(
  { params }: PageProps<"/r/[token]">,
) {
  if (
    !isPaymentRequestsEnabled({
      PAYMENT_REQUESTS_ENABLED: process.env.PAYMENT_REQUESTS_ENABLED,
    })
  ) notFound();

  const h = await headers();
  if (limited(clientIp(h.get("x-forwarded-for")))) {
    return (
      <Shell>
        <p className="text-sm text-text-secondary">
          Too many requests. Try again in a minute.
        </p>
      </Shell>
    );
  }

  const { token } = await params;
  const result = await resolvePaymentRequestToken(token);

  if (result.kind === "unavailable") {
    return (
      <Shell>
        <p className="rounded-card border border-border-subtle bg-surface p-4 text-sm text-text-secondary">
          This request can&apos;t be loaded right now. Please try again shortly.
        </p>
      </Shell>
    );
  }
  // A real 404 (not a friendly 200) for an unknown/mistyped/removed link.
  if (result.kind === "not_found") notFound();

  const v = result.view;
  const open = v.status === "open";
  return (
    <Shell>
      <p
        className={`rounded-card border p-4 text-sm ${
          open
            ? "border-border-subtle bg-surface text-text-secondary"
            : "border-attention/30 bg-attention-bg text-attention"
        }`}
      >
        {v.statusLabel}
      </p>
      <div className="rounded-card border border-border-subtle bg-surface p-4">
        <Field label="Amount" value={v.amountText} />
        <Field label="Requested by" value={v.recipientDisplay} />
        {v.reference ? <Field label="Reference" value={v.reference} /> : null}
        {v.destination
          ? (
            <Field
              label={v.destination.type === "momo_phone"
                ? "Mobile Money number"
                : "Merchant code"}
              value={v.destination.display}
            />
          )
          : null}
        <Field
          label={open ? "Valid until" : "Was valid until"}
          value={new Date(v.expiresAt).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Africa/Kigali",
          })}
        />
      </div>
      {open
        ? (
          <p className="rounded-card border border-attention/30 bg-attention-bg p-4 text-sm text-attention">
            Check that the name and number match what the sender told you.
            Never pay if anything looks different.
          </p>
        )
        : null}
    </Shell>
  );
}
