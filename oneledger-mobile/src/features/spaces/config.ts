/** Whether the Spaces feature (households) is on for this user, from GET /api/mobile/config. */
export function parseSpacesEnabled(status: number, body: unknown): boolean {
  if (status !== 200 || typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (b.ok !== true || typeof b.config !== "object" || b.config === null) return false;
  return (b.config as Record<string, unknown>).spaces === true;
}
