package me.oneledger.companion.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Ink = Color(0xFF0B1F3A)
private val Sky = Color(0xFF2F6FED)

private val LightColors = lightColorScheme(primary = Sky, onPrimary = Color.White, secondary = Ink)
private val DarkColors = darkColorScheme(primary = Sky, onPrimary = Color.White, secondary = Color(0xFFB9C7DE))

@Composable
fun OneLedgerCompanionTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        content = content,
    )
}
