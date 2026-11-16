import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import Inbox from "@/app/(app)/(tabs)/inbox";
import type { Inbox as InboxData, InboxItem } from "@/features/inbox/types";
import { ReviewActionError } from "@/features/review/actions";
import { resetRouterMock, router } from "@/test/router-mock";

const mockFetchInbox = jest.fn();
const mockConfirm = jest.fn();
const mockDismiss = jest.fn();
const mockOpenUrl = jest.fn();

jest.mock("expo-router", () => jest.requireActual("@/test/router-mock"));
jest.mock("@/api/mobile-api", () => ({ fetchInbox: () => mockFetchInbox() }));
jest.mock("@/lib/config", () => ({ config: { apiBaseUrl: "https://app.example.test" } }));
jest.mock("expo-linking", () => ({ openURL: (url: string) => mockOpenUrl(url) }));
jest.mock("@/features/review/ReviewList", () => ({
  ReviewList: ({ notice }: { notice?: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text>REVIEW FALLBACK: {notice}</Text>;
  },
}));
jest.mock("@/features/review/actions", () => {
  const actual = jest.requireActual("@/features/review/actions");
  return {
    ...actual,
    confirmCategory: (id: string) => mockConfirm(id),
    dismissSuggestion: (id: string) => mockDismiss(id),
    dismissDuplicate: jest.fn(),
    mergeDuplicate: jest.fn(),
  };
});

const TX = "11111111-2222-3333-4444-555555555555";

const categoryItem: InboxItem = {
  id: "cat-1",
  kind: "category_review",
  priority: "high",
  title: "Kigali Fresh",
  description: "Suggested category: Food",
  href: `/transactions/${TX}`,
  actionableSince: "2026-11-01T08:00:00Z",
  affectedCount: 1,
  actions: [
    { type: "confirm_category", label: "Use it", transactionId: TX },
    { type: "dismiss_category", label: "Dismiss", transactionId: TX },
  ],
};

const connectorItem: InboxItem = {
  id: "conn-1",
  kind: "connector_health",
  priority: "critical",
  title: "MTN connection failed",
  description: "Reconnect to keep recording.",
  href: "/integrations/connections",
  actionableSince: null,
  affectedCount: 1,
  actions: [],
};

const inbox = (items: InboxItem[]): { ok: true; inbox: InboxData } => ({
  ok: true,
  inbox: {
    items,
    total: items.length,
    criticalCount: items.filter((i) => i.priority === "critical").length,
    highCount: items.filter((i) => i.priority === "high").length,
  },
});

beforeEach(() => {
  resetRouterMock();
  [mockFetchInbox, mockConfirm, mockDismiss, mockOpenUrl].forEach((m) => m.mockReset());
});

describe("Inbox screen", () => {
  it("shows the summary and each item with its actions", async () => {
    mockFetchInbox.mockResolvedValue(inbox([connectorItem, categoryItem]));
    await render(<Inbox />);

    expect(await screen.findByText("Kigali Fresh")).toBeTruthy();
    expect(screen.getByText("MTN connection failed")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy(); // summary tile label
    // The summary tile and the critical item's badge both say it.
    expect(screen.getAllByText("Resolve first")).toHaveLength(2);
    expect(screen.getByText("Use it")).toBeTruthy();
    expect(screen.getByText("Pick another")).toBeTruthy();
  });

  it("makes a decision in place and removes the item", async () => {
    mockFetchInbox.mockResolvedValue(inbox([categoryItem]));
    mockConfirm.mockResolvedValue(undefined);
    await render(<Inbox />);

    await fireEvent.press(await screen.findByText("Use it"));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith(TX));
    await waitFor(() => expect(screen.queryByText("Kigali Fresh")).toBeNull());
  });

  it("keeps the item and says why when saving fails", async () => {
    mockFetchInbox.mockResolvedValue(inbox([categoryItem]));
    mockConfirm.mockRejectedValue(new ReviewActionError("You can't change this transaction."));
    await render(<Inbox />);

    await fireEvent.press(await screen.findByText("Use it"));

    expect(await screen.findByText("You can't change this transaction.")).toBeTruthy();
    expect(screen.getByText("Kigali Fresh")).toBeTruthy();
  });

  it("opens the category picker for a category item", async () => {
    mockFetchInbox.mockResolvedValue(inbox([categoryItem]));
    await render(<Inbox />);

    await fireEvent.press(await screen.findByText("Pick another"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/category/[id]", params: { id: TX } });
  });

  it("opens an item the app cannot act on in the web app", async () => {
    mockFetchInbox.mockResolvedValue(inbox([connectorItem]));
    await render(<Inbox />);

    await fireEvent.press(await screen.findByText("Open on the web"));
    expect(mockOpenUrl).toHaveBeenCalledWith("https://app.example.test/integrations/connections");
  });

  it("falls back to the direct review queue when the endpoint is unavailable", async () => {
    mockFetchInbox.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "The full inbox isn't available yet.",
    });
    await render(<Inbox />);
    expect(await screen.findByText(/REVIEW FALLBACK/)).toBeTruthy();
  });

  it("falls back to category checks when the server errors, instead of a dead end", async () => {
    mockFetchInbox.mockResolvedValue({
      ok: false,
      reason: "error",
      message: "Couldn't load your inbox. Check your connection and try again.",
    });
    await render(<Inbox />);
    expect(await screen.findByText(/REVIEW FALLBACK: Category checks only/)).toBeTruthy();
  });

  it("keeps a sign-in problem as a message with a retry, not the fallback", async () => {
    mockFetchInbox.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
      message: "Please sign in again.",
    });
    await render(<Inbox />);
    expect(await screen.findByText("Please sign in again.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
    expect(screen.queryByText(/REVIEW FALLBACK/)).toBeNull();
  });

  it("groups by priority with the web's headings", async () => {
    mockFetchInbox.mockResolvedValue(inbox([connectorItem, categoryItem]));
    await render(<Inbox />);
    expect(await screen.findByText("Resolve first (1)")).toBeTruthy();
    expect(screen.getByText("Next up (1)")).toBeTruthy();
  });

  it("collapses a pile of same-kind items into one card that opens the web", async () => {
    const pile: InboxItem[] = Array.from({ length: 5 }, (_, i) => ({
      ...connectorItem,
      id: `rec-${i}`,
      kind: "reconciliation_conflict",
      priority: "high",
      title: `Payment ${i}`,
      description: `Payment ${i + 1} · 100 RWF`,
      href: "/pay/reconciliation",
      actionableSince: `2026-09-0${i + 1}T10:00:00Z`,
    }));
    mockFetchInbox.mockResolvedValue(inbox(pile));
    await render(<Inbox />);

    expect(await screen.findByText("Next up (5)")).toBeTruthy();
    expect(screen.getByText("Payment (5)")).toBeTruthy();
    expect(screen.getByText(/5 items need review - most recent: Payment 5 · 100 RWF/)).toBeTruthy();
    expect(screen.queryByText("Payment 0")).toBeNull();

    await fireEvent.press(screen.getByText("Review all 5"));
    expect(mockOpenUrl).toHaveBeenCalledWith("https://app.example.test/pay/reconciliation");
  });

  it("shows the caught-up state for an empty inbox", async () => {
    mockFetchInbox.mockResolvedValue(inbox([]));
    await render(<Inbox />);
    expect(await screen.findByText("You're all caught up")).toBeTruthy();
  });
});
