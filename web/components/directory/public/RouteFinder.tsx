"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { messages } from "../../../lib/ussd/messages";

const t = messages().network;

const CHANNELS = [
  ["ussd", "USSD"],
  ["mobile_app", "Mobile app"],
  ["internet_banking", "Internet banking"],
  ["provider_website", "Provider website"],
  ["qr", "QR"],
] as const;

// Guided route selector. URL-driven (like DirectoryControls) so the
// server-rendered results below stay the source of truth and a shared
// link reproduces the same view.
export function RouteFinder({
  sources,
  flows,
}: {
  sources: { provider_id: string; display_name: string }[];
  flows: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function apply(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  const from = params.get("from") ?? "";
  const flow = params.get("flow") ?? "";
  const channel = params.get("channel") ?? "";

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-control border border-border-subtle p-3">
      <p className="text-xs text-text-muted">{t.routeFinderIntro}</p>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-text-secondary">{t.sourceLabel}</span>
        <select
          value={from}
          onChange={(e) => apply({ from: e.target.value })}
          className="w-full rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
        >
          <option value="">{t.anySource}</option>
          {sources.map((s) => (
            <option key={s.provider_id} value={s.provider_id}>
              {s.display_name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="block flex-1 text-sm">
          <span className="mb-1 block font-medium text-text-secondary">{t.flowLabel}</span>
          <select
            value={flow}
            onChange={(e) => apply({ flow: e.target.value })}
            className="w-full rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          >
            <option value="">{t.anyFlow}</option>
            {flows.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block flex-1 text-sm">
          <span className="mb-1 block font-medium text-text-secondary">{t.channelLabel}</span>
          <select
            value={channel}
            onChange={(e) => apply({ channel: e.target.value })}
            className="w-full rounded-control border border-border-subtle bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          >
            <option value="">{t.anyChannel}</option>
            {CHANNELS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
