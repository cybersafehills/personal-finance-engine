import Link from "next/link";
import { PageHeader } from "../../components/PageHeader";
import { getActiveWorkspaceId, getUserWorkspaces } from "../../lib/queries";
import { isSpacesEnabled } from "../../lib/spaces/gate";
import { isSurfaceVisible } from "../../lib/experience-mode";
import {
  isBusinessSurfacesEnabled,
  resolveExperienceMode,
} from "../../lib/experience-mode/gate";
import { visibleSettingsGroups } from "../../lib/settings-navigation";

export const dynamic = "force-dynamic";

// The Settings home. Rendered straight from lib/settings-navigation.ts -
// seven named groups, each with a one-line purpose, so a user can see the
// whole shape of Settings at a glance (master prompt section 110). Rows
// deep-link to the existing pages; this page owns only the grouping and
// the visibility filter (experience mode + Spaces flag).
export default async function SettingsPage() {
  const [activeWorkspaceId, workspaces] = await Promise.all([
    getActiveWorkspaceId(),
    getUserWorkspaces(),
  ]);
  const experienceMode = resolveExperienceMode(activeWorkspaceId, workspaces);
  const businessEnabled = isBusinessSurfacesEnabled(activeWorkspaceId);

  const groups = visibleSettingsGroups({
    spacesEnabled: isSpacesEnabled(activeWorkspaceId),
    surfaceVisible: (surface) =>
      isSurfaceVisible(experienceMode, surface, { businessEnabled }),
  });

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Your profile, accounts, Spaces, and how OneLedger works for you."
      />

      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.key} className="flex flex-col gap-2">
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                {group.title}
              </h2>
              <p className="text-xs text-text-muted">{group.description}</p>
            </div>
            <ul className="flex flex-col gap-2">
              {group.rows.map((row) => (
                <li key={row.href}>
                  <Link
                    href={row.href}
                    className="flex flex-col gap-0.5 rounded-card border border-border-subtle bg-surface p-4 transition-colors hover:bg-background focus-visible:bg-background"
                  >
                    <span className="text-sm font-medium text-text-primary">
                      {row.label}
                    </span>
                    <span className="text-sm text-text-muted">
                      {row.description}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
