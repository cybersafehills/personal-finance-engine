"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "./Badge";
import {
  deleteExportSchedule,
  setExportScheduleEnabled,
} from "../app/integrations/exports/actions";
import { formatDateTime } from "../lib/format";
import type { ExportScheduleRow } from "../lib/integrations/queries";

function cadenceLabel(s: ExportScheduleRow): string {
  const hh = `${String(s.hour).padStart(2, "0")}:00 UTC`;
  if (s.cadence === "daily") return `Every day at ${hh}`;
  if (s.cadence === "weekly") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `Every ${days[s.dayOfWeek ?? 1]} at ${hh}`;
  }
  return `Monthly on day ${s.dayOfMonth ?? 1} at ${hh}`;
}

export function ExportScheduleList({ schedules }: { schedules: ExportScheduleRow[] }) {
  const router = useRouter();
  const [isPending, start] = useTransition();

  if (schedules.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No scheduled exports yet.
      </p>
    );
  }

  const run = (fn: () => Promise<{ ok: boolean }>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  return (
    <ul className="flex flex-col gap-2">
      {schedules.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border-subtle bg-surface p-4"
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium text-text-primary">
              {s.name}
            </span>
            <span className="block text-xs text-text-muted">
              {s.format.toUpperCase()} · {cadenceLabel(s)} · next{" "}
              {formatDateTime(s.nextRunAt)}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Badge variant={s.enabled ? "positive" : "neutral"}>
              {s.enabled ? "Active" : "Paused"}
            </Badge>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                run(() => setExportScheduleEnabled(s.id, !s.enabled))}
              className="rounded-control border border-border-subtle bg-background px-3 py-1 text-sm font-medium disabled:opacity-50"
            >
              {s.enabled ? "Pause" : "Resume"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => deleteExportSchedule(s.id))}
              className="rounded-control px-3 py-1 text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50"
            >
              Delete
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
