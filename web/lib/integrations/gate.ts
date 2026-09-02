import "server-only";

// Server-authoritative gating for the Integrations area (imports, exports,
// connections, sync, activity/health).
//
// There is no general feature-flag system in this codebase - this mirrors
// the existing web/lib/pay/gate.ts convention exactly:
//   * a switch env var is "on" unless it is the exact string "false"
//   * an optional comma-separated workspace allowlist narrows a staged beta
//   * a sensitive sub-surface is "off" unless the exact string "true"
// Every Integrations route, server action and query calls one of these on
// the server, so a disabled flag blocks the backend, not just a hidden
// link (master prompt "Feature flags").
//
//   INTEGRATIONS_ENABLED               - master switch for the whole area
//                                        (nav entry + every /integrations
//                                        route + every integration action).
//   INTEGRATIONS_WORKSPACE_ALLOWLIST   - if non-empty, ONLY these workspace
//                                        ids see the area. Empty/unset =
//                                        everyone. Applies to every flag
//                                        below as well.
//   INTEGRATIONS_IMPORT_STUDIO_ENABLED - the Import Studio specifically
//                                        (/integrations/imports/**).
//   INTEGRATIONS_EXPORT_CENTER_ENABLED - the Export Center specifically
//                                        (/integrations/exports/** + the
//                                        export job cron).
//   INTEGRATIONS_SYNC_ENABLED          - Sync & Automation. OFF unless the
//                                        exact string "true": it ships
//                                        behind schedule execution being
//                                        operational, same convention as
//                                        SMS_RECONCILIATION_ENABLED.

function envEnabled(name: string): boolean {
  return process.env[name] !== "false";
}

function envOptIn(name: string): boolean {
  return process.env[name] === "true";
}

function workspaceAllowed(workspaceId: string | null): boolean {
  const raw = process.env.INTEGRATIONS_WORKSPACE_ALLOWLIST?.trim();
  if (!raw) return true;
  if (!workspaceId) return false;
  const allow = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.length === 0 || allow.includes(workspaceId);
}

/** The whole Integrations area: nav entry, every route, every action. */
export function isIntegrationsEnabled(workspaceId: string | null): boolean {
  return envEnabled("INTEGRATIONS_ENABLED") && workspaceAllowed(workspaceId);
}

/** Import Studio - upload/detect/map/validate/preview/commit/rollback. */
export function isImportStudioEnabled(workspaceId: string | null): boolean {
  return (
    isIntegrationsEnabled(workspaceId) &&
    envEnabled("INTEGRATIONS_IMPORT_STUDIO_ENABLED")
  );
}

/** Export Center - config, CSV/XLSX generation, history, templates, cron. */
export function isExportCenterEnabled(workspaceId: string | null): boolean {
  return (
    isIntegrationsEnabled(workspaceId) &&
    envEnabled("INTEGRATIONS_EXPORT_CENTER_ENABLED")
  );
}

/** Sync & Automation - default OFF; opt-in with the exact string "true". */
export function isSyncEnabled(workspaceId: string | null): boolean {
  return isIntegrationsEnabled(workspaceId) && envOptIn("INTEGRATIONS_SYNC_ENABLED");
}
