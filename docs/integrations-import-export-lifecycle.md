# Import & export lifecycle

Companion to `integrations-architecture.md`. Traces a row of data through
the Integrations subsystem and names the table state at each step.

## Import

```
Upload            uploadImportFile action
  MIME/ext/size/parseability checks; nothing written until the file parses
  -> import_batches (status='uploaded') + the file in integration-imports
  -> import_records (status='needs_mapping', raw_cells)
  -> profileTabularData() -> import_batches.detected, status='profiled'
  -> integration_events 'import.uploaded'

Map + validate    applyImportMapping action
  suggestMapping / a matched import_templates row / manual overrides
  -> normalizeImportRow() per row
  -> validateNormalizedRow() -> import_records.validation, status
       blocking issue      -> 'invalid'
       warning issue        -> 'needs_review'
       clean                -> 'ready'
  -> matchNormalizedRow() vs existing ledger rows in the date window
       likely/exact hit on a 'ready' row -> 'needs_review' + a
       possible_duplicate issue
  -> import_batches.mapping + row_counts, status='validated'
  -> integration_events 'import.mapped'

Review            /integrations/imports/[id] (ImportStagingReview)
  bulk approve/ignore/re-open -> import_records.status
  pick a target: import_batches.financial_source_id (must own it, must
  resolve to an account)

Commit            commit_import_batch(p_batch_id)  [SECURITY DEFINER]
  integration.import_approve + owns the source
  per 'ready'/'approved' row:
    deterministic payload_hash 'import|batch|row|...' -> raw_financial_events
      (already present -> mark 'imported', skip: idempotent re-commit)
    compute_transaction_fingerprint -> transactions
      fingerprint already in the Space -> dedupe_state='possible_duplicate'
      (flows into /transactions/review; never auto-merged)
    import_records.status='imported', canonical_transaction_id set
  import_batches.status='imported', committed_at
  record_space_audit_event 'import.committed'

Undo              rollback_import_batch(p_batch_id)  [SECURITY DEFINER]
  removes only this batch's transactions that are NOT merged / hand-edited
  (category_source='manual') / a merge target / referenced elsewhere
  (FK violation caught per row -> retained, reason recorded)
  freed rows -> import_records.status='approved' (re-committable)
  all retained -> status='rolled_back'; else stays 'imported'
  record_space_audit_event 'import.rolled_back'
```

## Export

```
Configure         createExportJob action (integration.export)
  -> export_jobs (status='queued')
  countExportRows() estimate
    <= 20 000 rows -> runExportJob() inline
    else           -> left for the run-export-jobs cron

runExportJob(jobId)
  resolvePeriod(config.period)        (relative preset or absolute range)
  buildExportDataset()               (service-role, workspace-pinned, paged)
  buildCsv() | buildXlsx()           (csv-safe formula neutralisation)
  upload to integration-exports/{workspace}/{job}/{file}
  export_jobs.status='completed', storage_path, row_count, completed_at
  integration_events 'export.completed' | 'export.failed'

Download          GET /api/integrations/exports/[id]
  session-authed, RLS-scoped, integration.export
  -> 5-minute signed URL, 302 redirect

Schedule          createExportSchedule action (integration.sync_manage)
  -> export_schedules (cadence + next_run_at)
  run-export-jobs cron: next_run_at passed -> new export_jobs row + run +
  advance next_run_at; failure -> notifications row for the owner

Retention         run-export-jobs cron
  completed export_jobs older than 7 days -> storage object removed,
  storage_path nulled, history row kept
```

## Statuses at a glance

| Table | Column | Values |
| --- | --- | --- |
| `import_batches` | `status` | uploaded, profiled, mapped, validated, committing, imported, failed, rolled_back |
| `import_records` | `status` | needs_mapping, ready, needs_review, possible_duplicate, invalid, approved, ignored, imported, failed, conflict |
| `export_jobs` | `status` | queued, processing, completed, failed |
| `transactions` | `dedupe_state` | unique, possible_duplicate, confirmed_duplicate, merged |
