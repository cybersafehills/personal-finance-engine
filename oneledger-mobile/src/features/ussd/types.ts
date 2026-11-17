import type { ParamKind } from "./capability";

export const CATEGORY_LABELS = {
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
} as const;

export type DirectoryCategory = keyof typeof CATEGORY_LABELS;
export const DIRECTORY_CATEGORIES = Object.keys(CATEGORY_LABELS) as DirectoryCategory[];

export type ServiceCodeListItem = {
  id: string;
  slug: string;
  category: DirectoryCategory;
  name: string;
  template: string;
  acceptsParameters: boolean;
  state: string;
  verified: boolean;
  provider: string;
};

export type ServiceCodeParameter = {
  key: string;
  kind: ParamKind;
  label: string;
  required: boolean;
  position: number;
  formatRegex: string | null;
  formatHint: string | null;
  minLength: number | null;
  maxLength: number | null;
};

export type ServiceCodeDetail = ServiceCodeListItem & {
  description: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  riskText: string | null;
  cautionText: string | null;
  replacementSlug: string | null;
  parameters: ServiceCodeParameter[];
  steps: string[];
};
