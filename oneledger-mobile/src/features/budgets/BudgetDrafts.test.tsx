import { fireEvent, render, screen } from "@testing-library/react-native";

import { editAllocationPlan } from "./allocation-editor";
import { BudgetDrafts } from "./BudgetDrafts";
import {
  activateDraftBudget, createDraftBudget, loadDraftBudgets, parseBudgetInput,
  readPendingBudget, storePendingBudget, type BudgetInput, type PendingDraft,
} from "./budget-lifecycle";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/supabase", () => ({ supabase: null }));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({ useActiveSpace: () => ({ activeId: "space-a" }) }));
jest.mock("@/offline/ids", () => ({ getNewId: () => "new-draft" }));
jest.mock("./allocation-editor", () => ({ ...jest.requireActual("./allocation-editor"), editAllocationPlan: jest.fn() }));
jest.mock("./budget-lifecycle", () => ({
  ...jest.requireActual("./budget-lifecycle"),
  activateDraftBudget: jest.fn(),
  clearPendingBudget: jest.fn().mockResolvedValue(undefined),
  createDraftBudget: jest.fn(),
  loadDraftBudgets: jest.fn(),
  readPendingBudget: jest.fn(),
  storePendingBudget: jest.fn(),
}));

const scope = { workspaceId: "space-a", userId: "user-a" };
const input: BudgetInput = {
  name: "November", currency: "USD", start: "2026-11-01", end: "2026-11-30", income: "12.34",
  frequency: "weekly", allocation: { ESSENTIALS: "50", INVESTING: "15", EMERGENCY: "5", WANTS: "30" },
};
const prepared = parseBudgetInput(input);
if ("error" in prepared) throw new Error(prepared.error);
const pending: PendingDraft = { ...prepared.draft, id: "pending-draft" };

beforeEach(() => {
  jest.mocked(editAllocationPlan).mockReset();
  jest.mocked(activateDraftBudget).mockReset();
  jest.mocked(createDraftBudget).mockReset();
  jest.mocked(loadDraftBudgets).mockReset().mockResolvedValue([]);
  jest.mocked(readPendingBudget).mockReset().mockResolvedValue(null);
  jest.mocked(storePendingBudget).mockReset().mockResolvedValue(undefined);
});

it("preserves exact minor units and rejects invalid amounts or dates", () => {
  expect(parseBudgetInput(input)).toMatchObject({ draft: { incomeMinor: "1234", frequency: "weekly" } });
  expect(parseBudgetInput({ ...input, income: "12.345" })).toHaveProperty("error");
  expect(parseBudgetInput({ ...input, end: "2026-11-31" })).toHaveProperty("error");
  expect(parseBudgetInput({ ...input, allocation: { ...input.allocation, WANTS: "29.99" } })).toHaveProperty("error");
});

it("saves a creation request before sending and retries the exact request after an uncertain reply", async () => {
  jest.mocked(createDraftBudget).mockResolvedValueOnce("unconfirmed").mockResolvedValueOnce("saved");
  await render(<BudgetDrafts scope={scope} onActivated={jest.fn()} />);
  await fireEvent.press(screen.getByText("Create budget"));
  await fireEvent.changeText(await screen.findByLabelText("Budget name"), "November");
  await fireEvent.changeText(screen.getByLabelText("Start date (YYYY-MM-DD)"), "2026-11-01");
  await fireEvent.changeText(screen.getByLabelText("End date (YYYY-MM-DD)"), "2026-11-30");
  await fireEvent.changeText(screen.getByLabelText("Income (RWF)"), "123");
  await fireEvent.press(screen.getByText("Save as draft"));
  await fireEvent.press(await screen.findByText("Retry draft save"));
  expect(storePendingBudget).toHaveBeenCalledWith(scope, expect.objectContaining({ id: "new-draft", incomeMinor: "123" }));
  expect(jest.mocked(createDraftBudget).mock.calls[1]).toEqual(jest.mocked(createDraftBudget).mock.calls[0]);
  expect(await screen.findByText("Budget draft saved.")).toBeTruthy();
});

it("resumes the saved draft request after reopening the screen", async () => {
  jest.mocked(readPendingBudget).mockResolvedValue(pending);
  jest.mocked(createDraftBudget).mockResolvedValue("saved");
  await render(<BudgetDrafts scope={scope} onActivated={jest.fn()} />);
  await fireEvent.press(screen.getByText("Create budget"));
  await fireEvent.press(await screen.findByText("Retry draft save"));
  expect(createDraftBudget).toHaveBeenCalledWith(scope, pending);
  expect(storePendingBudget).not.toHaveBeenCalled();
});

it("requires a fresh review when activation finds a newer revision", async () => {
  jest.mocked(loadDraftBudgets).mockResolvedValue([{ id: "draft-a", name: "November", currency: "USD",
    period_start: "2026-11-01", period_end: "2026-11-30" }]);
  jest.mocked(editAllocationPlan).mockResolvedValue({ kind: "snapshot", value: {
    revision: "revision-a", currency: "USD",
    allocations: [
      { type: "ESSENTIALS", percentage: 50, target_minor: "50" },
      { type: "INVESTING", percentage: 15, target_minor: "15" },
      { type: "EMERGENCY", percentage: 5, target_minor: "5" },
      { type: "WANTS", percentage: 30, target_minor: "30" },
    ],
  } });
  jest.mocked(activateDraftBudget).mockResolvedValue("stale");
  const refresh = jest.fn();
  await render(<BudgetDrafts scope={scope} onActivated={refresh} />);
  await fireEvent.press(await screen.findByText("Review and activate"));
  expect(await screen.findByText("Essentials · 50% · USD 0.50")).toBeTruthy();
  expect(activateDraftBudget).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Confirm activation"));
  expect(activateDraftBudget).toHaveBeenCalledWith(scope, "draft-a", "revision-a");
  expect(await screen.findByText(/Review its latest allocations/)).toBeTruthy();
  expect(screen.queryByText("Confirm activation")).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});
