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
| Syncing with the PC | blocked — an https page cannot reach a http machine | works |

The app detects which it is at runtime (`window.Capacitor`), so the site keeps
working exactly as before.

## The short way: let GitHub build it

You do not need Android Studio, the Android SDK, or a 10 GB download. Every
push to `claude/mobile-gym-app-51sus5` runs
[`.github/workflows/android.yml`](.github/workflows/android.yml), which builds
the APK on GitHub's machines and publishes it as a **release** you download
straight onto the phone.

It only publishes a *signed* build, though, so there is one thing to do first —
once, ever.

### Step 1 — make the signing key

A signed app is what makes it a real one: Android will only install version 15
over version 14 if both were signed with the same key. Run this on your PC
(`keytool` comes with any JDK; if you have none,
[Temurin 21](https://adoptium.net/) is a two-minute install):

```bash
keytool -genkeypair -v -keystore bela.keystore -alias bela \
  -keyalg RSA -keysize 2048 -validity 10000
```

It asks for a password and then some name-and-place questions — none of them
matter for an app only you install, so press Enter through them. Answer `yes`
at the end.

> **Keep `bela.keystore` and the password somewhere you will still have them in
> five years.** Losing them means you can never update the installed app again;
> you would have to uninstall it and start over. A copy in your password manager
> and one on a USB stick is not overkill. It must never go in the repo — every
> `*.keystore` is already git-ignored.

### Step 2 — hand the key to GitHub

Turn the key into text:

```bash
base64 -w0 bela.keystore > bela.keystore.txt     # Linux
base64 -i bela.keystore -o bela.keystore.txt     # macOS
certutil -encode bela.keystore bela.keystore.txt # Windows, then delete the ---BEGIN/END--- lines
```

Then go to **Settings → Secrets and variables → Actions → New repository
secret** on the repo, and add four:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the whole contents of `bela.keystore.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | the password you chose |
| `ANDROID_KEY_ALIAS` | `bela` |
| `ANDROID_KEY_PASSWORD` | the same password, unless you set a different one for the key |

Delete `bela.keystore.txt` afterwards — it *is* the key.

### Step 3 — build it

**Actions → Android app → Run workflow.** Five minutes or so. When it is green
the APK is on the repo's **Releases** page as `bela-14.5.0.apk`.

### Step 4 — install it

Open the Releases page **on the phone**, tap the `.apk`, and let Android install
from that source when it asks. Every later version installs straight over it and
keeps your data.

From then on it is automatic: any change pushed to the branch produces a new
release, and the app on your phone is one tap behind.

## Or build it yourself

If you would rather have it local — the phone plugged in, ▶ in Android Studio,
no waiting on CI:

1. **Node 18+** — you already have it for the Electron app.
2. **Android Studio** — https://developer.android.com/studio
   During setup let it install the **Android SDK (API 36)**, **Platform-Tools**
   and **Build-Tools**.
3. **JDK 21** — Android Studio ships one; nothing extra to install.

```bash
git clone https://github.com/rjotko-dotcom/B.E.L.A-gym-app.git
cd B.E.L.A-gym-app
git checkout claude/mobile-gym-app-51sus5
npm install

npm run native:apk        # debug build, for trying things out
```

The file lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

For a signed release build locally, put the key in `android/keystore.properties`
(git-ignored):

```properties
storeFile=/absolute/path/to/bela.keystore
storePassword=…
keyAlias=bela
keyPassword=…
```

then `npm run native:release` → `android/app/build/outputs/apk/release/app-release.apk`.

Or open it in Android Studio and press ▶ with USB debugging on:

```bash
npm run native:sync     # rebuild dist/ and copy it into android/
npm run native:open
```

## After changing the app

`js/app.js`, `css/style.css`, `index.html` — anything — then:

```bash
npm run native:sync
```

and rebuild. The version name and code are stamped automatically from
`package.json`, so the only number you ever bump is that one (alongside
`APP_VERSION` in `js/app.js` and `VERSION` in `sw.js` for the web build).

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

## Syncing with the PC app

This is the other reason the installed app matters: a page served over https
cannot open a plain-http connection to a machine on your network, so the website
can never reach your PC. The app can — it ships with cleartext allowed, for your
LAN only in practice, since there is nothing else it talks to.

Settings → **Sync with the PC app**, then type the address and pairing code your
desktop app prints. The desktop half lives in [`pc/`](pc/README.md).

## Troubleshooting

- **`SDK location not found`** — open the project once in Android Studio, or
  create `android/local.properties` with `sdk.dir=/path/to/Android/Sdk`.
- **`Could not resolve com.android.tools.build:gradle`** — no internet or a
  proxy is blocking `dl.google.com`. The first build needs to reach it.
- **The CI build says "no release key"** — the four `ANDROID_*` secrets are
  missing or misspelled. It still builds an APK you can download from the run's
  artifacts, but it is debug-signed and must not be the one you install.
- **App opens to a blank screen** — you built without `npm run native:sync`, so
  `android/app/src/main/assets/public/` is empty or stale.
