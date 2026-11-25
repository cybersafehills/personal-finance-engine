import { fireEvent, render, screen } from "@testing-library/react-native";

import { PrivacyProvider } from "@/features/privacy/PrivacyProvider";
import type { Wallet } from "@/features/wallets/types";
import { resetRouterMock, router } from "@/test/router-mock";

import { QuickActions } from "../QuickActions";
import { WalletStrip } from "../WalletStrip";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/lib/device-store", () => ({ deviceStore: { get: async () => JSON.stringify({ hidden: true }), set: async () => {} } }));

beforeEach(() => resetRouterMock());

const wallet = { id: "a", name: "Real MoMo wallet", provider: "mtn_momo", currency: "RWF", isPrimary: true, latestTxnAt: null, balance: { status: "confirmed", amountMinor: 14416n, asOf: null, basis: "provider_reported", reasons: [] } } as unknown as Wallet;

describe("Home quick actions", () => {
  it.each([[null], [{}], [{ paymentRequests: false, scanToPay: false }]])("offers nothing unless the server says it is on (%o)", async (config) => {
    await render(<QuickActions config={config} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens each enabled shortcut", async () => {
    await render(<QuickActions config={{ paymentRequests: true, scanToPay: true }} />);
    await fireEvent.press(screen.getByRole("button", { name: "Request payment" }));
    expect(router.push).toHaveBeenLastCalledWith("/request-new");
    await fireEvent.press(screen.getByRole("button", { name: "Scan to pay" }));
    expect(router.push).toHaveBeenLastCalledWith("/scan");
  });
});

describe("Home wallet cards", () => {
  it("keeps a hidden balance out of the screen and the spoken label", async () => {
    await render(<PrivacyProvider userId="u1"><WalletStrip wallets={[wallet]} selectedIndex={0} onSelect={() => {}} /></PrivacyProvider>);
    expect(await screen.findByRole("button", { name: "Show Real MoMo wallet, amount hidden, Confirmed" })).toBeTruthy();
    expect(screen.queryByText(/14,416/)).toBeNull();
    expect(screen.queryByLabelText(/14,416/)).toBeNull();
  });

  it("opens all wallets from the last tile", async () => {
    await render(<WalletStrip wallets={[wallet]} selectedIndex={0} onSelect={() => {}} />);
    await fireEvent.press(screen.getByRole("button", { name: "All wallets" }));
    expect(router.push).toHaveBeenLastCalledWith("/wallets");
  });
});
