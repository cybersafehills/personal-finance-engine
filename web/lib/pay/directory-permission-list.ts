// The 14 directory.* permission slugs (ADR 0004). Split out from
// directory-perms.ts (which is `server-only`) so client components can
// import just the list + type without pulling server code into the bundle.

export const DIRECTORY_PERMISSIONS = [
  "directory.view_admin",
  "directory.create",
  "directory.edit_draft",
  "directory.submit_review",
  "directory.review",
  "directory.publish",
  "directory.suspend",
  "directory.deprecate",
  "directory.archive",
  "directory.restore",
  "directory.view_evidence",
  "directory.manage_evidence",
  "directory.view_audit",
  "directory.resolve_reports",
] as const;

export type DirectoryPermission = (typeof DIRECTORY_PERMISSIONS)[number];
