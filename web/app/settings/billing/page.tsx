import { PageHeader } from "../../../components/PageHeader";

export const dynamic = "force-dynamic";

// Billing & Plan (master prompt section 29). A home for the plan exists
// now so the IA is complete; the entitlements domain and any payment
// processing are a separate, later phase (ONELEDGER_PLATFORM_ASSESSMENT
// section 6.6). Until then every account is on the free plan and this
// page is honest about that. Plan-gated behaviour must NOT be hardcoded
// against copy here - it will read a central entitlement check.
const PLANS: { name: string; current?: boolean; blurb: string; includes: string[] }[] = [
  {
    name: "Free",
    current: true,
    blurb: "Everything you need to run one Personal Space by hand.",
    includes: [
      "1 Personal Space",
      "Manual entry and statement import",
      "One connected source",
      "Full ledger, review, security, and data export",
    ],
  },
  {
    name: "Personal Plus",
    blurb: "For automating a busy personal ledger.",
    includes: [
      "Automatic transaction capture",
      "Multiple connected sources",
      "Categorisation rules and scheduled reports",
      "Extended history and cash-flow forecasting",
    ],
  },
  {
    name: "Household",
    blurb: "For running money with a partner or family.",
    includes: [
      "A shared Household Space",
      "Members, roles, and per-account sharing",
      "Shared goals and a shared Inbox",
    ],
  },
  {
    name: "Business",
    blurb: "For an organisation's finance operations.",
    includes: [
      "Multi-account organisations and finance roles",
      "Approvals, Bills, and reconciliation",
      "Professional reports and audit retention",
    ],
  },
];

export default function BillingSettingsPage() {
  return (
    <div>
      <PageHeader
        backHref="/settings"
        title="Billing & Plan"
        subtitle="Your current plan and what each plan includes."
      />

      <div className="mb-4 rounded-card border border-border-subtle bg-surface p-4">
        <p className="text-sm font-medium text-text-primary">
          You&rsquo;re on the Free plan.
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Paid plans aren&rsquo;t available yet. Your own data, exports,
          deletion, and account security will always be free.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {PLANS.map((plan) => (
          <section
            key={plan.name}
            className="rounded-card border border-border-subtle bg-surface p-4"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-text-primary">
                {plan.name}
              </h2>
              {plan.current && (
                <span className="rounded-control bg-background px-2 py-0.5 text-xs font-medium text-text-secondary">
                  Current
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-text-muted">{plan.blurb}</p>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-text-primary">
              {plan.includes.map((item) => (
                <li key={item} className="flex items-baseline gap-2">
                  <span aria-hidden="true" className="text-text-muted">
                    •
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
