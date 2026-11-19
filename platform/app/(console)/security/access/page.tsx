import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusPill,
} from "../../../../components/ui/primitives";
import { auditView, consoleRpc, requireSession } from "../../../../lib/console/access";
import { can, isRole, ROLE_LABELS, ROLES } from "../../../../lib/console/permissions";
import { formatDateTime } from "../../../../lib/format";

export const metadata = { title: "Access Management" };

type Staff = { user_id: string; email: string | null; role: string; status: "active" | "suspended"; created_at: string };

export default async function AccessPage() {
  const session = await requireSession();
  if (!can(session.access, "view_staff")) {
    return (
      <>
        <PageHeader title="Access Management" />
        <ErrorState message="Your role does not include access to the staff directory." />
      </>
    );
  }
  await auditView(session, "staff_directory.viewed", "access-management");
  const res = await consoleRpc<Staff[]>(session, "console_staff_list");

  return (
    <>
      <PageHeader
        title="Access Management"
        subtitle="Read-only. Staff are granted or revoked by a database operator, never from inside the console."
      />
      <Card title="Staff" subtitle="Everyone who can sign in to this console">
        {!res.ok ? (
          <ErrorState message="Staff directory could not be loaded." />
        ) : res.data.length === 0 ? (
          <EmptyState message="No staff configured." />
        ) : (
          <DataTable caption="Console staff" columns={["Email", "Role", "Status", "Added"]}>
            {res.data.map((s) => (
              <tr key={s.user_id}>
                <td className="px-2 py-2">{s.email ?? "—"}</td>
                <td className="px-2 py-2">{isRole(s.role) ? ROLE_LABELS[s.role] : s.role}</td>
                <td className="px-2 py-2">
                  <StatusPill tone={s.status === "active" ? "positive" : "attention"}>{s.status}</StatusPill>
                </td>
                <td className="px-2 py-2 text-text-2">{formatDateTime(s.created_at)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
      <Card title="Roles" subtitle="Your own permissions are listed below; the full matrix is enforced in the database (console_role_permissions)." className="mt-4">
        <p className="text-xs text-text-3">Defined roles: {ROLES.map((r) => ROLE_LABELS[r]).join(" · ")}</p>
        <p className="mt-2 text-sm">
          Your permissions:{" "}
          <span className="font-mono text-xs text-text-2">{session.access.permissions.join(", ") || "none"}</span>
        </p>
      </Card>
    </>
  );
}
