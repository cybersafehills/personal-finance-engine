import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  buildStatementCoverageMetadata,
  buildStatementSourceMetadata,
  dataSourceLabelForProvider,
  deriveCoverageWarnings,
  type StatementCoverageFact,
  type StatementSourceDescriptor,
} from "./statement-coverage.ts";

function source(
  over: Partial<StatementSourceDescriptor> & { id: string },
): StatementSourceDescriptor {
  return {
    provider: "mtn_momo",
    sourceType: "mobile_money",
    displayName: "MTN MoMo",
    maskedIdentifier: "MTN ...4821",
    ...over,
  };
}

function covFact(
  over: Partial<StatementCoverageFact> & { occurredAt: string },
): StatementCoverageFact {
  return {
    principalEffectMinor: -100,
    feeEffectMinor: 0,
    balanceAfterMinor: null,
    ...over,
  };
}

Deno.test("dataSourceLabelForProvider covers known providers and a fallback", () => {
  assertEquals(
    dataSourceLabelForProvider("mtn_momo"),
    "MTN Mobile Money activity captured by OneLedger",
  );
  assertEquals(
    dataSourceLabelForProvider("airtel_money"),
    "Airtel Money activity captured by OneLedger",
  );
  assertEquals(
    dataSourceLabelForProvider("bank"),
    "Bank account activity recorded in OneLedger",
  );
  assertEquals(
    dataSourceLabelForProvider("something_new"),
    "Financial activity recorded in OneLedger",
  );
});

Deno.test("buildStatementSourceMetadata: single source", () => {
  const meta = buildStatementSourceMetadata([source({ id: "s1" })]);
  assertEquals(meta.sources.length, 1);
  assertEquals(meta.sources[0].maskedIdentifier, "MTN ...4821");
  assertEquals(
    meta.sources[0].dataSourceLabel,
    "MTN Mobile Money activity captured by OneLedger",
  );
  assertEquals(
    meta.summaryLabel,
    "MTN Mobile Money activity captured by OneLedger",
  );
});

Deno.test("buildStatementSourceMetadata: several accounts, same provider", () => {
  const meta = buildStatementSourceMetadata([
    source({ id: "s1" }),
    source({ id: "s2", maskedIdentifier: "MTN ...9999" }),
  ]);
  assertEquals(
    meta.summaryLabel,
    "MTN Mobile Money activity across 2 accounts, recorded in OneLedger",
  );
});

Deno.test("buildStatementSourceMetadata: several providers", () => {
  const meta = buildStatementSourceMetadata([
    source({ id: "s1", provider: "mtn_momo" }),
    source({ id: "s2", provider: "bank", sourceType: "bank_account" }),
  ]);
  assertEquals(
    meta.summaryLabel,
    "Activity across 2 accounts and multiple providers, recorded in OneLedger",
  );
});

Deno.test("buildStatementSourceMetadata: no sources", () => {
  const meta = buildStatementSourceMetadata([]);
  assertEquals(meta.summaryLabel, "Financial activity recorded in OneLedger");
});

Deno.test("deriveCoverageWarnings: no facts -> nothing", () => {
  assertEquals(deriveCoverageWarnings([]), []);
});

Deno.test("deriveCoverageWarnings: no balance data anywhere is noted", () => {
  const facts = [
    covFact({ occurredAt: "2026-08-01T00:00:00.000Z" }),
    covFact({ occurredAt: "2026-08-08T00:00:00.000Z" }),
  ];
  const w = deriveCoverageWarnings(facts);
  assertEquals(w.length, 1);
  assertEquals(w[0].kind, "no_balance_data");
});

Deno.test("deriveCoverageWarnings: a regular cadence with consistent balances is clean", () => {
  const facts: StatementCoverageFact[] = [];
  let bal = 1_000;
  for (let i = 0; i < 6; i++) {
    bal -= 100;
    facts.push({
      occurredAt: new Date(Date.UTC(2026, 7, 1 + i * 7)).toISOString(),
      principalEffectMinor: -100,
      feeEffectMinor: 0,
      balanceAfterMinor: bal,
    });
  }
  assertEquals(deriveCoverageWarnings(facts), []);
});

Deno.test("deriveCoverageWarnings: a long interior gap out of pattern is flagged", () => {
  const facts = [
    covFact({ occurredAt: "2026-08-01T00:00:00.000Z" }),
    covFact({ occurredAt: "2026-08-03T00:00:00.000Z" }),
    covFact({ occurredAt: "2026-08-05T00:00:00.000Z" }),
    covFact({ occurredAt: "2026-09-14T00:00:00.000Z" }), // ~40-day jump
    covFact({ occurredAt: "2026-09-16T00:00:00.000Z" }),
  ];
  const gaps = deriveCoverageWarnings(facts).filter((w) =>
    w.kind === "possible_gap"
  );
  assertEquals(gaps.length, 1);
  assertEquals(gaps[0], {
    kind: "possible_gap",
    fromIso: "2026-08-05T00:00:00.000Z",
    toIso: "2026-09-14T00:00:00.000Z",
    detail: gaps[0].kind === "possible_gap" ? gaps[0].detail : "",
  });
});

