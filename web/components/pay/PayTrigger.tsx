"use client";

import { usePay } from "./PayProvider";
import { messages } from "../../lib/ussd/messages";
import { PayIcon } from "../icons";

const label = messages().pay.action;

/**
 * The persistent global Pay action. Two renderings, one behaviour
 * (opens the launcher via PayProvider context - never executes a
 * payment):
 *
 *  - "desktop": a labelled pill button that sits in the app header next
 *    to the Reports icon.
 *  - "mobile": an elevated circular action with a visible "Pay" label,
 *    designed to nest in the centre of the fixed bottom navigation.
 *
 * Both meet the 44px min touch target, carry a real text label (never
 * icon-only), use brand tokens, and have a restrained pressed state (no
 * pulsing/animation loop).
 */
export function PayTrigger({ variant }: { variant: "desktop" | "mobile" }) {
  const { enabled, open, openPay } = usePay();
  if (!enabled) return null;

  if (variant === "desktop") {
    return (
      <button
        type="button"
        onClick={openPay}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="hidden shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:opacity-90 active:opacity-80 lg:inline-flex"
      >
        <PayIcon className="h-4 w-4" />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openPay}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={label}
      className="flex min-w-16 flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-semibold text-accent"
    >
      <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full border-4 border-surface bg-accent text-accent-foreground shadow-md transition-transform active:scale-95">
        <PayIcon className="h-6 w-6" />
      </span>
      <span>{label}</span>
    </button>
  );
}
