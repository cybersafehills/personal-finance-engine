import Link from "next/link";
import { DocumentIcon } from "./icons";

/**
 * The header's icon-only entry point to Reports, now that Reports has
 * been removed from primary navigation (master prompt §4.1). No
 * permanent text label - just a recognizable document/report icon with
 * an accessible name and a native tooltip on hover/focus, matching the
 * spec's "Open reports" requirement. Reuses DocumentIcon rather than
 * introducing a second report-shaped glyph into the icon set.
 */
export function ReportsButton() {
  return (
    <Link
      href="/reports"
      aria-label="Open reports"
      title="Reports"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-background hover:text-text-primary focus-visible:bg-background"
    >
      <DocumentIcon className="h-5 w-5" />
    </Link>
  );
}
