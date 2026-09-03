package me.oneledger.companion.queue

import me.oneledger.companion.util.minuteBucket
import me.oneledger.companion.util.normalizeMessage
import me.oneledger.companion.util.sha256Hex

/** Snapshot used to derive connection health without exposing message content. */
data class QueueStats(
    val pending: Int,
    val dead: Int,
    val oldestPendingAgeMs: Long,
)

enum class EnqueueResult { ENQUEUED, DUPLICATE_DROPPED, EVICTED_TO_FIT }

/**
 * The only writer/reader of the capture queue. Enforces the on-device dedupe
 * key and the 500-row bound (ADR 0010 §4).
 */
class CaptureQueueRepository(private val dao: QueuedCaptureDao) {

    suspend fun enqueue(
        providerKey: String,
        message: String,
        receivedAtIso: String,
        sourcePackage: String,
    ): EnqueueResult {
        val dedupeKey = sha256Hex(normalizeMessage(message) + "|" + minuteBucket(receivedAtIso))

        var evicted = false
        if (dao.total() >= QueuedCapture.MAX_ROWS) {
            evicted = dao.evictOldestPending() > 0
        }

        val rowId = dao.insertIfNew(
            QueuedCapture(
                providerKey = providerKey,
                message = message,
                receivedAt = receivedAtIso,
                sourcePackage = sourcePackage,
                dedupeKey = dedupeKey,
            ),
        )
        return when {
            rowId == -1L -> EnqueueResult.DUPLICATE_DROPPED
            evicted -> EnqueueResult.EVICTED_TO_FIT
            else -> EnqueueResult.ENQUEUED
        }
    }

    suspend fun nextBatch(limit: Int = 25): List<QueuedCapture> = dao.nextBatch(limit = limit)

    suspend fun onDelivered(id: Long) = dao.deleteById(id)

    suspend fun onPermanentReject(id: Long, code: String) =
        dao.setState(id, QueuedCapture.STATE_DEAD, code)

    /** Increment attempt; dead-letter once past the cap. Returns true if the
     *  row is still retryable. */
    suspend fun onRetryableFailure(id: Long, attemptCount: Int, reason: String): Boolean {
        return if (attemptCount + 1 >= QueuedCapture.MAX_ATTEMPTS) {
            dao.setState(id, QueuedCapture.STATE_DEAD, "max_attempts:$reason")
            false
        } else {
            dao.markAttempt(id, reason)
            true
        }
    }

    suspend fun stats(now: Long = System.currentTimeMillis()): QueueStats {
        val oldest = dao.oldestCreatedAt()
        return QueueStats(
            pending = dao.countByState(QueuedCapture.STATE_PENDING),
            dead = dao.countByState(QueuedCapture.STATE_DEAD),
            oldestPendingAgeMs = if (oldest == null) 0L else (now - oldest).coerceAtLeast(0L),
        )
    }
}
