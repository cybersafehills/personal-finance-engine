// Directory category vocabulary. Kept in its own module (no
// `server-only`) so both server queries and client filter UIs can import
// it without dragging the Supabase server client into a browser bundle.

export const DIRECTORY_CATEGORIES = [
  "mobile_money",
  "banking",
  "utilities",
  "government",
  "taxes",
  "health_insurance",
  "telecom",
  "merchant_payment",
  "airtime_data",
  "account_inquiry",
  "other",
] as const;

export type DirectoryCategory = (typeof DIRECTORY_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<DirectoryCategory, string> = {
  mobile_money: "Mobile Money",
  banking: "Banking",
  utilities: "Utilities",
  government: "Government services",
  taxes: "Taxes",
  health_insurance: "Health & insurance",
  telecom: "Telecom services",
  merchant_payment: "Merchant payments",
  airtime_data: "Airtime & data",
  account_inquiry: "Account inquiries",
  other: "Other",
};
