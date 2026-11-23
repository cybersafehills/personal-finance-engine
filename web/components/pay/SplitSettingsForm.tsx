"use client";

import { useState } from "react";
import { setSplitPreferencesAction } from "../../app/pay/splits/actions";
import { messages } from "../../lib/ussd/messages";
import type { SplitThreshold } from "../../lib/pay/splits/split-math";

const t = messages().pay.splits.settings;

const OPTIONS: { value: SplitThreshold; title: string; hint: string; recommended?: boolean }[] = [
  { value: "any", title: t.any, hint: t.anyHint },
  { value: "balanced", title: t.balanced, hint: t.balancedHint, recommended: true },
  { value: "bigger", title: t.bigger, hint: t.biggerHint },
];

export function SplitSettingsForm({
  initial,
}: {
  initial: { feeSavingEnabled: boolean; threshold: SplitThreshold };
}) {
  const [enabled, setEnabled] = useState(initial.feeSavingEnabled);
  const [threshold, setThreshold] = useState<SplitThreshold>(initial.threshold);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(next: { enabled: boolean; threshold: SplitThreshold }) {
    setPending(true);
    setStatus(null);
    const res = await setSplitPreferencesAction({
      feeSavingEnabled: next.enabled,
      threshold: next.threshold,
    });
    setPending(false);
    setStatus(res.ok ? t.saved : res.error);
    if (!res.ok) {
      setEnabled(initial.feeSavingEnabled);
      setThreshold(initial.threshold);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <label className="flex items-center justify-between gap-4 rounded-control border border-border-subtle bg-surface px-4 py-3">
        <span className="text-sm font-medium text-text-primary">{t.enable}</span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={pending}
          onChange={(e) => {
            setEnabled(e.target.checked);
            void save({ enabled: e.target.checked, threshold });
          }}
          className="h-5 w-5"
        />
      </label>
      <p className="text-sm text-text-secondary">{t.explain}</p>

      <fieldset className="flex flex-col gap-2" disabled={!enabled || pending}>
        <legend className="mb-1 text-sm font-semibold text-text-primary">{t.question}</legend>
        {OPTIONS.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-3 rounded-control border border-border-subtle bg-surface px-4 py-3"
          >
            <input
              type="radio"
              name="threshold"
              value={o.value}
              checked={threshold === o.value}
              onChange={() => {
                setThreshold(o.value);
                void save({ enabled, threshold: o.value });
              }}
              className="mt-1"
            />
            <span>
              <span className="text-sm font-medium text-text-primary">
                {o.title}
                {o.recommended && (
                  <span className="ml-2 text-xs font-normal text-accent">({t.recommended})</span>
                )}
              </span>
              <span className="block text-xs text-text-secondary">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <p className="text-xs text-text-muted">{t.ekashNote}</p>
      {status && (
        <p className="text-sm text-text-secondary" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
