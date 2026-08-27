"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  grantDirectoryPermission,
  revokeDirectoryPermission,
} from "../../app/admin/directory/actions";
import { DIRECTORY_PERMISSIONS } from "../../lib/pay/directory-permission-list";
import { Badge } from "../Badge";
import { field, labelText, panel } from "./field-styles";
import type { GranteeSummary } from "../../lib/directory/permissions-admin";

export function PermissionGrantsPanel({ grantees }: { grantees: GranteeSummary[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [perm, setPerm] = useState<string>(DIRECTORY_PERMISSIONS[1]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    const res = await grantDirectoryPermission(email, perm);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOk(`Granted ${perm} to ${email}.`);
    setEmail("");
    router.refresh();
  }

  async function revoke(userId: string, permission: string) {
    setBusy(true);
    setError(null);
    const res = await revokeDirectoryPermission(userId, permission);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={grant} className={`${panel} flex flex-wrap items-end gap-2`}>
        <label className="flex-1">
          <span className={labelText}>User email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
            required
          />
        </label>
        <label>
          <span className={labelText}>Permission</span>
          <select value={perm} onChange={(e) => setPerm(e.target.value)} className={field}>
            {DIRECTORY_PERMISSIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          Grant
        </button>
      </form>

      {error && (
        <p className="text-sm text-attention" role="status">
          {error}
        </p>
      )}
      {ok && (
        <p className="text-sm text-money-positive" role="status">
          {ok}
        </p>
      )}

      {grantees.length === 0 ? (
        <p className="text-sm text-text-muted">
          No directory.* grants yet. Platform admins already hold every permission implicitly.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {grantees.map((g) => (
            <li key={g.userId} className={panel}>
              <p className="mb-2 text-sm font-medium text-text-primary">
                {g.email ?? g.userId}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {g.permissions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => revoke(g.userId, p)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-text-secondary hover:text-attention disabled:opacity-50"
                    title="Revoke"
                  >
                    {p} <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-text-muted">
        <Badge variant="neutral">Note</Badge> A platform owner (profiles.is_platform_admin) holds
        every directory.* permission implicitly and is not listed here.
      </p>
    </div>
  );
}
