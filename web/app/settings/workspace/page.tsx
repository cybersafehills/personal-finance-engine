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
          title="Workspace"
          subtitle="Your personal workspace can't have other members"
        />
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Create an organization workspace to share a ledger with other
            people — accounts, transactions, and budgets, visible to
            everyone you invite.
          </p>
          <CreateOrganizationForm />
        </div>
      </div>
    );
  }

  const [members, invites] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    getWorkspaceInvites(workspace.id),
  ]);

  const canManage = workspace.role === "owner";

  return (
    <div>
      <PageHeader title={workspace.name} subtitle="Members and invites" />

      <div className="flex flex-col gap-3">
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
