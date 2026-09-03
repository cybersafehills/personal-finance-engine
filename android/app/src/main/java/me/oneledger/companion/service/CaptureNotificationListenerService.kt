package me.oneledger.companion.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import me.oneledger.companion.OneLedgerCompanionApp
import me.oneledger.companion.detection.WATCHED_PACKAGES
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
    }

    override fun onListenerDisconnected() {
        isConnected = false
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn ?: return

        // Cheap pre-filter: skip ongoing/group-summary/foreground-service noise
        // and apps we never care about.
        if (notification.isOngoing) return
        val flags = notification.notification.flags
        if (flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        if (WATCHED_PACKAGES.isNotEmpty() && notification.packageName !in WATCHED_PACKAGES) return

        val text = extractText(notification) ?: return
        val provider = detectProvider(text) ?: return // unknown → discarded, nothing leaves the device

        val receivedAt = Instant.ofEpochMilli(notification.postTime).toString()
        val pkg = notification.packageName

        scope.launch {
            queue.enqueue(
                providerKey = provider.providerKey,
                message = text,
                receivedAtIso = receivedAt,
                sourcePackage = pkg,
            )
            CaptureScheduler.requestDrain(applicationContext)
        }
    }

    /** Prefer BigText, then Text, then Title+Text. Returns null if there is no
     *  usable body — nothing to match, nothing to keep. */
    private fun extractText(sbn: StatusBarNotification): String? {
        val extras = sbn.notification.extras ?: return null
        val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()
        if (!big.isNullOrEmpty()) return big
        val body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()
        return when {
            !body.isNullOrEmpty() && !title.isNullOrEmpty() -> "$title\n$body"
            !body.isNullOrEmpty() -> body
            else -> null
        }
    }

    companion object {
        /** Set from the listener lifecycle callbacks; read by HealthRepository.
         *  `getEnabledListenerPackages` alone can lag a revoke. */
        @Volatile
        var isConnected: Boolean = false
            private set
    }
}
