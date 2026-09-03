package me.oneledger.companion.queue

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CaptureQueueRepositoryTest {

    private lateinit var db: CaptureQueueDatabase
    private lateinit var repo: CaptureQueueRepository

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            CaptureQueueDatabase::class.java,
        ).allowMainThreadQueries().build()
        repo = CaptureQueueRepository(db.dao())
    }

    @After fun tearDown() = db.close()

    private val msg = "Y'ello. Payment of 5,000 RWF completed. TxId: 1."

    @Test fun same_message_same_minute_is_dropped_as_duplicate() = runBlocking {
        val a = repo.enqueue("mtn_momo", msg, "2026-01-02T10:15:03Z", "com.android.mms")
        val b = repo.enqueue("mtn_momo", msg, "2026-01-02T10:15:59Z", "com.android.mms")
        assertEquals(EnqueueResult.ENQUEUED, a)
        assertEquals(EnqueueResult.DUPLICATE_DROPPED, b)
        assertEquals(1, repo.stats().pending)
    }

    @Test fun overflow_evicts_oldest_pending() = runBlocking {
        repeat(QueuedCapture.MAX_ROWS) { i ->
            repo.enqueue("mtn_momo", "msg $i RWF TxId: $i", "2026-01-02T10:${"%02d".format(i % 60)}:00Z", "p")
        }
        val result = repo.enqueue("mtn_momo", "msg overflow RWF TxId: X", "2026-02-01T00:00:00Z", "p")
        assertEquals(EnqueueResult.EVICTED_TO_FIT, result)
        assertTrue(db.dao().total() <= QueuedCapture.MAX_ROWS)
    }

    @Test fun retryable_failure_dead_letters_past_the_cap() = runBlocking {
        repo.enqueue("mtn_momo", msg, "2026-01-02T10:15:03Z", "p")
        val row = repo.nextBatch().single()
        var retryable = true
        var attempt = row.attemptCount
        while (retryable) {
            retryable = repo.onRetryableFailure(row.id, attempt, "server_500")
            attempt++
        }
        assertFalse(retryable)
        assertEquals(0, repo.stats().pending)
        assertEquals(1, repo.stats().dead)
    }

    @Test fun delivered_row_is_removed() = runBlocking {
        repo.enqueue("mtn_momo", msg, "2026-01-02T10:15:03Z", "p")
        val row = repo.nextBatch().single()
        repo.onDelivered(row.id)
        assertEquals(0, db.dao().total())
    }
}
