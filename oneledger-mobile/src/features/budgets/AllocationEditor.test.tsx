import { fireEvent, render, screen } from "@testing-library/react-native";

import { AllocationEditor } from "./AllocationEditor";
import { allocationPercentages, type AllocationSnapshot } from "./allocation-editor";

const mockEdit = jest.fn();

jest.mock("@/api/supabase", () => ({ supabase: null }));
jest.mock("./allocation-editor", () => ({
  ...jest.requireActual("./allocation-editor"),
  editAllocationPlan: (...args: unknown[]) => mockEdit(...args),
}));

const snapshot: AllocationSnapshot = {
  revision: "revision-1",
  currency: "EUR",
  allocations: [
    { type: "ESSENTIALS", percentage: 40, target_minor: "4000" },
    { type: "INVESTING", percentage: 20, target_minor: "2000" },
    { type: "EMERGENCY", percentage: 10, target_minor: "1000" },
    { type: "WANTS", percentage: 30, target_minor: "3000" },
  ],
};
const scope = { userId: "user-a", workspaceId: "space-a", budgetId: "budget-a" };

beforeEach(() => {
  mockEdit.mockReset();
  mockEdit.mockResolvedValueOnce({ kind: "snapshot", value: snapshot });
});

it("checks the exact total and rejects extra precision", () => {
  const valid = { ESSENTIALS: "40.25", INVESTING: "20", EMERGENCY: "10", WANTS: "29.75" };
  expect(allocationPercentages(valid)).toEqual({ ESSENTIALS: 40.25, INVESTING: 20, EMERGENCY: 10, WANTS: 29.75 });
  expect(allocationPercentages({ ...valid, WANTS: "29.74" })).toBeNull();
  expect(allocationPercentages({ ...valid, WANTS: "29.750" })).toBeNull();
});

it("previews server targets and saves with the loaded revision", async () => {
  const preview = {
    ...snapshot,
    allocations: snapshot.allocations.map((a) => a.type === "ESSENTIALS" ? { ...a, percentage: 45, target_minor: "4501" } : a),
  };
  mockEdit.mockResolvedValueOnce({ kind: "snapshot", value: preview }).mockResolvedValueOnce({ kind: "saved" });
  const refresh = jest.fn();
  await render(<AllocationEditor {...scope} onSaved={refresh} />);
  await fireEvent.press(screen.getByText("Edit allocations"));
  await fireEvent.changeText(await screen.findByLabelText("Essentials (%)"), "45");
  await fireEvent.changeText(screen.getByLabelText("Wants (%)"), "25");
  expect(screen.queryByText("Save allocations")).toBeNull();
  await fireEvent.press(screen.getByText("Preview targets"));
  expect(await screen.findByText("Essentials · EUR 45.01")).toBeTruthy();
  await fireEvent.press(screen.getByText("Save allocations"));
  const edit = { revision: "revision-1", percentages: { ESSENTIALS: 45, INVESTING: 20, EMERGENCY: 10, WANTS: 25 } };
  expect(mockEdit).toHaveBeenNthCalledWith(2, scope, { ...edit, save: false });
  expect(mockEdit).toHaveBeenNthCalledWith(3, scope, { ...edit, save: true });
  expect(await screen.findByText("Allocations saved.")).toBeTruthy();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("requires a reload when someone edits after preview", async () => {
  mockEdit.mockResolvedValueOnce({ kind: "snapshot", value: snapshot })
    .mockResolvedValueOnce({ kind: "stale" })
    .mockResolvedValueOnce({ kind: "snapshot", value: { ...snapshot, revision: "revision-2" } });
  const refresh = jest.fn();
  await render(<AllocationEditor {...scope} onSaved={refresh} />);
  await fireEvent.press(screen.getByText("Edit allocations"));
  await fireEvent.press(await screen.findByText("Preview targets"));
  await fireEvent.press(await screen.findByText("Save allocations"));
  expect(await screen.findByText(/This budget changed/)).toBeTruthy();
  expect(screen.queryByText("Save allocations")).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Load latest allocations"));
  expect(await screen.findByText("Preview targets")).toBeTruthy();
  expect(mockEdit).toHaveBeenLastCalledWith(scope);
});
