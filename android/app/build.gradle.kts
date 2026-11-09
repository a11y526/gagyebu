plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 버전: GitHub 빌드가 태그(android-v3 → 3)로 넘겨 줌
val vCode = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1

android {
    namespace = "io.github.a11y526.gagyebu"
    compileSdk = 35
    defaultConfig {
        applicationId = "io.github.a11y526.gagyebu"
        minSdk = 26
        targetSdk = 35
        versionCode = vCode
        versionName = "1.0.$vCode"
    }
    signingConfigs {
        create("release") {
            val ks = rootProject.file("release.p12")
            if (ks.exists()) {
                storeFile = ks
                storeType = "pkcs12"
                storePassword = System.getenv("KS_PASS")
                keyAlias = "gagyebu"
                keyPassword = System.getenv("KS_PASS")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
