import {
  getActiveWorkspace,
  getWorkspaceInvites,
  getWorkspaceMembers,
} from "../../../lib/queries";
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
    return (
      <div>
        <PageHeader
          title="Spaces"
          subtitle="Personal is yours alone. Create a shared Space to collaborate."
        />
        <div className="flex flex-col gap-4">
          <CreateHouseholdForm />

          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">
              Running a business or a group instead? An organization Space
              shares one ledger — every account, transaction, and budget —
              with everyone you invite.
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

  const canManage = workspace.role === "owner";

  return (
    <div>
      <PageHeader
        title={workspace.name}
        subtitle={`${kindLabel} · members and invites`}
      />

      <div className="flex flex-col gap-3">
        {workspace.kind === "household" && (
          <p className="text-sm text-text-muted">
            Everyone here has their own OneLedger account. What each person
            shares — nothing, transactions only, or the full balance — is
            set per account under{" "}
            <span className="font-medium text-text-secondary">
              Settings → Shared accounts
            </span>
            .
          </p>
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
