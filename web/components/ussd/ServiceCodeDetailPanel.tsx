"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Badge } from "../Badge";
import { CopyIcon, PayIcon } from "../icons";
import { FavouriteButton } from "./FavouriteButton";
import { messages } from "../../lib/ussd/messages";
import {
  buildTelHref,
  detectDialerCapability,
  fillUssdTemplate,
  type DialerCapability,
  type ParamSpec,
} from "../../lib/ussd/capability";
import { recordUsage, reportServiceCode } from "../../app/pay/actions";
import type { ServiceCodeDetail } from "../../lib/ussd/queries";

const t = messages().ussd;

const REPORT_TYPES = [
  "incorrect_code",
  "outdated",
  "wrong_prerequisites",
  "provider_changed",
  "other",
] as const;

export function ServiceCodeDetailPanel({
  code,
  favourited,
}: {
  code: ServiceCodeDetail;
  favourited: boolean;
}) {
  const [capability, setCapability] = useState<DialerCapability>({
    canAttemptDialer: false,
    platform: "unknown",
    reason: "ssr",
  });
  const [, startDetect] = useTransition();
  useEffect(() => {
    // navigator is only available client-side; the fallback (copy +
    // steps) is always rendered regardless, so the pre-detect state is
    // safe. Wrapped in a transition so it never blocks paint.
    startDetect(() => setCapability(detectDialerCapability(navigator.userAgent)));
    void recordUsage(code.id, "viewed");
  }, [code.id]);

  const specs: ParamSpec[] = useMemo(
    () =>
      code.parameters.map((p) => ({
        key: p.key,
        kind: p.kind,
        required: p.required,
        formatRegex: p.format_regex,
        minLength: p.min_length,
        maxLength: p.max_length,
      })),
    [code.parameters],
  );

  const [values, setValues] = useState<Record<string, string>>({});
  const filled = useMemo(() => {
    if (!code.accepts_parameters) {
      return { ok: true as const, display: code.ussd_template, dial: code.ussd_template };
    }
    return fillUssdTemplate(code.ussd_template, values, specs);
  }, [code.accepts_parameters, code.ussd_template, values, specs]);

  const dialString = filled.ok ? filled.dial : null;
  const unverified = code.verified_at == null;
  const deprecated = code.state === "deprecated";
  const unavailable = code.state === "temporarily_unavailable";

  const [copied, setCopied] = useState(false);
  async function onCopy() {
    if (!dialString) return;
    try {
      await navigator.clipboard.writeText(dialString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      void recordUsage(code.id, "copied_code", "copied");
    } catch {
      setCopied(false);
    }
  }

  function onDial() {
    void recordUsage(
      code.id,
      "opened_dialer",
      capability.canAttemptDialer ? "dialer_opened" : "dialer_unsupported",
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {unverified ? (
            <Badge variant="attention">{t.notVerifiedBadge}</Badge>
          ) : (
            <Badge variant="positive">{t.verifiedBadge}</Badge>
          )}
          <span className="font-mono text-sm text-text-secondary">{code.ussd_template}</span>
        </div>
        <FavouriteButton
          serviceCodeId={code.id}
          initialFavourited={favourited}
          label={code.display_name_en}
        />
      </div>

      {code.description_en && (
        <p className="text-sm text-text-secondary">{code.description_en}</p>
      )}

      {deprecated && (
        <div className="rounded-control bg-attention-bg px-3 py-2 text-sm text-attention">
          {t.deprecatedNotice}{" "}
          {code.replacement_slug && (
            <Link
              href={`/pay/ussd/${code.replacement_slug}`}
              className="font-medium underline"
            >
              {t.replacementLink}
            </Link>
          )}
        </div>
      )}
      {unavailable && (
        <div className="rounded-control bg-attention-bg px-3 py-2 text-sm text-attention">
          {t.unavailableNotice}
        </div>
      )}
      {code.caution_text && (
        <div className="rounded-control border border-border-subtle px-3 py-2 text-sm text-text-secondary">
          {code.caution_text}
        </div>
      )}
      {code.risk_text && (
        <div className="rounded-control bg-attention-bg px-3 py-2 text-sm text-attention">
          {code.risk_text}
        </div>
      )}

      {code.accepts_parameters && code.parameters.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-primary">
            {t.prerequisitesHeading}
          </h2>
          <div className="flex flex-col gap-3">
            {code.parameters.map((p) => (
              <label key={p.key} className="block">
                <span className="mb-1 block text-sm font-medium text-text-secondary">
                  {p.label_en}
                  {!p.required && (
                    <span className="ml-1 font-normal text-text-muted">(optional)</span>
                  )}
                </span>
                <input
                  type="text"
                  inputMode={p.kind === "amount" || p.kind === "phone" ? "numeric" : "text"}
                  autoComplete="off"
                  value={values[p.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [p.key]: e.target.value }))
                  }
                  aria-describedby={p.format_hint_en ? `${p.key}-hint` : undefined}
                  className="w-full rounded-control border border-border-subtle bg-surface px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
                />
                {p.format_hint_en && (
                  <span id={`${p.key}-hint`} className="mt-1 block text-xs text-text-muted">
                    {p.format_hint_en}
                  </span>
                )}
              </label>
            ))}
          </div>
          {!filled.ok && (
            <p className="mt-2 text-xs text-attention" role="status">
              {filled.error}
            </p>
          )}
        </section>
      )}

      <div className="rounded-control bg-background px-3 py-2.5 text-xs text-text-secondary">
        {t.handoffNotice}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onCopy}
          disabled={!dialString}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-border-subtle bg-surface px-4 py-2.5 text-sm font-medium text-text-primary disabled:opacity-50"
        >
          <CopyIcon className="h-4 w-4" />
          {copied ? t.copied : t.copyCode}
        </button>

        {capability.canAttemptDialer && dialString ? (
          <a
            href={buildTelHref(dialString)}
            onClick={onDial}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground"
          >
            <PayIcon className="h-4 w-4" />
            {t.openDialer}
          </a>
        ) : (
          <p className="flex-1 self-center text-xs text-text-muted">{t.dialerUnavailable}</p>
        )}
      </div>

      {code.steps.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-primary">{t.stepsHeading}</h2>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text-secondary">
            {code.steps.map((s) => (
              <li key={s.position}>{s.instruction_en}</li>
            ))}
          </ol>
        </section>
      )}

      <section className="border-t border-border-subtle pt-4 text-xs text-text-muted">
        <p className="font-medium text-text-secondary">{t.sourceHeading}</p>
        <p className="mt-0.5">
          {code.official_source_label ?? "Not recorded"}
          {code.official_source_url && (
            <>
              {" — "}
              <a
                href={code.official_source_url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                {code.official_source_url}
              </a>
            </>
          )}
        </p>
      </section>

      <ReportForm serviceCodeId={code.id} />
    </div>
  );
}

function ReportForm({ serviceCodeId }: { serviceCodeId: string }) {
  const [open, setOpen] = useState(false);
  const [reportType, setReportType] = useState<(typeof REPORT_TYPES)[number]>("incorrect_code");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const res = await reportServiceCode(serviceCodeId, reportType, details);
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
        {t.reportThanks}
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
          {t.reportCta}
        </button>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-text-primary">{t.reportTitle}</p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-text-secondary">
              {t.reportTypeLabel}
            </span>
            <select
              value={reportType}
              onChange={(e) =>
                setReportType(e.target.value as (typeof REPORT_TYPES)[number])
              }
              className="w-full rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            >
              {REPORT_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {t.reportTypes[rt]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-text-secondary">
              {t.reportDetailsLabel}
            </span>
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
              {t.reportSubmit}
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
