// Spaces (personal, household, organization). Pure rules, kept apart from
// React and native APIs so they are unit-testable.
//
// Selected Space scopes financial data. Database membership and source RLS
// independently decide which records the user can access.

export type SpaceKind = "personal" | "household" | "organization";

export type Space = {
  id: string;
  name: string;
  kind: SpaceKind;
  role: string;
};

const KINDS: readonly SpaceKind[] = ["personal", "household", "organization"];

export function isSpaceKind(value: unknown): value is SpaceKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

export function kindLabel(kind: SpaceKind): string {
  return kind === "personal" ? "Personal" : kind === "household" ? "Household" : "Organization";
}

/**
 * The Space to show: the stored choice if the user is still a member, else
 * their personal Space, else the first one. Mirrors the web's
 * `getActiveWorkspaceId` fallback for a revoked membership.
 */
export function resolveActiveSpace(spaces: readonly Space[], storedId: string | null): Space | null {
  if (spaces.length === 0) return null;
  return (
    spaces.find((s) => s.id === storedId) ??
    spaces.find((s) => s.kind === "personal") ??
    spaces[0]
  );
}

/**
 * The id to send as `X-Workspace-Id`, or null for the personal Space (the
 * server default, so an older server keeps working for the common case).
 */
export function requestedWorkspaceId(active: Space | null): string | null {
  return active && active.kind !== "personal" ? active.id : null;
}

/**
 * Whether a server response is for the Space that was asked for. Only checked
 * when a header was sent; a server that ignores the header (or a revoked
 * membership) echoes another id or none, and the data must not be presented as
 * that Space's.
 */
export function echoMatches(requested: string | null, body: unknown): boolean {
  if (requested === null) return true;
  const echoed =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).workspace_id
      : undefined;
  return typeof echoed === "string" && echoed.toLowerCase() === requested.toLowerCase();
}

/** Storage key for the remembered choice, per user so accounts never share it. */
export function storageKey(userId: string): string {
  return `oneledger.activeSpace.${userId}`;
}

/**
 * Whether a transaction lives in the Space the server will use for the next
 * request: the one named by `X-Workspace-Id` when one is sent, else the user's
 * personal Space (the server default, which is also what an app that couldn't
 * load its Space list gets). Things the server does for "the active Space" (the
 * Inbox's duplicate review, the Pay drafts it creates) only make sense for a
 * transaction in that Space.
 */
export function isInRequestedSpace(
  transaction: { workspaceId: string; workspaceKind: SpaceKind | string | null },
  requestedId: string | null,
): boolean {
  return requestedId === null
    ? transaction.workspaceKind === "personal"
    : transaction.workspaceId.toLowerCase() === requestedId.toLowerCase();
}
