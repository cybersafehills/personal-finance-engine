package me.oneledger.companion

import android.app.Application
import android.content.Context
import androidx.work.Configuration
import me.oneledger.companion.data.CaptureClient
import me.oneledger.companion.data.DeviceStore
import me.oneledger.companion.health.HealthRepository
import me.oneledger.companion.queue.CaptureQueueDatabase
import me.oneledger.companion.queue.CaptureQueueRepository

/**
 * Manual DI graph. The app is small enough that Hilt would be more wiring than
 * it saves; everything is a lazily-created singleton hung off the Application.
 */
class OneLedgerCompanionApp : Application(), Configuration.Provider {

    val graph: Graph by lazy { Graph(this) }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setMinimumLoggingLevel(android.util.Log.INFO)
            .build()

    class Graph(context: Context) {
        val deviceStore: DeviceStore by lazy { DeviceStore(context) }
        private val db: CaptureQueueDatabase by lazy { CaptureQueueDatabase.get(context) }
        val queue: CaptureQueueRepository by lazy { CaptureQueueRepository(db.dao()) }
        val captureClient: CaptureClient by lazy { CaptureClient(deviceStore) }
        val health: HealthRepository by lazy { HealthRepository(context, deviceStore, queue) }
    }

    companion object {
        private lateinit var instance: OneLedgerCompanionApp
        fun graph(): Graph = instance.graph
    }
}
