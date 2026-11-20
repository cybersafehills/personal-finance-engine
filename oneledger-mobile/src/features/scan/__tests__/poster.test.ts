import { parseMerchantPoster, posterPrefill } from "../poster";

it("reads the example poster's boxed digits and handwritten name", () => {
  expect(parseMerchantPoster("MTN MoMo\nIshyura na MoMoPay.\nIzina ry’Umucuruzi:\nAIMEE\nKanda\n*182*8*1*\n0 2 5 4 0 6\n#\nNta yandi mafaranga wishyuzwa."))
    .toEqual({ merchantCode: "025406", name: "AIMEE" });
});

it("supports a name on the same line and a compact code", () => {
  expect(parseMerchantPoster("Merchant name: My Shop\n*182*8*1*123456#"))
    .toEqual({ merchantCode: "123456", name: "My Shop" });
});

it.each([
  "025406", "*182*1*1*025406#", "*182*8*1*O25406#", "*182*8*1*0254O6#",
  "*182*8*1*12#", "*182*8*1*1234567890123#",
  "*182*8*1*025406#\n*182*8*1*025407#", "*182*8*1*025406*1000#",
  "*182*8*1*025406*1000", "*182*8*1*025406 extra digits 12",
  "*182*8*1*025406#\n*182*8*1*025407",
])("does not guess or choose an ambiguous recipient: %s", (text) => {
  expect(parseMerchantPoster(text)).toBeNull();
});

it("reads the actual Vision output from the supplied photo, which omits the printed hash", () => {
  expect(parseMerchantPoster("MTN MoMo\nIshyura na MoMoPay.\nIzina ry'Umucuruzi:\nAIMEE\nKanda\n*182*8*1*\n025406\nMTN\nNła yandi mafaranga wishyuzwa."))
    .toEqual({ merchantCode: "025406", name: "AIMEE" });
});

it("accepts an otherwise complete merchant line when OCR misses the hash", () => {
  expect(parseMerchantPoster("*182*8*1*025406"))
    .toEqual({ merchantCode: "025406", name: "" });
});

it("does not mistake poster instructions for a merchant name", () => {
  expect(parseMerchantPoster("Izina ry'Umucuruzi:\nKanda\n*182*8*1*025406#"))
    .toEqual({ merchantCode: "025406", name: "" });
});

it("validates route prefills and keeps merchant suggestions out of person payments", () => {
  expect(posterPrefill({ type: "pay_person", merchantCode: "025406" }).merchantCode).toBe("");
  expect(posterPrefill({ type: "pay_merchant", merchantCode: "tel:123" }).merchantCode).toBe("");
  expect(posterPrefill({ type: "pay_merchant", merchantCode: "025406" }).merchantCode).toBe("025406");
});
