// Single source of truth for the Settings information architecture
// (master prompt sections 22-30 / section 110). The flat, 10-row Settings
// list is replaced by seven named groups, each with a one-line purpose:
//
//   Profile & Preferences   - who you are, regional defaults, shell layout
//   Accounts & Connections  - where money lives + how transactions arrive
//   Spaces & Members        - Personal / Household / Organization + access
//   Reports & Notifications - scheduled summaries + shared-Space alerts
//   Data & Integrations     - import / export / external services
//   Security & Privacy      - sign-in protection + on-screen privacy
//   Billing & Plan          - current plan and what it includes
//
// The two previously duplicated Security entries ("Privacy and security"
// + "Security") are one group here; the standalone "Shared accounts" row
// is folded into "Spaces & Members" as "Account sharing". Rows deep-link
// to the existing pages - this module only decides grouping, labels, and
// visibility, never behaviour. The Settings index renders straight from
// `visibleSettingsGroups`, so the page and this catalogue cannot drift.
//
// Kept framework-free (no `server-only`) so it is unit-testable under
// Deno like navigation.ts.

import type { SurfaceKey } from "./experience-mode.ts";

export type SettingsRow = {
  href: string;
  label: string;
  /** One sentence, present tense, no "you should". Shown under the label. */
  description: string;
  /**
   * Hidden unless this product surface is visible in the active
   * experience mode (`isSurfaceVisible`). `null`/omitted = always shown.
   */
  surface?: SurfaceKey | null;
  /** Hidden unless shared Spaces are enabled for the active workspace. */
  requiresSpaces?: boolean;
};

export type SettingsGroupKey =
  | "profile"
  | "accounts"
  | "spaces"
  | "reports"
  | "data"
  | "security"
  | "billing";

export type SettingsGroup = {
  key: SettingsGroupKey;
  title: string;
  description: string;
  rows: readonly SettingsRow[];
};

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    key: "profile",
    title: "Profile & Preferences",
    description: "Your details, regional defaults, and how the app is laid out.",
    rows: [
      {
        href: "/settings/profile",
        label: "Profile & region",
        description:
          "Your name, country, language, primary currency, and timezone.",
      },
      {
        href: "/settings/appearance",
        label: "Appearance & navigation",
        description:
          "How OneLedger's shell and primary navigation are arranged.",
      },
    ],
  },
  {
    key: "accounts",
    title: "Accounts & Connections",
    description:
      "The accounts your money lives in and how transactions reach OneLedger.",
    rows: [
      {
        href: "/settings/accounts",
        label: "Financial accounts",
        description:
          "The MoMo, bank, cash, and card accounts your transactions belong to.",
      },
      {
        href: "/integrations/connections",
        label: "Connections & devices",
        description:
          "The phones and Shortcuts that send transactions in automatically.",
        surface: "sources",
      },
      {
        href: "/settings/sources/import",
        label: "Import a statement",
        description:
          "Bring past transactions in from a bank or MoMo statement file.",
        surface: "sources",
      },
    ],
  },
  {
    key: "spaces",
    title: "Spaces & Members",
    description:
      "Your Personal Space and any shared households or organizations.",
    rows: [
      {
        href: "/settings/workspace",
        label: "Spaces & members",
        description:
          "Create or manage a shared Space, invite people, and set roles.",
      },
      {
        href: "/settings/sources",
        label: "Account sharing",
        description:
          "Choose what each shared Space sees of an account — nothing, transactions, or the balance.",
        requiresSpaces: true,
      },
    ],
  },
  {
    key: "reports",
    title: "Reports & Notifications",
    description:
      "Scheduled financial summaries and what a shared Space alerts you about.",
    rows: [
      {
        href: "/settings/reports",
        label: "Reports",
        description:
          "Your scheduled summary — when it's generated and where it's sent.",
      },
      {
        href: "/settings/notifications",
        label: "Notifications",
        description: "Budget, goal, and member alerts for a shared Space.",
      },
    ],
  },
  {
    key: "data",
    title: "Data & Integrations",
    description: "Move your data in and out, and connect external services.",
    rows: [
      {
        href: "/integrations",
        label: "Integrations",
        description:
          "Imports, exports, connected workbooks, reconciliation, and external services.",
        surface: "integrations",
      },
      {
        href: "/integrations/developer",
        label: "Developer platform",
        description: "API keys, webhooks, and the marketplace.",
        surface: "developer",
      },
    ],
  },
  {
    key: "security",
    title: "Security & Privacy",
    description:
      "Sign-in protection, active sessions, and on-screen privacy.",
    rows: [
      {
        href: "/settings/security",
        label: "Sign-in & security",
        description: "Password, two-step verification, and active sessions.",
      },
      {
        href: "/settings/privacy",
        label: "Privacy",
        description: "On-screen balance visibility and full privacy mode.",
      },
    ],
  },
  {
    key: "billing",
    title: "Billing & Plan",
    description: "Your plan and what it includes.",
    rows: [
      {
        href: "/settings/billing",
        label: "Plan",
        description: "See your current plan and what each plan includes.",
      },
    ],
  },
] as const;

export type SettingsNavContext = {
  /** `isSpacesEnabled(activeWorkspaceId)` from lib/spaces/gate. */
  spacesEnabled: boolean;
  /**
   * `(s) => isSurfaceVisible(experienceMode, s, { businessEnabled })`.
   * Defaults to "everything visible" so the catalogue is testable without
   * an experience mode.
   */
  surfaceVisible?: (surface: SurfaceKey) => boolean;
};

export function isSettingsRowVisible(
  row: SettingsRow,
  ctx: SettingsNavContext,
): boolean {
  if (row.requiresSpaces && !ctx.spacesEnabled) return false;
  if (row.surface && ctx.surfaceVisible && !ctx.surfaceVisible(row.surface)) {
    return false;
  }
  return true;
}

/**
 * The groups to render for the current user: every group with at least
 * one visible row, in declared order, rows filtered by experience mode +
 * Spaces flag. Pure - safe to call on every Settings render.
 */
export function visibleSettingsGroups(
  ctx: SettingsNavContext,
): SettingsGroup[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => isSettingsRowVisible(row, ctx)),
  })).filter((group) => group.rows.length > 0);
}

/** Every row href in the catalogue (for tests / redirect audits). */
export function allSettingsHrefs(): string[] {
  return SETTINGS_GROUPS.flatMap((g) => g.rows.map((r) => r.href));
}
