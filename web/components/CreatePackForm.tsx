"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createStatementPackAction } from "../app/reports/statements/actions";

type ReadyStatement = { id: string; label: string };

export function CreatePackForm(
  { statements }: { statements: ReadyStatement[] },
) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; packId: string } | null>(null);
  const [isBuilding, start] = useTransition();

  function toggle(id: string) {
    setError(null);
    setDone(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function build() {
    setError(null);
    if (picked.size < 1) {
      setError("Pick at least one statement.");
      return;
    }
    start(async () => {
      const result = await createStatementPackAction([...picked], title.trim());
      if (result.ok) {
        setDone({ id: result.id, packId: result.packId });
        setPicked(new Set());
        setTitle("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (statements.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        Generate at least one statement first, then bundle several into a pack.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {error && (
        <p
          role="alert"
          className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-attention"
        >
          {error}
        </p>
      )}
      {done && (
        <p className="rounded-control border border-border-subtle bg-background px-3 py-2 text-text-secondary">
          Pack {done.packId} is ready.{" "}
          <a
            href={`/api/reports/statements/packs/${done.id}`}
            className="font-medium text-accent"
          >
            Download ZIP
          </a>
        </p>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium text-text-primary">
          Statements to include
        </legend>
        {statements.map((s) => (
          <label key={s.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={picked.has(s.id)}
              onChange={() =>
                toggle(s.id)}
            />
            <span>{s.label}</span>
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="font-medium text-text-primary">
          Title <span className="font-normal text-text-muted">(optional)</span>
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="e.g. 2026 visa application"
          className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary"
        />
      </label>

      <div>
        <button
          type="button"
          onClick={build}
          disabled={isBuilding || picked.size === 0}
          className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {isBuilding
            ? "Building pack…"
            : `Bundle ${picked.size || ""} into a pack`}
        </button>
      </div>
    </div>
  );
}
