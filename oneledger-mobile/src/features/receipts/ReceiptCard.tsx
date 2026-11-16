import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { Button, Card, Text } from "@/components/ds";
import { space } from "@/theme/tokens";

import { getReceiptForTransaction, revealToken } from "./receipts";
import { useQuery } from "@/hooks/useQuery";

const SHOW_SECONDS = 30;

// Electricity facts for a payment, with the token hidden until asked for. The
// token is held in component state only for 30 seconds - never stored.
export function ReceiptCard({ transactionId }: { transactionId: string }) {
  const load = useCallback(() => getReceiptForTransaction(transactionId), [transactionId]);
  const { data: receipt } = useQuery(load);
  const [token, setToken] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          setToken(null);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [token]);

  if (!receipt) return null;

  async function reveal() {
    setBusy(true);
    setError(null);
    const res = await revealToken(transactionId);
    setBusy(false);
    if (res.ok) {
      setLeft(SHOW_SECONDS);
      setToken(res.token);
    } else {
      setError(res.message);
    }
  }

  return (
    <Card style={{ gap: space[2] }}>
      <Text variant="bodyStrong">Electricity</Text>
      <Text variant="label" color="textSecondary">
        {receipt.kwh} kWh bought{receipt.meterLast4 ? ` · meter ending ${receipt.meterLast4}` : ""}
      </Text>
      {receipt.hasToken ? (
        token ? (
          <View style={{ gap: space[2] }}>
            <Text variant="heading" tabular selectable accessibilityLiveRegion="polite">
              {token}
            </Text>
            <Text variant="caption" color="textMuted">
              Hides in {left}s
            </Text>
            <Button label="Hide" variant="secondary" onPress={() => setToken(null)} />
          </View>
        ) : (
          <>
            <Text variant="caption" color="textMuted">
              Anyone with this token can use the electricity, so it is hidden until you ask. Each time you view it is recorded.
            </Text>
            <Button label="Show token" variant="secondary" loading={busy} onPress={reveal} />
          </>
        )
      ) : (
        <Text variant="caption" color="textMuted">
          The token itself wasn&apos;t kept for this purchase.
        </Text>
      )}
      {error ? (
        <Text variant="caption" color="attention" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}
