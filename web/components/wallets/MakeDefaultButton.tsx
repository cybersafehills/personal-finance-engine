"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setDefaultWalletAction } from "../../app/wallets/actions";

/** "Show this wallet first on Home." Only the owner can change it; the error says so. */
export function MakeDefaultButton({ accountId, walletName }: { accountId: string; walletName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await setDefaultWalletAction(accountId);
            if (!res.ok) setError(res.error);
            else router.refresh();
          });
        }}
        className="min-h-11 text-sm font-medium text-accent hover:underline disabled:opacity-60"
      >
        {pending ? "Saving…" : "Make default"}
        <span className="sr-only">{" "}{walletName} on Home</span>
      </button>
      {error ? <span role="alert" className="text-xs text-attention">{error}</span> : null}
    </span>
  );
}
