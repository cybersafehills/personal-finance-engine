import { fireEvent, render, screen } from "@testing-library/react-native";

import { GoalContributions } from "./GoalContributions";
import { contributionMinor } from "./contributions";
import type { Goal } from "./types";

const mockSave = jest.fn();
const mockHistory = jest.fn();
const mockRestore = jest.fn();
const mockStore = jest.fn();
const mockClear = jest.fn();
const mockId = jest.fn().mockReturnValue("request-1");

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({
  useActiveSpace: () => ({ activeId: "space-a" }),
}));
jest.mock("@/api/supabase", () => ({ supabase: null }));
jest.mock("@/offline/ids", () => ({ getNewId: () => mockId() }));
jest.mock("./contributions", () => ({
  ...jest.requireActual("./contributions"),
  saveGoalContribution: (...args: unknown[]) => mockSave(...args),
  restorePendingContribution: (...args: unknown[]) => mockRestore(...args),
  storePendingContribution: (...args: unknown[]) => mockStore(...args),
  clearPendingContribution: (...args: unknown[]) => mockClear(...args),
  loadGoalContributions: (...args: unknown[]) => mockHistory(...args),
}));

const goal: Goal = {
  id: "goal-a", name: "Emergency fund", type: "emergency_fund", status: "active",
  description: null, currency: "USD", targetMinor: 5000, currentMinor: 0, targetDate: null, progress: null,
};

beforeEach(() => {
  mockSave.mockReset();
  mockHistory.mockReset();
  mockId.mockClear();
  mockRestore.mockReset().mockResolvedValue(null);
  mockStore.mockReset().mockResolvedValue(undefined);
  mockClear.mockReset().mockResolvedValue(undefined);
});

it("parses currency minor units exactly and rejects precision loss", () => {
  expect(contributionMinor("12.34", "USD")).toBe(1234n);
  expect(contributionMinor("12.3", "EUR")).toBe(1230n);
  expect(contributionMinor("1234", "RWF")).toBe(1234n);
  expect(contributionMinor("12.345", "USD")).toBeNull();
  expect(contributionMinor("1234.0", "RWF")).toBeNull();
  expect(contributionMinor("0", "USD")).toBeNull();
});

it("retries the same contribution after an ambiguous response and refreshes authoritative progress only on success", async () => {
  mockSave.mockResolvedValueOnce("retry").mockResolvedValueOnce("saved");
  const refresh = jest.fn();
  await render(<GoalContributions goal={goal} workspaceId="space-a" userId="user-a" canContribute onSaved={refresh} />);
  await fireEvent.press(await screen.findByText("Add contribution"));
  await fireEvent.changeText(screen.getByLabelText("Amount (USD)"), "12.34");
  await fireEvent.press(screen.getByText("Record contribution"));
  expect(refresh).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByText("Retry save"));
  expect(mockSave.mock.calls[0][0]).toMatchObject({
    id: "request-1", userId: "user-a", workspaceId: "space-a", goalId: "goal-a", amount: 1234n, currency: "USD",
  });
  expect(mockSave.mock.calls[1][0]).toEqual(mockSave.mock.calls[0][0]);
  expect(mockId).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Contribution recorded.")).toBeTruthy();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("lets a viewer read scoped contribution history without offering a write", async () => {
  mockHistory.mockResolvedValue([{ id: "entry-1", amount_minor: 1234, contribution_date: "2026-11-19", source: "manual" }]);
  await render(<GoalContributions goal={goal} workspaceId="space-a" userId="viewer" canContribute={false} onSaved={jest.fn()} />);
  expect(screen.queryByText("Add contribution")).toBeNull();
  await fireEvent.press(screen.getByText("Contribution history"));
  expect(await screen.findByText("USD 12.34")).toBeTruthy();
  expect(mockHistory).toHaveBeenCalledWith("space-a", "goal-a");
});


it("restores the original retry after reopening Goals", async () => {
  const pending = {
    id: "previous-request", userId: "user-a", workspaceId: "space-a", goalId: "goal-a",
    currency: "USD", date: "2026-11-19", amount: 1234n,
  };
  mockRestore.mockResolvedValue(pending);
  mockSave.mockResolvedValue("saved");
  await render(<GoalContributions goal={goal} workspaceId="space-a" userId="user-a" canContribute onSaved={jest.fn()} />);
  await fireEvent.press(await screen.findByText("Retry save"));
  expect(mockSave).toHaveBeenCalledWith(pending);
  expect(mockId).not.toHaveBeenCalled();
  expect(mockClear).toHaveBeenCalledWith(pending);
});

it("does not transmit a contribution when the device cannot store its retry ID", async () => {
  mockStore.mockRejectedValueOnce(new Error("storage unavailable"));
  await render(<GoalContributions goal={goal} workspaceId="space-a" userId="user-a" canContribute onSaved={jest.fn()} />);
  await fireEvent.press(await screen.findByText("Add contribution"));
  await fireEvent.changeText(screen.getByLabelText("Amount (USD)"), "12.34");
  await fireEvent.press(screen.getByText("Record contribution"));
  expect(await screen.findByText(/Couldn’t prepare a safe retry/)).toBeTruthy();
  expect(mockSave).not.toHaveBeenCalled();
});

it("shows removal only for entries the member can remove and keeps archived history read-only", async () => {
  mockHistory.mockResolvedValue([
    { id: "mine", amount_minor: 1200, contribution_date: "2026-11-19", source: "manual", created_by: "user-a" },
    { id: "other", amount_minor: 2300, contribution_date: "2026-11-18", source: "manual", created_by: "user-b" },
  ]);
  const props = { workspaceId: "space-a", userId: "user-a", canContribute: false, onSaved: jest.fn() };
  const view = await render(<GoalContributions goal={goal} {...props} />);
  await fireEvent.press(screen.getByText("Contribution history"));
  expect(await screen.findByLabelText("Remove contribution from 19 Nov 2026")).toBeTruthy();
  expect(screen.queryByLabelText("Remove contribution from 18 Nov 2026")).toBeNull();

  await view.rerender(<GoalContributions goal={{ ...goal, status: "archived" }} {...props} canManage />);
  expect(screen.getByText("USD 23.00")).toBeTruthy();
  expect(screen.queryByLabelText("Remove contribution from 19 Nov 2026")).toBeNull();
});
