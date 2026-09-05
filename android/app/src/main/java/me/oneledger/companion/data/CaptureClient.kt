package me.oneledger.companion.data

import kotlinx.serialization.json.Json
import me.oneledger.companion.BuildConfig
import me.oneledger.companion.data.model.CaptureEnvelope
import me.oneledger.companion.data.model.CaptureResponseBody
import me.oneledger.companion.data.model.PairRequest
import me.oneledger.companion.data.model.PairResponse
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Outcome of a `pair` attempt. */
sealed interface PairOutcome {
    data class Success(val deviceId: String, val captureUrl: String) : PairOutcome
    /** Server reached, pairing refused. [code] is the machine reason
     *  (`PAIRING_EXPIRED`, `PAIRING_ALREADY_USED`, …) or `"FEATURE_OFF"` on 404. */
    data class Rejected(val code: String, val httpStatus: Int) : PairOutcome
    data class Network(val message: String) : PairOutcome
}

/** Outcome of a `capture` / `test` send. [me.oneledger.companion.work.CaptureUploadWorker]
 *  maps these to keep / delete / dead-letter / stop decisions (ADR 0010 §4). */
sealed interface SendOutcome {
    /** `202 queued` or `200 duplicate` — the row is done, delete it. */
    data object Accepted : SendOutcome
    /** `422 UNKNOWN_PROVIDER` / `400 INVALID_CAPTURE_PAYLOAD` — the server will
     *  never accept this row; drop it and record a health event. */
    data class PermanentReject(val code: String) : SendOutcome
    /** `401` — the device credential is gone. Stop the worker, flag re-auth. */
    data object Unauthorized : SendOutcome
    /** `429` / `5xx` / transport failure — increment attempt and retry later. */
    data class Retry(val reason: String) : SendOutcome
}

/**
 * The single HTTP surface between the companion and OneLedger. Every call goes
 * to the one `/capture` endpoint (ADR 0008 §3). No other host is contacted.
 */
class CaptureClient(
    private val deviceStore: DeviceStore,
    private val http: OkHttpClient = defaultHttp(),
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
) {
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    /** Base URL for `op:"pair"` before a `capture_url` has been issued. */
    private fun pairEndpoint(): String =
        deviceStore.captureUrl ?: "${BuildConfig.DEFAULT_CAPTURE_BASE_URL}/capture"

    /** Endpoint for authenticated ops. Requires a completed pairing. */
    private fun captureEndpoint(): String =
        deviceStore.captureUrl ?: error("not paired")

    fun pair(pairingToken: String, deviceSecret: String, deviceLabel: String?): PairOutcome {
        val payload = json.encodeToString(
            PairRequest.serializer(),
            PairRequest(
                pairingToken = pairingToken,
                deviceSecret = deviceSecret,
                clientVersion = BuildConfig.VERSION_NAME,
                platform = "android",
                deviceLabel = deviceLabel,
            ),
        )
        val request = Request.Builder()
            .url(pairEndpoint())
            .post(payload.toRequestBody(jsonMedia))
            .build()

        val (status, bodyText) = try {
            execute(request)
        } catch (e: IOException) {
            return PairOutcome.Network(e.messageForLog())
        }

        if (status == 404) return PairOutcome.Rejected("FEATURE_OFF", 404)

        val parsed = runCatching {
            json.decodeFromString(PairResponse.serializer(), bodyText)
        }.getOrNull()

        return if (status in 200..299 && parsed?.ok == true &&
            parsed.deviceId != null && parsed.captureUrl != null
        ) {
            PairOutcome.Success(parsed.deviceId, parsed.captureUrl)
        } else {
            PairOutcome.Rejected(parsed?.error ?: "PAIRING_INVALID", status)
        }
    }

    /** `op:"test"` — proves the credential authenticates. Writes no ledger data.
     *  `op` is what routes the request server-side; no `metadata.test` needed. */
    fun test(): SendOutcome = send(op = "test", message = null, receivedAtIso = nowIso())

    /** `op:"capture"` — a real matched notification. */
    fun capture(message: String, receivedAtIso: String): SendOutcome =
        send(op = "capture", message = message, receivedAtIso = receivedAtIso)

    private fun send(op: String, message: String?, receivedAtIso: String): SendOutcome {
        val secret = deviceStore.deviceSecret ?: return SendOutcome.Unauthorized
        val payload = json.encodeToString(
            CaptureEnvelope.serializer(),
            CaptureEnvelope(
                op = op,
                message = message,
                receivedAt = receivedAtIso,
                clientVersion = BuildConfig.VERSION_NAME,
            ),
        )
        val request = Request.Builder()
            .url(captureEndpoint())
            .header("x-device-key", secret)
            .post(payload.toRequestBody(jsonMedia))
            .build()

        val (status, bodyText) = try {
            execute(request)
        } catch (e: IOException) {
            return SendOutcome.Retry(e.messageForLog())
        }

        val parsed = runCatching {
            json.decodeFromString(CaptureResponseBody.serializer(), bodyText)
        }.getOrNull()

        return when {
            status == 202 || status == 200 -> SendOutcome.Accepted
            status == 401 -> SendOutcome.Unauthorized
            status == 422 || status == 400 ->
                SendOutcome.PermanentReject(parsed?.error ?: "REJECTED_$status")
            status == 429 -> SendOutcome.Retry("rate_limited")
            status in 500..599 -> SendOutcome.Retry("server_$status")
            else -> SendOutcome.Retry("http_$status")
        }
    }

    /** One blocking round trip. Returns (status, body); body is drained and the
     *  response closed before returning. */
    private fun execute(request: Request): Pair<Int, String> {
        http.newCall(request).execute().use { resp ->
            return resp.code to (resp.body?.string().orEmpty())
        }
    }

    private companion object {
        fun defaultHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .callTimeout(40, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .apply {
                if (BuildConfig.DEBUG) {
                    // BASIC = method, URL, status, timing. No headers (so no
                    // x-device-key), no bodies (so no message text). Debug only.
                    addInterceptor(
                        HttpLoggingInterceptor().apply {
                            level = HttpLoggingInterceptor.Level.BASIC
                        },
                    )
                }
            }
            .build()

        fun nowIso(): String = java.time.Instant.now().toString()

        /** Never log the exception's full text — it can echo a URL with a token
         *  when a redirect misfires. Class name only. */
        fun Throwable.messageForLog(): String = "io:${this.javaClass.simpleName}"
    }
}
