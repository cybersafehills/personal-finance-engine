import type { GuideId } from "./model";

export const GUIDE_REVISION = 3;
export type GuideStep = {
  id: string;
  anchor: string;
  route?: string;
  section: string;
  sectionTitle: string;
  title: string;
  body: string;
  action: string;
  follow?: boolean;
  /** If an entry is hidden, never navigate to the feature behind it. */
  entry?: boolean;
};
export const GUIDE_GROUPS = ["Start here", "Track & understand", "Plan your money", "Pay & request", "Records & preferences"] as const;
export type GuideGroup = typeof GUIDE_GROUPS[number];
export type GuideDefinition = {
  group: GuideGroup;
  id: GuideId;
  title: string;
  description: string;
  icon: "compass" | "radio" | "list" | "inbox" | "target" | "file-text" | "send" | "users";
  missing: string;
  steps: GuideStep[];
};
type StepInput = Omit<GuideStep, "section" | "sectionTitle" | "action"> & { action?: string };
function section(id: string, title: string, steps: StepInput[]): GuideStep[] {
  return steps.map(step => ({ ...step, section: id, sectionTitle: title, action: step.action ?? "Next" }));
}
function tool(id: string, title: string, route: string, pageAnchor: string, body: string): GuideStep[] {
  return section(id, title, [
    { id: `${id}-entry`, anchor: `tool-${route}`, route: "/more", title: `Find ${title.toLowerCase()} here`, body: `Open ${title} from More.`, action: `Open ${title}`, entry: true },
    { id: `${id}-page`, anchor: pageAnchor, route, title, body },
  ]);
}
export function guideDefinitions(ios: boolean): GuideDefinition[] {
  const home = section("home", "Home", [
    { id: "home-wallet", anchor: "overview", route: "/", title: "Your money at a glance", body: "See your balances and recent activity here. Tap the eye on a wallet to hide its amount." },
    { id: "home-add", anchor: "add-transaction", route: "/", title: "Cash counts, too", body: "Use Add transaction for cash or missing activity. Recording it does not send money." },
    { id: "home-cash-flow", anchor: "home-cash-flow", route: "/", title: "Follow money in and money out", body: "Compare money received and spent. A monthly comparison needs enough recorded activity." },
    { id: "home-recent", anchor: "home-recent", route: "/", title: "Your latest activity", body: "Recent transactions give you a quick check. View all opens the full list, where you can search and filter." },
    { id: "home-spending", anchor: "home-spending", route: "/", title: "Understand your spending", body: "Expand this section to see spending by category. Pin it to keep it open." },
    { id: "home-trends", anchor: "home-trends", route: "/", title: "Look beyond today", body: "Expand Trends to compare activity over time. New accounts may not have enough data yet." },
  ]);
  const wallets = section("wallets", "Wallets", [
    { id: "wallets-entry", anchor: "home-wallets-manage", route: "/", title: "Keep your accounts together", body: "Manage opens the accounts you can see in this Space.", action: "Open Wallets" },
    { id: "wallets-page", anchor: "page-wallets", route: "/wallets", title: "A place for each balance", body: "Open a wallet for its balance and activity. Check the source and last-update time." },
  ]);
  const transaction = section("transaction", "Transactions", [
    { id: "transactions-entry", anchor: "nav-transactions", route: "/", title: "Every transaction lives here", body: "Open Transactions to find your recorded activity.", action: "Show transactions" },
    { id: "transactions-search", anchor: "transactions-search", route: "/transactions", title: "Find a particular transaction", body: "Search by name, reference or category. You can use this even when you have months of activity." },
    { id: "transactions-filters", anchor: "transactions-filters", route: "/transactions", title: "Narrow the list", body: "Use filters to narrow your activity. Clear them to see the complete list again." },
    { id: "transaction-open", anchor: "first-transaction", route: "/transactions", title: "There is more behind each row", body: "Open a recorded transaction to inspect its details. No example records are created.", action: "Open transaction", follow: true },
    { id: "transaction-category", anchor: "transaction-category", title: "Give your spending some meaning", body: "Check that the category matches what happened. Categories feed your spending summaries and budgets." },
  ]);
  const inbox = section("inbox", "Inbox & reviews", [
    { id: "review-entry", anchor: "review-queue", route: "/transactions", title: "Know what needs attention", body: "Open Inbox to check items awaiting review. They are separate from confirmed activity.", action: "Open Inbox" },
    { id: "review-page", anchor: "page-inbox", route: "/inbox", title: "Review before deciding", body: "Check the source before making a decision. An empty queue means nothing needs review." },
  ]);
  const plan = section("plan", "Plan", [
    { id: "plan-entry", anchor: "nav-plan", route: "/", title: "Make room for what matters", body: "Open Plan to follow your current budget.", action: "Show Plan" },
    { id: "plan-page", anchor: "page-plan", route: "/plan", title: "Your plan starts here", body: "Your current budget appears here. Use the setup option when you are ready to create one." },
    { id: "plan-progress", anchor: "budget-progress", route: "/plan", title: "See how much room is left", body: "Compare spending with your budget. Check the remaining amount and any data-coverage notices." },
  ]);
  const documents = section("documents", "Reports & statements", [
    { id: "reports-entry", anchor: "reports-entry", route: "/more", title: "Find your daily summaries", body: "Open Reports in More to find your saved daily summaries.", action: "Open Reports", entry: true },
    { id: "reports-page", anchor: "page-reports", route: "/reports", title: "Read a saved snapshot", body: "Open an available report to read or download it. A new account may have no reports yet." },
    { id: "statements-entry", anchor: "statements-entry", route: "/more", title: "Find a record for a period", body: "Open Statements for activity records covering selected accounts and dates.", action: "Open Statements", entry: true },
    { id: "statements-page", anchor: "page-statements", route: "/statements", title: "Check coverage before exporting", body: "Check the accounts, dates and coverage notes before downloading. These are OneLedger records, not provider statements." },
  ]);
  const pay = section("pay", "Pay & Services", [
    { id: "pay-entry", anchor: "pay-launcher", route: "/", title: "Your payment tools start here", body: "Open Pay to see available options. This guide never starts a payment.", action: "Show Pay", entry: true },
    { id: "pay-page", anchor: "pay-overview", route: "/pay-sheet", title: "Choose the right payment tool", body: "Choose a payment or service here. You confirm with your provider; never share your PIN." },
    { id: "pay-scan", anchor: "pay-scan", route: "/pay-sheet", title: "Scan when a merchant shows a code", body: "Scan reads a supported code or merchant poster. You review the details next; this guide keeps the camera closed." },
    { id: "pay-request", anchor: "pay-request", route: "/pay-sheet", title: "Ask someone to pay you", body: "Request payment prepares a link to share. The other person chooses whether to pay. This guide creates no requests and shares no links." },
    { id: "pay-services", anchor: "pay-services", route: "/pay-sheet", title: "Find payments and services", body: "Use the available tiles for payments or services. Review every detail before confirming with your provider." },
  ]);
  const recording = section("recording", "Automatic recording", [
    { id: "recording-entry", anchor: "recording", route: "/more", title: "Let your phone help", body: ios ? "Find iPhone Shortcut setup here. You choose what to enable." : "Find phone recording setup here. Notification access remains your choice.", action: "Open recording", follow: true, entry: true },
    { id: "recording-page", anchor: "recording-page", route: ios ? "/shortcuts" : "/connect", title: "Understand the setup before enabling it", body: ios ? "Read the pairing and Shortcut instructions first. This guide installs nothing and changes no device settings." : "Read what OneLedger receives before granting access. This guide changes no permissions." },
  ]);
  const spaces = section("spaces", "Spaces", [
    { id: "spaces-entry", anchor: "space-switcher", route: "/", title: "Check which Space you are in", body: "This is your active Space. Switching changes the activity you see, without automatically sharing an account." },
    { id: "spaces-settings", anchor: "setting-space-members", route: "/settings", title: "Find members and access", body: "Open Spaces & members to inspect membership and roles.", action: "Open Spaces & members" },
    { id: "spaces-page", anchor: "spaces-page", route: "/space-members", title: "Know who belongs to this Space", body: "Check members and roles here. Invites and access changes always require a separate action." },
  ]);
  const settings = section("settings", "Settings & privacy", [
    { id: "settings-entry", anchor: "tool-/settings", route: "/more", title: "Personalize OneLedger", body: "Settings groups profile, accounts, appearance, privacy and security controls.", action: "Open Settings", entry: true },
    { id: "settings-page", anchor: "page-settings", route: "/settings", title: "Your preferences in one place", body: "Use these groups to find the setting you need. A browser arrow identifies tools that open on the web; the tour keeps you inside the app." },
    { id: "profile-entry", anchor: "setting-profile", route: "/settings", title: "Your profile and regional defaults", body: "Profile & region holds your personal details and regional preferences. You decide whether to edit and save them.", action: "Open Profile" },
    { id: "profile-page", anchor: "profile-page", route: "/profile", title: "Review before saving profile changes", body: "Check your profile details here. Fields and photo actions stay under your control; moving through this tour saves nothing." },
    { id: "appearance-entry", anchor: "setting-appearance", route: "/settings", title: "Choose a comfortable appearance", body: "Appearance lets you use a light theme, a dark theme or your phone’s setting.", action: "Open Appearance" },
    { id: "appearance-page", anchor: "page-appearance", route: "/appearance", title: "Follow your phone or choose a theme", body: "Select a theme here when you want to change it. The tour leaves your current preference in place." },
    { id: "security-entry", anchor: "setting-security", route: "/settings", title: "Protect access on this phone", body: "App lock helps protect the app when you return to it. Its availability depends on your device.", action: "Open App lock" },
    { id: "security-page", anchor: "page-app-lock", route: "/security", title: "App lock is your choice", body: "Read the available lock options here. Enabling or disabling protection requires its own action and device verification; the tour changes nothing." },
    { id: "accounts-entry", anchor: "setting-accounts", route: "/settings", title: "Accounts, imports and sharing", body: "Financial accounts and Import a statement open their management tools on the web. Use those actions later to add accounts or historical activity. The tour does not open a browser or alter your data." },
  ]);
  const short = (id: GuideId, title: string, group: GuideGroup, description: string, icon: GuideDefinition["icon"], steps: GuideStep[]): GuideDefinition => ({
    id, title, group, description, icon, steps,
    missing: "This item needs data or setup first. Skip it now, or return later.",
  });
  return [
    short("orientation", "Your first look", "Start here", "Home, activity and where to find your tools", "compass", [home[0], transaction[0], { ...transaction[1], id: "orientation-search", body: "Search your activity here. Other tools and short guides are always available in More." }]),
    short("wallets", "Check a wallet balance", "Start here", "Find your accounts and check balance freshness", "compass", wallets),
    short("add", "Record cash or missing activity", "Start here", "Find manual entry and review before saving", "list", section("add", "Record a transaction", [
      { ...home[1], id: "add-entry", action: "Open manual entry" },
      { id: "add-page", anchor: "page-add-a-transaction", route: "/add-transaction", title: "Choose the account and amount", body: "Enter the details, then review before saving. This guide records nothing and never sends money." },
    ])),
    short("recording", "Record automatically", "Start here", ios ? "Find iPhone Shortcut setup" : "Find phone recording setup", "radio", recording),
    short("transaction", "Find a transaction", "Track & understand", "Open activity, search and filter", "list", transaction.slice(0, 3)),
    short("details", "Understand a transaction", "Track & understand", "Open a record and check its category", "list", transaction.slice(3)),
    short("inbox", "Know what needs attention", "Track & understand", "Find reviews and inspect the source", "inbox", inbox),
    short("spending", "Understand your spending", "Track & understand", "Read cash flow, categories and trends", "target", [home[2], home[4], home[5]]),
    short("people", "Find a person or merchant", "Track & understand", "Find the activity linked to someone", "users", tool("people", "People & merchants", "/people", "page-people-and-merchants", "Choose a person or merchant to see related activity. The guide does not change your contacts.")),
    short("insights", "Explore money patterns", "Track & understand", "Find income and spending insights", "target", tool("insights", "Insights", "/insights", "page-insights", "Review patterns for the selected period. Insights need enough recorded activity.")),
    short("plan", "Make a simple plan", "Plan your money", "Find Plan and read budget progress", "target", plan),
    short("goals", "Follow a savings goal", "Plan your money", "Find your goals and their progress", "target", tool("goals", "Goals", "/goals", "page-goals", "Follow progress toward a goal here. If none exist yet, use the setup option when you are ready.")),
    short("categories", "Explore a spending category", "Plan your money", "Find categories and related activity", "list", tool("categories", "Categories", "/categories", "page-categories", "Choose a category to inspect its activity. Available editing actions depend on your access.")),
    short("bills", "Find an invoice or receipt", "Plan your money", "Find bills available in this Space", "file-text", tool("bills", "Bills", "/bills", "page-bills", "Open an available bill to inspect its details. Actions depend on your access.")),
    short("pay", "Find the Pay tools", "Pay & request", "Open Pay and understand the available services", "send", [pay[0], pay[1], pay[4]]),
    short("scan", "Understand Scan to pay", "Pay & request", "Find Scan and learn what happens next", "send", [pay[0], pay[2]]),
    short("requests", "Request a payment", "Pay & request", "Find requests and check their status", "send", tool("requests", "Payment requests", "/requests", "page-payment-requests", "Create a request when you are ready, then share its link. This guide creates or shares nothing.")),
    short("activity", "Check a prepared payment", "Pay & request", "Find a payment and read its status", "send", tool("payment-activity", "Payment activity", "/payment-activity", "page-payment-activity", "Check prepared payments here. A prepared payment is not proof of provider completion.")),
    short("templates", "Reuse payment details", "Pay & request", "Find saved payment templates", "send", tool("payment-templates", "Payment templates", "/payment-templates", "page-payment-templates", "Choose a template when preparing a payment. Review its details again before confirming anything.")),
    short("ussd", "Find a service code", "Pay & request", "Browse the USSD directory", "send", tool("ussd", "USSD directory", "/ussd", "ussd-page", "Find a supported service and read its instructions. This guide never dials a code.")),
    short("documents", "Read daily reports", "Records & preferences", "Find and open saved daily summaries", "file-text", documents.slice(0, 2)),
    short("statements", "Find an activity statement", "Records & preferences", "Find statements and check coverage", "file-text", documents.slice(2)),
    short("profile", "Manage your profile", "Records & preferences", "Find your details and regional preferences", "users", settings.slice(2, 4)),
    short("appearance", "Change the appearance", "Records & preferences", "Find light, dark and automatic themes", "compass", settings.slice(4, 6)),
    short("security", "Protect the app on this phone", "Records & preferences", "Find app-lock settings", "compass", settings.slice(6, 8)),
    short("spaces", "Keep your Spaces clear", "Records & preferences", "Understand the active Space and membership", "users", spaces),
  ];
}
export function stepMatchesPath(step: GuideStep, path: string) {
  return step.route ? path === step.route : /^\/transaction\/[^/]+$/.test(path);
}
export function sectionProgress(steps: GuideStep[], index: number) {
  const ids = [...new Set(steps.map(step => step.section))];
  const current = steps[index];
  const local = steps.filter(step => step.section === current.section);
  return { title: current.sectionTitle, index: ids.indexOf(current.section) + 1, total: ids.length, step: local.findIndex(step => step.id === current.id) + 1, steps: local.length };
}
/** Missing entry points skip their guarded pages; dynamic detail steps need a real row. */
export function nextStepIndex(steps: GuideStep[], index: number, skip: "item" | "section" = "item") {
  let next = index + 1;
  if (skip === "section" || steps[index].entry) {
    while (next < steps.length && steps[next].section === steps[index].section) next++;
  }
  while (next < steps.length && !steps[next].route) next++;
  return next;
}
export function guideStepIndex(definition: GuideDefinition, progress: { revision?: number; stepId?: string; step: number; status: string } | undefined, replay: boolean) {
  if (replay || progress?.status !== "paused" || progress.revision !== GUIDE_REVISION) return 0;
  const stable = definition.steps.findIndex(step => step.id === progress.stepId);
  return stable >= 0 ? stable : 0;
}
