package me.oneledger.companion.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import me.oneledger.companion.OneLedgerCompanionApp
import me.oneledger.companion.data.PairingManager
import me.oneledger.companion.data.PairingUiResult
import me.oneledger.companion.data.extractPairingToken
import me.oneledger.companion.health.HealthSnapshot
import me.oneledger.companion.health.HealthState

data class CompanionUiState(
    val loading: Boolean = true,
    val health: HealthSnapshot? = null,
    val pairing: Boolean = false,
    val pairError: String? = null,
    val prefillToken: String? = null,
)

class CompanionViewModel(app: Application) : AndroidViewModel(app) {

    private val graph = OneLedgerCompanionApp.graph()
    private val pairingManager = PairingManager(
        appContext = app.applicationContext,
        client = graph.captureClient,
        store = graph.deviceStore,
    )

    private val _state = MutableStateFlow(CompanionUiState())
    val state: StateFlow<CompanionUiState> = _state.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            val snap = graph.health.snapshot()
            _state.value = _state.value.copy(loading = false, health = snap)
        }
    }

    /** A deep link (`oneledger://pair?c=…`) or a scanned QR. Accepts a bare
     *  code, a deep link, or a handoff URL; pairs immediately when [autoPair]. */
    fun submitPairingInput(raw: String?, autoPair: Boolean) {
        val token = extractPairingToken(raw)
        if (token == null) {
            if (!raw.isNullOrBlank()) {
                _state.value = _state.value.copy(
                    pairError = "That isn't a OneLedger pairing code.",
                )
            }
            return
        }
        _state.value = _state.value.copy(prefillToken = token, pairError = null)
        if (autoPair) pair(token, android.os.Build.MODEL)
    }

    fun pair(rawToken: String, deviceLabel: String?) {
        if (_state.value.pairing) return
        viewModelScope.launch {
            _state.value = _state.value.copy(pairing = true, pairError = null)
            when (val result = pairingManager.pair(rawToken, deviceLabel)) {
                is PairingUiResult.Success -> {
                    _state.value = _state.value.copy(pairing = false, prefillToken = null)
                    refresh()
                }
                is PairingUiResult.Failed ->
                    _state.value = _state.value.copy(pairing = false, pairError = result.userMessage)
            }
        }
    }

    fun disconnect() {
        viewModelScope.launch {
            graph.deviceStore.clear()
            refresh()
        }
    }

    val isPaired: Boolean
        get() = _state.value.health?.state != HealthState.SETUP_REQUIRED &&
            graph.deviceStore.isPaired
}
