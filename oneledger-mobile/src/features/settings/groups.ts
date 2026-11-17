import type { MoreFlag, MoreFlags } from "@/features/more/groups";

// Settings, grouped with the web's headings (web/lib/settings-navigation.ts).
// The pages that have no native screen open on the web; screens the app
// already has open natively. Rows for features that are dark by default
// (Integrations, Developer platform, account sharing) show only when the server
// says they are on for this Space.

export type SettingsRow = {
  label: string;
  description: string;
  /** A screen in this app. */
  route?: "/security" | "/notifications" | "/space-members";
  /** A page on the web, opened in the browser (the user may need to sign in). */
  webPath?: string;
  /** Shown only when the server says this feature is on (an unknown answer hides it). */
  onlyWhenOn?: MoreFlag;
};

export type SettingsGroup = { title: string; description: string; rows: SettingsRow[] };

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    title: "Profile & Preferences",
    description: "Your details and regional defaults.",
    rows: [
      {
        label: "Profile & region",
        description: "Your name, country, language, primary currency and timezone.",
        webPath: "/settings/profile",
      },
    ],
  },
  {
    title: "Accounts & Connections",
    description: "The accounts your money lives in and how transactions reach OneLedger.",
    rows: [
      {
        label: "Financial accounts",
        description: "The MoMo, bank, cash and card accounts your transactions belong to.",
        webPath: "/settings/accounts",
      },
      {
        label: "Import a statement",
        description: "Bring past transactions in from a bank or MoMo statement file.",
        webPath: "/settings/sources/import",
      },
    ],
  },
  {
    title: "Spaces & Members",
    description: "Your Personal Space and any shared households or organizations.",
    rows: [
      {
        label: "Spaces & members",
        description: "Create or manage a shared Space, invite people and set roles.",
        route: "/space-members",
      },
      {
        label: "Account sharing",
        description: "Choose what each shared Space sees of an account: nothing, transactions or the balance.",
        webPath: "/settings/sources",
        onlyWhenOn: "spaces",
      },
    ],
  },
  {
    title: "Reports & Notifications",
    description: "Scheduled summaries and what a shared Space alerts you about.",
    rows: [
      {
        label: "Reports schedule",
        description: "When your summary is generated and where it is sent.",
        webPath: "/settings/reports",
      },
      {
        label: "Notifications",
        description: "Your alerts, in this app.",
        route: "/notifications",
      },
    ],
  },
  {
    title: "Data & Integrations",
    description: "Move your data in and out, and connect external services.",
    rows: [
      {
        label: "Integrations",
        description: "Imports, exports, connected workbooks, reconciliation and external services.",
        webPath: "/integrations",
        onlyWhenOn: "integrations",
      },
      {
        label: "Developer platform",
        description: "API keys, webhooks and the marketplace.",
        webPath: "/integrations/developer",
        onlyWhenOn: "developer",
      },
    ],
  },
  {
    title: "Security & Privacy",
    description: "Sign-in protection and on-screen privacy.",
    rows: [
      {
        label: "App lock",
        description: "Ask for your fingerprint or face when the app opens.",
        route: "/security",
      },
      {
        label: "Sign-in & security",
        description: "Password, two-step verification and active sessions.",
        webPath: "/settings/security",
      },
      {
        label: "Privacy",
        description: "On-screen balance visibility and full privacy mode.",
        webPath: "/settings/privacy",
      },
    ],
  },
  {
    title: "Billing & Plan",
    description: "Your plan and what it includes.",
    rows: [
      {
        label: "Plan",
        description: "See your current plan and what each plan includes.",
        webPath: "/settings/billing",
      },
    ],
  },
];

/** Groups with the rows the server hasn't switched on removed; empty groups are dropped. */
export function visibleSettingsGroups(flags: MoreFlags | null): SettingsGroup[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => !row.onlyWhenOn || flags?.[row.onlyWhenOn] === true),
  })).filter((group) => group.rows.length > 0);
}
