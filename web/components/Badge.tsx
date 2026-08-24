const VARIANTS = {
  attention: "bg-attention-bg text-attention",
  neutral: "bg-background text-text-secondary",
  accent: "bg-accent text-accent-foreground",
  positive: "bg-money-positive-bg text-money-positive",
} as const;

export function Badge({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode;
  variant?: keyof typeof VARIANTS;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${VARIANTS[variant]}`}
    >
      {children}
    </span>
  );
}
