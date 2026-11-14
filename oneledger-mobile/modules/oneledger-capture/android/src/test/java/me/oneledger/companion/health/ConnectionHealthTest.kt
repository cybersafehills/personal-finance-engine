package me.oneledger.companion.health

import me.oneledger.companion.queue.QueueStats
import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionHealthTest {

    private val empty = QueueStats(pending = 0, dead = 0, oldestPendingAgeMs = 0)

    private fun eval(
        paired: Boolean = true,
        listener: Boolean = true,
        reauth: Boolean = false,
        queue: QueueStats = empty,
        lastSuccess: Long = 0,
        now: Long = 1_000_000_000_000,
    ) = ConnectionHealth.evaluate(paired, listener, reauth, queue, lastSuccess, now).state

    @Test fun not_paired_is_setup_required() =
        assertEquals(HealthState.SETUP_REQUIRED, eval(paired = false))

    @Test fun reauth_beats_permission() =
        assertEquals(HealthState.REAUTHENTICATION_REQUIRED, eval(listener = false, reauth = true))

    @Test fun listener_off_is_permission_required() =
        assertEquals(HealthState.PERMISSION_REQUIRED, eval(listener = false))

    @Test fun dead_rows_surface_as_permanent_failure() =
        assertEquals(
            HealthState.SEND_FAILED_PERMANENT,
            eval(queue = QueueStats(pending = 2, dead = 1, oldestPendingAgeMs = 0)),
        )

    @Test fun aging_queue_is_degraded() =
        assertEquals(
            HealthState.DEGRADED,
            eval(queue = QueueStats(pending = 3, dead = 0, oldestPendingAgeMs = 45 * 60 * 1000L)),
        )

    @Test fun healthy_default_is_active() =
        assertEquals(HealthState.ACTIVE, eval())

    @Test fun stale_success_with_backlog_is_degraded() {
        val now = 10_000_000_000_000L
        val state = ConnectionHealth.evaluate(
            isPaired = true,
            listenerEnabled = true,
            reauthRequired = false,
            queue = QueueStats(pending = 1, dead = 0, oldestPendingAgeMs = 5 * 60 * 1000L),
            lastSuccessAtMs = now - (72L * 60 * 60 * 1000),
            now = now,
        ).state
        assertEquals(HealthState.DEGRADED, state)
    }
}
