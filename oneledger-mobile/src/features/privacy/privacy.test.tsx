import { render, screen, waitFor, fireEvent } from "@testing-library/react-native";
import { Button, MoneyAmount } from "@/components/ds";
import { PrivacyProvider, usePrivacy } from "./PrivacyProvider";
import { privateText } from "./mask";
const mockGet = jest.fn(); const mockSet = jest.fn();
jest.mock("@/lib/device-store", () => ({ deviceStore: { get: (...args: unknown[]) => mockGet(...args), set: (...args: unknown[]) => mockSet(...args) } }));
function Probe() { const p = usePrivacy(); return <><MoneyAmount amountRwf={1234} currency="USD" masked={false} /><Button label="Full privacy" onPress={() => p.setFullPrivacy(true)} /></>; }
beforeEach(() => { mockGet.mockResolvedValue(null); mockSet.mockResolvedValue(undefined); });
it("full privacy overrides an explicit visible amount and persists per user", async () => {
  await render(<PrivacyProvider userId="alice"><Probe /></PrivacyProvider>);
  expect(await screen.findByText("+USD 12.34")).toBeTruthy();
  await fireEvent.press(screen.getByText("Full privacy"));
  expect(screen.queryByText("+USD 12.34")).toBeNull();
  expect(screen.getByLabelText("Amount hidden")).toBeTruthy();
  await waitFor(() => expect(mockSet).toHaveBeenCalledWith("oneledger.privacy.alice", expect.stringContaining('"full":true')));
});
it("does not show the previous account's preference during account switch", async () => {
  mockGet.mockResolvedValueOnce(JSON.stringify({ full: true, hidden: true }));
  const view = await render(<PrivacyProvider userId="alice"><Probe /></PrivacyProvider>);
  await waitFor(() => expect(screen.getByLabelText("Amount hidden")).toBeTruthy());
  mockGet.mockImplementation(() => new Promise(() => {}));
  await view.rerender(<PrivacyProvider userId="bob"><Probe /></PrivacyProvider>);
  expect(screen.queryByText("+USD 12.34")).toBeNull();
});
it("masks legacy formatted accessible labels without hiding ordinary counts", () => {
  expect(privateText("USD 12.34 from Alice", true)).toBe("Amount hidden");
  expect(privateText("Sent 1,234 RWF", true)).toBe("Amount hidden");
  expect(privateText("3 transactions", true)).toBe("3 transactions");
});
