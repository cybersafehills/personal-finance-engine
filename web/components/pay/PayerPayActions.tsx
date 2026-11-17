"use client";

import { useState } from "react";

function CopyButton({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          // Clipboard blocked - the value is on screen to copy by hand.
        }
      }}
      className="min-h-11 rounded-control border border-border-strong px-3 text-sm font-medium text-text-primary"
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

/**
 * The payer's side of a payment request. Non-custodial: the button only opens
 * the payer's own dialer with the USSD pre-filled; they check the name on their
 * Mobile Money screen and approve with their own PIN. OneLedger never sees or
 * moves the money.
 */
export function PayerPayActions({
  route,
  numberText,
  amountText,
}: {
  route: { networkLabel: string; dial: string; telHref: string } | null;
  /** The number / code the payer would type by hand. */
  numberText: string;
  amountText: string;
}) {
  return (
    <section
      aria-label="Pay this request"
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
    >
      {route
        ? (
          <>
            <a
              href={route.telHref}
              data-testid="pay-button"
              className="inline-flex min-h-12 items-center justify-center rounded-control bg-accent px-5 text-base font-semibold text-accent-foreground"
            >
              Pay with {route.networkLabel}
            </a>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-text-secondary">
              <li>Tap the button. Your phone dialler opens, ready to go.</li>
              <li>Check the name on your Mobile Money screen.</li>
              <li>Enter your PIN to pay.</li>
            </ol>
            <p className="text-xs text-text-muted">
              On a computer? Open this page on your phone, or dial{" "}
              <code className="rounded bg-background px-1 py-0.5">{route.dial}</code>.
            </p>
          </>
        )
        : (
          <p className="text-sm text-text-secondary">
            Open your Mobile Money menu and send {amountText} to the number
            below.
          </p>
        )}
      <div className="flex flex-wrap gap-2">
        <CopyButton label="Copy number" value={numberText} />
        <CopyButton label="Copy amount" value={amountText.replace(/[^0-9]/g, "")} />
      </div>
    </section>
  );
}
