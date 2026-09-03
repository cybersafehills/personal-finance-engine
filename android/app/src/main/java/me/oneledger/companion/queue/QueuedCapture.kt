package me.oneledger.companion.queue

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** One matched notification awaiting delivery to `/capture` (ADR 0010 §4). */
@Entity(
    tableName = "queued_capture",
    indices = [Index(value = ["dedupeKey"], unique = true), Index(value = ["state", "createdAt"])],
)
data class QueuedCapture(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val providerKey: String,
    /** The matched message text, verbatim. The only user content stored. */
    val message: String,
    /** ISO-8601 — the notification's `postTime`. */
    val receivedAt: String,
    val sourcePackage: String,
    /** `sha256(normalizedMessage + "|" + minuteBucket(receivedAt))`. */
    val dedupeKey: String,
    val state: String = STATE_PENDING,
    val attemptCount: Int = 0,
    val lastError: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
) {
    companion object {
        const val STATE_PENDING = "pending"
        /** Retried past the cap; surfaced in health, never silently dropped. */
        const val STATE_DEAD = "send_failed_permanent"

        /** Bounded capacity. Oldest un-sent row is evicted past this. */
        const val MAX_ROWS = 500
        const val MAX_ATTEMPTS = 12
    }
}
