"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge } from "../../Badge";
import { CopyIcon, PayIcon } from "../../icons";
import { messages } from "../../../lib/ussd/messages";
import {
  buildTelHref,
  detectDialerCapability,
  type DialerCapability,
} from "../../../lib/ussd/capability";
import { describeFee, describeLimit } from "../../../lib/directory/format";
import { FLOW_LABELS, type RouteResult } from "../../../lib/directory/public-types";
import {
  recordRouteUsage,
  reportRoute,
  toggleRouteFavourite,
} from "../../../app/pay/networks/actions";

const t = messages().network;
const u = messages().ussd;

const REPORT_TYPES = [
  "incorrect_code",
  "outdated",
  "wrong_prerequisites",
  "provider_changed",
  "other",
] as const;

export function RouteResultPanel({
  route,
  favourited,
}: {
  route: RouteResult;
  favourited: boolean;
}) {
  const [capability, setCapability] = useState<DialerCapability>({
    canAttemptDialer: false,
    platform: "unknown",
    reason: "ssr",
  });
  const [, startDetect] = useTransition();
  useEffect(() => {
    startDetect(() => setCapability(detectDialerCapability(navigator.userAgent)));
    void recordRouteUsage(route.id, "viewed");
  }, [route.id]);

  const unverified = route.verified_at == null;
  // A literal (non-parameterised) linked USSD code is safe to copy/dial
  // directly. A parameterised one, or an entry-point label, is guidance
  // only - the user completes it on their phone.
  const literalCode =
    route.service_code && !route.service_code.accepts_parameters
      ? route.service_code.ussd_template
      : null;
  const copyText = literalCode ?? route.approved_entry_point_en ?? null;

  const [copied, setCopied] = useState(false);
  async function onCopy() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      void recordRouteUsage(route.id, "copied_code", "copied");
    } catch {
      setCopied(false);
    }
  }

  const [fav, setFav] = useState(favourited);
  const [favBusy, setFavBusy] = useState(false);
  async function onToggleFav() {
    setFavBusy(true);
    const res = await toggleRouteFavourite(route.id);
    setFavBusy(false);
    if (res.ok) setFav(res.favourited);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {unverified ? (
            <Badge variant="attention">{u.notVerifiedBadge}</Badge>
          ) : (
            <Badge variant="positive">{u.verifiedBadge}</Badge>
          )}
          <span className="text-sm text-text-secondary">
            {route.provider_name} · {route.channel.replace(/_/g, " ")}
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleFav}
          disabled={favBusy}
          aria-pressed={fav}
          className="min-h-11 rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
        >
          {fav ? t.savedRoute : t.saveRoute}
        </button>
      </div>

      {route.description_en && <p className="text-sm text-text-secondary">{route.description_en}</p>}

      {route.caution_text && (
        <div className="rounded-control border border-border-subtle px-3 py-2 text-sm text-text-secondary">
          {route.caution_text}
        </div>
      )}
      {route.risk_text && (
        <div className="rounded-control bg-attention-bg px-3 py-2 text-sm text-attention">
          {route.risk_text}
        </div>
      )}

      {route.flow_types.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-text-primary">{t.supportedFlows}</h2>
          <ul className="list-disc pl-5 text-sm text-text-secondary">
            {route.flow_types.map((f) => (
              <li key={f}>{FLOW_LABELS[f] ?? f.replace(/_/g, " ")}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-1 text-sm font-semibold text-text-primary">{t.entryPointHeading}</h2>
        {route.service_code ? (
          <p className="font-mono text-sm text-text-secondary">{route.service_code.ussd_template}</p>
        ) : route.approved_entry_point_en ? (
          <p className="text-sm text-text-secondary">{route.approved_entry_point_en}</p>
        ) : (
          <p className="text-sm text-text-muted">Follow the steps below.</p>
        )}
        {route.service_code?.accepts_parameters && (
          <p className="mt-1 text-xs text-text-muted">
            Enter the recipient details on your phone when prompted — the code above is a template.
          </p>
        )}
      </section>

      <div className="rounded-control bg-background px-3 py-2.5 text-xs text-text-secondary">
        {t.safetyNotice}
      </div>

      {copyText && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-border-subtle bg-surface px-4 py-2.5 text-sm font-medium text-text-primary"
          >
            <CopyIcon className="h-4 w-4" />
            {copied ? u.copied : t.copyEntryPoint}
          </button>
          {literalCode && capability.canAttemptDialer ? (
            <a
              href={buildTelHref(literalCode)}
              onClick={() =>
                void recordRouteUsage(route.id, "opened_dialer", "dialer_opened")
              }
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
            >
              <PayIcon className="h-4 w-4" />
              {u.openDialer}
            </a>
          ) : literalCode ? (
            <p className="flex-1 self-center text-xs text-text-muted">{u.dialerUnavailable}</p>
          ) : null}
        </div>
      )}

      {route.menu_steps.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-primary">{t.stepsHeading}</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-text-secondary">
            {route.menu_steps.map((s) => (
              <li key={s.position}>
                {s.action_label_en && (
                  <span className="font-medium text-text-primary">{s.action_label_en}: </span>
                )}
                {s.instruction_en}
                {(s.expected_menu_label_en || s.expected_option_number) && (
                  <span className="block text-xs text-text-muted">
                    {s.expected_menu_label_en}
                    {s.expected_option_number ? ` · option ${s.expected_option_number}` : ""}
                  </span>
                )}
                {s.caution_en && (
                  <span className="block text-xs text-attention">{s.caution_en}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {(route.fees.length > 0 || route.limits.length > 0) && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-text-primary">
            {t.feeHeading} & {t.limitHeading.toLowerCase()}
          </h2>
          <ul className="text-sm text-text-secondary">
            {route.fees.map((f, i) => (
              <li key={`f${i}`}>{describeFee(f)}</li>
            ))}
            {route.limits.map((l, i) => (
              <li key={`l${i}`}>{describeLimit(l)}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-text-muted">
            Your institution may apply lower limits or different charges within the network&apos;s
            published framework.
          </p>
        </section>
      )}

      {(route.device_compat.length > 0 || route.internet_required) && (
        <section>
          <h2 className="mb-1 text-sm font-semibold text-text-primary">{t.devicesHeading}</h2>
          <p className="text-sm text-text-secondary">
            {route.device_compat.length > 0 ? route.device_compat.join(", ") : "Any device"}
            {route.internet_required ? " · needs an internet connection" : ""}
          </p>
        </section>
      )}

      <section className="border-t border-border-subtle pt-4 text-xs text-text-muted">
        <p className="font-medium text-text-secondary">{t.verificationHeading}</p>
        <p className="mt-0.5">
          {route.public_source
            ? `${route.public_source.organization}${route.public_source.title ? ` — ${route.public_source.title}` : ""}`
            : (route.official_source_label ?? "Not recorded")}
          {route.public_source?.source_url && (
            <>
              {" — "}
              <a
                href={route.public_source.source_url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                {route.public_source.source_url}
              </a>
            </>
          )}
        </p>
        {route.last_verified_evidence_date && (
          <p className="mt-0.5">
            {t.lastVerified}: {new Date(route.last_verified_evidence_date).toLocaleDateString()}
          </p>
        )}
      </section>

      <RouteReportForm routeId={route.id} />
    </div>
  );
}

function RouteReportForm({ routeId }: { routeId: string }) {
  const [open, setOpen] = useState(false);
  const [reportType, setReportType] = useState<(typeof REPORT_TYPES)[number]>("incorrect_code");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const res = await reportRoute(routeId, reportType, details);
    if (res.ok) {
      setStatus("done");
    } else {
      setStatus("error");
      setError(res.error);
    }
  }

  if (status === "done") {
    return (
      <p className="border-t border-border-subtle pt-4 text-sm text-money-positive">
        {u.reportThanks}
      </p>
    );
  }

  return (
    <div className="border-t border-border-subtle pt-4">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-accent hover:underline"
        >
          {t.reportRoute}
        </button>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-text-primary">{t.reportRoute}</p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-text-secondary">{u.reportTypeLabel}</span>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as (typeof REPORT_TYPES)[number])}
              className="w-full rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            >
              {REPORT_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {u.reportTypes[rt]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-text-secondary">{u.reportDetailsLabel}</span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
          </label>
          {error && (
            <p className="text-xs text-attention" role="status">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={status === "sending"}
              className="min-h-11 rounded-control bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {u.reportSubmit}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-control px-4 py-2 text-sm font-medium text-text-secondary hover:bg-background"
            >
              {messages().pay.close}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
