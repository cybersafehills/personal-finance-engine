package me.oneledger.companion.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import me.oneledger.companion.OneLedgerCompanionApp
import me.oneledger.companion.data.SendOutcome

/**
 * Drains the capture queue oldest-first (ADR 0010 §4). One row's outcome maps to:
 *   Accepted        → delete the row
 *   PermanentReject → dead-letter (visible in health), stop retrying it
 *   Unauthorized    → flag re-auth, stop the whole run (Result.success — no point retrying)
 *   Retry           → increment attempt / dead-letter past the cap, ask WorkManager to back off
 */
class CaptureUploadWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val graph = OneLedgerCompanionApp.graph()
        val queue = graph.queue
        val client = graph.captureClient
        val store = graph.deviceStore

        if (!store.isPaired) return Result.success()

        var sawRetryable = false
        val batch = queue.nextBatch(limit = 25)
        if (batch.isEmpty()) return Result.success()

        for (row in batch) {
            when (val outcome = client.capture(row.message, row.receivedAt)) {
                is SendOutcome.Accepted -> {
                    queue.onDelivered(row.id)
                    store.lastSuccessAtMs = System.currentTimeMillis()
                    store.lastErrorCode = null
                }
                is SendOutcome.PermanentReject -> {
                    queue.onPermanentReject(row.id, outcome.code)
                }
                is SendOutcome.Unauthorized -> {
                    store.lastErrorCode = "reauth"
                    // Credential is gone; nothing in this queue can be sent until
                    // the user re-pairs. Don't thrash WorkManager retrying.
                    return Result.success()
                }
                is SendOutcome.Retry -> {
                    val stillRetryable =
                        queue.onRetryableFailure(row.id, row.attemptCount, outcome.reason)
                    if (stillRetryable) sawRetryable = true
                }
            }
        }

        // More pending rows, or transient failures this pass → come back.
        return if (sawRetryable || queue.nextBatch(limit = 1).isNotEmpty()) {
            Result.retry()
        } else {
            Result.success()
        }
    }
}
