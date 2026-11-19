import { fireEvent, render, screen } from "@testing-library/react-native";

import People from "@/app/(app)/people";
import { resetRouterMock, router } from "@/test/router-mock";

const mockFetchPeople = jest.fn();
const mockSaved = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchPeople: (p: unknown) => mockFetchPeople(p) }));
jest.mock("@/features/pay/recipients", () => ({ getTrustedRecipients: () => mockSaved() }));
jest.mock("@/features/people/actions", () => ({ sortTransactions: jest.fn() }));

const amy = { id: "r1", name: "Amy", kind: "phone", msisdn: "250781234567", merchantCode: null, trusted: false, relationship: null };
const shop = { id: "r2", name: "Kigali Shop", kind: "merchant", msisdn: null, merchantCode: "123456", trusted: true, relationship: null };

beforeEach(() => {
  resetRouterMock();
  mockFetchPeople.mockReset();
  mockSaved.mockReset();
  mockFetchPeople.mockResolvedValue({ ok: true, workspaceId: "w", unresolved: 0, total: 0, people: [] });
  mockSaved.mockResolvedValue([amy, shop]);
});

describe("People and merchants: saved contacts", () => {
  it("lists contacts saved from the Pay form, split by what they are", async () => {
    await render(<People />);
    expect(await screen.findByText("Saved contacts")).toBeTruthy();
    expect(screen.getByText("Amy")).toBeTruthy();
    expect(screen.getByText("078 123 4567")).toBeTruthy();
    expect(screen.getByText("Merchant code 123456")).toBeTruthy();
    expect(screen.getByText("Person")).toBeTruthy();
    expect(screen.getByText("Merchant")).toBeTruthy();
  });

  it("opens the Pay form filled with that contact", async () => {
    await render(<People />);
    await fireEvent.press(await screen.findByRole("button", { name: "Amy" }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/pay-new", params: { type: "pay_person", saved: "r1" } });
    await fireEvent.press(screen.getByRole("button", { name: "Kigali Shop" }));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/pay-new", params: { type: "pay_merchant", saved: "r2" } });
  });

  it("follows the People / Merchants filter", async () => {
    await render(<People />);
    await screen.findByText("Amy");
    await fireEvent.press(screen.getByRole("button", { name: "Merchants" }));
    expect(screen.queryByText("Amy")).toBeNull();
    expect(screen.getByText("Kigali Shop")).toBeTruthy();
  });

  it("shows no section when nothing is saved", async () => {
    mockSaved.mockResolvedValue([]);
    await render(<People />);
    await screen.findByText("No people or merchants yet");
    expect(screen.queryByText("Saved contacts")).toBeNull();
  });
});
