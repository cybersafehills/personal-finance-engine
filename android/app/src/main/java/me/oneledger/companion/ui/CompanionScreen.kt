package me.oneledger.companion.ui

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import me.oneledger.companion.R
import me.oneledger.companion.data.looksLikePairingToken
import me.oneledger.companion.health.HealthSnapshot
import me.oneledger.companion.health.HealthState
import me.oneledger.companion.scan.QrScanScreen

@Composable
fun CompanionScreen(state: CompanionUiState, vm: CompanionViewModel) {
    val context = LocalContext.current
    var showScanner by remember { mutableStateOf(false) }

    if (showScanner) {
        QrScanScreen(
            onResult = {
                showScanner = false
                vm.submitPairingInput(it, autoPair = true)
            },
            onDismiss = { showScanner = false },
        )
        return
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        when {
            state.loading && state.health == null ->
                Column(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                }

            state.health?.state == HealthState.SETUP_REQUIRED ->
                PairPane(state, vm, onScan = { showScanner = true })

            else ->
                ConnectedPane(state.health, context, vm)
        }
    }
}

@Composable
private fun Header() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(
            painter = painterResource(R.drawable.ic_ol_mark),
            contentDescription = null,
            tint = Color.Unspecified,
            modifier = Modifier.size(28.dp),
        )
        Text("OL Shortcuts", style = MaterialTheme.typography.headlineSmall)
    }
}

@Composable
private fun Stepper(current: Int) {
    val steps = listOf("Pair", "Allow access", "Done")
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        steps.forEachIndexed { i, label ->
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = if (i == current) FontWeight.SemiBold else FontWeight.Normal,
                color = if (i == current) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            if (i < steps.lastIndex) {
                Text("·", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun PairPane(
    state: CompanionUiState,
    vm: CompanionViewModel,
    onScan: () -> Unit,
) {
    val context = LocalContext.current
    var code by remember(state.prefillToken) { mutableStateOf(state.prefillToken.orEmpty()) }
    var showHow by remember { mutableStateOf(false) }
    val valid = looksLikePairingToken(code)

    Column(
        Modifier
            .fillMaxSize()
            .imePadding(),
    ) {
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Header()
            Stepper(current = 0)

            Text(
                "Only supported transaction alerts (MTN MoMo today) are sent to " +
                    "OneLedger — never your SMS, never anything else.",
                style = MaterialTheme.typography.bodyMedium,
            )
            TextButton(
                onClick = { showHow = !showHow },
                contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp),
            ) {
                Text(if (showHow) "Hide details" else "How this works")
            }
            AnimatedVisibility(showHow) {
                Text(
                    "This app watches this phone's notifications on the device. A " +
                        "notification is inspected only to check it matches a known " +
                        "financial-message pattern; anything that doesn't match is " +
                        "discarded and never leaves the phone. It has no SMS access.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Text("1.  In OneLedger on the web, add a connection for this phone.", style = MaterialTheme.typography.bodyMedium)
            Text("2.  Scan the QR it shows, or enter the code below.", style = MaterialTheme.typography.bodyMedium)

            OutlinedTextField(
                value = code,
                onValueChange = { code = it.trim() },
                label = { Text("Pairing code") },
                placeholder = { Text("olp_…") },
                singleLine = true,
                isError = code.isNotEmpty() && !valid,
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                trailingIcon = {
                    if (valid) {
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = "Looks valid",
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    } else {
                        IconButton(onClick = onScan) {
                            Icon(
                                painter = painterResource(R.drawable.ic_qr_scan),
                                contentDescription = "Scan QR code",
                            )
                        }
                    }
                },
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onScan) { Text("Scan QR") }
                OutlinedButton(onClick = { readClipboardCode(context)?.let { code = it } }) {
                    Text("Paste")
                }
            }

            state.pairError?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
        }

        // Sticky primary action.
        Column(
            Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Button(
                onClick = { vm.pair(code, deviceLabel = android.os.Build.MODEL) },
                enabled = !state.pairing && valid,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(if (state.pairing) "Pairing…" else "Pair this phone")
            }
            if (!valid && !state.pairing) {
                Text(
                    "Scan the QR, or enter the code from OneLedger.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ConnectedPane(health: HealthSnapshot?, context: Context, vm: CompanionViewModel) {
    health ?: return
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Header()
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
        Spacer(Modifier.height(8.dp))
    }
}

private fun readClipboardCode(context: Context): String? {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return null
    val clip = cm.primaryClip?.takeIf { it.itemCount > 0 } ?: return null
    val text = clip.getItemAt(0).coerceToText(context)?.toString()?.trim()
    return me.oneledger.companion.data.extractPairingToken(text)
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
