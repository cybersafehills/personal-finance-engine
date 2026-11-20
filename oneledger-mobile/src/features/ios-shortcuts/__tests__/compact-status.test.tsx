import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "@/test/router-mock";
import { IosStatusCard } from "../IosStatusCard";

const mockId = jest.fn();
const mockDevice = jest.fn();
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("../store", () => ({ loadIosDeviceCredentialId: () => mockId() }));
jest.mock("@/features/pairing/pairing", () => ({ getDeviceStatus: () => mockDevice() }));
beforeEach(() => { mockId.mockReset(); mockDevice.mockReset(); router.push.mockReset(); });
it("takes an unpaired iPhone to the existing setup guide", async () => {
  mockId.mockResolvedValue(null);
  await render(<IosStatusCard compact />);
  await screen.findByText("Set up");
  await fireEvent.press(screen.getByRole("link", { name: "Automatic recording" }));
  expect(router.push).toHaveBeenCalledWith("/shortcuts");
  expect(mockDevice).not.toHaveBeenCalled();
});
it("keeps the connected device's real health status", async () => {
  mockId.mockResolvedValue("device-id");
  mockDevice.mockResolvedValue({ status: "active", createdAtIso: new Date().toISOString(), lastUsedAtIso: new Date().toISOString() });
  await render(<IosStatusCard compact />);
  expect(await screen.findByText("Working")).toBeTruthy();
  expect(screen.queryByText("Set up")).toBeNull();
});
it("does not mistake a failed status lookup for a new setup", async () => {
  mockId.mockRejectedValue(new Error("offline"));
  await render(<IosStatusCard compact />);
  expect(await screen.findByText("Check status")).toBeTruthy();
  expect(screen.queryByText("Set up")).toBeNull();
});
