# Applied to the host app's R8 run.

# OkHttp / Okio: optional runtime deps they reference but we don't ship.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Room ships consumer rules; keep the DB no-arg ctor defensively.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-dontwarn androidx.room.paging.**

# Instantiated by name from the merged manifest / WorkManager.
-keep class me.oneledger.companion.service.CaptureNotificationListenerService { *; }
-keep class me.oneledger.companion.work.BootCompletedReceiver { *; }
-keep class me.oneledger.companion.work.CaptureUploadWorker { *; }
