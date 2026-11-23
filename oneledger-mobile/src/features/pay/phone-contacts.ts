import { normalizeRwandaMsisdn } from "./target";

// "Choose from my contacts": opens the phone's own contact picker, the user picks
// one person, and only that person's name and Rwandan mobile number come back.
// OneLedger never reads the address book, never keeps it and never asks for
// access to all of it: the system picker hands over just the one contact chosen.

export type PickedContact = { name: string; number: string };
export type PickResult = { ok: true; contact: PickedContact } | { ok: false; cancelled: boolean; message: string };

/** `+250 788 123 456` -> `+### ### ### ###`: the format of a number, never the number. */
export function numberShape(n: string): string {
  return n.replace(/\d/g, "#");
}

// Why a pick failed is logged (development only, and never the number or the name) so a
// phone that misbehaves can be diagnosed from the dev server's log.
function logWhy(why: string) {
  if (__DEV__) console.warn(`[contacts] ${why}`);
}

/** The first number that is a Rwandan mobile, shown the local way (078…). */
export function chooseRwandanNumber(numbers: readonly string[]): string | null {
  for (const n of numbers) {
    // Contacts are saved every way people write numbers: "+250 (0) 788…", "00250 788…", "0788…".
    const cleaned = n.replace(/\(0\)/g, "").trim().replace(/^00(?=250)/, "+");
    const normalized = normalizeRwandaMsisdn(cleaned);
    if (normalized) return `0${normalized.slice(3)}`;
  }
  return null;
}

type NativeContact = { getFullName(): Promise<string>; getPhones(): Promise<{ number?: string | null }[]> };
type ContactsModule = { Contact: { presentPicker(): Promise<NativeContact | null> } };

export async function pickPhoneContact(load: () => Promise<ContactsModule> = () => import("expo-contacts") as unknown as Promise<ContactsModule>): Promise<PickResult> {
  let picked: NativeContact | null;
  try {
    const { Contact } = await load();
    picked = await Contact.presentPicker();
  } catch (e) {
    logWhy(`the picker could not open: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, cancelled: false, message: "Your phone's contacts couldn't be opened. Type the number instead." };
  }
  if (!picked) {
    logWhy("the picker was closed without a choice");
    return { ok: false, cancelled: true, message: "" };
  }
  let phones: { number?: string | null }[];
  let fullName = "";
  try {
    phones = await picked.getPhones();
  } catch (e) {
    logWhy(`the chosen contact's numbers could not be read: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, cancelled: false, message: "We couldn't read that contact's number. Type it instead." };
  }
  try {
    fullName = (await picked.getFullName()) ?? "";
  } catch {
    // The name is a convenience: a contact without a readable one still gives its number.
  }
  const number = chooseRwandanNumber(phones.map((p) => p.number ?? ""));
  if (!number) {
    logWhy(`the chosen contact has ${phones.length} number(s), none a Rwandan mobile (shapes: ${phones.map((p) => numberShape(p.number ?? "")).join(" | ") || "none"})`);
    return { ok: false, cancelled: false, message: "That contact has no Rwandan mobile number." };
  }
  return { ok: true, contact: { name: fullName.trim(), number } };
}
