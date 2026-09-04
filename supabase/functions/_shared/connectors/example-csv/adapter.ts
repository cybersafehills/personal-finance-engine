/**
 * example-csv — the reference inbound connector.
 *
 * It ingests a flat, public CSV file at an https URL (columns `id`, `date`,
 * `description`, `amount`) and is the copy-paste starting point for a real
 * connector: it exercises every part of the {@link ConnectorAdapter}
 * contract, keeps the network I/O behind an injectable `fetchImpl` so the
 * whole thing is unit-testable without a socket, and shows the pure
 * parse/normalise seam a real adapter should preserve.
 *
 * It is deliberately not wired into any Edge Function, migration, or
 * `connector_installations` row. See `docs/integrations-connector-sdk.md`.
 */
import {
  buildConnectorDiscoveryPayload,
  CONNECTOR_ADAPTER_VERSION,
  type ConnectorAdapter,
  type ConnectorDiscoveryPayload,
  type ConnectorEventEnvelope,
  type ConnectorInstallationContext,
  defineConnectorAdapter,
  hashConnectorReference,
} from "../../connector-adapter.ts";
import { type CsvTable, parseCsv } from "./csv.ts";

export const EXAMPLE_CSV_CONNECTOR_KEY = "example_csv_v1";

export type ExampleCsvConfiguration = {
  csvUrl: string;
  currency: string;
  sourceLabel: string;
};

export type ExampleCsvRawEvent = {
  rowIndex: number;
  providerEventReference: string;
  eventTime: string | null;
  description: string;
  amountMinor: number;
  currency: string;
  sourceExternalRef: string;
};

export type ExampleCsvNormalizedPayload = {
  description: string;
  amount_minor: number;
  currency: string;
};

export type ExampleCsvEventEnvelope = ConnectorEventEnvelope<
  ExampleCsvNormalizedPayload
>;

/**
 * The subset of `fetch` this adapter needs. `globalThis.fetch` satisfies it;
 * tests pass a stub so no network is touched.
 */
export type FetchImpl = (
  input: string,
  init?: { method?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type ExampleCsvAdapterDeps = {
  fetchImpl?: FetchImpl;
};

const CONFIGURATION_KEYS = new Set(["csvUrl", "currency", "sourceLabel"]);
const REQUIRED_COLUMNS = ["id", "date", "description", "amount"] as const;

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  code: string,
): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(code);
  }
}

function text(value: unknown, code: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(code);
  return normalized;
}

function httpsUrl(value: unknown): string {
  const raw = text(value, "example_csv_url_invalid", 400);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("example_csv_url_invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("example_csv_url_invalid");
  }
  return parsed.toString();
}

function currencyCode(value: unknown): string {
  const normalized = text(value, "example_csv_currency_invalid", 3)
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error("example_csv_currency_invalid");
  }
  return normalized;
}

/**
 * A stable, bounded source reference derived from the CSV location. Only the
 * host and path participate — a token in the query string is never part of
 * routing identity and never persisted.
 */
function sourceExternalRefFor(configuration: ExampleCsvConfiguration): string {
  const parsed = new URL(configuration.csvUrl);
  return `example_csv:${parsed.host}${parsed.pathname}`.slice(0, 512);
}

/** `"-3.50"` → `-350`; `"4200"` → `420000`; `"12.1"` → `1210`. */
function parseAmountMinor(raw: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) throw new Error("example_csv_amount_invalid");
  const [, sign, whole, frac = ""] = match;
  const minor = Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
  if (!Number.isSafeInteger(minor)) {
    throw new Error("example_csv_amount_invalid");
  }
  return sign === "-" ? -minor : minor;
}

/** `"2026-01-05"` → an ISO instant; anything else → `null`. */
function parseEventTime(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const millis = Date.parse(`${trimmed}T00:00:00Z`);
  return Number.isNaN(millis) ? null : new Date(millis).toISOString();
}

function columnIndex(headers: string[], name: string): number {
  const index = headers.findIndex(
    (header) => header.toLowerCase() === name,
  );
  if (index === -1) throw new Error("example_csv_columns_missing");
  return index;
}

/**
 * Pure: map a parsed CSV table to raw events under a validated config.
 * Exported so the parse step can be unit-tested in isolation and so a real
 * adapter author can see exactly where provider shape becomes canonical
 * shape.
 */
