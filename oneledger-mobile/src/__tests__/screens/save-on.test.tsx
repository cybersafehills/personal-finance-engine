import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import SaveOn from "@/app/(app)/save-on";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));

const mockFetch = jest.fn();
const mockSave = jest.fn();
jest.mock("@/api/mobile-api", () => ({
  fetchSaveOnPrefs: () => mockFetch(),
  saveSaveOnPrefs: (p: unknown) => mockSave(p),
}));

beforeEach(() => {
  mockFetch.mockReset();
  mockSave.mockReset();
  mockFetch.mockResolvedValue({ ok: true, preferences: { feeSavingEnabled: false, threshold: "balanced" } });
});

describe("Save On settings", () => {
  it("explains how it works and when it applies, in plain words", async () => {
    await render(<SaveOn />);
    expect(await screen.findByText("How Save On works")).toBeTruthy();
    expect(screen.getByText(/OneLedger never moves your money/)).toBeTruthy();
    expect(screen.getByText(/Between two MTN numbers/)).toBeTruthy();
    expect(screen.getByText(/above RWF 10,000,000 has to go in parts/)).toBeTruthy();
  });

  it("is off until the person turns it on, and only then asks how much to save", async () => {
    await render(<SaveOn />);
    expect(await screen.findByRole("button", { name: "Off, selected" })).toBeTruthy();
    expect(screen.queryByText("Balanced (recommended)")).toBeNull();

    mockSave.mockResolvedValue({ ok: true, preferences: { feeSavingEnabled: true, threshold: "balanced" } });
    await fireEvent.press(screen.getByRole("button", { name: "On" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ feeSavingEnabled: true, threshold: "balanced" }));
    expect(await screen.findByText("Balanced (recommended)")).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("changes the threshold", async () => {
    mockFetch.mockResolvedValue({ ok: true, preferences: { feeSavingEnabled: true, threshold: "balanced" } });
    mockSave.mockResolvedValue({ ok: true, preferences: { feeSavingEnabled: true, threshold: "bigger" } });
    await render(<SaveOn />);
    await fireEvent.press(await screen.findByRole("button", { name: "Bigger savings" }));
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
