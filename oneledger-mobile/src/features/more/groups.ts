// The More screen's destinations, grouped with the web's headings
// (web/lib/navigation.ts MORE_GROUPS). Only screens the app actually has
// are listed; a feature the server says is off is hidden, but an unknown
// answer (offline, older server) hides nothing, so nothing that worked
// before disappears.

export type MoreFlag = "wallets" | "people" | "paymentRequests" | "insightsCenter" | "statements" | "insights" | "spaces" | "bills" | "integrations" | "developer";

export type MoreFlags = Partial<Record<MoreFlag, boolean>>;

export type MoreRoute =
  | "/categories"
  | "/reports"
  | "/bills"
  | "/statements"
  | "/insights"
  | "/people"
  | "/wallets"
  | "/goals"
  | "/requests"
  | "/space-members"
  | "/notifications"
  | "/security"
  | "/settings";

export type MoreLink = {
  route: MoreRoute;
  label: string;
  hint: string;
  requires?: MoreFlag;
  /** Dark by default: shown only when the server says it is on (not when the answer is unknown). */
  onlyWhenOn?: boolean;
};

export type MoreGroup = { title: string; links: MoreLink[] };

export const MORE_GROUPS: readonly MoreGroup[] = [
  {
    title: "Manage money",
    links: [
      { route: "/categories", label: "Categories", hint: "See where your money has gone." },
      { route: "/wallets", label: "Wallets", hint: "Your balances, and how sure we are about each one.", requires: "wallets", onlyWhenOn: true },
      { route: "/goals", label: "Goals", hint: "See how your savings goals are going." },
      { route: "/people", label: "People and merchants", hint: "Who you pay and who pays you.", requires: "people", onlyWhenOn: true },
      { route: "/insights", label: "Insights", hint: "Where your money went this month.", requires: "insightsCenter", onlyWhenOn: true },
      { route: "/bills", label: "Bills", hint: "Invoices and receipts in this Space.", requires: "bills", onlyWhenOn: true },
    ],
  },
  {
    title: "Reports and statements",
    links: [
      { route: "/reports", label: "Reports", hint: "Your daily financial reports." },
      { route: "/statements", label: "Statements", hint: "Generated statements to view or download.", requires: "statements" },
    ],
  },
  {
    title: "Pay & Services",
    links: [
      { route: "/requests", label: "Payment requests", hint: "Ask someone to pay you with a link.", requires: "paymentRequests", onlyWhenOn: true },
    ],
  },
  {
    title: "Account",
    links: [
      { route: "/settings", label: "Settings", hint: "Profile, accounts, Spaces, security and plan." },
      { route: "/security", label: "App lock", hint: "Ask for your fingerprint or face when the app opens." },
    ],
  },
];

/** Groups with switched-off features removed; empty groups are dropped. An explicit `false` hides; dark-by-default features need an explicit `true`. */
export function visibleGroups(flags: MoreFlags | null): MoreGroup[] {
  return MORE_GROUPS.map((group) => ({
    title: group.title,
    links: group.links.filter((l) => {
      if (!l.requires) return true;
      return l.onlyWhenOn ? flags?.[l.requires] === true : flags?.[l.requires] !== false;
    }),
  })).filter((group) => group.links.length > 0);
}

/** Reads the feature flags out of GET /api/mobile/config; null when the answer is unusable. */
export function parseMoreFlags(status: number, body: unknown): MoreFlags | null {
  if (status !== 200 || typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.ok !== true || typeof b.config !== "object" || b.config === null) return null;
  const c = b.config as Record<string, unknown>;
  const flags: MoreFlags = {};
  for (const key of ["statements", "insights", "spaces", "bills", "integrations", "developer", "wallets", "people", "paymentRequests", "insightsCenter"] as const) {
    if (typeof c[key] === "boolean") flags[key] = c[key];
  }
  return flags;
}
