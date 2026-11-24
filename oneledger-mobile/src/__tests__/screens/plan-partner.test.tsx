import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import type { Budget } from "@/features/budgets/types";
import { resetRouterMock, router } from "@/test/router-mock";

import Plan from "@/app/(app)/(tabs)/plan";
import { PartnerPreviewProvider, usePartnerPreview } from "@/features/partners/PartnerPreviewProvider";
import { Button } from "@/components/ds";

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


jest.mock("@/features/partners/feed", () => ({ fetchPartnerFeed: jest.fn(async () => ({ enabled: false, placements: {}, offers: [] })) }));
function Start(){ const p=usePartnerPreview(); return <Button label="start preview" onPress={p.start}/>; }
it("shows the slim sponsored bar on the Plan tab once a budget has loaded and the preview is on", async () => {
  mockCanEdit.mockResolvedValue(false);
  mockFetchBudgets.mockResolvedValue({ ok: true, budgets: [budget] });
  await render(<PartnerPreviewProvider><Start/><Plan/></PartnerPreviewProvider>);
  await screen.findByText("November");
  await fireEvent.press(screen.getByRole("button",{name:"start preview"}));
  expect(screen.queryByTestId("partner-bar")).toBeTruthy();
});
