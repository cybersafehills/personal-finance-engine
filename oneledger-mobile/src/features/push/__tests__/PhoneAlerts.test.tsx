import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { PhoneAlerts } from "../PhoneAlerts";

const mockState = jest.fn();
const mockEnable = jest.fn();
const mockDisable = jest.fn();
const support = { on: true };
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("../push", () => ({
  get pushSupported() { return support.on; },
  isPushEnabled: () => mockState(),
  enablePush: () => mockEnable(),
  disablePush: () => mockDisable(),
}));
beforeEach(() => {
  support.on = true;
  [mockState, mockEnable, mockDisable].forEach((m) => m.mockReset());
  mockState.mockResolvedValue(false);
  mockEnable.mockResolvedValue({ ok: true });
  mockDisable.mockResolvedValue(undefined);
});
it("requests permission only after the person turns alerts on", async () => {
  await render(<PhoneAlerts />);
  const toggle = screen.getByRole("switch", { name: "Phone alerts" });
  await waitFor(() => expect(toggle.props.disabled).toBe(false));
  expect(mockEnable).not.toHaveBeenCalled();
  await fireEvent(toggle, "valueChange", true);
  await waitFor(() => expect(mockEnable).toHaveBeenCalledTimes(1));
});
it("turns alerts off using the existing unregister operation", async () => {
  mockState.mockResolvedValue(true);
  await render(<PhoneAlerts />);
  const toggle = screen.getByRole("switch", { name: "Phone alerts" });
  await waitFor(() => expect(toggle.props.value).toBe(true));
  await fireEvent(toggle, "valueChange", false);
  await waitFor(() => expect(mockDisable).toHaveBeenCalledTimes(1));
  expect(mockEnable).not.toHaveBeenCalled();
});
it("keeps alerts off and explains a permission or registration refusal", async () => {
  mockEnable.mockResolvedValue({ ok: false, message: "Notifications are not allowed." });
  await render(<PhoneAlerts />);
  const toggle = screen.getByRole("switch", { name: "Phone alerts" });
  await waitFor(() => expect(toggle.props.disabled).toBe(false));
  await fireEvent(toggle, "valueChange", true);
  expect(await screen.findByText("Notifications are not allowed.")).toBeTruthy();
  expect(toggle.props.value).toBe(false);
});
it("recovers the switch after an unexpected failure", async () => {
  mockEnable.mockRejectedValueOnce(new Error("offline"));
  await render(<PhoneAlerts />);
  const toggle = screen.getByRole("switch", { name: "Phone alerts" });
  await waitFor(() => expect(toggle.props.disabled).toBe(false));
  await fireEvent(toggle, "valueChange", true);
  expect(await screen.findByText("Couldn't update phone alerts. Please try again.")).toBeTruthy();
  await waitFor(() => expect(toggle.props.disabled).toBe(false));
  await fireEvent(toggle, "valueChange", true);
  await waitFor(() => expect(mockEnable).toHaveBeenCalledTimes(2));
});
it("disables unsupported phone alerts with an explanation", async () => {
  support.on = false;
  await render(<PhoneAlerts />);
  expect(screen.getByRole("switch", { name: "Phone alerts" }).props.disabled).toBe(true);
  expect(screen.getByText("Phone alerts need the app installed on a real phone.")).toBeTruthy();
});
