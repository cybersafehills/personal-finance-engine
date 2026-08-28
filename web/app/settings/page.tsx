import Link from "next/link";
import { PageHeader } from "../../components/PageHeader";
import {
  DocumentIcon,
  EyeIcon,
  GearIcon,
  LockIcon,
  PhoneIcon,
  UsersIcon,
  WalletIcon,
} from "../../components/icons";
import { isBillsEnabled } from "../../lib/bills/gate";
import { getActiveWorkspaceId } from "../../lib/queries";

export const dynamic = "force-dynamic";

const SETTINGS_LINKS = [
  {
    href: "/settings/appearance",
    title: "Appearance and navigation",
    description: "Arrange your primary navigation order.",
    Icon: GearIcon,
  },
  {
    href: "/settings/privacy",
    title: "Privacy and security",
    description: "Balance visibility, full privacy mode, and sign-in security.",
    Icon: EyeIcon,
  },
  {
    href: "/settings/accounts",
    title: "Accounts",
    description: "Manage the financial accounts your transactions belong to.",
    Icon: WalletIcon,
  },
  {
    href: "/integrations/connections",
    title: "Connections",
    description: "Manage the devices and Shortcuts that send transactions in.",
    Icon: PhoneIcon,
  },
  {
    href: "/settings/sources",
    title: "Shared accounts",
    description:
      "Choose what each household can see of your accounts — nothing, transactions, or the balance.",
    Icon: UsersIcon,
  },
  {
    href: "/settings/notifications",
    title: "Notifications",
    description:
      "Choose what a shared Space tells you about — budgets, goals, members, and reports.",
    Icon: DocumentIcon,
  },
  {
    href: "/reports",
    title: "Reports",
    description: "View your generated daily financial reports.",
    Icon: DocumentIcon,
  },
  {
    href: "/settings/reports",
    title: "Daily reports",
    description:
      "Configure when your daily financial report is generated and emailed.",
    Icon: DocumentIcon,
  },
  {
    href: "/settings/security",
    title: "Security",
    description: "Two-step verification, sign-in details, and active sessions.",
    Icon: LockIcon,
  },
  {
    href: "/settings/workspace",
    title: "Spaces",
    description: "Households and organizations — members and invites.",
    Icon: UsersIcon,
  },
] as const;

export default async function SettingsPage() {
  const billsEnabled = isBillsEnabled(await getActiveWorkspaceId());
  const links = billsEnabled
    ? [
        ...SETTINGS_LINKS,
        {
          href: "/bills",
          title: "Bills & Expenses",
          description: "Upload invoices and receipts and review them into the ledger.",
          Icon: DocumentIcon,
        } as const,
      ]
    : SETTINGS_LINKS;

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="flex flex-col gap-3">
        {links.map(({ href, title, description, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background focus-visible:bg-background"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-background text-text-secondary">
              <Icon className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium text-text-primary">
                {title}
              </span>
              <span className="block text-sm text-text-muted">
                {description}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
