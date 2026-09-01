# Operational health and initial SLOs

OneLedger derives operational health from its existing durable state. It does
not copy payloads into another logging product. The service-only
`get_operational_health_snapshot(window_minutes)` RPC returns aggregate counts
and queue ages for ingestion, duplicate review, report jobs, transactional
email, and payment reconciliation. It returns no tenant/customer identifiers,
payloads, credentials, destinations, provider references, or financial values.

`GET /api/admin/operational-health?window_minutes=60` exposes that snapshot to
operators behind the same constant-time `X-Report-Cron-Secret` check as the
existing cron and email-health routes. A critical assessment returns HTTP 503,
making the endpoint suitable for a read-only uptime check.

## Initial objectives

These thresholds are deliberately simple beta SLOs and should be revisited
after four representative weeks:

| Domain | Healthy | Attention | Critical |
| --- | --- | --- | --- |
| Ingestion | failure rate under 1%; no item processing for over 5 minutes | failure rate 1–5% | failure rate at least 5%, or any stale message/raw-event backlog |
| Duplicate review | oldest candidate under 24 hours | 24–72 hours | at least 72 hours |
| Report jobs | due runs/deliveries complete without failures | no scheduled work in the window is reported as `insufficient_data` | any failed delivery/run, or a run overdue by 15 minutes |
| Email | combined failed/skipped rate under 2%; queue under 5 minutes | 2–5% failure or queue age 5–15 minutes | at least 5% failure or queue age at least 15 minutes |
| Reconciliation | oldest review item under 24 hours | 24–72 hours | at least 72 hours |

`insufficient_data` is not treated as proof of health. It is neutral in the
aggregate response so naturally quiet domains do not page an operator, but a
release gate must still require a representative observation window.

Example:

```sh
curl --fail --silent --show-error \
  -H "X-Report-Cron-Secret: $REPORT_CRON_SECRET" \
  "https://www.oneledger.me/api/admin/operational-health?window_minutes=60"
```

