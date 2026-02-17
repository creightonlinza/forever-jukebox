package com.foreverjukebox.app.local

import android.content.Context
import java.io.File

interface MadmomBeatsPortModelProvider {
    fun ensureExtracted(): List<File>
}

class MadmomBeatsPortModelExtractor(
    private val context: Context,
    private val assetDir: String = "madmom_beats_port_models"
) : MadmomBeatsPortModelProvider {
    override
    fun ensureExtracted(): List<File> {
        val outputDir = File(context.filesDir, "madmom_beats_port_models")
        if (!outputDir.exists()) {
            outputDir.mkdirs()
        }
        val assetManager = context.assets
        val assets = assetManager.list(assetDir)?.toList().orEmpty()
        val extracted = mutableListOf<File>()
        for (name in assets) {
            val outFile = File(outputDir, name)
            if (!outFile.exists()) {
                assetManager.open("$assetDir/$name").use { input ->
                    outFile.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
            }
            extracted += outFile
        }
        return extracted
    }
}
