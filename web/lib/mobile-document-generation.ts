import type { StatementRequest, StatementPreview } from "./statement-types.ts";
export const isDocumentRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const presets = ["this_month", "last_month", "last_3_months", "last_6_months", "last_12_months", "custom"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A bounded transport parser; the canonical generator still checks dates, permissions and accounts. */
export function parseDocumentRequest(v: unknown): StatementRequest | null {
  if (!isDocumentRecord(v) || !["standard", "detailed"].includes(String(v.statementType)) || !presets.includes(String(v.preset)) || typeof v.timezone !== "string" || v.timezone.length > 80 || typeof v.clientToken !== "string" || !uuid.test(v.clientToken) || !Array.isArray(v.sourceIds) || v.sourceIds.length > 100 || !v.sourceIds.every(id => typeof id === "string" && uuid.test(id))) return null;
  if ([v.fromDateKey,v.toDateKey].some(d => d !== undefined && (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)))) return null;
  const filters: NonNullable<StatementRequest["filters"]> = {};
  if (v.filters !== undefined) {
    if (!isDocumentRecord(v.filters)) return null;
    for (const key of ["category","merchant","tag","participantUserId"] as const) {
      const value=v.filters[key];if(value!==undefined){if(typeof value!=="string"||value.length>80)return null;filters[key]=value;}
    }
    if(v.filters.direction!==undefined){if(v.filters.direction!=="in"&&v.filters.direction!=="out")return null;filters.direction=v.filters.direction;}
  }
  return {statementType:v.statementType as StatementRequest["statementType"],preset:v.preset as StatementRequest["preset"],timezone:v.timezone,clientToken:v.clientToken,sourceIds:v.sourceIds as string[],fromDateKey:v.fromDateKey as string|undefined,toDateKey:v.toDateKey as string|undefined,filters};
}
/** No financial calculations on the client: send each canonical currency block independently. */
export function documentPreview(p: StatementPreview) {
  return { periodLabel:p.period.label, timezone:p.period.timezone, statementType:p.statementType, scope:p.scope, totals:p.perCurrency, warnings:p.coverage.warnings.map(w=>w.detail), coverageLabel:p.coverage.statementLabel, adjustments:p.period.adjustments, filterSummary:p.coverage.filterSummary };
}
