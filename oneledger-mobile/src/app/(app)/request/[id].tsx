import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { cancelRequest, getRequest, linkRequestPayment, markRequestPaid, type ChangeResult } from "@/features/requests/actions";
import { destinationText, statusBadge } from "@/features/requests/input";
import { useQuery } from "@/hooks/useQuery";
import { formatDateTime } from "@/lib/kigali-time";
import { formatMoney } from "@/lib/money";
import { space } from "@/theme/tokens";

// One payment request. The link isn't shown here (it was shown once, when you
// created the request). From here you can confirm you were paid - by linking
// the real incoming payment, or by marking it paid yourself - or cancel it.

export default function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const load = useCallback(() => getRequest(id), [id]);
  const { data, loading, refresh } = useQuery(load);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<null | "cancel" | "paid">(null);

  async function run(fn: () => Promise<ChangeResult>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    setConfirm(null);
    if (res.ok) refresh();
    else setError(res.message);
  }

  return (
    <Screen>
      <Button label="Back" variant="ghost" onPress={() => router.back()} />
      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : data && !data.ok ? (
        <EmptyState title={data.message} action={<Button label="Try again" variant="secondary" onPress={refresh} />} />
      ) : data && data.ok ? (
        (() => {
          const r = data.request;
          const b = statusBadge(r.status);
          const canCancel = r.status === "open" || r.status === "expired";
          const canMark = r.status === "open";
          const canLink = r.status === "open" || r.status === "expired";
          return (
            <>
              <ScreenHeader title={formatMoney(r.amountMinor, r.currency)} subtitle={r.recipientDisplay} />
              <Badge variant={b.variant}>{b.label}</Badge>

              {r.status === "marked_paid_by_owner" ? (
                <Text variant="label" color="attention">
                  You marked this as paid. OneLedger has not verified it.
                </Text>
              ) : null}

              <Card style={{ gap: space[2] }}>
                <Row label={r.destinationType === "momo_phone" ? "Mobile Money number" : "Merchant code"} value={destinationText(r)} />
                {r.reference ? <Row label="Reference" value={r.reference} /> : null}
                <Row label="Valid until" value={formatDateTime(r.expiresAt)} />
                <Row label="Created" value={formatDateTime(r.createdAt)} />
              </Card>

              <Text variant="caption" color="textMuted">
                The link was shown once, when you created this request. To share a new link, cancel this request and create another.
              </Text>

              {error ? (
                <Text variant="label" color="attention" accessibilityRole="alert">
                  {error}
                </Text>
              ) : null}

              {canLink ? (
                <View style={{ gap: space[2] }}>
                  <Text variant="bodyStrong">Link the payment you received</Text>
                  {data.candidates.length === 0 ? (
                    <Text variant="label" color="textSecondary">
                      No settled incoming payment of exactly this amount has been recorded yet. Once it is, it will appear here for you to confirm.
                    </Text>
                  ) : (
                    data.candidates.map((c) => (
                      <Card key={c.id} style={{ gap: space[2] }}>
                        <Text variant="label">
                          {c.counterpartyName ?? "Unknown sender"} · {formatDateTime(c.occurredAt)}
                        </Text>
                        <Button label="This is it" variant="secondary" disabled={busy} onPress={() => run(() => linkRequestPayment(r.id, c.id))} />
                      </Card>
                    ))
                  )}
                </View>
              ) : null}

              {canMark ? (
                <View style={{ gap: space[2] }}>
                  <Text variant="bodyStrong">Mark as paid yourself</Text>
                  <Text variant="caption" color="textMuted">
                    Use this if you were paid some other way, like cash. It records your own statement and is shown as marked paid by you. OneLedger does not verify it.
                  </Text>
                  <TextField label="Note (optional)" value={note} onChangeText={setNote} maxLength={200} />
                  {confirm === "paid" ? (
                    <View style={{ gap: space[2] }}>
                      <Button label="Yes, mark as paid" disabled={busy} onPress={() => run(() => markRequestPaid(r.id, note))} fullWidth />
                      <Button label="Keep open" variant="ghost" onPress={() => setConfirm(null)} />
                    </View>
                  ) : (
                    <Button label="Mark as paid" variant="secondary" onPress={() => setConfirm("paid")} />
                  )}
                </View>
              ) : null}

              {canCancel ? (
                <View style={{ gap: space[2] }}>
                  <Text variant="bodyStrong">Cancel this request</Text>
                  <Text variant="caption" color="textMuted">
                    The link stops showing the payment details straight away.
                  </Text>
                  {confirm === "cancel" ? (
                    <View style={{ gap: space[2] }}>
                      <Button label="Yes, cancel it" disabled={busy} onPress={() => run(() => cancelRequest(r.id))} fullWidth />
                      <Button label="Keep open" variant="ghost" onPress={() => setConfirm(null)} />
                    </View>
                  ) : (
                    <Button label="Cancel request" variant="secondary" onPress={() => setConfirm("cancel")} />
                  )}
                </View>
              ) : null}
            </>
          );
        })()
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
      <Text variant="label" color="textMuted">
        {label}
      </Text>
      <Text variant="label" style={{ flexShrink: 1, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}
