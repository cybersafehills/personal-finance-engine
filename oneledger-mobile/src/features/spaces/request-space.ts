// The Space the next /api/mobile request should name. Module-level (not React
// state) because the request helpers are plain functions, not hooks. Set by
// ActiveSpaceProvider before any data reloads.
let requested: string | null = null;

export function setRequestedWorkspace(id: string | null): void {
  requested = id;
}

export function getRequestedWorkspace(): string | null {
  return requested;
}
