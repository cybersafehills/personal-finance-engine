"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertPolicy } from "../app/categories/rules/actions";
import type { CategorizationPolicyRow } from "../lib/queries";
import type { PolicyTemplate } from "../lib/policy-templates";

const MATCH_TYPE_OPTIONS = [
  { value: "contains", label: "Contains" },
  { value: "exact", label: "Exactly matches" },
  { value: "starts_with", label: "Starts with" },
  { value: "regex", label: "Regex" },
] as const;

const DIRECTION_OPTIONS = [
  { value: "", label: "Any" },
  { value: "out", label: "Money out" },
  { value: "in", label: "Money in" },
  { value: "neutral", label: "Neutral" },
] as const;

const INPUT_CLASS =
  "min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary";

export function PolicyForm(
  { mode, policy, template }: {
    mode: "create" | "edit";
    policy?: CategorizationPolicyRow;
    /** Pre-fills defaults on a fresh create form; ignored in edit mode. Nothing is saved until the user submits. */
    template?: PolicyTemplate;
  },
) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [name, setName] = useState(policy?.name ?? template?.defaults.name ?? "");
  const [description, setDescription] = useState(policy?.description ?? "");
  const [category, setCategory] = useState(policy?.category ?? template?.defaults.category ?? "");
  const [subcategory, setSubcategory] = useState(
    policy?.subcategory ?? template?.defaults.subcategory ?? "",
  );
  const [matchType, setMatchType] = useState(
    policy?.match_type ?? (template?.defaults.merchantPattern ? "exact" : "contains"),
  );
  const [merchantPattern, setMerchantPattern] = useState(
    policy?.merchant_pattern ?? template?.defaults.merchantPattern ?? "",
  );
  const [direction, setDirection] = useState(policy?.direction ?? template?.defaults.direction ?? "");
  const [amountMin, setAmountMin] = useState(policy?.amount_min_rwf?.toString() ?? "");
  const [amountMax, setAmountMax] = useState(policy?.amount_max_rwf?.toString() ?? "");
  const [timeStart, setTimeStart] = useState(policy?.time_start?.slice(0, 5) ?? "");
  const [timeEnd, setTimeEnd] = useState(policy?.time_end?.slice(0, 5) ?? "");
  const [priority, setPriority] = useState(policy?.priority?.toString() ?? "100");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    startTransition(async () => {
      const result = await upsertPolicy(
        {
          name,
          description,
          category,
          subcategory,
          matchType,
          merchantPattern,
          direction,
          amountMin,
          amountMax,
          timeStart,
          timeEnd,
          priority,
        },
        policy?.id,
      );
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      router.push("/categories/rules");
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Name (optional)</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Morning commute"
          className={INPUT_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Description (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className={INPUT_CLASS}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Category</span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            placeholder="e.g. Transport"
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Subcategory (optional)</span>
          <input
            type="text"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            placeholder="e.g. Moto"
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        Conditions
      </p>

      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Match type</span>
          <select
            value={matchType}
            onChange={(e) => setMatchType(e.target.value)}
            className={INPUT_CLASS}
          >
            {MATCH_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Counterparty (optional)</span>
          <input
            type="text"
            value={merchantPattern}
            onChange={(e) => setMerchantPattern(e.target.value)}
            placeholder="e.g. James KAYIJE"
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <div>
        <span className="text-sm font-medium text-text-secondary">Direction</span>
        <div className="mt-1 flex gap-2 rounded-control bg-background p-1 text-sm">
          {DIRECTION_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setDirection(o.value)}
              className={`flex-1 rounded-control py-1.5 font-medium transition-colors ${
                direction === o.value
                  ? "bg-surface text-text-primary shadow-sm"
                  : "text-text-muted"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Min amount (RWF, optional)</span>
          <input
            type="text"
            inputMode="numeric"
            value={amountMin}
            onChange={(e) => setAmountMin(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Max amount (RWF, optional)</span>
          <input
            type="text"
            inputMode="numeric"
            value={amountMax}
            onChange={(e) => setAmountMax(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Start time (optional)</span>
          <input
            type="time"
            value={timeStart}
            onChange={(e) => setTimeStart(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">End time (optional)</span>
          <input
            type="time"
            value={timeEnd}
            onChange={(e) => setTimeEnd(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Priority</span>
        <input
          type="text"
          inputMode="numeric"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className={INPUT_CLASS}
        />
        <span className="text-xs text-text-muted">
          Lower numbers are checked first — corrections you save from a transaction use priority 10.
        </span>
      </label>

      {errorMessage && (
        <p role="alert" className="text-sm text-attention">{errorMessage}</p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Saving…" : mode === "create" ? "Create rule" : "Save changes"}
      </button>
    </form>
  );
}
