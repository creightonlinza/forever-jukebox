import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Properties
import java.util.zip.ZipInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val madmomBeatsPortFfiAbis = listOf("arm64-v8a", "armeabi-v7a", "x86_64")
val madmomBeatsPortFfiVersion = "4.1.0"
val madmomBeatsPortFfiZipUrlProperty = providers.gradleProperty("madmomBeatsPortFfiZipUrl")
val madmomBeatsPortFfiZipPathProperty = providers.gradleProperty("madmomBeatsPortFfiZipPath")
val madmomBeatsPortFfiZipUrl = madmomBeatsPortFfiZipUrlProperty.orElse(
    "https://github.com/creightonlinza/madmom-beats-port/releases/download/v$madmomBeatsPortFfiVersion/madmom-beats-port-v$madmomBeatsPortFfiVersion-android.zip"
)
val madmomBeatsPortFfiZipCache = layout.buildDirectory.file("downloads/madmom-beats-port-v$madmomBeatsPortFfiVersion-android.zip")
val madmomBeatsPortFfiGeneratedJniLibs = layout.buildDirectory.dir("generated/madmom_beats_port_ffi/jniLibs")
val essentiaSharedJniLibsDir = file("third_party/essentia/android")
val keystoreProperties = Properties().apply {
    val propertiesFile = rootProject.file("keystore.properties")
    if (propertiesFile.exists()) {
        propertiesFile.inputStream().use(::load)
    }
}

fun resolveReleaseSigningValue(propertyName: String, envName: String): String? {
    val propertyValue = keystoreProperties.getProperty(propertyName)?.trim().orEmpty()
    if (propertyValue.isNotEmpty()) {
        return propertyValue
    }
    val envValue = System.getenv(envName)?.trim().orEmpty()
    return envValue.ifEmpty { null }
}

val releaseStoreFilePath = resolveReleaseSigningValue("storeFile", "ANDROID_STORE_FILE")
val releaseStorePassword = resolveReleaseSigningValue("storePassword", "ANDROID_STORE_PASSWORD")
val releaseKeyAlias = resolveReleaseSigningValue("keyAlias", "ANDROID_KEY_ALIAS")
val releaseKeyPassword = resolveReleaseSigningValue("keyPassword", "ANDROID_KEY_PASSWORD")
val releaseStoreFile = releaseStoreFilePath?.let(rootProject::file)
val hasReleaseSigningCredentials = listOf(
    releaseStoreFilePath,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword
).all { !it.isNullOrBlank() }
val hasReleaseSigningConfig = hasReleaseSigningCredentials && releaseStoreFile?.exists() == true

val prepareMadmomBeatsPortFfiJniLibs by tasks.registering {
    description = "Fetches madmom_beats_port_ffi Android binaries and stages ABI jniLibs for packaging."
    outputs.dir(madmomBeatsPortFfiGeneratedJniLibs)

    doLast {
        val outputRoot = madmomBeatsPortFfiGeneratedJniLibs.get().asFile
        if (outputRoot.exists()) {
            outputRoot.deleteRecursively()
        }
        outputRoot.mkdirs()

        val localZipPath = madmomBeatsPortFfiZipPathProperty.orNull?.trim().orEmpty()
        val zipFile = if (localZipPath.isNotEmpty()) {
            file(localZipPath)
        } else {
            val cached = madmomBeatsPortFfiZipCache.get().asFile
            if (!cached.exists()) {
                cached.parentFile.mkdirs()
                logger.lifecycle("Downloading madmom_beats_port_ffi release: ${madmomBeatsPortFfiZipUrl.get()}")
                URI.create(madmomBeatsPortFfiZipUrl.get()).toURL().openStream().use { input ->
                    Files.copy(input, cached.toPath(), StandardCopyOption.REPLACE_EXISTING)
                }
            }
            cached
        }

        if (!zipFile.exists()) {
            throw GradleException(
                "madmom_beats_port_ffi release zip was not found: ${zipFile.absolutePath}"
            )
        }

        val copiedAbis = mutableSetOf<String>()
        ZipInputStream(zipFile.inputStream().buffered()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val name = entry.name
                if (!entry.isDirectory && name.endsWith("/libmadmom_beats_port_ffi.so")) {
                    val abi = madmomBeatsPortFfiAbis.firstOrNull { name.contains("/$it/") }
                    if (abi != null) {
                        val abiDir = File(outputRoot, abi)
                        abiDir.mkdirs()
                        val outputSo = File(abiDir, "libmadmom_beats_port_ffi.so")
                        outputSo.outputStream().use { out ->
                            zis.copyTo(out)
                        }
                        copiedAbis += abi
                    }
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }
        }

        val missingAbis = madmomBeatsPortFfiAbis.filterNot { copiedAbis.contains(it) }
        if (missingAbis.isNotEmpty()) {
            throw GradleException(
                "madmom_beats_port_ffi zip missing required ABIs: ${missingAbis.joinToString(", ")}"
            )
        }
    }
}

android {
    namespace = "com.foreverjukebox.app"
    compileSdk = 36
    ndkVersion = "29.0.14206865"

    val runNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
    val versionTag = System.getenv("APP_VERSION_TAG")?.trim().orEmpty()
    val versionStamp = LocalDate.now(ZoneOffset.UTC).format(DateTimeFormatter.ofPattern("yyyy.MM"))
    val ciVersionName = if (versionTag.isNotEmpty()) versionTag else "$versionStamp.$runNumber"

    defaultConfig {
        applicationId = "com.foreverjukebox.app"
        minSdk = 26
        targetSdk = 36
        versionCode = runNumber
        versionName = ciVersionName
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }

        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON", "-DANDROID_STL=c++_shared")
            }
        }
    }

    signingConfigs {
        if (hasReleaseSigningConfig) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        debug {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }
        release {
            isMinifyEnabled = false
            if (hasReleaseSigningConfig) {
                signingConfig = signingConfigs.getByName("release")
            }
            manifestPlaceholders["usesCleartextTraffic"] = "false"
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
        prefab = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
        }
    }

    sourceSets {
        getByName("main") {
            jniLibs.srcDirs("src/main/jniLibs", madmomBeatsPortFfiGeneratedJniLibs, essentiaSharedJniLibsDir)
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    splits {
        abi {
            isEnable = false
        }
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

tasks.named("preBuild").configure {
    dependsOn(prepareMadmomBeatsPortFfiJniLibs)
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui:1.6.8")
    implementation("androidx.compose.ui:ui-tooling-preview:1.6.8")
    implementation("androidx.compose.material3:material3:1.2.1")
    implementation("androidx.compose.material:material-icons-core:1.6.8")
    implementation("androidx.compose.material:material-icons-extended:1.6.8")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.compose.runtime:runtime:1.6.8")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation("androidx.media:media:1.7.0")
    implementation("androidx.mediarouter:mediarouter:1.7.0")

    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-core:1.6.3")
    implementation("com.google.oboe:oboe:1.10.0")
    implementation("com.google.android.gms:play-services-cast-framework:21.4.0")

    debugImplementation("androidx.compose.ui:ui-tooling:1.6.8")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
}
