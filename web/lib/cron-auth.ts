import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

// Shared authorization check for every cron-invoked route
// (app/api/cron/*) - a trusted scheduler (Postgres via pg_net, or a
// manual operator) presents a shared secret in a header; a browser
// session is never the caller here. Constant-time comparison avoids a
// timing side-channel on the secret itself (master prompt §39).
export function isAuthorizedCronRequest(request: NextRequest): boolean {
  const configuredSecret = process.env.REPORT_CRON_SECRET;
  if (!configuredSecret) {
    console.error("cron route: REPORT_CRON_SECRET is not configured");
    return false;
  }

  const provided = request.headers.get("x-report-cron-secret") ?? "";
  const configuredBuf = Buffer.from(configuredSecret);
  const providedBuf = Buffer.from(provided);

  return configuredBuf.length === providedBuf.length &&
    timingSafeEqual(configuredBuf, providedBuf);
}
