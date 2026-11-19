import { fireEvent, render, screen } from "@testing-library/react-native";

import { HouseholdSharing } from "./HouseholdSharing";

const mockLoad = jest.fn();
const mockUpdate = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/auth/SessionProvider", () => ({
  useSession: () => ({ session: { user: { id: "user-a" } } }),
}));
jest.mock("./source-sharing", () => ({
  loadHouseholdSources: (...args: unknown[]) => mockLoad(...args),
  updateHouseholdShare: (...args: unknown[]) => mockUpdate(...args),
}));

const household = { id: "space-a", name: "Family", kind: "household", role: "member" } as const;

beforeEach(() => {
  mockLoad.mockReset();
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(true);
});

it("requires confirmation before sharing a wallet with the selected household", async () => {
  mockLoad.mockResolvedValue([{ id: "wallet-source", display_name: "Bank wallet", currency: "USD" }]);
  await render(<HouseholdSharing space={household} />);
  await fireEvent.press(screen.getByText("Manage wallet sharing"));
  await fireEvent.press(await screen.findByText("Share transactions and balance"));
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(screen.getByText(/seven days/)).toBeTruthy();
  await fireEvent.press(screen.getByText("Confirm"));
  expect(mockLoad).toHaveBeenCalledWith("user-a", "space-a");
  expect(mockUpdate).toHaveBeenCalledWith("space-a", "wallet-source", { mode: "share_account" });
});

it("lets the owner stop an existing transaction share without offering to resume it", async () => {
  mockLoad.mockResolvedValue([{
    id: "wallet-source",
    display_name: "Bank wallet",
    currency: "USD",
    link: { visibility_mode: "share_transactions", status: "paused" },
  }]);
  await render(<HouseholdSharing space={household} />);
  await fireEvent.press(screen.getByText("Manage wallet sharing"));
  await fireEvent.press(await screen.findByText("Stop sharing"));
  expect(screen.queryByText("Resume sharing")).toBeNull();
  expect(mockUpdate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Confirm"));
  expect(mockUpdate).toHaveBeenCalledWith("space-a", "wallet-source", { status: "revoked" });
});
