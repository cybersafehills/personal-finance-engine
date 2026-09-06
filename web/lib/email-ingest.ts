// Email statement ingestion (ADR 0018, Slice B). A financial source can be
// given a private inbound address; mail sent there is parsed by the
// `inbound-email` Edge Function (Resend Inbound webhook) and imported
// through the SAME path as a manual CSV upload
// (import_statement_transactions -> _import_statement_rows).
//
// This module is the web-side gate + address formatter only. The token
// lifecycle RPCs (set_/rotate_/clear_source_ingest_email) live in
// migration 20261204000000; the parse + import happens server-side in the
// Edge Function, never in the browser.

// OFF unless exactly "true". Even when on, no address exists for a source
// until its owner mints one, and the Edge Function itself is a hard no-op
// without EMAIL_STATEMENT_INGEST_ENABLED + INBOUND_EMAIL_WEBHOOK_SECRET
// set as Edge Function secrets.
export function isEmailStatementIngestEnabled(): boolean {
  return process.env.EMAIL_STATEMENT_INGEST_ENABLED === "true";
}

// The inbound domain Resend is configured to receive for. Address shape is
// `u+<token>@<domain>` (the local-part tag is ignored by the resolver -
// only the opaque token matters). Kept server-only; surfaced to the user
// pre-formatted by inboundAddressFor().
export function inboundEmailDomain(): string {
  return process.env.INBOUND_EMAIL_DOMAIN?.trim() || "in.oneledger.me";
}

export function inboundAddressFor(token: string): string {
  return `u+${token}@${inboundEmailDomain()}`;
}