Deno.test("deriveCoverageWarnings: a sparse account with too few points is not gap-flagged", () => {
  const facts = [
    covFact({ occurredAt: "2026-01-01T00:00:00.000Z" }),
    covFact({ occurredAt: "2026-05-01T00:00:00.000Z" }),
    covFact({ occurredAt: "2026-09-01T00:00:00.000Z" }),
  ];
  const gaps = deriveCoverageWarnings(facts).filter((w) =>
    w.kind === "possible_gap"
  );
  assertEquals(gaps.length, 0);
});

Deno.test("deriveCoverageWarnings: a balance that jumps more than the transaction explains is flagged", () => {
  const facts: StatementCoverageFact[] = [
    {
      occurredAt: "2026-08-01T00:00:00.000Z",
      principalEffectMinor: -100,
      feeEffectMinor: 0,
      balanceAfterMinor: 900,
    },
    // expected 900 + (-100) = 800, but recorded 500 -> discontinuity
    {
      occurredAt: "2026-08-02T00:00:00.000Z",
      principalEffectMinor: -100,
      feeEffectMinor: 0,
      balanceAfterMinor: 500,
    },
    {
      occurredAt: "2026-08-03T00:00:00.000Z",
      principalEffectMinor: -100,
      feeEffectMinor: 0,
      balanceAfterMinor: 400,
    },
  ];
  const disc = deriveCoverageWarnings(facts).filter((w) =>
    w.kind === "balance_discontinuity"
  );
  assertEquals(disc.length, 1);
  assertEquals(
    disc[0].kind === "balance_discontinuity" ? disc[0].atIso : "",
    "2026-08-02T00:00:00.000Z",
  );
});

Deno.test("deriveCoverageWarnings: discontinuity reports are capped", () => {
  const facts: StatementCoverageFact[] = [];
  for (let i = 0; i < 20; i++) {
    facts.push({
      occurredAt: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
      principalEffectMinor: -100,
      feeEffectMinor: 0,
      balanceAfterMinor: i * 1_000, // never matches prev + effect
    });
  }
  const disc = deriveCoverageWarnings(facts).filter((w) =>
    w.kind === "balance_discontinuity"
  );
  assert(disc.length <= 5);
});

Deno.test("buildStatementCoverageMetadata: complete wording and no filter", () => {
  const { source: src, coverage } = buildStatementCoverageMetadata({
    facts: [
      {
        occurredAt: "2026-08-01T00:00:00.000Z",
        principalEffectMinor: -100,
        feeEffectMinor: 0,
        balanceAfterMinor: 900,
      },
      {
        occurredAt: "2026-08-08T00:00:00.000Z",
        principalEffectMinor: -100,
        feeEffectMinor: 0,
        balanceAfterMinor: 800,
      },
    ],
    sources: [source({ id: "s1" })],
  });
  assertEquals(coverage.complete, true);
  assert(
    coverage.statementLabel.startsWith("Complete for the financial records"),
  );
  assertEquals(coverage.filtered, false);
  assertEquals(coverage.filterSummary, null);
  assertEquals(src.sources.length, 1);
});

Deno.test("buildStatementCoverageMetadata: a filter is always surfaced", () => {
  const { coverage } = buildStatementCoverageMetadata({
    facts: [],
    sources: [source({ id: "s1" })],
    filters: { direction: "out" },
  });
  assertEquals(coverage.filtered, true);
  assertEquals(coverage.filterSummary, "Money Out only");
});

Deno.test("buildStatementCoverageMetadata: compound filters are joined", () => {
  const { coverage } = buildStatementCoverageMetadata({
    facts: [],
    sources: [source({ id: "s1" })],
    filters: { direction: "out", category: "Rent", merchant: "MTN" },
  });
  assertEquals(coverage.filtered, true);
  assertEquals(
    coverage.filterSummary,
    'Money Out only · Category: Rent · Merchant matches "MTN"',
  );
});

Deno.test("buildStatementCoverageMetadata: a detected gap makes it not complete", () => {
  const { coverage } = buildStatementCoverageMetadata({
    facts: [
      covFact({ occurredAt: "2026-08-01T00:00:00.000Z" }),
      covFact({ occurredAt: "2026-08-03T00:00:00.000Z" }),
      covFact({ occurredAt: "2026-08-05T00:00:00.000Z" }),
      covFact({ occurredAt: "2026-09-14T00:00:00.000Z" }),
      covFact({ occurredAt: "2026-09-16T00:00:00.000Z" }),
    ],
    sources: [source({ id: "s1" })],
  });
  assertEquals(coverage.complete, false);
  assert(coverage.warnings.some((w) => w.kind === "possible_gap"));
});
