import { router } from "expo-router";
import { useCallback } from "react";

import { Button, EmptyState, ListGroup, ListRow, Screen, ScreenHeader, Text } from "@/components/ds";
import { getPaymentTemplates, TYPE_LABELS, templateUsable } from "@/features/pay/activity";
import { useQuery } from "@/hooks/useQuery";
import { formatRwf } from "@/lib/money";

// Your saved payment templates, as on the web's /pay/templates. Using one fills
// the Pay form (the amount is a starting point you can change); nothing is sent.
// Templates for bills, electricity, airtime and government payments are kept but
// can't be filled in here.
export default function PaymentTemplates() {
  const load = useCallback(() => getPaymentTemplates(), []);
  const { data, loading, error, refresh } = useQuery(load);

  return (
    <Screen>
      <ScreenHeader title="Payment templates" subtitle="Saved payments you can reuse" />
      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : error && !data ? (
        <EmptyState title={error} action={<Button label="Try again" variant="secondary" onPress={refresh} />} />
      ) : data && data.length === 0 ? (
        <EmptyState variant="setup" title="No templates yet" description="Save a payment as a template on the web to reuse it here." />
      ) : (
        <ListGroup>
          {(data ?? []).map((t) => {
            const usable = templateUsable(t);
            const amount = t.defaultAmountMinor ? ` · ${formatRwf(t.defaultAmountMinor)}` : "";
            return (
              <ListRow
                key={t.id}
                icon="copy"
                label={t.name}
                hint={usable ? `${TYPE_LABELS[t.type] ?? "Payment"}${amount}` : `${TYPE_LABELS[t.type] ?? "Payment"} · can't be filled in here yet`}
                onPress={usable ? () => router.push({ pathname: "/pay-new", params: { type: t.type, template: t.id } }) : undefined}
              />
            );
          })}
        </ListGroup>
      )}
    </Screen>
  );
}
