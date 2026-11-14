import { useState } from "react";
import { View } from "react-native";

import { Button, Card, Screen, Text, TextField } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { useLock } from "@/features/lock/LockProvider";
import { space } from "@/theme/tokens";

// Second step for accounts with an authenticator app enrolled (same rule as
// the web's /auth/mfa): the session exists but is not trusted until the
// 6-digit code is verified.
export default function Mfa() {
  const { verifyMfa, signOut } = useSession();
  const { releaseAfterSignIn } = useLock();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await verifyMfa(digits);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setCode("");
      return;
    }
    releaseAfterSignIn();
  }

  return (
    <Screen centered>
      <View style={{ gap: space[1] }}>
        <Text variant="title" accessibilityRole="header">
          Confirm it&apos;s you
        </Text>
        <Text color="textSecondary">
          Enter the 6-digit code from your authenticator app.
        </Text>
      </View>

      <Card style={{ gap: space[4] }}>
        <TextField
          label="Code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          autoFocus
          onSubmitEditing={submit}
          error={error ?? undefined}
        />
        <Button label="Verify" fullWidth loading={busy} onPress={submit} />
      </Card>

      <Button label="Sign out" variant="ghost" fullWidth onPress={signOut} />
    </Screen>
  );
}
