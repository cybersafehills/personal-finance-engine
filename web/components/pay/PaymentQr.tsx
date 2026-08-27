"use client";

import { useMemo } from "react";
import { encodeQr, qrToSvg } from "../../lib/pay/qr";

/**
 * A scannable representation of a `tel:` / USSD route for the
 * desktop -> phone hand-off. The SVG is generated locally (no network,
 * CSP-safe) and inherits the surrounding text colour so it works in
 * light and dark themes. The encoded string carries a phone number and
 * amount (not secrets); a PIN never appears in it.
 */
export function PaymentQr({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const svg = useMemo(() => {
    try {
      return qrToSvg(encodeQr(value, "M"), { sizePx: 220 });
    } catch {
      return null;
    }
  }, [value]);

  if (!svg) {
    return (
      <p className="text-xs text-text-muted">
        This route is too long to show as a QR. Copy the code instead.
      </p>
    );
  }

  return (
    <figure className="flex flex-col items-center gap-2">
      <div
        role="img"
        aria-label={label}
        className="rounded-card border border-border-subtle bg-surface p-3 text-text-primary"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption className="max-w-56 text-center text-xs text-text-muted">
        {label}
      </figcaption>
    </figure>
  );
}
