package me.oneledger.companion.ui

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import me.oneledger.companion.health.HealthSnapshot
import me.oneledger.companion.health.HealthState

@Composable
fun CompanionScreen(state: CompanionUiState, vm: CompanionViewModel) {
    val context = LocalContext.current
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("OL Shortcuts", style = MaterialTheme.typography.headlineSmall)

        when {
            state.loading && state.health == null ->
                CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally))

            state.health?.state == HealthState.SETUP_REQUIRED ->
                PairPane(state, vm)

            else ->
                ConnectedPane(state.health, context, vm)
        }
    }
}

@Composable
private fun PairPane(state: CompanionUiState, vm: CompanionViewModel) {
    var token by remember(state.prefillToken) { mutableStateOf(state.prefillToken.orEmpty()) }

    Text(
        "This app watches your phone's notifications for supported financial " +
            "messages (MTN MoMo today) and sends only those to OneLedger. " +
            "It never reads SMS and never sends anything else — other " +
            "notifications are ignored on the device.",
        style = MaterialTheme.typography.bodyMedium,
    )
    Text(
        "1. In OneLedger on the web, add a connection for this phone and get a pairing code.",
        style = MaterialTheme.typography.bodyMedium,
    )
    OutlinedTextField(
        value = token,
        onValueChange = { token = it },
        label = { Text("Pairing code (olp_…)") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth(),
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = ImeAction.Done),
    )
    state.pairError?.let {
        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
    }
    Button(
        onClick = { vm.pair(token, deviceLabel = android.os.Build.MODEL) },
        enabled = !state.pairing && token.isNotBlank(),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(if (state.pairing) "Pairing…" else "Pair this phone")
    }
}

@Composable
private fun ConnectedPane(health: HealthSnapshot?, context: Context, vm: CompanionViewModel) {
    health ?: return
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(health.state.label(), style = MaterialTheme.typography.titleMedium)
            Text(health.detail, style = MaterialTheme.typography.bodyMedium)
            if (health.pendingCount > 0) Text("Waiting to sync: ${health.pendingCount}")
            if (health.deadCount > 0) Text("Undelivered: ${health.deadCount}")
        }
    }

    if (health.state == HealthState.PERMISSION_REQUIRED) {
        Button(
            onClick = { context.startActivity(notificationAccessIntent()) },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Turn on notification access") }
    }

    if (health.state == HealthState.REAUTHENTICATION_REQUIRED) {
        Button(onClick = { vm.disconnect() }, modifier = Modifier.fillMaxWidth()) {
            Text("Re-pair this phone")
        }
    }

    OutlinedButton(onClick = { vm.refresh() }, modifier = Modifier.fillMaxWidth()) {
        Text("Refresh status")
    }
    OutlinedButton(onClick = { vm.disconnect() }, modifier = Modifier.fillMaxWidth()) {
        Text("Disconnect this phone")
    }
    Text(
        "Disconnecting wipes this phone's credential. To fully revoke it, also " +
            "remove the connection in OneLedger on the web.",
        style = MaterialTheme.typography.bodySmall,
    )
}

private fun notificationAccessIntent() =
    Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

private fun HealthState.label(): String = when (this) {
    HealthState.SETUP_REQUIRED -> "Not connected"
    HealthState.PERMISSION_REQUIRED -> "Action needed"
    HealthState.ACTIVE -> "Connected"
    HealthState.DEGRADED -> "Syncing…"
    HealthState.REAUTHENTICATION_REQUIRED -> "Disconnected"
    HealthState.SEND_FAILED_PERMANENT -> "Needs attention"
}
