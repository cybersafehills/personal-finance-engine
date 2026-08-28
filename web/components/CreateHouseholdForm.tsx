"use client";

import { useState, useTransition } from "react";
import { createHousehold } from "../app/settings/workspace/actions";

export function CreateHouseholdForm() {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => createHousehold(name));
      }}
    >
      <div>
        <p className="text-sm font-medium text-text-primary">
          Start a household
        </p>
        <p className="mt-0.5 text-sm text-text-muted">
          Share a budget and financial picture with the people you live
          with. Each person keeps their own account and chooses what to
          share.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Household name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Niyoyo Household"
          required
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="min-h-11 self-start rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create household"}
      </button>
    </form>
  );
}
