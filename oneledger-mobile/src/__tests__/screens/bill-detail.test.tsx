import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import BillScreen from "@/app/(app)/bill/[id]";
import { resetRouterMock } from "@/test/router-mock";

const mockFetch = jest.fn();
const mockOriginal = jest.fn();
const mockOpenURL = jest.fn();

jest.mock("expo-router", () => ({
  ...jest.requireActual("@/test/router-mock"),
  useLocalSearchParams: () => ({ id: "b1" }),
}));
jest.mock("@/api/mobile-api", () => ({ fetchBill: (id: string) => mockFetch(id), fetchBillOriginal: (id: string) => mockOriginal(id) }));
jest.mock("expo-linking", () => ({ openURL: (u: string) => mockOpenURL(u) }));

const bill = (over: Record<string, unknown> = {}) => ({
  id: "b1",
  filename: "acme.pdf",
  status: "needs_review",
  statusLabel: "Needs review",
  tone: "accent",
  uploadedLabel: "Monday, August 24, 2026",
  pageCount: 2,
  typeLabel: "PDF",
  sizeLabel: "2.0 KB",
  extraction: {
    fields: [{ key: "total", label: "Total", value: "RWF 5,000" }],
    lineItems: [{ description: "Cement", quantityLabel: "3", totalLabel: "RWF 5,000" }],
  },
  checks: {
    blocking: 1,
    outOfDate: true,
    findings: [{ id: "f1", severity: "blocking", severityLabel: "Must fix", title: "Total doesn't add up", detail: "Lines sum to 4,000.", suggestedAction: null }],
  },
  canViewOriginal: true,
  history: [{ id: "e1", label: "Status: stored → queued", byLabel: "The system", whenLabel: "Monday" }],
  ...over,
});

beforeEach(() => {
  resetRouterMock();
  mockFetch.mockReset();
  mockOriginal.mockReset();
  mockOpenURL.mockReset();
});

describe("Bill detail screen", () => {
  it("shows fields, line items, checks (flagging stale ones) and history", async () => {
    mockFetch.mockResolvedValue({ ok: true, bill: bill() });
    await render(<BillScreen />);

    expect(await screen.findByText("acme.pdf")).toBeTruthy();
    expect(screen.getByLabelText("Total: RWF 5,000")).toBeTruthy();
    expect(screen.getByText("3 × Cement")).toBeTruthy();
    expect(screen.getByText("Total doesn't add up")).toBeTruthy();
    expect(screen.getByText(/corrected after these checks ran/)).toBeTruthy();
    expect(screen.getByText("Status: stored → queued")).toBeTruthy();
  });

  it("says why there is no history or extraction instead of showing nothing", async () => {
    mockFetch.mockResolvedValue({ ok: true, bill: bill({ extraction: null, checks: null, history: null }) });
    await render(<BillScreen />);

    expect(await screen.findByText(/Automated extraction isn't on/)).toBeTruthy();
    expect(screen.getByText(/don't have permission to see this document's processing history/)).toBeTruthy();
    expect(screen.queryByText("Checks")).toBeNull();
  });

  it("explains a document that is not in this Space", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "not_found", message: "That document wasn't found in this Space." });
    await render(<BillScreen />);
    expect(await screen.findByText("That document wasn't found in this Space.")).toBeTruthy();
    expect(screen.queryByText("Try again")).toBeNull();
  });

  it("shows the refusal and lets the member try again", async () => {
    mockFetch.mockResolvedValue({ ok: true, bill: bill() });
    mockOriginal.mockResolvedValue({ ok: false, reason: "forbidden", message: "You don't have permission to open the original." });
    await render(<BillScreen />);
    await fireEvent.press(await screen.findByText("View original"));
    expect(await screen.findAllByText("You don't have permission to open the original.")).toHaveLength(1);
    expect(mockOpenURL).not.toHaveBeenCalled();
    expect(screen.getByText("View original")).toBeTruthy();
  });

  it("offers no button without the permission", async () => {
    mockFetch.mockResolvedValue({ ok: true, bill: bill({ canViewOriginal: false }) });
    await render(<BillScreen />);
    expect(await screen.findByText(/You don't have permission to open the original/)).toBeTruthy();
    expect(screen.queryByText("View original")).toBeNull();
  });

  it("opens the original with a fresh link, once per tap", async () => {
    mockFetch.mockResolvedValue({ ok: true, bill: bill() });
    let release: (v: unknown) => void = () => {};
    mockOriginal.mockReturnValue(new Promise((r) => (release = r)));
    mockOpenURL.mockResolvedValue(undefined);
    await render(<BillScreen />);
    const button = await screen.findByText("View original");
    void fireEvent.press(button);
    void fireEvent.press(button);
    await waitFor(() => expect(mockOriginal).toHaveBeenCalledTimes(1));
    release({ ok: true, url: "https://files.test/o?t=1" });
    await waitFor(() => expect(mockOpenURL).toHaveBeenCalledWith("https://files.test/o?t=1"));
    expect(mockOriginal).toHaveBeenCalledTimes(1);
  });
});
