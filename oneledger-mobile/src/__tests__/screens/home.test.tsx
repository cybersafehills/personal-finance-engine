import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
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
describe("live Home", () => {
  it("uses real wallet, profile and analytics values instead of sample figures",async()=>{
    await renderHome();
    expect(await screen.findByText("VP")).toBeTruthy();
    expect((await screen.findAllByText("Real MoMo wallet")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("RWF 14,416").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/2,485,750/)).toBeNull();
    expect(screen.getAllByText("RWF 120K").length).toBeGreaterThan(0);
    expect(screen.getByText("Income")).toBeTruthy();
    expect(screen.getByText("Expenses")).toBeTruthy();
  });
  it("shows only three recent entries and scopes the read to the active Space",async()=>{
    await renderHome(); await screen.findByText("Live merchant 1");
    expect(mockRecent).toHaveBeenCalledWith({limit:3,workspaceId:"w1"});
    expect(screen.getByText("Live merchant 3")).toBeTruthy();
    expect(screen.queryByText("Live merchant 4")).toBeNull();
  });
  it("opens the add form, wallets and the unfiltered Transactions tab",async()=>{
    await renderHome(); await screen.findAllByText("Real MoMo wallet");
    await fireEvent.press(screen.getByRole("button",{name:"Add transaction to Real MoMo wallet"}));
    expect(router.push).toHaveBeenLastCalledWith({pathname:"/add-transaction",params:{accountId:"a"}});
    await fireEvent.press(screen.getByRole("button",{name:"View Real MoMo wallet"}));
    expect(router.push).toHaveBeenLastCalledWith({pathname:"/wallet/[id]",params:{id:"a"}});
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
    expect(screen.queryByText(/of income retained/)).toBeNull();
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
    expect(screen.queryByText(/Partial balance/)).toBeNull();
    await fireEvent.press(screen.getByRole("button",{name:"Next wallet"}));
    expect(screen.getByText("Not available")).toBeTruthy();
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
    expect(mockStoreGet).toHaveBeenCalledWith("ol.home.wallet.v1.u1.w2");
  });
});


