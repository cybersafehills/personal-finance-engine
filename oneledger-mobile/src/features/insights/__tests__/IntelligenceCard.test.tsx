import { fireEvent, render, screen } from "@testing-library/react-native";

import { resetRouterMock, router } from "@/test/router-mock";

import { IntelligenceCard } from "../IntelligenceCard";
import type { OutlookData } from "../useOutlookData";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));

const outlook: OutlookData = {
  failure: null,
  computedAt: "2026-11-24T08:00:00.000Z",
  wallet: {
    id: "w1", name: "MTN MoMo", balanceAsOf: "2026-11-19T06:47:00Z", opening: 14_416n, scheduledEnd: 14_416n, estimatedEnd: -354_464n,
    noIncomeEnd: -400_424n, estimatesIncome: true, low: { day: 30, amount: -400_424n }, basis: [], disclaimer: "x",
    points: [{ day: 0, label: "Today", scheduled: 14_416n, estimated: 14_416n }, { day: 30, label: "Day 30", scheduled: 14_416n, estimated: -354_464n }],
  },
  facts: {
    computedAt: "2026-11-24T08:00:00.000Z", defaultWalletId: "w1", summary: null,
    baseline: { thisMonth: 492_420n, usual: 576_535n, changePercent: -15, direction: "below", monthsCompared: 3, basis: [] },
    anomalies: [{ counterparty: "Kenia", category: null, amount: 13_750n, typical: 3_600n, timesTypical: 3.8, occurredAt: "2026-11-10T08:00:00Z" }], anomaliesTotal: 2,
    recurring: [{ counterparty: "A", category: null, typicalAmount: 2_100n, typicalDay: 13, monthsSeen: 2 }], recurringTotal: 1,
  },
};

beforeEach(() => resetRouterMock());

describe("Home outlook rows open the matching section, not the top of a generic page", () => {
  it.each([
    [/The next 30 days/, "outlook"],
    [/Spending this month/, "pace"],
    [/payments much bigger than usual/, "large"],
    [/payment that repeats every month/, "repeat"],
  ])("%s -> section %s", async (name, section) => {
    await render(<IntelligenceCard outlook={outlook} error={null} />);
    await fireEvent.press(screen.getByRole("button", { name }));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/forecast", params: { section } });
  });

  it("the verdict opens the outlook section and 'See all' opens the page from the top", async () => {
    await render(<IntelligenceCard outlook={outlook} error={null} />);
    await fireEvent.press(screen.getByRole("button", { name: /Your money may run out in about 2 days/ }));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/forecast", params: { section: "outlook" } });
    await fireEvent.press(screen.getByRole("button", { name: "See all" }));
    expect(router.push).toHaveBeenLastCalledWith("/forecast");
  });

  it("renders nothing when there is nothing to say", async () => {
    const { toJSON } = await render(<IntelligenceCard outlook={{ ...outlook, wallet: null, facts: null }} error={null} />);
    expect(toJSON()).toBeNull();
  });
});
