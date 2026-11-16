// Space & members: pure rules. Mirrors web/components/MemberItem.tsx and the
// workspace page, but follows what the database actually allows (the web shows
// role and remove controls to admins too, and the database then refuses them).

export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type InviteRole = "admin" | "member" | "viewer";

export const ROLE_OPTIONS: readonly { value: MemberRole; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

/** What an invite can grant: never owner. */
export const INVITE_ROLE_OPTIONS: readonly { value: InviteRole; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
];

export type Member = {
  membershipId: string;
  userId: string;
  role: MemberRole;
  status: string;
  joinedAt: string | null;
  isSelf: boolean;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
  expired: boolean;
};

const isRole = (v: unknown): v is MemberRole =>
  v === "owner" || v === "admin" || v === "member" || v === "viewer";

export function asRole(value: unknown): MemberRole {
  return isRole(value) ? value : "viewer";
}

export function roleLabel(role: MemberRole): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? "Viewer";
}

/** Owners and admins can invite and cancel invites (has_space_capability members.manage). */
export function canManageInvites(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Only owners can change roles or remove people (set_member_role / remove_member). */
export function canChangeMembers(role: string | null | undefined): boolean {
  return role === "owner";
}

/** Whether to show role/remove controls on this row: an owner, on someone else. */
export function canEditRow(myRole: string | null | undefined, member: Pick<Member, "isSelf">): boolean {
  return canChangeMembers(myRole) && !member.isSelf;
}

/** "You", the directory's display name, or "Member 1a2b3c4d" as the web shows. */
export function memberLabel(member: Member, names: ReadonlyMap<string, string>): string {
  if (member.isSelf) return "You";
  const name = names.get(member.userId)?.trim();
  return name ? name : `Member ${member.userId.slice(0, 8)}`;
}

/** Short sentence for the invite expiry line. */
export function inviteExpiryLabel(invite: Pick<PendingInvite, "expired" | "expiresAt">, format: (iso: string) => string): string {
  return invite.expired ? "Expired" : `Expires ${format(invite.expiresAt)}`;
}

/** Same loose rule as the server; the invite email is the real check. */
export function isPlausibleEmail(input: string): boolean {
  const email = input.trim();
  return email.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(email);
}

/** What to tell the inviter once the server has created the invite. */
export function inviteOutcomeText(email: string, emailSent: boolean): string {
  return emailSent
    ? `We emailed an invite to ${email}.`
    : `We couldn't email ${email}. Share the link yourself; it won't be shown again.`;
}
