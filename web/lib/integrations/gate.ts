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

// --- Phase 2 -----------------------------------------------------------------
//
//   INTEGRATIONS_DESTINATIONS_ENABLED - export/sync delivery targets
//                                       (download + signed webhook). On
//                                       unless exactly "false".
//   INTEGRATIONS_WORKBOOKS_ENABLED     - connected workbooks + conflict
//                                       review. OFF unless exactly "true".
//   INTEGRATIONS_CLOUD_STORAGE_ENABLED - the cloud-storage destination
//                                       type. OFF unless exactly "true";
//                                       a provider is additionally dark
//                                       until its *_CLIENT_ID/SECRET is set.

/** Destinations - download + webhook delivery. Requires the Sync surface. */
export function isDestinationsEnabled(workspaceId: string | null): boolean {
  return (
    isSyncEnabled(workspaceId) &&
    envEnabled("INTEGRATIONS_DESTINATIONS_ENABLED")
  );
}

/** Connected Workbooks + conflict review - opt-in with exactly "true". */
export function isWorkbooksEnabled(workspaceId: string | null): boolean {
  return (
    isSyncEnabled(workspaceId) && envOptIn("INTEGRATIONS_WORKBOOKS_ENABLED")
  );
}

/** Cloud-storage destination type - opt-in with exactly "true". */
export function isCloudStorageEnabled(workspaceId: string | null): boolean {
  return (
    isDestinationsEnabled(workspaceId) &&
    envOptIn("INTEGRATIONS_CLOUD_STORAGE_ENABLED")
  );
}

// --- Phase 3 -----------------------------------------------------------------
//
//   INTEGRATIONS_RECONCILIATION_CENTER_ENABLED - the read-only surface that
//     unifies balance drift, payment-intent matches, import duplicates and
//     connected-workbook sync conflicts. On unless exactly "false".

/** Reconciliation Center - a read-only hub over the existing review queues. */
export function isReconciliationCenterEnabled(
  workspaceId: string | null,
): boolean {
  return (
    isIntegrationsEnabled(workspaceId) &&
    envEnabled("INTEGRATIONS_RECONCILIATION_CENTER_ENABLED")
  );
}

//   INTEGRATIONS_ACCOUNTANT_PACKAGE_ENABLED - the "Ready for Accountant"
//     package (/integrations/accountant + its build cron). On unless
//     exactly "false".

/** "Ready for Accountant" package - period-scoped downloadable ZIP. */
export function isAccountantPackageEnabled(
  workspaceId: string | null,
): boolean {
  return (
    isIntegrationsEnabled(workspaceId) &&
    envEnabled("INTEGRATIONS_ACCOUNTANT_PACKAGE_ENABLED")
  );
}

//   INTEGRATIONS_ACCOUNTING_CONNECTORS_ENABLED - the accounting destination
//     type + connected ledgers (QuickBooks / Xero / Zoho Books / Odoo).
//     OFF unless exactly "true"; each provider is additionally dark until
//     its *_CLIENT_ID / *_SECRET env is set.

/** Accounting connectors - opt-in with exactly "true". Requires Sync. */
export function isAccountingConnectorsEnabled(
  workspaceId: string | null,
): boolean {
  return (
    isSyncEnabled(workspaceId) &&
    envOptIn("INTEGRATIONS_ACCOUNTING_CONNECTORS_ENABLED")
  );
}

// --- Phase 4 (Developer Platform) ------------------------------------------
//
//   INTEGRATIONS_DEVELOPER_API_ENABLED  - the read-only /api/v1 REST surface
//     + the /integrations/developer key-management screen. OFF unless the
//     exact string "true" - it is the first non-session public surface.
//   INTEGRATIONS_WEBHOOKS_DEV_ENABLED   - outbound webhook subscriptions +
//     the delivery cron. OFF unless exactly "true".
//   INTEGRATIONS_MARKETPLACE_ENABLED    - the /integrations/marketplace
//     catalog. On unless exactly "false".

/** Developer REST API + API-key management. Opt-in with exactly "true". */
export function isDeveloperApiEnabled(workspaceId: string | null): boolean {
  return (
    isIntegrationsEnabled(workspaceId) &&
    envOptIn("INTEGRATIONS_DEVELOPER_API_ENABLED")
  );
}

/** Deployment-level dark switch for /api/v1, checked before a key is even
 *  parsed so a disabled deployment 404s rather than 401s. Per-workspace
 *  allowlisting is still applied by isDeveloperApiEnabled after auth. */
export function isDeveloperApiConfigured(): boolean {
  return envEnabled("INTEGRATIONS_ENABLED") &&
    envOptIn("INTEGRATIONS_DEVELOPER_API_ENABLED");
}

/** Outbound webhook subscriptions. Opt-in with exactly "true"; requires the
 *  developer API surface. */
export function isDeveloperWebhooksEnabled(
  workspaceId: string | null,
): boolean {
  return (
    isDeveloperApiEnabled(workspaceId) &&
    envOptIn("INTEGRATIONS_WEBHOOKS_DEV_ENABLED")
  );
}

/** Integration marketplace catalog. On unless exactly "false". */
export function isMarketplaceEnabled(workspaceId: string | null): boolean {
  return (
    isIntegrationsEnabled(workspaceId) &&
    envEnabled("INTEGRATIONS_MARKETPLACE_ENABLED")
  );
}
