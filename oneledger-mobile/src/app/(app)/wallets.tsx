import { useCallback } from "react";
import { fetchWallets } from "@/api/mobile-api";
import { Button, EmptyState, Screen, ScreenHeader, Text } from "@/components/ds";
import { WalletPanel } from "@/features/home/HomeCards";
import { useQuery } from "@/hooks/useQuery";

export default function Wallets() {
  const load = useCallback(() => fetchWallets(), []);
  const { data, loading, error, refresh } = useQuery(load);
  return <Screen><ScreenHeader title="Wallets" subtitle="Choose a wallet to view its balance and activity" />
    {error ? <EmptyState title={error} action={<Button label="Try again" onPress={refresh} />} /> : loading && !data ? <Text>Loading…</Text> : data && !data.ok ? <EmptyState title={data.message} action={<Button label="Try again" onPress={refresh} />} /> : data?.ok ? <WalletPanel wallets={data.wallets} message="" manage={false} /> : null}
  </Screen>;
}
