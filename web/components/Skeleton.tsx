export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-control bg-border-subtle ${className ?? ""}`}
      aria-hidden="true"
    />
  );
}
