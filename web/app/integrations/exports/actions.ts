"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { supabaseServer } from "../../../lib/supabase-server";
import {
  isExportCenterEnabled,
  isSyncEnabled,
} from "../../../lib/integrations/gate";
import { countExportRows } from "../../../lib/integrations/export/query";
import { runExportJob, type ExportJobConfig } from "../../../lib/integrations/export/run";
import { resolvePeriod } from "../../../lib/integrations/export/period";
import {
  type Cadence,
  computeNextRun,
} from "../../../lib/integrations/schedule";

const INLINE_ROW_LIMIT = 20_000;

type AccessOk = { ok: true; workspaceId: string; userId: string };
type AccessErr = { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

async function requireExportAccess(): Promise<AccessOk | AccessErr> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId || !isExportCenterEnabled(workspaceId)) {
    return { ok: false, error: "Exporting isn’t available for this Space." };
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };
  const { data: allowed, error } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "integration.export",
  });
  if (error || allowed !== true) {
    return { ok: false, error: "You don’t have permission to export this Space." };
  }
  return { ok: true, workspaceId, userId: user.id };
}

function validateConfig(input: unknown): ExportJobConfig | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;
  const format = c.format === "xlsx" ? "xlsx" : c.format === "csv" ? "csv" : null;
  if (!format) return null;
  const period = c.period as ExportJobConfig["period"] | undefined;
  if (!period || typeof period !== "object") return null;
  if (period.kind === "absolute") {
    if (
      typeof period.from !== "string" || typeof period.to !== "string" ||
      Number.isNaN(Date.parse(period.from)) || Number.isNaN(Date.parse(period.to))
    ) {
      return null;
    }
  } else if (period.kind !== "relative" || typeof period.preset !== "string") {
    return null;
  }
  return {
    format,
    period,
    accountIds: Array.isArray(c.accountIds) ? (c.accountIds as string[]) : null,
    directions: Array.isArray(c.directions) ? (c.directions as never[]) : null,
    sheets: Array.isArray(c.sheets) ? (c.sheets as string[]) : null,
  };
}

export type CreateExportResult =
  | { ok: true; jobId: string; ran: boolean }
  | { ok: false; error: string };

/** Queue an export; run it inline when the row estimate is small. */
export async function createExportJob(
  rawConfig: unknown,
  templateId?: string | null,
): Promise<CreateExportResult> {
  const access = await requireExportAccess();
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  const config = validateConfig(rawConfig);
  if (!config) return { ok: false, error: "That export configuration is invalid." };

  const admin = supabaseServer();
  const { data: job, error } = await admin
    .from("export_jobs")
    .insert({
      workspace_id: workspaceId,
      template_id: templateId ?? null,
      created_by: userId,
      config,
      format: config.format,
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !job) {
    console.error("createExportJob insert failed", error?.message);
    return { ok: false, error: "Could not start the export." };
  }

  const period = resolvePeriod(config.period, new Date());
  const estimate = await countExportRows(admin, workspaceId, {
    from: period.from,
    to: period.to,
    accountIds: config.accountIds ?? null,
    directions: config.directions ?? null,
  });

  let ran = false;
  if (estimate <= INLINE_ROW_LIMIT) {
    await runExportJob(job.id);
    ran = true;
  }

  revalidatePath("/integrations/exports");
  revalidatePath("/integrations");
  return { ok: true, jobId: job.id, ran };
}

export type SaveExportTemplateResult =
  | { ok: true; templateId: string }
  | { ok: false; error: string };

export async function saveExportTemplate(
  rawName: string,
  rawConfig: unknown,
): Promise<SaveExportTemplateResult> {
  const access = await requireExportAccess();
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  const name = rawName.trim();
  if (!name || name.length > 80) {
    return { ok: false, error: "Give the template a short name." };
  }
  const config = validateConfig(rawConfig);
  if (!config) return { ok: false, error: "That export configuration is invalid." };

  const admin = supabaseServer();
  const { data: existing } = await admin
    .from("export_templates")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", name)
    .maybeSingle();

  const fields = {
    workspace_id: workspaceId,
    name,
    config,
    format: config.format,
    created_by: userId,
  };

  let templateId: string;
  if (existing) {
    const { error } = await admin
      .from("export_templates")
      .update(fields)
      .eq("id", existing.id);
    if (error) return { ok: false, error: "Could not update the template." };
    templateId = existing.id;
  } else {
    const { data: inserted, error } = await admin
      .from("export_templates")
      .insert(fields)
      .select("id")
      .single();
    if (error || !inserted) {
      return { ok: false, error: "Could not save the template." };
    }
    templateId = inserted.id;
  }

  revalidatePath("/integrations/exports");
  return { ok: true, templateId };
}

// --- scheduled exports (INTEGRATIONS_SYNC_ENABLED, integration.sync_manage) ---

type SyncAccessOk = { ok: true; workspaceId: string; userId: string };
async function requireSyncAccess(): Promise<SyncAccessOk | AccessErr> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId || !isSyncEnabled(workspaceId)) {
    return { ok: false, error: "Sync & Automation isn’t enabled for this Space." };
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };
  const { data: allowed, error } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "integration.sync_manage",
  });
  if (error || allowed !== true) {
    return { ok: false, error: "You don’t have permission to manage schedules." };
  }
  return { ok: true, workspaceId, userId: user.id };
}