describe("compact Home navigation and sections", () => {
  it("starts analysis cards pinned and expanded and saves an unpin choice", async () => {
    await renderHome();await screen.findAllByText("Real MoMo wallet");
    expect(screen.getByRole("button",{name:"Cash flow trends"}).props.accessibilityState.expanded).toBe(true);
    expect(screen.getByRole("button",{name:"Spending breakdown"}).props.accessibilityState.expanded).toBe(true);
    expect(screen.getByText("Total spent")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button",{name:"Unpin Cash flow trends"}));
    expect(screen.getByRole("button",{name:"Cash flow trends"}).props.accessibilityState.expanded).toBe(false);
    expect(mockStoreSet).toHaveBeenCalledWith("ol.home.pin.v1.u1.w1.trends","false");
    expect(screen.getByRole("button",{name:"Spending breakdown"}).props.accessibilityState.expanded).toBe(true);
    await fireEvent.press(screen.getByRole("button",{name:"Pin Cash flow trends"}));
    expect(screen.getByRole("button",{name:"Cash flow trends"}).props.accessibilityState.expanded).toBe(true);
  });
  it("sizes the gradient to the entire native balance card", async () => {
    await renderHome(); await screen.findAllByText("Real MoMo wallet");
    await fireEvent(screen.getByTestId("balance-card"),"layout",{nativeEvent:{layout:{width:358,height:190}}});
    expect(screen.getByTestId("balance-card-background").props.width).toBe(358);
    expect(screen.getByTestId("balance-card-background").props.height).toBe(190);
  });
  it("opens the selected wallet detail and shows today's activity", async () => {
    await renderHome(); await screen.findAllByText("Real MoMo wallet");
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


describe("individual wallet landing cards", () => {
 const bank={...wallet,id:"bank",name:"Equity Bank",provider:"bank",isPrimary:false,balance:{...wallet.balance,amountMinor:32900n}};
 it("swipes between separate wallet amounts and never combines them",async()=>{
  mockWallets.mockResolvedValue({ok:true,workspaceId:"w1",wallets:[wallet,bank]});
  await renderHome();await screen.findByRole("button",{name:"Next wallet"});
  expect(screen.getByRole("button",{name:"Next wallet"}).props.accessibilityValue.text).toBe("1 of 2: Real MoMo wallet");
  expect(screen.queryByText("RWF 47,316")).toBeNull();
  expect(screen.queryByText(/2 wallets/)).toBeNull();
  const pager=screen.getByTestId("wallet-carousel");
  await fireEvent(pager,"momentumScrollEnd",{nativeEvent:{contentOffset:{x:pager.props.contentOffset.x+358,y:0}}});
  expect(screen.getByRole("button",{name:"Next wallet"}).props.accessibilityValue.text).toBe("2 of 2: Equity Bank");
  expect(screen.getByRole("button",{name:"View Equity Bank"})).toBeTruthy();
 });
 it("saves a chosen landing wallet and restores it at the front on next launch",async()=>{
  mockWallets.mockResolvedValue({ok:true,workspaceId:"w1",wallets:[wallet,bank]});
  const view=await renderHome();await screen.findByRole("button",{name:"Next wallet"});
  await fireEvent.press(screen.getByRole("button",{name:"Next wallet"}));
  await fireEvent.press(screen.getByRole("button",{name:"Use Equity Bank on launch"}));
  await waitFor(()=>expect(mockStoreSet).toHaveBeenCalledWith("ol.home.wallet.v1.u1.w1","bank"));
  await screen.findByRole("button",{name:"Equity Bank is the default landing wallet"});
  await view.unmount();mockStoreGet.mockResolvedValue("bank");
  await renderHome();await screen.findByRole("button",{name:"Equity Bank is the default landing wallet"});
  expect(screen.getByTestId("wallet-carousel").props.contentOffset.x).toBe(0);
  expect(screen.getByRole("button",{name:"View Equity Bank"})).toBeTruthy();
 });
 it("keeps the previous default when saving the new preference fails",async()=>{
  mockStoreSet.mockRejectedValue(new Error("storage unavailable"));
  mockWallets.mockResolvedValue({ok:true,workspaceId:"w1",wallets:[wallet,bank]});
  await renderHome();await screen.findByRole("button",{name:"Next wallet"});
  await fireEvent.press(screen.getByRole("button",{name:"Next wallet"}));
  await fireEvent.press(screen.getByRole("button",{name:"Use Equity Bank on launch"}));
  expect(await screen.findByText("Couldn’t save your default wallet. Try again.")).toBeTruthy();
  expect(screen.getByRole("button",{name:"Use Equity Bank on launch"})).toBeTruthy();
 });
});


it("falls back to an available wallet when the saved landing wallet was removed",async()=>{
 mockStoreGet.mockResolvedValue("removed-wallet");
 await renderHome();await screen.findByRole("button",{name:"Real MoMo wallet is the default landing wallet"});
 expect(screen.getByRole("button",{name:"View Real MoMo wallet"})).toBeTruthy();
 expect(screen.queryByText("removed-wallet")).toBeNull();
});


it("opens the Space picker from the compact top row",async()=>{
 mockSpace.spaces=[{id:"w1",name:"Personal",kind:"personal"},{id:"w2",name:"Household",kind:"household"}];
 await renderHome();await screen.findAllByText("Real MoMo wallet");
 await fireEvent.press(within(screen.getByTestId("home-header")).getByRole("button",{name:"Change Space, Personal"}));
 await fireEvent.press(await screen.findByText("Household"));expect(mockSpace.setActive).toHaveBeenCalledWith("w2");
});
it("removes the banner and opens a fresh focused search",async()=>{
 await renderHome();await screen.findAllByText("Real MoMo wallet");
 expect(screen.queryByText("OneLedger")).toBeNull();expect(screen.queryByText("Money overview")).toBeNull();
 expect(screen.queryByText(/Good morning|Good afternoon|Good evening/)).toBeNull();
 await fireEvent.press(screen.getByRole("button",{name:"Search transactions"}));
 expect(router.navigate).toHaveBeenLastCalledWith(expect.objectContaining({pathname:"/transactions",params:expect.objectContaining({focusSearch:expect.any(String),reset:expect.any(String),accountId:"",category:"",period:"all"})}));
});

it("restores real month-to-date comparisons and retention without sample percentages",async()=>{
 await renderHome();
 expect(await screen.findByText("+20.0% vs last month")).toBeTruthy();
 expect(screen.getByText("75% of income retained this month")).toBeTruthy();
 expect(screen.queryByText(/8.4%/)).toBeNull();
});
it("does not invent trends when the previous period is unavailable or zero",async()=>{
 mockInsights.mockImplementation((p:{from:string,to:string})=>({ok:true,workspaceId:"w1",overview:{from:p.from,to:p.to,latestTxnAt:null,skippedCurrencies:0,currencies:[block(p.from===homePeriods(new Date()).previousFrom?0n:120000n,p.from===homePeriods(new Date()).previousFrom?0n:30000n)]}}));
 await renderHome();
 expect((await screen.findAllByText("No comparison yet")).length).toBe(2);
 expect(screen.queryByText(/Infinity|NaN/)).toBeNull();
 expect(screen.getByText("75% of income retained this month")).toBeTruthy();
});

it("keeps current trends visible when the prior-period API fails",async()=>{
 mockInsights.mockImplementation((p:{from:string,to:string})=>p.from===homePeriods(new Date()).previousFrom ? {ok:false,reason:"error",message:"Prior period unavailable"} : {ok:true,workspaceId:"w1",overview:{currencies:[block(120000n,30000n)]}});
 await renderHome();expect(await screen.findByText("75% of income retained this month")).toBeTruthy();
 expect(screen.getAllByText("No comparison yet")).toHaveLength(2);
});
it("does not report positive retention when spending exceeds income",async()=>{
 mockInsights.mockResolvedValue({ok:true,workspaceId:"w1",overview:{currencies:[block(100n,125n)]}});
 await renderHome();expect(await screen.findByText("Expenses exceed income by RWF 25")).toBeTruthy();
 expect(screen.queryByText(/% of income retained/)).toBeNull();
});

it("applies an inclusive custom trend range to the API instead of slicing six months",async()=>{
 await renderHome();await screen.findAllByText("Real MoMo wallet");
 await fireEvent.press(screen.getByRole("button",{name:"Choose trend date range"}));
 await fireEvent.changeText(screen.getByLabelText("From date"),"2026-10-01");
 await fireEvent.changeText(screen.getByLabelText("To date"),"2026-11-15");
 await fireEvent.press(screen.getByText("Apply dates"));
 await waitFor(()=>expect(mockInsights).toHaveBeenCalledWith(expect.objectContaining({from:"2026-09-30T22:00:00.000Z",to:"2026-11-15T22:00:00.000Z",granularity:"week"})));
});

 it("keeps the Home toolbar outside scrolling content and its actions accessible",async()=>{
  await renderHome();await screen.findByText("Live merchant 1");
  const toolbar=within(screen.getByTestId("home-fixed-toolbar"));
  const content=within(screen.getByTestId("home-content-scroll"));
  expect(content.queryByTestId("home-header")).toBeNull();
  await fireEvent(screen.getByTestId("home-content-scroll"),"scroll",{nativeEvent:{contentOffset:{y:650}}});
  expect(toolbar.getByRole("button",{name:/Change Space/})).toBeTruthy();
  expect(toolbar.getByRole("button",{name:/Notifications/})).toBeTruthy();
  await fireEvent.press(toolbar.getByRole("button",{name:"Search transactions"}));
  expect(router.navigate).toHaveBeenLastCalledWith(expect.objectContaining({pathname:"/transactions",params:expect.objectContaining({focusSearch:expect.any(String)})}));
 });

it("omits balance status and empty comparison messages from the Home hero",async()=>{
 await renderHome();await screen.findAllByText("Real MoMo wallet");
 const hero=within(screen.getByTestId("balance-card"));
 expect(hero.queryByText("Confirmed")).toBeNull();
 expect(hero.queryByText(/No comparable balance|Loading balance trend|Balance comparison unavailable|Balance trend unavailable/)).toBeNull();
});

it("shows recent activity and loaded wallets while fallback balance is still pending", async () => {
  mockBalance.mockReturnValue(new Promise(() => {}));
  await renderHome();
  expect(await screen.findByText("Live merchant 1")).toBeTruthy();
  expect((await screen.findAllByText("Real MoMo wallet")).length).toBeGreaterThan(0);
  expect(screen.getAllByText("RWF 14,416").length).toBeGreaterThan(0);
});
