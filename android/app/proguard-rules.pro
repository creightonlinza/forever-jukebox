# Cast options provider is referenced by class name string in AndroidManifest.xml.
-keep class com.foreverjukebox.app.cast.ForeverJukeboxCastOptionsProvider { *; }

# JNI entrypoints in C++ use Java_* symbol names for these classes/methods.
-keep class com.foreverjukebox.app.local.NativeAnalysisBridge { *; }
-keep class com.foreverjukebox.app.audio.BufferedAudioPlayer { *; }

# JNI progress callbacks call interface methods by literal name via GetMethodID.
-keep interface com.foreverjukebox.app.local.NativeAnalysisBridge$MadmomBeatsPortProgressCallback { *; }
-keep interface com.foreverjukebox.app.local.NativeAnalysisBridge$EssentiaProgressCallback { *; }
