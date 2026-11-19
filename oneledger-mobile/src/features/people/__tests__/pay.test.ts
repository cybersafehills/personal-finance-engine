import { personPayTarget } from "../pay";

describe("Pay this person / Pay this merchant", () => {
  it("pays a person at the phone number they were matched by, in the local form", () => {
    expect(personPayTarget({ kind: "person", displayName: "Amy" }, [{ type: "name_label", value: "amy" }, { type: "msisdn", value: "250781234567" }])).toEqual({
      type: "pay_person",
      label: "Pay this person",
      to: "078 123 4567",
      name: "Amy",
    });
  });
  it("pays a merchant at their merchant code", () => {
    expect(personPayTarget({ kind: "merchant", displayName: "Kigali Shop" }, [{ type: "merchant_code", value: "123456" }])).toEqual({
      type: "pay_merchant",
      label: "Pay this merchant",
      to: "123456",
      name: "Kigali Shop",
    });
  });
  it("still offers it with no number on record: the person types it", () => {
    expect(personPayTarget({ kind: "person", displayName: "Joe" }, [{ type: "name_label", value: "joe" }])).toMatchObject({ type: "pay_person", to: null });
  });
  it("offers nothing for someone not yet known to be a person or a merchant", () => {
    expect(personPayTarget({ kind: "unknown", displayName: "THUNES LTD" }, [])).toBeNull();
  });
});
