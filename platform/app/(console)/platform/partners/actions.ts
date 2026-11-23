"use server";

import { requireSession } from "../../../../lib/console/access";
import { friendlyError } from "../../../../lib/console/errors";
import { back } from "../../../../lib/console/flash";

const UUID = /^[0-9a-f-]{36}$/i;
const KINDS = ["brand", "agency", "organization", "financial_provider"];
const CATS = ["Connectivity", "Learning", "Banking"];
const DECISIONS = ["approve", "request_changes", "reject", "pause", "resume", "end"];
const FORMATS = ["wide", "square", "tall", "bar"];
const PLACEMENTS = ["home", "pay-person", "pay-merchant", "plan"];
const str = (f: FormData, k: string, max = 1000) => String(f.get(k) ?? "").slice(0, max);

export async function submitOffer(form: FormData) {
  const session = await requireSession();
  const kind = str(form, "kind", 20), category = str(form, "category", 20), ends = str(form, "ends_on", 10);
  if (!KINDS.includes(kind) || !CATS.includes(category) || !/^\d{4}-\d{2}-\d{2}$/.test(ends)) back("/platform/partners", "err", "Choose the advertiser type, category and an end date.");
  const { data, error } = await session.supabase.rpc("console_partner_offer_create", {
    p_advertiser_name: str(form, "advertiser", 120), p_advertiser_kind: kind, p_category: category,
    p_title: str(form, "title", 80), p_benefit: str(form, "benefit", 160), p_eligibility: str(form, "eligibility", 300),
    p_terms: str(form, "terms"), p_destination_url: str(form, "destination", 500), p_ends_on: ends,
    p_home_featured: form.get("home_featured") === "on", p_financial_disclosure: str(form, "disclosure", 600) || null,
  });
  if (error) back("/platform/partners", "err", friendlyError(error.message));
  back(`/platform/partners/${data}`, "ok", "Offer submitted for review.");
}

export async function decideOffer(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36), decision = str(form, "decision", 20);
  if (!UUID.test(id) || !DECISIONS.includes(decision)) back("/platform/partners", "err", "Unknown offer or decision.");
  const { error } = await session.supabase.rpc("console_partner_offer_decide", { p_id: id, p_decision: decision, p_note: str(form, "note", 500) || null });
  back(`/platform/partners/${id}`, error ? "err" : "ok", error ? friendlyError(error.message) : "Decision recorded.");
}

export async function savePlacement(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 20), format = str(form, "format", 10), mode = str(form, "mode", 10);
  const interval = Number(str(form, "interval", 3));
  if (!PLACEMENTS.includes(id) || !FORMATS.includes(format) || !["static", "carousel"].includes(mode) || !Number.isInteger(interval)) back("/platform/partners/placements", "err", "Check the placement settings.");
  const offerIds = form.getAll("offers").map(String).filter((x) => UUID.test(x));
  const { error } = await session.supabase.rpc("console_partner_placement_set", {
    p_id: id, p_enabled: form.get("enabled") === "on", p_format: format, p_mode: mode,
    p_interval_sec: interval, p_loop: form.get("loop") === "on", p_offer_ids: offerIds,
  });
  back("/platform/partners/placements", error ? "err" : "ok", error ? friendlyError(error.message) : "Placement saved.");
}

export async function setDelivery(form: FormData) {
  const session = await requireSession();
  const enabled = str(form, "enabled", 5) === "true";
  const { error } = await session.supabase.rpc("console_partner_delivery_set", { p_enabled: enabled });
  back("/platform/partners/placements", error ? "err" : "ok", error ? friendlyError(error.message) : enabled ? "Delivery is ON. Approved offers can now reach users." : "Delivery is OFF. No sponsored content reaches users.");
}
