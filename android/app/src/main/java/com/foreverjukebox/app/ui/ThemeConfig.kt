package com.foreverjukebox.app.ui

import android.content.Context
import androidx.core.graphics.toColorInt
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import org.json.JSONObject
import java.io.IOException

data class ThemeTokens(
    val background: Color,
    val onBackground: Color,
    val panelSurface: Color,
    val heroSurface: Color,
    val controlSurface: Color,
    val controlSurfaceHover: Color,
    val panelBorder: Color,
    val heroBorder: Color,
    val controlBorder: Color,
    val accent: Color,
    val titleAccent: Color,
    val muted: Color,
    val edgeStroke: Color,
    val beatFill: Color,
    val beatHighlight: Color,
    val vizBackground: Color
)

data class ThemeConfig(val dark: ThemeTokens, val light: ThemeTokens)

private val DarkTokens = ThemeTokens(
    background = Color(0xFF0F1115),
    onBackground = Color(0xFFE7E4DD),
    panelSurface = Color(0xFF141922),
    heroSurface = Color(0xFF1A1F27),
    controlSurface = Color(0xFF1F2633),
    controlSurfaceHover = Color(0xFF202835),
    panelBorder = Color(0xFF283142),
    heroBorder = Color(0xFF2B3442),
    controlBorder = Color(0xFF3B465B),
    accent = Color(0xFF4AC7FF),
    titleAccent = Color(0xFFF1C47A),
    muted = Color(0xFF9AA3B2),
    edgeStroke = Color(0x804AC7FF),
    beatFill = Color(0xFFFFD46A),
    beatHighlight = Color(0xFFFFD46A),
    vizBackground = Color(0xFF232B3D)
)

private val LightTokens = ThemeTokens(
    background = Color(0xFF5F9EA0),
    onBackground = Color(0xFF1B2A24),
    panelSurface = Color(0xFFF4FAF7),
    heroSurface = Color(0xFFDDEBE3),
    controlSurface = Color(0xFFD8EADB),
    controlSurfaceHover = Color(0xFFCCE2D3),
    panelBorder = Color(0x241B2A24),
    heroBorder = Color(0x33317873),
    controlBorder = Color(0x42317873),
    accent = Color(0xFF317873),
    titleAccent = Color(0xFF5F9EA0),
    muted = Color(0xFF1B2A24),
    edgeStroke = Color(0x801B2A24),
    beatFill = Color(0xFF5F9EA0),
    beatHighlight = Color(0xFFF4FAF7),
    vizBackground = Color(0xFFCFE5DA)
)

val LocalThemeTokens = staticCompositionLocalOf { DarkTokens }

fun themeTokens(isDark: Boolean): ThemeTokens = if (isDark) DarkTokens else LightTokens

fun loadThemeConfig(context: Context): ThemeConfig? {
    return try {
        val raw = context.assets.open("theme.json").bufferedReader().use { it.readText() }
        val root = JSONObject(raw)
        ThemeConfig(
            dark = parseThemeTokens(root.getJSONObject("dark")),
            light = parseThemeTokens(root.getJSONObject("light"))
        )
    } catch (_: IOException) {
        null
    } catch (_: Exception) {
        null
    }
}

private fun parseThemeTokens(obj: JSONObject): ThemeTokens {
    return ThemeTokens(
        background = parseColor(obj.getString("background")),
        onBackground = parseColor(obj.getString("onBackground")),
        panelSurface = parseColor(obj.getString("panelSurface")),
        heroSurface = parseColor(obj.getString("heroSurface")),
        controlSurface = parseColor(obj.getString("controlSurface")),
        controlSurfaceHover = parseColor(obj.getString("controlSurfaceHover")),
        panelBorder = parseColor(obj.getString("panelBorder")),
        heroBorder = parseColor(obj.getString("heroBorder")),
        controlBorder = parseColor(obj.getString("controlBorder")),
        accent = parseColor(obj.getString("accent")),
        titleAccent = parseColor(obj.getString("titleAccent")),
        muted = parseColor(obj.getString("muted")),
        edgeStroke = parseColor(obj.getString("edgeStroke")),
        beatFill = parseColor(obj.getString("beatFill")),
        beatHighlight = parseColor(obj.getString("beatHighlight")),
        vizBackground = parseColor(obj.getString("vizBackground"))
    )
}

private fun parseColor(value: String): Color {
    val trimmed = value.trim()
    return when {
        trimmed.startsWith("#") -> Color(trimmed.toColorInt())
        trimmed.startsWith("0x", ignoreCase = true) -> {
            val hex = trimmed.removePrefix("0x")
            val argb = hex.toLong(16).toInt()
            Color(argb)
        }
        trimmed.startsWith("rgba", ignoreCase = true) -> parseRgb(trimmed, true)
        trimmed.startsWith("rgb", ignoreCase = true) -> parseRgb(trimmed, false)
        else -> Color(trimmed.toColorInt())
    }
}

private fun parseRgb(value: String, hasAlpha: Boolean): Color {
    val start = value.indexOf("(")
    val end = value.indexOf(")")
    if (start == -1 || end == -1 || end <= start + 1) {
        return Color.Unspecified
    }
    val parts = value.substring(start + 1, end).split(",").map { it.trim() }
    if (parts.size < 3) {
        return Color.Unspecified
    }
    val r = parts[0].toFloatOrNull() ?: return Color.Unspecified
    val g = parts[1].toFloatOrNull() ?: return Color.Unspecified
    val b = parts[2].toFloatOrNull() ?: return Color.Unspecified
    val alpha = if (hasAlpha && parts.size >= 4) {
        parts[3].toFloatOrNull()?.coerceIn(0f, 1f) ?: 1f
    } else {
        1f
    }
    return Color(r / 255f, g / 255f, b / 255f, alpha)
}

fun themeColors(tokens: ThemeTokens, isDark: Boolean): ColorScheme {
    return if (isDark) {
        darkColorScheme(
            primary = tokens.accent,
            onPrimary = tokens.background,
            secondary = tokens.titleAccent,
            onSecondary = tokens.background,
            tertiary = tokens.accent,
            onTertiary = tokens.background,
            background = tokens.background,
            onBackground = tokens.onBackground,
            surface = tokens.panelSurface,
            onSurface = tokens.onBackground,
            surfaceVariant = tokens.heroSurface,
            onSurfaceVariant = tokens.muted,
            outline = tokens.panelBorder,
            outlineVariant = tokens.controlBorder
        )
    } else {
        lightColorScheme(
            primary = tokens.accent,
            onPrimary = tokens.background,
            secondary = tokens.titleAccent,
            onSecondary = tokens.background,
            tertiary = tokens.muted,
            onTertiary = tokens.panelSurface,
            background = tokens.background,
            onBackground = tokens.onBackground,
            surface = tokens.panelSurface,
            onSurface = tokens.onBackground,
            surfaceVariant = tokens.heroSurface,
            onSurfaceVariant = tokens.muted,
            outline = tokens.panelBorder,
            outlineVariant = tokens.controlBorder
        )
    }
}
