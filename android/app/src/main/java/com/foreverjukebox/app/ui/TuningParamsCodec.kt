package com.foreverjukebox.app.ui

import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

data class ParsedTuningParams(
    val threshold: Int?,
    val minProbPercent: Int?,
    val maxProbPercent: Int?,
    val rampPercent: Int?,
    val justBackwards: Boolean?,
    val justLongBranches: Boolean?,
    val removeSequentialBranches: Boolean?,
    val highlightAnchorBranch: Boolean?,
    val deletedEdgeIds: List<Int>
)

object TuningParamsCodec {
    private val knownKeys = setOf("jb", "lg", "sq", "thresh", "bp", "d", "ah")

    fun parse(raw: String?, minThreshold: Int = 0): ParsedTuningParams? {
        if (raw.isNullOrBlank()) {
            return null
        }
        val params = parseQuery(raw)
        if (params.keys.none { it in knownKeys }) {
            return null
        }
        val threshold = params.firstValue("thresh")
            ?.toIntOrNull()
            ?.takeIf { it >= minThreshold }

        var minProbPercent: Int? = null
        var maxProbPercent: Int? = null
        var rampPercent: Int? = null
        params.firstValue("bp")?.split(",")?.let { parts ->
            if (parts.size == 3) {
                minProbPercent = parts[0].toIntOrNull()?.coerceIn(0, 100)
                maxProbPercent = parts[1].toIntOrNull()?.coerceIn(0, 100)
                rampPercent = parts[2].toIntOrNull()?.coerceIn(0, 100)
            }
        }

        val deletedEdgeIds = params.firstValue("d")
            ?.split(",")
            ?.mapNotNull { it.toIntOrNull()?.takeIf { id -> id >= 0 } }
            ?: emptyList()

        return ParsedTuningParams(
            threshold = threshold,
            minProbPercent = minProbPercent,
            maxProbPercent = maxProbPercent,
            rampPercent = rampPercent,
            justBackwards = parseStandardBoolean(params.firstValue("jb")),
            justLongBranches = parseStandardBoolean(params.firstValue("lg")),
            removeSequentialBranches = parseRemoveSequential(params.firstValue("sq")),
            highlightAnchorBranch = parseStandardBoolean(params.firstValue("ah")),
            deletedEdgeIds = deletedEdgeIds
        )
    }

    fun buildCastLoadPayload(raw: String?, highlightAnchorBranch: Boolean): String? {
        if (raw.isNullOrBlank()) {
            return if (highlightAnchorBranch) "ah=1" else "ah=0"
        }
        val params = parseQuery(raw).toMutableMap()
        val sanitized = linkedMapOf<String, String>()
        for ((name, values) in params) {
            val value = values.firstOrNull() ?: continue
            if (name == "thresh") {
                val threshold = value.toIntOrNull()
                if (threshold == null || threshold < 2) {
                    continue
                }
            }
            sanitized[name] = value
        }
        sanitized["ah"] = if (highlightAnchorBranch) "1" else "0"
        return encodeQuery(sanitized).ifBlank { null }
    }

    fun buildFromTuningState(tuning: TuningState): String {
        return listOf(
            "jb=${if (tuning.justBackwards) 1 else 0}",
            "lg=${if (tuning.justLong) 1 else 0}",
            "sq=${if (tuning.removeSequential) 0 else 1}",
            "thresh=${tuning.threshold.coerceAtLeast(2)}",
            "bp=${tuning.minProb.coerceIn(0, 100)},${tuning.maxProb.coerceIn(0, 100)},${tuning.ramp.coerceIn(0, 100)}",
            "ah=${if (tuning.highlightAnchorBranch) 1 else 0}"
        ).joinToString("&")
    }

    fun mergeIntoState(
        base: TuningState,
        parsed: ParsedTuningParams?
    ): TuningState {
        if (parsed == null) {
            return base
        }
        return base.copy(
            threshold = parsed.threshold ?: base.threshold,
            minProb = parsed.minProbPercent ?: base.minProb,
            maxProb = parsed.maxProbPercent ?: base.maxProb,
            ramp = parsed.rampPercent ?: base.ramp,
            justBackwards = parsed.justBackwards ?: base.justBackwards,
            justLong = parsed.justLongBranches ?: base.justLong,
            removeSequential = parsed.removeSequentialBranches ?: base.removeSequential,
            highlightAnchorBranch = parsed.highlightAnchorBranch ?: base.highlightAnchorBranch
        )
    }

    private fun parseStandardBoolean(raw: String?): Boolean? {
        if (raw == null) return null
        return when (raw.lowercase()) {
            "1", "true" -> true
            "0", "false" -> false
            else -> null
        }
    }

    private fun parseRemoveSequential(raw: String?): Boolean? {
        if (raw == null) return null
        return when (raw.lowercase()) {
            "0", "true" -> true
            "1", "false" -> false
            else -> null
        }
    }

    private fun parseQuery(raw: String): LinkedHashMap<String, MutableList<String>> {
        if (raw.isBlank()) {
            return linkedMapOf()
        }
        val parsed = linkedMapOf<String, MutableList<String>>()
        raw.split("&")
            .filter { it.isNotBlank() }
            .forEach { part ->
                val sep = part.indexOf('=')
                val keyRaw = if (sep >= 0) part.substring(0, sep) else part
                val valueRaw = if (sep >= 0) part.substring(sep + 1) else ""
                val key = decode(keyRaw).trim()
                if (key.isBlank()) {
                    return@forEach
                }
                parsed.getOrPut(key) { mutableListOf() }.add(decode(valueRaw))
            }
        return parsed
    }

    private fun Map<String, List<String>>.firstValue(name: String): String? =
        this[name]?.firstOrNull()

    private fun encodeQuery(params: Map<String, String>): String =
        params.entries.joinToString("&") { (key, value) ->
            "${encode(key)}=${encode(value)}"
        }

    private fun decode(value: String): String =
        URLDecoder.decode(value, StandardCharsets.UTF_8.toString())

    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.toString())
}
