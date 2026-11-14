package me.oneledger.companion.queue

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface QueuedCaptureDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIfNew(row: QueuedCapture): Long

    @Query("SELECT * FROM queued_capture WHERE state = :state ORDER BY createdAt ASC LIMIT :limit")
    suspend fun nextBatch(state: String = QueuedCapture.STATE_PENDING, limit: Int = 25): List<QueuedCapture>

    @Query("DELETE FROM queued_capture WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("UPDATE queued_capture SET attemptCount = attemptCount + 1, lastError = :error WHERE id = :id")
    suspend fun markAttempt(id: Long, error: String)

    @Query("UPDATE queued_capture SET state = :state, lastError = :error WHERE id = :id")
    suspend fun setState(id: Long, state: String, error: String?)

    @Query("SELECT COUNT(*) FROM queued_capture WHERE state = :state")
    suspend fun countByState(state: String): Int

    @Query("SELECT MIN(createdAt) FROM queued_capture WHERE state = :state")
    suspend fun oldestCreatedAt(state: String = QueuedCapture.STATE_PENDING): Long?

    /** Evict the oldest pending row when the queue is full (ADR 0010 §4). */
    @Query(
        "DELETE FROM queued_capture WHERE id = " +
            "(SELECT id FROM queued_capture WHERE state = 'pending' " +
            "ORDER BY createdAt ASC LIMIT 1)",
    )
    suspend fun evictOldestPending(): Int

    @Query("SELECT COUNT(*) FROM queued_capture")
    suspend fun total(): Int
}