export function toRawEvents(
  table: CsvTable,
  configuration: ExampleCsvConfiguration,
): ExampleCsvRawEvent[] {
  const indices = Object.fromEntries(
    REQUIRED_COLUMNS.map((name) => [name, columnIndex(table.headers, name)]),
  ) as Record<(typeof REQUIRED_COLUMNS)[number], number>;

  const sourceExternalRef = sourceExternalRefFor(configuration);

  return table.rows.map((cells, position) => {
    const rowIndex = position + 1;
    const id = (cells[indices.id] ?? "").trim();
    if (!id) throw new Error("example_csv_row_missing_id");

    return {
      rowIndex,
      providerEventReference: id.slice(0, 128),
      eventTime: parseEventTime(cells[indices.date] ?? ""),
      description: (cells[indices.description] ?? "").trim().slice(0, 200),
      amountMinor: parseAmountMinor(cells[indices.amount] ?? ""),
      currency: configuration.currency,
      sourceExternalRef,
    };
  });
}

/**
 * Build the adapter. Pass `{ fetchImpl }` in tests; production callers use
 * the default `globalThis.fetch`.
 */
export function createExampleCsvAdapter(
  deps: ExampleCsvAdapterDeps = {},
): ConnectorAdapter<
  ExampleCsvConfiguration,
  ExampleCsvRawEvent,
  ExampleCsvEventEnvelope
> {
  const fetchImpl: FetchImpl = deps.fetchImpl ??
    (globalThis.fetch as unknown as FetchImpl);

  return defineConnectorAdapter<
    ExampleCsvConfiguration,
    ExampleCsvRawEvent,
    ExampleCsvEventEnvelope
  >({
    validateConfiguration(input) {
      const configuration = object(input, "example_csv_configuration_invalid");
      exactKeys(
        configuration,
        CONFIGURATION_KEYS,
        "example_csv_configuration_invalid",
      );
      return {
        csvUrl: httpsUrl(configuration.csvUrl),
        currency: currencyCode(configuration.currency),
        sourceLabel: text(
          configuration.sourceLabel,
          "example_csv_source_label_invalid",
          120,
        ),
      };
    },

    async testConnection(_installation, configuration) {
      try {
        const response = await fetchImpl(configuration.csvUrl, {
          method: "GET",
        });
        return response.ok
          ? { ok: true as const }
          : { ok: false as const, errorCode: "example_csv_unreachable" };
      } catch {
        return { ok: false as const, errorCode: "example_csv_unreachable" };
      }
    },

    async discoverSources(_installation, configuration) {
      return await Promise.resolve([{
        externalRef: sourceExternalRefFor(configuration),
        providerKey: EXAMPLE_CSV_CONNECTOR_KEY,
        provider: "other",
        sourceType: "import",
        displayName: configuration.sourceLabel,
        maskedIdentifier: null,
        currency: configuration.currency,
        accounts: [{
          externalRef: "rows",
          displayName: configuration.sourceLabel,
          provider: "other",
          currency: configuration.currency,
        }],
      }]);
    },

    async pull(_installation, configuration, cursor) {
      const response = await fetchImpl(configuration.csvUrl, { method: "GET" });
      if (!response.ok) throw new Error("example_csv_fetch_failed");
      const events = toRawEvents(
        parseCsv(await response.text()),
        configuration,
      );

      const after = cursor === undefined ? 0 : Number(cursor);
      const fresh = Number.isFinite(after) && after > 0
        ? events.filter((event) => event.rowIndex > after)
        : events;
      const nextCursor = events.length > 0
        ? String(events[events.length - 1].rowIndex)
        : cursor;

      return { events: fresh, cursor: nextCursor };
    },

    normalize(raw) {
      return [{
        connector_key: EXAMPLE_CSV_CONNECTOR_KEY,
        adapter_version: CONNECTOR_ADAPTER_VERSION,
        event_time: raw.eventTime,
        provider_event_reference: raw.providerEventReference,
        source_external_ref: raw.sourceExternalRef,
        account_external_ref: null,
        payload: {
          description: raw.description,
          amount_minor: raw.amountMinor,
          currency: raw.currency,
        },
      }];
    },
  });
}

/** Default instance, backed by `globalThis.fetch`. */
export const exampleCsvAdapter = createExampleCsvAdapter();

/**
 * Convenience: validate config, discover, and hash raw references into the
 * exact payload `resolve_connector_event_route` accepts. Mirrors
 * `ingest-momo/adapter.ts:buildMtnMomoDiscoveryPayload`.
 */
export async function buildExampleCsvDiscoveryPayload(
  installation: ConnectorInstallationContext,
  input: unknown,
  deps: ExampleCsvAdapterDeps = {},
): Promise<ConnectorDiscoveryPayload> {
  const adapter = createExampleCsvAdapter(deps);
  const configuration = adapter.validateConfiguration(input);
  const discovered = await adapter.discoverSources(installation, configuration);
  return await buildConnectorDiscoveryPayload(
    discovered,
    hashConnectorReference,
  );
}
