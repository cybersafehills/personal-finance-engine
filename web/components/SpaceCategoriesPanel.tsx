"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addSpaceCategory,
  editSpaceCategory,
  setSpaceCategoryArchived,
  type SpaceCategoryActionResult,
} from "../app/categories/actions";
import { Badge } from "./Badge";
import type { SpaceCategory } from "../lib/queries";

export function SpaceCategoriesPanel({
  categories,
  canManage,
  scope,
}: {
  categories: SpaceCategory[];
  canManage: boolean;
  scope: "personal" | "space";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const run = (fn: () => Promise<SpaceCategoryActionResult>, onOk?: () => void) => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      onOk?.();
      router.refresh();
    });
  };

  const heading = scope === "personal" ? "Your categories" : "This Space’s categories";
  const blurb =
    scope === "personal"
      ? "Your own category names. They show up wherever you pick a category — correcting a transaction, adding one by hand, building a rule — and on the budget category map."
      : "Preferred category names for everyone here. They show up wherever a category is picked, and on the budget category map.";

  return (
    <section
      aria-label={scope === "personal" ? "Your categories" : "Space categories"}
      className="mb-6 rounded-card border border-border-subtle bg-surface p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {heading}
      </p>
      <p className="mt-1 mb-3 text-sm text-text-muted">{blurb}</p>

      {categories.length === 0 ? (
        <p className="text-sm text-text-muted">No custom categories yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {categories.map((c) => {
            const isEditing = editingKey === c.key;
            return (
              <li
                key={c.key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-background px-3 py-2"
              >
                {isEditing ? (
                  <form
                    className="flex flex-1 flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!editLabel.trim()) return;
                      run(
                        () => editSpaceCategory(c.key, editLabel, c.parentKey),
                        () => setEditingKey(null),
                      );
                    }}
                  >
                    <input
                      type="text"
                      autoFocus
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="min-h-9 flex-1 rounded-control border border-border-strong bg-surface px-2 py-1 text-sm text-text-primary"
                    />
                    <button
                      type="submit"
                      disabled={isPending || !editLabel.trim()}
                      className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setEditingKey(null)}
                      className="min-h-9 rounded-control px-2 text-xs font-medium text-text-muted hover:text-text-primary disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
                      {c.label}
                      {c.parentKey && (
                        <span className="text-xs text-text-muted">under {c.parentKey}</span>
                      )}
                      {c.isArchived && <Badge variant="attention">Archived</Badge>}
                    </span>
                    {canManage && (
                      <span className="flex items-center gap-3">
                        {!c.isArchived && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              setErrorMessage(null);
                              setEditLabel(c.label);
                              setEditingKey(c.key);
                            }}
                            className="text-xs font-medium text-text-muted hover:text-accent disabled:opacity-50"
                          >
                            Edit
                          </button>
                        )}
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
                      </span>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <>
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newLabel.trim()) return;
              run(() => addSpaceCategory(newLabel, null), () => setNewLabel(""));
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
          <p className="mt-1.5 text-xs text-text-muted">
            Renaming a category also updates every past transaction, rule and
            budget mapping that used the old name. Archiving hides it from the
            pickers but keeps it on transactions already tagged with it.
          </p>
        </>
      )}

      {errorMessage && (
        <p role="alert" className="mt-2 text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </section>
  );
}
