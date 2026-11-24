import { View } from "react-native";

import { Button, Card, Text } from "@/components/ds";
import { space } from "@/theme/tokens";

import { rwf } from "./format";
import { SAVE_ON } from "./messages";
import type { SaveOnOffer } from "./types";

/**
 * The suggestion shown under the amount. It only describes the offer the server
 * computed; the parts are never taken from here when the split is started.
 *
 * Wording rule: a capacity split says why (the amount is above the network's limit for
 * one transfer); a fee-saving split shows the source of the fee table. Neither presents
 * a split as a way around anything.
 */
export function SaveOnOfferCard({
  offer,
  busy,
  onAccept,
  onLearnMore,
}: {
  offer: SaveOnOffer;
  busy: boolean;
  onAccept: () => void;
  onLearnMore?: () => void;
}) {
  const n = offer.parts.length;
  const capacity = offer.kind === "capacity";
  const exact = offer.feeBasis === "verified_tariff";
  const first = offer.parts[0]?.feeMinor ?? null;
  return (
    <Card style={{ gap: space[2] }} accessibilityLabel={`${SAVE_ON.name}: ${capacity ? SAVE_ON.capacityTitle : SAVE_ON.savingTitle}`}>
      <Text variant="caption" color="accent">
        {SAVE_ON.name.toUpperCase()}
      </Text>
      <Text variant="bodyStrong">{capacity ? SAVE_ON.capacityTitle : SAVE_ON.savingTitle}</Text>
      <Text variant="label" color="textSecondary">
        {capacity
          ? SAVE_ON.capacityBody(rwf(offer.capacityMinor ?? "0"), rwf(offer.totalMinor), n)
          : SAVE_ON.savingBody(
              rwf(offer.totalMinor),
              rwf(offer.singleFeeMinor ?? "0"),
              rwf(offer.plannedFeeMinor ?? "0"),
              rwf(offer.savingsMinor ?? "0"),
              n,
            )}
      </Text>

      <View style={{ gap: space[1] }}>
        {offer.parts.map((p) => (
          <Text key={p.index} variant="label" tabular>
            {SAVE_ON.partRow(p.index, rwf(p.amountMinor))}
            {p.feeMinor !== null ? `  ·  ${capacity && !exact ? "up to " : "fee "}${rwf(p.feeMinor)}` : ""}
          </Text>
        ))}
      </View>

      {capacity && offer.plannedFeeMinor !== null && first !== null ? (
        <Text variant="caption" color="textSecondary">
          {(exact ? SAVE_ON.capacityFeeExact : SAVE_ON.capacityFee)(rwf(offer.plannedFeeMinor), rwf(first))}
        </Text>
      ) : null}
      {capacity ? (
        <Text variant="caption" color="textSecondary">
          {SAVE_ON.limitsNote}
        </Text>
      ) : null}
      {offer.source ? (
        <Text variant="caption" color="textMuted">
          {SAVE_ON.source}: {offer.source.label}
          {offer.source.asOf ? ` · verified ${offer.source.asOf.slice(0, 10)}` : ""}
        </Text>
      ) : null}
      <Text variant="caption" color="textSecondary">
        {SAVE_ON.howItWorks}
      </Text>

      <Button label={busy ? SAVE_ON.working : SAVE_ON.accept(n)} fullWidth loading={busy} onPress={onAccept} />
      {!capacity ? (
        <Text variant="caption" color="textMuted">
          {SAVE_ON.keepOne}
        </Text>
      ) : null}
      {onLearnMore ? <Button label={SAVE_ON.learnMore} variant="ghost" fullWidth onPress={onLearnMore} /> : null}
    </Card>
  );
}
