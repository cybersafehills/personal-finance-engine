# --- kotlinx.serialization -------------------------------------------------
# kotlinx-serialization 1.7 ships consumer rules; these pin our own model
# package explicitly so R8 can't strip generated serializers or backing fields.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keep,includedescriptorclasses class me.oneledger.companion.data.model.**$$serializer { *; }
-keepclassmembers class me.oneledger.companion.data.model.** {
    *** Companion;
    <fields>;
}
-keepclasseswithmembers class me.oneledger.companion.data.model.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# --- OkHttp / Okio -------------------------------------------------------------
# Optional runtime deps OkHttp references but we don't ship.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# --- Room --------------------------------------------------------------------
# Room ships consumer rules; keep the DB no-arg ctor defensively.
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-dontwarn androidx.room.paging.**

# --- WorkManager ------------------------------------------------------------
# The worker is instantiated by name from the merged manifest.
-keep class me.oneledger.companion.work.CaptureUploadWorker { <init>(...); }

# --- EncryptedSharedPreferences (Tink) ------------------------------------
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**

# --- ML Kit barcode (bundled) + CameraX ----------------------------------
# Both ship consumer rules; keep the model-loading internals and silence
# optional-dependency warnings.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_barcode.** { *; }
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.**
-dontwarn androidx.camera.**
