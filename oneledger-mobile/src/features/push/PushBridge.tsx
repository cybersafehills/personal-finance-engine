import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { refreshPushRegistration } from "./push";
import { pushTarget } from "./push-routing";

// While the app is open, show the banner too: a notification that only
// lands silently in the tray is easy to miss.
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Mounted once inside the signed-in area. Keeps the token registration
 * fresh and opens the right screen when a notification is tapped, including
 * the tap that launched the app.
 */
export function PushBridge() {
  useEffect(() => {
    if (Platform.OS === "web") return;

    refreshPushRegistration();

    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      router.push(pushTarget(response.notification.request.content.data));
    };

    open(Notifications.getLastNotificationResponse());
    const subscription =
      Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);

  return null;
}
