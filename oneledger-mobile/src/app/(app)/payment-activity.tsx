import { router } from "expo-router";
import { useCallback } from "react";

import { Button, EmptyState, ListGroup, ListRow, Screen, ScreenHeader, Text } from "@/components/ds";
import { getPaymentActivity, paymentHint } from "@/features/pay/activity";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { formatRwf } from "@/lib/money";

// The payments you prepared from OneLedger and where each one stands, as on the
// web's /pay/activity. A prepared payment is only a draft until your provider
// confirms it, so nothing here ever says "paid".
export default function PaymentActivity() {
  const load = useCallback(() => getPaymentActivity(), []);
  const { data, loading, error, refresh } = useQuery(load);

  return (
    <Screen>
      <ScreenHeader title="Payment activity" subtitle="Payments you prepared, and where each one stands" />
      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : error && !data ? (
        <EmptyState title={error} action={<Button label="Try again" variant="secondary" onPress={refresh} />} />
      ) : data && data.length === 0 ? (
        <EmptyState variant="setup" title="No payments yet" description="Payments you prepare from Pay will show up here." />
      ) : (
        <ListGroup>
          {(data ?? []).map((p) => (
            <ListRow
              key={p.id}
              icon="send"
              label={p.recipient}
              hint={`${paymentHint(p)} · ${formatDateTime(p.createdAt)}`}
              value={p.currency === "RWF" ? formatRwf(p.amountMinor) : `${p.currency} ${p.amountMinor}`}
              a11yLabel={`${p.recipient}, ${paymentHint(p)}`}
              onPress={() => router.push({ pathname: "/pay/[id]", params: { id: p.id } })}
            />
          ))}
        </ListGroup>
      )}
    </Screen>
  );
}
