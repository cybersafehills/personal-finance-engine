"use client";

import { useState, useTransition } from "react";
import { createOrganization } from "../app/settings/workspace/actions";

export function CreateOrganizationForm() {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(() => createOrganization(name));
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">
          Organization name
        </span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Dolton & Co"
          required
          className="min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="min-h-11 self-start rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}
