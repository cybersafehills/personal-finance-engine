import { normalizeRwandaMsisdn } from "./target";

// "Choose from my contacts": opens the phone's own contact picker, the user picks
// one person, and only that person's name and Rwandan mobile number come back.
// OneLedger never reads the address book, never keeps it and never asks for
// access to all of it: the system picker hands over just the one contact chosen.

export type PickedContact = { name: string; number: string };
export type PickResult = { ok: true; contact: PickedContact } | { ok: false; cancelled: boolean; message: string };

/** The first number that is a Rwandan mobile, shown the local way (078…). */
export function chooseRwandanNumber(numbers: readonly string[]): string | null {
  for (const n of numbers) {
    const normalized = normalizeRwandaMsisdn(n);
    if (normalized) return `0${normalized.slice(3)}`;
  }
  return null;
}

type NativeContact = { getFullName(): Promise<string>; getPhones(): Promise<{ number?: string | null }[]> };
type ContactsModule = { Contact: { presentPicker(): Promise<NativeContact | null> } };

export async function pickPhoneContact(load: () => Promise<ContactsModule> = () => import("expo-contacts") as unknown as Promise<ContactsModule>): Promise<PickResult> {
  try {
    const { Contact } = await load();
    const picked = await Contact.presentPicker();
    if (!picked) return { ok: false, cancelled: true, message: "" };
    const [fullName, phones] = await Promise.all([picked.getFullName().catch(() => ""), picked.getPhones().catch(() => [])]);
    const number = chooseRwandanNumber(phones.map((p) => p.number ?? ""));
    if (!number) return { ok: false, cancelled: false, message: "That contact has no Rwandan mobile number." };
    return { ok: true, contact: { name: (fullName ?? "").trim(), number } };
  } catch {
    return { ok: false, cancelled: false, message: "Your phone's contacts couldn't be opened here. Type the number instead." };
  }
}
