import java.util.Properties

plugins {
    id("com.android.application")
}

// The release signing key lives outside git (android/keystore.properties and the
// .jks it names). Without it, release builds are signed with the debug key.
val keystore = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { file ->
    Properties().apply { file.inputStream().use { load(it) } }
}

android {
    namespace = "io.github.amaasprilla.loci"
    compileSdk {
        version = release(36) { minorApiLevel = 1 }
    }

    defaultConfig {
        applicationId = "io.github.amaasprilla.loci"
        minSdk = 26
        targetSdk = 36
        versionCode = 4
        versionName = "1.2"
        buildConfigField("String", "LOCI_URL", "\"${providers.gradleProperty("lociUrl").get()}\"")
    }

    signingConfigs {
        if (keystore != null) create("release") {
            storeFile = rootProject.file(keystore.getProperty("storeFile"))
            storePassword = keystore.getProperty("storePassword")
            keyAlias = keystore.getProperty("keyAlias")
            keyPassword = keystore.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.12.4")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.webkit:webkit:1.17.0")
}
