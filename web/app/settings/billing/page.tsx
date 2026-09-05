import { PageHeader } from "../../../components/PageHeader";
import { getActiveWorkspaceId } from "../../../lib/queries";
import { getWorkspacePlanState } from "../../../lib/entitlements/gate";
import { type Plan, planLabel, PLANS } from "../../../lib/entitlements/plans";

function formatTrialEnd(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Africa/Kigali",
  });
}

export const dynamic = "force-dynamic";

// Billing & Plan (master prompt section 29). Shows the workspace's real
// stored plan (workspace_plans, ADR 0015). Payment processing is still a
// later phase - there is no self-serve upgrade here yet. Plan-gated
// behaviour must NOT be hardcoded against this copy: it reads the central
// entitlement check (lib/entitlements/gate.ts).
const PLAN_COPY: Record<
  Plan,
  { blurb: string; includes: string[] }
> = {
  free: {
    blurb: "Everything you need to run one Personal Space by hand.",
    includes: [
      "1 Personal Space",
      "Manual entry and statement import",
      "One connected source",
      "Full ledger, review, security, and data export",
    ],
  },
  personal_plus: {
    blurb: "For automating a busy personal ledger.",
    includes: [
      "Automatic transaction capture",
      "Multiple connected sources",
      "Categorisation rules and scheduled reports",
      "Extended history and cash-flow forecasting",
    ],
  },
  household: {
    blurb: "For running money with a partner or family.",
    includes: [
      "A shared Household Space",
      "Members, roles, and per-account sharing",
      "Shared goals and a shared Inbox",
    ],
  },
  business: {
    blurb: "For an organisation's finance operations.",
    includes: [
      "Multi-account organisations and finance roles",
      "Approvals, Bills, and reconciliation",
      "Professional reports and audit retention",
    ],
  },
};

export default async function BillingSettingsPage() {
  const workspaceId = await getActiveWorkspaceId();
  const { plan, trialEndsAt, onTrial } = await getWorkspacePlanState(workspaceId);

  return (
    <div>
      <PageHeader
        backHref="/settings"
        title="Billing & Plan"
        subtitle="This Space's plan and what each plan includes."
      />

      <div className="mb-4 rounded-card border border-border-subtle bg-surface p-4">
        <p className="text-sm font-medium text-text-primary">
          This Space is on the {planLabel(plan)} plan
          {onTrial ? " (trial)" : ""}.
        </p>
        <p className="mt-1 text-sm text-text-muted">
          {onTrial && trialEndsAt
            ? `Your trial runs until ${formatTrialEnd(trialEndsAt)}. `
            : "Paid plans aren’t available to buy yet. "}
          Your own data, exports, deletion, and account security are never
          behind a plan.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {PLANS.map((p) => {
          const copy = PLAN_COPY[p];
          const isCurrent = p === plan;
          return (
            <section
              key={p}
              className={`rounded-card border bg-surface p-4 ${
                isCurrent ? "border-accent" : "border-border-subtle"
              }`}
            >
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-text-primary">
                  {planLabel(p)}
                </h2>
                {isCurrent && (
                  <span className="rounded-control bg-background px-2 py-0.5 text-xs font-medium text-text-secondary">
                    Current
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-text-muted">{copy.blurb}</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-text-primary">
                {copy.includes.map((item) => (
                  <li key={item} className="flex items-baseline gap-2">
                    <span aria-hidden="true" className="text-text-muted">
                      •
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
