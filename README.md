# B.E.L.A Gym

A mobile-first gym companion app: workout tracking **and** nutrition tracking in one place.
Built as an installable PWA with plain HTML/CSS/JS — no build step, no backend, no accounts.
All data stays on the device (localStorage), with JSON export/import for backups.

## Features

**Home**
- Week strip showing which days you trained or logged meals
- Bodyweight card — tap to log today's weight, with weekly delta and mini chart
- Calorie gauge and protein / carbs / fat progress against your daily targets
- Quick shortcuts to start a workout or log a meal

**Workouts**
- Start an empty workout or pick a routine (Push / Pull / Legs / Full Body built in)
- Log sets (weight × reps) with your previous session shown as a hint
- Set types: normal, warm-up, drop set, failure (tap the set number to cycle)
- Automatic PR detection with trophies when you beat your best estimated 1RM
- Cardio exercises log distance (km) and time (min) instead of weight × reps
- Exercise menu: reorder, replace, notes, plate calculator, records & history
- Automatic rest timer after each set (adjustable, skippable)
- Workout notes on finish; save any workout as a reusable routine
- 40+ exercise library grouped by muscle, plus custom exercises

**Meals**
- Log meals per day with calories and macros
- Quick-add from a common-foods list or your recent entries
- Daily calorie gauge + macro bars, browsable day by day
- Targets configurable in Settings

**Progress**
- Estimated 1RM trend per exercise (Epley), with touch/hover tooltips
- Weekly training volume, last 8 weeks; bodyweight trend
- Weekly streak, total time trained, and lifetime PR count
- Workout calendar (month view) plus full history — expand, repeat, delete
- Per-exercise records: best weight, best est. 1RM, best session volume

**Settings**
- kg / lb, rest timer length, nutrition targets
- Export / import all data as JSON
- Erase everything

## Running it

It's a static site — any web server works:

```bash
# from the repo root
python3 -m http.server 8080
# or
npx serve .
```

Then open http://localhost:8080 — on a phone, use "Add to Home Screen" to install it
as an app (works offline thanks to the service worker).

### GitHub Pages

Enable Pages for this repo (Settings → Pages → deploy from branch, root folder)
and the app is live at your Pages URL — nothing to build.

## Stack

- Plain HTML / CSS / JavaScript (ES2020), no dependencies
- Hand-built SVG charts with tooltips, light & dark theme via `prefers-color-scheme`
- Service worker (cache-first app shell) + web manifest for installability
- Data model versioned in localStorage under `bela-gym-v1`
