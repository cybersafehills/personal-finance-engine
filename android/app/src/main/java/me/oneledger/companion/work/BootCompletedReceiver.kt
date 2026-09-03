package me.oneledger.companion.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Re-arms the periodic queue drain after a reboot (ADR 0010 §2). The
 *  NotificationListenerService is rebound by the system automatically. */
class BootCompletedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            CaptureScheduler.ensurePeriodic(context.applicationContext)
        }
    }
}
