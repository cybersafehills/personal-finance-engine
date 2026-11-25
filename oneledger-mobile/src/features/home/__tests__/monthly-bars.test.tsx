import { fireEvent, render, screen } from "@testing-library/react-native";

import { PrivacyProvider } from "@/features/privacy/PrivacyProvider";

import { MonthlyBars } from "../MonthlyBars";

jest.mock("@/lib/device-store", () => ({ deviceStore: { get: async () => JSON.stringify({ hidden: true }), set: async () => {} } }));

const point = (month: string, moneyInMinor: bigint, moneyOutMinor: bigint) => ({ bucketStart: `2026-${month}-01`, moneyInMinor, moneyOutMinor, netMinor: moneyInMinor - moneyOutMinor });
const points = [point("10", 200000n, 150000n), point("11", 181520n, 492420n)];

describe("MonthlyBars", () => {
  it("starts on the running month and spells out whichever month is tapped", async () => {
    await render(<MonthlyBars points={points} currency="RWF" message="" />);
    expect(screen.getByText("Nov so far: money in RWF 181.52K, money out RWF 492.42K")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Oct:/ }));
    expect(screen.getByText("Oct: money in RWF 200K, money out RWF 150K")).toBeTruthy();
  });

  it("says why there is no chart instead of drawing zeros", async () => {
    await render(<MonthlyBars points={null} currency="RWF" message="The monthly chart is unavailable." />);
    expect(screen.getByText("The monthly chart is unavailable.")).toBeTruthy();
    expect(screen.queryByTestId("monthly-bars")).toBeNull();
  });

  it("says so when nothing was recorded", async () => {
    await render(<MonthlyBars points={[point("11", 0n, 0n)]} currency="RWF" message="" />);
    expect(screen.getByText("No money in or out recorded in these months.")).toBeTruthy();
  });

  it("draws nothing and speaks no figures while amounts are hidden", async () => {
    await render(<PrivacyProvider userId="u1"><MonthlyBars points={points} currency="RWF" message="" /></PrivacyProvider>);
    expect(await screen.findByText("Monthly chart hidden with amounts.")).toBeTruthy();
    expect(screen.queryByTestId("monthly-bars")).toBeNull();
    expect(screen.queryByLabelText(/RWF/)).toBeNull();
  });
});
