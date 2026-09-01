import { assertEquals } from "jsr:@std/assert@1";
import {
  assessOperationalHealth,
  type OperationalHealthSnapshot,
} from "./operational-health.ts";

const healthySnapshot: OperationalHealthSnapshot = {
  captured_at: "2026-09-01T10:00:00Z",
  window_minutes: 60,
  ingestion: {
    received: 100,
    processed: 100,
    needs_review: 0,
    failed: 0,
    stale_processing_backlog: 0,
    raw_event_pending_backlog: 0,
  },
  duplicates: {
    transactions_created: 100,
    possible_duplicates_created: 1,
    merged_created: 0,
    review_backlog: 1,
    oldest_review_age_seconds: 3600,
  },
  jobs: {
    report_runs_due: 2,
    report_runs_failed: 0,
    report_runs_overdue: 0,
    report_deliveries_attempted: 2,
    report_deliveries_failed: 0,
  },
  email: {
    attempted: 20,
    sent: 20,
    skipped: 0,
    failed: 0,
    pending_outbox: 0,
    oldest_pending_age_seconds: 0,
  },
  reconciliation: {
    created: 2,
    linked: 2,
    conflicts: 0,
    rejected: 0,
    review_backlog: 0,
    oldest_review_age_seconds: 0,
  },
};

Deno.test("operational health classifies a clean aggregate window as healthy", () => {
  const result = assessOperationalHealth(healthySnapshot);
  assertEquals(result.overall, "healthy");
  assertEquals(result.domains, {
    ingestion: "healthy",
    duplicates: "healthy",
    jobs: "healthy",
    email: "healthy",
    reconciliation: "healthy",
  });
});

Deno.test("operational health escalates stale ingestion and delivery failures", () => {
  const result = assessOperationalHealth({
    ...healthySnapshot,
    ingestion: {
      ...healthySnapshot.ingestion,
      stale_processing_backlog: 1,
    },
    email: {
      ...healthySnapshot.email,
      failed: 1,
      sent: 19,
    },
  });
  assertEquals(result.overall, "critical");
  assertEquals(result.domains.ingestion, "critical");
  assertEquals(result.domains.email, "critical");
});

Deno.test("operational health distinguishes quiet domains from healthy evidence", () => {
  const result = assessOperationalHealth({
    ...healthySnapshot,
    ingestion: {
      ...healthySnapshot.ingestion,
      received: 0,
      processed: 0,
    },
    jobs: {
      ...healthySnapshot.jobs,
      report_runs_due: 0,
      report_deliveries_attempted: 0,
    },
    email: {
      ...healthySnapshot.email,
      attempted: 0,
      sent: 0,
    },
    reconciliation: {
      ...healthySnapshot.reconciliation,
      created: 0,
    },
  });
  assertEquals(result.overall, "insufficient_data");
  assertEquals(result.domains.ingestion, "insufficient_data");
  assertEquals(result.domains.jobs, "insufficient_data");
  assertEquals(result.domains.email, "insufficient_data");
  assertEquals(result.domains.reconciliation, "insufficient_data");
});

Deno.test("operational health ages review queues into attention and critical", () => {
  const attention = assessOperationalHealth({
    ...healthySnapshot,
    duplicates: {
      ...healthySnapshot.duplicates,
      oldest_review_age_seconds: 86400,
    },
  });
  assertEquals(attention.domains.duplicates, "attention");

  const critical = assessOperationalHealth({
    ...healthySnapshot,
    reconciliation: {
      ...healthySnapshot.reconciliation,
      review_backlog: 1,
      oldest_review_age_seconds: 259200,
    },
  });
  assertEquals(critical.overall, "critical");
  assertEquals(critical.domains.reconciliation, "critical");
});
