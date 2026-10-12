/* The home-screen widget, installed: the app hands it today's figures (and
   again when they change, never the same twice), and a widget button opens
   the app straight onto what it asked for — on a cold start and when the
   app is already running. */
const { readState, PHONE } = require('./lib/harness');
const { build } = require('./lib/seed');

async function installed(t, url, seed, go) {
  const p = await t.browser.newPage({ viewport: PHONE, colorScheme: 'dark', hasTouch: true, deviceScaleFactor: 2 });
  p.errors = [];
  p.on('pageerror', (e) => { if (!/ServiceWorker/.test(String(e))) p.errors.push(String(e)); });
  await p.addInitScript(([s, launch]) => {
    if (!localStorage.getItem('bela-gym-v1')) localStorage.setItem('bela-gym-v1', JSON.stringify(s));
    sessionStorage.setItem('bela-opened', '1');
    localStorage.setItem('bela-update-check', String(Date.now()));
    window.__W = { updates: [], go: launch };
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        BelaWidget: {
          update: async (o) => { window.__W.updates.push(JSON.parse(o.data)); },
          takeLaunch: async () => { const go = window.__W.go; window.__W.go = null; return { go }; },
        },
        LocalNotifications: { createChannel: async () => {}, checkPermissions: async () => ({ display: 'denied' }) },
        App: { addListener: () => {} },
      },
    };
  }, [seed, go || null]);
  await p.goto(url);
  return p;
}

module.exports = async (t) => {
  const server = await t.serve({ serviceWorker: false });
  const seed = build();
  const p = await installed(t, server.url, seed);
  await p.waitForTimeout(1800);
  let ups = await p.evaluate(() => window.__W.updates);
  t.equal('opening hands the widget today once', ups.length, 1);
  const d = ups[0];
  t.check('with calories and their goal', typeof d.kcal === 'number' && d.kcalGoal === seed.nutrition.targets.kcal, JSON.stringify(d));
  t.check('habits done of total', typeof d.habitsDone === 'number' && d.habitsTotal > 0);
  t.check('what starting would start', /^(Start|Resume)/.test(d.start), d.start);

  // moving between tabs changes nothing on it
  await p.evaluate(() => document.querySelector('.tab[data-tab="habits"]').click());
  await p.waitForTimeout(1300);
  t.equal('a render that changes nothing is not sent again', (await p.evaluate(() => window.__W.updates.length)), 1);

  // ticking a habit does (the seed has sleep ticked today: untick it)
  await p.evaluate(() => document.querySelector('.hb-row[data-habit="h_sleep"]').click());
  await p.waitForTimeout(1300);
  ups = await p.evaluate(() => window.__W.updates);
  t.check('a ticked habit reaches it', ups.length === 2 && ups[1].habitsDone === d.habitsDone - 1, JSON.stringify(ups.map((x) => x.habitsDone)));

  // a widget tap with the app running: the page is told, and asks
  await p.evaluate(() => { window.__W.go = 'meal'; window.dispatchEvent(new Event('belaGo')); });
  await p.waitForTimeout(700);
  t.check('"Log meal" opens the meal sheet', await p.evaluate(() => !!document.querySelector('#sheetRoot .sheet')));
  t.equal('no page errors', p.errors.length, 0, p.errors.join(' | '));
  await p.close();

  // cold start from "Start workout": the day's session, or an empty one
  const p2 = await installed(t, server.url, build(), 'workout');
  await p2.waitForTimeout(1500);
  t.check('"Start" on the widget starts a session', !!(await readState(p2)).activeWorkout);
  t.equal('the launch is taken once', await p2.evaluate(() => window.__W.go), null);
  t.equal('cold start: no page errors', p2.errors.length, 0, p2.errors.join(' | '));
  await p2.close();

  const p3 = await installed(t, server.url, build(), 'habits');
  await p3.waitForTimeout(1200);
  t.check('the habits figure opens habits', await p3.evaluate(() => document.querySelector('.tab.active')?.dataset.tab === 'habits'));
  await p3.close();
  await server.close();
};
