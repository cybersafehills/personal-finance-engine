// Client-safe types + constants for the public payment-network surface.
// Split out from public-queries.ts (which is `server-only`) so client
// components can import them without pulling server code into the bundle.

export type PublicFee = {
  scope: string;
  fee_type: string;
  fixed_fee_minor: number | null;
  percentage_bps: number | null;
  min_fee_minor: number | null;
  max_fee_minor: number | null;
  currency: string;
  note_en: string | null;
  source_label: string | null;
};

export type PublicLimit = {
  scope: string;
  min_txn_minor: number | null;
  max_txn_minor: number | null;
  daily_limit_minor: number | null;
  currency: string;
  is_published_maximum: boolean;
  note_en: string | null;
  source_label: string | null;
};

export type NetworkOverview = {
  id: string;
  slug: string;
  canonical_name: string;
  display_name_en: string;
  description_en: string | null;
  entity_type: string;
  full_interoperability_effective_date: string | null;
  separate_registration_required: boolean | null;
  separate_app_required: boolean | null;
  access_channel_summary_en: string | null;
  custody_note_en: string | null;
  official_source_url: string | null;
  official_source_label: string | null;
  verified_at: string | null;
  regulatory_authority: { name: string; website_url: string | null } | null;
  operators: { operator_role: string; name: string }[];
  fees: PublicFee[];
  limits: PublicLimit[];
  aliases: string[];
};

export type RouteCardData = {
  id: string;
  slug: string;
  display_name_en: string;
  channel: string;
  provider_name: string;
  flow_types: string[];
  verified_at: string | null;
};

export type RouteFinderOptions = {
  sources: { provider_id: string; display_name: string }[];
  destinationTypes: { value: string; label: string }[];
};

export type RouteMenuStep = {
  position: number;
  action_label_en: string | null;
  instruction_en: string;
  expected_menu_label_en: string | null;
  expected_option_number: string | null;
  caution_en: string | null;
};

export type RouteResult = {
  id: string;
  slug: string;
  display_name_en: string;
  description_en: string | null;
  channel: string;
  internet_required: boolean;
  device_compat: string[];
  approved_entry_point_en: string | null;
  risk_text: string | null;
  caution_text: string | null;
  verified_at: string | null;
  official_source_url: string | null;
  official_source_label: string | null;
  provider_name: string;
  network: { slug: string; canonical_name: string } | null;
  service_code: { slug: string; ussd_template: string; accepts_parameters: boolean } | null;
  flow_types: string[];
  menu_steps: RouteMenuStep[];
  fees: PublicFee[];
  limits: PublicLimit[];
  last_verified_evidence_date: string | null;
  public_source: { organization: string; title: string | null; source_url: string | null } | null;
};

export const FLOW_LABELS: Record<string, string> = {
  account_to_wallet: "Bank account → mobile wallet",
  wallet_to_account: "Mobile wallet → bank account",
  account_to_account: "Bank account → another bank account",
  wallet_to_wallet: "Mobile wallet → another wallet",
  merchant_payment: "Merchant payment",
  other: "Other",
};
