# example-csv — reference inbound connector

A complete, deno-tested implementation of the `_shared/connector-adapter.ts`
contract over a flat public CSV file. It is the copy-paste starting point for a
real connector.

**It is not wired into anything.** No Edge Function imports it, no migration
references it, no `connector_installations` row uses `example_csv_v1`. Turning a
copy of it into a live connector is the checklist in
[`docs/integrations-connector-sdk.md`](../../../../../docs/integrations-connector-sdk.md).

## Layout

| File         | Role                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `csv.ts`     | Pure RFC 4180 reader. No I/O.                                                                                                                                                                           |
| `adapter.ts` | `createExampleCsvAdapter({ fetchImpl? })` — config validation, `testConnection`, `discoverSources`, `pull`, `normalize`, plus the pure `toRawEvents` seam. Network is behind an injectable `fetchImpl`. |
| `tests/`     | `deno test` suite — runs with a stub `fetchImpl`, never a socket.                                                                                                                                       |

## Run it

```sh
deno check supabase/functions/_shared/connectors/example-csv/adapter.ts
deno test  supabase/functions/_shared/connectors/example-csv/tests
```

CSV shape it expects (header required, case-insensitive):

```csv
id,date,description,amount
r1,2026-01-05,Coffee,-3.50
r2,2026-01-06,"Salary, January",4200
```
