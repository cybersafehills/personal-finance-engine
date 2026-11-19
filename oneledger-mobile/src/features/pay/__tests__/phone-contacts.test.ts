import { chooseRwandanNumber, pickPhoneContact } from "../phone-contacts";

const contact = (name: string, numbers: string[]) => ({
  getFullName: async () => name,
  getPhones: async () => numbers.map((number) => ({ number })),
});
const picker = (c: ReturnType<typeof contact> | null) => async () => ({ Contact: { presentPicker: async () => c } });

describe("choose a Rwandan number", () => {
  it("takes the first Rwandan mobile in any common format, shown the local way", () => {
    expect(chooseRwandanNumber(["+1 212 555 0100", "+250 788 123 456"])).toBe("0788123456");
    expect(chooseRwandanNumber(["0722 000 111"])).toBe("0722000111");
    expect(chooseRwandanNumber(["+250 788 123 456", "0722000111"])).toBe("0788123456");
  });
  it("finds none in a foreign or landline-only contact", () => {
    expect(chooseRwandanNumber(["+1 212 555 0100", "0252 570 000"])).toBeNull();
  });
});

describe("picking from the phone's contacts", () => {
  it("returns just the chosen person's name and number", async () => {
    expect(await pickPhoneContact(picker(contact("  Mum ", ["+250788123456"])))).toEqual({ ok: true, contact: { name: "Mum", number: "0788123456" } });
  });
  it("does nothing, quietly, when the picker is closed", async () => {
    expect(await pickPhoneContact(picker(null))).toEqual({ ok: false, cancelled: true, message: "" });
  });
  it("says so when the contact has no Rwandan number", async () => {
    expect(await pickPhoneContact(picker(contact("Bob", ["+1 212 555 0100"])))).toMatchObject({ ok: false, cancelled: false, message: "That contact has no Rwandan mobile number." });
  });
  it("falls back to typing when the contacts can't be opened", async () => {
    const result = await pickPhoneContact(async () => {
      throw new Error("native module missing");
    });
    expect(result).toMatchObject({ ok: false, cancelled: false });
  });
});
