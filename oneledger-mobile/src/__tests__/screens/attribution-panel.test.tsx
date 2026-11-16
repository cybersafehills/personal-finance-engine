import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { AttributionPanel } from "@/features/transactions/AttributionPanel";
import { type Attribution, AttributionError } from "@/features/transactions/attribution";

const mockSet = jest.fn();

jest.mock("@/features/transactions/attribution", () => {
  const actual = jest.requireActual("@/features/transactions/attribution");
  return { ...actual, setAttribution: (...args: unknown[]) => mockSet(...args) };
});

const members = [
  { userId: "me", displayName: "Yves" },
  { userId: "amy", displayName: "Amy" },
];
const undecided: Attribution = { type: null, attributedUserId: null, splits: [] };

const setup = (over: Partial<React.ComponentProps<typeof AttributionPanel>> = {}) =>
  render(
    <AttributionPanel transactionId="t1" current={undecided} members={members} selfUserId="me" {...over} />,
  );

const open = async () => fireEvent.press(screen.getByText("Change"));

beforeEach(() => {
  mockSet.mockReset();
  mockSet.mockImplementation((_id: string, change: { type: string; memberId?: string; splits?: unknown[] }) =>
    Promise.resolve({ type: change.type, attributedUserId: change.memberId ?? null, splits: change.splits ?? [] }),
  );
});

