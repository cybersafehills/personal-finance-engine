// OneLedger Financial Documents Engine - Statements family. Runtime gate,
// read on the server. OFF unless the env var is exactly "true" - the same
// opt-in convention as REPORT_GENERATION_ENABLED / PDF_STATEMENT_IMPORT_ENABLED.
//
// While off: the /reports/statements routes 404, no server action touches
// the statements tables, and the "Statements" tab is hidden on /reports.
// Migration 20261210000000_financial_statements.sql is additive and inert
// until this is turned on.
//
// Downstream of the existing `reports` product surface: a user only reaches
// Statements if their experience mode already grants Reports AND this flag
// is set (see lib/experience-mode.ts isSurfaceVisible(mode, "reports")).
export function isFinancialStatementsEnabled(): boolean {
  return process.env.FINANCIAL_STATEMENTS_ENABLED === "true";
}
