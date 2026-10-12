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
CHROMIUM_PATH=/opt/pw-browsers/chromium npm test            # all (~740 checks)
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
- **Design system (16.0):** Inter ships in `fonts/` (no CDN — offline). Surfaces, shape and motion are tokens at the top of `css/style.css` (`--card-bg`, `--card-edge`, `--card-shadow`, `--sheet-bg`, `--ease-out`/`--ease-spring`/`--ease-emph`); the final look of each component is the "16.0 — the design pass" layer at the bottom. Use the tokens, not new literal colours or curves.
- **Motion (16.0):** the view is rebuilt on every action, so motion is done by remembering: `animateProgress()` animates bars (inline `width`/`height`) and rings (`circle[stroke-dasharray][stroke-dashoffset]`) from their last value, `staggerIn()` raises the blocks only when you *arrive* on a tab (never on a re-render, never on the first render), `markJustDone()` draws the tick on something just finished. New bars and rings get this for free if they follow those shapes. `prefers-reduced-motion` turns all of it off.
- **Sheets close through `sheetOut()`**: the node leaves `#sheetRoot` at once (so to the app it is closed, as before) and plays its exit in `#sheetGhost` — inert, ids stripped, gone after 280ms.
- `.seg` controls get a `.seg-thumb` appended (last child, so `:first-child` is still the first option) by a MutationObserver; keep an `id` on every `.seg` so a rebuilt one slides from where it was.
- Confetti (`burst()`) only for a saved workout and for closing the day's habits *here and now* — not for opening the app on a day already closed.
- The tab bar is glass and its height is fixed at 79px over the inset — the mini workout bar and home's fit are measured against it.
- **Rest timer (16.1)** is back, Hevy's way and **off by default**: per exercise (`exPrefs[id].rest`, seconds), chosen from the card's "Rest timer" line or the ⋯ menu; logging a set starts it (not between superset partners — after the round). The running rest is a fixed end time in `activeWorkout.rest = { endAt, total }`, so a reload or a locked phone loses nothing; on the installed app the end is booked as notification 8802 on its own `rest` channel (importance 4, vibrates) and cancelled on skip/adjust/finish. Nothing counts down unless he gave that exercise a rest (an earlier timer was removed; why is not recorded — `tests/logger.test.js` still checks nothing counts down by default).
- The logger's set rows are real rows (`.set-grid > .set-row` is a subgrid), so they tint when logged (`::before`), mark the next set (`.is-next`), and swipe left to delete with undo. Tapping the PREV figure copies last time's set in.
- Saving a new session opens "Workout complete" (not a toast); editing a saved one still toasts "Changes saved".
- Menus draw their icons (`MI` in `js/app.js`) — no emoji in menus.
- Launch logo: `res/drawable/splash_mark.xml` (vector, same placement as the launcher foreground). The old splash stretched a 432px PNG to ~720px and looked soft.
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

- **16.1** (C) — the workout screen, after he asked for Hevy's functions: per-exercise rest timer with a floating panel (−15 / +15 / Skip, "next: set 2 · Bench"), a clock in the logger's bar for a rest by hand, the countdown in the mini bar, a booked notification for the end of a rest on the installed app; tap PREV to copy last time's set; swipe a set away (undo); the next set marked; reorder the whole session from the ⋯ menu; a "Workout complete" page after saving (Nth workout, four figures, best set per exercise, confetti). Visual: rows tinted green when logged, rounded-square ticks, lighter inputs, "Add exercise" as the primary button, drawn menu icons. Launch logo now a vector — it was pixelated. New suites `tests/workout.test.js` and `tests/layout.test.js` (measures every screen for overlaps, spilled text and content hidden behind the bars — 360/384/412 px and large text; it caught "Shoulders" running into its bar at large text).
- **16.0** (session C — the design pass, asked for with "full freedom" to make it look and feel professional) — Inter bundled; dark cards lit from above, light cards on soft shadows; glass tab bar with one marker that slides between tabs; sheets on their own surface with a scrim, sprung in and played out; blocks rise in on arriving at a tab; every bar and ring fills from its last value; segmented controls get a sliding thumb; charts draw themselves (line traces, points pop, bars grow; past weeks a step quieter); ticks draw in; confetti for a saved workout and for closing the day; empty states with a mark; the logger's ⋯ is a real button and a hairline under its figures fills as sets are logged ("Save as routine" is a switch). Fixed: the calories card centred its text (it is a button), the habits calendar's first three columns were wider, the backup nudge's title was grey. Monochrome + one green kept; the green is still only for "reached" (the logger's line turns green only when every set is in). Rest timer deliberately not brought back. New suite `tests/design.test.js`.
- **15.5** (session A) — the one-tap food strip under each meal scrolls sideways only (`touch-action: pan-x`, `overscroll-behavior-x: contain`), bleeds to the card edge with snap and an edge fade while there is more, shows full names with CSS ellipsis, and holds six recents. A vertical drag on it used to scroll the page.
- **15.2–15.4** (session B) — the **Info** tab (`bela` in `TAB_ORDER`): the PC's feed inside the app via a relay (`js/bela-feed.js`), the app's own notifications, filter chips and kind labels; `privacy.html`, `terms.html`, `enablebanking.html`; WebView scrollbars disabled in `MainActivity`. He reviewed it on the phone and cut it back: **no Home card, no page heading** — Info is the chips and the feed, nothing else, and the connection status lives in the feed sheet under Settings. New reads bright with the left mark, seen has the ink turned down, and leaving the tab is what marks it read, so the distinction survives while you are looking at it. The tab carries an unread count, hidden while you are on it.
- **15.1** (A) — `MainActivity` holds the launch screen 950ms; home re-fits on every height change (15.0 had a 24px threshold that left buttons behind the nav bar).
- **15.0** (A) — safe-area insets latched into `--safe-top/--safe-bot`; the page stopped sliding after opening.
- **14.9** (A) — the logo is drawn once: in-page splash removed on native/standalone; launch theme no longer double-draws it.
- **14.7–14.8** (A) — professional-standards pass: tap halos, nutrition IA, opt-in RPE, drawn switches, light-mode contrast, Classic home removed, workout notification cleared as delivered, splash made static.
- **14.6** (A) — installed app checks GitHub releases and offers updates; Settings → Check for updates.
- **14.5** (A) — signed release builds on CI with a real keystore; `pc/bela-sync.js` runnable PC end; opening mark; barcode scanner removed.
- **14.4 and before** — see `git log`.

Session A = the one that set up CI/signing/sync and did the UI audit.
Session B = the one building the Info tab and the PC feed.
