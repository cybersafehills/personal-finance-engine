import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import NotificationsScreen from "@/app/(app)/notifications";
import type { NotificationRow } from "@/features/notifications/queries";
import { resetRouterMock, router } from "@/test/router-mock";

const mockGet = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkAll = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/notifications/queries", () => ({
  getNotifications: () => mockGet(),
  markNotificationRead: (id: string) => mockMarkRead(id),
  markAllNotificationsRead: () => mockMarkAll(),
}));

const TX = "11111111-2222-3333-4444-555555555555";

const note = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: "n1",
  title: "Budget nearing its limit",
  body: "Wants has used 80% of its target.",
  createdAt: "2026-11-14T10:00:00Z",
  readAt: null,
  resourceType: "budget",
  resourceId: "b1",
  ...over,
});

beforeEach(() => {
  resetRouterMock();
  [mockGet, mockMarkRead, mockMarkAll].forEach((m) => m.mockReset());
  mockMarkRead.mockResolvedValue(undefined);
  mockMarkAll.mockResolvedValue(undefined);
});

describe("Notifications screen", () => {
  it("lists notifications, marking the unread ones", async () => {
    mockGet.mockResolvedValue([note(), note({ id: "n2", title: "Welcome", body: null, readAt: "2026-11-13T00:00:00Z" })]);
    await render(<NotificationsScreen />);

    expect(await screen.findByText("Budget nearing its limit")).toBeTruthy();
    expect(screen.getByText("Wants has used 80% of its target.")).toBeTruthy();
    expect(screen.getByLabelText("Unread. Budget nearing its limit")).toBeTruthy();
    expect(screen.getByLabelText("Welcome")).toBeTruthy();
    expect(screen.getByText(/^New · /)).toBeTruthy();
  });

  it("opens a transaction notification on that transaction, after marking it read", async () => {
    mockGet.mockResolvedValue([note({ id: "n3", title: "Payment recorded", resourceType: "transaction", resourceId: TX })]);
    await render(<NotificationsScreen />);

    await fireEvent.press(await screen.findByText("Payment recorded"));

    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith("n3"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/transaction/[id]", params: { id: TX } });
  });

  it("only marks a notification with no screen of its own as read, and refreshes in place", async () => {
    mockGet.mockResolvedValue([note()]);
    await render(<NotificationsScreen />);
    await screen.findByText("Budget nearing its limit");
    mockGet.mockClear();

    await fireEvent.press(screen.getByText("Budget nearing its limit"));

    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith("n1"));
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not mark an already-read notification again", async () => {
    mockGet.mockResolvedValue([note({ readAt: "2026-11-13T00:00:00Z", resourceType: "transaction", resourceId: TX })]);
    await render(<NotificationsScreen />);
    await fireEvent.press(await screen.findByText("Budget nearing its limit"));
    expect(mockMarkRead).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalled();
  });

  it("will not build a route from a malformed id", async () => {
    mockGet.mockResolvedValue([note({ resourceType: "transaction", resourceId: "../../admin" })]);
    await render(<NotificationsScreen />);
    await fireEvent.press(await screen.findByText("Budget nearing its limit"));
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalled());
    expect(router.push).not.toHaveBeenCalled();
  });

  it("marks everything read, and only offers that when something is unread", async () => {
    mockGet.mockResolvedValue([note()]);
    await render(<NotificationsScreen />);
    await fireEvent.press(await screen.findByText("Mark all as read"));
    await waitFor(() => expect(mockMarkAll).toHaveBeenCalled());
  });

  it("offers no mark-all button when everything is read", async () => {
    mockGet.mockResolvedValue([note({ readAt: "2026-11-13T00:00:00Z" })]);
    await render(<NotificationsScreen />);
    await screen.findByText("Budget nearing its limit");
    expect(screen.queryByText("Mark all as read")).toBeNull();
  });

  it("shows an empty state", async () => {
    mockGet.mockResolvedValue([]);
    await render(<NotificationsScreen />);
    expect(await screen.findByText("Nothing yet")).toBeTruthy();
  });

  it("shows a retry when loading fails", async () => {
    mockGet.mockRejectedValue(new Error("network"));
    await render(<NotificationsScreen />);
    expect(await screen.findByText("Try again")).toBeTruthy();
  });

  it("goes back", async () => {
    mockGet.mockResolvedValue([]);
    await render(<NotificationsScreen />);
    await fireEvent.press(await screen.findByText("Back"));
    expect(router.back).toHaveBeenCalled();
  });
});
