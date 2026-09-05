import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.firebase.appdistribution)
}

// Release signing inputs, in priority order: environment variables (CI), then
// android/keystore.properties (local, git-ignored). Absent ⇒ `assembleRelease`
// still runs and produces an *unsigned* APK (useful for verifying R8 in CI);
// only the Firebase upload needs a real signature.
val keystoreProperties = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signingInput(key: String): String? =
    System.getenv(key)?.takeIf { it.isNotBlank() }
        ?: keystoreProperties.getProperty(key)?.takeIf { it.isNotBlank() }

android {
    namespace = "me.oneledger.companion"
    compileSdk = 34

    defaultConfig {
        applicationId = "me.oneledger.companion"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            val storeFilePath = signingInput("ANDROID_KEYSTORE_FILE")
            if (storeFilePath != null) {
                storeFile = file(storeFilePath)
                storePassword = signingInput("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingInput("ANDROID_KEY_ALIAS")
                keyPassword = signingInput("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            // OneLedger's single Supabase project (ref `zttxsaiywkfrbdxgzbjd` —
            // a public identifier, see .github/workflows/deploy-supabase.yml).
            // Used ONLY for the first `op:"pair"` call; every request after that
            // uses the `capture_url` the server returns at pair time (ADR 0008
            // §3). Point a debug build at a branch/preview backend by editing
            // this line locally.
            buildConfigField(
                "String",
                "DEFAULT_CAPTURE_BASE_URL",
                "\"https://zttxsaiywkfrbdxgzbjd.functions.supabase.co\"",
            )
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Only sign when a keystore was supplied; otherwise unsigned.
            signingConfigs.getByName("release").takeIf { it.storeFile != null }
                ?.let { signingConfig = it }
            // Same project as debug — OneLedger runs one Supabase project,
            // gated by feature flags + workspace allowlists, not by environment.
            buildConfigField(
                "String",
                "DEFAULT_CAPTURE_BASE_URL",
                "\"https://zttxsaiywkfrbdxgzbjd.functions.supabase.co\"",
            )

            // Firebase App Distribution. `appId` + `serviceCredentialsFile` are
            // read from the FIREBASE_APP_ID / GOOGLE_APPLICATION_CREDENTIALS
            // env vars by the plugin — nothing sensitive lives in the repo.
            // Upload with `./gradlew :app:appDistributionUploadRelease`.
            firebaseAppDistribution {
                artifactType = "APK"
                groups = "internal"
            }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.security.crypto)
    implementation(libs.okhttp)
    // Installed only when BuildConfig.DEBUG (see CaptureClient); inert otherwise.
    implementation(libs.okhttp.logging.interceptor)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.room.testing)
    testImplementation(libs.androidx.work.testing)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
