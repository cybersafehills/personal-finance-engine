package me.oneledger.companion.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The universal capture envelope, validated server-side by
 * `validateCaptureEnvelope` in `supabase/functions/_shared/pairing.ts`.
 * Unknown top-level keys are rejected there, so this type stays minimal.
 */
@Serializable
data class CaptureEnvelope(
    val op: String,
    val message: String? = null,
    @SerialName("received_at") val receivedAt: String,
    @SerialName("client_version") val clientVersion: String,
    val metadata: Map<String, String> = emptyMap(),
)

@Serializable
data class PairRequest(
    val op: String = "pair",
    @SerialName("pairing_token") val pairingToken: String,
    @SerialName("device_secret") val deviceSecret: String,
    @SerialName("client_version") val clientVersion: String,
    val platform: String = "android",
    @SerialName("device_label") val deviceLabel: String? = null,
)

@Serializable
data class PairResponse(
    val ok: Boolean = false,
    @SerialName("device_id") val deviceId: String? = null,
    @SerialName("capture_url") val captureUrl: String? = null,
    val error: String? = null,
)

/** Shape of the non-pair responses (`{ok, status?, error?, event_id?}`). */
@Serializable
data class CaptureResponseBody(
    val ok: Boolean = false,
    val status: String? = null,
    val error: String? = null,
    @SerialName("event_id") val eventId: String? = null,
    val test: Boolean? = null,
)
