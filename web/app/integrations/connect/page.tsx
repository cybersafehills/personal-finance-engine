import Link from "next/link";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { Badge } from "../../../components/Badge";
import { StepWizard } from "../../../components/ds/StepWizard";
import { getActiveWorkspaceId } from "../../../lib/queries";
import {
  isExportCenterEnabled,
  isImportStudioEnabled,
  isIntegrationsEnabled,
  isWorkbooksEnabled,
} from "../../../lib/integrations/gate";
import {
  type ConnectDirection,
  type ConnectSource,
  DIRECTION_OPTIONS,
  IMPORT_DATA_TYPE_OPTIONS,
  isConnectDirection,
  isConnectSource,
  resolveConnectHandoff,
  SOURCE_OPTIONS,
} from "../../../lib/integrations/connect-wizard";

export const dynamic = "force-dynamic";

// The unified "connect a system" wizard (master prompt §8, gap analysis
// G2). A searchParams-driven server component — same pattern as the
// onboarding wizard: real navigation, a working back button, no client
// state. It chooses source -> direction -> data type, then hands off to
// Import Studio / Export Center / connected workbooks, which own steps
// 4-9 (file / map / validate / preview / confirm / done).

type SP = Record<string, string | string[] | undefined>;

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `/integrations/connect?${s}` : "/integrations/connect";
}

function pick(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export default async function ConnectWizardPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const workspaceId = await getActiveWorkspaceId();

  if (!isIntegrationsEnabled(workspaceId)) {
    return (
      <div>
        <PageHeader title="Connect a system" backHref="/integrations" backLabel="Integrations" />
        <EmptyState title="Integrations isn’t enabled for this Space" />
      </div>
    );
  }

  const query = await searchParams;
  const rawSource = pick(query.source);
  const rawDirection = pick(query.direction);

  const source: ConnectSource | undefined =
    rawSource && isConnectSource(rawSource) ? rawSource : undefined;
  const direction: ConnectDirection | undefined =
    rawDirection && isConnectDirection(rawDirection) ? rawDirection : undefined;

  const gates = {
    import: isImportStudioEnabled(workspaceId),
    export: isExportCenterEnabled(workspaceId),
    workbooks: isWorkbooksEnabled(workspaceId),
  };

  // --- derive the active step from what's been chosen -------------------
  let step: 0 | 1 | 2 = 0;
  if (source) step = 1;
  if (source && direction) step = 2;

  const lastLabel = direction === "import" ? "Data" : "Confirm";
  const stepLabels = ["Source", "Direction", lastLabel] as const;

  const backHref = step === 0
    ? "/integrations"
    : step === 1
    ? qs({})
    : qs({ source, direction: undefined });
  const backLabel = step === 0 ? "Integrations" : "Back";

  return (
    <div>
      <PageHeader
        title="Connect a system"
        subtitle="Bring data in, send it out, or keep a workbook in sync — in a few steps."
        backHref={backHref}
        backLabel={backLabel}
      />

      <StepWizard steps={stepLabels} current={step}>
        {step === 0 && <SourceStep />}
        {step === 1 && <DirectionStep source={source!} gates={gates} />}
        {step === 2 && (
          <FinalStep source={source!} direction={direction!} />
        )}
      </StepWizard>
    </div>
  );
}

function OptionCard({
  href,
  name,
  blurb,
  disabled = false,
  badge,
}: {
  href: string | null;
  name: string;
  blurb: string;
  disabled?: boolean;
  badge?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-primary">{name}</span>
        {badge && <Badge>{badge}</Badge>}
        {href && !disabled && (
          <span aria-hidden="true" className="ml-auto text-text-muted">→</span>
        )}
      </div>
      <p className="mt-1 text-sm text-text-muted">{blurb}</p>
    </>
  );
  if (href && !disabled) {
    return (
      <Link
        href={href}
        className="block rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="block rounded-card border border-border-subtle bg-surface p-4 opacity-60">
      {inner}
    </div>
  );
}

function SourceStep() {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-text-primary">
        What are you connecting?
      </h2>
      <ul className="flex flex-col gap-2">
        {SOURCE_OPTIONS.map((o) => (
          <li key={o.key}>
            <OptionCard
              name={o.name}
              blurb={o.blurb}
              href={o.status === "available"
                ? qs({ source: o.key })
                : o.comingSoonHref ?? null}
              badge={o.status === "coming_soon" ? "Coming soon" : undefined}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DirectionStep({
  source,
  gates,
}: {
  source: ConnectSource;
  gates: { import: boolean; export: boolean; workbooks: boolean };
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-text-primary">
        Which way should the data move?
      </h2>
      <ul className="flex flex-col gap-2">
        {DIRECTION_OPTIONS.map((o) => {
          const enabled = gates[o.gate];
          return (
            <li key={o.key}>
              <OptionCard
                name={o.name}
                blurb={o.blurb}
                href={enabled ? qs({ source, direction: o.key }) : null}
                disabled={!enabled}
                badge={enabled ? undefined : "Not enabled"}
              />
            </li>
          );
        })}
      </ul>
      {!gates.import && !gates.export && (
        <p className="mt-3 text-sm text-text-muted">
          Neither importing nor exporting is turned on for this Space yet. Ask an
          administrator to enable the Import Studio or Export Center.
        </p>
      )}
    </div>
  );
}

function FinalStep({
  source,
  direction,
}: {
  source: ConnectSource;
  direction: ConnectDirection;
}) {
  // The import path picks a data type here; export / two-way resolve straight away.
  if (direction === "import") {
    return (
      <div>
        <h2 className="mb-3 text-sm font-semibold text-text-primary">
          What kind of data are you importing?
        </h2>
        <ul className="flex flex-col gap-2">
          {IMPORT_DATA_TYPE_OPTIONS.map((o) => {
            const chosen = { source, direction, dataType: o.key };
            const res = resolveConnectHandoff(chosen);
            return (
              <li key={o.key}>
                <OptionCard
                  name={o.name}
                  blurb={o.blurb}
                  href={o.status === "available" && res.ok ? res.href : null}
                  disabled={o.status !== "available"}
                  badge={o.status === "coming_soon" ? "Coming soon" : undefined}
                />
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-sm text-text-muted">
          You’ll upload a CSV or Excel file (or start from a{" "}
          <Link
            href="/integrations/imports/templates"
            className="font-medium text-accent hover:underline"
          >
            starter template
          </Link>
          ), map its columns, review duplicates, and confirm before anything
          enters your ledger. Got a multi-sheet workbook?{" "}
          <Link
            href="/integrations/imports/analyze"
            className="font-medium text-accent hover:underline"
          >
            Analyze it first
          </Link>
          .
        </p>
      </div>
    );
  }

  const res = resolveConnectHandoff({ source, direction });
  if (!res.ok) {
    return (
      <p className="rounded-card border border-border-subtle bg-surface p-4 text-sm text-text-muted">
        {res.reason}
      </p>
    );
  }
  return (
    <div className="rounded-card border border-border-subtle bg-surface p-4">
      <p className="text-sm text-text-secondary">{res.summary}</p>
      <Link
        href={res.href}
        className="mt-3 inline-flex min-h-11 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-foreground"
      >
        {res.label} →
      </Link>
    </div>
  );
}
