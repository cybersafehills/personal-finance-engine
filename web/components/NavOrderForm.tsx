"use client";

import { useState, useTransition } from "react";
import { saveNavOrder } from "../app/settings/appearance/actions";
import { ChevronDownIcon, ChevronUpIcon } from "./icons";
import {
  DEFAULT_NAV_ORDER,
  NAV_ITEM_META,
  type NavKey,
} from "../lib/navigation";

function arraysEqual(a: NavKey[], b: NavKey[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function NavOrderForm({ initialOrder }: { initialOrder: NavKey[] }) {
  const [order, setOrder] = useState<NavKey[]>(initialOrder);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const isDefault = arraysEqual(order, DEFAULT_NAV_ORDER);

  function move(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= order.length) return;
    const next = [...order];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setOrder(next);
    setSavedAt(null);
    setAnnouncement(
      `${NAV_ITEM_META[next[targetIndex]].label} moved to position ${targetIndex + 2} of ${next.length + 1}.`,
    );
  }

  function save(nextOrder: NavKey[]) {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await saveNavOrder(nextOrder);
      if (result.ok) {
        setSavedAt(Date.now());
      } else {
        setErrorMessage(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-subtle bg-surface p-4">
      <div>
        <p className="text-sm font-medium text-text-primary">Arrange navigation</p>
        <p className="mt-0.5 text-sm text-text-muted">
          Choose the order of your primary navigation. Home always stays first. This
          order applies on every device you sign in on.
        </p>
      </div>

      <ol className="flex flex-col gap-2">
        <li className="flex items-center gap-3 rounded-control border border-border-subtle bg-background px-3 py-2.5 text-sm">
          <span className="flex-1 font-medium text-text-secondary">Home</span>
          <span className="text-xs text-text-muted">Fixed</span>
        </li>
        {order.map((key, index) => (
          <li
            key={key}
            className="flex items-center gap-3 rounded-control border border-border-subtle px-3 py-2.5 text-sm"
          >
            <span className="flex-1 font-medium text-text-primary">
              {NAV_ITEM_META[key].label}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${NAV_ITEM_META[key].label} up`}
                className="flex h-9 w-9 items-center justify-center rounded-control text-text-secondary transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronUpIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === order.length - 1}
                aria-label={`Move ${NAV_ITEM_META[key].label} down`}
                className="flex h-9 w-9 items-center justify-center rounded-control text-text-secondary transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronDownIcon className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ol>

      {/* Announces reorders to screen-reader users without stealing focus - the Move up/down buttons themselves are the accessible reordering mechanism (no drag-and-drop-only path). */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Preview
        </p>
        <div aria-label="Navigation order preview" className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            Home
          </span>
          {order.map((key) => (
            <span
              key={key}
              className="rounded-full border border-border-subtle px-3 py-1 text-xs font-medium text-text-secondary"
            >
              {NAV_ITEM_META[key].label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
        <button
          type="button"
          onClick={() => save(order)}
          disabled={isPending}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save order"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOrder(DEFAULT_NAV_ORDER);
            save(DEFAULT_NAV_ORDER);
          }}
          disabled={isPending || isDefault}
          className="min-h-11 rounded-control border border-border-strong px-4 text-sm font-medium text-text-secondary disabled:opacity-50"
        >
          Restore default order
        </button>
        {savedAt && !isPending && !errorMessage && (
          <span className="text-sm text-money-positive">Saved</span>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
