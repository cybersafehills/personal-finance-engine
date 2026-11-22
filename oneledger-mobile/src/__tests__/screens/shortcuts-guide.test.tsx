import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import ShortcutsGuide from "@/app/(app)/shortcuts";
import { resetRouterMock, router } from "@/test/router-mock";

const mockListAccounts = jest.fn();
const mockStartPairing = jest.fn();
const mockPairingStatus = jest.fn();
const mockDeviceStatus = jest.fn();
const mockDeliveryStatus = jest.fn();
const mockLoadId = jest.fn();
const mockSaveId = jest.fn();
const mockClearId = jest.fn();
jest.mock("@/features/ios-shortcuts/install-state", () => ({
 EMPTY_INSTALL: {connect:{opened:false,added:false},capture:{opened:false,added:false}},
 loadShortcutInstall: async () => ({connect:{opened:false,added:false},capture:{opened:false,added:false}}),
 saveShortcutInstall: jest.fn(),
}));
const links = { combined: "", connect: "https://www.icloud.com/shortcuts/connect", capture: "https://www.icloud.com/shortcuts/capture" };

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/lib/config", () => ({
  config: {
    get combinedShortcutUrl() { return links.combined; },
    get connectShortcutUrl() {
      return links.connect;
    },
    get captureShortcutUrl() {
      return links.capture;
    },
  },
}));
jest.mock("@/features/pairing/pairing", () => ({
  listPairableAccounts: () => mockListAccounts(),
  startPairingSession: (account: unknown) => mockStartPairing(account),
  getPairingSessionStatus: (id: string) => mockPairingStatus(id),
  getDeviceStatus: (id: string) => mockDeviceStatus(id),
  getShortcutDeliveryStatus: (id: string) => mockDeliveryStatus(id),
}));
jest.mock("@/features/ios-shortcuts/store", () => ({
  loadIosDeviceCredentialId: () => mockLoadId(),
  saveIosDeviceCredentialId: (id: string) => mockSaveId(id),
  clearIosDeviceCredentialId: () => mockClearId(),
}));

const account = { id: "a1", name: "MTN MoMo", provider: "mtn_momo", workspaceId: "w1" };
const started = (over: Record<string, unknown> = {}) => ({
  ok: true,
  token: "olp_TESTTOKEN123",
  sessionId: "s1",
  expiresAtIso: new Date(Date.now() + 10 * 60_000).toISOString(),
  ...over,
});

