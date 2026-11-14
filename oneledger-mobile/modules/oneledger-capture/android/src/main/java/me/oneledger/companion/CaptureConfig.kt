package me.oneledger.companion

import android.content.Context
import android.content.pm.ApplicationInfo

/**
 * Build-independent configuration for the capture engine. The standalone
 * companion read these from its app `BuildConfig`; as a library inside the
 * OneLedger app it derives them from the host app at runtime instead.
 */
object CaptureConfig {

    /**
     * OneLedger's single Supabase Functions host (a public identifier, see
     * .github/workflows/deploy-supabase.yml). Used ONLY for the first
     * `op:"pair"` call; every request after that uses the `capture_url` the
     * server returns at pair time (ADR 0008 §3).
     */
    const val DEFAULT_CAPTURE_BASE_URL = "https://zttxsaiywkfrbdxgzbjd.functions.supabase.co"

    /** Verbose logcat output. True only in a debuggable host build; set once
     *  when [CaptureGraph] is created. Log lines never include message text. */
    @Volatile
    var DEBUG: Boolean = false
        internal set

    fun isDebuggable(context: Context): Boolean =
        (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    /** The host app's version, coerced to the `^\d+\.\d+\.\d+$` the server requires. */
    fun clientVersion(context: Context): String = normalizeClientVersion(
        runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull(),
    )
}

private val SEMVER_CORE = Regex("\\d+\\.\\d+\\.\\d+")

/** First `major.minor.patch` in [raw], or `0.0.0` when there is none. */
fun normalizeClientVersion(raw: String?): String =
    raw?.let { SEMVER_CORE.find(it)?.value } ?: "0.0.0"
