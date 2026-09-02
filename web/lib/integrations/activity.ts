import "server-only";

import { listIntegrationEvents } from "./queries";
import {
  buildIntegrationActivity,
  type IntegrationActivityView,
} from "./activity-model";

/**
 * Authenticated, RLS-scoped read model for /integrations/activity: the
 * consolidated import / export / connection activity + health feed. The
 * database restricts rows to the caller's `integration.view` Spaces;
 * integration_events is already redacted (no secrets, no raw financial
 * text, no stack traces).
 */
export async function getIntegrationActivity(
  limit = 50,
): Promise<IntegrationActivityView> {
  const events = await listIntegrationEvents(limit);
  return buildIntegrationActivity(events);
}
