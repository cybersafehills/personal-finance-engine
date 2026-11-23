import { addWallet, makeDefaultWallet, manageWallet } from "../actions";
import { selectWorkspace } from "@/features/spaces/selected-space";
const mockRpc = jest.fn();
jest.mock("@/api/supabase", () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
beforeEach(() => { mockRpc.mockReset(); selectWorkspace("space-a"); });
it("adds a supported wallet in the selected Space without inventing its balance", async () => {
  mockRpc.mockResolvedValue({ data: "account-a", error: null });
  expect(await addWallet({ name: " USD Bank ", provider: "bank", currency: "USD" })).toEqual({ ok: true, id: "account-a" });
  expect(mockRpc).toHaveBeenCalledWith("create_supported_wallet", { p_workspace_id: "space-a", p_name: "USD Bank", p_provider: "bank", p_currency: "USD" });
});
it("switches default through the atomic authorized RPC in the current Space", async () => {
  selectWorkspace("space-b"); mockRpc.mockResolvedValue({ error: null });
  expect(await makeDefaultWallet("account-b")).toEqual({ ok: true });
  expect(mockRpc).toHaveBeenCalledWith("set_default_wallet", { p_workspace_id: "space-b", p_account_id: "account-b" });
});
it("surfaces denied wallet changes as failures", async () => {
  mockRpc.mockResolvedValue({ error: { message: "mfa_required" } });
  expect(await makeDefaultWallet("hidden-account")).toMatchObject({ ok: false });
  expect(await addWallet({ name: "Bank", provider: "bank", currency: "EUR" })).toMatchObject({ ok: false });
});

it("archives in the current Space and reports that an MFA challenge is needed", async () => {
  mockRpc.mockResolvedValue({ error: { message: "mfa_required" } });
  expect(await manageWallet("wallet-a", { action: "archive" })).toMatchObject({
    ok: false,
    message: expect.stringContaining("two-step"),
  });
  expect(mockRpc).toHaveBeenCalledWith("manage_wallet", {
    p_workspace_id: "space-a",
    p_account_id: "wallet-a",
    p_action: "archive",
  });
});
