# The PC half of B.E.L.A sync

Two files, no dependencies:

| | |
|---|---|
| `sync.js` | the merge. **A copy of `js/sync.js`** — the phone runs the identical file, which is why the two ends always reach the same answer. Do not edit this copy; `npm run build:web` refreshes it, and the test suite fails if it drifts. |
| `bela-sync-server.js` | a tiny HTTP server that takes the phone's document, merges it into yours, and sends the result back. |

Copy both into your Electron project.

## Wiring it in

```js
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { startBelaSync } = require('./bela-sync-server');

const FILE = path.join(app.getPath('userData'), 'bela.json');

const read = () => {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { return {}; }          // first run — an empty document is fine
};
const write = (doc) => fs.writeFileSync(FILE, JSON.stringify(doc));

const sync = startBelaSync({
  load: read,
  save: write,
  name: 'Rimvydas PC',
  onSync: ({ tally, summary }) => {
    console.log('phone synced', tally, summary);
    // tell your window to reload what it shows
  },
});

console.log('phone → Settings → Sync with the PC app');
console.log('address:', sync.address);      // e.g. 192.168.1.20:8765
console.log('code:   ', sync.code);         // e.g. 402913

app.on('will-quit', () => sync.stop());
```

Show `sync.address` and `sync.code` somewhere in your UI. That is everything
the phone needs.

### Keeping the code the same between runs

`startBelaSync` invents a pairing code if you do not give it one, which means a
new code every launch. Save it once instead:

```js
const CODE_FILE = path.join(app.getPath('userData'), 'bela-code.txt');
let code;
try { code = fs.readFileSync(CODE_FILE, 'utf8').trim(); } catch (e) { /* first run */ }
const sync = startBelaSync({ load: read, save: write, code });
fs.writeFileSync(CODE_FILE, sync.code);
```

### Windows Firewall

The first launch pops a prompt asking whether to let Node accept connections.
Say yes for **private networks** — without it the phone gets no answer.

## Reading and writing the data yourself

Your app owns the document between syncs. The shape is exactly what the phone's
**Settings → Save backup** produces:

```jsonc
{
  "settings":  { "unit": "kg", "appearance": "dark", "waterTarget": 8, "name": "" },
  "nutrition": {
    "targets":      { "kcal": 2800, "protein": 180, "carbs": 300, "fat": 70 },
    "meals":        [ { "id": "…", "date": "2026-08-20", "time": "08:14", "slot": "breakfast",
                        "name": "Oats", "kcal": 400, "protein": 20, "carbs": 60, "fat": 8 } ],
    "weights":      [ { "date": "2026-08-20", "value": 80.4 } ],
    "water":        [ { "date": "2026-08-20", "glasses": 6 } ],
    "measurements": [ { "date": "2026-08-20", "key": "waist", "value": 82 } ]
  },
  "savedMeals":      [ … ],
  "foods":           [ … ],   // your own foods
  "schedule":        [ null, "tpl_1", …  ],  // Mon…Sun
  "habits":          [ { "id": "h_steps", "name": "Steps", "type": "count", "target": 10000 } ],
  "habitLog":        { "2026-08-20": { "h_steps": 8200 } },
  "customExercises": [ … ],
  "templates":       [ … ],
  "workouts":        [ { "id": "…", "name": "Push", "startedAt": 0, "finishedAt": 0,
                         "exercises": [ { "exerciseId": "bench", "sets": [ { "weight": 80, "reps": 8, "done": true } ] } ] } ],
  "sync":            { … }    // see below — leave it alone
}
```

**One rule: change rows, do not rebuild them.** The merge decides who wins by
when a row last changed, and it works that out by comparing each row with how it
looked before. So:

```js
// good — the other rows are untouched
doc.workouts.find((w) => w.id === id).name = 'Push A';

// bad — every row looks rewritten, so a sync thinks the PC changed everything
doc.workouts = doc.workouts.map((w) => ({ ...w }));
```

Give new rows an `id` nothing else has (`Date.now().toString(36) + something`).

### Stamping your own edits

`doc.sync` is where the change times live. The server writes it during a sync,
but edits you make in between need to be noticed too, or a phone sync will look
newer than they are and overwrite them. So take a picture when you load, and
stamp when you save:

```js
const Sync = require('./sync.js');

let doc = read();
let shadow = Sync.snapshot(doc);          // "this is how it looks now"

function saveDoc() {
  ({ shadow } = Sync.stamp(doc, shadow, Date.now()));   // mark what moved
  write(doc);
}
```

Pass the same `load`/`save` to `startBelaSync` and after a sync re-take the
picture, because the document it hands back is a different one:

```js
const sync = startBelaSync({
  load: () => doc,
  save: (merged) => { doc = merged; shadow = Sync.snapshot(doc); write(doc); },
});
```

If you skip stamping entirely, sync still works — the PC just never wins a
conflict, because as far as the merge can tell nothing on it ever changed.

## The protocol, if you would rather write your own end

Two endpoints, JSON both ways, `Access-Control-Allow-Origin: *` on every reply.

**`GET /bela/ping`**

```json
{ "app": "bela", "protocol": 1, "name": "Rimvydas PC" }
```

**`POST /bela/sync`** — header `x-bela-code: <pairing code>`

```json
{ "protocol": 1, "device": "dev_a1b2c3", "doc": { … the phone's whole document … } }
```

Reply:

```json
{ "protocol": 1, "doc": { … the merged document … }, "tally": { "added": 3, "updated": 1, "removed": 0 } }
```

The phone adopts the returned document wholesale, so whatever you send back is
what it will hold. Answer `403` for a wrong code and `409` for a protocol it
does not know.

### What the merge actually does

Row by row, the copy that touched it last wins.

- **Lists with ids** — workouts, meals, foods, saved meals, templates, custom
  exercises, habits — are unioned. Same id on both sides: the later change wins.
- **One row per day** — weight, water, measurements — the day is the id.
- **Habits ticked on a day** are merged per habit, so ticking one on the phone
  and another on the PC on the same day keeps both.
- **Settings, nutrition targets and the weekly plan** are single things: the
  side that changed one last replaces it whole.
- **Deletions are remembered for 180 days**, so deleting on one side deletes on
  the other rather than the row coming back on the next sync. A copy that has
  been offline longer than that will bring its rows back.
- **A workout in progress never leaves the phone** and is never overwritten.

Ties go to the side running the merge — the PC.

Both ends compare wall clocks, so if the PC's clock is badly wrong its edits
will always look older (or newer) than they are. Keep it set automatically and
this never comes up.

## Why it has to be the installed app

A page served over `https://` cannot open a plain `http://` connection to a
machine on your network; the browser stops it before it leaves. So the app at
`rjotko-dotcom.github.io` cannot sync, and says so instead of failing quietly.
The installed Android app can — see [../BUILD-ANDROID.md](../BUILD-ANDROID.md).

Nothing leaves your network either way. There is no server anywhere but yours.
