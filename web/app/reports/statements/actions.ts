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
