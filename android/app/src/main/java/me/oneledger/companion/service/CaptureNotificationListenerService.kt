package me.oneledger.companion.service

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import me.oneledger.companion.BuildConfig
import me.oneledger.companion.OneLedgerCompanionApp
import me.oneledger.companion.detection.IGNORED_NOTIFICATION_PACKAGES
import me.oneledger.companion.detection.detectProvider
import me.oneledger.companion.queue.CaptureQueueRepository
import me.oneledger.companion.work.CaptureScheduler
import java.time.Instant

/**
 * The notification observer (ADR 0010 §2). Every posted notification is
 * inspected here and immediately discarded unless it matches a registered
 * provider. Only matched text + post time + package name are ever retained.
 *
 * This service holds NO business logic beyond "extract text, match, enqueue".
 */
class CaptureNotificationListenerService : NotificationListenerService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val queue: CaptureQueueRepository get() = OneLedgerCompanionApp.graph().queue

    override fun onListenerConnected() {
        isConnected = true
        debug { "listener connected" }
    }

    override fun onListenerDisconnected() {
        isConnected = false
        debug { "listener disconnected" }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn ?: return

        // Cheap pre-filter: skip ongoing / group-summary noise and the handful
        // of packages that never carry a provider's financial message.
        if (notification.isOngoing) return
        if (notification.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (notification.packageName in IGNORED_NOTIFICATION_PACKAGES) return

        val text = extractText(notification)
        if (text == null) {
            debug { "posted pkg=${notification.packageName} — no usable text, skipped" }
            return
        }

        val provider = detectProvider(text)
        if (provider == null) {
            // Unknown → discarded. Nothing leaves the device; content never logged.
            debug { "posted pkg=${notification.packageName} — no provider match, discarded" }
            return
        }

        val receivedAt = Instant.ofEpochMilli(notification.postTime).toString()
        val pkg = notification.packageName
        debug { "matched ${provider.providerKey} from pkg=$pkg — enqueuing" }

        scope.launch {
            val result = queue.enqueue(
                providerKey = provider.providerKey,
                message = text,
                receivedAtIso = receivedAt,
                sourcePackage = pkg,
            )
            debug { "enqueue result=$result" }
            CaptureScheduler.requestDrain(applicationContext)
        }
    }

    /**
     * The message body: MessagingStyle's last message (the modern default for
     * SMS apps), then `EXTRA_BIG_TEXT`, then `EXTRA_TEXT`. Returns null when
     * there is no usable body — nothing to match, nothing to keep.
     *
     * Deliberately **never the title**: for an SMS notification the title is the
     * sender id, which is not part of the message, would leak into what we match
     * and forward, and — because a launcher re-posts the same notification with
     * the title sometimes present, sometimes not — made this non-deterministic
     * and produced two queue rows for one SMS (defeating the dedupe key).
     * Provider SMS bodies (MTN MoMo, banks) are self-contained.
     */
    private fun extractText(sbn: StatusBarNotification): String? {
        val notification = sbn.notification
        NotificationCompat.MessagingStyle
            .extractMessagingStyleFromNotification(notification)
            ?.messages?.lastOrNull()?.text?.toString()?.trim()
            ?.let { if (it.isNotEmpty()) return it }

        val extras = notification.extras ?: return null
        val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()
        if (!big.isNullOrEmpty()) return big
        return extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()
            ?.ifEmpty { null }
    }

    companion object {
        private const val TAG = "OLCapture"

        /** Set from the listener lifecycle callbacks; read by HealthRepository.
         *  `getEnabledListenerPackages` alone can lag a revoke. */
        @Volatile
        var isConnected: Boolean = false
            private set

        private inline fun debug(msg: () -> String) {
            if (BuildConfig.DEBUG) Log.i(TAG, msg())
        }

        /**
         * Ask the system to (re)bind this listener when the permission is
         * granted. Android frequently leaves a `NotificationListenerService`
         * unbound after the app is reinstalled or updated — it still shows as
         * "enabled", `isConnected` can even be a stale `true`, but
         * `onNotificationPosted` never fires until the user toggles the
         * permission. `requestRebind` fixes that with no user action.
         *
         * Deliberately **not** guarded on `isConnected` (that is exactly the
         * value that lies in the broken state) and deliberately called only
         * once per process launch (from `MainActivity.onCreate`) — a rebind
         * when already healthy costs one instant disconnect/reconnect cycle,
         * which is fine once but not on every foreground resume.
         */
        fun ensureBound(context: Context) {
            val granted = NotificationManagerCompat.getEnabledListenerPackages(context)
                .contains(context.packageName)
            if (!granted) return
            val component = ComponentName(
                context.packageName,
                CaptureNotificationListenerService::class.java.name,
            )
            runCatching { NotificationListenerService.requestRebind(component) }
                .onFailure { if (BuildConfig.DEBUG) Log.w(TAG, "requestRebind failed", it) }
        }
    }
}
