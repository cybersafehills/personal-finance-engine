import { selectedWorkspaceId } from "@/features/spaces/selected-space";
import { assertCachedAccess } from "@/offline/visibility";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Button, Card, EmptyState, Screen, ScreenHeader, Text, TextField } from "@/components/ds";
import {
  createManualTransaction,
  listManualAccounts,
  ManualEntryError,
} from "@/features/manual/actions";
import {
  buildManualTransaction,
  defaultDirection,
  MANUAL_TYPES,
  type ManualTransactionType,
  type When,
} from "@/features/manual/input";
import { useQuery } from "@/hooks/useQuery";
import { listLocalAccounts, recordManualTransaction } from "@/offline/local-store";
import { useOffline } from "@/offline/offline-context";
import { readableDb } from "@/offline/runtime";
import { kigaliDateKey } from "@/lib/kigali-time";
import { MIN_TOUCH_TARGET, radii, space } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

// Record a transaction by hand: for money that moved outside MoMo, or when
// automatic recording missed something. It becomes an ordinary transaction
// (source "manual"); pick its category afterwards on its detail screen.
export default function AddTransaction() {
  // Accounts come from the device once its first download is done, so the form
  // works with no connection; otherwise from the server, as before.
  const loadAccounts = useCallback(async () => {
    const local = readableDb();
    if (local) {
      await assertCachedAccess(local, selectedWorkspaceId());
      const accounts = await listLocalAccounts(local, selectedWorkspaceId());
      if (accounts.length > 0) return accounts;
    }
    return listManualAccounts();
  }, []);
  const offline = useOffline();
  const { data: accounts, loading, error, refresh } = useQuery(loadAccounts);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [type, setType] = useState<ManualTransactionType>("merchant_payment");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [amountText, setAmountText] = useState("");
  const [feeText, setFeeText] = useState("");
  const [whenKind, setWhenKind] = useState<When["kind"]>("now");
  const [dateText, setDateText] = useState("");
  const [timeText, setTimeText] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);


  if (!accounts) {
    return (
      <Screen>
        {loading ? (
          <Text variant="label" color="textMuted">
            Loading…
          </Text>
        ) : (
          <EmptyState
            title={error ?? "Couldn't load your accounts."}
            action={<Button label="Try again" variant="secondary" onPress={refresh} />}
          />
        )}
      </Screen>
    );
  }
  if (accounts.length === 0) {
    return (
      <Screen>
        <EmptyState
          variant="setup"
          title="Add an account first"
          description="A transaction has to belong to an account. Add one on the web, then come back."
        />
      </Screen>
    );
  }

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  function chooseType(next: ManualTransactionType) {
    setType(next);
    setDirection(defaultDirection(next));
  }

  async function save() {
    const when: When =
      whenKind === "custom"
        ? { kind: "custom", dateKey: dateText || kigaliDateKey(new Date().toISOString()), timeText }
        : { kind: whenKind };
    const built = buildManualTransaction(
      {
        transactionType: type,
        direction,
        amountText,
        feeText,
        when,
        counterpartyName: counterparty,
        notes,
      },
      account,
      Date.now(),
    );
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      // Only once the first download is done, so the saved entry is visible in the lists.
      const local = readableDb();
      if (local && offline.available) {
        // Saved on the device first, atomically with its upload entry. Never waits
        // on the network and never claims the server has it.
        const id = await recordManualTransaction(local, {
          args: built.args,
          account,
          transactionId: offline.newId(),
          opId: offline.newId(),
          nowIso: new Date().toISOString(),
        });
        offline.notifyLocalWrite();
        router.replace({ pathname: "/transaction/[id]", params: { id } });
        return;
      }
      const id = await createManualTransaction(built.args);
      router.replace({ pathname: "/transaction/[id]", params: { id } });
    } catch (e) {
      setFormError(e instanceof ManualEntryError ? e.message : "Couldn't save that. Try again.");
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader title="Add a transaction" subtitle="Record one by hand" />

      {accounts.length > 1 ? (
        <Card style={{ gap: space[2] }}>
          <Text variant="label" color="textSecondary">
            Account
          </Text>
          <Chips>
            {accounts.map((a) => (
              <Chip
                key={a.id}
                label={`${a.name} (${a.currency})`}
                selected={a.id === account.id}
                onPress={() => setAccountId(a.id)}
              />
            ))}
          </Chips>
        </Card>
      ) : null}

      <Card style={{ gap: space[2] }}>
        <Text variant="label" color="textSecondary">
          What happened
        </Text>
        <Chips>
          {MANUAL_TYPES.map((t) => (
            <Chip key={t.key} label={t.label} selected={t.key === type} onPress={() => chooseType(t.key)} />
          ))}
        </Chips>
        <Chips>
          <Chip label="Money out" selected={direction === "out"} onPress={() => setDirection("out")} />
          <Chip label="Money in" selected={direction === "in"} onPress={() => setDirection("in")} />
        </Chips>
      </Card>

      <TextField
        label={`Amount (${account.currency})`}
        value={amountText}
        onChangeText={setAmountText}
        keyboardType="decimal-pad"
        placeholder="0"
      />
      {direction === "out" ? (
        <TextField
          label="Fee (optional)"
          value={feeText}
          onChangeText={setFeeText}
          keyboardType="decimal-pad"
          placeholder="0"
        />
      ) : null}

      <Card style={{ gap: space[2] }}>
        <Text variant="label" color="textSecondary">
          When
        </Text>
        <Chips>
          <Chip label="Just now" selected={whenKind === "now"} onPress={() => setWhenKind("now")} />
          <Chip label="Yesterday" selected={whenKind === "yesterday"} onPress={() => setWhenKind("yesterday")} />
          <Chip label="Pick a date" selected={whenKind === "custom"} onPress={() => setWhenKind("custom")} />
        </Chips>
        {whenKind === "custom" ? (
          <>
            <TextField
              label="Date (YYYY-MM-DD)"
              value={dateText}
              onChangeText={setDateText}
              placeholder={kigaliDateKey(new Date().toISOString())}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextField
              label="Time, 24-hour (optional)"
              value={timeText}
              onChangeText={setTimeText}
              placeholder="14:30"
              autoCapitalize="none"
              autoCorrect={false}
              help="Kigali time. Defaults to midday."
            />
          </>
        ) : null}
      </Card>

      <TextField
        label="Who or what (optional)"
        value={counterparty}
        onChangeText={setCounterparty}
        autoCapitalize="words"
      />
      <TextField label="Note (optional)" value={notes} onChangeText={setNotes} multiline />

      {formError ? (
        <Text variant="label" color="attention" accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}
      <Button label="Add transaction" fullWidth loading={saving} onPress={save} />
    </Screen>
  );
}

function Chips({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return <View style={styles.chips}>{children}</View>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text variant="label" color={selected ? "onSolid" : "textPrimary"}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: space[3],
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.accentSolid, borderColor: colors.accentSolid },
}));
