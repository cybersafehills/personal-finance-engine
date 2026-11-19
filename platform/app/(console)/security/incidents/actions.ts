"use server";

import { requireSession } from "../../../../lib/console/access";
import { friendlyError } from "../../../../lib/console/errors";
import { back } from "../../../../lib/console/flash";

const UUID = /^[0-9a-f-]{36}$/i;
const SEV = ["sev1", "sev2", "sev3", "sev4"];
const CAT = ["availability", "data_integrity", "security", "third_party", "other"];
const SRC = ["manual", "health_check", "customer_report", "monitoring"];
const STATUS = ["open", "investigating", "contained", "resolved"];
const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? "").slice(0, max);

export async function declareIncident(form: FormData) {
  const session = await requireSession();
  const severity = str(form, "severity", 5), category = str(form, "category", 20), source = str(form, "source", 20);
  if (!SEV.includes(severity) || !CAT.includes(category) || !SRC.includes(source)) back("/security/incidents", "err", "Choose severity, category and source.");
  const { data, error } = await session.supabase.rpc("console_incident_declare", {
    p_title: str(form, "title", 160), p_severity: severity, p_category: category, p_detection_source: source, p_summary: str(form, "summary") || null,
  });
  if (error) back("/security/incidents", "err", friendlyError(error.message));
  back(`/security/incidents/${data}`, "ok", "Incident declared.");
}

export async function addUpdate(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36), kind = str(form, "kind", 15);
  if (!UUID.test(id) || !["update", "containment"].includes(kind)) back("/security/incidents", "err", "Unknown incident.");
  const { error } = await session.supabase.rpc("console_incident_add_update", { p_id: id, p_kind: kind, p_body: str(form, "body") });
  back(`/security/incidents/${id}`, error ? "err" : "ok", error ? friendlyError(error.message) : kind === "containment" ? "Containment recorded." : "Update added.");
}

export async function setIncidentStatus(form: FormData) {
  const session = await requireSession();
  const id = str(form, "id", 36), status = str(form, "status", 15);
  if (!UUID.test(id) || !STATUS.includes(status)) back("/security/incidents", "err", "Unknown incident or status.");
  const { error } = await session.supabase.rpc("console_incident_set_status", { p_id: id, p_status: status, p_note: str(form, "note", 500) || null });
  back(`/security/incidents/${id}`, error ? "err" : "ok", error ? friendlyError(error.message) : `Status set to ${status}.`);
}
