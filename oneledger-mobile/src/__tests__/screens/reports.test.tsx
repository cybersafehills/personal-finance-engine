import { fireEvent, render, screen } from "@testing-library/react-native";

import Reports from "@/app/(app)/reports";
import { resetRouterMock, router } from "@/test/router-mock";

const mockFetch = jest.fn();
const mockOpenUrl = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-linking", () => ({ openURL: (url: string) => mockOpenUrl(url) }));
jest.mock("@/lib/config", () => ({ config: { apiBaseUrl: "https://app.example.test" } }));
jest.mock("@/api/mobile-api", () => ({ fetchReports: () => mockFetch() }));

const item = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  dateLabel: "August 24, 2026",
  status: "generated",
  statusLabel: "Generated",
  generatedLabel: "Aug 25, 12:07 AM",
  ...over,
});

beforeEach(() => {
  resetRouterMock();
  mockFetch.mockReset();
  mockOpenUrl.mockReset();
});

describe("Reports screen", () => {
  it("lists each report with its day, status and when it was generated", async () => {
    mockFetch.mockResolvedValue({ ok: true, reports: [item(), item({ id: "r2", dateLabel: "August 23, 2026", status: "scheduled", statusLabel: "Scheduled", generatedLabel: null })] });
    await render(<Reports />);

    expect(await screen.findByText("August 24, 2026")).toBeTruthy();
    expect(screen.getByText("Generated Aug 25, 12:07 AM")).toBeTruthy();
    expect(screen.getByText("August 23, 2026")).toBeTruthy();
    expect(screen.getByText("Not yet generated")).toBeTruthy();
  });

  it("opens the tapped report", async () => {
    mockFetch.mockResolvedValue({ ok: true, reports: [item()] });
    await render(<Reports />);
    await fireEvent.press(await screen.findByLabelText("August 24, 2026, Generated"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/report/[id]", params: { id: "r1" } });
  });

  it("explains an empty list and points to the web settings", async () => {
    mockFetch.mockResolvedValue({ ok: true, reports: [] });
    await render(<Reports />);
    expect(await screen.findByText("No reports yet")).toBeTruthy();
    await fireEvent.press(screen.getByText("Open report settings on the web"));
    expect(mockOpenUrl).toHaveBeenCalledWith("https://app.example.test/settings/reports");
  });

  it("offers a retry on a failure, and none when the feature isn't available", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "error", message: "Couldn't load your reports." });
    await render(<Reports />);
    expect(await screen.findByText("Couldn't load your reports.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("has no retry when the endpoint isn't available yet", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "unavailable", message: "Your reports isn't available yet." });
    await render(<Reports />);
    expect(await screen.findByText("Your reports isn't available yet.")).toBeTruthy();
    expect(screen.queryByText("Try again")).toBeNull();
  });
});
