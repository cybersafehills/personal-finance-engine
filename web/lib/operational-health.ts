export type OperationalHealthStatus =
  | "healthy"
  | "attention"
  | "critical"
  | "insufficient_data";

export type OperationalHealthSnapshot = {
  captured_at: string;
  window_minutes: number;
  ingestion: {
    received: number;
    processed: number;
    needs_review: number;
    failed: number;
    stale_processing_backlog: number;
    raw_event_pending_backlog: number;
  };
  duplicates: {
    transactions_created: number;
    possible_duplicates_created: number;
    merged_created: number;
    review_backlog: number;
    oldest_review_age_seconds: number;
  };
  jobs: {
    report_runs_due: number;
    report_runs_failed: number;
    report_runs_overdue: number;
    report_deliveries_attempted: number;
    report_deliveries_failed: number;
  };
  email: {
    attempted: number;
    sent: number;
    skipped: number;
    failed: number;
    pending_outbox: number;
    oldest_pending_age_seconds: number;
  };
  reconciliation: {
    created: number;
    linked: number;
    conflicts: number;
    rejected: number;
    review_backlog: number;
    oldest_review_age_seconds: number;
  };
};

export type OperationalHealthAssessment = {
  overall: OperationalHealthStatus;
  domains: Record<
    "ingestion" | "duplicates" | "jobs" | "email" | "reconciliation",
    OperationalHealthStatus
  >;
};

function failureRate(failed: number, total: number): number {
  return total > 0 ? failed / total : 0;
}

function worstStatus(
  statuses: OperationalHealthStatus[],
): OperationalHealthStatus {
  const rank: Record<OperationalHealthStatus, number> = {
    healthy: 0,
    insufficient_data: 1,
    attention: 2,
    critical: 3,
  };
  return statuses.reduce((worst, status) =>
    rank[status] > rank[worst] ? status : worst
  );
}

export function assessOperationalHealth(
  snapshot: OperationalHealthSnapshot,
): OperationalHealthAssessment {
  const ingestion: OperationalHealthStatus = snapshot.ingestion.received === 0
    ? "insufficient_data"
    : snapshot.ingestion.stale_processing_backlog > 0 ||
        snapshot.ingestion.raw_event_pending_backlog > 0 ||
        failureRate(
            snapshot.ingestion.failed,
            snapshot.ingestion.received,
          ) >= 0.05
    ? "critical"
    : failureRate(snapshot.ingestion.failed, snapshot.ingestion.received) >=
        0.01
    ? "attention"
    : "healthy";

  const duplicates: OperationalHealthStatus =
    snapshot.duplicates.oldest_review_age_seconds >= 259200
      ? "critical"
      : snapshot.duplicates.oldest_review_age_seconds >= 86400
      ? "attention"
      : "healthy";

  const jobs: OperationalHealthStatus = snapshot.jobs.report_runs_failed > 0 ||
      snapshot.jobs.report_runs_overdue > 0 ||
      snapshot.jobs.report_deliveries_failed > 0
    ? "critical"
    : snapshot.jobs.report_runs_due === 0 &&
        snapshot.jobs.report_deliveries_attempted === 0
    ? "insufficient_data"
    : "healthy";

  const emailFailureRate = failureRate(
    snapshot.email.failed + snapshot.email.skipped,
    snapshot.email.attempted,
  );
  const email: OperationalHealthStatus =
    snapshot.email.oldest_pending_age_seconds >= 900 ||
      emailFailureRate >= 0.05
      ? "critical"
      : snapshot.email.oldest_pending_age_seconds >= 300 ||
          emailFailureRate >= 0.02
      ? "attention"
      : snapshot.email.attempted === 0 && snapshot.email.pending_outbox === 0
      ? "insufficient_data"
      : "healthy";

  const reconciliation: OperationalHealthStatus =
    snapshot.reconciliation.oldest_review_age_seconds >= 259200
      ? "critical"
      : snapshot.reconciliation.oldest_review_age_seconds >= 86400
      ? "attention"
      : snapshot.reconciliation.created === 0 &&
          snapshot.reconciliation.review_backlog === 0
      ? "insufficient_data"
      : "healthy";

  const domains = { ingestion, duplicates, jobs, email, reconciliation };
  return {
    overall: worstStatus(Object.values(domains)),
    domains,
  };
}
