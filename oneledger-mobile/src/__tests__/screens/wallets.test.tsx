import { fireEvent, render, screen } from "@testing-library/react-native";

import Wallets from "@/app/(app)/wallets";
import { PrivacyProvider } from "@/features/privacy/PrivacyProvider";
import { resetRouterMock, router } from "@/test/router-mock";

const mockWallets = jest.fn();
const mockStoreGet = jest.fn();
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/lib/device-store", () => ({ deviceStore: { get: () => mockStoreGet(), set: async () => {} } }));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({ useActiveSpace: () => ({ activeId: "w1" }) }));
jest.mock("@/api/mobile-api", () => ({ fetchWallets: () => mockWallets() }));

const wallet = { id: "a", name: "My MoMo", provider: "mtn_momo", currency: "RWF", isPrimary: true, latestTxnAt: null, balance: { status: "confirmed", amountMinor: 14416n, asOf: "2026-11-19T06:47:00Z", basis: "provider_reported", reasons: [] } };
const unknown = { ...wallet, id: "b", name: "Dollar account", provider: "bank", currency: "USD", isPrimary: false, balance: { status: "unavailable", amountMinor: null, asOf: null, basis: null, reasons: ["no_baseline"] } };

beforeEach(() => {
  resetRouterMock();
  mockStoreGet.mockReset().mockResolvedValue(null);
  mockWallets.mockReset().mockResolvedValue({ ok: true, workspaceId: "w1", wallets: [wallet, unknown] });
});

describe("Wallets screen", () => {
  it("lists each balance with what it rests on and when, never a total or an invented zero", async () => {
    await render(<Wallets />);
    expect(await screen.findByText("RWF 14,416")).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText(/^As of /)).toBeTruthy();
    expect(screen.getByText("No balance yet")).toBeTruthy();
    expect(screen.getByText("Not available")).toBeTruthy();
    expect(screen.queryByText(/total/i)).toBeNull();
    expect(screen.queryByText(/USD 0/)).toBeNull();
  });

  it("opens a wallet", async () => {
    await render(<Wallets />);
    await fireEvent.press(await screen.findByRole("button", { name: /^My MoMo, MTN MoMo · Main wallet, RWF 14,416, Confirmed, As of / }));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/wallet/[id]", params: { id: "a" } });
  });

  it("keeps hidden balances off the screen and out of spoken labels", async () => {
    mockStoreGet.mockResolvedValue(JSON.stringify({ hidden: true }));
    await render(<PrivacyProvider userId="u1"><Wallets /></PrivacyProvider>);
    expect(await screen.findByRole("button", { name: /^My MoMo, .*balance hidden/ })).toBeTruthy();
    expect(screen.queryByText(/14,416/)).toBeNull();
    expect(screen.queryByLabelText(/14,416/)).toBeNull();
  });

  it.each([
    [() => mockWallets.mockRejectedValue(new Error("Couldn't load your wallets.")), /load/i],
    [() => mockWallets.mockResolvedValue({ ok: false, message: "Wallets is unavailable for this Space." }), /unavailable for this Space/],
  ])("offers a retry when the list can't load", async (arrange, message) => {
    arrange();
    await render(<Wallets />);
    expect(await screen.findByText("Try again")).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
  });
});
