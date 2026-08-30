"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge } from "./Badge";
import {
  allocateSourceToSpace,
  setShareLinkStatus,
  setSourceVisibility,
  type SourceActionResult,
} from "../app/settings/sources/actions";
import type { FinancialSourceRow, WorkspaceSummary } from "../lib/queries";

const PROVIDER_LABELS: Record<string, string> = {
  mtn_momo: "MTN MoMo",
  airtel_money: "Airtel Money",
  bank: "Bank",
  card: "Card",
  cash: "Cash",
  statement: "Imported statement",
  other: "Other",
};

const MODE_LABELS: Record<string, string> = {
  share_transactions: "Transactions only",
  share_account: "Balance & transactions",
};

function ceilingLabel(mode: FinancialSourceRow["visibilityMode"]): string {
  if (mode === "personal_only") return "Private";
  return MODE_LABELS[mode];
}

export function SourceItem({
  source,
  households,
}: {
  source: FinancialSourceRow;
  households: WorkspaceSummary[];
}) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addingShare, setAddingShare] = useState(false);

  const activeLinkWorkspaceIds = useMemo(
    () =>
      new Set(
        source.links
          .filter((link) => link.status !== "revoked")
          .map((link) => link.workspaceId),
      ),
    [source.links],
  );

  const shareTargets = households.filter(
    (h) => !activeLinkWorkspaceIds.has(h.id),
  );

  const run = (fn: () => Promise<SourceActionResult>) => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setErrorMessage(result.error);
      else setAddingShare(false);
    });
  };

  const isPrivate = source.visibilityMode === "personal_only";

  return (
    <section
      aria-label={`${source.displayName} source`}
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-text-primary">
          {source.displayName}
        </span>
        <Badge variant={isPrivate ? "neutral" : "accent"}>
          {ceilingLabel(source.visibilityMode)}
        </Badge>
      </div>
      <p className="-mt-1 text-xs text-text-muted">
        {PROVIDER_LABELS[source.provider] ?? source.provider} · {source.currency}
        {source.maskedIdentifier ? ` · ${source.maskedIdentifier}` : ""}
      </p>

      {source.links.length > 0 && (
        <ul className="flex flex-col gap-2">
          {source.links.map((link) => (
            <li
              key={link.workspaceId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-background px-3 py-2"
            >
              <span className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
                {link.workspaceName ?? "A household"}
                <span className="text-xs text-text-muted">
                  {MODE_LABELS[link.visibilityMode]}
                </span>
                {link.isDefaultTarget && <Badge variant="neutral">Default</Badge>}
                {link.status === "paused" && (
                  <Badge variant="attention">Paused</Badge>
                )}
              </span>
              <span className="flex items-center gap-3">
                {link.status === "paused" ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      run(() =>
                        setShareLinkStatus(
                          source.id,
                          link.workspaceId,
                          "active",
                        ),
                      )
                    }
                    className="min-h-8 text-xs font-medium text-accent hover:underline disabled:opacity-50"
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      run(() =>
                        setShareLinkStatus(
                          source.id,
                          link.workspaceId,
                          "paused",
                        ),
                      )
                    }
                    className="min-h-8 text-xs font-medium text-text-secondary hover:underline disabled:opacity-50"
                  >
                    Pause
                  </button>
                )}
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    run(() =>
                      setShareLinkStatus(
                        source.id,
                        link.workspaceId,
                        "revoked",
                      ),
                    )
                  }
                  className="min-h-8 text-xs font-medium text-text-muted hover:text-attention disabled:opacity-50"
                >
                  Stop sharing
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        {shareTargets.length > 0 && !addingShare && (
          <button
            type="button"
            onClick={() => {
              setErrorMessage(null);
              setAddingShare(true);
            }}
            className="min-h-8 text-xs font-medium text-accent hover:underline"
          >
            Share with a household
          </button>
        )}
        {!isPrivate && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (
                !window.confirm(
                  "Make this account private? Every household loses access to it immediately.",
                )
              ) {
                return;
              }
              run(() => setSourceVisibility(source.id, "personal_only"));
            }}
            className="min-h-8 text-xs font-medium text-text-muted hover:text-attention disabled:opacity-50"
          >
            Make private
          </button>
        )}
      </div>

      {addingShare && (
        <ShareForm
          disabled={isPending}
          households={shareTargets}
          onCancel={() => {
            setAddingShare(false);
            setErrorMessage(null);
          }}
          onSubmit={(workspaceId, mode, isDefault) =>
            run(() =>
              allocateSourceToSpace(source.id, workspaceId, mode, isDefault),
            )
          }
        />
      )}

      {errorMessage && (
        <p role="alert" className="text-xs text-attention">
          {errorMessage}
        </p>
      )}
    </section>
  );
}

function ShareForm({
  households,
  disabled,
  onSubmit,
  onCancel,
}: {
  households: WorkspaceSummary[];
  disabled: boolean;
  onSubmit: (
    workspaceId: string,
    mode: "share_transactions" | "share_account",
    isDefault: boolean,
  ) => void;
  onCancel: () => void;
}) {
  const [workspaceId, setWorkspaceId] = useState(households[0]?.id ?? "");
  const [mode, setMode] = useState<"share_transactions" | "share_account">(
    "share_transactions",
  );
  const [isDefault, setIsDefault] = useState(false);

  return (
    <form
      className="flex flex-col gap-3 rounded-control border border-border-subtle bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!workspaceId) return;
        onSubmit(workspaceId, mode, isDefault);
      }}
    >
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-text-secondary">Household</span>
        <select
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          className="min-h-9 rounded-control border border-border-strong bg-surface px-2 py-1 text-sm text-text-primary"
        >
          {households.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="text-xs font-medium text-text-secondary">
          What can this household see?
        </legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="share-mode"
            checked={mode === "share_transactions"}
            onChange={() => setMode("share_transactions")}
            className="mt-1"
          />
          <span>
            <span className="block text-text-primary">Transactions only</span>
            <span className="block text-xs text-text-muted">
              They see the transactions you put in this household — not the
              account&rsquo;s balance or its full activity.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="share-mode"
            checked={mode === "share_account"}
            onChange={() => setMode("share_account")}
            className="mt-1"
          />
          <span>
            <span className="block text-text-primary">
              Balance &amp; transactions
            </span>
            <span className="block text-xs text-text-muted">
              They also see the account&rsquo;s balance, where the provider
              gives one.
            </span>
          </span>
        </label>
      </fieldset>

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(event) => setIsDefault(event.target.checked)}
        />
        Send new transactions from this account here by default
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={disabled || !workspaceId}
          className="min-h-9 rounded-control bg-accent px-3 text-xs font-medium text-accent-foreground disabled:opacity-50"
        >
          Share
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-9 px-2 text-xs font-medium text-text-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
