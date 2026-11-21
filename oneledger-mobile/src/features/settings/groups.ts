import type Feather from "@expo/vector-icons/Feather";
import type { MoreFlag, MoreFlags } from "@/features/more/groups";

// Direct, mobile-sized settings groups. Browser destinations stay explicit.
// The pages that have no native screen open on the web; screens the app
// already has open natively. Rows for features that are dark by default
// (Integrations, Developer platform, account sharing) show only when the server
// says they are on for this Space.

export type SettingsRow = {
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  description: string;
  /** A screen in this app. */
  route?: "/profile" | "/report-settings" | "/security" | "/notifications" | "/space-members" | "/pay-button" | "/appearance";
  /** A page on the web, opened in the browser (the user may need to sign in). */
  webPath?: string;
  /** Shown only when the server says this feature is on (an unknown answer hides it). */
  onlyWhenOn?: MoreFlag;
};

export type SettingsGroup = { title: string; description: string; rows: SettingsRow[] };

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { title: "Preferences", description: "Personalize OneLedger.", rows: [
    { label: "Profile & region", icon: "globe", description: "Your personal details and regional defaults.", route: "/profile" },
    { label: "Appearance", icon: "sun", description: "Light, dark, or automatic.", route: "/appearance" },
    { label: "Notifications", icon: "bell", description: "Phone alerts and your in-app inbox.", route: "/notifications" },
    { label: "Pay button", icon: "send", description: "Choose a hold action and duration.", route: "/pay-button" },
  ] },
  { title: "Accounts & data", description: "Accounts and connections.", rows: [
    { label: "Financial accounts", icon: "credit-card", description: "Manage your MoMo, bank, cash and card accounts.", webPath: "/settings/accounts" },
    { label: "Import a statement", icon: "download", description: "Import past transactions.", webPath: "/settings/sources/import" },
    { label: "Integrations", icon: "link", description: "Connect services and move your data.", webPath: "/integrations", onlyWhenOn: "integrations" },
    { label: "Developer platform", icon: "code", description: "API keys, webhooks and the marketplace.", webPath: "/integrations/developer", onlyWhenOn: "developer" },
  ] },
  { title: "Spaces", description: "Shared workspaces and account visibility.", rows: [
    { label: "Spaces & members", icon: "users", description: "Manage Spaces, members and roles.", route: "/space-members" },
    { label: "Account sharing", icon: "eye", description: "Choose what each Space can see.", webPath: "/settings/sources", onlyWhenOn: "spaces" },
  ] },
  { title: "Security & privacy", description: "Protect your account and this phone.", rows: [
    { label: "App lock", icon: "lock", description: "Require your fingerprint, face or phone passcode.", route: "/security" },
    { label: "Sign-in & security", icon: "shield", description: "Password, two-step verification and sessions.", webPath: "/settings/security" },
    { label: "Privacy", icon: "eye", description: "Balance visibility and privacy mode.", webPath: "/settings/privacy" },
  ] },
  { title: "Reports & plan", description: "Summary preferences and your subscription.", rows: [
    { label: "Report schedule", icon: "calendar", description: "Choose when and where summaries arrive.", route: "/report-settings" },
    { label: "Plan & billing", icon: "file-text", description: "Your plan and what it includes.", webPath: "/settings/billing" },
  ] },
];

/** Groups with the rows the server hasn't switched on removed; empty groups are dropped. */
export function visibleSettingsGroups(flags: MoreFlags | null): SettingsGroup[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => !row.onlyWhenOn || flags?.[row.onlyWhenOn] === true),
  })).filter((group) => group.rows.length > 0);
}
