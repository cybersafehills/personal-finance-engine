import { render } from "@testing-library/react-native";

import { PrivacyProvider } from "@/features/privacy/PrivacyProvider";
import { colors } from "@/theme/tokens";

import { MoneyAmount } from "../MoneyAmount";

describe("MoneyAmount", () => {
  it("shows incoming money with a + sign in the positive colour", async () => {
    const view = await render(<MoneyAmount amountRwf={7500} />);
    const node = view.getByText("+7,500 RWF");
    expect(node).toHaveStyle({ color: colors.moneyPositive });
  });

  it("shows outgoing money with a − sign and never in red", async () => {
    const view = await render(<MoneyAmount amountRwf={-7500} />);
    const node = view.getByText("−7,500 RWF");
    expect(node).toHaveStyle({ color: colors.textPrimary });
  });

  it("does not render the value at all when masked", async () => {
    const view = await render(
      <PrivacyProvider>
        <MoneyAmount amountRwf={7500} masked />
      </PrivacyProvider>,
    );
    expect(view.queryByText(/7,500/)).toBeNull();
    expect(view.getByLabelText("Amount hidden")).toBeTruthy();
  });
});
