import * as Linking from "expo-linking";
import { Platform, Share } from "react-native";
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
  it("lists the codes with no verification badges", async () => {
    await render(<UssdDirectory />);
    expect(await screen.findByText("Check balance")).toBeTruthy();
    expect(screen.getByText("Airtel balance")).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
    expect(screen.queryByText("Unverified")).toBeNull();
    expect(screen.queryByText("Not officially verified")).toBeNull();
  });

  it("puts the eKash code first, ahead of the alphabetical order", async () => {
    mockDirectory.mockResolvedValue([
      code({ id: "a", slug: "access-bank", name: "Access Bank Rwanda - eKash transfer" }),
      code({ id: "b", slug: "bk", name: "Bank of Kigali - eKash transfer" }),
      code({ id: "e", slug: "ekash-mtn-send", name: "eKash - send money to a bank account or Mobile Money wallet", template: "*182*1*2*{receiver}#", acceptsParameters: true }),
    ]);
    await render(<UssdDirectory />);
    await screen.findByText("eKash - send money to a bank account or Mobile Money wallet");
    const names = screen.getAllByRole("link").map((n) => n.props.accessibilityLabel);
    expect(names[0]).toBe("eKash - send money to a bank account or Mobile Money wallet");
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

  it("puts the code first: the name, a one-line summary, and details only below", async () => {
    await render(<UssdCode />);
    expect(await screen.findByText("Send money")).toBeTruthy();
    // No verification badge either way: every listed code is simply offered.
    expect(screen.queryByText("Verified")).toBeNull();
    expect(screen.queryByText("Not officially verified")).toBeNull();
    expect(screen.getByText("Send to a number.")).toBeTruthy();
    // The long-form material is tucked away until asked for.
    expect(screen.queryByText("1. Enter your PIN when asked.")).toBeNull();
    expect(screen.queryByText("Official MTN price list")).toBeNull();
  });

  it("opens the steps and the source under About this code", async () => {
    await render(<UssdCode />);
    await fireEvent.press(await screen.findByRole("button", { name: "About this code" }));
    expect(screen.getByText("1. Enter your PIN when asked.")).toBeTruthy();
    expect(screen.getByText("Official MTN price list")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "About this code" }));
    expect(screen.queryByText("1. Enter your PIN when asked.")).toBeNull();
  });

  describe.each(["ios", "android"] as const)("dialing on %s", (os) => {
    beforeEach(() => jest.replaceProperty(Platform, "OS", os));
    afterEach(() => jest.restoreAllMocks());

    it("has a Dial button that is off until the code is complete, then opens the dialer with it", async () => {
      await render(<UssdCode />);
      const dial = await screen.findByRole("button", { name: "Dial this code" });
      expect(dial.props.accessibilityState.disabled).toBe(true);
      expect(screen.getByText("Fill in your details above to get your code.")).toBeTruthy();

      await fireEvent.changeText(screen.getByLabelText("Phone number"), "0781234567");
      await fireEvent.changeText(screen.getByLabelText("Amount"), "5000");
      await fireEvent.press(await screen.findByRole("button", { name: "Dial this code" }));
      await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith("tel:*182*1*1*0781234567*5000%23"));
    });

    it("never dials by itself", async () => {
      mockBySlug.mockResolvedValue(detail({ acceptsParameters: false, template: "*182*6*1#", parameters: [] }));
      await render(<UssdCode />);
      expect(await screen.findByLabelText("Code to dial: *182*6*1#")).toBeTruthy();
      expect(Linking.openURL).not.toHaveBeenCalled();
    });
  });

  it("a code with no details is ready to dial straight away", async () => {
    mockBySlug.mockResolvedValue(detail({ acceptsParameters: false, template: "*182*6*1#", parameters: [] }));
    await render(<UssdCode />);
    const dial = await screen.findByRole("button", { name: "Dial this code" });
    expect(dial.props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByText("Your details")).toBeNull();
    await fireEvent.press(dial);
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith("tel:*182*6*1%23"));
  });

  it("says so when the dialer can't open", async () => {
    mockBySlug.mockResolvedValue(detail({ acceptsParameters: false, template: "*182*6*1#", parameters: [] }));
    (Linking.openURL as jest.Mock).mockRejectedValue(new Error("no handler"));
    await render(<UssdCode />);
    await fireEvent.press(await screen.findByRole("button", { name: "Dial this code" }));
    expect(await screen.findByText(/Couldn't open the dialer/)).toBeTruthy();
  });

  it("shares or copies the finished code", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    mockBySlug.mockResolvedValue(detail({ acceptsParameters: false, template: "*182*6*1#", parameters: [] }));
    await render(<UssdCode />);
    await fireEvent.press(await screen.findByRole("button", { name: "Share or copy code" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ message: "*182*6*1#" }));
    share.mockRestore();
  });

  it("cannot be dialled while the service is unavailable", async () => {
    mockBySlug.mockResolvedValue(detail({ state: "temporarily_unavailable", acceptsParameters: false, template: "*182*6*1#", parameters: [] }));
    await render(<UssdCode />);
    const dial = await screen.findByRole("button", { name: "Dial this code" });
    expect(dial.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("This service is temporarily unavailable.")).toBeTruthy();
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

describe("eKash code: *182*1*2*{receiver}#", () => {
  const ekash = () =>
    detail({
      slug: "ekash-mtn-send",
      name: "eKash - send money to a bank account or Mobile Money wallet",
      template: "*182*1*2*{receiver}#",
      acceptsParameters: true,
      parameters: [
        { key: "receiver", kind: "account_reference", label: "Receiver's ID", required: true, position: 0, formatRegex: null, formatHint: "The receiver's phone number or account number (letters, digits and dashes).", minLength: null, maxLength: null },
      ],
      steps: [],
    });

  beforeEach(() => {
    setParams({ slug: "ekash-mtn-send" });
    mockBySlug.mockResolvedValue(ekash());
  });

  it("asks for the receiver's ID and builds the code with it", async () => {
    await render(<UssdCode />);
    await fireEvent.changeText(await screen.findByLabelText("Receiver's ID"), "0781234567");
    expect(await screen.findByLabelText("Code to dial: *182*1*2*0781234567#")).toBeTruthy();
  });

  it("works for a bank account number too", async () => {
    await render(<UssdCode />);
    await fireEvent.changeText(await screen.findByLabelText("Receiver's ID"), "00012345678");
    expect(await screen.findByLabelText("Code to dial: *182*1*2*00012345678#")).toBeTruthy();
  });

  it("cannot be dialled until the receiver's ID is in, and then opens the dialer with it", async () => {
    await render(<UssdCode />);
    const dial = await screen.findByRole("button", { name: "Dial this code" });
    expect(dial.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("Code template: *182*1*2*{receiver}#")).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText("Receiver's ID"), "0781234567");
    await fireEvent.press(await screen.findByRole("button", { name: "Dial this code" }));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith("tel:*182*1*2*0781234567%23"));
  });

  it("refuses an ID that could rewrite the code", async () => {
    await render(<UssdCode />);
    await fireEvent.changeText(await screen.findByLabelText("Receiver's ID"), "078*123#");
    expect(await screen.findByText(/can't contain spaces or the characters/)).toBeTruthy();
    expect(screen.queryByLabelText(/Code to dial/)).toBeNull();
  });
});

