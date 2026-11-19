import * as Linking from "expo-linking";
import { useState } from "react";
import { View } from "react-native";

import { Button, Card, Screen, Text, TextField } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { useLock } from "@/features/lock/LockProvider";
import { config, isConfigured } from "@/lib/config";
import { space } from "@/theme/tokens";

export default function SignIn() {
  const { signIn } = useSession();
  const { releaseAfterSignIn } = useLock();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPassword("");
    releaseAfterSignIn();
  }

  return (
    <Screen centered edges={["top", "left", "right", "bottom"]}>
      <View style={{ gap: space[1] }}>
        <Text variant="title" color="brandNavy" accessibilityRole="header">
          OneLedger
        </Text>
        <Text color="textSecondary">Sign in to see your money.</Text>
      </View>

      {!isConfigured ? (
        <Card>
          <Text variant="label" color="attention">
            This build isn&apos;t connected to OneLedger yet. Add the
            EXPO_PUBLIC_ values to .env.local and restart.
          </Text>
        </Card>
      ) : null}

      <Card style={{ gap: space[4] }}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          error={error ?? undefined}
        />
        <Button label="Sign in" fullWidth loading={busy} onPress={submit} />
      </Card>

      {config.apiBaseUrl ? (
        <Button
          label="New here? Create your account on the web"
          variant="ghost"
          fullWidth
          onPress={() => Linking.openURL(`${config.apiBaseUrl}/signup`)}
        />
      ) : null}
    </Screen>
  );
}
