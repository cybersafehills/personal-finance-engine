import { NextRequest, NextResponse } from "next/server";
import { getActiveWorkspaceId } from "../../../../../../lib/queries";
import { supabaseSession } from "../../../../../../lib/supabase-session-server";
import { supabaseServer } from "../../../../../../lib/supabase-server";
import { siteUrl } from "../../../../../../lib/site-url";
import {
  isAccountingConnectorsEnabled,
  isCloudStorageEnabled,
} from "../../../../../../lib/integrations/gate";
import { isCloudStorageProviderKey } from "../../../../../../lib/integrations/destinations/cloud-storage/contract";
import {
  getCloudStorageClient,
  isCloudProviderConfigured,
} from "../../../../../../lib/integrations/destinations/cloud-storage/registry";
import { isAccountingProviderKey } from "../../../../../../lib/integrations/accounting/contract";
import {
  getAccountingAdapter,
  isAccountingProviderConfigured,
} from "../../../../../../lib/integrations/accounting/registry";

// Begin the OAuth consent flow for a cloud-storage destination OR an
// accounting ledger - the provider key selects the family. Session
// authenticated via the app middleware. While a provider is dark (no
// *_CLIENT_ID / *_SECRET) this returns 501 - it never redirects to a
// half-configured provider.

const TXN_COOKIE = "ol_oauth_txn";
const TXN_TTL_SECONDS = 600;

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

type OAuthFlow = {
  kind: "cloud_storage" | "accounting";
  capability: string;
  enabled: boolean;
  isConfigured: boolean;
  authUrl(p: { redirectUri: string; state: string; codeChallenge?: string }): string;
};

function resolveFlow(
  provider: string,
  workspaceId: string,
): OAuthFlow | null {
  if (isCloudStorageProviderKey(provider)) {
    return {
      kind: "cloud_storage",
      capability: "integration.destination_manage",
      enabled: isCloudStorageEnabled(workspaceId),
      isConfigured: isCloudProviderConfigured(provider),
      authUrl: (p) => getCloudStorageClient(provider).authUrl(p),
    };
  }
  if (isAccountingProviderKey(provider)) {
    return {
      kind: "accounting",
      capability: "integration.ledger_manage",
      enabled: isAccountingConnectorsEnabled(workspaceId),
      isConfigured: isAccountingProviderConfigured(provider),
      authUrl: (p) => getAccountingAdapter(provider).authUrl(p),
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

  const supabase = await supabaseSession();
  const { data: allowed } = await supabase.rpc("has_space_capability", {
    p_workspace_id: workspaceId,
    p_capability: flow.capability,
  });
  if (allowed !== true) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const destinationId = request.nextUrl.searchParams.get("destination_id");
  if (!destinationId) {
    return NextResponse.json({ error: "destination_id required" }, { status: 400 });
  }
  const admin = supabaseServer();
  const { data: destination } = await admin
    .from("integration_destinations")
    .select("id, kind, provider")
    .eq("id", destinationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (
    !destination || destination.kind !== flow.kind ||
    destination.provider !== provider
  ) {
    return NextResponse.json({ error: "destination mismatch" }, { status: 400 });
  }

  if (!flow.isConfigured) {
    return NextResponse.json(
      {
        error: "provider_not_configured",
        message:
          `${provider} is not configured on this deployment. Set its OAuth client env vars to enable it.`,
      },
      { status: 501 },
    );
  }

  const state = randomHex(24);
  const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const redirectUri = `${siteUrl()}/api/integrations/oauth/${provider}/callback`;

  const authUrl = flow.authUrl({
    redirectUri,
    state,
    codeChallenge: await pkceChallenge(codeVerifier),
  });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(
    TXN_COOKIE,
    JSON.stringify({ state, codeVerifier, destinationId, provider }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/integrations/oauth",
      maxAge: TXN_TTL_SECONDS,
    },
  );
  return res;
}
