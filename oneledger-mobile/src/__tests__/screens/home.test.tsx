import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import Home from "@/app/(app)/(tabs)/index";
import { PrivacyProvider } from "@/features/privacy/PrivacyProvider";
import type { CurrencyOverview } from "@/features/insights/types";
import { homePeriods } from "@/features/home/live-data";
import { router, resetRouterMock } from "@/test/router-mock";

const mockWallets = jest.fn(), mockInsights = jest.fn(), mockRecent = jest.fn(), mockBalance = jest.fn(), mockBudget = jest.fn();
const mockSpace = { activeId: "w1", active: { id: "w1", name: "Personal", kind: "personal" }, spaces: [], setActive: jest.fn() };
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
  resetRouterMock(); mockSpace.activeId="w1";
  [mockWallets,mockInsights,mockRecent,mockBalance].forEach(m=>m.mockReset());
  mockWallets.mockResolvedValue({ok:true,workspaceId:"w1",wallets:[wallet]});
  mockBalance.mockResolvedValue(null);
  mockBudget.mockResolvedValue({ok:true,budgets:[]});
  mockRecent.mockResolvedValue([txn("1"),txn("2"),txn("3"),txn("4")]);
  mockInsights.mockImplementation((p:{from:string,to:string}) => ({ok:true,workspaceId:"w1",overview:{from:p.from,to:p.to,latestTxnAt:null,skippedCurrencies:0,currencies:[block(p.from===homePeriods(new Date()).previousFrom?100000n:120000n,30000n)]}}));
});
const renderHome=()=>render(<PrivacyProvider><Home /></PrivacyProvider>);
describe("live Home", () => {
  it("uses real wallet, profile and analytics values instead of sample figures",async()=>{
    await renderHome();
    expect(await screen.findByText(/Verified/)).toBeTruthy();
    expect(await screen.findByText("Real MoMo wallet")).toBeTruthy();
    expect(screen.getAllByText("RWF 14,416").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/2,485,750/)).toBeNull();
    expect(screen.getAllByText("RWF 120K").length).toBeGreaterThan(0);
    expect(screen.getByText("75% of income retained this month")).toBeTruthy();
  });
  it("shows only three recent entries and scopes the read to the active Space",async()=>{
    await renderHome(); await screen.findByText("Live merchant 1");
    expect(mockRecent).toHaveBeenCalledWith({limit:3,workspaceId:"w1"});
    expect(screen.getByText("Live merchant 3")).toBeTruthy();
    expect(screen.queryByText("Live merchant 4")).toBeNull();
  });
  it("opens the add form, wallets and the unfiltered Transactions tab",async()=>{
    await renderHome(); await screen.findByText("Real MoMo wallet");
    await fireEvent.press(screen.getByRole("button",{name:"Add transaction"}));
    expect(router.push).toHaveBeenLastCalledWith("/add-transaction");
    await fireEvent.press(screen.getByRole("button",{name:"View wallets"}));
    expect(router.push).toHaveBeenLastCalledWith("/wallets");
    await fireEvent.press(screen.getByRole("button",{name:"View all"}));
    expect(router.navigate).toHaveBeenCalledWith(expect.objectContaining({pathname:"/transactions",params:expect.objectContaining({category:"",period:"all"})}));
  });
  it("masks balances, recent entries, summaries and chart values",async()=>{
    await renderHome(); await screen.findAllByText("RWF 120K");
    await fireEvent.press(screen.getByRole("button",{name:"Hide balances"}));
    expect(screen.queryByText("RWF 14,416")).toBeNull();
    expect(screen.queryByText("RWF 120K")).toBeNull();
    expect(screen.queryByText("−RWF 1,000")).toBeNull();
    expect(screen.getByRole("button",{name:"Show balances"})).toBeTruthy();
    expect(screen.getAllByText("Amounts hidden").length).toBeGreaterThan(0);
  });
  it("keeps recent transactions working when the fallback snapshot fails",async()=>{
    mockBalance.mockRejectedValue(new Error("balance unavailable"));
    await renderHome();
    expect(await screen.findByText("Live merchant 1")).toBeTruthy();
  });
  it("does not label incomplete balances as total available balance",async()=>{
    mockWallets.mockResolvedValue({ok:true,workspaceId:"w1",wallets:[wallet,{...wallet,id:"b",name:"Unknown bank",balance:{...wallet.balance,status:"unavailable",amountMinor:null,asOf:null}}]});
    await renderHome(); await screen.findByText("Unknown bank");
    expect(screen.queryByText(/Total available balance/)).toBeNull();
    expect(screen.getByText(/Partial balance/)).toBeTruthy();
  });
  it("does not substitute zeroes or sample charts when analytics are unavailable",async()=>{
    mockInsights.mockResolvedValue({ok:false,reason:"unavailable",message:"Insights is unavailable for this Space."});
    await renderHome();
    expect((await screen.findAllByText("Insights is unavailable for this Space.")).length).toBeGreaterThan(0);
    expect(screen.queryByText("RWF 120K")).toBeNull();
    expect(screen.queryByText(/8.4%/)).toBeNull();
  });
  it("hides the previous Space's data while the new Space is loading",async()=>{
    const view=await renderHome(); await screen.findByText("Live merchant 1");
    let resolveRecent:(v:unknown)=>void=()=>{}, resolveWallets:(v:unknown)=>void=()=>{};
    mockRecent.mockImplementation(()=>new Promise(resolve=>{resolveRecent=resolve;}));
    mockWallets.mockImplementation(()=>new Promise(resolve=>{resolveWallets=resolve;}));
    mockSpace.activeId="w2";
    await view.rerender(<PrivacyProvider><Home /></PrivacyProvider>);
    expect(screen.queryByText("Live merchant 1")).toBeNull();
    expect(screen.queryByText("Real MoMo wallet")).toBeNull();
    resolveRecent([]);resolveWallets({ok:true,workspaceId:"w2",wallets:[]});
    await waitFor(()=>expect(mockRecent).toHaveBeenLastCalledWith({limit:3,workspaceId:"w2"}));
  });
});


