"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeCategoryMapping, setCategoryMapping } from "../app/budgets/categories/actions";
import { ALLOCATION_TYPES, AllocationType } from "../lib/budget-math";
import { formatRwf } from "../lib/format";
import type { CategoryMappingRow } from "../lib/queries";

const ALLOCATION_LABELS: Record<AllocationType, string> = {
  ESSENTIALS: "Essentials",
  INVESTING: "Investing",
  EMERGENCY: "Emergency savings",
  WANTS: "Wants",
};

export function CategoryMappingItem({ row }: { row: CategoryMappingRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleChange(value: string) {
    setErrorMessage(null);
    startTransition(async () => {
      const result = value === ""
        ? await removeCategoryMapping(row.category)
        : await setCategoryMapping(row.category, value);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-primary">{row.category}</span>
        <span className="text-xs text-text-muted">
          {row.transactionCount} transaction{row.transactionCount === 1 ? "" : "s"} · {formatRwf(row.totalRwf)}
        </span>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Allocation</span>
        <select
          value={row.allocationType ?? ""}
          disabled={isPending}
          onChange={(e) => handleChange(e.target.value)}
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary disabled:opacity-50"
        >
          <option value="">Unmapped</option>
          {ALLOCATION_TYPES.map((type) => (
            <option key={type} value={type}>{ALLOCATION_LABELS[type]}</option>
          ))}
        </select>
      </label>

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">{errorMessage}</p>
      )}
    </div>
  );
}
