import * as Linking from "expo-linking";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import UssdDirectory from "@/app/(app)/ussd/index";
import UssdCode from "@/app/(app)/ussd/[slug]";
import type { ServiceCodeDetail, ServiceCodeListItem } from "@/features/ussd/types";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockDirectory = jest.fn();
const mockFavourites = jest.fn();
const mockFavouriteIds = jest.fn();
const mockToggle = jest.fn();
const mockBySlug = jest.fn();
const mockReport = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("@/features/ussd/queries", () => ({
  ...jest.requireActual("@/features/ussd/queries"),
  getServiceDirectory: (f: unknown) => mockDirectory(f),
  getFavourites: () => mockFavourites(),
  getFavouriteIds: () => mockFavouriteIds(),
  toggleFavourite: (id: string, now: boolean) => mockToggle(id, now),
  getServiceCodeBySlug: (s: string) => mockBySlug(s),
  reportServiceCode: (...a: unknown[]) => mockReport(...a),
}));

const code = (over: Partial<ServiceCodeListItem> = {}): ServiceCodeListItem => ({
  id: "c1",
  slug: "mtn-balance",
  category: "mobile_money",
  name: "Check balance",
  template: "*182*6*1#",
  acceptsParameters: false,
  state: "published",
  verified: true,
  provider: "MTN",
  ...over,
});

beforeEach(() => {
  resetRouterMock();
  [mockDirectory, mockFavourites, mockFavouriteIds, mockToggle, mockBySlug, mockReport, Linking.openURL as jest.Mock].forEach((m) => m.mockReset());
  mockDirectory.mockResolvedValue([code(), code({ id: "c2", slug: "airtel", name: "Airtel balance", verified: false, provider: "Airtel" })]);
  mockFavourites.mockResolvedValue([]);
  mockFavouriteIds.mockResolvedValue(new Set());
  mockToggle.mockResolvedValue(true);
});

describe("USSD directory", () => {
  it("lists codes with their verification status", async () => {
    await render(<UssdDirectory />);
    expect(await screen.findByText("Check balance")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("Unverified")).toBeTruthy();
  });

  it("shows favourites first when nothing is filtered", async () => {
    mockFavourites.mockResolvedValue([code()]);
    mockFavouriteIds.mockResolvedValue(new Set(["c1"]));
    await render(<UssdDirectory />);
    expect(await screen.findByText("Favourites")).toBeTruthy();
    expect(screen.getByText("All services")).toBeTruthy();
  });

  it("searches by the typed term", async () => {
    await render(<UssdDirectory />);
    await screen.findByText("Check balance");
    await fireEvent.changeText(screen.getByLabelText("Search"), "airtel");
    await waitFor(() => expect(mockDirectory).toHaveBeenLastCalledWith({ query: "airtel", category: undefined }));
  });

  it("filters by category and toggles it off", async () => {
    await render(<UssdDirectory />);
    await screen.findByText("Check balance");
    await fireEvent.press(screen.getByRole("button", { name: "Banking" }));
    await waitFor(() => expect(mockDirectory).toHaveBeenLastCalledWith({ query: "", category: "banking" }));
    await fireEvent.press(screen.getByRole("button", { name: "Banking, selected" }));
    await waitFor(() => expect(mockDirectory).toHaveBeenLastCalledWith({ query: "", category: undefined }));
  });

  it("says so when nothing matches", async () => {
    mockDirectory.mockResolvedValue([]);
    await render(<UssdDirectory />);
    await fireEvent.changeText(await screen.findByLabelText("Search"), "zzz");
    expect(await screen.findByText("No matching services")).toBeTruthy();
  });

  it("stars a code", async () => {
    await render(<UssdDirectory />);
    await fireEvent.press(await screen.findByRole("button", { name: "Add Check balance to favourites" }));
    await waitFor(() => expect(mockToggle).toHaveBeenCalledWith("c1", false));
  });

  it("opens a code", async () => {
    await render(<UssdDirectory />);
    await fireEvent.press(await screen.findByRole("link", { name: "Check balance" }));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/ussd/[slug]", params: { slug: "mtn-balance" } });
  });

  it("offers a retry when loading fails", async () => {
    mockDirectory.mockRejectedValue(new Error("x"));
    await render(<UssdDirectory />);
    expect(await screen.findByText("Try again")).toBeTruthy();
  });
});

