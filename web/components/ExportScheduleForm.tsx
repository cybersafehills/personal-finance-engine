"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExportSchedule } from "../app/integrations/exports/actions";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ExportScheduleForm({
  destinations = [],
}: {
  destinations?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [preset, setPreset] = useState("previous_month");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("monthly");
  const [hour, setHour] = useState(6);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  function submit() {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await createExportSchedule({
        name,
        config: { format, period: { kind: "relative", preset } },
        cadence,
        hour,
        dayOfWeek: cadence === "weekly" ? dayOfWeek : null,
        dayOfMonth: cadence === "monthly" ? dayOfMonth : null,
        offsetMinutes: 0,
        destinationId: destinationId || null,
      });
      if (result.ok) {
        setNotice(`Scheduled "${name.trim()}".`);
        setName("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const field =
    "min-h-11 rounded-control border border-border-subtle bg-surface px-3 text-base text-text-primary";

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4">
      {error && (
        <p role="alert" className="rounded-control border border-attention/30 bg-attention-bg px-3 py-2 text-sm text-attention">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-control border border-border-subtle bg-background px-3 py-2 text-sm text-text-secondary">
          {notice}
        </p>
      )}

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Schedule name (e.g. Monthly accountant export)"
        maxLength={80}
        className={field}
      />

      {destinations.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-primary">Deliver to</span>
          <select
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
            className={field}
          >
            <option value="">Download only (export history)</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-primary">Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as "xlsx" | "csv")} className={field}>
            <option value="xlsx">Excel workbook</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-primary">Covers</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} className={field}>
            <option value="previous_month">Last month</option>
            <option value="previous_week">Last week</option>
            <option value="last_30_days">Last 30 days</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-primary">Cadence</span>
          <select value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)} className={field}>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-text-primary">Hour (UTC)</span>
          <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className={field}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
            ))}
          </select>
        </label>
        {cadence === "weekly" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text-primary">Day</span>
            <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} className={field}>
              {DOW.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
          </label>
        )}
        {cadence === "monthly" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-text-primary">Day of month</span>
            <select value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} className={field}>
              {Array.from({ length: 28 }, (_, i) => (
                <option key={i} value={i + 1}>{i + 1}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!name.trim() || isPending}
        className="min-h-11 self-start rounded-control bg-accent px-4 text-base font-medium text-accent-foreground disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create schedule"}
      </button>
    </div>
  );
}
