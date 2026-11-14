package me.oneledger.companion.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/** Schedules the queue drain. Two triggers: an expedited one-shot when a new
 *  message lands, and a periodic safety net so a dropped one-shot still recovers. */
object CaptureScheduler {

    private const val DRAIN_ONESHOT = "capture-drain-oneshot"
    private const val DRAIN_PERIODIC = "capture-drain-periodic"

    private val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    /** Called by the listener after enqueuing, and after a successful pair. */
    fun requestDrain(context: Context) {
        val work = OneTimeWorkRequestBuilder<CaptureUploadWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(DRAIN_ONESHOT, ExistingWorkPolicy.APPEND_OR_REPLACE, work)
    }

    /** Called from Application start and BOOT_COMPLETED. */
    fun ensurePeriodic(context: Context) {
        val work = PeriodicWorkRequestBuilder<CaptureUploadWorker>(6, TimeUnit.HOURS)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 5, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(DRAIN_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, work)
    }
}
