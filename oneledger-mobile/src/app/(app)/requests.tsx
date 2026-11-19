import { router } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";
import { PrivatePressable as Pressable } from "@/features/privacy/PrivatePressable";

import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { listRequests } from "@/features/requests/actions";
import { statusBadge } from "@/features/requests/input";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";

// Payment requests: ask someone to pay you with a link. OneLedger does not
// collect or verify the payment - you confirm it yourself when the money arrives.

export default function Requests() {
  const load = useCallback(() => listRequests(), []);
  const { data, loading, refresh } = useQuery(load);

  return (
    <Screen>
      <ScreenHeader title="Payment requests" subtitle="Ask someone to pay you with a link" />
      <Button label="New request" onPress={() => router.push("/request-new")} fullWidth />

      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : data && !data.ok ? (
        <EmptyState title={data.message} action={<Button label="Try again" variant="secondary" onPress={refresh} />} />
      ) : data && data.ok ? (
        data.requests.length === 0 ? (
          <EmptyState variant="setup" title="No payment requests yet" description="Create one to get a link you can send on WhatsApp or by text." />
        ) : (
          data.requests.map((r) => {
            const b = statusBadge(r.status);
            const amount = formatMoney(r.amountMinor, r.currency);
            return (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={`${amount} from ${r.recipientDisplay}, ${b.label}. Open.`}
                onPress={() => router.push({ pathname: "/request/[id]", params: { id: r.id } })}
              >
                <Card style={{ gap: space[1] }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
                    <Text variant="bodyStrong">{amount}</Text>
                    <Badge variant={b.variant}>{b.label}</Badge>
                  </View>
                  <Text variant="caption" color="textMuted">
                    {r.reference ? `${r.reference} · ` : ""}Created {formatDateTime(r.createdAt)}
                  </Text>
                </Card>
              </Pressable>
            );
          })
        )
      ) : null}
    </Screen>
  );
}
