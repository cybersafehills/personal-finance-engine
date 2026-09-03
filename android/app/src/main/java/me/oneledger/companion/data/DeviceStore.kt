package me.oneledger.companion.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * The device credential and its routing metadata, at rest in
 * `EncryptedSharedPreferences` (AES-256; StrongBox-backed key where the device
 * has it). ADR 0010 §3: the `pfe_…` secret is written once at pair time, read
 * only by [CaptureClient], and never rendered, logged, or put in a crash report.
 */
class DeviceStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .setRequestStrongBoxBacked(true)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "oneledger_device",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    val isPaired: Boolean get() = deviceSecret != null && captureUrl != null

    var deviceSecret: String?
        get() = prefs.getString(KEY_SECRET, null)
        private set(value) = prefs.edit().putString(KEY_SECRET, value).apply()

    var captureUrl: String?
        get() = prefs.getString(KEY_CAPTURE_URL, null)
        private set(value) = prefs.edit().putString(KEY_CAPTURE_URL, value).apply()

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        private set(value) = prefs.edit().putString(KEY_DEVICE_ID, value).apply()

    var lastSuccessAtMs: Long
        get() = prefs.getLong(KEY_LAST_SUCCESS, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_SUCCESS, value).apply()

    var lastErrorCode: String?
        get() = prefs.getString(KEY_LAST_ERROR, null)
        set(value) = prefs.edit().putString(KEY_LAST_ERROR, value).apply()

    /** Persist the result of a successful `op:"pair"`. */
    fun savePairing(deviceId: String, deviceSecret: String, captureUrl: String) {
        prefs.edit()
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_SECRET, deviceSecret)
            .putString(KEY_CAPTURE_URL, captureUrl)
            .remove(KEY_LAST_ERROR)
            .apply()
    }

    /** Full local wipe on user-initiated disconnect. Does not touch the server;
     *  the user revokes the device from the OneLedger web app. */
    fun clear() = prefs.edit().clear().apply()

    private companion object {
        const val KEY_SECRET = "device_secret"
        const val KEY_CAPTURE_URL = "capture_url"
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_LAST_SUCCESS = "last_success_at"
        const val KEY_LAST_ERROR = "last_error_code"
    }
}
