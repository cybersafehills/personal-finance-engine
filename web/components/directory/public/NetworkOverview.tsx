import { messages } from "../../../lib/ussd/messages";
import { describeFee, describeLimit } from "../../../lib/directory/format";
import { FLOW_LABELS, type NetworkOverview as NetworkOverviewData } from "../../../lib/directory/public-types";

const t = messages().network;

export function NetworkOverview({
  network,
  supportedFlows,
}: {
  network: NetworkOverviewData;
  supportedFlows: string[];
}) {
  return (
    <div className="flex flex-col gap-5">
      {network.description_en && (
        <p className="text-sm text-text-secondary">{network.description_en}</p>
      )}

      <section>
        <h2 className="mb-1 text-sm font-semibold text-text-primary">{t.operatorHeading}</h2>
        <ul className="text-sm text-text-secondary">
          {network.operators.map((o) => (
            <li key={`${o.operator_role}-${o.name}`}>
              {o.name} <span className="text-text-muted">· {o.operator_role.replace(/_/g, " ")}</span>
            </li>
          ))}
          {network.regulatory_authority && (
            <li>
              {network.regulatory_authority.name}{" "}
              <span className="text-text-muted">· regulatory authority</span>
            </li>
          )}
        </ul>
      </section>

      {supportedFlows.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-text-primary">{t.purposesHeading}</h2>
          <ul className="list-disc pl-5 text-sm text-text-secondary">
            {supportedFlows.map((f) => (
              <li key={f}>{FLOW_LABELS[f] ?? f.replace(/_/g, " ")}</li>
            ))}
          </ul>
        </section>
      )}

      {network.fees.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-text-primary">{t.feeHeading}</h2>
          <ul className="text-sm text-text-secondary">
            {network.fees.map((fee, i) => (
              <li key={i}>
                {describeFee(fee)}
                {fee.note_en ? <span className="block text-xs text-text-muted">{fee.note_en}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {network.limits.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-text-primary">{t.limitHeading}</h2>
          <ul className="text-sm text-text-secondary">
            {network.limits.map((limit, i) => (
              <li key={i}>
                {describeLimit(limit)}
                {limit.note_en ? (
                  <span className="block text-xs text-text-muted">{limit.note_en}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(network.custody_note_en || network.access_channel_summary_en) && (
        <section className="rounded-control bg-background px-3 py-2.5 text-xs text-text-secondary">
          {network.access_channel_summary_en && <p>{network.access_channel_summary_en}</p>}
          {network.custody_note_en && <p className="mt-1">{network.custody_note_en}</p>}
        </section>
      )}

      {network.aliases.length > 1 && (
        <p className="text-xs text-text-muted">
          {t.aliasHeading}: {network.aliases.join(", ")}
        </p>
      )}

      <section className="border-t border-border-subtle pt-4 text-xs text-text-muted">
        <p className="font-medium text-text-secondary">{messages().ussd.sourceHeading}</p>
        <p className="mt-0.5">
          {network.official_source_label ?? "Not recorded"}
          {network.official_source_url && (
            <>
              {" — "}
              <a
                href={network.official_source_url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                {network.official_source_url}
              </a>
            </>
          )}
        </p>
      </section>
    </div>
  );
}
