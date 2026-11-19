import { actionAvailableHere, LAUNCHER_ACTIONS, opensInApp, showPayButton } from "../launcher";

describe("launcher model", () => {
  it("shows the button only where Pay is on", () => {
    expect(showPayButton({ ok: true, pay: true })).toBe(true);
    expect(showPayButton({ ok: true, pay: false })).toBe(false);
    expect(showPayButton({ ok: false })).toBe(false);
  });
  it("prepares person and merchant here only when assisted pay is on; directory tiles are always offered", () => {
    const [person, , bill] = LAUNCHER_ACTIONS;
    expect(actionAvailableHere(person, { assistedPay: false })).toBe(false);
    expect(actionAvailableHere(person, { assistedPay: true })).toBe(true);
    expect(actionAvailableHere(bill, {})).toBe(true);
  });
  it("opens in the app only where the directory is on", () => {
    expect(opensInApp({ ussdDirectory: true })).toBe(true);
    expect(opensInApp({})).toBe(false);
  });
  it("never routes airtime through a payment (it would use the send-money code)", () => {
    const airtime = LAUNCHER_ACTIONS.find((a) => a.id === "buy_airtime");
    expect(airtime?.kind).toBe("directory");
  });
});
