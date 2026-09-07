"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type AccountOption = { sourceId: string; label: string };

const DIRECTIONS = [
  { value: "", label: "Any" },
  { value: "out", label: "Money out" },
  { value: "in", label: "Money in" },
  { value: "neutral", label: "Neutral" },
] as const;

/**
 * Search + filter row for the transactions ledger. Every control is
 * URL-driven (?q, ?direction, ?currency, ?account, ?min, ?max) so the
 * server component re-queries and deep links stay shareable. The `?category`
 * param set elsewhere is preserved.
 */
export function TransactionSearchBar({
  accounts,
  currencies,
}: {
  accounts: AccountOption[];
  currencies: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [text, setText] = useState(params.get("q") ?? "");
  const [open, setOpen] = useState(
    Boolean(
      params.get("direction") ||
        params.get("currency") ||
        params.get("account") ||
        params.get("min") ||
        params.get("max"),
    ),
  );
  const firstRender = useRef(true);

  // Push the debounced text box into the URL without stacking history entries.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const handle = setTimeout(() => {
      setParam("q", text.trim() || null);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.toString() ? `${pathname}?${next}` : pathname, {
      scroll: false,
    });
  }

  const hasAnyFilter = Boolean(
    params.get("q") ||
      params.get("direction") ||
      params.get("currency") ||
      params.get("account") ||
      params.get("min") ||
      params.get("max"),
  );

  const selectClass =
    "min-h-11 rounded-control border border-border-strong bg-background px-2 py-2 text-sm text-text-primary";

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by name, reference or category"
          aria-label="Search transactions"
          className="min-h-11 flex-1 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-h-11 shrink-0 rounded-control border border-border-strong px-3 text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          Filters
        </button>
      </div>

      {open && (
        <div className="grid grid-cols-2 gap-2 rounded-card border border-border-subtle bg-surface p-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Direction
            <select
              value={params.get("direction") ?? ""}
              onChange={(e) => setParam("direction", e.target.value || null)}
              className={selectClass}
            >
              {DIRECTIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Account
            <select
              value={params.get("account") ?? ""}
              onChange={(e) => setParam("account", e.target.value || null)}
              className={selectClass}
            >
              <option value="">Any account</option>
              {accounts.map((a) => (
                <option key={a.sourceId} value={a.sourceId}>{a.label}</option>
              ))}
            </select>
          </label>

          {currencies.length > 1 && (
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Currency
              <select
                value={params.get("currency") ?? ""}
                onChange={(e) => setParam("currency", e.target.value || null)}
                className={selectClass}
              >
                <option value="">Any</option>
                {currencies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Min amount (RWF)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              defaultValue={params.get("min") ?? ""}
              onBlur={(e) => setParam("min", e.target.value.trim() || null)}
              className={selectClass}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Max amount (RWF)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              defaultValue={params.get("max") ?? ""}
              onBlur={(e) => setParam("max", e.target.value.trim() || null)}
              className={selectClass}
            />
          </label>
        </div>
      )}

      {hasAnyFilter && (
        <button
          type="button"
          onClick={() => {
            setText("");
            const next = new URLSearchParams(params.toString());
            for (const k of ["q", "direction", "currency", "account", "min", "max"]) {
              next.delete(k);
            }
            router.replace(
              next.toString() ? `${pathname}?${next}` : pathname,
              { scroll: false },
            );
          }}
          className="self-start text-xs font-medium text-accent hover:underline"
        >
          Clear search & filters
        </button>
      )}
    </div>
  );
}
