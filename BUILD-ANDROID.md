# Building B.E.L.A as a real Android app

The web app and the Android app are **the same code**. `android/` is a thin
Capacitor shell that loads `dist/` from inside the APK. Nothing is forked, so
every change you make to `js/app.js` lands in both.

## Why bother

Things a browser will not let a website do, which the installed app does:

| | PWA in Chrome | Installed app |
|---|---|---|
| Workout notification | says `rjotko-dotcom.github.io`, has an expander arrow | just B.E.L.A |
| Swiping it away | always possible | `ongoing` — Android holds it there |
| "Tap to copy the URL" notice | Chrome adds it | gone |
| App icon | Chrome's shortcut | a real launcher icon |
| Back gesture | browser history | walks the app's own layers, backgrounds at the top |

The app detects which it is at runtime (`window.Capacitor`), so the site keeps
working exactly as before.

## What you need on your PC (one time)

1. **Node 18+** — you already have it for the Electron app.
2. **Android Studio** — https://developer.android.com/studio
   During setup let it install the **Android SDK (API 36)**, **Platform-Tools**
   and **Build-Tools**.
3. **JDK 21** — Android Studio ships one; nothing extra to install.

That is all. Gradle downloads the rest on the first build (a few minutes, once).

## Build it

```bash
git clone https://github.com/rjotko-dotcom/B.E.L.A-gym-app.git
cd B.E.L.A-gym-app
git checkout claude/mobile-gym-app-51sus5
npm install

npm run native:apk
```

`native:apk` builds `dist/`, copies it into the shell and runs Gradle. The file
lands at:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Copy it to the phone and open it (Android will ask you to allow installing from
that source once).

### Or from Android Studio

```bash
npm run native:sync     # rebuild dist/ and copy it into android/
npm run native:open     # opens the project in Android Studio
```

Then press ▶ with the phone plugged in and USB debugging on — it installs and
launches directly.

## After changing the app

`js/app.js`, `css/style.css`, `index.html` — anything — then:

```bash
npm run native:sync
```

and rebuild. The version name and code are stamped automatically from
`package.json`, so the only number you ever bump is that one (alongside
`APP_VERSION` in `js/app.js` and `VERSION` in `sw.js` for the web build).

## A signed release APK

The debug APK installs fine but is signed with a throwaway key, so you cannot
upgrade over it with a differently-signed build later. For something permanent:

```bash
keytool -genkey -v -keystore bela.keystore -alias bela \
  -keyalg RSA -keysize 2048 -validity 10000
```

Keep `bela.keystore` and its password somewhere safe — losing it means you can
never update the installed app. Then create `android/keystore.properties`:

```properties
storeFile=/absolute/path/to/bela.keystore
storePassword=…
keyAlias=bela
keyPassword=…
```

…and build with `cd android && ./gradlew assembleRelease` after wiring those
into `android/app/build.gradle`. (`keystore.properties` and `android/app/release/`
are already git-ignored.)

## Moving your data across

The installed app has its own storage — it does not see what the website saved.
To carry everything over:

1. Open the PWA → **Settings → Export data** → save the `.json`.
2. Open the installed app → **Settings → Import data** → pick that file.

It imports workouts, meals, habits, bodyweight, routines, custom foods and
settings. Do this once, then use the app.

## Notifications

The first workout you start asks for notification permission (Android 13+).
The notification then sits in the shade as an ongoing one: exercise name on the
first line, `Set 2/4 · 80 kg × 8` on the second, no origin, no arrow, and it
cannot be swiped away until the session ends. It is on a quiet channel
(`Workout in progress`) so it never makes a sound or a heads-up banner.

If it does not show, **Settings → Workout notification** says which of the three
possible reasons it is, and has a **Test it** button.

## Troubleshooting

- **`SDK location not found`** — open the project once in Android Studio, or
  create `android/local.properties` with `sdk.dir=/path/to/Android/Sdk`.
- **`Could not resolve com.android.tools.build:gradle`** — no internet or a
  proxy is blocking `dl.google.com`. The first build needs to reach it.
- **App opens to a blank screen** — you built without `npm run native:sync`, so
  `android/app/src/main/assets/public/` is empty or stale.
