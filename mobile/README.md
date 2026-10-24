# PHOENIX Online — Android mobile build

Private Capacitor shell around the live game at
`https://phoenix-card-game-1.onrender.com`, exactly the same site, auth,
multiplayer and player data. Never publish this `.apk`.

## What the shell does (and does not do)

- Loads the **live site** inside the app via `cap.config.json`
  `server.url` (same cookies/auth/WS as the web).
- Keeps the site untouched: no rebuilt pages, no new APIs.
- Fictional sites (`/foogle.html`, `/shopping.html`, `/phoenixtube.html`)
  open inside the app via `cordova-plugin-inappbrowser` (the plugin
  overrides `window.open` for the in-app WebView, the same mechanism the
  site relies on). The main game WebView and its WebSocket stay alive;
  closing the in-app view returns to the game without disconnecting.
- The rare **external** link from Foogle (the Google-search fallback) also
  opens through the same plugin mechanism — it appears in the in-app
  browser view with the standard close control. No game cookies are sent
  to external origins, and no game privileges are exposed to it; this is
  the secure, conservative default for a private test build.
- `@capacitor/browser` is available (`Capacitor.Plugins.Browser.open`) for
  any future external-link routing; the site does not call it directly,
  so the current behavior is fully driven by the plugin's `window.open`
  interception, preserving the site's existing functionality.

## Requirements

- JDK 17 is present (`java -version` confirms `17.0.19`); `JAVA_HOME` is
  not set (Capacitor reads it from the registry when present; the build
  script below sets it temporarily).
- Android SDK command-line tools must be installed locally (not yet
  present in this workspace — install via the Android SDK manager or the
  command-line zip, see Installation below).

## Installation (first time)

```powershell
# 1. Android SDK command-line tools (approx 1 GB).
# Download from developer.android.com → Command line tools only,
# extract to a folder, run `cmdline-tools\bin\sdkmanager.bat`
# with `--install` for `platforms;android-35`, `build-tools;35.0.0`,
# `platform-tools`, `cmdline-tools;latest`, `ndk-bundle` (optional).
# Set ANDROID_HOME to that folder.

# 2. Install this subproject's dependencies.
cd mobile
npm install
```

## Configure Android SDK for this session

```powershell
# Once SDK is installed, point the session variables.
$env:ANDROID_HOME = "C:\Users\<you>\AppData\Local\Android\Sdk"
$env:PATH += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\cmdline-tools\latest\bin"
```

## Build the `.apk`

```powershell
cd mobile
npm run sync            # link Capacitor plugins into the Android project
npx cap build android --keystore=debug  # build signed debug APK
```

The signed debug `.apk` lands at
`mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

For a private sideload: copy that `.apk` to your Android device and
install it via ADB (`adb install -r app-debug.apk`) or file-manager
side-loading.

## Development / live reload (optional)

If the Android SDK and a device/emulator are available:

```powershell
npm run open            # open Android Studio with the generated project
npm run sync
```

## Notes

- This `mobile/` package is independent of the root `package.json` (Render
  installs the root, not this); it does not change public site behavior.
- The fictional-site behavior relies on the installed plugin; the site
  code (`window.open`) is unchanged.
- No Play Store account, signing key, or public release steps are set up
  — the `.apk` is for private multi-device testing only.
