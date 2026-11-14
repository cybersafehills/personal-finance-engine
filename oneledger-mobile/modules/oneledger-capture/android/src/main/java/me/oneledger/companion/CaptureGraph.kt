package me.oneledger.companion

import android.content.Context
import me.oneledger.companion.data.CaptureClient
import me.oneledger.companion.data.DeviceStore
import me.oneledger.companion.data.PairingManager
import me.oneledger.companion.health.HealthRepository
import me.oneledger.companion.queue.CaptureQueueDatabase
import me.oneledger.companion.queue.CaptureQueueRepository

/**
 * Manual DI graph for the capture engine: lazily-created process singletons.
 *
 * Replaces the companion's `Application`-held graph. It must be reachable
 * from the notification listener and the upload worker when NO activity and
 * NO JavaScript runtime exist (the app is killed), so it hangs off the
 * application context rather than anything React Native owns.
 */
class CaptureGraph private constructor(context: Context) {
    private val appContext: Context = context.applicationContext

    val deviceStore: DeviceStore by lazy { DeviceStore(appContext) }
    private val db: CaptureQueueDatabase by lazy { CaptureQueueDatabase.get(appContext) }
    val queue: CaptureQueueRepository by lazy { CaptureQueueRepository(db.dao()) }
    val captureClient: CaptureClient by lazy {
        CaptureClient(
            deviceStore = deviceStore,
            clientVersion = CaptureConfig.clientVersion(appContext),
            debug = CaptureConfig.DEBUG,
        )
    }
    val health: HealthRepository by lazy { HealthRepository(appContext, deviceStore, queue) }
    val pairing: PairingManager by lazy { PairingManager(appContext, captureClient, deviceStore) }

    companion object {
        @Volatile private var instance: CaptureGraph? = null

        fun get(context: Context): CaptureGraph =
            instance ?: synchronized(this) {
                instance ?: run {
                    CaptureConfig.DEBUG = CaptureConfig.isDebuggable(context)
                    CaptureGraph(context).also { instance = it }
                }
            }
    }
}
