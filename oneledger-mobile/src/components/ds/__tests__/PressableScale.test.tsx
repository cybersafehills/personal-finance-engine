import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { PressableScale } from "../PressableScale";

describe("PressableScale", () => {
  it("keeps intrinsic button sizing on the press target without an expanding flex child", async () => {
    await render(<PressableScale accessibilityRole="button" accessibilityLabel="Rules" style={{ minHeight: 40, alignSelf: "flex-start", paddingVertical: 8 }}><Text>Rules</Text></PressableScale>);
    const button = screen.getByRole("button", { name: "Rules" });
    expect(button).toHaveStyle({ minHeight: 40, alignSelf: "flex-start", paddingVertical: 8 });
    expect(button.children).toContain(screen.getByText("Rules"));
  });
  it("preserves an explicit circle size and ignores disabled presses", async () => {
    const onPress = jest.fn();
    await render(<PressableScale disabled accessibilityRole="button" accessibilityLabel="Pay" onPress={onPress} style={{ width: 48, height: 48, borderRadius: 24 }}><Text>Pay</Text></PressableScale>);
    const button = screen.getByRole("button", { name: "Pay" });
    expect(button).toHaveStyle({ width: 48, height: 48, borderRadius: 24 });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
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
