"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addSpaceCategory,
  setSpaceCategoryArchived,
  type SpaceCategoryActionResult,
} from "../app/categories/actions";
import { Badge } from "./Badge";
import type { SpaceCategory } from "../lib/queries";

export function SpaceCategoriesPanel({
  categories,
  canManage,
}: {
  categories: SpaceCategory[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");

  const run = (fn: () => Promise<SpaceCategoryActionResult>) => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      setNewLabel("");
      router.refresh();
    });
  };

  return (
    <section
      aria-label="Space categories"
      className="mb-6 rounded-card border border-border-subtle bg-surface p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        This Space&rsquo;s categories
      </p>
      <p className="mt-1 mb-3 text-sm text-text-muted">
        Preferred category names for everyone here. They show up as
        suggestions when someone corrects a transaction — the platform
        categories still work too.
      </p>

      {categories.length === 0 ? (
        <p className="text-sm text-text-muted">No custom categories yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {categories.map((c) => (
            <li
              key={c.key}
              className="flex items-center justify-between gap-3 rounded-control bg-background px-3 py-2"
            >
              <span className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
                {c.label}
                {c.parentKey && (
                  <span className="text-xs text-text-muted">
                    under {c.parentKey}
                  </span>
                )}
                {c.isArchived && <Badge variant="attention">Archived</Badge>}
              </span>
              {canManage && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    run(() => setSpaceCategoryArchived(c.key, !c.isArchived))
                  }
                  className="text-xs font-medium text-text-muted hover:text-accent disabled:opacity-50"
                >
                  {c.isArchived ? "Restore" : "Archive"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newLabel.trim()) return;
            run(() => addSpaceCategory(newLabel, null));
          }}
        >
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Add a category, e.g. Weekend food"
            className="min-h-9 flex-1 rounded-control border border-border-strong bg-background px-2 py-1 text-sm text-text-primary"
          />
          <button
            type="submit"
            disabled={isPending || !newLabel.trim()}
            className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}

      {errorMessage && (
        <p role="alert" className="mt-2 text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </section>
  );
}
