import { chooseRwandanNumber, numberShape, pickPhoneContact } from "../phone-contacts";

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
  it("understands the other ways people save a Rwandan number", () => {
    expect(chooseRwandanNumber(["+250 (0) 788 123 456"])).toBe("0788123456");
    expect(chooseRwandanNumber(["00250 788 123 456"])).toBe("0788123456");
    expect(chooseRwandanNumber(["788 123 456"])).toBe("0788123456");
    expect(chooseRwandanNumber(["+250\u00a0735\u00a0044\u00a0429"])).toBe("0735044429");
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
  it("still gives the number when the name can't be read", async () => {
    const c = { getFullName: async () => { throw new Error("no name"); }, getPhones: async () => [{ number: "0788123456" }] };
    expect(await pickPhoneContact(async () => ({ Contact: { presentPicker: async () => c } }))).toEqual({ ok: true, contact: { name: "", number: "0788123456" } });
  });
  it("says so, differently, when the number can't be read", async () => {
    const c = { getFullName: async () => "Bob", getPhones: async () => { throw new Error("denied"); } };
    expect(await pickPhoneContact(async () => ({ Contact: { presentPicker: async () => c } }))).toMatchObject({ ok: false, cancelled: false, message: "We couldn't read that contact's number. Type it instead." });
  });
  it("works again for the next contact", async () => {
    const load = picker(contact("Mum", ["0788123456"]));
    expect(await pickPhoneContact(load)).toMatchObject({ ok: true });
    expect(await pickPhoneContact(picker(contact("Joe", ["0722000111"])))).toEqual({ ok: true, contact: { name: "Joe", number: "0722000111" } });
  });
  it("falls back to typing when the contacts can't be opened", async () => {
    const result = await pickPhoneContact(async () => {
      throw new Error("native module missing");
    });
    expect(result).toMatchObject({ ok: false, cancelled: false });
  });
});

describe("numberShape", () => {
  it("keeps the format and hides every digit", () => {
    expect(numberShape("+250 788 123 456")).toBe("+### ### ### ###");
    expect(numberShape("(0) 788-123456")).toBe("(#) ###-######");
    expect(numberShape("")).toBe("");
  });
});
