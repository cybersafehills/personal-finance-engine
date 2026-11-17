import { fireEvent, render, screen } from "@testing-library/react-native";

import Bills from "@/app/(app)/bills";
import { resetRouterMock, router } from "@/test/router-mock";

const mockFetch = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchBills: (status?: string) => mockFetch(status) }));

const bill = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  filename: "acme.pdf",
  status: "needs_review",
  statusLabel: "Needs review",
  tone: "accent",
  uploadedLabel: "Monday, August 24, 2026",
  pageCount: 2,
  ...over,
});

beforeEach(() => {
  resetRouterMock();
  mockFetch.mockReset();
});

describe("Bills screen", () => {
  it("lists documents with their status and opens one", async () => {
    mockFetch.mockResolvedValue({ ok: true, bills: [bill()], hasMore: false });
    await render(<Bills />);

    expect(await screen.findByText("acme.pdf")).toBeTruthy();
    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByLabelText("acme.pdf, Needs review"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/bill/[id]", params: { id: "b1" } });
  });

  it("asks the server for the chosen status and says when nothing matches", async () => {
    mockFetch.mockResolvedValue({ ok: true, bills: [bill()], hasMore: false });
    await render(<Bills />);
    await screen.findByText("acme.pdf");

    mockFetch.mockResolvedValue({ ok: true, bills: [], hasMore: false });
    await fireEvent.press(screen.getByLabelText("Approved"));
    expect(await screen.findByText("Nothing here")).toBeTruthy();
    expect(mockFetch).toHaveBeenLastCalledWith("approved");
  });

  it("says there are older documents on the web", async () => {
    mockFetch.mockResolvedValue({ ok: true, bills: [bill()], hasMore: true });
    await render(<Bills />);
    expect(await screen.findByText(/Older ones are on the web/)).toBeTruthy();
  });

  it("offers a retry for a failed read but not when Bills is unavailable", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "error", message: "Couldn't load your documents." });
    await render(<Bills />);
    expect(await screen.findByText("Try again")).toBeTruthy();

    mockFetch.mockResolvedValue({ ok: false, reason: "unavailable", message: "Bills isn't available yet." });
    await fireEvent.press(screen.getByText("Try again"));
    expect(await screen.findByText("Bills isn't available yet.")).toBeTruthy();
    expect(screen.queryByText("Try again")).toBeNull();
  });
});
