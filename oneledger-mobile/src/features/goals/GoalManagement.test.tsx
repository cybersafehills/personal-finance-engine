import { fireEvent, render, screen } from "@testing-library/react-native";

import { ArchiveGoalControl, NewGoalControl, RemoveContributionControl } from "./GoalManagement";

const mockCreate = jest.fn();
const mockArchive = jest.fn();
const mockRemove = jest.fn();
const mockNewId = jest.fn(() => "goal-request");
const scope = { workspaceId: "space-a", userId: "user-a" };

jest.mock("@/api/supabase", () => ({ supabase: null }));
jest.mock("@/offline/ids", () => ({ getNewId: () => mockNewId() }));
jest.mock("./management", () => ({
  archiveManagedGoal: (...args: unknown[]) => mockArchive(...args),
  createManagedGoal: (...args: unknown[]) => mockCreate(...args),
  removeGoalContribution: (...args: unknown[]) => mockRemove(...args),
}));

beforeEach(() => {
  mockCreate.mockReset();
  mockArchive.mockReset();
  mockRemove.mockReset();
  mockNewId.mockClear();
});

it("saves exact target minor units and retries an uncertain creation with the same goal ID", async () => {
  mockCreate.mockResolvedValueOnce("unconfirmed").mockResolvedValueOnce("saved");
  const refresh = jest.fn();
  await render(<NewGoalControl scope={scope} onSaved={refresh} />);
  await fireEvent.press(screen.getByText("Create a goal"));
  await fireEvent.changeText(screen.getByLabelText("Goal name"), "Emergency reserve");
  await fireEvent.press(screen.getByText("USD"));
  await fireEvent.changeText(screen.getByLabelText("Target amount (USD)"), "12.345");
  await fireEvent.press(screen.getByText("Save goal"));
  expect(mockCreate).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("Target amount (USD)"), "12.34");
  await fireEvent.press(screen.getByText("Save goal"));
  await fireEvent.press(await screen.findByText("Retry creation"));
  expect(mockCreate).toHaveBeenNthCalledWith(1, scope, {
    id: "goal-request", name: "Emergency reserve", description: null, type: "general_savings",
    currency: "USD", targetMinor: 1234n, targetDate: null,
  });
  expect(mockCreate.mock.calls[1]).toEqual(mockCreate.mock.calls[0]);
  expect(mockNewId).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Goal created.")).toBeTruthy();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("waits for archive confirmation and server acknowledgement before refreshing", async () => {
  mockArchive.mockResolvedValue("saved");
  const refresh = jest.fn();
  await render(<ArchiveGoalControl scope={scope} goalId="goal-a" onSaved={refresh} />);
  await fireEvent.press(screen.getByText("Archive goal"));
  expect(mockArchive).not.toHaveBeenCalled();
  expect(screen.getByText(/stay in its history/)).toBeTruthy();
  await fireEvent.press(screen.getByText("Confirm archive"));
  expect(mockArchive).toHaveBeenCalledWith(scope, "goal-a");
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("only removes the confirmed history entry and reloads after an uncertain response", async () => {
  mockRemove.mockResolvedValue("unconfirmed");
  const refresh = jest.fn();
  await render(<RemoveContributionControl scope={scope} goalId="goal-a" entryId="entry-a"
    dateLabel="19 Nov 2026" onRefresh={refresh} />);
  await fireEvent.press(screen.getByLabelText("Remove contribution from 19 Nov 2026"));
  expect(mockRemove).not.toHaveBeenCalled();
  expect(screen.getByText(/stays in your ledger/)).toBeTruthy();
  await fireEvent.press(screen.getByText("Confirm removal"));
  expect(mockRemove).toHaveBeenCalledWith(scope, "goal-a", "entry-a");
  expect(await screen.findByText(/Check the refreshed history/)).toBeTruthy();
  expect(refresh).toHaveBeenCalledTimes(1);
});
