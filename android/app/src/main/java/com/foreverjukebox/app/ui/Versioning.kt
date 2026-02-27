package com.foreverjukebox.app.ui

internal fun isLatestVersionNewer(currentVersionName: String, latestTagName: String): Boolean {
    val currentParts = extractNumericVersionParts(currentVersionName)
    val latestParts = extractNumericVersionParts(latestTagName)
    if (currentParts.isEmpty() || latestParts.isEmpty()) {
        return false
    }
    val maxLen = maxOf(currentParts.size, latestParts.size)
    for (i in 0 until maxLen) {
        val current = currentParts.getOrElse(i) { 0 }
        val latest = latestParts.getOrElse(i) { 0 }
        if (latest > current) return true
        if (latest < current) return false
    }
    return false
}

private fun extractNumericVersionParts(raw: String): List<Int> {
    return VERSION_PART_REGEX
        .findAll(raw)
        .mapNotNull { match -> match.value.toIntOrNull() }
        .toList()
}

private val VERSION_PART_REGEX = Regex("\\d+")
