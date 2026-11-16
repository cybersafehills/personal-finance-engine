import { render, screen } from "@testing-library/react-native";

import PairLink from "@/app/(app)/pair";
import { setParams } from "@/test/router-mock";

const mockRedirect = jest.fn();

jest.mock("expo-router", () => ({
  ...jest.requireActual("@/test/router-mock"),
  Redirect: (props: unknown) => {
    mockRedirect(props);
    return null;
  },
}));

beforeEach(() => {
  mockRedirect.mockReset();
  setParams({});
});

describe("pair deep link", () => {
  it("hands the code to the connect flow without redeeming it", async () => {
    setParams({ c: "olp_abc123" });
    await render(<PairLink />);
    expect(mockRedirect).toHaveBeenCalledWith({
      href: { pathname: "/connect", params: { code: "olp_abc123" } },
    });
    expect(screen.toJSON()).toBeNull();
  });

  it("still opens connect when the link carries no code", async () => {
    await render(<PairLink />);
    expect(mockRedirect).toHaveBeenCalledWith({
      href: { pathname: "/connect", params: {} },
    });
  });
});
