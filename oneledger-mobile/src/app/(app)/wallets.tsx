import { useCallback } from "react";
import { fetchWallets } from "@/api/mobile-api";
import { Button, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { WalletList } from "@/features/wallets/WalletList";
import { useQuery } from "@/hooks/useQuery";

export default function Wallets() {
  const { activeId } = useActiveSpace();
  // Keyed by Space: switching drops the old list instead of showing it while the new one loads.
  return <WalletsInSpace key={activeId ?? "none"} />;
}

function WalletsInSpace() {
  const load = useCallback(() => fetchWallets(), []);
  const { data, loading, error, refresh } = useQuery(load, { refreshIntervalMs: 60000 });
  return <Screen><ScreenHeader title="Wallets" subtitle="Choose a wallet to view its balance and activity" />
    {data?.ok ? <>
      {error ? <Text variant="caption" color="attention">Couldn’t refresh. Showing the last fetched balances.</Text> : null}
      {data.wallets.length ? <WalletList wallets={data.wallets} /> : <EmptyState title="No wallets yet" description="Add an account to start." />}
    </> : error || data ? <EmptyState title={error ?? (data && !data.ok ? data.message : "Your wallets are unavailable.")} action={<Button label="Try again" onPress={refresh} />} />
      : <Text color="textMuted">{loading ? "Loading your wallets…" : "Your wallets are unavailable."}</Text>}
  </Screen>;
}
