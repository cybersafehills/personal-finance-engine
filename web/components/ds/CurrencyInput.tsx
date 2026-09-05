"use client";

import { useId, useState } from "react";
import {
  minorUnitsPerMajor,
  type SupportedCurrency,
  toMinorUnits,
} from "../../lib/money";

// The money-entry primitive. OneLedger's canonical amount is **integer
// minor units + currency**; this control never does floating-point
// arithmetic on a ledger value. It keeps the user's raw text locally and
// reports `onValueChange(minorUnits | null)` - null while the text is
// empty or not yet a valid amount - by parsing the digits exactly via
// lib/money.ts `toMinorUnits`. The parent stores the minor-unit integer.
//
// Mobile: `inputMode` is "numeric" for zero-decimal currencies (RWF) and
// "decimal" otherwise, so the phone shows the right keypad. The 16px
// computed-font floor that stops iOS Safari focus-zoom is enforced
// globally in app/globals.css for every <input>; this control does not
// need its own font-size override, and must not set text-sm.
//
// Compose it inside <Field> for the label / help / error / a11y wiring:
//
//   <Field label="Amount" error={err}>
//     {(p) => (
//       <CurrencyInput
//         {...p}
//         currency="RWF"
//         valueMinor={amount}
//         onValueChange={setAmount}
//       />
//     )}
//   </Field>

function formatInitial(
  valueMinor: number | null,
  currency: SupportedCurrency,
): string {
  if (valueMinor == null) return "";
  const per = minorUnitsPerMajor(currency);
  if (per === 1) return String(valueMinor);
  const major = valueMinor / per;
  return major.toFixed(Math.log10(per));
}

export function CurrencyInput({
  id,
  currency,
  valueMinor,
  onValueChange,
  placeholder,
  disabled = false,
  className,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: {
  id?: string;
  currency: SupportedCurrency;
  /** Current amount in integer minor units, or null when unset. */
  valueMinor: number | null;
  onValueChange: (minorUnits: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}) {
  const fallbackId = useId();
  const [text, setText] = useState(() => formatInitial(valueMinor, currency));
  const zeroDecimal = minorUnitsPerMajor(currency) === 1;

  function handleChange(next: string) {
    setText(next);
    const trimmed = next.trim();
    if (trimmed === "") {
      onValueChange(null);
      return;
    }
    try {
      onValueChange(Number(toMinorUnits(trimmed, currency)));
    } catch {
      onValueChange(null);
    }
  }

  return (
    <span className="relative flex items-center">
      <span
        className="pointer-events-none absolute left-3 text-sm text-text-muted"
        aria-hidden="true"
      >
        {currency}
      </span>
      <input
        id={id ?? fallbackId}
        type="text"
        inputMode={zeroDecimal ? "numeric" : "decimal"}
        autoComplete="off"
        enterKeyHint="done"
        value={text}
        disabled={disabled}
        placeholder={placeholder ?? (zeroDecimal ? "0" : "0.00")}
        onChange={(e) => handleChange(e.target.value)}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired}
        className={`min-h-11 w-full rounded-control border border-border-strong bg-surface py-2 pl-14 pr-3 text-text-primary tabular-nums transition-colors focus:border-accent disabled:opacity-50 ${
          className ?? ""
        }`}
      />
    </span>
  );
}
