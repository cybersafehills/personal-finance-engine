// "Why am I seeing this?" - the explainability disclosure every material
// insight must carry (assessment section 47 / ADR 0014). A plain native
// <details> so it is keyboard- and screen-reader-accessible with no JS.
// Pass the deterministic inputs the insight was computed from: the
// supporting facts, the period, the calculation, the confidence.

export function WhyThisInsight({
  basis,
  period,
  method,
  confidence,
}: {
  /** Human-readable inputs, e.g. "Starting from your current balance." */
  basis: readonly string[];
  /** e.g. "Next 30 days" or "This month vs your last 3 months". */
  period?: string;
  /** Short description of the calculation. */
  method?: string;
  confidence?: "high" | "medium" | "low";
}) {
  return (
    <details className="mt-2 text-xs text-text-muted">
      <summary className="cursor-pointer font-medium text-accent hover:underline">
        Why am I seeing this?
      </summary>
      <div className="mt-1.5 flex flex-col gap-1.5 border-l-2 border-border-subtle pl-3">
        {period && <p>Period: {period}</p>}
        {basis.length > 0 && (
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {basis.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        )}
        {method && <p>How it&rsquo;s calculated: {method}</p>}
        {confidence && <p>Confidence: {confidence}</p>}
      </div>
    </details>
  );
}
