import { fireEvent, render, screen } from "@testing-library/react-native";

import People from "@/app/(app)/people";
import { sortTransactions } from "@/features/people/actions";
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
  mockFetchPeople.mockResolvedValue({ ok: true, workspaceId: "w", unresolved: 0, sortable: 0, total: 0, people: [] });
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

describe("People and merchants: sorting", () => {
  const withUnresolved = (unresolved: number, sortable: number) =>
    mockFetchPeople.mockResolvedValue({ ok: true, workspaceId: "w", unresolved, sortable, total: 0, people: [] });

  it("offers Sort them now only for transactions that can be sorted", async () => {
    withUnresolved(175, 0);
    await render(<People />);
    await screen.findByText(/175 transactions have no name or number/);
    expect(screen.queryByRole("button", { name: "Sort them now" })).toBeNull();
  });

  it("counts only the sortable ones in the prompt, and mentions the rest", async () => {
    withUnresolved(10, 7);
    await render(<People />);
    expect(await screen.findByText("7 transactions aren't sorted into people yet.")).toBeTruthy();
    expect(screen.getByText(/3 transactions have no name or number/)).toBeTruthy();
  });

  it("says how many were sorted, and reloads", async () => {
    withUnresolved(5, 5);
    (sortTransactions as jest.Mock).mockResolvedValue({ ok: true, value: { linked: 5, created: 2 } });
    await render(<People />);
    await fireEvent.press(await screen.findByRole("button", { name: "Sort them now" }));
    expect(await screen.findByText("Sorted 5 transactions into people and merchants.")).toBeTruthy();
    expect(sortTransactions).toHaveBeenCalledWith("w");
    expect(mockFetchPeople.mock.calls.length).toBeGreaterThan(1);
  });

  it("is honest when nothing could be sorted", async () => {
    withUnresolved(5, 5);
    (sortTransactions as jest.Mock).mockResolvedValue({ ok: true, value: { linked: 0, created: 0 } });
    await render(<People />);
    await fireEvent.press(await screen.findByRole("button", { name: "Sort them now" }));
    expect(await screen.findByText("Nothing more could be sorted.")).toBeTruthy();
  });
});