beforeEach(() => {
  jest.useFakeTimers();
  resetRouterMock();
  [mockListAccounts, mockStartPairing, mockPairingStatus, mockDeviceStatus, mockDeliveryStatus, mockLoadId, mockSaveId, mockClearId].forEach((m) => m.mockReset());
  links.combined = "";
  links.connect = "https://www.icloud.com/shortcuts/connect";
  links.capture = "https://www.icloud.com/shortcuts/capture";
  mockListAccounts.mockResolvedValue({ ok: true, accounts: [account] });
  mockLoadId.mockResolvedValue(null);
  mockDeliveryStatus.mockResolvedValue(null);
  jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function toConnectStep() {
  await fireEvent.press(await screen.findByText("I've added them"));
}

async function finishAutomation() {
 while (screen.queryByText("Next instruction")) await fireEvent.press(screen.getByText("Next instruction"));
 await fireEvent.press(screen.getByText("I’ve saved the trigger"));
}

async function tick(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe("iPhone guide: add the Shortcuts", () => {
  it("offers both Shortcuts and opens each link", async () => {
    await render(<ShortcutsGuide />);
    await fireEvent.press(await screen.findByRole("button", { name: "Add “Connect to OneLedger”" }));
    expect(Linking.openURL).toHaveBeenLastCalledWith(links.connect);
    await fireEvent.press(screen.getByRole("button", { name: "Add “OneLedger Capture”" }));
    expect(Linking.openURL).toHaveBeenLastCalledWith(links.capture);
  });

  it("offers a single button when both Shortcuts share one link", async () => {
    links.capture = "";
    await render(<ShortcutsGuide />);
    expect(await screen.findByRole("button", { name: "Add “Connect to OneLedger”" })).toBeTruthy();
    expect(screen.queryByText("Add “OneLedger Capture”")).toBeNull();
  });

  it("offers web setup rather than unverified manual build steps when installation links are missing", async () => {
    links.connect = "";links.capture = "";
    await render(<ShortcutsGuide />);
    expect(await screen.findByText(/Shortcut installation is unavailable/)).toBeTruthy();
    expect(screen.getByRole("button",{name:"I've added them"}).props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByText(/Shortcut 1:/)).toBeNull();
    expect(mockStartPairing).not.toHaveBeenCalled();
  });

  it("tells the person when a link could not be opened", async () => {
    (Linking.openURL as jest.Mock).mockRejectedValue(new Error("no handler"));
    await render(<ShortcutsGuide />);
    await fireEvent.press(await screen.findByRole("button", { name: "Add “Connect to OneLedger”" }));
    expect(await screen.findByText(/Could not open the download/)).toBeTruthy();
  });
});

describe("iPhone guide: connect", () => {
  it("creates a code, opens the Shortcut with it, and waits", async () => {
    mockStartPairing.mockResolvedValue(started());
    await render(<ShortcutsGuide />);
    await toConnectStep();

    await fireEvent.press(await screen.findByRole("button", { name: "Connect this iPhone" }));

    await waitFor(() => expect(mockStartPairing).toHaveBeenCalledWith(account));
    expect(Linking.openURL).toHaveBeenLastCalledWith(
      "shortcuts://run-shortcut?name=Connect%20to%20OneLedger&input=text&text=olp_TESTTOKEN123",
    );
    expect(await screen.findByText("olp_TESTTOKEN123")).toBeTruthy();
    expect(screen.getByText(/Waiting for this iPhone to connect/)).toBeTruthy();
  });

  it("moves on by itself once the Shortcut redeems the code, and remembers the connection", async () => {
    mockStartPairing.mockResolvedValue(started());
    mockPairingStatus.mockResolvedValue({ status: "pending", deviceCredentialId: null });
    await render(<ShortcutsGuide />);
    await toConnectStep();
    await fireEvent.press(await screen.findByRole("button", { name: "Connect this iPhone" }));
    await screen.findByText(/Waiting for this iPhone to connect/);

    mockPairingStatus.mockResolvedValue({ status: "consumed", deviceCredentialId: "cred-9" });
    await tick(3_100);

    expect(await screen.findByText(/This iPhone is connected/)).toBeTruthy();
    expect(mockSaveId).toHaveBeenCalledWith("cred-9");
  });

  it("does not move on while the code is still pending", async () => {
    mockStartPairing.mockResolvedValue(started());
    mockPairingStatus.mockResolvedValue({ status: "pending", deviceCredentialId: null });
    await render(<ShortcutsGuide />);
    await toConnectStep();
    await fireEvent.press(await screen.findByRole("button", { name: "Connect this iPhone" }));
    await screen.findByText(/Waiting for this iPhone to connect/);

    await tick(9_000);
    expect(screen.queryByText(/This iPhone is connected/)).toBeNull();
    expect(mockSaveId).not.toHaveBeenCalled();
  });

  it("offers a fresh code when the first one expired unused", async () => {
    mockStartPairing.mockResolvedValue(started());
    mockPairingStatus.mockResolvedValue({ status: "expired", deviceCredentialId: null });
    await render(<ShortcutsGuide />);
    await toConnectStep();
    await fireEvent.press(await screen.findByRole("button", { name: "Connect this iPhone" }));
    await screen.findByText(/Waiting for this iPhone to connect/);

    await tick(3_100);
    expect(await screen.findByText(/That code expired before it was used/)).toBeTruthy();
    expect(screen.getByText("Get a new code and connect")).toBeTruthy();
  });

  it("shows why a code could not be created", async () => {
    mockStartPairing.mockResolvedValue({ ok: false, message: "Only the account owner can connect a phone." });
    await render(<ShortcutsGuide />);
    await toConnectStep();
    await fireEvent.press(await screen.findByRole("button", { name: "Connect this iPhone" }));
    expect(await screen.findByText("Only the account owner can connect a phone.")).toBeTruthy();
  });

  it("explains when the Connect Shortcut cannot be opened, and keeps the code on screen", async () => {
    mockStartPairing.mockResolvedValue(started());
    await render(<ShortcutsGuide />);
    await toConnectStep();
    (Linking.openURL as jest.Mock).mockRejectedValue(new Error("no handler"));
    await fireEvent.press(await screen.findByRole("button", { name: "Connect this iPhone" }));
    expect(await screen.findByText(/Couldn't open the Shortcut/)).toBeTruthy();
    expect(screen.getByText("olp_TESTTOKEN123")).toBeTruthy();
  });

  it("explains when there is no MoMo account yet", async () => {
    mockListAccounts.mockResolvedValue({ ok: true, accounts: [] });
    await render(<ShortcutsGuide />);
    await toConnectStep();
    expect(await screen.findByText("No MTN MoMo account yet")).toBeTruthy();
  });
});

describe("iPhone guide: forwarding and checking", () => {
  async function toAutomateStep() {
    mockStartPairing.mockResolvedValue(started());
    mockPairingStatus.mockResolvedValue({ status: "consumed", deviceCredentialId: "cred-9" });
    await render(<ShortcutsGuide />);
    await toConnectStep();
    await fireEvent.press(await screen.findByRole("button", { name: "Connect this iPhone" }));
    await screen.findByText(/Waiting for this iPhone to connect/);
    await tick(3_100);
    await screen.findByText(/This iPhone is connected/);
  }

  it("lists the Messages automation steps and opens the Shortcuts app", async () => {
    await toAutomateStep();
    expect(screen.getByText("Create a Message automation")).toBeTruthy();

    await fireEvent.press(screen.getByText("Open Shortcuts"));
    expect(Linking.openURL).toHaveBeenLastCalledWith("shortcuts://");
  });

  it("waits for the first message after the automation is set up", async () => {
    mockDeviceStatus.mockResolvedValue({ status: "active", createdAtIso: new Date().toISOString(), lastUsedAtIso: null });
    await toAutomateStep();
    await finishAutomation();
    expect(await screen.findByText("Connection not verified this visit")).toBeTruthy();
  });

  it("confirms it is working once a message has come through", async () => {
    mockDeviceStatus.mockResolvedValue({
      status: "active",
      createdAtIso: new Date(Date.now() - 3_600_000).toISOString(),
      lastUsedAtIso: new Date().toISOString(),
    });
    await toAutomateStep();
    await finishAutomation();
    expect(await screen.findByText("Connection not verified this visit")).toBeTruthy();
  });

  it("shows troubleshooting on request, and lets the person finish", async () => {
    mockDeviceStatus.mockResolvedValue({ status: "active", createdAtIso: new Date().toISOString(), lastUsedAtIso: null });
    await toAutomateStep();
    await finishAutomation();

    await fireEvent.press(await screen.findByText("It isn't working"));
    expect(screen.getByText("The automation asks me to confirm every time")).toBeTruthy();
    expect(screen.getByText("I reinstalled the Shortcuts or got a new iPhone")).toBeTruthy();

    await fireEvent.press(screen.getByText("Finish"));
    expect(router.back).toHaveBeenCalled();
  });
});

describe("iPhone guide: coming back later", () => {
  it("resumes at the check step when the remembered connection is still active", async () => {
    mockLoadId.mockResolvedValue("cred-9");
    mockDeviceStatus.mockResolvedValue({
      status: "active",
      createdAtIso: new Date(Date.now() - 86_400_000).toISOString(),
      lastUsedAtIso: new Date().toISOString(),
    });
    await render(<ShortcutsGuide />);
    expect(await screen.findByText("Connection not verified this visit")).toBeTruthy();
    expect(screen.queryByText("I've added them")).toBeNull();
  });

  it("starts from the top when the remembered connection was revoked", async () => {
    mockLoadId.mockResolvedValue("cred-9");
    mockDeviceStatus.mockResolvedValue({ status: "revoked", createdAtIso: new Date().toISOString(), lastUsedAtIso: null });
    await render(<ShortcutsGuide />);
    expect(await screen.findByText("I've added them")).toBeTruthy();
  });

  it("forgets the old connection and starts connecting again on request", async () => {
    mockLoadId.mockResolvedValue("cred-9");
    mockDeviceStatus.mockResolvedValue({
      status: "active",
      createdAtIso: new Date(Date.now() - 86_400_000).toISOString(),
      lastUsedAtIso: new Date().toISOString(),
    });
    await render(<ShortcutsGuide />);
    await fireEvent.press(await screen.findByText("Connect this iPhone again"));
    expect(mockClearId).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Connect this iPhone" })).toBeTruthy();
  });
});

it("offers a retryable error when pairing cannot reach the server",async()=>{
 mockStartPairing.mockRejectedValue(new Error("offline"));
 await render(<ShortcutsGuide/>);await toConnectStep();
 await fireEvent.press(await screen.findByRole("button",{name:"Connect this iPhone"}));
 expect(await screen.findByText(/Couldn’t create a connection/)).toBeTruthy();
 expect(screen.queryByText(/This iPhone is connected/)).toBeNull();
});

it("keeps download and Added states separate and offers reinstall", async () => {
 await render(<ShortcutsGuide />);
 await fireEvent.press(await screen.findByRole("button", {name:"Add “Connect to OneLedger”"}));
 expect(await screen.findByRole("button", {name:"Add it again “Connect to OneLedger”"})).toBeTruthy();
 const check = screen.getByRole("checkbox", {name:"Connect to OneLedger added"});
 expect(check.props.accessibilityState.checked).toBe(false);
 await fireEvent.press(check);
 expect(screen.getByRole("checkbox", {name:"Connect to OneLedger added"}).props.accessibilityState.checked).toBe(true);
 expect(screen.getByRole("checkbox", {name:"OneLedger Capture added"}).props.accessibilityState.checked).toBe(false);
 expect(mockStartPairing).not.toHaveBeenCalled();
});
it("offers a fresh pairing attempt without waiting for expiry", async () => {
 mockStartPairing.mockResolvedValue(started());mockPairingStatus.mockResolvedValue({status:"pending",deviceCredentialId:null});
 await render(<ShortcutsGuide/>);await toConnectStep();
 await fireEvent.press(await screen.findByRole("button", {name:"Connect this iPhone"}));
 await fireEvent.press(await screen.findByRole("button", {name:"Get a new code and connect"}));
 expect(mockStartPairing).toHaveBeenCalledTimes(2);
});

it("installs only the merged shortcut and runs that name for pairing", async () => {
 links.combined="https://www.icloud.com/shortcuts/combined";
 mockStartPairing.mockResolvedValue(started());
 await render(<ShortcutsGuide/>);
 expect(screen.queryByRole("button",{name:"Add “Connect to OneLedger”"})).toBeNull();
 await fireEvent.press(await screen.findByRole("button",{name:"Add “OneLedger Capture”"}));
 expect(Linking.openURL).toHaveBeenLastCalledWith(links.combined);
 await fireEvent.press(screen.getByText("I’ve added OneLedger Capture"));
 await fireEvent.press(await screen.findByRole("button",{name:"Connect this iPhone"}));
 expect(Linking.openURL).toHaveBeenLastCalledWith("shortcuts://run-shortcut?name=OneLedger%20Capture&input=text&text=olp_TESTTOKEN123");
});

it("requires a fresh successful test event, never stale activity or a rejection", async () => {
 mockLoadId.mockResolvedValue("cred-9");
 mockDeviceStatus.mockResolvedValue({status:"active",createdAtIso:new Date().toISOString(),lastUsedAtIso:new Date(Date.now()-86400000).toISOString()});
 mockDeliveryStatus.mockResolvedValue({testAt:new Date(Date.now()-86400000).toISOString(),captureAt:null,rejection:null});
 await render(<ShortcutsGuide/>);
 await fireEvent.press(await screen.findByText("Test connection without a payment"));
 expect(Linking.openURL).toHaveBeenLastCalledWith("shortcuts://run-shortcut?name=OneLedger%20Capture&input=text&text=oneledger%3Atest");
 expect(screen.queryByText("Connection test received")).toBeNull();
 mockDeliveryStatus.mockResolvedValue({testAt:null,captureAt:null,rejection:{created_at:new Date().toISOString(),reason_code:"INVALID_CAPTURE_PAYLOAD"}});
 await tick(5100);
 expect(await screen.findByText(/latest request was rejected/)).toBeTruthy();
 expect(screen.queryByText("Connection test received")).toBeNull();
 mockDeliveryStatus.mockResolvedValue({testAt:new Date().toISOString(),captureAt:null,rejection:null});
 await tick(5100);
 expect(await screen.findByText("Connection test received")).toBeTruthy();
});

it("distinguishes connection tests and old captures from a newly accepted message", async () => {
 mockLoadId.mockResolvedValue("cred-9");
 mockDeviceStatus.mockResolvedValue({status:"active",createdAtIso:new Date().toISOString(),lastUsedAtIso:new Date().toISOString()});
 mockDeliveryStatus.mockResolvedValue({testAt:new Date().toISOString(),captureAt:new Date(Date.now()-86400000).toISOString(),rejection:null});
 await render(<ShortcutsGuide/>);
 expect(await screen.findByText("Waiting for an incoming message")).toBeTruthy();
 expect(screen.queryByText("New message received")).toBeNull();
 mockDeliveryStatus.mockResolvedValue({testAt:new Date().toISOString(),captureAt:new Date(Date.now()+1000).toISOString(),rejection:null});
 await tick(5100);
 expect(await screen.findByText("New message received")).toBeTruthy();
 expect(screen.queryByText("Connection test received")).toBeNull();
});
