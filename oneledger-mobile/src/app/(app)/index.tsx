import { router } from "expo-router";

import { Button, Card, Screen, ScreenHeader, Text } from "@/components/ds";
import { useSession } from "@/features/auth/SessionProvider";
import { space } from "@/theme/tokens";

// Temporary signed-in home. The real Home (balance, today, recent activity)
// replaces this in PR 5.
export default function Home() {
  const { session, signOut } = useSession();

  return (
    <Screen>
      <ScreenHeader title="OneLedger" subtitle="You're signed in" />

      <Card style={{ gap: space[1] }}>
        <Text variant="caption" color="textMuted">
          Account
        </Text>
        <Text variant="bodyStrong">{session?.user.email ?? "Unknown"}</Text>
      </Card>

      <Card style={{ gap: space[3] }}>
        <Text variant="label" color="textSecondary">
          Your balance, transactions and inbox arrive in the next update.
        </Text>
        <Button
          label="Automatic recording"
          variant="secondary"
          fullWidth
          onPress={() => router.push("/capture")}
        />
        <Button
          label="Security"
          variant="secondary"
          fullWidth
          onPress={() => router.push("/security")}
        />
        <Button
          label="Design gallery"
          variant="secondary"
          fullWidth
          onPress={() => router.push("/gallery")}
        />
      </Card>

      <Button label="Sign out" variant="ghost" fullWidth onPress={signOut} />
    </Screen>
  );
}
