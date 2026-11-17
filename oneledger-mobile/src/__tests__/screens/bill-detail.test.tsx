import { render, screen } from "@testing-library/react-native";

import BillScreen from "@/app/(app)/bill/[id]";
import { resetRouterMock } from "@/test/router-mock";

const mockFetch = jest.fn();

jest.mock("expo-router", () => ({
  ...jest.requireActual("@/test/router-mock"),
  useLocalSearchParams: () => ({ id: "b1" }),
}));
jest.mock("@/api/mobile-api", () => ({ fetchBill: (id: string) => mockFetch(id) }));

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
  history: [{ id: "e1", label: "Status: stored → queued", byLabel: "The system", whenLabel: "Monday" }],
  ...over,
});

beforeEach(() => {
  resetRouterMock();
  mockFetch.mockReset();
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
});
