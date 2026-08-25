// Static, client-side starter templates (spec §13) - not stored in the
// database. Selecting one only pre-fills the /categories/rules/new form;
// nothing is created or activated until the user reviews and submits it,
// same as creating a rule from scratch. Deliberately excludes "Internal
// transfer" and "Cash withdrawal" templates from the spec's list: this
// app already has a dedicated, working transfer-detection subsystem
// (transfer-detection.ts, transfer_links, /transactions/transfers), and
// this categorization engine's policy actions never touch
// transaction_type - templating those two would either duplicate or
// conflict with that existing feature rather than extend it.

export type PolicyTemplate = {
  slug: string;
  label: string;
  description: string;
  defaults: {
    name: string;
    category: string;
    subcategory: string;
    direction: "" | "in" | "out" | "neutral";
  };
};

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    slug: "commute",
    label: "Commuting transport",
    description: "Money sent to a known driver during your usual commute window.",
    defaults: { name: "Commute", category: "Transport", subcategory: "Moto", direction: "out" },
  },
  {
    slug: "meals",
    label: "Meals",
    description: "Money sent during a meal window, optionally to a known merchant.",
    defaults: { name: "Meals", category: "Food", subcategory: "", direction: "out" },
  },
  {
    slug: "rent",
    label: "Rent",
    description: "A recurring monthly payment to your landlord.",
    defaults: { name: "Rent", category: "Housing", subcategory: "Rent", direction: "out" },
  },
  {
    slug: "salary",
    label: "Salary",
    description: "A recurring monthly payment received from your employer.",
    defaults: { name: "Salary", category: "Income", subcategory: "Salary", direction: "in" },
  },
  {
    slug: "subscription",
    label: "Subscription",
    description: "A repeated payment of a similar amount to the same recipient.",
    defaults: { name: "Subscription", category: "Subscriptions", subcategory: "", direction: "out" },
  },
];

export function findPolicyTemplate(slug: string | undefined): PolicyTemplate | undefined {
  return POLICY_TEMPLATES.find((t) => t.slug === slug);
}
