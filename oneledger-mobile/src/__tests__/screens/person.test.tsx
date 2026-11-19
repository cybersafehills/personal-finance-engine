import { fireEvent, render, screen } from "@testing-library/react-native";

import PersonScreen from "@/app/(app)/person/[id]";
import { setPayConfigCache } from "@/features/pay/config-cache";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockFetchPerson = jest.fn();
const mockIds = jest.fn();
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchPerson: () => mockFetchPerson(), fetchPeople: jest.fn().mockResolvedValue({ ok: false }) }));
jest.mock("@/features/people/pay", () => ({ ...jest.requireActual("@/features/people/pay"), getIdentifiers: () => mockIds() }));

const detail = (kind: string, name: string) => ({
  ok: true,
  workspaceId: "w",
  detail: {
    person: { id: "p1", displayName: name, kind, confidence: "high", txnCount: 2, firstAt: null, lastAt: null, currencies: [] },
    mergedFrom: [],
    totalTransactions: 0,
    transactions: [],
  },
});

beforeEach(() => {
  resetRouterMock();
  setParams({ id: "p1" });
  mockFetchPerson.mockReset();
  mockIds.mockReset().mockResolvedValue([]);
  setPayConfigCache({ pay: true, assistedPay: true });
});

describe("a person's page: Pay", () => {
  it("shows a green Pay this person button that opens the form with their number and name", async () => {
    mockFetchPerson.mockResolvedValue(detail("person", "Amy"));
    mockIds.mockResolvedValue([{ type: "msisdn", value: "250781234567" }]);
    await render(<PersonScreen />);
    expect(await screen.findByText("To 078 123 4567. You review it before anything is dialled.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Pay this person" }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/pay-new", params: { type: "pay_person", name: "Amy", to: "078 123 4567" } });
  });

  it("says Pay this merchant for a merchant, with their code", async () => {
    mockFetchPerson.mockResolvedValue(detail("merchant", "Kigali Shop"));
    mockIds.mockResolvedValue([{ type: "merchant_code", value: "123456" }]);
    await render(<PersonScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Pay this merchant" }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/pay-new", params: { type: "pay_merchant", name: "Kigali Shop", to: "123456" } });
  });

  it("asks to categorise someone not yet known, instead of guessing", async () => {
    mockFetchPerson.mockResolvedValue(detail("unknown", "THUNES LTD"));
    await render(<PersonScreen />);
    expect(await screen.findByText(/first set whether this is a person or a merchant/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pay this/ })).toBeNull();
  });

  it("is not offered where paying is off", async () => {
    setPayConfigCache({ pay: true, assistedPay: false });
    mockFetchPerson.mockResolvedValue(detail("person", "Amy"));
    await render(<PersonScreen />);
    await screen.findByText("Amy");
    expect(screen.queryByRole("button", { name: "Pay this person" })).toBeNull();
  });
});
