package me.oneledger.companion.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import me.oneledger.companion.util.generateDeviceSecret
import me.oneledger.companion.work.CaptureScheduler

sealed interface PairingUiResult {
    data object Success : PairingUiResult
    data class Failed(val userMessage: String) : PairingUiResult
}

/** Orchestrates one pairing attempt end to end (ADR 0010 §3). */
class PairingManager(
    private val appContext: Context,
    private val client: CaptureClient,
    private val store: DeviceStore,
) {
    fun looksLikeToken(raw: String): Boolean = looksLikePairingToken(raw)

    suspend fun pair(rawInput: String, deviceLabel: String?): PairingUiResult = withContext(Dispatchers.IO) {
        // Accept a bare code, a deep link, or a handoff URL.
        val token = extractPairingToken(rawInput)
        if (token == null) {
            return@withContext PairingUiResult.Failed("That code doesn't look right. Get a fresh one from OneLedger.")
        }

        val secret = generateDeviceSecret()
        when (val outcome = client.pair(token, secret, deviceLabel)) {
            is PairOutcome.Success -> {
                store.savePairing(outcome.deviceId, secret, outcome.captureUrl)
                CaptureScheduler.ensurePeriodic(appContext)
                // A test send proves the credential + endpoint before the user
                // walks away. Writes no ledger data; lights up the web "Verify" step.
                client.test()
                store.lastSuccessAtMs = System.currentTimeMillis()
                PairingUiResult.Success
            }
            is PairOutcome.Rejected -> PairingUiResult.Failed(messageFor(outcome.code))
            is PairOutcome.Network ->
                PairingUiResult.Failed("Couldn't reach OneLedger. Check your connection and try again.")
        }
    }

    private fun messageFor(code: String): String = when (code) {
        "PAIRING_EXPIRED" -> "That code has expired. Get a new one from OneLedger."
        "PAIRING_ALREADY_USED" -> "That code was already used. Get a new one from OneLedger."
        "PAIRING_NO_ROUTE" -> "OneLedger needs an account chosen for this phone first."
        "FEATURE_OFF" -> "OneLedger isn't accepting new phone connections yet."
        else -> "That code isn't valid. Get a fresh one from OneLedger."
    }
}