describe("compact Home navigation and sections", () => {
  it("starts charts collapsed and opens each section independently", async () => {
    await renderHome(); await screen.findByText("Real MoMo wallet");
    const trend=screen.getByRole("button",{name:"Cash flow trends"});
    expect(trend.props.accessibilityState).toEqual({expanded:false});
    expect(screen.queryByText("Last 6 months ⌄")).toBeNull();
    const spending=screen.getByRole("button",{name:"Spending breakdown"});
    expect(spending.props.accessibilityState).toEqual({expanded:false});
    await fireEvent.press(trend);
    expect(screen.getByText("Last 6 months ⌄")).toBeTruthy();
    expect(spending.props.accessibilityState).toEqual({expanded:false});
    await fireEvent.press(spending);
    expect(screen.getByText("Total spent")).toBeTruthy();
    await fireEvent.press(trend);
    expect(screen.queryByText("Last 6 months ⌄")).toBeNull();
  });
  it("sizes the gradient to the entire native balance card", async () => {
    await renderHome(); await screen.findByText("Real MoMo wallet");
    await fireEvent(screen.getByTestId("balance-card"),"layout",{nativeEvent:{layout:{width:358,height:190}}});
    expect(screen.getByTestId("balance-card-background").props.width).toBe(358);
    expect(screen.getByTestId("balance-card-background").props.height).toBe(190);
  });
  it("opens the selected wallet detail and shows today's activity", async () => {
    await renderHome(); await screen.findByText("Real MoMo wallet");
    expect(screen.getByText("Received today")).toBeTruthy();
    expect(screen.getByText("Spent today")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button",{name:"Open Real MoMo wallet"}));
    expect(router.push).toHaveBeenLastCalledWith({pathname:"/wallet/[id]",params:{id:"a"}});
  });
  it("uses the active currency's current budget and its server projection", async () => {
    const day=new Date().toISOString().slice(0,7);
    const b={id:"budget",name:"Live budget",currency:"RWF",periodStart:day+"-01",periodEnd:day+"-31",allocations:[{type:"needs",label:"Needs",targetMinor:100000,actualMinor:25000,remainingMinor:75000,percentConsumed:25,projectedMinor:50000,status:"healthy"}],uncategorizedCount:0,unmappedCount:0};
    mockBudget.mockResolvedValue({ok:true,budgets:[{...b,id:"usd",currency:"USD",name:"Other currency"},b]});
    await renderHome(); await screen.findByText(/Live budget/);
    expect(screen.getByText("RWF 75K")).toBeTruthy();
    expect(screen.getByText("RWF 50K")).toBeTruthy();
    expect(screen.getByText("On track")).toBeTruthy();
    expect(screen.queryByText(/Other currency/)).toBeNull();
  });
});
