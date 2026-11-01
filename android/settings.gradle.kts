// The Loci Android app (SPEC-v6-android.md): a WebView shell around the web app,
// plus the native parts a browser can't do. Build with `npm run android`.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "Loci"
include(":app")
