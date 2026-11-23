import { fireEvent, render, screen } from "@testing-library/react-native";

import { ForecastPanel } from "./ForecastPanel";
import { fetchForecast, parseForecast, type ForecastScope } from "./forecast";

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/supabase", () => ({ supabase: null }));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({ useActiveSpace: () => ({ activeId: "personal" }) }));
jest.mock("./forecast", () => ({ ...jest.requireActual("./forecast"), fetchForecast: jest.fn() }));

const scope: ForecastScope = { workspaceId: "personal", accountId: "wallet-a", days: 30 };
function payload(days: ForecastScope["days"] = 30) {
  return {
    ok: true, workspace_id: "personal", account_id: "wallet-a", horizon_days: days,
    computed_at: "2026-11-19T12:00:00Z",
    forecasts: [{
      wallet_id: "wallet-a", name: "Cash", currency: "RWF", balance_as_of: "2026-11-18T12:00:00Z",
      opening_minor: "1000", scheduled_end_minor: "800", estimated_end_minor: "-200",
      no_income_end_minor: "-300", estimates_income: true, low: { day: days, amount_minor: "-200" },
      basis: ["Observed spending"], disclaimer: "Estimate only.",
      points: [
        { day: 0, label: "Today", scheduled_minor: "1000", estimated_minor: "1000" },
        { day: days, label: `Day ${days}`, scheduled_minor: "800", estimated_minor: "-200" },
      ],
    }],
  };
}

beforeEach(() => jest.mocked(fetchForecast).mockReset());

it("rejects stale Space, account and horizon responses", () => {
  expect(parseForecast(200, payload(), scope)).toMatchObject({ ok: true, wallets: [{ estimatedEnd: -200n }] });
  expect(parseForecast(200, { ...payload(7) }, scope).ok).toBe(false);
  expect(parseForecast(200, { ...payload(), workspace_id: "shared" }, scope).ok).toBe(false);
  const response = payload();
  response.forecasts[0].wallet_id = "other";
  expect(parseForecast(200, response, scope).ok).toBe(false);
});

it("loads the selected wallet on demand and refreshes it when the horizon changes", async () => {
  jest.mocked(fetchForecast).mockImplementation(async (request) => parseForecast(200, payload(request.days), request));
  await render(<ForecastPanel workspaceId="personal" accountId="wallet-a" />);
  expect(fetchForecast).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByText("Show cash-flow forecast"));
  expect(await screen.findByText("Estimated closing balance: −RWF 200")).toBeTruthy();
  expect(fetchForecast).toHaveBeenCalledWith(scope);
  await fireEvent.press(screen.getByText("Next 7 days"));
  expect(await screen.findByText(/below zero around day 7/)).toBeTruthy();
  expect(fetchForecast).toHaveBeenLastCalledWith({ ...scope, days: 7 });
});
