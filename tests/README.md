# Tests

Browser tests for the app, driven by Playwright against a local copy served
the way GitHub Pages serves it (including the ten minute `max-age`, which is
what broke updates once).

## Running them

```sh
npm install                    # once — pulls Playwright
npx playwright install chromium
npm test                       # every suite
npm test -- logger habits      # just those
```

If Playwright is already installed globally, `NODE_PATH` works too:

```sh
NODE_PATH=$(npm root -g) node tests/run.js
```

## What each suite covers

| Suite | Guards against |
| --- | --- |
| `home` | Home growing past one screen, uneven gaps, sideways scroll, the plan-aware start button, tapping a day |
| `logger` | Set numbering (a warm-up must not take a number), the set-type picker, RPE, removing a set, where the rest timer sits, editing a saved session |
| `habits` | Both views and the remembered choice, completion fills, green perfect days, linked habits, the keypad, importing an export |
| `nutrition` | Editing goals, saving a meal and logging it again, one-tap recents |
| `data` | kg↔lb converting the stored values rather than relabelling them, old backups migrating, destructive actions never using a browser dialog |
| `update` | The service worker actually shipping a new build, and every page still scrolling |

## Adding one

A suite is a file named `*.test.js` exporting an async function:

```js
module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const page = await openApp(t.browser, { url: server.url, seed: build() });
  t.check('a label', someCondition);
  t.equal('another label', actual, expected);
  await page.close();
  await server.close();
};
```

`t.check`, `t.equal` and `t.near` record results; the runner prints them and
exits non-zero if any failed. Shared helpers live in `lib/harness.js`, and
`lib/seed.js` builds a realistic starting state with dates relative to today.
