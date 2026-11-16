import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import { TransactionTags } from "@/features/transactions/TransactionTags";
import { TagError } from "@/features/transactions/tags";

const mockAdd = jest.fn();
const mockRemove = jest.fn();

jest.mock("@/features/transactions/tags", () => {
  const actual = jest.requireActual("@/features/transactions/tags");
  return {
    ...actual,
    addTag: (...args: unknown[]) => mockAdd(...args),
    removeTag: (...args: unknown[]) => mockRemove(...args),
  };
});

const setup = (props: Partial<React.ComponentProps<typeof TransactionTags>> = {}) =>
  render(
    <TransactionTags transactionId="t1" workspaceId="w1" initialTags={["work"]} suggestions={[]} {...props} />,
  );

beforeEach(() => {
  mockAdd.mockReset().mockImplementation((_t: string, _w: string, raw: string) => Promise.resolve(raw.trim().toLowerCase()));
  mockRemove.mockReset().mockResolvedValue(undefined);
});

describe("TransactionTags", () => {
  it("shows the tags and an editor", async () => {
    await setup();
    expect(screen.getByText("work")).toBeTruthy();
    expect(screen.getByLabelText("Add a tag")).toBeTruthy();
    expect(screen.getByText(/never changes an already-generated statement/)).toBeTruthy();
  });

  it("says so when there are none yet", async () => {
    await setup({ initialTags: [] });
    expect(screen.getByText("No tags yet.")).toBeTruthy();
  });

  it("adds a tag to this transaction's Space, shows it and clears the field", async () => {
    await setup();
    await fireEvent.changeText(screen.getByLabelText("Add a tag"), "  Trip ");
    await fireEvent.press(screen.getByText("Add tag"));

    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith("t1", "w1", "  Trip "));
    expect(await screen.findByText("trip")).toBeTruthy();
    expect(screen.getByLabelText("Add a tag").props.value).toBe("");
  });

  it("won't add with an empty field", async () => {
    await setup();
    expect(screen.getByText("Add tag")).toBeTruthy();
    await fireEvent.press(screen.getByText("Add tag"));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("shows why a tag was refused and keeps what was typed", async () => {
    mockAdd.mockRejectedValue(new TagError("A tag is 1-40 letters, numbers, spaces, hyphens or underscores."));
    await setup();
    await fireEvent.changeText(screen.getByLabelText("Add a tag"), "bad!");
    await fireEvent.press(screen.getByText("Add tag"));

    expect(await screen.findByText("A tag is 1-40 letters, numbers, spaces, hyphens or underscores.")).toBeTruthy();
    expect(screen.getByLabelText("Add a tag").props.value).toBe("bad!");
    expect(screen.queryByText("bad!")).toBeNull(); // no chip was added
  });

  it("falls back to a generic message for an unexpected failure", async () => {
    mockAdd.mockRejectedValue(new Error("internal detail"));
    await setup();
    await fireEvent.changeText(screen.getByLabelText("Add a tag"), "tax");
    await fireEvent.press(screen.getByText("Add tag"));
    expect(await screen.findByText("Something went wrong. Try again.")).toBeTruthy();
    expect(screen.queryByText(/internal detail/)).toBeNull();
  });

  it("removes a tag", async () => {
    await setup();
    await fireEvent.press(screen.getByLabelText("Remove tag work"));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith("t1", "work"));
    await waitFor(() => expect(screen.queryByText("work")).toBeNull());
  });

  it("keeps the tag, and says why, when removal fails", async () => {
    mockRemove.mockRejectedValue(new TagError("Couldn't remove that tag. Try again."));
    await setup();
    await fireEvent.press(screen.getByLabelText("Remove tag work"));
    expect(await screen.findByText("Couldn't remove that tag. Try again.")).toBeTruthy();
    expect(screen.getByText("work")).toBeTruthy();
  });

  it("offers tags used elsewhere, never ones already applied, and adds one in a tap", async () => {
    await setup({ suggestions: ["work", "tax", "trip"] });
    expect(screen.queryByLabelText("Add suggested tag work")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Add suggested tag tax"));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith("t1", "w1", "tax"));
    await waitFor(() => expect(screen.queryByLabelText("Add suggested tag tax")).toBeNull()); // now applied
  });

  it("makes one change at a time (a double tap is one request)", async () => {
    let finish: (v: string) => void = () => {};
    mockAdd.mockReturnValue(new Promise<string>((resolve) => (finish = resolve)));
    await setup({ suggestions: ["tax"] });

    const suggestion = screen.getByLabelText("Add suggested tag tax");
    await act(async () => {
      fireEvent.press(suggestion);
      fireEvent.press(suggestion);
      fireEvent.press(suggestion);
    });
    expect(mockAdd).toHaveBeenCalledTimes(1);
    await act(async () => finish("tax"));
  });

  it("shows tags but no editor when the transaction's Space couldn't be read", async () => {
    await setup({ workspaceId: null });
    expect(screen.getByText("work")).toBeTruthy();
    expect(screen.queryByLabelText("Add a tag")).toBeNull();
    expect(screen.queryByLabelText("Remove tag work")).toBeNull();
  });
});
