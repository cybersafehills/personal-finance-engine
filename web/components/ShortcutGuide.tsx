"use client";

import type {
  GuideStep,
  GuideTroubleshootRow,
} from "../lib/shortcut-guide";
import { CopyField } from "./ConnectionDetails";

/**
 * Renders the canonical Shortcut-setup guide (web/lib/shortcut-guide.ts).
 * The page resolves the endpoint URL and sender server-side and passes
 * the built steps in - this component is presentation only.
 */
export function ShortcutGuide({
  steps,
  troubleshooting,
  shortcutUrl,
}: {
  steps: GuideStep[];
  troubleshooting: GuideTroubleshootRow[];
  shortcutUrl: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      {shortcutUrl && (
        <a
          href={shortcutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-fit items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
        >
          Get the ready-made Shortcut
        </a>
      )}

      <ol className="flex flex-col gap-5">
        {steps.map((step) => (
          <li
            key={step.n}
            className="flex flex-col gap-2 rounded-card border border-border-subtle bg-surface p-4"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-text-muted">
                Step {step.n}
              </span>
              <h2 className="text-sm font-medium text-text-primary">
                {step.title}
              </h2>
            </div>
            {step.body.map((para, i) => (
              <p key={i} className="text-sm text-text-secondary">
                {para}
              </p>
            ))}
            {step.fields && step.fields.length > 0 && (
              <div className="mt-1 flex flex-col gap-2">
                {step.fields.map((field) =>
                  field.copyable
                    ? (
                      <CopyField
                        key={field.label}
                        label={field.label}
                        value={field.value}
                      />
                    )
                    : (
                      <div
                        key={field.label}
                        className="flex flex-col gap-1"
                      >
                        <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                          {field.label}
                        </span>
                        <code className="w-fit break-all rounded-control border border-border-subtle bg-background px-2 py-1.5 text-xs text-text-primary">
                          {field.value}
                        </code>
                      </div>
                    )
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-primary">
          Troubleshooting
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border-strong text-text-muted">
                <th className="py-2 pr-3 font-medium">What you see</th>
                <th className="py-2 font-medium">What to do</th>
              </tr>
            </thead>
            <tbody>
              {troubleshooting.map((row, i) => (
                <tr key={i} className="border-b border-border-subtle align-top">
                  <td className="py-2 pr-3 text-text-secondary">
                    {row.symptom}
                  </td>
                  <td className="py-2 text-text-secondary">{row.fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
