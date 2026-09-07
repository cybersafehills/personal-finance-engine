"use server";

import { revalidatePath } from "next/cache";
import { isFinancialStatementsEnabled } from "../../../lib/financial-statements";
import {
  createStatement,
  type DeleteOutcome,
  deleteStatement,
  type GenerateOutcome,
  type PreviewOutcome,
  previewStatement,
  regenerateStatement,
  type StatementRequest,
} from "../../../lib/statement-generation";

// Thin "use server" wrappers over lib/statement-generation.ts. Every
// mutation re-checks the runtime flag (the /reports/statements routes are
// already gated, this is defence in depth) and revalidates the history
// list on success. All authorization + validation lives in the library.

const OFF = {
  ok: false as const,
  kind: "invalid_input" as const,
  message: "Statements aren't available right now.",
};

export async function previewStatementAction(
  req: StatementRequest,
): Promise<PreviewOutcome> {
  if (!isFinancialStatementsEnabled()) return OFF;
  return previewStatement(req);
}

export async function createStatementAction(
  req: StatementRequest,
): Promise<GenerateOutcome> {
  if (!isFinancialStatementsEnabled()) return OFF;
  const result = await createStatement(req);
  if (result.ok) revalidatePath("/reports/statements");
  return result;
}

export async function regenerateStatementAction(
  statementUuid: string,
): Promise<GenerateOutcome> {
  if (!isFinancialStatementsEnabled()) return OFF;
  const result = await regenerateStatement(statementUuid);
  if (result.ok) revalidatePath("/reports/statements");
  return result;
}

export async function deleteStatementAction(
  statementUuid: string,
): Promise<DeleteOutcome> {
  if (!isFinancialStatementsEnabled()) return OFF;
  const result = await deleteStatement(statementUuid);
  if (result.ok) revalidatePath("/reports/statements");
  return result;
}

export async function createStatementPackAction(
  statementIds: string[],
  title: string,
): Promise<
  | { ok: true; id: string; packId: string }
  | { ok: false; error: string }
> {
  if (!isFinancialStatementsEnabled()) {
    return { ok: false, error: "Statements aren't available right now." };
  }
  const { createStatementPack } = await import("../../../lib/statement-pack");
  const result = await createStatementPack({ statementIds, title });
  if (result.ok) revalidatePath("/reports/statements");
  return result;
}

export async function deleteStatementPackAction(
  packUuid: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isFinancialStatementsEnabled()) {
    return { ok: false, error: "Statements aren't available right now." };
  }
  const { deleteStatementPack } = await import("../../../lib/statement-pack");
  const result = await deleteStatementPack(packUuid);
  if (result.ok) revalidatePath("/reports/statements");
  return result;
}

export async function saveStatementScheduleAction(input: {
  statementType: "standard" | "detailed";
  sourceIds: string[];
  cadence: "weekly" | "monthly" | "quarterly";
  dayOfMonth: number;
  dayOfWeek?: number | null;
  timezone: string;
  deliveryEmail?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isFinancialStatementsEnabled()) {
    return { ok: false, error: "Statements aren't available right now." };
  }
  const { saveStatementSchedule } = await import(
    "../../../lib/statement-schedule"
  );
  const result = await saveStatementSchedule(input);
  if (result.ok) revalidatePath("/reports/statements");
  return result;
}

export async function uploadProviderStatementAction(
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isFinancialStatementsEnabled()) {
    return { ok: false, error: "Statements aren't available right now." };
  }
  const { uploadProviderStatement } = await import(
    "../../../lib/provider-statements"
  );
  const result = await uploadProviderStatement(formData);
  if (result.ok) revalidatePath("/reports/statements");
  return result;
}

export async function deleteProviderStatementAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isFinancialStatementsEnabled()) {
    return { ok: false, error: "Statements aren't available right now." };
  }
  const { deleteProviderStatement } = await import(
    "../../../lib/provider-statements"
  );
  const result = await deleteProviderStatement(id);
  if (result.ok) revalidatePath("/reports/statements");
  return result;
}

export async function deleteStatementScheduleAction(
  scheduleId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isFinancialStatementsEnabled()) {
    return { ok: false, error: "Statements aren't available right now." };
  }
  const { deleteStatementSchedule } = await import(
    "../../../lib/statement-schedule"
  );
  const result = await deleteStatementSchedule(scheduleId);
  if (result.ok) revalidatePath("/reports/statements");
  return result;
}
