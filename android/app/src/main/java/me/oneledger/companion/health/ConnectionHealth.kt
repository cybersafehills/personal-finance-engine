package me.oneledger.companion.health

import me.oneledger.companion.queue.QueueStats

/**
 * Connection health, mapped to the master brief §19 vocabulary. Derived — never
 * a stored mutable flag (ADR 0010 §5).
 */
enum class HealthState {
    SETUP_REQUIRED,
    PERMISSION_REQUIRED,
    ACTIVE,
    DEGRADED,
    REAUTHENTICATION_REQUIRED,
    SEND_FAILED_PERMANENT,
}

data class HealthSnapshot(
    val state: HealthState,
    val lastSuccessAtMs: Long,
    val pendingCount: Int,
    val deadCount: Int,
    val detail: String,
)

object ConnectionHealth {

    private const val DEGRADED_QUEUE_AGE_MS = 30 * 60 * 1000L
    private const val STALE_SUCCESS_MS = 48 * 60 * 60 * 1000L

    /**
     * @param isPaired          a device credential is stored
     * @param listenerEnabled   the OS grants notification-listener access
     * @param reauthRequired    the last send returned 401
     */
    fun evaluate(
        isPaired: Boolean,
        listenerEnabled: Boolean,
        reauthRequired: Boolean,
        queue: QueueStats,
        lastSuccessAtMs: Long,
        now: Long = System.currentTimeMillis(),
    ): HealthSnapshot {
        val state = when {
            !isPaired -> HealthState.SETUP_REQUIRED
            reauthRequired -> HealthState.REAUTHENTICATION_REQUIRED
            !listenerEnabled -> HealthState.PERMISSION_REQUIRED
            queue.dead > 0 -> HealthState.SEND_FAILED_PERMANENT
            queue.oldestPendingAgeMs > DEGRADED_QUEUE_AGE_MS -> HealthState.DEGRADED
            lastSuccessAtMs > 0 && now - lastSuccessAtMs > STALE_SUCCESS_MS && queue.pending > 0 ->
                HealthState.DEGRADED
            else -> HealthState.ACTIVE
        }
        return HealthSnapshot(
            state = state,
            lastSuccessAtMs = lastSuccessAtMs,
            pendingCount = queue.pending,
            deadCount = queue.dead,
            detail = detailFor(state, queue),
        )
    }

    private fun detailFor(state: HealthState, queue: QueueStats): String = when (state) {
        HealthState.SETUP_REQUIRED -> "Pair this phone with OneLedger to start."
        HealthState.PERMISSION_REQUIRED ->
            "Notification access is off. OneLedger can't see new transactions until you turn it back on."
        HealthState.REAUTHENTICATION_REQUIRED ->
            "This phone was disconnected from OneLedger. Pair it again to resume."
        HealthState.SEND_FAILED_PERMANENT ->
            "${queue.dead} message(s) couldn't be delivered. Open OneLedger on the web to check."
        HealthState.DEGRADED ->
            "${queue.pending} message(s) waiting to sync — usually clears on its own."
        HealthState.ACTIVE -> "Connected. New transactions sync automatically."
    }
}