const detail = (over: Partial<ServiceCodeDetail> = {}): ServiceCodeDetail => ({
  ...code({ acceptsParameters: true, template: "*182*1*1*{phone}*{amount}#", name: "Send money" }),
  description: "Send to a number.",
  sourceLabel: "Official MTN price list",
  sourceUrl: null,
  riskText: null,
  cautionText: null,
  replacementSlug: null,
  parameters: [
    { key: "phone", kind: "phone", label: "Phone number", required: true, position: 1, formatRegex: "^07[2389]\\d{7}$", formatHint: null, minLength: null, maxLength: null },
    { key: "amount", kind: "amount", label: "Amount", required: true, position: 2, formatRegex: null, formatHint: null, minLength: null, maxLength: null },
  ],
  steps: ["Enter your PIN when asked."],
  ...over,
});

describe("USSD code page", () => {
  beforeEach(() => {
    setParams({ slug: "send-money" });
    mockBySlug.mockResolvedValue(detail());
  });

  it("builds the code from what you type and offers to share it", async () => {
    await render(<UssdCode />);
    await fireEvent.changeText(await screen.findByLabelText("Phone number"), "0781234567");
    await fireEvent.changeText(screen.getByLabelText("Amount"), "5000");
    expect(await screen.findByLabelText("Code to dial: *182*1*1*0781234567*5000#")).toBeTruthy();
  });

  it("explains what is wrong and shows no code until the fields are valid", async () => {
    await render(<UssdCode />);
    await fireEvent.changeText(await screen.findByLabelText("Phone number"), "0601234567");
    await fireEvent.changeText(screen.getByLabelText("Amount"), "5000");
    expect(await screen.findByText(/should be the expected format/)).toBeTruthy();
    expect(screen.queryByLabelText(/Code to dial/)).toBeNull();
  });

  it("shows steps and the source", async () => {
    await render(<UssdCode />);
    expect(await screen.findByText("1. Enter your PIN when asked.")).toBeTruthy();
    expect(screen.getByText("Official MTN price list")).toBeTruthy();
  });

  it("warns when a code is deprecated and links to its replacement", async () => {
    mockBySlug.mockResolvedValue(detail({ state: "deprecated", replacementSlug: "send-money-v2" }));
    await render(<UssdCode />);
    expect(await screen.findByText(/deprecated/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Use the current code instead" }));
    expect(router.replace).toHaveBeenCalledWith({ pathname: "/ussd/[slug]", params: { slug: "send-money-v2" } });
  });

  it("stars and unstars", async () => {
    await render(<UssdCode />);
    await fireEvent.press(await screen.findByRole("button", { name: "Add to favourites" }));
    await waitFor(() => expect(mockToggle).toHaveBeenCalledWith("c1", false));
  });

  it("files a report and thanks the user", async () => {
    mockReport.mockResolvedValue(null);
    await render(<UssdCode />);
    await fireEvent.press(await screen.findByRole("button", { name: "Report incorrect information" }));
    await fireEvent.press(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText(/Thanks/)).toBeTruthy();
    expect(mockReport).toHaveBeenCalledWith("c1", "incorrect_code", "");
  });

  it("shows the reason a report was refused", async () => {
    mockReport.mockResolvedValue("You've sent several reports recently. Try again in a little while.");
    await render(<UssdCode />);
    await fireEvent.press(await screen.findByRole("button", { name: "Report incorrect information" }));
    await fireEvent.press(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText(/several reports/)).toBeTruthy();
  });

  it("says when the service can't be found", async () => {
    mockBySlug.mockResolvedValue(null);
    await render(<UssdCode />);
    expect(await screen.findByText("We couldn't find that service")).toBeTruthy();
  });
});
