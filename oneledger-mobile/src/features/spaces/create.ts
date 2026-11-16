import { supabase } from "@/api/supabase";

// Creating a Space. The web runs two database functions as the signed-in user
// (create_household_workspace / create_organization_workspace): each creates the
// Space and makes the caller its sole owner in one step, and a household
// inherits the caller's currency and timezone. The app calls the same functions
// under the same session, so it can do nothing the user could not already do.

export type CreatableKind = "household" | "organization";

/** The web enforces no maximum; a limit here only stops an absurd paste. */
export const MAX_SPACE_NAME_LENGTH = 80;

export type NameCheck = { ok: true; name: string } | { ok: false; message: string };

/** Trim and collapse whitespace; the database requires a non-empty name. */
export function validateSpaceName(input: string): NameCheck {
  const name = input.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, message: "Enter a name." };
  if (name.length > MAX_SPACE_NAME_LENGTH) {
    return { ok: false, message: `Keep the name under ${MAX_SPACE_NAME_LENGTH + 1} characters.` };
  }
  return { ok: true, name };
}

const RPC: Record<CreatableKind, string> = {
  household: "create_household_workspace",
  organization: "create_organization_workspace",
};

/** Thrown when the Space could not be created. The message is user-safe. */
export class CreateSpaceError extends Error {}

/** Creates the Space and returns its id. */
export async function createSpace(kind: CreatableKind, name: string): Promise<string> {
  const check = validateSpaceName(name);
  if (!check.ok) throw new CreateSpaceError(check.message);
  if (!supabase) throw new CreateSpaceError("This build isn't connected to OneLedger yet.");

  const { data, error } = await supabase.rpc(RPC[kind], { p_name: check.name });
  if (error || typeof data !== "string" || data === "") {
    throw new CreateSpaceError("Couldn't create that Space. Check your connection and try again.");
  }
  return data;
}

export const KIND_COPY: Record<
  CreatableKind,
  { title: string; description: string; nameLabel: string; placeholder: string; action: string }
> = {
  household: {
    title: "Household",
    description:
      "Share a budget and financial picture with the people you live with. Each person keeps their own account and chooses what to share.",
    nameLabel: "Household name",
    placeholder: "e.g. Dolton Household",
    action: "Create household",
  },
  organization: {
    title: "Organization",
    description:
      "Running a business or a group? An organization Space shares one ledger (every account, transaction, and budget) with everyone you invite.",
    nameLabel: "Organization name",
    placeholder: "e.g. Dolton & Co",
    action: "Create organization",
  },
};

/** Which kinds the user is offered: households only where Spaces is switched on, as on the web. */
export function creatableKinds(spacesEnabled: boolean): CreatableKind[] {
  return spacesEnabled ? ["household", "organization"] : ["organization"];
}
