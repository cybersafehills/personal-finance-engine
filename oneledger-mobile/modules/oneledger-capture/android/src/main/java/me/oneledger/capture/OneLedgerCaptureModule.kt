package me.oneledger.capture

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import me.oneledger.companion.CaptureGraph
import me.oneledger.companion.data.PairingUiResult
import me.oneledger.companion.data.SendOutcome
import me.oneledger.companion.data.extractPairingToken
import me.oneledger.companion.service.CaptureNotificationListenerService
import me.oneledger.companion.work.CaptureScheduler

/**
 * The JavaScript-facing surface of the capture engine (ADR 0019 §2).
 *
 * Deliberately thin: JS can pair, read health, open the system settings
 * screen and disconnect. It can NOT read the device secret, the queue
 * contents or any message text; none of that ever crosses this bridge.
 * Capture itself (listener -> queue -> upload worker) runs natively and
 * does not need this module, or any JS runtime, to be alive.
 */
class OneLedgerCaptureModule : Module() {

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OneLedgerCapture")

    OnCreate {
      // Once per app launch, mirroring the companion's MainActivity.onCreate:
      // keep the periodic drain scheduled, and recover a listener binding
      // that Android dropped on the last app update.
      runCatching {
        val ctx = context
        CaptureScheduler.ensurePeriodic(ctx)
        CaptureNotificationListenerService.ensureBound(ctx)
      }
    }

    /** Whether the user has granted notification access in system settings. */
    Function("isNotificationAccessGranted") {
      val ctx = context
      NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)
    }

    /** Opens Settings > Notification access. The permission cannot be requested in-app. */
    Function("openNotificationAccessSettings") {
      context.startActivity(
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }

    /** The `olp_...` token inside a pasted code, deep link or handoff URL, or null. */
    Function("extractPairingToken") { raw: String ->
      extractPairingToken(raw)
    }

    AsyncFunction("getHealth") Coroutine { ->
      val ctx = context
      val graph = CaptureGraph.get(ctx)
      val snapshot = withContext(Dispatchers.IO) { graph.health.snapshot() }
      mapOf(
        "state" to snapshot.state.name.lowercase(),
        "detail" to snapshot.detail,
        "paired" to graph.deviceStore.isPaired,
        "notificationAccessGranted" to
          NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName),
        "lastSuccessAtMs" to snapshot.lastSuccessAtMs.toDouble(),
        "pendingCount" to snapshot.pendingCount,
        "deadCount" to snapshot.deadCount,
      )
    }

    /** Redeems a pairing code. The device secret is generated and kept natively. */
    AsyncFunction("pair") Coroutine { input: String ->
      val graph = CaptureGraph.get(context)
      when (val result = graph.pairing.pair(input, Build.MODEL)) {
        is PairingUiResult.Success -> mapOf("ok" to true)
        is PairingUiResult.Failed -> mapOf("ok" to false, "message" to result.userMessage)
      }
    }

    /** `op:"test"`: proves the stored credential still works. Writes no ledger data. */
    AsyncFunction("sendTest") Coroutine { ->
      val graph = CaptureGraph.get(context)
      if (!graph.deviceStore.isPaired) return@Coroutine "not_paired"
      when (withContext(Dispatchers.IO) { graph.captureClient.test() }) {
        is SendOutcome.Accepted -> {
          graph.deviceStore.lastSuccessAtMs = System.currentTimeMillis()
          graph.deviceStore.lastErrorCode = null
          "ok"
        }
        is SendOutcome.Unauthorized -> {
          graph.deviceStore.lastErrorCode = "reauth"
          "reauthentication_required"
        }
        is SendOutcome.PermanentReject -> "rejected"
        is SendOutcome.Retry -> "unreachable"
      }
    }

    /**
     * Local wipe of the credential (same as the companion's Disconnect). Does
     * not touch the server; the phone is revoked from the OneLedger web app.
     */
    AsyncFunction("disconnect") Coroutine { ->
      val graph = CaptureGraph.get(context)
      withContext(Dispatchers.IO) { graph.deviceStore.clear() }
    }
  }
}
