"use client";

import { useState, useTransition } from "react";
import { rotateConnectorCredential } from "../app/settings/connections/actions";
import { RevealedSecret } from "./RevealedSecret";
import { ShortcutKeyInstructions } from "./ConnectionDetails";

export function DeviceCredentialActions({
  credentialId,
  canRotate,
  ingestEndpointUrl,
}: {
  credentialId: string;
  canRotate: boolean;
  ingestEndpointUrl?: string | null;
}) {
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (revealedSecret) {
    return (
      <div className="mt-3">
        <RevealedSecret
          secret={revealedSecret}
          onDismiss={() => setRevealedSecret(null)}
          instructions={ingestEndpointUrl !== undefined
            ? <ShortcutKeyInstructions endpointUrl={ingestEndpointUrl} />
            : undefined}
        />
      </div>
    );
  }

  if (!canRotate) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setErrorMessage(null);
          startTransition(async () => {
            const result = await rotateConnectorCredential(credentialId);
            if (result.ok) setRevealedSecret(result.secret);
            else setErrorMessage(result.error);
          });
        }}
        className="min-h-8 text-xs font-medium text-accent hover:underline disabled:opacity-50"
      >
        {isPending ? "Rotating…" : "Rotate credential"}
      </button>
      {errorMessage && (
        <p role="alert" className="mt-1 text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
