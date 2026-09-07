"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteStatementPackAction } from "../app/reports/statements/actions";

export function StatementPackDelete({ packUuid }: { packUuid: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!globalThis.confirm("Delete this pack?")) return;
        start(async () => {
          await deleteStatementPackAction(packUuid);
          router.refresh();
        });
      }}
      className="text-xs font-medium text-attention disabled:opacity-50"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}
