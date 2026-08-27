"use client";

import { useState } from "react";
import { submitDirectorySuggestion } from "../../app/pay/suggest/actions";
import { field, labelText } from "./field-styles";

const TYPES: { value: string; label: string }[] = [
  { value: "new_service", label: "A code or service that's missing" },
  { value: "new_route", label: "A way to reach a payment network that's missing" },
  { value: "menu_update", label: "Updated menu steps for an existing route" },
  { value: "fee_limit_diff", label: "A fee or limit that's different from what's shown" },
  { value: "other", label: "Something else" },
];

const CHANNELS = [
  ["", "Not sure"],
  ["ussd", "USSD"],
  ["mobile_app", "Mobile app"],
  ["internet_banking", "Internet banking"],
  ["provider_website", "Provider website"],
  ["qr", "QR"],
  ["other", "Other"],
] as const;

export function SuggestForm({
  defaultType,
  defaultNetworkSlug,
}: {
  defaultType?: string;
  defaultNetworkSlug?: string;
}) {
  const [type, setType] = useState(defaultType ?? "new_service");
  const [network, setNetwork] = useState(defaultNetworkSlug ?? "");
  const [institution, setInstitution] = useState("");
  const [channel, setChannel] = useState("");
  const [device, setDevice] = useState("");
  const [lastTested, setLastTested] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);
    const res = await submitDirectorySuggestion({
      suggestion_type: type,
      payment_network_slug: network,
      institution_name: institution,
      channel: channel || undefined,
      device,
      last_tested_date: lastTested || undefined,
      body,
    });
    if (res.ok) {
      setStatus("done");
    } else {
      setStatus("error");
      setError(res.error);
    }
  }

  if (status === "done") {
    return (
      <p className="rounded-control bg-money-positive-bg px-3 py-2.5 text-sm text-money-positive">
        Thanks — this goes to our review queue. It won&apos;t be published until we&apos;ve verified
        it against the provider.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="rounded-control bg-background px-3 py-2.5 text-xs text-text-secondary">
        Don&apos;t include your PIN, a one-time code, or a full account number. Describe what you
        saw and where.
      </p>

      <label>
        <span className={labelText}>What are you suggesting?</span>
        <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={labelText}>Payment network (if any)</span>
          <input
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            className={field}
            placeholder="e.g. eKash"
          />
        </label>
        <label>
          <span className={labelText}>Bank / wallet / institution</span>
          <input
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
            className={field}
          />
        </label>
        <label>
          <span className={labelText}>Channel</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={field}>
            {CHANNELS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelText}>Device you tested on</span>
          <input value={device} onChange={(e) => setDevice(e.target.value)} className={field} />
        </label>
        <label>
          <span className={labelText}>Last tested</span>
          <input
            type="date"
            value={lastTested}
            onChange={(e) => setLastTested(e.target.value)}
            className={field}
          />
        </label>
      </div>

      <label>
        <span className={labelText}>Details</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={2000}
          className={field}
          placeholder="What's the code / route / step, and how do you know it works?"
          required
        />
      </label>

      {error && (
        <p className="text-sm text-attention" role="status">
          {error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={status === "sending"}
          className="min-h-11 rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          {status === "sending" ? "Sending…" : "Send suggestion"}
        </button>
      </div>
    </form>
  );
}
