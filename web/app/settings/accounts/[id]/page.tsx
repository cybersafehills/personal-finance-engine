import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAccountDetail,
  getAccountTransactions,
} from "../../../../lib/queries";
import { isSpacesEnabled } from "../../../../lib/spaces/gate";
import { getActiveWorkspaceId } from "../../../../lib/queries";
import { PageHeader } from "../../../../components/PageHeader";
import { Badge } from "../../../../components/Badge";
import { EmptyState } from "../../../../components/EmptyState";
import { TransactionList } from "../../../../components/TransactionList";
import { AccountSettingsControls } from "../../../../components/AccountSettingsControls";
import { formatDateTime } from "../../../../lib/format";

export const dynamic = "force-dynamic";

const PROVIDER_LABELS: Record<string, string> = {
  mtn_momo: "MTN MoMo",
  airtel_money: "Airtel Money",
  bank: "Bank",
  card: "Card",
  cash: "Cash",
  other: "Other",
};

const TABS = [
  "overview",
  "transactions",
  "connections",
  "rules",
  "access",
  "settings",
] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  transactions: "Transactions",
  connections: "Connections",
  rules: "Rules",
  access: "Access",
  settings: "Settings",
};

const CONNECTION_BADGE: Record<
  "active" | "paused" | "revoked",
  { label: string; variant: "positive" | "neutral" | "attention" }
> = {
  active: { label: "Active", variant: "positive" },
  paused: { label: "Paused", variant: "neutral" },
  revoked: { label: "Disconnected", variant: "attention" },
};

const VISIBILITY_LABELS: Record<string, string> = {
  personal_only: "Private to you",
  share_transactions: "Transactions only",
  share_account: "Balance & transactions",
};

function providerLabel(p: string): string {
  return PROVIDER_LABELS[p] ?? p;
}

