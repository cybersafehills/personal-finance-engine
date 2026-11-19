import { useCallback, useState } from "react";
import { View } from "react-native";

import { Button, Card, Text } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { useQuery } from "@/hooks/useQuery";
import { space as spacing } from "@/theme/tokens";
import { loadHouseholdSources, updateHouseholdShare, type HouseholdSource, type ShareStatus } from "./source-sharing";
import type { Space } from "./spaces";

export function HouseholdSharing({ space }: { space: Space }) {
  const { session } = useSession();
  const userId = session?.user.id;
  const [open, setOpen] = useState(false);
  const load = useCallback(
    () => open && userId ? loadHouseholdSources(userId, space.id) : Promise.resolve([]),
    [open, space.id, userId],
  );
  const query = useQuery(load, open ? "sharing" : "closed");
  return (
    <View style={{ gap: spacing[2] }}>
      <Button label={open ? "Hide wallet sharing" : "Manage wallet sharing"} variant="secondary" onPress={() => setOpen(!open)} />
      {open && query.error ? (
        <Card>
          <Text accessibilityRole="alert">Couldn&apos;t load wallet sharing.</Text>
          <Button label="Try again" onPress={query.refresh} />
        </Card>
      ) : null}
      {open && !query.data && !query.error ? <Text>Loading wallet sharing…</Text> : null}
      {open && query.data?.length === 0 ? <Text>You have no active financial sources to share.</Text> : null}
      {open && query.data?.map((source) => <SourceCard key={source.id} source={source} space={space} onSaved={query.refresh} />)}
    </View>
  );
}

type Change = { label: string; action: { mode: "share_account" } | { status: ShareStatus } };

function SourceCard({ source, space, onSaved }: { source: HouseholdSource; space: Space; onSaved(): void }) {
  const [change, setChange] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { link } = source;
  const canStart = ["owner", "admin", "member"].includes(space.role);
  const modeLabel = link?.visibility_mode === "share_account" ? "Transactions and balance" : "Existing transaction share";
  const status = link?.status;

  async function save() {
    if (!change || busy) return;
    setBusy(true);
    setFailed(false);
    const saved = await updateHouseholdShare(space.id, source.id, change.action);
    setBusy(false);
    if (saved) {
      setChange(null);
      onSaved();
    } else {
      setFailed(true);
    }
  }

  return (
    <Card style={{ gap: spacing[2] }}>
      <Text variant="bodyStrong">{source.display_name} · {source.currency}</Text>
      <Text>{status === "active" ? modeLabel : status === "paused" ? `Paused · ${modeLabel}` : "Private in this household"}</Text>
      {change ? (
        <>
          <Text>{change.label} for {source.display_name} in {space.name}?</Text>
          {("mode" in change.action || ("status" in change.action && change.action.status === "active"))
            ? <Text>Household members may be able to see shared data offline for up to seven days after their last successful sync.</Text>
            : <Text>Members lose online access when this change takes effect. Devices that are offline may retain access until their authorization expires.</Text>}
          {failed ? <Text accessibilityRole="alert">Couldn&apos;t change sharing. Check your access and connection, then retry.</Text> : null}
          <Button label="Confirm" loading={busy} onPress={save} />
          <Button label="Cancel" variant="ghost" disabled={busy} onPress={() => { setChange(null); setFailed(false); }} />
        </>
      ) : status === "active" || status === "paused" ? (
        <>
          {status === "active" || (canStart && link?.visibility_mode === "share_account") ? (
            <Button label={status === "active" ? "Pause sharing" : "Resume sharing"} variant="secondary"
              onPress={() => setChange(status === "active"
                ? { label: "Pause sharing", action: { status: "paused" } }
                : { label: `Resume sharing ${modeLabel.toLowerCase()}`, action: { status: "active" } })} />
          ) : null}
          <Button label="Stop sharing" variant="ghost" onPress={() => setChange({ label: "Stop sharing", action: { status: "revoked" } })} />
        </>
      ) : canStart ? (
        <Button label="Share transactions and balance" variant="secondary" onPress={() => setChange({ label: "Share transactions and balance", action: { mode: "share_account" } })} />
      ) : null}
    </Card>
  );
}
