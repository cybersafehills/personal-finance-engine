import { buildEkashCode, EKASH_TEMPLATE, ekashShareText } from "../ekash";

describe("eKash code", () => {
  it("is *182*1*2*<receiver>*<amount>#", () => {
    expect(EKASH_TEMPLATE).toBe("*182*1*2*{receiver}*{amount}#");
    expect(buildEkashCode("0781234567", "5000")).toEqual({ ok: true, display: "*182*1*2*0781234567*5000#", telHref: "tel:*182*1*2*0781234567*5000%23" });
  });
  it("works for a bank account number and ignores spaces in the ID", () => {
    expect(buildEkashCode("0001 2345 678", "25000")).toMatchObject({ ok: true, display: "*182*1*2*00012345678*25000#" });
  });
  it("needs both, and refuses anything that could rewrite the code", () => {
    expect(buildEkashCode("", "5000").ok).toBe(false);
    expect(buildEkashCode("0781234567", "").ok).toBe(false);
    for (const bad of ["078*1#", "07812{34}", "5,000"]) expect(buildEkashCode(bad.includes("5,") ? "0781234567" : bad, bad.includes("5,") ? bad : "5000").ok).toBe(false);
    for (const amount of ["0", "50.5", "-5"]) expect(buildEkashCode("0781234567", amount).ok).toBe(false);
  });
  it("adds the user's own reference only when they typed one", () => {
    expect(ekashShareText("*182*1*2*1*2#", "  ")).toBe("*182*1*2*1*2#");
    expect(ekashShareText("*182*1*2*1*2#", "Rent")).toBe("*182*1*2*1*2#\nReference: Rent");
  });
});

it("preserves varied bank IDs without allowing USSD or URI injection",()=>{
 for(const id of ['001-234-56','BK/001.234_5','00001234567890123456789012345678901234567890']) expect(buildEkashCode(id,'5000')).toMatchObject({ok:true,display:`*182*1*2*${id}*5000#`});
 for(const id of ['001#*1','tel:123','001?x=1','001%23','001{amount}','001\\23']) expect(buildEkashCode(id,'5000').ok).toBe(false);
});
