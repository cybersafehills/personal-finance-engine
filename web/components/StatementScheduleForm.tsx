"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteStatementScheduleAction,
  saveStatementScheduleAction,
} from "../app/reports/statements/actions";

type SourceOption = { id: string; label: string };
type Cadence = "weekly" | "monthly" | "quarterly";
type Schedule = {
  id: string;
  statement_type: "standard" | "detailed";
  account_ids: string[];
  cadence: Cadence;
  day_of_month: number;
  day_of_week: number | null;
  next_run_at: string;
};

const DOW = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const inputClass =
  "min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary";

export function StatementScheduleForm({
  sources,
  defaultTimezone,
  schedules,
}: {
  sources: SourceOption[];
  defaultTimezone: string;
  schedules: Schedule[];
}) {
  const router = useRouter();
  const [sourceMode, setSourceMode] = useState<"all" | "one">("all");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [statementType, setStatementType] = useState<"standard" | "detailed">(
    "standard",
  );
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [deliveryEmail, setDeliveryEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  function save() {
    setError(null);
    startSave(async () => {
      const result = await saveStatementScheduleAction({
        statementType,
        sourceIds: sourceMode === "one" && sourceId ? [sourceId] : [],
        cadence,
        dayOfMonth,
        dayOfWeek: cadence === "weekly" ? dayOfWeek : null,
        timezone: defaultTimezone,
        deliveryEmail: deliveryEmail.trim() || undefined,
      });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      {error && (
        <p
          role="alert"
          className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-attention"
        >
          {error}
        </p>
      )}

      {schedules.length > 0 && (
        <ul className="flex flex-col gap-2">
          {schedules.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-control border border-border-subtle bg-background px-3 py-2"
            >
              <span className="text-text-primary">
                {s.cadence === "weekly"
                  ? `Last week's `
                  : s.cadence === "quarterly"
                  ? `Last quarter's `
                  : `Last month's `}
                {s.statement_type === "detailed" ? "detailed " : ""}statement,
                {" "}
                {s.account_ids.length === 1 ? "one account" : "all accounts"},
                {" "}
                {s.cadence === "weekly"
                  ? `every ${DOW[s.day_of_week ?? 1]}`
                  : `on day ${s.day_of_month}`}
              </span>
              <span className="text-xs text-text-muted">
                next {new Date(s.next_run_at).toISOString().slice(0, 10)}
              </span>
              <button
                type="button"
                disabled={deleting}
                onClick={() =>
                  startDelete(async () => {
                    await deleteStatementScheduleAction(s.id);
                    router.refresh();
                  })}
                className="ml-auto text-xs font-medium text-attention disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
        <p className="font-medium text-text-primary">Add a schedule</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Account</legend>
          {sources.length > 0 && (
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="scheduleSource"
                checked={sourceMode === "all"}
                onChange={() => setSourceMode("all")}
              />
              All accounts
            </label>
          )}
          <label className="flex flex-wrap items-center gap-2">
            {sources.length > 0 && (
              <input
                type="radio"
                name="scheduleSource"
                checked={sourceMode === "one"}
                onChange={() => setSourceMode("one")}
              />
            )}
            <span>
              {sources.length === 0 ? "All accounts" : "One account:"}
            </span>
            {sources.length > 0 && (
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                disabled={sourceMode !== "one"}
                className={`${inputClass} disabled:opacity-50`}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            )}
          </label>
        </fieldset>

        <label className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-text-primary">Type</span>
          <select
            value={statementType}
            onChange={(e) =>
              setStatementType(e.target.value as "standard" | "detailed")}
            className={inputClass}
          >
            <option value="standard">Standard</option>
            <option value="detailed">Detailed OneLedger</option>
          </select>
        </label>

        <label className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-text-primary">Frequency</span>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as Cadence)}
            className={inputClass}
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
          </select>
        </label>

        {cadence === "weekly"
          ? (
            <label className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-text-primary">Day of week</span>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                className={inputClass}
              >
                {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
          )
          : (
            <label className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-text-primary">
                Day of month
              </span>
              <select
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                className={inputClass}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </label>
          )}

        <label className="flex flex-col gap-1">
          <span className="font-medium text-text-primary">
            Email me a link{" "}
            <span className="font-normal text-text-muted">
              (optional — no figures, just a link)
            </span>
          </span>
          <input
            type="email"
            value={deliveryEmail}
            onChange={(e) => setDeliveryEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
        </label>

        <p className="text-xs text-text-muted">
          {cadence === "weekly"
            ? `Every ${DOW[dayOfWeek]}, last week's statement`
            : cadence === "quarterly"
            ? `On day ${dayOfMonth} of each quarter, last quarter's statement`
            : `On day ${dayOfMonth} of every month, last month's statement`}
          {" "}
          is generated and appears in your history.
        </p>

        <div>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="min-h-11 rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
