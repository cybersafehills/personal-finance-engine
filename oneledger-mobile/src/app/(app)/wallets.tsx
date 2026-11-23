import { addWallet, makeDefaultWallet, manageWallet } from "@/features/wallets/actions";
import { usePrivacy } from "@/features/privacy/PrivacyProvider";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { fetchWallets } from "@/api/mobile-api";
import { Badge, Button, Card, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import { asOfText, balanceText, PROVIDER_LABEL, parseBalanceInput, reasonText, STATUS_LABEL, STATUS_MEANING, STATUS_VARIANT } from "@/features/wallets/display";
import { useActiveSpace } from "@/features/spaces/ActiveSpaceProvider";
import { loadArchivedWallets } from "@/features/wallets/archived";
import { recordBalance } from "@/features/wallets/record";
import type { Wallet } from "@/features/wallets/types";
import { useQuery } from "@/hooks/useQuery";
import { space } from "@/theme/tokens";

// Your wallets, each with an honest balance: Confirmed (your provider said so),
// Estimated (worked out), Out of date, or Not available. We never show a number
// we can't back up, and a balance you type in is an estimate, never "Confirmed".

export default function Wallets() {
  const { active } = useActiveSpace();
  return <WalletsInSpace key={active?.id ?? "none"} workspaceId={active?.id} role={active?.role} kind={active?.kind} />;
}

function WalletsInSpace({ workspaceId, role, kind }: { workspaceId?: string; role?: string; kind?: string }) {
  const load = useCallback(() => workspaceId ? fetchWallets(workspaceId) : Promise.resolve(null), [workspaceId]);
  const { data, loading, error, refresh } = useQuery(load);
  const canManage = role === "owner" || role === "admin" || role === "member";
  const [showArchived, setShowArchived] = useState(false);
  const loadArchived = useCallback(() => workspaceId && showArchived ? loadArchivedWallets(workspaceId) : Promise.resolve([]), [workspaceId, showArchived]);
  const archived = useQuery(loadArchived, showArchived ? "archived" : "closed");
  function onSaved() {
    refresh();
    if (showArchived) archived.refresh();
  }

  return (
    <Screen>
      <ScreenHeader title="Wallets" subtitle="Your balances, and how sure we are" />
      {data?.ok && role === "owner" && kind !== "household" ? <AddWallet onSaved={onSaved} /> : null}
      {error ? <EmptyState title={error} action={<Button label="Try again" onPress={refresh} />} /> : null}
      {loading && !data ? (
        <Text variant="label" color="textMuted">
          Loading…
        </Text>
      ) : data && !data.ok ? (
        <EmptyState
          title={data.message}
          action={data.reason === "unavailable" ? undefined : <Button label="Try again" variant="secondary" onPress={refresh} />}
        />
      ) : data && data.ok ? (
        data.wallets.length === 0 ? (
          <EmptyState variant="setup" title="No wallets yet" description="Connect MoMo to see your wallets and balances here." />
        ) : (
          data.wallets.map((w) => <WalletCard key={w.id} wallet={w} onSaved={onSaved} canManage={canManage} canSetDefault={role === "owner"} />)
        )
      ) : null}
      {data?.ok ? <Button label={showArchived ? "Hide archived wallets" : "Show archived wallets"} variant="ghost" onPress={() => setShowArchived(!showArchived)} /> : null}
      {data?.ok && showArchived ? (
        archived.error ? <EmptyState title="Couldn't load archived wallets" action={<Button label="Retry archived wallets" onPress={archived.refresh} />} />
          : !archived.data ? <Text>Loading archived wallets…</Text>
          : archived.data.length === 0 ? <Text>No archived wallets in this Space.</Text>
          : archived.data.map((wallet) => <ArchivedWalletCard key={wallet.id} wallet={wallet} canManage={canManage} onSaved={onSaved} />)
      ) : null}
    </Screen>
  );
}

function WalletCard({ wallet: w, onSaved, canManage, canSetDefault }: {
  wallet: Wallet;
  onSaved: () => void;
  canManage: boolean;
  canSetDefault: boolean;
}) {
  const { amountsHidden } = usePrivacy();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decimals = w.currency === "RWF" ? 0 : 2;
  const asOf = asOfText(w);

  async function save() {
    const minor = parseBalanceInput(text, decimals);
    if (minor === null) {
      setError(decimals === 0 ? "Enter a whole number, like 78,900." : "Enter an amount, like 78,900.50.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await recordBalance({ accountId: w.id, amountMinor: minor });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setEditing(false);
    setText("");
    onSaved();
  }

  return (
    <Card style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
        <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
          {w.name}
        </Text>
        <Badge variant={STATUS_VARIANT[w.balance.status]}>{STATUS_LABEL[w.balance.status]}</Badge>
      </View>
      <Text variant="caption" color="textMuted">
        {PROVIDER_LABEL[w.provider] ?? "Wallet"}
        {w.isPrimary ? " · Main wallet" : ""}
      </Text>
      <Text variant="title" tabular accessibilityLabel={amountsHidden ? "Amount hidden" : `${amountsHidden ? "••••••" : balanceText(w)}, ${STATUS_LABEL[w.balance.status]}`}>
        {amountsHidden ? "••••••" : balanceText(w)}
      </Text>
      {asOf ? (
        <Text variant="caption" color="textMuted">
          {asOf}
        </Text>
      ) : null}
      <Text variant="label" color="textSecondary">
        {STATUS_MEANING[w.balance.status]}
      </Text>
      {w.balance.reasons.map((r) => (
        <Text key={r} variant="caption" color="textMuted">
          {reasonText(r)}
        </Text>
      ))}

      {canSetDefault && !w.isPrimary ? <Button label="Make default" variant="secondary" disabled={busy} onPress={async () => {
        setBusy(true); setError(null);
        const result = await makeDefaultWallet(w.id);
        setBusy(false); if (result.ok) onSaved(); else setError(result.message ?? "Could not save.");
      }} /> : null}
      {!editing && error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {canManage && (editing ? (
        <View style={{ gap: space[2], marginTop: space[2] }}>
          <TextField
            label={`Your balance now (${w.currency})`}
            help="Check your provider's app or dial its USSD code, then type what it shows."
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            autoComplete="off"
            error={error ?? undefined}
          />
          <Button label="Save my balance" loading={busy} onPress={save} fullWidth />
          <Button label="Cancel" variant="ghost" onPress={() => { setEditing(false); setError(null); }} />
        </View>
      ) : (
        <Button label="I checked my balance" variant="secondary" onPress={() => setEditing(true)} />
      ))}
      {canManage && !editing ? <WalletManagement wallet={w} onSaved={onSaved} /> : null}
    </Card>
  );
}

function AddWallet({ onSaved }: { onSaved(): void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("cash");
  const [currency, setCurrency] = useState("RWF");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <Button label="Add a wallet" onPress={() => setOpen(true)} />;
  return <Card>
    <TextField label="Wallet name" value={name} onChangeText={setName} />
    <Text variant="caption">Creates a manual wallet. Connect your phone separately for automatic recording.</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{["cash", "bank", "mtn_momo", "airtel_money", "other"].map((v) => <Button key={v} label={v.replaceAll("_", " ")} variant={v === provider ? "primary" : "ghost"} onPress={() => setProvider(v)} />)}</View>
    <View style={{ flexDirection: "row" }}>{["RWF", "USD", "EUR"].map((v) => <Button key={v} label={v} variant={v === currency ? "primary" : "ghost"} onPress={() => setCurrency(v)} />)}</View>
    {error ? <Text accessibilityRole="alert">{error}</Text> : null}
    <Button label="Save wallet" loading={busy} disabled={!name.trim()} onPress={async () => {
      if (busy) return; setBusy(true); setError(null);
      try { const result = await addWallet({ name, provider, currency }); if (result.ok) { setOpen(false); setName(""); onSaved(); } else setError(result.message ?? "Could not save."); }
      finally { setBusy(false); }
    }} />
    <Button label="Cancel" variant="ghost" disabled={busy} onPress={() => setOpen(false)} />
  </Card>;
}

function WalletManagement({ wallet, onSaved }: { wallet: Wallet; onSaved(): void }) {
  const [mode, setMode] = useState<"rename" | "archive" | null>(null);
  const [name, setName] = useState(wallet.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (busy || !mode) return;
    setBusy(true);
    setError(null);
    const result = await manageWallet(wallet.id, mode === "rename" ? { action: mode, name } : { action: mode });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMode(null);
    onSaved();
  }

  if (!mode) return (
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
      <Button label="Rename" variant="ghost" onPress={() => { setName(wallet.name); setMode("rename"); }} />
      <Button label="Archive" variant="ghost" onPress={() => setMode("archive")} />
    </View>
  );
  return (
    <View style={{ gap: space[2] }}>
      {mode === "rename" ? <TextField label="New wallet name" value={name} onChangeText={setName} maxLength={120} />
        : <Text>Archive {wallet.name}? Its transactions stay in your history. Restore the wallet to use it for new entries.</Text>}
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      <Button label={mode === "rename" ? "Save name" : "Archive wallet"} loading={busy}
        disabled={mode === "rename" && (!name.trim() || name.trim() === wallet.name)} onPress={save} />
      <Button label="Cancel" variant="ghost" disabled={busy} onPress={() => { setMode(null); setError(null); }} />
    </View>
  );
}

function ArchivedWalletCard({ wallet, canManage, onSaved }: {
  wallet: { id: string; name: string; currency: string };
  canManage: boolean;
  onSaved(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await manageWallet(wallet.id, { action: "restore" });
    setBusy(false);
    if (result.ok) onSaved();
    else setError(result.message);
  }

  return (
    <Card>
      <Text variant="bodyStrong">{wallet.name} · {wallet.currency}</Text>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {canManage ? <Button label="Restore wallet" variant="secondary" loading={busy} onPress={restore} /> : null}
    </Card>
  );
}
