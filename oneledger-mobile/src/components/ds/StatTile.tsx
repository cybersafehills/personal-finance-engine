import { space } from "@/theme/tokens";

import { Card } from "./Card";
import { Text } from "./Text";

/** One labelled metric. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card style={{ paddingVertical: space[3], flex: 1 }}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <Text variant="title" tabular style={{ marginTop: space[1] }}>
        {value}
      </Text>
      {hint ? (
        <Text variant="caption" color="textMuted" style={{ marginTop: 2 }}>
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}
