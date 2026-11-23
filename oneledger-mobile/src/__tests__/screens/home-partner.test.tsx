import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { PartnerPreviewProvider, usePartnerPreview } from "@/features/partners/PartnerPreviewProvider";
import { Button } from "@/components/ds";
import Home from "@/app/(app)/(tabs)/index";
import { PrivacyProvider } from "@/features/privacy/PrivacyProvider";
import type { CurrencyOverview } from "@/features/insights/types";
import { homePeriods } from "@/features/home/live-data";
import { router, resetRouterMock } from "@/test/router-mock";

const mockWallets = jest.fn(), mockInsights = jest.fn(), mockRecent = jest.fn(), mockBalance = jest.fn(), mockBudget = jest.fn();
const mockStoreGet=jest.fn(),mockStoreSet=jest.fn();
jest.mock("@/lib/device-store",()=>({deviceStore:{get:(key:string)=>mockStoreGet(key),set:(key:string,value:string)=>mockStoreSet(key,value)}}));
const mockSpace = { activeId: "w1", active: { id: "w1", name: "Personal", kind: "personal" }, spaces: [] as {id:string;name:string;kind:string}[], setActive: jest.fn() };
jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({ useActiveSpace: () => mockSpace }));
jest.mock("@/features/auth/SessionProvider", () => ({ useSession: () => ({ session: { user: { id: "u1", user_metadata: { full_name: "Fallback Name" } } } }) }));
jest.mock("@/api/mobile-api", () => ({ fetchWallets: () => mockWallets(), fetchBudgets: () => mockBudget(), fetchInsights: (p: unknown) => mockInsights(p) }));
jest.mock("@/features/home/live-data", () => ({ ...jest.requireActual("@/features/home/live-data"), profileName: async () => "Verified Person" }));
jest.mock("@/features/transactions/queries", () => ({ getCurrentBalance: () => mockBalance(), getTransactions: (p: unknown) => mockRecent(p) }));
jest.mock("@/features/notifications/queries", () => ({ getUnreadNotificationCount: async () => 2 }));
const wallet = { id: "a", name: "Real MoMo wallet", provider: "mtn_momo", currency: "RWF", isPrimary: true, latestTxnAt: null, balance: { status: "confirmed", amountMinor: 14416n, asOf: "2026-11-19T06:47:00Z", basis: "provider_reported", reasons: [] } };
const txn = (id: string) => ({ id, transaction_type: "merchant_payment", direction: "out", status: "success", settlement_state: "settled", currency: "RWF", amount_rwf: 1000, fee_rwf: 0, counterparty_name: "Live merchant " + id, occurred_at: "2026-11-19T06:47:00Z", category: "Food", category_decision_status: "confirmed" });
const block = (income: bigint, expense: bigint): CurrencyOverview => ({
  currency: "RWF", moneyInMinor: income, moneyOutMinor: expense, netMinor: income-expense,
  cashOutMinor: 0n, countIn: 2, countOut: 3, transfersExcluded: {amountMinor: 200n,count: 1}, pending: {amountMinor: 0n,count: 0},
  byCategory: [{ category: "Food", amountMinor: expense, count: 3, percentBps: 10000, drilldown: {} as never }], topPeople: [], compare: null, drilldowns: {} as never,
  trend: [{ bucketStart: new Date().toISOString().slice(0,7)+"-01", moneyInMinor: income, moneyOutMinor: expense, netMinor: income-expense }],
});
beforeEach(() => {
  resetRouterMock(); mockSpace.activeId="w1"; mockSpace.spaces=[];mockSpace.setActive.mockClear();
  mockStoreGet.mockReset().mockResolvedValue(null);mockStoreSet.mockReset().mockResolvedValue(undefined);
  [mockWallets,mockInsights,mockRecent,mockBalance].forEach(m=>m.mockReset());
  mockWallets.mockResolvedValue({ok:true,workspaceId:"w1",wallets:[wallet]});
  mockBalance.mockResolvedValue(null);
  mockBudget.mockResolvedValue({ok:true,budgets:[]});
  mockRecent.mockResolvedValue([txn("1"),txn("2"),txn("3"),txn("4")]);
  mockInsights.mockImplementation((p:{from:string,to:string}) => ({ok:true,workspaceId:"w1",overview:{from:p.from,to:p.to,latestTxnAt:null,skippedCurrencies:0,currencies:[block(p.from===homePeriods(new Date()).previousFrom?100000n:120000n,30000n)]}}));
});
const renderHome=()=>render(<PrivacyProvider><Home /></PrivacyProvider>);

function Start(){ const p=usePartnerPreview(); return <Button label="start preview" onPress={p.start}/>; }
const renderWith=()=>render(<PartnerPreviewProvider><Start/><PrivacyProvider><Home /></PrivacyProvider></PartnerPreviewProvider>);
it("shows the sponsored banner above Recent transactions once preview is on",async()=>{
  await renderWith(); await screen.findByText("Live merchant 1");
  await fireEvent.press(screen.getByRole("button",{name:"start preview"}));
  expect(screen.queryByTestId("partner-home-placement")).toBeTruthy();
});