describe("AttributionPanel", () => {
  it("says it moves no money, and flags an undecided transaction", async () => {
    await setup();
    expect(screen.getByText("Not decided yet")).toBeTruthy();
    expect(screen.getByText("Needs attribution")).toBeTruthy();
    expect(screen.getByText(/doesn't move any money/)).toBeTruthy();
  });

  it("summarises each decision, with no flag once decided", async () => {
    await setup({ current: { type: "split", attributedUserId: null, splits: [{ userId: "me", shareBps: 6000 }, { userId: "amy", shareBps: 4000 }] } });
    expect(screen.getByText("Yves 60% · Amy 40%")).toBeTruthy();
    expect(screen.queryByText("Needs attribution")).toBeNull();
  });

  it("shows the editor only after Change, and Cancel closes it without saving", async () => {
    await setup();
    expect(screen.queryByText("Whose spending is this?")).toBeNull();
    await open();
    expect(screen.getByText("Whose spending is this?")).toBeTruthy();
    await fireEvent.press(screen.getByText("Cancel"));
    expect(screen.queryByText("Whose spending is this?")).toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("saves 'shared' and shows it", async () => {
    const onSaved = jest.fn();
    await setup({ onSaved });
    await open();
    await fireEvent.press(screen.getByText("Save"));

    await waitFor(() => expect(mockSet).toHaveBeenCalledWith("t1", { type: "shared" }));
    expect(await screen.findByText("Shared by the household")).toBeTruthy();
    expect(screen.queryByText("Needs attribution")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("saves 'not sure yet'", async () => {
    await setup();
    await open();
    await fireEvent.press(screen.getByLabelText("Not sure yet"));
    await fireEvent.press(screen.getByText("Save"));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith("t1", { type: "unassigned" }));
  });

  it("saves one member, preselecting yourself", async () => {
    await setup();
    await open();
    await fireEvent.press(screen.getByLabelText("One member"));
    await fireEvent.press(screen.getByText("Save"));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith("t1", { type: "member", memberId: "me" }));
  });

  it("saves a different member when picked", async () => {
    await setup();
    await open();
    await fireEvent.press(screen.getByLabelText("One member"));
    await fireEvent.press(screen.getByLabelText("Amy"));
    await fireEvent.press(screen.getByText("Save"));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith("t1", { type: "member", memberId: "amy" }));
    expect(await screen.findByText("Amy")).toBeTruthy();
  });

  describe("splitting", () => {
    const openSplit = async () => {
      await setup();
      await open();
      await fireEvent.press(screen.getByLabelText("Split across members"));
    };

    it("won't save until the shares add up to 100%, and shows the running total", async () => {
      await openSplit();
      await fireEvent.changeText(screen.getByLabelText("Yves's share"), "60");
      expect(screen.getByText("60% of 100%")).toBeTruthy();
      expect(screen.getByText("The shares must add up to 100%.")).toBeTruthy();
      await fireEvent.press(screen.getByText("Save"));
      expect(mockSet).not.toHaveBeenCalled();
    });

    it("saves a split that adds up", async () => {
      await openSplit();
      await fireEvent.changeText(screen.getByLabelText("Yves's share"), "60");
      await fireEvent.changeText(screen.getByLabelText("Amy's share"), "40");
      await fireEvent.press(screen.getByText("Save"));

      await waitFor(() =>
        expect(mockSet).toHaveBeenCalledWith("t1", {
          type: "split",
          splits: [{ userId: "me", shareBps: 6000 }, { userId: "amy", shareBps: 4000 }],
        }),
      );
      expect(await screen.findByText("Yves 60% · Amy 40%")).toBeTruthy();
    });

    it("lets one member take it all by leaving the other empty", async () => {
      await openSplit();
      await fireEvent.changeText(screen.getByLabelText("Amy's share"), "100");
      await fireEvent.press(screen.getByText("Save"));
      await waitFor(() => expect(mockSet).toHaveBeenCalledWith("t1", { type: "split", splits: [{ userId: "amy", shareBps: 10000 }] }));
    });

    it("explains a percentage it can't read", async () => {
      await openSplit();
      await fireEvent.changeText(screen.getByLabelText("Yves's share"), "lots");
      expect(screen.getByText("Enter each share as a percentage, like 50 or 33.33.")).toBeTruthy();
    });

    it("starts from the current split", async () => {
      await setup({ current: { type: "split", attributedUserId: null, splits: [{ userId: "me", shareBps: 7000 }, { userId: "amy", shareBps: 3000 }] } });
      await open();
      expect(screen.getByLabelText("Yves's share").props.value).toBe("70");
      expect(screen.getByLabelText("Amy's share").props.value).toBe("30");
      expect(screen.getByText("100% of 100%")).toBeTruthy();
    });
  });

  it("shows the database's refusal and keeps the editor open, with nothing changed", async () => {
    mockSet.mockRejectedValue(new AttributionError("You do not have permission to categorize transactions in this Space."));
    const onSaved = jest.fn();
    await setup({ onSaved });
    await open();
    await fireEvent.press(screen.getByText("Save"));

    expect(await screen.findByText("You do not have permission to categorize transactions in this Space.")).toBeTruthy();
    expect(screen.getByText("Whose spending is this?")).toBeTruthy();
    expect(screen.getByText("Not decided yet")).toBeTruthy(); // the summary didn't change
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("gives a generic message for an unexpected failure", async () => {
    mockSet.mockRejectedValue(new Error("internal detail"));
    await setup();
    await open();
    await fireEvent.press(screen.getByText("Save"));
    expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
    expect(screen.queryByText(/internal detail/)).toBeNull();
  });

  it("makes one save at a time (a double tap is one request)", async () => {
    let finish: (v: unknown) => void = () => {};
    mockSet.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await setup();
    await open();

    const save = screen.getByText("Save");
    await act(async () => {
      fireEvent.press(save);
      fireEvent.press(save);
      fireEvent.press(save);
    });
    expect(mockSet).toHaveBeenCalledTimes(1);
    await act(async () => finish({ type: "shared", attributedUserId: null, splits: [] }));
  });

  it("offers only the choices that name nobody when the member list couldn't be loaded", async () => {
    await setup({ members: [] });
    await open();
    expect(screen.getByLabelText("Not sure yet")).toBeTruthy();
    expect(screen.getByLabelText("Shared: belongs to the household")).toBeTruthy();
    expect(screen.queryByLabelText("One member")).toBeNull();
    expect(screen.queryByLabelText("Split across members")).toBeNull();
  });

  it("shows fresh data once it arrives, not what was saved before (a change made elsewhere)", async () => {
    const view = await setup();
    await open();
    await fireEvent.press(screen.getByText("Save")); // saved as "shared"
    expect(await screen.findByText("Shared by the household")).toBeTruthy();

    // Later the screen reloads and someone has since made it Amy's.
    await view.rerender(
      <AttributionPanel transactionId="t1" current={{ type: "member", attributedUserId: "amy", splits: [] }} members={members} selfUserId="me" />,
    );
    expect(await screen.findByText("Amy")).toBeTruthy();
    expect(screen.queryByText("Shared by the household")).toBeNull();

    // And Change opens from the fresh value, not the stale one.
    await fireEvent.press(screen.getByText("Change"));
    expect(screen.getByLabelText("One member").props.accessibilityState.selected).toBe(true);
  });

  it("keeps showing what was saved while the screen's data is unchanged", async () => {
    await setup();
    await open();
    await fireEvent.press(screen.getByText("Save"));
    expect(await screen.findByText("Shared by the household")).toBeTruthy();
    expect(screen.queryByText("Not decided yet")).toBeNull();
  });
});
