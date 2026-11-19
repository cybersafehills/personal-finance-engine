import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import type { Budget } from "@/features/budgets/types";
import { resetRouterMock, router } from "@/test/router-mock";

import Budgets from "@/app/(app)/budgets";

const mockFetchBudgets = jest.fn();
const mockCanEdit = jest.fn();
jest.mock("@/features/budgets/budget-lifecycle", () => ({ loadDraftBudgets: async () => [] }));
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchBudgets: () => mockFetchBudgets() }));
jest.mock("@/features/auth/SessionProvider", () => ({
  useSession: () => ({ session: { user: { id: "user-a" } } }),
}));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({
  useActiveSpace: () => ({ activeId: "space-a" }),
}));
jest.mock("@/features/budgets/allocation-editor", () => ({
  canEditAllocations: (workspaceId: string) => mockCanEdit(workspaceId),
}));

const budget: Budget = {
  id: "b1",
  name: "November",
  currency: "RWF",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  elapsedFraction: 0.5,
  actualIncomeMinor: 300000,
  allocations: [
    {
      type: "ESSENTIALS",
      label: "Essentials",
      targetMinor: 100000,
      actualMinor: 120000,
      remainingMinor: -20000,
      percentConsumed: 120,
      projectedMinor: 150000,
      status: "exceeded",
    },
    {
      type: "WANTS",
      label: "Wants",
      targetMinor: 60000,
      actualMinor: 10000,
      remainingMinor: 50000,
      percentConsumed: 16.7,
      projectedMinor: null,
      status: "healthy",
    },
  ],
  alerts: [{ id: "a1", severity: "warning", message: "Essentials exceeded its target." }],
  uncategorizedCount: 2,
  uncategorizedMinor: 9000,
  unmappedCount: 0,
  unmappedMinor: 0,
};

beforeEach(() => {
  resetRouterMock();
  mockFetchBudgets.mockReset();
  mockCanEdit.mockReset().mockResolvedValue(false);
});

describe("Budgets screen", () => {
  it("shows the budget, its allocations and alerts", async () => {
    mockFetchBudgets.mockResolvedValue({ ok: true, budgets: [budget] });
    await render(<Budgets />);

    await waitFor(() => expect(screen.getByText("November")).toBeTruthy());
    expect(screen.getByText("1 Nov – 30 Nov · 50% of the period has passed")).toBeTruthy();
    expect(screen.getByText("Essentials")).toBeTruthy();
    expect(screen.getByText("Wants")).toBeTruthy();
    // The summary and the over-target allocation both say so.
    expect(screen.getAllByText("Over budget")).toHaveLength(2);
    expect(screen.getByText("Essentials exceeded its target.")).toBeTruthy();
    // Every allocation exposes a progress bar to screen readers.
    expect(screen.getByLabelText("Essentials budget used")).toBeTruthy();
    // Over-target reads as "over", never as a negative amount.
    expect(screen.getByText(/RWF 20,000 over/)).toBeTruthy();
    expect(screen.queryByText("Edit allocations")).toBeNull();
    expect(screen.queryByText("Create budget")).toBeNull();
  });

  it("offers allocation editing when the server confirms budget.manage for this Space", async () => {
    mockCanEdit.mockResolvedValue(true);
    mockFetchBudgets.mockResolvedValue({ ok: true, budgets: [budget] });
    await render(<Budgets />);
    expect(await screen.findByText("Edit allocations")).toBeTruthy();
    expect(screen.getByText("Create budget")).toBeTruthy();
    expect(mockCanEdit).toHaveBeenCalledWith("space-a");
  });

  it("offers to categorise transactions when some are uncategorised", async () => {
    mockFetchBudgets.mockResolvedValue({ ok: true, budgets: [budget] });
    await render(<Budgets />);
    const button = await screen.findByText("Categorise transactions");
    await fireEvent.press(button);
    expect(router.push).toHaveBeenCalledWith("/transactions");
  });

  it("explains an empty state when there is no active budget", async () => {
    mockFetchBudgets.mockResolvedValue({ ok: true, budgets: [] });
    await render(<Budgets />);
    expect(await screen.findByText("No active budget")).toBeTruthy();
  });

  it("shows the server's message when budgets are unavailable", async () => {
    mockFetchBudgets.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "Your budget isn't available yet.",
    });
    await render(<Budgets />);
    expect(await screen.findByText("Your budget isn't available yet.")).toBeTruthy();
    // Retrying cannot help when the feature is off, so no retry button.
    expect(screen.queryByText("Try again")).toBeNull();
  });

  it("offers a retry for a transient failure", async () => {
    mockFetchBudgets.mockResolvedValue({
      ok: false,
      reason: "error",
      message: "Couldn't load your budget. Check your connection and try again.",
    });
    await render(<Budgets />);
    expect(await screen.findByText("Try again")).toBeTruthy();
  });
});
