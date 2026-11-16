import { fireEvent, render, screen } from "@testing-library/react-native";

import TransactionDetail from "@/app/(app)/transaction/[id]";
import type { TransactionRow } from "@/features/transactions/queries";
import { resetRouterMock, router, setParams } from "@/test/router-mock";

const mockGetTransaction = jest.fn();
const mockOpenUrl = jest.fn();
const mockOffer = jest.fn();
const mockExtras = jest.fn();
const mockActive = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/features/transactions/queries", () => ({
  getTransactionById: (id: string) => mockGetTransaction(id),
}));
jest.mock("@/lib/config", () => ({ config: { apiBaseUrl: "https://app.example.test" } }));
jest.mock("@/features/transactions/detail", () => ({ loadDetailExtras: (id: string) => mockExtras(id) }));
jest.mock("@/features/spaces/ActiveSpaceProvider", () => ({
  useActiveSpace: () => {
    const active = mockActive();
    return { spaces: [], active, activeId: active?.id ?? null, setActive: () => {} };
  },
}));
jest.mock("@/features/transactions/tags", () => {
  const actual = jest.requireActual("@/features/transactions/tags");
  return { ...actual, addTag: jest.fn(), removeTag: jest.fn() };
});
jest.mock("@/features/pay/context", () => ({ loadPayAgainOffer: (t: unknown) => mockOffer(t) }));
jest.mock("expo-linking", () => ({ openURL: (url: string) => mockOpenUrl(url) }));

const txn = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  id: "t1",
  transaction_type: "merchant_payment",
  direction: "out",
  status: "success",
  currency: "RWF",
  amount_rwf: 4200,
  fee_rwf: 100,
  balance_after_rwf: 90000,
  counterparty_name: "Kigali Fresh",
  counterparty_reference: "REF-7",
  occurred_at: "2026-11-14T10:00:00Z",
  category: "Food",
  subcategory: null,
  category_decision_status: "confirmed",
  suggested_category: null,
  ...over,
});

const noExtras = { context: null, history: [], tags: [], tagSuggestions: [], duplicates: null, members: [], selfUserId: null };
const context = (over: Record<string, unknown> = {}) => ({
  workspaceId: "w1",
  workspaceName: "Personal",
  workspaceKind: "personal",
  sourceName: "MTN account",
  sourceProvider: "mtn_momo",
  sourceMaskedIdentifier: "•••• 4567",
  sourceOwnerUserId: "me",
  performedByUserId: "me",
  recordCreatedByUserId: "me",
  ingestionConnectionLabel: "My phone",
  allocationStatus: "allocated",
  categorySource: "rule",
  ...over,
});
const entry = (id: string, prev: string | null, next: string | null, actor = "user") => ({
  id,
  previous_category: prev,
  new_category: next,
  decision_reason: null,
  actor_type: actor,
  created_at: "2026-11-14T10:00:00Z",
});

beforeEach(() => {
  resetRouterMock();
  setParams({ id: "t1" });
  mockGetTransaction.mockReset();
  mockOpenUrl.mockReset();
  mockOffer.mockReset();
  mockOffer.mockResolvedValue(null); // no "Pay again" unless a test says so
  mockExtras.mockReset();
  mockExtras.mockResolvedValue(noExtras); // no extra blocks unless a test says so
  mockActive.mockReset();
  mockActive.mockReturnValue(null); // no active Space loaded: the server default (Personal)
});

