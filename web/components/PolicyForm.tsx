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

// ISO day-of-week: 1 = Monday … 7 = Sunday (matches the DB / engine).
const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const;

const TRANSACTION_TYPE_OPTIONS = [
  { value: "send_money", label: "Send money" },
  { value: "merchant_payment", label: "Merchant payment" },
  { value: "money_received", label: "Money received" },
  { value: "airtime", label: "Airtime" },
  { value: "cash_withdrawal", label: "Cash withdrawal" },
  { value: "cash_deposit", label: "Cash deposit" },
  { value: "bill_payment", label: "Bill payment" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "refund", label: "Refund" },
  { value: "reversal", label: "Reversal" },
  { value: "other", label: "Other" },
] as const;

const INPUT_CLASS =
  "min-h-11 rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-text-primary";

export function PolicyForm(
  { mode, policy, template, sources = [] }: {
    mode: "create" | "edit";
    policy?: CategorizationPolicyRow;
    /** Pre-fills defaults on a fresh create form; ignored in edit mode. Nothing is saved until the user submits. */
    template?: PolicyTemplate;
    /** The caller's financial sources, for the "applies to one account" option. */
    sources?: Array<{ id: string; label: string }>;
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
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(policy?.days_of_week ?? []);
  const [daysOfMonth, setDaysOfMonth] = useState(
    policy?.days_of_month?.join(", ") ?? "",
  );
  const [transactionTypes, setTransactionTypes] = useState<string[]>(
    policy?.transaction_types ?? [],
  );
  const [feeMin, setFeeMin] = useState(policy?.fee_min_rwf?.toString() ?? "");
  const [feeMax, setFeeMax] = useState(policy?.fee_max_rwf?.toString() ?? "");
  const [amountRoundMultiple, setAmountRoundMultiple] = useState(
    policy?.amount_round_multiple?.toString() ?? "",
  );
  const [priority, setPriority] = useState(policy?.priority?.toString() ?? "100");
  const [scopeType, setScopeType] = useState<"space" | "source">(
    policy?.scope_type ?? "space",
  );
  const [scopeSourceId, setScopeSourceId] = useState(
    policy?.scope_source_id ?? sources[0]?.id ?? "",
  );

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
          daysOfWeek: daysOfWeek.join(","),
          daysOfMonth,
          transactionTypes,
          feeMin,
          feeMax,
          amountRoundMultiple,
          priority,
          scopeType,
          scopeSourceId,
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

      {sources.length > 0 && (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium text-text-secondary">Applies to</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope-type"
              checked={scopeType === "space"}
              onChange={() => setScopeType("space")}
            />
            <span className="text-text-primary">
              Every account in this Space
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope-type"
              checked={scopeType === "source"}
              onChange={() => setScopeType("source")}
            />
            <span className="text-text-primary">One account only</span>
          </label>
          {scopeType === "source" && (
            <select
              value={scopeSourceId}
              onChange={(e) => setScopeSourceId(e.target.value)}
              aria-label="Account this rule applies to"
              className={`${INPUT_CLASS} mt-1`}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          )}
          <span className="text-xs text-text-muted">
            An account-only rule outranks a Space-wide one at the same
            priority — but priority still comes first.
          </span>
        </fieldset>
      )}

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
          <span className="text-xs text-text-muted">
            Matches the transaction&apos;s recipient/sender name — not the amount or currency.
            Leave blank to match on direction, amount, or time alone.
          </span>
          {merchantPattern.trim().toLowerCase() === "rwf" && (
            <span role="alert" className="text-xs text-attention">
              &ldquo;RWF&rdquo; won&apos;t match any real counterparty name — transaction names
              don&apos;t contain the currency. Leave this blank if you meant to filter by amount
              only (set that below).
            </span>
          )}
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

      <div>
        <span className="text-sm font-medium text-text-secondary">Days of the week (optional)</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => {
            const on = daysOfWeek.includes(d.value);
            return (
              <button
                key={d.value}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setDaysOfWeek((prev) =>
                    prev.includes(d.value)
                      ? prev.filter((x) => x !== d.value)
                      : [...prev, d.value].sort((a, b) => a - b),
                  )
                }
                className={`min-h-9 rounded-control px-3 text-sm font-medium transition-colors ${
                  on
                    ? "bg-accent text-accent-foreground"
                    : "border border-border-strong text-text-secondary"
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
        <span className="mt-1 block text-xs text-text-muted">
          Leave all unselected to match any day.
        </span>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Days of the month (optional)</span>
        <input
          type="text"
          inputMode="numeric"
          value={daysOfMonth}
          onChange={(e) => setDaysOfMonth(e.target.value)}
          placeholder="e.g. 1, 15, 28"
          className={INPUT_CLASS}
        />
      </label>

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="font-medium text-text-secondary">
          Transaction type (optional)
        </legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {TRANSACTION_TYPE_OPTIONS.map((o) => {
            const on = transactionTypes.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setTransactionTypes((prev) =>
                    prev.includes(o.value)
                      ? prev.filter((x) => x !== o.value)
                      : [...prev, o.value],
                  )
                }
                className={`min-h-9 rounded-control px-3 text-xs font-medium transition-colors ${
                  on
                    ? "bg-accent text-accent-foreground"
                    : "border border-border-strong text-text-secondary"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Min fee (RWF, optional)</span>
          <input
            type="text"
            inputMode="numeric"
            value={feeMin}
            onChange={(e) => setFeeMin(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-secondary">Max fee (RWF, optional)</span>
          <input
            type="text"
            inputMode="numeric"
            value={feeMax}
            onChange={(e) => setFeeMax(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-text-secondary">Round-number amount (optional)</span>
        <select
          value={amountRoundMultiple}
          onChange={(e) => setAmountRoundMultiple(e.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">Off</option>
          <option value="100">Exact multiples of 100</option>
          <option value="1000">Exact multiples of 1,000</option>
        </select>
        <span className="text-xs text-text-muted">
          Matches only amounts with no remainder — often a personal transfer
          rather than a merchant bill.
        </span>
      </label>

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
