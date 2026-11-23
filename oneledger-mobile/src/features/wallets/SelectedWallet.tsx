import { getOfflineRuntime, readableDb, writableDb } from "@/offline/runtime";
import { assertCachedAccess } from "@/offline/visibility";
import type { Wallet } from "./types";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { View } from "react-native";
import { fetchWallets } from "@/api/mobile-api";
import { Button, Card, Text } from "@/components/ds";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { useQuery } from "@/hooks/useQuery";
import { useSession } from "@/features/auth/SessionProvider";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { deviceStore } from "@/lib/device-store";
import { balanceText, asOfText, STATUS_LABEL, reasonText } from "./display";

/** Server-derived balance contract. Unavailable is never replaced with a
 * different wallet's balance or a made-up zero. No native balance math. */
export function SelectedWallet({ onSelect }: { onSelect(id: string | undefined): void }) {
  const { activeId, active } = useActiveSpace();
  const { session } = useSession();
  const { amountsHidden, fullPrivacy, toggleAmountsHidden } = usePrivacy();
  const key = `oneledger.wallet.${session?.user.id}.${activeId}`;
  const [selection, setSelection] = useState<{ key: string; id: string } | null>(null);
  const load = useCallback(async () => {
    const origin = getOfflineRuntime();
    const db = writableDb();
    if (!activeId) throw new Error("Choose a Space to load wallets.");
    const result = await fetchWallets(activeId);
    if (getOfflineRuntime()?.userId !== origin?.userId || writableDb() !== db) throw new Error("Wallet session changed. Reload this Space.");
    if (result.ok && db && activeId) {
      await db.transaction(async (tx) => {
        await tx.run("DELETE FROM wallet_snapshots WHERE workspace_id = ?", [activeId]);
        for (const wallet of result.wallets) await tx.run("INSERT OR REPLACE INTO wallet_snapshots VALUES (?,?,?)", [wallet.id, activeId, JSON.stringify(wallet, (_key, value) => typeof value === "bigint" ? value.toString() : value)]);
      });
    }
    const local = readableDb();
    if (!result.ok && result.reason === "error" && local && activeId) {
      await assertCachedAccess(local, activeId);
      const rows = await local.all<{ payload: string }>("SELECT payload FROM wallet_snapshots WHERE workspace_id = ? AND id IN (SELECT id FROM accounts) ORDER BY id", [activeId]);
      const wallets = rows.map((row): Wallet => { const wallet = JSON.parse(row.payload); if (wallet.balance.amountMinor !== null) wallet.balance.amountMinor = BigInt(wallet.balance.amountMinor); if (wallet.balance.status !== "unavailable") wallet.balance.status = "stale"; return wallet; });
      return { ok: true as const, wallets, cached: true };
    }
    return result;
  }, [activeId]);
  const { data, loading, error, refresh } = useQuery(load);
  const wallets = data?.ok ? data.wallets : [];
  const chosen = wallets.find((w) => w.id === (selection?.key === key ? selection.id : null)) ?? wallets.find((w) => w.isPrimary) ?? wallets[0];
  useEffect(() => {
    let active = true;
    void deviceStore.get(key).then((id) => { if (active && id) setSelection({ key, id }); }).catch(() => undefined);
    return () => { active = false; };
  }, [key]);
  useLayoutEffect(() => { onSelect(chosen?.id); }, [chosen?.id, onSelect]);
  return <Card>
    <Text variant="label">{active?.name ?? "Choose a Space"}</Text>
    <Button variant="ghost" label={amountsHidden ? "Show balances" : "Hide balances"} disabled={fullPrivacy} onPress={toggleAmountsHidden} />
    {loading ? <Text>Loading wallets…</Text> : null}
    {error || (data && !data.ok) ? <View><Text accessibilityRole="alert">Wallet balances are unavailable. Your saved transactions are still available below.</Text><Button label="Try wallets again" onPress={refresh} /></View> : null}
    {wallets.map((w) => <Button key={w.id} variant={chosen?.id === w.id ? "primary" : "ghost"} label={`${w.name} · ${w.currency}${w.isPrimary ? " · Default" : ""}`} onPress={() => { setSelection({ key, id: w.id }); void deviceStore.set(key, w.id).catch(() => undefined); }} />)}
    {data && "cached" in data ? <Text variant="caption">Saved wallet evidence. Reconnect to refresh; this is not a live provider balance.</Text> : null}
    {chosen ? <View>
      <Text variant="title" tabular accessibilityLabel={amountsHidden ? "Amount hidden" : balanceText(chosen)}>{amountsHidden ? "••••••" : balanceText(chosen)}</Text>
      <Text>{STATUS_LABEL[chosen.balance.status]}{chosen.balance.basis === "manual" ? " · Balance you entered" : ""}</Text>
      <Text variant="caption">{asOfText(chosen) ?? "No balance evidence yet"}</Text>
      {chosen.balance.reasons.map((r) => <Text key={r} variant="caption">{reasonText(r)}</Text>)}
    </View> : !loading ? <Text>No wallet balance is available for this Space.</Text> : null}
  </Card>;
}
