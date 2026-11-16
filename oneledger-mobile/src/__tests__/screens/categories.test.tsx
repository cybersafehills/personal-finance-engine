import { fireEvent, render, screen } from "@testing-library/react-native";

import Categories from "@/app/(app)/categories";
import { resetRouterMock, router } from "@/test/router-mock";

const mockFetch = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchCategories: () => mockFetch() }));

const ok = (categories: unknown[], truncated = false) => ({ ok: true, categories, truncated });
const cat = (category: string, totalRwf: number, transactionCount = 1) => ({ category, totalRwf, transactionCount });

beforeEach(() => {
  resetRouterMock();
  mockFetch.mockReset();
});

describe("Categories screen", () => {
  it("lists each category with its total and transaction count", async () => {
    mockFetch.mockResolvedValue(ok([cat("Food", 52_000, 12), cat("Transport", 8_000, 1)]));
    await render(<Categories />);

    expect(await screen.findByText("Food")).toBeTruthy();
    expect(screen.getByText("52,000 RWF")).toBeTruthy();
    expect(screen.getByText("12 transactions")).toBeTruthy();
    expect(screen.getByText("Transport")).toBeTruthy();
    expect(screen.getByText("1 transaction")).toBeTruthy();
  });

  it("marks Uncategorized as needing review, and nothing else", async () => {
    mockFetch.mockResolvedValue(ok([cat("Uncategorized", 3_000, 2), cat("Food", 1_000)]));
    await render(<Categories />);

    expect(await screen.findByText("Needs review")).toBeTruthy();
    expect(screen.getAllByText("Needs review")).toHaveLength(1);
  });

  it("opens the Transactions list filtered to the tapped category", async () => {
    mockFetch.mockResolvedValue(ok([cat("Food", 52_000, 12)]));
    await render(<Categories />);

    await fireEvent.press(await screen.findByLabelText(/^Food, 52,000 RWF, 12 transactions/));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/transactions", params: { category: "Food" } });
  });

  it("describes each row's share for a screen reader", async () => {
    mockFetch.mockResolvedValue(ok([cat("Food", 750), cat("Transport", 250)]));
    await render(<Categories />);
    expect(await screen.findByLabelText("Food, 750 RWF, 1 transaction. 75% of spending")).toBeTruthy();
  });

  it("warns, rather than presenting partial totals as whole, when the history was cut off", async () => {
    mockFetch.mockResolvedValue(ok([cat("Food", 52_000)], true));
    await render(<Categories />);
    expect(await screen.findByText(/don't include all of it/)).toBeTruthy();
  });

  it("shows no warning for a complete history", async () => {
    mockFetch.mockResolvedValue(ok([cat("Food", 52_000)]));
    await render(<Categories />);
    await screen.findByText("Food");
    expect(screen.queryByText(/don't include all of it/)).toBeNull();
  });

  it("says so when there is no spending yet", async () => {
    mockFetch.mockResolvedValue(ok([]));
    await render(<Categories />);
    expect(await screen.findByText("No spending yet")).toBeTruthy();
  });

  it("offers a retry when loading fails, and none when the feature isn't available", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "error", message: "Couldn't load your categories." });
    await render(<Categories />);
    expect(await screen.findByText("Couldn't load your categories.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("has no retry when the endpoint isn't available yet", async () => {
    mockFetch.mockResolvedValue({ ok: false, reason: "unavailable", message: "Your categories isn't available yet." });
    await render(<Categories />);
    expect(await screen.findByText("Your categories isn't available yet.")).toBeTruthy();
    expect(screen.queryByText("Try again")).toBeNull();
  });
});
