import Link from "next/link";
import { PageHeader } from "../../../components/PageHeader";
import { PRIMARY_NAV } from "../../../lib/navigation";

export const dynamic = "force-dynamic";

export default function AppearanceSettingsPage() {
  return (
    <div>
      <PageHeader
        backHref="/settings"
        title="Appearance and navigation"
        subtitle="How OneLedger's shell is laid out"
      />

      <section className="rounded-card border border-border-subtle bg-surface p-4">
        <h2 className="text-sm font-medium text-text-primary">Navigation</h2>
        <p className="mt-1 text-sm text-text-muted">
          OneLedger&rsquo;s primary navigation follows the financial
          lifecycle and is the same on every device:
        </p>
        <ol className="mt-3 flex flex-col gap-1.5 text-sm text-text-primary">
          {PRIMARY_NAV.map((item, i) => (
            <li key={item.key} className="flex items-baseline gap-2">
              <span className="text-xs text-text-muted">{i + 1}.</span>
              <Link href={item.href} className="font-medium hover:underline">
                {item.label}
              </Link>
            </li>
          ))}
          <li className="flex items-baseline gap-2">
            <span className="text-xs text-text-muted">
              {PRIMARY_NAV.length + 1}.
            </span>
            <span className="font-medium">More</span>
            <span className="text-xs text-text-muted">
              &mdash; categories, reports, connected sources, Space
              settings, your account, and advanced tools
            </span>
          </li>
        </ol>
        <p className="mt-3 text-xs text-text-muted">
          Reordering the primary navigation is no longer a per-account
          setting &mdash; the lifecycle order is fixed so guidance and help
          can rely on it.
        </p>
      </section>
    </div>
  );
}
