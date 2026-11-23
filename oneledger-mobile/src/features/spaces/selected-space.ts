// Explicit selection is separate from the legacy header default (null means
// Personal there). Only ActiveSpaceProvider sets this from a membership list.
let selected: string | null = null;
export function selectWorkspace(id: string | null) { selected = id; }
export function selectedWorkspaceId(): string {
  if (!selected) throw new Error("Choose a Space before loading financial data.");
  return selected;
}