export type ScheduleInput = {
  name: string;
  config: unknown;
  cadence: Cadence;
  hour: number;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  offsetMinutes?: number;
};

export type CreateScheduleResult =
  | { ok: true; scheduleId: string }
  | { ok: false; error: string };

export async function createExportSchedule(
  input: ScheduleInput,
): Promise<CreateScheduleResult> {
  const access = await requireSyncAccess();
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  const name = (input.name ?? "").trim();
  if (!name || name.length > 80) {
    return { ok: false, error: "Give the schedule a short name." };
  }
  const config = validateConfig(input.config);
  if (!config) return { ok: false, error: "That export configuration is invalid." };
  if (!["daily", "weekly", "monthly"].includes(input.cadence)) {
    return { ok: false, error: "Choose a cadence." };
  }
  const hour = Number.isInteger(input.hour) && input.hour >= 0 && input.hour <= 23
    ? input.hour
    : 6;

  const nextRunAt = computeNextRun(
    {
      cadence: input.cadence,
      hour,
      dayOfWeek: input.dayOfWeek ?? null,
      dayOfMonth: input.dayOfMonth ?? null,
      offsetMinutes: input.offsetMinutes ?? 0,
    },
    new Date(),
  );

  const admin = supabaseServer();
  const { data, error } = await admin
    .from("export_schedules")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      name,
      config,
      cadence: input.cadence,
      hour,
      day_of_week: input.cadence === "weekly" ? input.dayOfWeek ?? 1 : null,
      day_of_month: input.cadence === "monthly" ? input.dayOfMonth ?? 1 : null,
      timezone: "UTC",
      enabled: true,
      next_run_at: nextRunAt,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createExportSchedule failed", error?.message);
    return { ok: false, error: "Could not create the schedule." };
  }

  await admin.from("integration_events").insert({
    workspace_id: workspaceId,
    kind: "schedule.created",
    severity: "info",
    ref_type: "export_schedule",
    ref_id: data.id,
    summary: `Scheduled export "${name}" (${input.cadence})`,
    context: { actorUserId: userId, cadence: input.cadence },
  });

  revalidatePath("/integrations/sync");
  return { ok: true, scheduleId: data.id };
}

export async function setExportScheduleEnabled(
  scheduleId: string,
  enabled: boolean,
): Promise<SimpleResult> {
  const access = await requireSyncAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const { error } = await admin
    .from("export_schedules")
    .update({ enabled })
    .eq("id", scheduleId)
    .eq("workspace_id", access.workspaceId);
  if (error) return { ok: false, error: "Could not update the schedule." };
  revalidatePath("/integrations/sync");
  return { ok: true };
}

export async function deleteExportSchedule(
  scheduleId: string,
): Promise<SimpleResult> {
  const access = await requireSyncAccess();
  if (!access.ok) return access;
  const admin = supabaseServer();
  const { error } = await admin
    .from("export_schedules")
    .delete()
    .eq("id", scheduleId)
    .eq("workspace_id", access.workspaceId);
  if (error) return { ok: false, error: "Could not delete the schedule." };
  revalidatePath("/integrations/sync");
  return { ok: true };
}