export default async function AccountDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as Tab)
    : "overview";

  const [detail, workspaceId] = await Promise.all([
    getAccountDetail(id),
    getActiveWorkspaceId(),
  ]);
  if (!detail) notFound();

  const { account, source, connections, rules } = detail;
  const spacesEnabled = isSpacesEnabled(workspaceId);
  const transactions = tab === "transactions"
    ? await getAccountTransactions(id, 20)
    : [];

  return (
    <div>
      <PageHeader
        backHref="/settings/accounts"
        title={account.name}
        subtitle={`${providerLabel(account.provider)} · ${account.currency}${
          source?.maskedIdentifier ? ` · ${source.maskedIdentifier}` : ""
        }`}
      />

      <nav
        aria-label="Account sections"
        className="mb-4 flex flex-wrap gap-1 border-b border-border-subtle"
      >
        {TABS.map((t) => {
          if (t === "access" && !spacesEnabled) return null;
          const active = t === tab;
          return (
            <Link
              key={t}
              href={t === "overview"
                ? `/settings/accounts/${id}`
                : `/settings/accounts/${id}?tab=${t}`}
              aria-current={active ? "page" : undefined}
              className={`min-h-9 rounded-t-control px-3 text-sm font-medium leading-9 ${
                active
                  ? "border-b-2 border-accent text-text-primary"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {TAB_LABELS[t]}
            </Link>
          );
        })}
      </nav>

      {tab === "overview" && (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-3 rounded-card border border-border-subtle bg-surface p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-text-muted">Provider</dt>
              <dd className="text-text-primary">
                {providerLabel(account.provider)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Currency</dt>
              <dd className="text-text-primary">{account.currency}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Status</dt>
              <dd>
                {account.is_active
                  ? (
                    account.is_primary
                      ? <Badge variant="accent">Primary</Badge>
                      : <span className="text-text-primary">Active</span>
                  )
                  : <Badge variant="attention">Archived</Badge>}
              </dd>
            </div>
            {source?.maskedIdentifier && (
              <div>
                <dt className="text-xs text-text-muted">Identifier</dt>
                <dd className="text-text-primary">{source.maskedIdentifier}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-text-muted">Added</dt>
              <dd className="text-text-primary">
                {formatDateTime(account.created_at)}
              </dd>
            </div>
          </dl>

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryTile
              label="Connections"
              value={connections.length}
              href={`/settings/accounts/${id}?tab=connections`}
            />
            <SummaryTile
              label="Account rules"
              value={rules.length}
              href={`/settings/accounts/${id}?tab=rules`}
            />
            {spacesEnabled && (
              <SummaryTile
                label="Shared with"
                value={source?.links.length ?? 0}
                href={`/settings/accounts/${id}?tab=access`}
              />
            )}
          </ul>
        </div>
      )}

      {tab === "transactions" && (
        <div className="flex flex-col gap-3">
          <TransactionList
            transactions={transactions}
            emptyTitle="No transactions on this account yet"
          />
          {transactions.length > 0 && (
            <Link
              href="/transactions"
              className="text-sm font-medium text-accent hover:underline"
            >
              View all activity
            </Link>
          )}
        </div>
      )}

      {tab === "connections" && (
        <div className="flex flex-col gap-3">
          {connections.length === 0
            ? (
              <EmptyState
                title="No connections on this account"
                description="Connect a device so OneLedger can receive this account's transactions automatically."
              />
            )
            : (
              <ul className="flex flex-col gap-2">
                {connections.map((c) => {
                  const badge = CONNECTION_BADGE[c.status];
                  return (
                    <li
                      key={c.id}
                      className="flex flex-col gap-1 rounded-card border border-border-subtle bg-surface p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">
                          {c.label}
                        </span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                      <p className="text-xs text-text-muted">
                        {providerLabel(c.provider)} · key {c.credentialPrefix}… ·{" "}
                        {c.lastUsedAt
                          ? `last received ${formatDateTime(c.lastUsedAt)}`
                          : "nothing received yet"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          <Link
            href="/integrations/connections"
            className="text-sm font-medium text-accent hover:underline"
          >
            Manage connections
          </Link>
        </div>
      )}

      {tab === "rules" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Rules that apply only to this account. Space-wide rules apply
            here too.
          </p>
          {rules.length === 0
            ? (
              <EmptyState
                title="No account-specific rules"
                description="Add a categorization rule scoped to this account from the Rules screen."
              />
            )
            : (
              <ul className="flex flex-col gap-2">
                {rules.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-0.5 rounded-card border border-border-subtle bg-surface p-4"
                  >
                    <span className="text-sm font-medium text-text-primary">
                      {r.category}
                      {r.subcategory ? ` · ${r.subcategory}` : ""}
                    </span>
                    <span className="text-xs text-text-muted">
                      {r.merchant_pattern
                        ? `matches “${r.merchant_pattern}”`
                        : "matches by amount / direction / time"}
                      {r.is_active ? "" : " · inactive"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          <Link
            href="/categories/rules"
            className="text-sm font-medium text-accent hover:underline"
          >
            Manage rules
          </Link>
        </div>
      )}

      {tab === "access" && spacesEnabled && (
        <div className="flex flex-col gap-3">
          {!source
            ? (
              <EmptyState title="This account has no shareable source yet" />
            )
            : source.links.length === 0
            ? (
              <EmptyState
                title="Not shared with any Space"
                description="This account is private to you. Share it into a household from the Account sharing screen."
              />
            )
            : (
              <ul className="flex flex-col gap-2">
                {source.links.map((l) => (
                  <li
                    key={l.workspaceId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border-subtle bg-surface p-4"
                  >
                    <span className="text-sm font-medium text-text-primary">
                      {l.workspaceName ?? "A Space"}
                    </span>
                    <span className="text-xs text-text-muted">
                      {VISIBILITY_LABELS[l.visibilityMode] ?? l.visibilityMode}
                      {l.status === "paused" ? " · paused" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          <Link
            href="/settings/sources"
            className="text-sm font-medium text-accent hover:underline"
          >
            Change account sharing
          </Link>
        </div>
      )}

      {tab === "settings" && (
        <AccountSettingsControls
          accountId={account.id}
          name={account.name}
          isPrimary={account.is_primary}
          isArchived={!account.is_active}
        />
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex flex-col gap-0.5 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
      >
        <span className="text-2xl font-semibold text-text-primary">{value}</span>
        <span className="text-xs text-text-muted">{label}</span>
      </Link>
    </li>
  );
}
