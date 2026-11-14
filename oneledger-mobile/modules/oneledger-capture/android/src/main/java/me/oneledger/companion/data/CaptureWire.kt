package me.oneledger.companion.data

import org.json.JSONObject

// The JSON the capture endpoint speaks (docs/device-pairing.md). Built with
// org.json, which ships with Android, so the module needs no serialization
// compiler plugin. Shapes are byte-for-byte what the standalone companion
// sent: every field always present, absent values as JSON null, and an empty
// `metadata` object. The server rejects unknown top-level keys, so nothing
// may be added here without a matching server change.

/** Body of `op:"pair"`. */
fun pairRequestJson(
    pairingToken: String,
    deviceSecret: String,
    clientVersion: String,
    deviceLabel: String?,
): String = JSONObject()
    .put("op", "pair")
    .put("pairing_token", pairingToken)
    .put("device_secret", deviceSecret)
    .put("client_version", clientVersion)
    .put("platform", "android")
    .put("device_label", deviceLabel ?: JSONObject.NULL)
    .toString()

/** The universal capture envelope, for `op:"test"` and `op:"capture"`. */
fun captureEnvelopeJson(
    op: String,
    message: String?,
    receivedAt: String,
    clientVersion: String,
): String = JSONObject()
    .put("op", op)
    .put("message", message ?: JSONObject.NULL)
    .put("received_at", receivedAt)
    .put("client_version", clientVersion)
    .put("metadata", JSONObject())
    .toString()

data class PairResponse(
    val ok: Boolean,
    val deviceId: String?,
    val captureUrl: String?,
    val error: String?,
)

/** Parses a pair response; null when the body is not a JSON object. */
fun parsePairResponse(body: String): PairResponse? {
    val json = runCatching { JSONObject(body) }.getOrNull() ?: return null
    return PairResponse(
        ok = json.optBoolean("ok", false),
        deviceId = json.stringOrNull("device_id"),
        captureUrl = json.stringOrNull("capture_url"),
        error = json.stringOrNull("error"),
    )
}

/** The machine `error` code of a non-pair response, if any. */
fun parseErrorCode(body: String): String? =
    runCatching { JSONObject(body) }.getOrNull()?.stringOrNull("error")

private fun JSONObject.stringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotEmpty() } else null
