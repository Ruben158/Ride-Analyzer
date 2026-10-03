# Build Ride Analyzer for Android

The Android project is in `artifacts/ride-analyzer-mobile/android`. Keep the full
workspace: the native project links to the Expo app and its dependencies in the
monorepo, so copying only the `android` folder is not enough.

## Requirements

- Android Studio with its bundled JDK
- Android SDK Platform and Build Tools requested by the project during Gradle sync
- Node.js 22 LTS or newer
- pnpm 10
- A JDK supported by the Android Gradle Plugin

## Install dependencies

From the workspace root:

```sh
pnpm install
```

## Build a debug APK

Open `artifacts/ride-analyzer-mobile/android` in Android Studio, sync Gradle,
then choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**. Or run:

```sh
cd artifacts/ride-analyzer-mobile/android
./gradlew assembleDebug
```

The debug APK is written to:

```text
artifacts/ride-analyzer-mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

## Build a release APK

The release variant requires a dedicated signing key. It will fail rather than
silently use the debug key when release signing is missing.

Create a keystore outside the repository. Keep a secure backup of it: future
updates to this Android app must use the same signing key.

```sh
mkdir -p "$HOME/.local/share/ride-analyzer"
keytool -genkeypair -v \
  -storetype JKS \
  -keystore "$HOME/.local/share/ride-analyzer/release-key.jks" \
  -alias rideanalyzer \
  -keyalg RSA \
  -keysize 3072 \
  -validity 10000
```

Set these environment variables in your shell or CI secret store. Do not commit
the keystore or passwords:

```sh
export ANDROID_RELEASE_STORE_FILE="$HOME/.local/share/ride-analyzer/release-key.jks"
export ANDROID_RELEASE_STORE_PASSWORD="your-keystore-password"
export ANDROID_RELEASE_KEY_ALIAS="rideanalyzer"
export ANDROID_RELEASE_KEY_PASSWORD="your-key-password"
```

Then build:

```sh
cd artifacts/ride-analyzer-mobile/android
NODE_ENV=production ./gradlew -PreactNativeArchitectures=armeabi-v7a,arm64-v8a assembleRelease
```

The signed APK is written to:

```text
artifacts/ride-analyzer-mobile/android/app/build/outputs/apk/release/app-release.apk
```

On Windows, use `gradlew.bat` and set the same four variables in PowerShell.

## Test locked-screen recording

Install the APK on a physical Android phone and grant location access. For
background recording, choose **Allow all the time** in Android's location
permission settings and keep the Ride Analyzer location notification active
during the ride. Start a ride, lock the phone, then return to the app, finish
the ride, and confirm it appears in ride history. Repeat with the phone's
battery-saver settings you expect users to use. The browser preview and Expo Go
are not substitutes for this native test.

Increment `versionCode` in `app.json` and the Android Gradle configuration for
each subsequent Android release. Never commit a release keystore, signing
password, or key password to the repository.

The first release key is different from the earlier debug key, so Android
cannot update an earlier debug-signed installation in place. Uninstalling that
test build removes its local ride history; the app does not currently export
rides. Preserve the old installation if its data matters.