import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Badge,
  Button,
  Card,
  CONNECTION_STATUSES,
  ConnectionStatusBadge,
  EmptyState,
  MoneyAmount,
  ScreenHeader,
  StatTile,
  Text,
} from "@/components/ds";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { formatRwf } from "@/lib/money";
import { colors, space } from "@/theme/tokens";

// Design-system gallery. Temporary home screen so the primitives can be
// reviewed in the preview; replaced by the real tab shell in PR 5.
// All figures below are sample data.
export default function Gallery() {
  const { amountsHidden, toggleAmountsHidden } = usePrivacy();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader
          title="OneLedger"
          subtitle="Design system preview (sample data)"
          action={
            <Button
              label={amountsHidden ? "Show amounts" : "Hide amounts"}
              variant="secondary"
              onPress={toggleAmountsHidden}
            />
          }
        />

        <Card>
          <Text variant="caption" color="textMuted">
            Current balance
          </Text>
          <MoneyAmount amountRwf={245300} size="xl" />
          <View style={styles.row}>
            <Badge variant="positive">Up to date</Badge>
            <Badge variant="attention">2 to review</Badge>
          </View>
        </Card>

        <View style={styles.row}>
          <StatTile label="Money in today" value={formatRwf(52000)} />
          <StatTile label="Money out today" value={formatRwf(18700)} hint="4 payments" />
        </View>

        <Card style={styles.list}>
          <Text variant="label" color="textSecondary">
            Recent activity
          </Text>
          {SAMPLE.map((row) => (
            <View key={row.title} style={styles.listRow}>
              <View style={styles.listText}>
                <Text variant="bodyStrong">{row.title}</Text>
                <Text variant="caption" color="textMuted">
                  {row.meta}
                </Text>
              </View>
              <MoneyAmount amountRwf={row.amount} />
            </View>
          ))}
        </Card>

        <Card style={styles.list}>
          <Text variant="label" color="textSecondary">
            Connection status vocabulary
          </Text>
          <View style={styles.wrap}>
            {CONNECTION_STATUSES.map((status) => (
              <ConnectionStatusBadge key={status} status={status} />
            ))}
          </View>
        </Card>

        <Card style={styles.list}>
          <Text variant="label" color="textSecondary">
            Buttons
          </Text>
          <Button label="Primary action" fullWidth />
          <Button label="Secondary" variant="secondary" fullWidth />
          <Button label="Ghost" variant="ghost" fullWidth />
          <Button label="Loading" loading fullWidth />
          <Button label="Disabled" disabled fullWidth />
        </Card>

        <EmptyState
          variant="setup"
          title="No phone connected yet"
          description="Connect your phone so MoMo messages are recorded automatically."
          action={<Button label="Connect a phone" />}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const SAMPLE = [
  { title: "Received from client", meta: "Today, 14:03 · MTN MoMo", amount: 52000 },
  { title: "Groceries", meta: "Today, 11:20 · MTN MoMo", amount: -12500 },
  { title: "Moto fare", meta: "Today, 08:45 · MTN MoMo", amount: -1200 },
];

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: space[4],
    gap: space[4],
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  row: { flexDirection: "row", gap: space[3], marginTop: space[2] },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  list: { gap: space[3] },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
  },
  listText: { flex: 1 },
});
