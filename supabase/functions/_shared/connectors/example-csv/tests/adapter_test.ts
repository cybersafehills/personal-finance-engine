import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { CONNECTOR_ADAPTER_VERSION } from "../../../connector-adapter.ts";
import {
  buildExampleCsvDiscoveryPayload,
  createExampleCsvAdapter,
  EXAMPLE_CSV_CONNECTOR_KEY,
  type ExampleCsvConfiguration,
  type FetchImpl,
  toRawEvents,
} from "../adapter.ts";
import { parseCsv } from "../csv.ts";

const INSTALLATION = {
  installationId: "00000000-0000-0000-0000-000000000001",
  connectorKey: EXAMPLE_CSV_CONNECTOR_KEY,
};

const GOOD_CONFIG = {
  csvUrl: "https://data.example.com/ledger.csv?token=secret-do-not-leak",
  currency: "rwf",
  sourceLabel: "Demo ledger",
};

const CSV_BODY = [
  "id,date,description,amount",
  "r1,2026-01-05,Coffee,-3.50",
  'r2,2026-01-06,"Salary, January",4200',
  'r3,2026-01-07,"Quote ""x""",12.1',
  "",
].join("\n");

function stubFetch(
  body: string,
  { ok = true, status = 200 }: { ok?: boolean; status?: number } = {},
): FetchImpl {
  return () =>
    Promise.resolve({
      ok,
      status,
      text: () => Promise.resolve(body),
    });
}

function throwingFetch(): FetchImpl {
  return () => Promise.reject(new Error("network down"));
}

Deno.test("validateConfiguration normalises and rejects unsafe input", () => {
  const adapter = createExampleCsvAdapter();

  assertEquals(adapter.validateConfiguration(GOOD_CONFIG), {
    csvUrl: "https://data.example.com/ledger.csv?token=secret-do-not-leak",
    currency: "RWF",
    sourceLabel: "Demo ledger",
  });

  assertThrows(
    () => adapter.validateConfiguration({ ...GOOD_CONFIG, extra: "x" }),
    Error,
    "example_csv_configuration_invalid",
  );
  assertThrows(
    () =>
      adapter.validateConfiguration({
        ...GOOD_CONFIG,
        csvUrl: "http://data.example.com/ledger.csv",
      }),
    Error,
    "example_csv_url_invalid",
  );
  assertThrows(
    () =>
      adapter.validateConfiguration({
        ...GOOD_CONFIG,
        csvUrl: "https://user:pass@data.example.com/ledger.csv",
      }),
    Error,
    "example_csv_url_invalid",
  );
  assertThrows(
    () =>
      adapter.validateConfiguration({ ...GOOD_CONFIG, currency: "Rwandan" }),
    Error,
    "example_csv_currency_invalid",
  );
});

Deno.test("toRawEvents maps columns case-insensitively and parses money to minor units", () => {
  const config: ExampleCsvConfiguration = {
    csvUrl: "https://data.example.com/ledger.csv",
    currency: "RWF",
    sourceLabel: "Demo ledger",
  };
  const events = toRawEvents(parseCsv(CSV_BODY.toUpperCase()), config);

  assertEquals(events.map((event) => event.amountMinor), [-350, 420000, 1210]);
  assertEquals(events[0].eventTime, "2026-01-05T00:00:00.000Z");
  assertEquals(events[1].description, "SALARY, JANUARY");
  assertEquals(
    events.every((event) =>
      event.sourceExternalRef === "example_csv:data.example.com/ledger.csv"
    ),
    true,
  );
});

Deno.test("toRawEvents fails closed on a missing column or a row without an id", () => {
  const config: ExampleCsvConfiguration = { ...GOOD_CONFIG, currency: "RWF" };
  assertThrows(
    () => toRawEvents(parseCsv("id,date,amount\nr1,2026-01-05,5\n"), config),
    Error,
    "example_csv_columns_missing",
  );
  assertThrows(
    () =>
      toRawEvents(
        parseCsv("id,date,description,amount\n,2026-01-05,x,5\n"),
        config,
      ),
    Error,
    "example_csv_row_missing_id",
  );
});

Deno.test("pull fetches, then resumes from the returned cursor", async () => {
  const adapter = createExampleCsvAdapter({ fetchImpl: stubFetch(CSV_BODY) });
  const config = adapter.validateConfiguration(GOOD_CONFIG);

  const first = await adapter.pull!(INSTALLATION, config);
  assertEquals(first.events.map((event) => event.rowIndex), [1, 2, 3]);
  assertEquals(first.cursor, "3");

  const second = await adapter.pull!(INSTALLATION, config, first.cursor);
  assertEquals(second.events, []);
  assertEquals(second.cursor, "3");
});

Deno.test("pull throws a typed error when the file is not reachable", async () => {
  const adapter = createExampleCsvAdapter({
    fetchImpl: stubFetch("nope", { ok: false, status: 502 }),
  });
  const config = adapter.validateConfiguration(GOOD_CONFIG);
  await assertRejects(
    () => adapter.pull!(INSTALLATION, config),
    Error,
    "example_csv_fetch_failed",
  );
});

Deno.test("testConnection reports readiness without throwing", async () => {
  const config = createExampleCsvAdapter().validateConfiguration(GOOD_CONFIG);

  assertEquals(
    await createExampleCsvAdapter({ fetchImpl: stubFetch("ok") })
      .testConnection(INSTALLATION, config),
    { ok: true },
  );
  assertEquals(
    await createExampleCsvAdapter({
      fetchImpl: stubFetch("boom", { ok: false, status: 500 }),
    }).testConnection(INSTALLATION, config),
    { ok: false, errorCode: "example_csv_unreachable" },
  );
  assertEquals(
    await createExampleCsvAdapter({ fetchImpl: throwingFetch() })
      .testConnection(INSTALLATION, config),
    { ok: false, errorCode: "example_csv_unreachable" },
  );
});

Deno.test("normalize emits a redacted, versioned envelope with no source secret", async () => {
  const adapter = createExampleCsvAdapter({ fetchImpl: stubFetch(CSV_BODY) });
  const config = adapter.validateConfiguration(GOOD_CONFIG);
  const { events } = await adapter.pull!(INSTALLATION, config);

  const envelopes = events.flatMap((event) => adapter.normalize(event));
  assertEquals(envelopes.length, 3);
  assertEquals(envelopes[0], {
    connector_key: "example_csv_v1",
    adapter_version: CONNECTOR_ADAPTER_VERSION,
    event_time: "2026-01-05T00:00:00.000Z",
    provider_event_reference: "r1",
    source_external_ref: "example_csv:data.example.com/ledger.csv",
    account_external_ref: null,
    payload: { description: "Coffee", amount_minor: -350, currency: "RWF" },
  });
  assertEquals(JSON.stringify(envelopes).includes("secret-do-not-leak"), false);
});

Deno.test("discovery hashes raw references into the route-resolver payload", async () => {
  const payload = await buildExampleCsvDiscoveryPayload(
    INSTALLATION,
    GOOD_CONFIG,
  );
  assertEquals(payload.length, 1);
  assertEquals(/^[0-9a-f]{64}$/.test(payload[0].source_ref_hash), true);
  assertEquals(payload[0].provider, "other");
  assertEquals(payload[0].source_type, "import");
  assertEquals(payload[0].currency, "RWF");
  assertEquals(JSON.stringify(payload).includes("data.example.com"), false);
  assertEquals(JSON.stringify(payload).includes("secret-do-not-leak"), false);
});
