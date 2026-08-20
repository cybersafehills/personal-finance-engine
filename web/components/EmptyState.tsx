export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
      <p className="text-sm font-medium text-text-secondary">{title}</p>
      {description && (
        <p className="text-sm text-text-muted">{description}</p>
      )}
    </div>
  );
}
