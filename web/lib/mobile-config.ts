import "server-only";

import { isFinancialStatementsEnabled } from "./financial-statements";
import { isBillsEnabled } from "./bills/gate";
import { isBusinessSurfacesEnabled } from "./experience-mode/gate";
import { isIntelligenceEnabled } from "./intelligence/insights";
import { isDeveloperApiEnabled, isIntegrationsEnabled } from "./integrations/gate";
import {
  isAssistedPayEnabled,
  isPayServicesEnabled,
  isScanToPayEnabled,
  isUssdDirectoryEnabled,
} from "./pay/gate";
import { isSpacesEnabled } from "./spaces/gate";

// Which optional surfaces are switched on for the caller's workspace, so the
// mobile app can show a feature only when it will actually work (GET
// /api/mobile/config). These are the web's own gate functions - the flags live
// in server env, which the app cannot read - so a screen never drifts from what
// the server will accept. Booleans only: no env values, allowlists or ids.

export type MobileConfig = {
  pay: boolean;
  assistedPay: boolean;
  ussdDirectory: boolean;
  scanToPay: boolean;
  statements: boolean;
  insights: boolean;
  bills: boolean;
  spaces: boolean;
  integrations: boolean;
  developer: boolean;
  businessSurfaces: boolean;
};

export function mobileConfig(workspaceId: string | null): MobileConfig {
  return {
    pay: isPayServicesEnabled(workspaceId),
    assistedPay: isAssistedPayEnabled(workspaceId),
    ussdDirectory: isUssdDirectoryEnabled(workspaceId),
    scanToPay: isScanToPayEnabled(workspaceId),
    statements: isFinancialStatementsEnabled(),
    insights: isIntelligenceEnabled(workspaceId),
    bills: isBillsEnabled(workspaceId),
    spaces: isSpacesEnabled(workspaceId),
    integrations: isIntegrationsEnabled(workspaceId),
    developer: isDeveloperApiEnabled(workspaceId),
    businessSurfaces: isBusinessSurfacesEnabled(workspaceId),
  };
}
