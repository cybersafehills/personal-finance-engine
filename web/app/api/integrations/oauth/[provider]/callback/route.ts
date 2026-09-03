import { NextRequest, NextResponse } from "next/server";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";
import { supabaseServer } from "../../../../../../lib/supabase-server";
import { siteUrl } from "../../../../../../lib/site-url";
import {
  isAccountingConnectorsEnabled,
  isCloudStorageEnabled,
} from "../../../../../../lib/integrations/gate";
import { isCloudStorageProviderKey } from "../../../../../../lib/integrations/destinations/cloud-storage/contract";
import { getCloudStorageClient } from "../../../../../../lib/integrations/destinations/cloud-storage/registry";
import { isAccountingProviderKey } from "../../../../../../lib/integrations/accounting/contract";
import { getAccountingAdapter } from "../../../../../../lib/integrations/accounting/registry";

// OAuth redirect target for both cloud-storage destinations and accounting
// ledgers. Validates the state cookie (CSRF), exchanges the code for
// tokens, stores them in the service-role-only
// integration_destination_secrets, and marks the destination active.
// Session-authenticated via the app middleware.

const TXN_COOKIE = "ol_oauth_txn";

function back(reason: string): NextResponse {
  const res = NextResponse.redirect(`${siteUrl()}/integrations/sync?oauth=${reason}`);
  res.cookies.delete(TXN_COOKIE);
  return res;
}

type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
};

type CallbackFlow = {
  kind: "cloud_storage" | "accounting";
  enabled: boolean;
  connectedEventKind: string;
  exchangeCode(p: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
  }): Promise<TokenSet>;
};

function resolveFlow(
  provider: string,
  workspaceId: string,
): CallbackFlow | null {
  if (isCloudStorageProviderKey(provider)) {
    return {
      kind: "cloud_storage",
      enabled: isCloudStorageEnabled(workspaceId),
      connectedEventKind: "destination.connected",
      exchangeCode: (p) => getCloudStorageClient(provider).exchangeCode(p),
    };
  }
  if (isAccountingProviderKey(provider)) {
    return {
      kind: "accounting",
      enabled: isAccountingConnectorsEnabled(workspaceId),
      connectedEventKind: "ledger.connected",
      exchangeCode: (p) => getAccountingAdapter(provider).exchangeCode(p),
    };
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const workspaceId = await getActiveWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const flow = resolveFlow(provider, workspaceId);
  if (!flow) {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  }
  if (!flow.enabled) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const url = request.nextUrl;
  if (url.searchParams.get("error")) return back("denied");

  const raw = request.cookies.get(TXN_COOKIE)?.value;
  if (!raw) return back("expired");
  let txn: {
    state: string;
    codeVerifier: string;
    destinationId: string;
    provider: string;
  };
  try {
    txn = JSON.parse(raw);
  } catch {
    return back("expired");
  }
  if (txn.provider !== provider) return back("mismatch");

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || state !== txn.state) return back("csrf");
  if (!code) return back("nocode");

  const admin = supabaseServer();
  const { data: destination } = await admin
    .from("integration_destinations")
    .select("id, provider, kind")
    .eq("id", txn.destinationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (
    !destination || destination.kind !== flow.kind ||
    destination.provider !== provider
  ) {
    return back("mismatch");
  }

  try {
    const tokens = await flow.exchangeCode({
      code,
      redirectUri: `${siteUrl()}/api/integrations/oauth/${provider}/callback`,
      codeVerifier: txn.codeVerifier,
    });

    await admin.from("integration_destination_secrets").upsert({
      destination_id: txn.destinationId,
      secret_kind: "oauth_token",
      // Service-role-only table; encryption at rest is a follow-up.
      secret_material: JSON.stringify(tokens),
      secret_prefix: null,
      expires_at: tokens.expiresAt,
      rotated_at: new Date().toISOString(),
    });
    await admin
      .from("integration_destinations")
      .update({ status: "active", last_error_code: null })
      .eq("id", txn.destinationId);
    if (flow.kind === "accounting") {
      await admin
        .from("connected_ledgers")
        .update({ status: "active" })
        .eq("destination_id", txn.destinationId);
    }
    await admin.from("integration_events").insert({
      workspace_id: workspaceId,
      kind: flow.connectedEventKind,
      severity: "info",
      ref_type: "integration_destination",
      ref_id: txn.destinationId,
      summary: `${provider} connected`,
      context: { provider },
    });
    return back("connected");
  } catch (err) {
    console.error("oauth callback: exchange failed", provider, err);
    await admin
      .from("integration_destinations")
      .update({ status: "needs_auth", last_error_code: "oauth_exchange_failed" })
      .eq("id", txn.destinationId);
    return back("failed");
  }
}
