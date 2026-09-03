package me.oneledger.companion.health

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import me.oneledger.companion.data.DeviceStore
import me.oneledger.companion.queue.CaptureQueueRepository
import me.oneledger.companion.service.CaptureNotificationListenerService

/** Assembles a [HealthSnapshot] from the OS + local stores on demand. */
class HealthRepository(
    private val context: Context,
    private val deviceStore: DeviceStore,
    private val queue: CaptureQueueRepository,
) {
    fun isListenerEnabled(): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(context)
            .contains(context.packageName) &&
            CaptureNotificationListenerService.isConnected

    suspend fun snapshot(): HealthSnapshot = ConnectionHealth.evaluate(
        isPaired = deviceStore.isPaired,
        listenerEnabled = isListenerEnabled(),
        reauthRequired = deviceStore.lastErrorCode == "reauth",
        queue = queue.stats(),
        lastSuccessAtMs = deviceStore.lastSuccessAtMs,
    )
}
