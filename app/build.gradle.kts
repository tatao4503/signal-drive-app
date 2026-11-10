import java.net.URI

plugins { id("com.android.application"); kotlin("android") }

android {
    namespace = "kr.signal.drive"
    compileSdk = 34
    compileSdkExtension = 12
    // AAOS 차량 제한 API(Car·CarUxRestrictionsManager). 컴파일에만 쓰고 기기에서는 manifest의 uses-library(required=false)로 연결.
    useLibrary("android.car")
    defaultConfig {
        applicationId = "kr.signal.drive"
        minSdk = 28
        targetSdk = 34
        versionCode = 3
        versionName = "0.2.1"
        // Public owned server address only. Never place a Seoul API key in the APK.
        val backend = providers.gradleProperty("signalBackendUrl").orElse("").get()
        if (backend.isNotEmpty()) {
            val uri = URI(backend)
            require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.rawQuery == null && uri.userInfo == null && uri.fragment == null) {
                "signalBackendUrl must be an owned HTTPS base URL without credentials, query or fragment"
            }
        }
        buildConfigField("String", "BACKEND_URL", "\"${backend.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
    }
    buildFeatures { buildConfig = true }
    signingConfigs {
        getByName("debug") { storeFile = rootProject.file(".local/debug.keystore") }
        // 제출용 release 서명. 키와 비밀번호는 소스·gradle.properties·로그에 두지 않고
        // 빌드하는 셸의 환경변수로만 받는다. 넷 중 하나라도 없으면 서명 없이 빌드되며,
        // scripts/build-release.mjs가 그 결과를 "제출 불가"로 표시한다.
        val releaseStore = providers.environmentVariable("SIGNAL_RELEASE_STORE_FILE").orNull
        val releaseStorePass = providers.environmentVariable("SIGNAL_RELEASE_STORE_PASSWORD").orNull
        val releaseAlias = providers.environmentVariable("SIGNAL_RELEASE_KEY_ALIAS").orNull
        val releaseKeyPass = providers.environmentVariable("SIGNAL_RELEASE_KEY_PASSWORD").orNull
        if (listOf(releaseStore, releaseStorePass, releaseAlias, releaseKeyPass).all { !it.isNullOrEmpty() }) {
            create("release") {
                storeFile = file(releaseStore!!)
                storePassword = releaseStorePass
                keyAlias = releaseAlias
                keyPassword = releaseKeyPass
            }
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        release {
            // 축소·난독화는 켜지 않는다. 심사 기간에 동작 차이를 만들 위험이 크고 앱 크기도 작다.
            isMinifyEnabled = false
            isDebuggable = false
            signingConfig = signingConfigs.findByName("release")
        }
    }
}
dependencies { implementation(project(":core")) }
