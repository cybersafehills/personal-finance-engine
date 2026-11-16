"use client";

import { useId, useState, useTransition } from "react";
import { recordBalanceAction } from "../../app/wallets/actions";

/**
 * "I checked my balance" for one wallet. Collapsed to a single button until
 * asked for; the amount is typed as text and parsed exactly on the server
 * (no number input, so nothing is rounded by the browser).
 */
export function RecordBalanceForm({
  accountId,
  walletName,
  currency,
  wholeUnitsOnly,
}: {
  accountId: string;
  walletName: string;
  currency: string;
  wholeUnitsOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const amountId = useId();
  const noteId = useId();
  const errorId = useId();

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
          className="min-h-11 rounded-control border border-border-subtle bg-background px-4 py-2.5 text-sm font-medium text-text-primary"
        >
          I checked my balance
          <span className="sr-only">{" "}for {walletName}</span>
        </button>
        {saved && (
          <p role="status" className="text-sm text-text-secondary">
            Saved. It is shown as an estimate, because only your provider can
            confirm a balance.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-control bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await recordBalanceAction({
            accountId,
            amountText: amount,
            note,
          });
          if (result.ok) {
            setAmount("");
            setNote("");
            setSaved(true);
            setOpen(false);
          } else {
            setError(result.error);
          }
        });
      }}
    >
      <p className="text-sm text-text-secondary">
        Enter the balance your provider shows for {walletName}{" "}
        right now. This is recorded as your own statement, with the time, and
        can’t be edited afterwards — enter a new one to correct it.
      </p>
      <label htmlFor={amountId} className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
        Balance ({currency})
        <input
          id={amountId}
          type="text"
          inputMode={wholeUnitsOnly ? "numeric" : "decimal"}
          autoComplete="off"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder={wholeUnitsOnly ? "78,900" : "78,900.50"}
          className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 py-2 text-base tabular-nums text-text-primary"
        />
      </label>
      <label htmlFor={noteId} className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
        Note (optional)
        <input
          id={noteId}
          type="text"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 py-2 text-base text-text-primary"
        />
      </label>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-attention">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save balance"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            setOpen(false);
          }}
          className="min-h-11 rounded-control px-4 py-2.5 text-sm font-medium text-text-secondary"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
