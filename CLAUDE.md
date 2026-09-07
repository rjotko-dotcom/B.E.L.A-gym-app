# B.E.L.A — working notes for any Claude session on this repo

Two Claude Code sessions work on this branch at the same time, for the same
person (Rimvydas). This file is how they tell each other what is going on.
Read it before doing anything; add to the log at the bottom when you ship.

## What this is

A gym + nutrition + habits app, one codebase, three places it runs:

| Where | How | Notes |
|---|---|---|
| Website | https://rjotko-dotcom.github.io/B.E.L.A-gym-app/ | PWA, deployed by force-pushing this branch to `gh-pages` |
| Android | signed APK on the repo's Releases page | built by `.github/workflows/android.yml` on every push to this branch |
| PC | `pc/bela-sync.js` (run with `node`) | LAN sync of the whole document; see `pc/README.md` |

Plain HTML/CSS/JS, no build step. One IIFE in `js/app.js`; state is one
localStorage document under `bela-gym-v1`; `js/sync.js` is the merge and is
byte-identical to `pc/sync.js` (tests fail if it drifts). The Android shell is
Capacitor 8 in `android/`, loading `dist/` which `tools/build-web.mjs` assembles.
Target device: Samsung Galaxy S24+, 384×832 CSS px, dark theme.

## Working alongside the other session

- **Pull before you push.** `git fetch origin claude/mobile-gym-app-51sus5 && git rebase origin/claude/mobile-gym-app-51sus5`, then push. Never force-push the feature branch. Force-pushing `gh-pages` *from* the branch is fine — that is the deploy.
- **Check the version before bumping it.** `grep "APP_VERSION = " js/app.js`. The other session may have moved it since you last looked. Take the next number; do not reuse one.
- **Every version reference moves together** (the CI names the APK after `package.json`, the app compares itself to the release tag, and the service worker caches by version):
  `APP_VERSION` in `js/app.js` · `VERSION` in `sw.js` · every `?v=` in `index.html` and `manifest.webmanifest` · `package.json` · `package-lock.json` (two places) · then `npm run native:sync`, which stamps `android/app/build.gradle`.
  Docs-only or test-only changes do not need a bump.
- A push to the branch builds and **publishes** an APK. Do not push half-finished app code to it.
- **This container periodically resets the checkout to an ancient commit (v8.6).** If `APP_VERSION` reads `8.6`, run
  `git fetch origin claude/mobile-gym-app-51sus5 && git reset --hard origin/claude/mobile-gym-app-51sus5 && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`
  before doing anything. Your pushed work is safe on the remote.

## Tests

```
CHROMIUM_PATH=/opt/pw-browsers/chromium npm test            # all (~670 checks)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm test -- logger   # one suite
```

Playwright, at 384×832. `tests/lib/harness.js` `openApp()` seeds state, waits
450ms, and pre-sets `sessionStorage['bela-opened']` so the opening mark does
not cover the app (pass `splash: true` when testing the mark itself). Seed data
is `tests/lib/seed.js` `build()`. Tests that need a workout on "today" must add
one — the seed's newest is a day old, which is last month on the 1st.

## Release pipeline (Android)

