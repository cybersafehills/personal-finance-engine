import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { PressableScale, splitStyle } from "../PressableScale";

describe("splitStyle", () => {
  it("keeps how big the control is in its parent on the outer view, and its look on the inner one", () => {
    const { layout, visual } = splitStyle([
      { flexBasis: "48%", flexGrow: 1, marginTop: 4 },
      { flexDirection: "row", gap: 8, minHeight: 48, borderWidth: 1, backgroundColor: "#eee" },
    ]);
    expect(layout).toEqual({ flexBasis: "48%", flexGrow: 1, marginTop: 4 });
    expect(visual).toEqual({ flexDirection: "row", gap: 8, minHeight: 48, borderWidth: 1, backgroundColor: "#eee" });
  });

  it("copes with no style at all", () => {
    expect(splitStyle(undefined)).toEqual({ layout: {}, visual: {} });
  });
});

describe("PressableScale", () => {
  it("renders its content, passes the press through, and keeps the control's accessible name", async () => {
    const onPress = jest.fn();
    await render(
      <PressableScale accessibilityRole="button" accessibilityLabel="Pay a person" onPress={onPress} style={{ flexBasis: "48%", flexGrow: 1 }}>
        <Text>Pay a person</Text>
      </PressableScale>,
    );
    expect(screen.getByText("Pay a person")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Pay a person" }));
    expect(onPress).toHaveBeenCalled();
  });

  it("gives the style function the pressed state", async () => {
    const seen: boolean[] = [];
    await render(
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="x"
        style={(pressed) => {
          seen.push(pressed);
          return {};
        }}
      >
        <Text>x</Text>
      </PressableScale>,
    );
    await fireEvent(screen.getByRole("button", { name: "x" }), "pressIn");
    expect(seen).toContain(true);
  });
});
