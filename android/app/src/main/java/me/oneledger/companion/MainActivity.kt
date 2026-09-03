package me.oneledger.companion

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch
import me.oneledger.companion.ui.CompanionScreen
import me.oneledger.companion.ui.CompanionViewModel
import me.oneledger.companion.ui.theme.OneLedgerCompanionTheme
import me.oneledger.companion.work.CaptureScheduler

class MainActivity : ComponentActivity() {

    private val vm: CompanionViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CaptureScheduler.ensurePeriodic(applicationContext)
        handleDeepLink(intent)

        setContent {
            OneLedgerCompanionTheme {
                val state by vm.state.collectAsState()
                CompanionScreen(state = state, vm = vm)
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.RESUMED) { vm.refresh() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    /** oneledger://pair?c=<olp_ token> from the web wizard / QR. */
    private fun handleDeepLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "oneledger" && data.host == "pair") {
            vm.onDeepLinkToken(data.getQueryParameter("c"))
        }
    }
}