`.github/workflows/android.yml`: Node 22, Temurin 21, `npm run native:sync`,
`gradlew assembleRelease`. It signs with a keystore held in four repository
secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` = `bela`, `ANDROID_KEY_PASSWORD`) and publishes a release
tagged `v<version>` with `bela-<version>.apk`. Without the secrets it builds a
debug-signed test APK as a run artifact and deliberately does **not** publish.
The keystore itself is on Rimvydas's PC and must never enter the repo.

The installed app asks GitHub's releases API every six hours and offers a
tappable "Version X is out" notice; Settings → **Check for updates** does it on
demand. So a pushed version reaches the phone on its own.

Verify a build from here without a device: download the APK from the release,
check the APK Signing Block certificate fingerprint is
`A5:CC:F2:55:68:EF:96:74:22:2F:6B:BB:95:38:AD:4A:AB:DB:77:EF:98:0D:F2:36:48:17:90:05:C7:A1:5D:C9`
(same key every time — that is what lets it install over the old one), and
`unzip -p bela-X.apk assets/public/js/app.js | grep APP_VERSION`.

## Decisions already made — do not undo without asking him

- Monochrome black/white/grey, pure `#000` background, dark first. One green accent (`--done`) for "reached".
- **Opening:** the page draws no logo where Android already showed its launch screen (`window.Capacitor`, `https://localhost`, or standalone display-mode → the in-page `#splash` is removed before first paint). In a browser tab the mark shows once per fresh open, **static, no animation** — every animated version read as a glitch against the system splash. `MainActivity` holds the system launch screen 950ms so insets and the home fit settle behind the logo.
- **Layout stability:** `env(safe-area-inset-*)` is read once into `--safe-top` / `--safe-bot` (`latchSafeArea()` in `js/app.js`) and never allowed to shrink; every inset in the stylesheet reads `var(--safe-top, env(...))`. `fitHome()` re-fits on every height change (debounced) but never on scroll. Skipping small height changes broke the layout once — do not reintroduce a threshold.
- **Workout notification (native):** `nativeClearWorkoutNote()` must remove it as a *delivered* notification; `LocalNotifications.cancel()` alone leaves an ongoing one in the shade.
- Removed on purpose: barcode scanning, water tracking, the Classic home layout, the "bring back removed routines" button.
- RPE is **opt-in**: off by default, per-exercise via the ⋯ menu (`exPrefs[id].rpe` stored as `1`/`0` because `setExPref` prunes `false`), sets that carry values keep their column, Settings switch turns it on everywhere.
- Every small control has an invisible tap halo (`::after` inset -7px); keep new icon buttons on that list in `css/style.css`.
- Settings on/off rows are drawn switches (`.switch-row input[type=checkbox]`), not stock checkboxes.
- Nutrition shows its number once: hero + bar + "eaten / goal"; the separate Consumed card is gone. The one-tap food strip (`.slot-quick`) is `touch-action: pan-x` and holds six recents.
- Bodyweight is exact to 0.05 (`roundWeight`), never re-rounded by the number roll.
- Records are by total mass (weight × reps; reps alone for bodyweight).
- Tab swipe stands down inside anything in `OWN_GESTURE` (`.slot-card`, `.wk-plan`, `.hbh-row`, sheets…); add a selector there rather than fighting it.

## Where things are

| | |
|---|---|
| `BUILD-ANDROID.md` | the whole native story: keystore, secrets, CI, local build, moving data across |
| `pc/README.md` | the sync protocol, the runnable PC end, wiring into Electron |
| `tests/polish.test.js` | the UI-standards pass: halos, switches, layout stability, notification lifecycle, the chip strip |
| `tests/splash.test.js` | the opening mark, browser vs installed |
| `js/bela-feed.js`, `tests/feed.test.js` | the PC feed (other session — see log) |

## Log — newest first

Add a line when you ship. Say what changed and why, not the diff.

- **15.5** (session A) — the one-tap food strip under each meal scrolls sideways only (`touch-action: pan-x`, `overscroll-behavior-x: contain`), bleeds to the card edge with snap and an edge fade while there is more, shows full names with CSS ellipsis, and holds six recents. A vertical drag on it used to scroll the page.
- **15.2–15.4** (session B) — the **Info** tab (`bela` in `TAB_ORDER`): the PC's feed inside the app via a relay, its own notifications, filters and kinds, a Home card; `privacy.html`, `terms.html`, `enablebanking.html`; WebView scrollbars disabled in `MainActivity`.
- **15.1** (A) — `MainActivity` holds the launch screen 950ms; home re-fits on every height change (15.0 had a 24px threshold that left buttons behind the nav bar).
- **15.0** (A) — safe-area insets latched into `--safe-top/--safe-bot`; the page stopped sliding after opening.
- **14.9** (A) — the logo is drawn once: in-page splash removed on native/standalone; launch theme no longer double-draws it.
- **14.7–14.8** (A) — professional-standards pass: tap halos, nutrition IA, opt-in RPE, drawn switches, light-mode contrast, Classic home removed, workout notification cleared as delivered, splash made static.
- **14.6** (A) — installed app checks GitHub releases and offers updates; Settings → Check for updates.
- **14.5** (A) — signed release builds on CI with a real keystore; `pc/bela-sync.js` runnable PC end; opening mark; barcode scanner removed.
- **14.4 and before** — see `git log`.

Session A = the one that set up CI/signing/sync and did the UI audit.
Session B = the one building the Info tab and the PC feed.
