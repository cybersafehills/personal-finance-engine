"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { supabaseSession } from "../../../lib/supabase-session-server";
import { supabaseServer } from "../../../lib/supabase-server";
import { isAccountantPackageEnabled } from "../../../lib/integrations/gate";
import { countExportRows } from "../../../lib/integrations/export/query";
import {
  RELATIVE_PRESETS,
  type RelativePreset,
  resolvePeriod,
} from "../../../lib/integrations/export/period";
import { runAccountantPackageBuild } from "../../../lib/integrations/accountant/build";

// A package that would scan more than this many transactions is left
// queued for the build-accountant-packages cron instead of running in the
// request. Matches the Export Center's inline threshold.
const INLINE_ROW_LIMIT = 20_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type AccountantPackageInput =
  | { kind: "preset"; preset: RelativePreset }
  | { kind: "absolute"; from: string; to: string };

export type CreateAccountantPackageResult =
  | { ok: true; packageId: string; ran: boolean }
  | { ok: false; error: string };

type AccessOk = { ok: true; workspaceId: string; userId: string };
type AccessErr = { ok: false; error: string };

async function requireAccountantAccess(): Promise<AccessOk | AccessErr> {
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId || !isAccountantPackageEnabled(workspaceId)) {
    return {
      ok: false,
      error: "Accountant packages aren’t available for this Space.",
    };
  }
  const supabase = await supabaseSession();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You need to be signed in." };
  const { data: allowed, error } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: "integration.accountant_package",
  });
  if (error || allowed !== true) {
    return {
      ok: false,
      error: "You don’t have permission to build an accountant package.",
    };
  }
  return { ok: true, workspaceId, userId: user.id };
}

/** Resolve the requested period to inclusive YYYY-MM-DD bounds. */
function resolvePeriodBounds(
  input: AccountantPackageInput,
): { start: string; end: string } | null {
  if (input.kind === "absolute") {
    if (!DATE_RE.test(input.from) || !DATE_RE.test(input.to)) return null;
    if (input.to < input.from) return null;
    return { start: input.from, end: input.to };
  }
  if (!RELATIVE_PRESETS.includes(input.preset)) return null;
  const resolved = resolvePeriod(
    { kind: "relative", preset: input.preset },
    new Date(),
  );
  return { start: resolved.from.slice(0, 10), end: resolved.to.slice(0, 10) };
}

export async function createAccountantPackage(
  rawInput: unknown,
): Promise<CreateAccountantPackageResult> {
  const access = await requireAccountantAccess();
  if (!access.ok) return access;
  const { workspaceId, userId } = access;

  const input = rawInput as AccountantPackageInput | null;
  if (!input || typeof input !== "object" || !("kind" in input)) {
    return { ok: false, error: "Pick a period for the package." };
  }
  const bounds = resolvePeriodBounds(input);
  if (!bounds) {
    return { ok: false, error: "That period is invalid." };
  }

  const admin = supabaseServer();
  const { data: pkg, error } = await admin
    .from("accountant_packages")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      period_start: bounds.start,
      period_end: bounds.end,
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !pkg) {
    console.error("createAccountantPackage insert failed:", error?.message);
    return { ok: false, error: "Could not start the package build." };
  }

  await admin.from("integration_events").insert({
    workspace_id: workspaceId,
    kind: "accountant_package.created",
    severity: "info",
    ref_type: "accountant_package",
    ref_id: pkg.id,
    summary: `Accountant package requested (${bounds.start} — ${bounds.end})`,
    context: { actorUserId: userId },
  });

  const estimate = await countExportRows(admin, workspaceId, {
    from: `${bounds.start}T00:00:00.000Z`,
    to: `${bounds.end}T23:59:59.999Z`,
    accountIds: null,
    directions: null,
  });

  let ran = false;
  if (estimate <= INLINE_ROW_LIMIT) {
    await runAccountantPackageBuild(pkg.id);
    ran = true;
  }

  revalidatePath("/integrations/accountant");
  return { ok: true, packageId: pkg.id, ran };
}
