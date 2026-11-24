import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import SaveOn from "@/app/(app)/save-on";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));

const mockFetch = jest.fn();
const mockSave = jest.fn();
jest.mock("@/api/mobile-api", () => ({
  fetchSaveOnPrefs: () => mockFetch(),
  saveSaveOnPrefs: (p: unknown) => mockSave(p),
}));

const LEVELS = { any: "0", balanced: "100", bigger: "500" };

beforeEach(() => {
  mockFetch.mockReset();
  mockSave.mockReset();
  mockFetch.mockResolvedValue({ ok: true, preferences: { feeSavingEnabled: false, threshold: "balanced" }, levels: LEVELS });
});

describe("Save On settings", () => {
  it("explains how it works and when it applies, in plain words", async () => {
    await render(<SaveOn />);
    expect(await screen.findByText("How Save On works")).toBeTruthy();
    expect(screen.getByText(/OneLedger never moves your money/)).toBeTruthy();
    expect(screen.getByText(/Between two MTN numbers/)).toBeTruthy();
    expect(screen.getByText(/above RWF 10,000,000 has to go in parts/)).toBeTruthy();
  });

  it("names the three levels in OneLedger's own words, with the server's figures", async () => {
    mockFetch.mockResolvedValue({ ok: true, preferences: { feeSavingEnabled: true, threshold: "balanced" }, levels: LEVELS });
    await render(<SaveOn />);
    expect(await screen.findByRole("button", { name: "Every Franc" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Worth It (Our pick), selected" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Big Wins" })).toBeTruthy();
    expect(screen.getByText("Suggest it when each extra transfer saves at least 100 RWF.")).toBeTruthy();
    expect(screen.getByText("Only suggest it when each extra transfer saves at least 500 RWF.")).toBeTruthy();
    expect(screen.getByText(/180,000 RWF between two MTN numbers costs 1,500 RWF/)).toBeTruthy();
  });

  it("is off until the person turns it on, and only then asks how much to save", async () => {
    await render(<SaveOn />);
    expect(await screen.findByRole("button", { name: "Off, selected" })).toBeTruthy();
    expect(screen.queryByText("Worth It (Our pick)")).toBeNull();

    mockSave.mockResolvedValue({ ok: true, preferences: { feeSavingEnabled: true, threshold: "balanced" } });
    await fireEvent.press(screen.getByRole("button", { name: "On" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ feeSavingEnabled: true, threshold: "balanced" }));
    expect(await screen.findByText("Worth It (Our pick)")).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("changes the threshold", async () => {
    mockFetch.mockResolvedValue({ ok: true, preferences: { feeSavingEnabled: true, threshold: "balanced" }, levels: LEVELS });
    mockSave.mockResolvedValue({ ok: true, preferences: { feeSavingEnabled: true, threshold: "bigger" } });
    await render(<SaveOn />);
    await fireEvent.press(await screen.findByRole("button", { name: "Big Wins" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ feeSavingEnabled: true, threshold: "bigger" }));
  });

  it("puts the old choice back and says so when saving fails", async () => {
    mockSave.mockResolvedValue({ ok: false, reason: "error", code: null, message: "Could not save your choice." });
    await render(<SaveOn />);
    await fireEvent.press(await screen.findByRole("button", { name: "On" }));
    expect(await screen.findByText("Could not save your choice.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Off, selected" })).toBeTruthy();
  });

  it("offers a retry when the choice can't be loaded", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "error", code: null, message: "Couldn't load save on. Check your connection and try again." });
    await render(<SaveOn />);
    expect(await screen.findByText(/Check your connection/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
