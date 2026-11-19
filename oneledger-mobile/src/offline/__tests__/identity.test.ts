import { createUserTransport } from "../transport";
import type { OutboxOp } from "../outbox";
const mockSession = jest.fn();
const mockRpc = jest.fn();
const mockCreate = jest.fn();
jest.mock("@/api/supabase", () => ({ supabase: { auth: { getSession: () => mockSession() } } }));
jest.mock("@supabase/supabase-js", () => ({ createClient: (...args: unknown[]) => mockCreate(...args) }));
const op = { op_id: "op-a", op_type: "create_manual_transaction", payload: JSON.stringify({ transaction_id: "tx-a", p_account_id: "account-a", p_amount_minor: 1234 }) } as OutboxOp;
beforeEach(() => {
  mockCreate.mockClear(); mockRpc.mockReset();
  mockCreate.mockReturnValue({ rpc: (...args: unknown[]) => mockRpc(...args) });
  mockRpc.mockResolvedValue({ data: { status: "applied" }, error: null });
});
it("does not submit Alice's queue with Bob's credentials", async () => {
  mockSession.mockResolvedValue({ data: { session: { user: { id: "bob" }, access_token: "bob-fixture" } } });
  await expect(createUserTransport("alice").applyOp(op)).rejects.toMatchObject({ kind: "auth", code: "session_changed" });
  expect(mockRpc).not.toHaveBeenCalled();
});
it("freezes the originating bearer rather than using a mutable singleton", async () => {
  mockSession.mockResolvedValue({ data: { session: { user: { id: "alice" }, access_token: "alice-fixture" } } });
  await createUserTransport("alice").applyOp(op);
  expect(mockCreate).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ global: { headers: { Authorization: "Bearer alice-fixture" } } }));
});
