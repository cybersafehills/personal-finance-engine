package me.oneledger.companion.queue

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [QueuedCapture::class], version = 1, exportSchema = false)
abstract class CaptureQueueDatabase : RoomDatabase() {
    abstract fun dao(): QueuedCaptureDao

    companion object {
        @Volatile private var instance: CaptureQueueDatabase? = null

        fun get(context: Context): CaptureQueueDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    CaptureQueueDatabase::class.java,
                    "capture_queue.db",
                ).build().also { instance = it }
            }
    }
}