describe("Transaction detail screen", () => {
  it("shows the transaction's details, never masked", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    await render(<TransactionDetail />);

    expect(await screen.findByText("Kigali Fresh")).toBeTruthy();
    expect(screen.getByText("−4,200 RWF")).toBeTruthy();
    expect(screen.getByText("Food")).toBeTruthy();
    expect(screen.getByText("REF-7")).toBeTruthy();
    expect(screen.getByText("90,000 RWF")).toBeTruthy();
  });

  it("opens the category picker to change the category", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    await render(<TransactionDetail />);

    await fireEvent.press(await screen.findByText("Change category"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/category/[id]", params: { id: "t1" } });
  });

  it("invites a first category for an uncategorised transaction", async () => {
    mockGetTransaction.mockResolvedValue(txn({ category: null }));
    await render(<TransactionDetail />);
    expect(await screen.findByText("Choose a category")).toBeTruthy();
    expect(screen.getByText("Uncategorized")).toBeTruthy();
  });

  it("shows a failed transaction as moving no money and offers no recategorising", async () => {
    mockGetTransaction.mockResolvedValue(txn({ status: "failed" }));
    await render(<TransactionDetail />);

    expect(await screen.findByText("Failed: no money moved")).toBeTruthy();
    expect(screen.queryByText("Change category")).toBeNull();
  });

  it("shows the pending suggestion for a transaction that needs review", async () => {
    mockGetTransaction.mockResolvedValue(
      txn({ category: null, category_decision_status: "suggested", suggested_category: "Transport" }),
    );
    await render(<TransactionDetail />);

    expect(await screen.findByText("Needs review")).toBeTruthy();
    expect(screen.getByText("Transport")).toBeTruthy();
  });

  it("opens the web page for deeper edits", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    await render(<TransactionDetail />);
    await fireEvent.press(await screen.findByText("Edit on the web"));
    expect(mockOpenUrl).toHaveBeenCalledWith("https://app.example.test/transactions/t1");
  });

  it("explains a transaction that is gone", async () => {
    mockGetTransaction.mockResolvedValue(null);
    await render(<TransactionDetail />);
    expect(await screen.findByText("This transaction isn't available")).toBeTruthy();
  });

  it("goes back", async () => {
    mockGetTransaction.mockResolvedValue(txn());
    await render(<TransactionDetail />);
    await fireEvent.press(await screen.findByText("Back"));
    expect(router.back).toHaveBeenCalled();
  });

  describe("Pay again", () => {
    const person = { type: "pay_person", msisdn: "250788123456", name: "Jean" } as const;

    it("offers it only when the offer says it can work, and passes only the transaction id", async () => {
      mockGetTransaction.mockResolvedValue(txn({ transaction_type: "send_money", counterparty_reference: "0788123456", counterparty_name: "Jean" }));
      mockOffer.mockResolvedValue({ target: person, account: { id: "acct-1", name: "MTN MoMo" } });
      await render(<TransactionDetail />);

      await fireEvent.press(await screen.findByText("Pay Jean again"));
      // Only the transaction id travels: the form rebuilds the recipient from it.
      expect(router.push).toHaveBeenCalledWith({ pathname: "/pay-again", params: { txn: "t1" } });
    });

    it("opens the same form for a business payment", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockOffer.mockResolvedValue({
        target: { type: "pay_merchant", merchantCode: "123456", name: null },
        account: { id: "acct-1", name: "MTN MoMo" },
      });
      await render(<TransactionDetail />);

      await fireEvent.press(await screen.findByText("Pay this recipient again"));
      expect(router.push).toHaveBeenCalledWith({ pathname: "/pay-again", params: { txn: "t1" } });
    });

    it("is absent when there is no offer (config off, shared Space, unsupported type...)", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockOffer.mockResolvedValue(null);
      await render(<TransactionDetail />);

      await screen.findByText("Change category");
      expect(screen.queryByText(/again$/)).toBeNull();
    });
  });

  describe("the blocks beyond the basics", () => {
    it("shows the date in the hero and the web's detail rows", async () => {
      mockGetTransaction.mockResolvedValue(txn({ fee_rwf: 0, balance_after_rwf: null, direction: "out" }));
      await render(<TransactionDetail />);

      expect(await screen.findByText("Money out")).toBeTruthy();
      expect(screen.getByText("Direction")).toBeTruthy();
      expect(screen.getByText("merchant payment")).toBeTruthy();
      expect(screen.queryByText("Fee")).toBeNull(); // no fee, no row
      expect(screen.queryByText("Balance after")).toBeNull();
    });

    it("shows where it came from", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({ ...noExtras, context: context() });
      await render(<TransactionDetail />);

      expect(await screen.findByText("WHERE THIS CAME FROM")).toBeTruthy();
      expect(screen.getByText("MTN MoMo · •••• 4567")).toBeTruthy();
      expect(screen.getByText("My phone")).toBeTruthy();
      expect(screen.getByText("Personal")).toBeTruthy();
    });

    it("names who paid in a household, with real names", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({
        context: context({ workspaceKind: "household", workspaceName: "Home", sourceOwnerUserId: "amy", performedByUserId: "amy" }),
        history: [],
        tags: [],
        members: [{ userId: "amy", displayName: "Amy" }],
        selfUserId: "me",
      });
      await render(<TransactionDetail />);

      expect(await screen.findByText("Paid by")).toBeTruthy();
      expect(screen.getByText("Amy")).toBeTruthy();
      expect(screen.getByText("MTN MoMo · •••• 4567 · Amy's account")).toBeTruthy();
    });

    it("warns when a household transaction needs an attribution, and points to the web", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({ ...noExtras, context: context({ workspaceKind: "household", allocationStatus: "needs_attribution" }) });
      await render(<TransactionDetail />);
      expect(await screen.findByText(/needs an attribution/)).toBeTruthy();
    });

    it("says nothing about attribution when everything is settled", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({ ...noExtras, context: context() });
      await render(<TransactionDetail />);
      await screen.findByText("WHERE THIS CAME FROM");
      expect(screen.queryByText(/needs an attribution/)).toBeNull();
    });

    it("explains why the category is what it is", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({ ...noExtras, context: context({ categorySource: "manual" }) });
      await render(<TransactionDetail />);
      expect(await screen.findByText("You corrected this category.")).toBeTruthy();
    });

    it("prefers the latest recorded reason", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({
        ...noExtras,
        context: context(),
        history: [{ ...entry("h2", "Food", "Transport"), decision_reason: "Matched your Bolt rule" }],
      });
      await render(<TransactionDetail />);
      expect(await screen.findByText("Matched your Bolt rule")).toBeTruthy();
    });

    // One render per test: unmounting and re-rendering inside a test leaks state
    // into the next one with this renderer.
    it("lists no category history for a single change", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({ ...noExtras, history: [entry("h1", null, "Food")] });
      await render(<TransactionDetail />);
      await screen.findByText("CATEGORY");
      expect(screen.queryByText("CATEGORY HISTORY")).toBeNull();
    });

    it("lists category history once there is more than one change", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({
        ...noExtras,
        history: [entry("h2", "Food", "Transport"), entry("h1", null, "Food", "rule")],
      });
      await render(<TransactionDetail />);
      expect(await screen.findByText("CATEGORY HISTORY")).toBeTruthy();
      expect(screen.getByText("Food → Transport")).toBeTruthy();
      expect(screen.getByText("Uncategorized → Food")).toBeTruthy();
    });

    it("shows tags as labels with an editor once the Space is known", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({ ...noExtras, context: context(), tags: ["work", "trip"] });
      await render(<TransactionDetail />);
      expect(await screen.findByText("TAGS")).toBeTruthy();
      expect(screen.getByText("work")).toBeTruthy();
      expect(screen.getByText("trip")).toBeTruthy();
      expect(screen.getByLabelText("Add a tag")).toBeTruthy();
    });

    it("shows read-only tags when the Space couldn't be read, with no editor", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({ ...noExtras, context: null, tags: ["work"] });
      await render(<TransactionDetail />);
      expect(await screen.findByText("work")).toBeTruthy();
      expect(screen.queryByLabelText("Add a tag")).toBeNull();
    });

    it("offers an empty editor when there are no tags yet", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({ ...noExtras, context: context() });
      await render(<TransactionDetail />);
      expect(await screen.findByText("No tags yet.")).toBeTruthy();
      expect(screen.getByLabelText("Add a tag")).toBeTruthy();
    });

    it("shows no tags card at all when there is nothing to show or edit", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue(noExtras);
      await render(<TransactionDetail />);
      await screen.findByText("CATEGORY");
      expect(screen.queryByText("TAGS")).toBeNull();
    });

    describe("duplicates", () => {
      const dup = (over: Record<string, unknown> = {}) => ({
        dedupeState: "unique",
        mergedInto: null,
        mergedDuplicates: [],
        ...over,
      });

      it("says nothing for an ordinary transaction", async () => {
        mockGetTransaction.mockResolvedValue(txn());
        mockExtras.mockResolvedValue({ ...noExtras, duplicates: dup() });
        await render(<TransactionDetail />);
        await screen.findByText("CATEGORY");
        expect(screen.queryByText("DUPLICATES")).toBeNull();
      });

      it("flags a possible duplicate and sends a personal transaction to the Inbox to resolve it", async () => {
        mockGetTransaction.mockResolvedValue(txn());
        mockExtras.mockResolvedValue({
          ...noExtras,
          context: context(),
          duplicates: dup({ dedupeState: "possible_duplicate" }),
        });
        await render(<TransactionDetail />);

        expect(await screen.findByText("This transaction is flagged as a possible duplicate.")).toBeTruthy();
        await fireEvent.press(screen.getByText("Review it"));
        expect(router.push).toHaveBeenCalledWith("/inbox");
      });

      it("sends a household transaction to the web's review queue, since the Inbox only covers the personal Space", async () => {
        mockGetTransaction.mockResolvedValue(txn());
        mockExtras.mockResolvedValue({
          ...noExtras,
          context: context({ workspaceKind: "household" }),
          duplicates: dup({ dedupeState: "possible_duplicate" }),
        });
        await render(<TransactionDetail />);

        await screen.findByText("This transaction is flagged as a possible duplicate.");
        expect(screen.queryByText("Review it")).toBeNull();
        await fireEvent.press(screen.getByText("Review on the web"));
        expect(mockOpenUrl).toHaveBeenCalledWith("https://app.example.test/transactions/review");
        expect(router.push).not.toHaveBeenCalledWith("/inbox");
      });

      it("also uses the web when the transaction's Space couldn't be read", async () => {
        mockGetTransaction.mockResolvedValue(txn());
        mockExtras.mockResolvedValue({ ...noExtras, context: null, duplicates: dup({ dedupeState: "possible_duplicate" }) });
        await render(<TransactionDetail />);
        expect(await screen.findByText("Review on the web")).toBeTruthy();
        expect(screen.queryByText("Review it")).toBeNull();
      });

      it("explains a merged-away transaction and opens the one that was kept", async () => {
        mockGetTransaction.mockResolvedValue(txn());
        mockExtras.mockResolvedValue({
          ...noExtras,
          duplicates: dup({
            dedupeState: "merged",
            mergedInto: { id: "keep-1", occurredAt: "2026-11-14T10:00:00Z", counterparty: "Kigali Fresh" },
          }),
        });
        await render(<TransactionDetail />);

        expect(await screen.findByText(/no longer counted/)).toBeTruthy();
        await fireEvent.press(screen.getByText("Open the kept transaction"));
        expect(router.push).toHaveBeenCalledWith({ pathname: "/transaction/[id]", params: { id: "keep-1" } });
      });

      it("lists what was merged into this one, each opening its own transaction", async () => {
        mockGetTransaction.mockResolvedValue(txn());
        mockExtras.mockResolvedValue({
          ...noExtras,
          duplicates: dup({
            mergedDuplicates: [
              { id: "d1", occurredAt: "2026-11-14T10:00:00Z", counterparty: "Kigali Fresh", source: "statement" },
              { id: "d2", occurredAt: "2026-11-14T10:05:00Z", counterparty: null, source: "manual" },
            ],
          }),
        });
        await render(<TransactionDetail />);

        expect(await screen.findByText(/2 duplicates were merged into this transaction/)).toBeTruthy();
        expect(screen.getByText("Imported statement · Nov 14, 12:00")).toBeTruthy();
        await fireEvent.press(screen.getByLabelText("Open Kigali Fresh"));
        expect(router.push).toHaveBeenCalledWith({ pathname: "/transaction/[id]", params: { id: "d1" } });
      });
    });

    it("still shows everything that loaded when the extras couldn't", async () => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockRejectedValue(new Error("offline"));
      await render(<TransactionDetail />);

      expect(await screen.findByText("Kigali Fresh")).toBeTruthy();
      expect(screen.getByText("Change category")).toBeTruthy();
      expect(screen.queryByText("WHERE THIS CAME FROM")).toBeNull();
    });
  });

  describe("'Review it' follows the active Space (the Inbox covers the Space the server is using)", () => {
    const flagged = { dedupeState: "possible_duplicate", mergedInto: null, mergedDuplicates: [] };
    const space = (id: string, kind: string) => ({ id, name: kind, kind, role: "owner" });
    const withContext = (over: Record<string, unknown>) => {
      mockGetTransaction.mockResolvedValue(txn());
      mockExtras.mockResolvedValue({ ...noExtras, context: context(over), duplicates: flagged });
    };

    it("opens the Inbox for a transaction in the active household", async () => {
      mockActive.mockReturnValue(space("H1", "household"));
      withContext({ workspaceId: "H1", workspaceKind: "household" });
      await render(<TransactionDetail />);
      await fireEvent.press(await screen.findByText("Review it"));
      expect(router.push).toHaveBeenCalledWith("/inbox");
    });

    it("sends a household transaction to the web while the personal Space is active", async () => {
      mockActive.mockReturnValue(space("p1", "personal"));
      withContext({ workspaceId: "H1", workspaceKind: "household" });
      await render(<TransactionDetail />);
      expect(await screen.findByText("Review on the web")).toBeTruthy();
      expect(screen.queryByText("Review it")).toBeNull();
    });

    it("sends a personal transaction to the web while a household is active", async () => {
      mockActive.mockReturnValue(space("H1", "household"));
      withContext({ workspaceId: "p1", workspaceKind: "personal" });
      await render(<TransactionDetail />);
      expect(await screen.findByText("Review on the web")).toBeTruthy();
      expect(screen.queryByText("Review it")).toBeNull();
    });

    it("sends a transaction in another household to the web", async () => {
      mockActive.mockReturnValue(space("H1", "household"));
      withContext({ workspaceId: "H2", workspaceKind: "household" });
      await render(<TransactionDetail />);
      expect(await screen.findByText("Review on the web")).toBeTruthy();
    });

    it("an unreadable Space is never taken for the personal one: it goes to the web", async () => {
      mockActive.mockReturnValue(null);
      withContext({ workspaceId: "p1", workspaceKind: null });
      await render(<TransactionDetail />);
      expect(await screen.findByText("Review on the web")).toBeTruthy();
      expect(screen.queryByText("Review it")).toBeNull();
    });

    it("with no Space loaded, a personal transaction still opens the Inbox (the server default)", async () => {
      mockActive.mockReturnValue(null);
      withContext({ workspaceId: "p1", workspaceKind: "personal" });
      await render(<TransactionDetail />);
      expect(await screen.findByText("Review it")).toBeTruthy();
    });
  });
});
