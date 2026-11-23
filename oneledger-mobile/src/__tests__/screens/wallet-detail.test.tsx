import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import WalletDetail from "@/app/(app)/wallet/[id]";
import { PrivacyProvider } from "@/features/privacy/PrivacyProvider";
import { resetRouterMock, router, setParams } from "@/test/router-mock";
const mockWallets=jest.fn(),mockTransactions=jest.fn(),mockInsights=jest.fn(),mockRecord=jest.fn();
jest.mock("expo-router",()=>jest.requireActual("@/test/router-mock"));
jest.mock("@/features/spaces/ActiveSpaceProvider",()=>({useActiveSpace:()=>({activeId:"space-1"})}));
jest.mock("@/api/mobile-api",()=>({fetchWallets:()=>mockWallets(),fetchInsights:(p:unknown)=>mockInsights(p)}));
jest.mock("@/features/transactions/queries",()=>({getTransactions:(p:unknown)=>mockTransactions(p)}));
jest.mock("@/features/wallets/record",()=>({recordBalance:(p:unknown)=>mockRecord(p)}));
const wallet={id:"wallet-1",name:"My MoMo",provider:"mtn_momo",currency:"RWF",isPrimary:true,latestTxnAt:"2026-11-19T06:47:00Z",balance:{status:"confirmed",amountMinor:14416n,asOf:"2026-11-19T06:47:00Z",basis:"provider_reported",reasons:[]}};
beforeEach(()=>{
 resetRouterMock();setParams({id:"wallet-1"});
 mockWallets.mockReset().mockResolvedValue({ok:true,workspaceId:"space-1",wallets:[wallet]});
 mockTransactions.mockReset().mockResolvedValue([{id:"txn-1",transaction_type:"merchant_payment",direction:"out",status:"success",settlement_state:"settled",currency:"RWF",amount_rwf:1000,fee_rwf:0,counterparty_name:"Wallet merchant",occurred_at:"2026-11-19T06:47:00Z",category:"Food",category_decision_status:"confirmed"}]);
 mockInsights.mockReset().mockResolvedValue({ok:true,workspaceId:"space-1",overview:{currencies:[]}});
 mockRecord.mockReset().mockResolvedValue({ok:true});
});
const show=()=>render(<PrivacyProvider><WalletDetail /></PrivacyProvider>);
it("loads only this wallet's ledger and scopes its monthly summary",async()=>{
 await show();await screen.findByText("Wallet merchant");
 expect(screen.getByText("RWF 14,416")).toBeTruthy();
 expect(mockTransactions).toHaveBeenCalledWith({workspaceId:"space-1",accountId:"wallet-1",limit:10});
 expect(mockInsights).toHaveBeenCalledWith(expect.objectContaining({accountIds:["wallet-1"]}));
 await fireEvent.press(screen.getByRole("button",{name:"View all"}));
 expect(router.navigate).toHaveBeenLastCalledWith(expect.objectContaining({pathname:"/transactions",params:expect.objectContaining({accountId:"wallet-1",walletName:"My MoMo",period:"all"})}));
 await fireEvent.press(screen.getByRole("button",{name:"Add transaction"}));
 expect(router.push).toHaveBeenLastCalledWith({pathname:"/add-transaction",params:{accountId:"wallet-1"}});
});
it("does not show a missing wallet or another Space's ledger",async()=>{
 mockWallets.mockResolvedValue({ok:true,workspaceId:"space-1",wallets:[]});
 await show();await screen.findByText("Wallet not found in this Space");
 expect(screen.queryByText("Wallet merchant")).toBeNull();
 expect(screen.queryByText("RWF 14,416")).toBeNull();
});
it("records a checked balance for the selected wallet and refreshes",async()=>{
 await show();await screen.findByText("RWF 14,416");
 await fireEvent.press(screen.getByText("I checked my balance"));
 await fireEvent.changeText(screen.getByLabelText("Your balance now (RWF)"),"15,000");
 await fireEvent.press(screen.getByText("Save my balance"));
 await waitFor(()=>expect(mockRecord).toHaveBeenCalledWith({accountId:"wallet-1",amountMinor:15000n}));
 expect(mockWallets.mock.calls.length).toBeGreaterThan(1);
});
it("shows a retry when wallet activity fails",async()=>{
 mockTransactions.mockRejectedValue(new Error("offline"));
 await show();expect(await screen.findByText("Retry activity")).toBeTruthy();
});
