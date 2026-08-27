import { notFound } from "next/navigation";
import { PageHeader } from "../../../../components/PageHeader";
import { PermissionGrantsPanel } from "../../../../components/directory/PermissionGrantsPanel";
import { isPlatformAdmin } from "../../../../lib/pay/admin";
import { getDirectoryGrantees } from "../../../../lib/directory/permissions-admin";

export const dynamic = "force-dynamic";

export default async function DirectoryPermissionsPage() {
  // Granting/revoking directory.* permissions is is_platform_admin-only
  // (the RPCs enforce it in Postgres too).
  if (!(await isPlatformAdmin())) notFound();

  const grantees = await getDirectoryGrantees();

  return (
    <div>
      <PageHeader
        title="Directory permissions"
        subtitle="Grant granular directory.* permissions for maker–checker separation"
        backHref="/admin/directory"
        backLabel="Directory Management"
      />
      <PermissionGrantsPanel grantees={grantees} />
    </div>
  );
}
