import { iconGradient } from "../BrandIcon";
import { lightColors } from "@/theme/colors";
import { SETTINGS_GROUPS } from "@/features/settings/groups";

const brand = [lightColors.homeGradientStart, lightColors.homeGradientEnd];
it("every settings icon gets a semantic colour except the deliberate brand-violet ones", () => {
  const BRAND = new Set(["globe", "link", "code"]);
  const icons = SETTINGS_GROUPS.flatMap(group => group.rows.map(row => row.icon));
  for (const icon of icons) {
    const isBrand = JSON.stringify(iconGradient(icon, lightColors)) === JSON.stringify(brand);
    expect([icon, isBrand]).toEqual([icon, BRAND.has(icon)]);
  }
});
