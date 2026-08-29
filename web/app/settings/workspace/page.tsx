import {
  getActiveWorkspace,
  getActiveWorkspaceId,
  getWorkspaceInvites,
  getWorkspaceMembers,
} from "../../../lib/queries";
import { isSpacesEnabled } from "../../../lib/spaces/gate";
import { PageHeader } from "../../../components/PageHeader";
import { EmptyState } from "../../../components/EmptyState";
import { MemberItem } from "../../../components/MemberItem";
import { InviteItem } from "../../../components/InviteItem";
import { CreateInviteForm } from "../../../components/CreateInviteForm";
import { CreateOrganizationForm } from "../../../components/CreateOrganizationForm";
import { CreateHouseholdForm } from "../../../components/CreateHouseholdForm";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const workspace = await getActiveWorkspace();

  if (!workspace) {
    return (
      <div>
        <PageHeader title="Workspace" />
        <EmptyState title="Could not resolve your workspace" />
      </div>
    );
  }

  if (workspace.kind === "personal") {
    const householdsEnabled = isSpacesEnabled(await getActiveWorkspaceId());
    return (
      <div>
        <PageHeader
          title="Spaces"
          subtitle="Personal is yours alone. Create a shared Space to collaborate."
        />
        <div className="flex flex-col gap-4">
          {householdsEnabled && <CreateHouseholdForm />}

          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              {householdsEnabled
                ? "Running a business or a group instead? An organization Space shares one ledger — every account, transaction, and budget — with everyone you invite."
                : "An organization Space shares one ledger — every account, transaction, and budget — with everyone you invite."}
            </p>
            <CreateOrganizationForm />
          </div>
        </div>
      </div>
    );
  }

  const kindLabel = workspace.kind === "household" ? "Household" : "Organization";

  const [members, invites] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    getWorkspaceInvites(workspace.id),
  ]);

  // Owners and Admins can invite and manage members (has_space_capability
  // 'members.manage'). Anything touching an Owner stays Owner-only,
  // enforced server-side by set_member_role / remove_member.
  const canManage = workspace.role === "owner" || workspace.role === "admin";

  return (
    <div>
      <PageHeader
        title={workspace.name}
        subtitle={`${kindLabel} · members and invites`}
      />

      <div className="flex flex-col gap-3">
        {workspace.kind === "household" && (
          <details className="rounded-card border border-border-subtle bg-surface p-4 text-sm text-text-muted [&_summary]:cursor-pointer">
            <summary className="font-medium text-text-primary">
              How households work
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <p>
                Everyone here keeps their own OneLedger account and their own
                private transactions. Nothing is shared automatically.
              </p>
              <p>
                You choose, per account, what this household sees — nothing,
                transactions only, or the full balance — under{" "}
                <span className="font-medium text-text-secondary">
                  Settings → Shared accounts
                </span>
                .
              </p>
              <p>
                Every shared transaction can be marked as one person&apos;s
                spending, split between people, or shared by the household.
                This only changes how the household&apos;s reports count it —
                it never moves money.
              </p>
            </div>
          </details>
        )}

        {members.map((member) => (
          <MemberItem key={member.membershipId} member={member} canManage={canManage} />
        ))}

        {canManage && (
          <>
            {invites.length > 0 && (
              <div className="flex flex-col gap-3 pt-2">
                <h2 className="text-sm font-medium text-text-primary">
                  Pending invites
                </h2>
                {invites.map((invite) => (
                  <InviteItem key={invite.id} invite={invite} />
                ))}
              </div>
            )}

            <CreateInviteForm
              workspaceId={workspace.id}
              workspaceName={workspace.name}
            />
          </>
        )}
      </div>
    </div>
  );
}
