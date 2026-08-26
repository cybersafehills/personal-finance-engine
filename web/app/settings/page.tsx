import Link from "next/link";
import { PageHeader } from "../../components/PageHeader";
import {
  WalletIcon,
  PhoneIcon,
  LockIcon,
  UsersIcon,
  DocumentIcon,
  GearIcon,
  EyeIcon,
} from "../../components/icons";

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
    href: "/settings/connections",
    title: "Connections",
    description: "Manage the devices and Shortcuts that send transactions in.",
    Icon: PhoneIcon,
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
    description: "Configure when your daily financial report is generated and emailed.",
    Icon: DocumentIcon,
  },
  {
    href: "/settings/security",
    title: "Security",
    description: "Sign-in details and active sessions.",
    Icon: LockIcon,
  },
  {
    href: "/settings/workspace",
    title: "Workspace",
    description: "Members, invites, and organizations.",
    Icon: UsersIcon,
  },
] as const;

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" />

      <div className="flex flex-col gap-3">
        {SETTINGS_LINKS.map(({ href, title, description, Icon }) => (
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
