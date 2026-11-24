import type Feather from "@expo/vector-icons/Feather";

import type { MoreRoute } from "./groups";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

/** One icon per More destination, so a row is recognisable at a glance. */
export const MORE_ICONS: Record<MoreRoute, FeatherName> = {
  "/categories": "tag",
  "/reports": "bar-chart-2",
  "/bills": "file-text",
  "/statements": "file",
  "/insights": "trending-up",
  "/people": "users",
  "/wallets": "credit-card",
  "/goals": "target",
  "/requests": "send",
  "/payment-activity": "activity",
  "/payment-templates": "copy",
  "/ussd": "hash",
  "/save-on": "percent",
  "/space-members": "users",
  "/notifications": "bell",
  "/security": "lock",
  "/settings": "settings",
};
